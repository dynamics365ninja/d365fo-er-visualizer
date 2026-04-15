# D365FO ER Visualizer

Visual designer and analyzer for **Dynamics 365 Finance & Operations Electronic Reporting (ER)** configurations.

Load ER XML configuration exports and explore data models, model mappings, and format definitions in an interactive visual workspace — with cross-reference navigation, where-used analysis, expression drill-down, and a full property inspector.

---

## Features

| Feature | Description |
|---|---|
| **XML Parser** | Parses raw D365FO ER configuration XML bundles (data model, model mapping, format, format mapping) into strongly-typed TypeScript objects. |
| **Visual Designer** | Interactive node-graph views for each component kind — powered by React Flow (`@xyflow/react`). |
| **Config Explorer** | Tree navigator with filtering, expand/collapse all, visual type accents, and per-node property inspector. |
| **GUID Registry & Cross-References** | Every GUID in every loaded file is indexed; you can look up any GUID and see where it is referenced. |
| **Where-Used Analysis** | Enter a table, enum, class, or datasource name and trace it through datasources → model bindings → format elements. |
| **Expression Drill-Down** | Click any ER formula expression and trace it step by step from format binding through model mapping to the concrete data source. |
| **Clickable Paths** | Expressions in the property inspector are clickable — identifiers resolve to their source tree node. |
| **Search Navigation** | Search results can open the exact matching tree node directly, including GUID-owned elements such as format elements, transformations, and validation rules. |
| **Format Binding Categories** | Format bindings are automatically classified (data / visibility / formatting / property) and grouped. |
| **Multi-file Workspace** | Load multiple ER XML files at once; the registry merges cross-references across all loaded configurations. |
| **Consultant / Technical View** | Toggle between a simplified consultant-friendly view and a full technical detail view; the preference is persisted locally. |
| **Dark & Light Theme** | Full CSS-variable theme system with semantic surface/accent colors for each component type. |
| **i18n** | Czech (cs) and English (en) UI; auto-detected from OS locale. |
| **Electron Shell** | Optional native desktop app wrapping the web UI, with native file-open dialogs. |

---

## Architecture

```
d365fo-er-visualizer/
├── packages/
│   ├── core/          # Pure TypeScript library — parser, types, GUID registry
│   ├── ui/            # React + Vite SPA — visual designer, explorer, inspector
│   └── electron/      # Electron shell — native desktop wrapper
├── docs/              # Checklists and guides
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json       # Root monorepo scripts
```

### Package Overview

#### `@er-visualizer/core`

Zero-dependency (runtime: `fast-xml-parser`, `uuid`) library that provides:

- **Type system** — full TypeScript interfaces for every ER artefact:
  - `ERConfiguration`, `ERSolutionVersion`, `ERSolution`, `ERLabel`, `ERVendor`
  - Data Model: `ERDataModel`, `ERDataContainerDescriptor`, `ERDataContainerItem`
  - Model Mapping: `ERModelMapping`, `ERBinding`, `ERDatasource` (Table/Enum/Class/CalculatedField/GroupBy/…), `ERValidation`
  - Format: `ERFormat`, `ERFormatElement` (File/XMLElement/XMLAttribute/Excel/Text/PDF/Word/…), `ERFormatBinding`, `ERFormatEnumDefinition`, `ERFormatTransformation`
  - Expressions: full AST — `ERExprCall`, `ERExprIf`, `ERExprCase`, `ERExprBinaryOp`, `ERExprListOp`, `ERExprStringOp`, `ERExprDateOp`, …
- **`parseERConfiguration(xml, filePath)`** — main entry point; auto-detects component kind and returns a typed `ERConfiguration`.
- **`GUIDRegistry`** — indexes all GUIDs and cross-references across loaded files. Supports `lookup()`, `findRefsTo()`, `findRefsFrom()`, `search()`.

#### `@er-visualizer/ui`

React 19 SPA built with Vite 6 and Tailwind CSS 4:

