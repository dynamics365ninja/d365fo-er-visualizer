# Architecture

## System Overview

D365FO ER Visualizer is a pnpm monorepo for visualizing and analyzing Dynamics 365 Finance & Operations Electronic Reporting (ER) configurations. It transforms raw XML bundles (or live API responses) into an interactive visual workspace.

```
┌──────────────────────────────────────────────────────────────┐
│                    Electron Shell (optional)                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                   React UI (Vite SPA)                  │  │
│  │  ┌───────────┐  ┌───────────────┐  ┌────────────────┐  │  │
│  │  │  Explorer │  │   Designer    │  │   Inspector    │  │  │
│  │  │  (Tree)   │  │  (ReactFlow)  │  │  (Properties)  │  │  │
│  │  └─────┬─────┘  └───────┬───────┘  └────────┬───────┘  │  │
│  │        │                │                   │          │  │
│  │        └────────────────┼───────────────────┘          │  │
│  │                         │                              │  │
│  │              ┌──────────▼─────────┐                    │  │
│  │              │   Zustand Store    │                    │  │
│  │              │  (App State +      │                    │  │
│  │              │   Resolution)      │                    │  │
│  │              └──────────┬─────────┘                    │  │
│  └─────────────────────────┼──────────────────────────────┘  │
│                            │                                 │
│                 ┌──────────▼─────────┐                       │
│                 │   @er-visualizer/  │                       │
│                 │       core         │                       │
│                 │  ┌─────────────┐   │                       │
│                 │  │  XML Parser │   │                       │
│                 │  └──────┬──────┘   │                       │
│                 │  ┌──────▼───────┐  │                       │
│                 │  │ GUID Registry│  │                       │
│                 │  └──────┬───────┘  │                       │
│                 │  ┌──────▼───────┐  │                       │
│                 │  │ Type System  │  │                       │
│                 │  └──────────────┘  │                       │
│                 └────────────────────┘                       │
└──────────────────────────────────────────────────────────────┘
```

---

## Data Flow

```
  ER XML (disk) or F&O API response
       │
       ▼
  parseERConfiguration()          ← @er-visualizer/core
       │
       ├── Detect component kind (DataModel / ModelMapping / Format)
       ├── Unwrap ErFnoBundle / bare-content / base64 payload
       ├── Resolve correct version node from Solution → Contents → Ref.IDs
       ├── Parse version-specific content
       │     ├── DataModel    → containers, items
       │     ├── ModelMapping → datasources, bindings, validations
       │     └── Format       → elements, format bindings, enums, transformations
       └── Parse expression AST (recursive XML → discriminated union)
       │
       ▼
  ERConfiguration (typed object)
       │
       ▼
  Zustand Store  loadXmlFile(xml, path)
       │
       ├── Append to configurations[]
       ├── Rebuild GUIDRegistry (indexConfiguration for all configs)
       ├── Build TreeNode[] hierarchy (per config)
       └── Trigger React re-render
       │
       ▼
  UI Components
       ├── ConfigExplorer    ← treeNodes (filterable/grouped tree)
       ├── DesignerView      ← active config (ReactFlow graph)
       ├── PropertyInspector ← selectedNode (property grid)
       ├── SearchPanel       ← registry.search() + whereUsed()
       ├── ClickablePath     ← resolveDatasource / resolveBinding
       └── DrillDownPanel    ← resolveDeepExpression chain
```

---

## Core Package Design

### XML Parser (`xml-parser.ts`)

The parser uses `fast-xml-parser` with a configuration tuned for ER XML:

- `isArray` callback forces known multi-occurrence elements to always be arrays
- Attribute names are prefixed with `@_` to separate from child elements
- Entity processing is disabled for safety
- Parsing is **synchronous** — ER files are typically < 5 MB

**Component detection:**  The parser examines the root XML element to determine the ER component kind:
- `ERDataModelVersion` → DataModel
- `ERModelMappingVersion` → ModelMapping
- `ERFormatVersion` or `ERFormatMappingVersion` → Format

**Version resolution:**  An ER XML bundle can contain multiple version nodes. The parser resolves the correct version by following `Solution → Contents → Ref. IDs`, not by picking the first occurrence.

### GUID Registry (`guid-registry.ts`)

Central cross-reference index over all loaded configurations:

```
GUIDEntry
  guid            → normalized lowercase (braces stripped)
  kind            → Solution / ModelVersion / Container / FormatElement / …
  name            → human-readable label
  configFilePath  → source file path (disk path or synthetic fno:// URI)
  componentKind   → DataModel / ModelMapping / Format

CrossRefEntry
  target          → referenced entity (table name, GUID, model path, …)
  targetType      → Table / Field / GUID / ModelPath / Enum / Class / EDT / Label / Formula
  sourceConfigPath → where the reference occurs
  sourceComponent  → component name
  sourceContext    → human-readable description
```

