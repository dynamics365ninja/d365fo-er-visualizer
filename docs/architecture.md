# Architecture Documentation

## System Overview

D365FO ER Visualizer is a monorepo application for visualizing and analyzing Electronic Reporting (ER) configurations exported from Dynamics 365 Finance & Operations. It transforms raw XML configuration bundles into an interactive visual workspace.

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
  ER XML File(s)
       │
       ▼
  parseERConfiguration()          ← @er-visualizer/core
       │
       ├── Detect component kind (DataModel / ModelMapping / Format)
       ├── Parse solution version envelope
       ├── Parse version-specific content
       │     ├── Data Model → containers, items
       │     ├── Model Mapping → datasources, bindings, validations
       │     └── Format → elements, format bindings, enums, transformations
       └── Parse expression AST (recursive XML → discriminated union)
       │
       ▼
  ERConfiguration (typed object)
       │
       ▼
  Zustand Store (loadXmlFile action)
       │
       ├── Append to configurations[]
       ├── Rebuild GUIDRegistry (indexConfiguration for all configs)
       ├── Build TreeNode[] hierarchy (per config)
       └── Trigger React re-render
       │
       ▼
  UI Components
       │
       ├── ConfigExplorer ← treeNodes (filterable tree)
       ├── DesignerView   ← active config (ReactFlow graph)
       ├── PropertyInspector ← selectedNode (property grid)
       ├── SearchPanel     ← registry.search() + whereUsed()
       ├── ClickablePath   ← resolveDatasource/resolveBinding
       └── DrillDownPanel  ← resolveDeepExpression chain
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

Central index for all GUIDs found across loaded configurations:

```
GUIDEntry:
  guid            → normalized lowercase
  kind            → Solution / ModelVersion / Container / FormatElement / …
  name            → human-readable name
  configFilePath  → source file
  componentKind   → DataModel / ModelMapping / Format

CrossRefEntry:
  target          → referenced entity (table name, GUID, model path, …)
  targetType      → Table / Field / GUID / ModelPath / Enum / Class / EDT / Label / Formula
  sourceConfigPath → where the reference occurs
  sourceComponent  → component name
  sourceContext    → human-readable description
```

The `indexConfiguration()` method walks the entire typed config tree and registers all GUIDs and cross-references in a single pass.

### Type System

The type system uses TypeScript interfaces with discriminated unions for polymorphism:

- **Datasources** use a flat interface with optional type-specific sub-objects (`tableInfo`, `enumInfo`, `classInfo`, `calculatedField`, `groupByInfo`) rather than a class hierarchy — this keeps JSON-serialization trivial and avoids `instanceof`.
- **Expressions** use a discriminated union keyed by `kind` — enabling exhaustive pattern matching in consumers.
- **Format elements** use a recursive tree (`children: ERFormatElement[]`) with a `Record<string, string>` escape hatch for format-specific XML attributes.

---

## UI Architecture

### State Management

The Zustand store (`useAppStore`) is the single source of truth. Key state:

| State | Type | Description |
|---|---|---|
| `configurations` | `ERConfiguration[]` | All loaded ER configs |
| `registry` | `GUIDRegistry` | Merged GUID + cross-ref index |
| `treeNodes` | `TreeNode[]` | Tree hierarchy for the explorer |
| `selectedNodeId` / `selectedNode` | `string` / `TreeNode` | Currently selected node |
| `openTabs` / `activeTabId` | Tab array + active ID | Designer tab state |
| `searchQuery` / `searchResults` | string / any[] | Search state |

Key actions:

| Action | Purpose |
|---|---|
| `loadXmlFile(xml, path)` | Parse XML, add to configs, rebuild registry + tree |
| `selectNode(id)` | Set selection, look up TreeNode by ID |
| `resolveDatasource(expr, configIdx)` | Find datasource matching an expression segment |
| `resolveBinding(path, configIdx)` | Find model mapping binding for a model path |
| `resolveModelPath(dotPath)` | End-to-end: model path → binding → datasource |
| `whereUsed(entityName)` | Trace entity → datasource → binding → format element |

### Component Interaction

```
Toolbar ─── file open ──→ loadXmlFile ──→ store update ──→ tree + designer re-render
                                                             │
ConfigExplorer ─── click ──→ selectNode ──→ PropertyInspector re-render
                   dblclick ─→ openTab ──→ DesignerView re-render
                                             │
DesignerView ─── node click ──→ selectNode
             ─── expression click ──→ DrillDownPanel push frame
                                       │
ClickablePath ─── hover/click ──→ resolveDatasource / resolveModelPath
                                   │
SearchPanel ─── search ──→ registry.search()
            ─── where-used ──→ whereUsed() ──→ render trace cards
```

### Designer Views

Three specialized designers, all using `@xyflow/react`:

1. **ModelDesigner** — BFS-based left-to-right layout of containers as card nodes, with edges for type references between containers.
2. **MappingDesigner** — Three-column view: datasources, bindings (model paths → expressions), validations.
3. **FormatDesigner** — Hierarchical element tree with binding status badges (bound/unbound/structural) and category-grouped binding display.

### Theming

The app uses CSS custom properties for a semantic color system:

- `--surface-info-*` / `--surface-success-*` / `--surface-warning-*` / `--surface-danger-*` / `--surface-purple-*` — category tints
- `--format-type-*` — per-format-element-type accent colors
- `--accent`, `--bg-primary`, `--bg-secondary`, `--text-primary`, `--text-secondary` — base theme

Both dark and light modes are supported; theme detection is automatic via `prefers-color-scheme`.

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