| Component | Purpose |
|---|---|
| `App` | Shell layout — three-panel (explorer / designer / properties) with resizable panels and a visible consultant/technical mode badge. |
| `LandingPage` | Drag-and-drop / file-open entry point with hero section. |
| `Toolbar` | File open, home button, panel toggles, search. |
| `ConfigExplorer` | Tree view of loaded configurations, filterable, with expand/collapse. |
| `TabBar` | Multi-tab navigation for open designer views. |
| `DesignerView` | Routes to `ModelDesigner`, `MappingDesigner`, or `FormatDesigner` based on config kind, and renders focused detail-only tabs for non-root explorer nodes. |
| `PropertyInspector` | Context-aware property grid for any selected tree node — files, containers, fields, datasources, bindings, format elements, enums, transformations. |
| `SearchPanel` | Full-text search across the GUID registry + where-used trace mode, with direct navigation to matching nodes. |
| `ClickablePath` | Renders ER expressions with clickable identifiers that resolve and navigate. |
| `DrillDownPanel` | Step-by-step drill-down from a format binding expression to the underlying data source. |

**State management:** Zustand store (`useAppStore`) with actions for loading XML, selecting nodes, opening tabs, resolving datasources/bindings/model paths, where-used analysis, and persisting the consultant/technical detail toggle.

**Utilities:**
- `file-loading.ts` — browser FileList and Electron IPC file ingestion
- `enum-display.ts` — human-readable enum type labels (Ax / DataModel / Format)
- `format-binding-display.ts` — binding normalization, category classification, child-to-parent promotion
- `theme-colors.ts` — CSS variable maps for format element type colors and badge surfaces

#### `@er-visualizer/electron`

Minimal Electron 33 shell:

- `main.ts` — creates `BrowserWindow`, loads Vite dev server (dev) or built HTML (prod), exposes `open-file-dialog` IPC.
- `preload.ts` — `contextBridge` bridge exposing `electronAPI.openFileDialog()` to the renderer.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces |
| Language | TypeScript 5.7+ (ES2022, ESNext modules, strict) |
| Build | Vite 6 (UI), tsc (core, electron) |
| UI Framework | React 19 |
| Styling | Tailwind CSS 4 |
| Graph Visualization | @xyflow/react 12 (React Flow) |
| Tree View | react-arborist 3 |
| Editor | @monaco-editor/react 4 |
| Panels | react-resizable-panels 2 |
| State | Zustand 5 |
| XML Parsing | fast-xml-parser 4 |
| Testing | Vitest 3 |
| Desktop | Electron 33 |
| Runtime | Node.js ≥ 20 |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9

### Install

```bash
pnpm install
```

### Development (Web)

```bash
pnpm dev
```

Opens the Vite dev server at `http://localhost:5173`. Drop ER XML files onto the landing page or use the file-open button.

### Development (Electron)

```bash
pnpm dev:electron
```

Starts Vite dev server and then opens the Electron window pointing to it.

### Build

```bash
pnpm build
```

Builds all packages: `core` → TypeScript compilation, `ui` → Vite production bundle, `electron` → TypeScript compilation.

### Test

```bash
pnpm test
```

Runs Vitest unit tests in the `core` package (XML parser and GUID registry tests).

---

## Usage

1. **Export ER configurations** from D365FO as XML files (Data Model, Model Mapping, Format).
2. **Open the app** (web or Electron) and **drag & drop** the XML files onto the landing page.
3. **Explore** configurations in the left-side tree explorer.
4. **Double-click** a configuration node to open a visual designer tab.
5. **Double-click** a non-root explorer node to open a focused properties-only detail tab.
6. **Click** any node to see its properties in the right-side inspector.
7. **Drill down** into format binding expressions to trace them through model mappings to source tables.
8. **Use where-used** to find all usages of a table, enum, class, or datasource across all loaded configurations.
9. **Use search** to jump directly to the matching datasource, binding, format element, transformation, or validation rule.

### Recommended Workflows

- **Single file loaded** — explorer browsing, properties, and local search still work, but deep trace flows may stop where dependent configurations are missing.
- **Model + Model Mapping** — model path bindings, datasource resolution, and mapping-side drill-down become fully useful.
- **Model + Model Mapping + Format** — enables the full end-to-end workflow: format binding → model binding → datasource → where-used trace.
- **Consultant view** — use when walking business users through structure and relationships without GUIDs, raw XML metadata, or low-level type noise.
- **Technical view** — use for troubleshooting IDs, GUID ownership, raw datasource types, selected fields, and low-level format attributes.