`indexConfiguration()` walks the full typed config tree and registers every GUID and cross-reference in a single pass.

### Type System

The type system uses TypeScript interfaces with discriminated unions for polymorphism:

- **Datasources** use a flat interface with optional type-specific sub-objects (`tableInfo`, `enumInfo`, `classInfo`, `calculatedField`, `groupByInfo`) rather than a class hierarchy — this keeps JSON-serialization trivial and avoids `instanceof`.
- **Expressions** use a discriminated union keyed by `kind` — enabling exhaustive pattern matching in consumers.
- **Format elements** use a recursive tree (`children: ERFormatElement[]`) with a `Record<string, string>` escape hatch for format-specific XML attributes.

---

## UI Architecture

### State Management

The Zustand store (`useAppStore`) is the single source of truth for workspace state:

| State | Type | Description |
|---|---|---|
| `configurations` | `ERConfiguration[]` | All loaded ER configs |
| `registry` | `GUIDRegistry` | Merged GUID + cross-ref index |
| `treeNodes` | `TreeNode[]` | Tree hierarchy for the explorer |
| `selectedNodeId` / `selectedNode` | `string` / `TreeNode` | Currently selected node |
| `openTabs` / `activeTabId` | Tab array + active ID | Designer tab state |
| `searchQuery` / `searchResults` | string / any[] | Search state |
| `showTechnicalDetails` | `boolean` | Consultant/technical mode (persisted in localStorage) |
| `fnoIngestStatus` | `string` | Current ingest phase label; empty when idle |

Key actions:

| Action | Purpose |
|---|---|
| `loadXmlFile(xml, path)` | Parse XML, add to configs, rebuild registry + tree |
| `selectNode(id)` | Set selection, look up TreeNode by ID |
| `resolveDatasource(expr, configIdx)` | Find datasource matching an expression segment |
| `resolveBinding(path, configIdx)` | Find model mapping binding for a model path |
| `resolveModelPath(dotPath)` | End-to-end: model path → binding → datasource |
| `whereUsed(entityName)` | Trace table / enum / class / datasource → binding → format element |
| `setFnoIngestStatus(text)` | Update the ingest progress label (empty = idle) |

**F&O session state** (`state/fno-session.ts`) is separate from the main store. It holds connection state, solution list, component list, and selection across drill levels so that navigating away from `FnoConnectPanel` does not lose browsing progress.

### FnoConnectPanel — F&O Ingest Pipeline

`FnoConnectPanel` orchestrates the full download lifecycle via `handleLoadSelected`. The pipeline runs in 5 sequential phases, each reflected in the `fnoIngestStatus` label that drives the progress UI:

1. **Phase 0 — GUID discovery** (scout downloads) — for Formats whose parent DataModel has no GUID in the listing API, sibling Format XML is downloaded to extract the `Model=` GUID attribute. If that also fails, ModelMapping siblings are included as scouts (their download returns both the mapping and the DataModel via `parmModel`).

2. **Phase 1 — DataModels** — downloaded in parallel batches of 2. Cross-references (`referencedDataModelGuids`) are harvested for the follow-up queue.

3. **Phase 2 — Formats & Mappings + listing scan** (concurrent) — selected non-DataModel configs download in parallel while a recursive `listComponents` walk builds `pendingMappingBranchesByDmName` without downloading anything yet.

4. **Phase 3 — Model Mappings** (synth pass) — for every DataModel GUID now known (from XML, listing, and cross-refs), `GetModelMappingByID(dmGuid, descriptorName)` is called. Branches sharing a DataModel GUID are attempted in batches; once one succeeds, remaining branches for that GUID are skipped.

5. **Phase 4 — Late DataModels** — GUIDs discovered inside ModelMapping XML during Phase 3 but not yet loaded are fetched in a final follow-up pass.

**Ingest progress UI:**
- `LandingPage` renders a full-screen modal card (backdrop blur + slide-in animation) with an indeterminate progress bar and a 5-step checklist. Steps show a pulsing dot when active and a green checkmark when done.
- `ConfigExplorer` renders a compact in-tree banner while configurations are already visible in the explorer.
- Both derive the active step index by matching `fnoIngestStatus` against well-known phase strings.

### Component Interaction

```
Toolbar ────── file open ──→ loadXmlFile ──→ store update ──→ tree + designer re-render
                                                              │
ConfigExplorer ── click ──→ selectNode ──→ PropertyInspector re-render
                  dblclick → openTab ──→ DesignerView re-render
                                │
                                └─ non-root node → Focused detail-only tab

DesignerView ─── node click ──→ selectNode
             ─── expression click → DrillDownPanel push frame

ClickablePath ── hover/click ──→ resolveDatasource / resolveModelPath

SearchPanel ──── search ──→ registry.search()
            ──── result action → navigateToTreeNode()
            ──── where-used ──→ whereUsed() → render trace cards

FnoConnectPanel ─ connect ──→ fnoSession.signIn() → listSolutions()
                ─ pick solution → listComponents() → setComponents()
                ─ load selected → 5-phase ingest pipeline → loadXmlFile (for each)
```