---

## Project Structure — Detailed

```
packages/core/src/
├── index.ts                    # Public API re-exports
├── parser/
│   ├── xml-parser.ts           # Main XML→typed object parser
│   └── xml-parser.test.ts      # Vitest tests
├── registry/
│   ├── guid-registry.ts        # GUID indexer + cross-reference engine
│   └── guid-registry.test.ts   # Vitest tests
└── types/
    ├── index.ts                # Barrel re-export
    ├── common.ts               # Shared types (ERConfiguration, ERSolution, enums)
    ├── model.ts                # Data model types (ERDataModel, containers, items)
    ├── mapping.ts              # Model mapping types (bindings, datasources, validations)
    ├── format.ts               # Format types (elements, format bindings, enums, transformations)
    └── expressions.ts          # Expression AST (discriminated union of 15+ node types)

packages/ui/src/
├── main.tsx                    # React root
├── index.css                   # Global styles + CSS variables
├── i18n.ts                     # Czech/English translations
├── components/
│   ├── App.tsx                 # Main shell (3-panel layout)
│   ├── LandingPage.tsx         # Drop-zone + hero
│   ├── Toolbar.tsx             # File open, navigation, toggles
│   ├── TabBar.tsx              # Multi-tab bar
│   ├── ConfigExplorer.tsx      # Tree view with filtering
│   ├── DesignerView.tsx        # Model/Mapping/Format visual designers
│   ├── PropertyInspector.tsx   # Context-sensitive property grid
│   ├── SearchPanel.tsx         # Full-text search + where-used
│   ├── ClickablePath.tsx       # Clickable expression rendering
│   └── DrillDownPanel.tsx      # Expression → datasource drill-down
├── state/
│   └── store.ts                # Zustand store (state + actions)
└── utils/
    ├── file-loading.ts         # File ingestion (browser + Electron)
    ├── enum-display.ts         # Enum type display helpers
    ├── format-binding-display.ts # Binding normalization + categorization
    └── theme-colors.ts         # CSS variable maps for format types

packages/electron/src/
├── main.ts                     # Electron main process
└── preload.ts                  # Context bridge
```

---

## ER Component Kinds

The parser supports three ER component kinds, each with its own type hierarchy:

### Data Model (`ERComponentKind.DataModel`)

Defines the abstract data structure. Contains **containers** (record types, enums, roots) with typed **items** (fields). Field types: Boolean, Int64, Integer, Real, String, Date, Enum, Container, RecordList, Binary.

### Model Mapping (`ERComponentKind.ModelMapping`)

Maps abstract model paths to concrete data sources. Contains:
- **Datasources** — Table, Enum, Class, CalculatedField, GroupBy, Join, Container, UserParameter
- **Bindings** — model path → ER expression
- **Validations** — rules with condition and message expressions

### Format (`ERComponentKind.Format`)

Defines output document structure. Contains:
- **Format elements** — hierarchical tree (File, XMLElement, XMLAttribute, ExcelSheet, TextLine, PDF, …)
- **Format bindings** — element → expression, with optional property name
- **Enum definitions** — format-scoped enums
- **Transformations** — named text transformations

---

## Expression AST

ER formulas are parsed into a discrimination union AST (`ERExpression`) with node types:

| Kind | Description |
|---|---|
| `ItemValue` | Data path reference (e.g. `CompanyInfo.Name`) |
| `Constant` | Literal value (string, number, boolean, null date) |
| `If` | Conditional expression |
| `Case` | Multi-branch switch |
| `Call` | Function call (FORMAT, FILTER, WHERE, …) |
| `BinaryOp` | +, −, ×, ÷, AND, OR |
| `UnaryOp` | NOT, ABS, Negate |
| `Comparison` | =, <>, >, <, >=, <= |
| `ListOp` | IsEmpty, AllItems, Filter, Where, OrderBy, Count, FirstOrNull |
| `Format` | String formatting |
| `DateOp` | Date operations |
| `StringOp` | Mid, Len, Replace, Trim, Concatenate, Label |
| `ValidationConditions` | Validation condition list |
| `Generic` | Fallback for unrecognized XML nodes |

---

## License

[MIT](LICENSE)