---

### Hierarchical Solutions List

`FnoConnectPanel` builds a 2-level solution tree from the flat `ErSolutionSummary[]` list returned by the F&O API:

- **Root nodes** — summaries with no `rootSolutionName`. Displayed as expandable rows with a collapse/expand toggle and a child-count badge.
- **Child nodes** — summaries whose `rootSolutionName` points to a root in the list. These represent derived (country/region-specific) DataModels. Displayed indented under their root.

Clicking a root auto-expands it (via `expandedSolutions` state) so children are immediately visible. Selection from the left panel triggers `handlePickSolution`, which fetches the full component tree from `rootSolutionName` (not the clicked name) to ensure sibling formats and mappings are included.

The `promoteDmToSolutions` helper appends newly-discovered derived DataModels (found inside `listComponents` responses) to the solutions list so they appear as navigable child rows without requiring a separate API call.

---

### Designer Views

Three specialized designers, all using `@xyflow/react`:

1. **ModelDesigner** — BFS-based left-to-right layout of containers as card nodes, with edges for type references between containers.
2. **MappingDesigner** — Three-column view: datasources → bindings (model paths → expressions) → validations.
3. **FormatDesigner** — Hierarchical element tree with binding status badges (bound / unbound / structural) and category-grouped binding display.

A **FocusedNodeTab** mode is used for non-root explorer items: the center pane shows a dedicated properties-only detail view instead of the full designer.

### Theming

The app uses two complementary systems:

**Fluent UI tokens** (`tokens.*`) — used for all Fluent component styling (colors, spacing, typography, shadows, border radii). Theme is controlled by wrapping the tree in `FluentProvider` with a light or dark theme object.

**CSS custom properties** — semantic surface variables shared across custom (non-Fluent) CSS:

- `--surface-info-*` / `--surface-success-*` / `--surface-warning-*` / `--surface-danger-*` / `--surface-purple-*` — category tint surfaces
- `--format-type-*` — per-format-element-type accent colors
- `--accent`, `--bg-primary`, `--bg-secondary`, `--text-primary`, `--text-secondary` — base theme tokens

Both light and dark variants are defined. The active mode is stored in Zustand (`themeMode`) and persisted in localStorage.

---

## Electron Integration

The Electron package is a thin shell:

```
main.ts:
  - Creates BrowserWindow (1600×1000, context isolation)
  - Dev: loads http://localhost:5173
  - Prod: loads built ui/dist/index.html
  - IPC handler: open-file-dialog → showOpenDialog → read files

preload.ts:
  - contextBridge.exposeInMainWorld('electronAPI', { openFileDialog })
```

The UI package detects Electron via `window.electronAPI` and uses native dialogs when available, falling back to `<input type="file">` in browser mode.

---

## Build & Bundle Strategy

| Package | Build Tool | Output |
|---|---|---|
| `core` | `tsc` | `dist/` with `.js` + `.d.ts` + `.d.ts.map` |
| `ui` | Vite 6 | `dist/` SPA bundle with code-split chunks (xyflow, panels, react-vendor, vendor) |
| `electron` | `tsc` | `dist/main.js` + `dist/preload.js` |

Vite aliases `@er-visualizer/core` to the core source during dev for instant HMR; in production, the core is compiled first and the bundler resolves from source.

---

## Testing Strategy

- **Unit tests** (Vitest) cover the `core` package:
  - XML parser: round-trip tests for all three component kinds
  - GUID registry: registration, lookup, cross-reference search
- **Visual smoke checklist** (`docs/ui-visual-smoke-checklist.md`): manual checklist for theme, interaction, and regression testing.

---

## Key Design Decisions

1. **Monorepo with pnpm workspaces** — clean separation of concerns (core is UI-agnostic), single `pnpm install`.
2. **No class hierarchy for datasources** — flat interfaces with optional sub-objects keep serialization simple and avoid OOP complexity.
3. **Discriminated union for expressions** — enables exhaustive `switch` in TypeScript, no `instanceof` needed.
4. **Zustand over Redux** — minimal boilerplate, direct state mutations, no action types.
5. **CSS variables for theming** — a single `index.css` change switches the entire color system; no JS theme recalculation.
6. **Synchronous parsing** — ER files are small enough that async parsing adds complexity without benefit.
7. **Czech-first i18n** — primary users are Czech; English is the fallback.
8. **Electron as optional shell** — the app works fully in the browser; Electron only adds native file dialogs.
