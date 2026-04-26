# D365FO ER Visualizer

Visual designer and analyzer for **Dynamics 365 Finance & Operations Electronic Reporting (ER)** configurations.

Load ER XML configurations either from disk or **directly from a live F&O environment** (via MSAL + ER custom services) and explore data models, model mappings, and format definitions in an interactive visual workspace — with cross-reference navigation, where-used analysis, expression drill-down, and a full property inspector.

---

## Features

| Feature | Description |
|---|---|
| **XML Parser** | Parses raw D365FO ER configuration XML bundles (data model, model mapping, format, format mapping) into strongly-typed TypeScript objects. Tolerates F&O custom-service payloads (synthetic `ErFnoBundle` envelope, multi-fragment responses, base64-wrapped XML). |
| **F&O Server Connector** | Connect to a live D365 F&O environment with **MSAL** (popup in browser, loopback in Electron). Browse ER solutions, drill the configuration hierarchy, multi-select components across drill levels, and ingest them straight into the workspace. |
| **Visual Designer** | Interactive node-graph views for each component kind — powered by React Flow (`@xyflow/react`). |
| **Config Explorer** | Tree navigator with kind chips (DataModel / ModelMapping / Format), full-text filter, expand/collapse, version pills, drag-and-drop XML ingestion. |
| **GUID Registry & Cross-References** | Every GUID in every loaded file is indexed; you can look up any GUID and see where it is referenced. |
| **Where-Used Analysis** | Trace a table, enum, class, or datasource through datasources → model bindings → format elements. |
| **Expression Drill-Down** | Click any ER formula expression and trace it step by step from format binding through model mapping to the concrete data source. |
| **Clickable Paths & Path Tooltips** | Identifiers in expressions resolve to their source tree node; hovering renders a contextual tooltip card. |
| **Search Panel** | Full-text search across the GUID registry + where-used trace mode, with direct navigation to GUID-owned elements (format elements, transformations, validation rules, …). |
| **Command Palette** | `Ctrl/⌘+P` jump-to-anything across configurations, tabs, and panel actions. |
| **Format Binding Categories** | Format bindings are automatically classified (data / visibility / formatting / property) and grouped. |
| **Multi-file Workspace** | Load multiple ER XML files at once; the registry merges cross-references across all loaded configurations. |
| **Consultant / Technical View** | Toggle between a simplified consultant-friendly view and a full technical detail view; the preference is persisted locally. |
| **Toast notifications & Error Boundary** | Non-blocking feedback for ingestion / network / parse failures with an app-wide error boundary. |
| **Dark & Light Theme** | Fluent UI theme tokens with semantic surface/accent colors per component type. |
| **i18n** | Czech (cs) and English (en) UI; auto-detected from OS locale. |
| **Electron Shell** | Optional native desktop app wrapping the web UI, with native file-open dialogs and loopback-flow MSAL sign-in. |

---

## Architecture

```
d365fo-er-visualizer/
├── packages/
│   ├── core/          # Pure TypeScript library — XML parser, types, GUID registry
│   ├── fno-client/    # Host-agnostic D365 F&O connector — MSAL types, ER service client
│   ├── ui/            # React + Vite SPA — visual designer, explorer, inspector, F&O panel
│   └── electron/      # Electron shell — native desktop wrapper + loopback MSAL
├── docs/              # Architecture notes, smoke-test checklists
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vercel.json        # Vercel deployment manifest (UI + serverless F&O proxy)
└── package.json       # Root monorepo scripts
```

### Package Overview

#### `@er-visualizer/core`

Library (runtime deps: `fast-xml-parser`, `uuid`) that provides:

- **Type system** — full TypeScript interfaces for every ER artefact:
  - `ERConfiguration`, `ERSolutionVersion`, `ERSolution`, `ERLabel`, `ERVendor`
  - Data Model: `ERDataModel`, `ERDataContainerDescriptor`, `ERDataContainerItem`
  - Model Mapping: `ERModelMapping`, `ERBinding`, `ERDatasource` (Table / Enum / Class / CalculatedField / GroupBy / Join / Container / UserParameter), `ERValidation`
  - Format: `ERFormat`, `ERFormatElement` (File / XMLElement / XMLAttribute / XMLSequence / Excel / Text / PDF / Word / …), `ERFormatBinding`, `ERFormatEnumDefinition`, `ERFormatTransformation`
  - Expressions: full AST — `ERExprCall`, `ERExprIf`, `ERExprCase`, `ERExprBinaryOp`, `ERExprListOp`, `ERExprStringOp`, `ERExprDateOp`, …
- **`parseERConfiguration(xml, filePath)`** — main entry point; auto-detects component kind, unwraps F&O `ErFnoBundle` / bare-content payloads, and returns a typed `ERConfiguration`.
- **`GUIDRegistry`** — indexes all GUIDs and cross-references across loaded files. Supports `lookup()`, `findRefsTo()`, `findRefsFrom()`, `search()`.

#### `@er-visualizer/fno-client`

Host-agnostic F&O client. Network I/O is delegated to a `FnoTransport`, so the same code runs in the browser (`fetch`) and Electron main process (Node `https`).

- **Types** — `FnoConnection`, `FnoTransport`, `ErSolutionSummary`, `ErConfigSummary`, `ErConfigDownload`, `ErComponentType`; rich error hierarchy (`FnoHttpError`, `FnoSourceUnsupportedError`, `FnoEmptyContentError`).
- **Auth helpers** — token shape and scope helpers (the actual MSAL flow lives in the UI / Electron host).
- **ER services client** (`odata.ts`) — talks to F&O custom services under `/api/services` (not OData entities, which are not exposed on every F&O version):
  - `ERConfigurationListService.getFormatSolutionsSubHierarchy` — solution / configuration tree enumeration
  - `ERConfigurationStorageService.{GetEffectiveFormatMappingByID, GetModelMappingByID, GetDataModelByIDAndRevision}` — typed downloads
  - Service / operation discovery, candidate-name fallback, and verbose 4xx body propagation for actionable error messages.
- **Path helpers** — `buildFnoPath` produces stable synthetic file paths (`fno://envHost/solution/config@version`) so server-loaded configs slot into the same multi-file workspace as on-disk XML.
- **Tests** — Vitest suite covering OData parsing, path key building, auth scope handling.

#### `@er-visualizer/ui`

React 19 SPA built with **Vite 6** and **Fluent UI** (`@fluentui/react-components`).

| Component | Purpose |
|---|---|
| `App` | Shell layout — three-panel (explorer / designer / properties) with resizable panels and a status bar carrying loaded-config chips with version. |
| `FluentRoot` | Fluent UI provider with light/dark theme switching. |
| `ErrorBoundary` | App-wide React error boundary. |
| `LandingPage` | Drag-and-drop / file-open entry point and **F&O server** tab. |
| `FnoConnectPanel` | Manage F&O connection profiles, MSAL sign-in, browse ER solutions, drill the hierarchy, multi-select & ingest configurations. |
| `ActivityBar` | Left rail switching between explorer / search / outline / settings. |
| `Toolbar` | File open, home, panel toggles. |
| `ConfigExplorer` | Tree of loaded configurations grouped by kind (DataModel / ModelMapping / Format), filterable, with version pills and expand/collapse. |
| `TabBar` | Multi-tab navigation for open designer views. |
| `DesignerView` | Routes to `ModelDesigner`, `MappingDesigner`, or `FormatDesigner` and renders focused detail-only tabs for non-root explorer nodes. |
| `PropertyInspector` | Context-aware property grid for any selected node — files, containers, fields, datasources, bindings, format elements, enums, transformations. |
| `SearchPanel` | Full-text search across the GUID registry + where-used trace mode. |
| `CommandPalette` | `Ctrl/⌘+P` jump-to-anything. |
| `ClickablePath` | Renders ER expressions with clickable identifiers that resolve and navigate. |
| `PathTooltipCard` | Hover preview for resolved paths (datasource / model mapping / binding). |
| `DrillDownPanel` | Step-by-step drill-down from a format binding expression to the underlying data source. |
| `ToastHost` | Non-blocking notifications. |

**State management:** Zustand store (`useAppStore`) with actions for loading XML, selecting nodes, opening tabs, resolving datasources / bindings / model paths, where-used analysis, toast queue, and persisting the consultant/technical detail toggle. F&O profiles persist separately in `state/fno-profiles.ts`.

**F&O integration (UI side):** `src/fno/`
- `auth-factory.ts` — picks `browser-auth` (MSAL popup) or `electron-auth` (IPC bridge) at runtime.
- `browser-auth.ts` — `@azure/msal-browser` PKCE popup flow.
- `electron-auth.ts` + `electron-bridge.ts` — IPC into Electron main for loopback flow.
- `session.ts` — caches tokens, exposes `listSolutions / listComponents / downloadConfiguration`.
- `transport.ts` — browser `fetch` transport; in production deployments calls go through `/api/fno` (a small Vercel serverless proxy in `packages/ui/api/fno.ts`) to dodge browser CORS on F&O service endpoints.

**Utilities:** `src/utils/`
- `file-loading.ts` — browser FileList / drag-drop / Electron IPC ingestion
- `content-cache.ts` — in-memory cache for resolved labels and content lookups
- `label-resolver.ts` — `@LabelId` and label-table lookup
- `enum-display.ts` — human-readable enum type labels (Ax / DataModel / Format)
- `format-binding-display.ts` — binding normalization, category classification, child-to-parent promotion
- `theme-colors.ts` — Fluent token maps for format element type colors and badge surfaces

#### `@er-visualizer/electron`

Electron 33 shell that adds a native loopback MSAL flow:

- `src/main.ts` — creates `BrowserWindow`, loads Vite dev server (dev) or built HTML (prod), wires file-open dialogs.
- `src/preload.ts` — `contextBridge` exposing `electronAPI` to the renderer.
- `src/fno/ipc.ts` — `@azure/msal-node` PublicClientApplication with the loopback `acquireTokenInteractive` flow. Exposes `fno:auth:login`, `fno:auth:logout`, `fno:auth:getToken` IPC channels consumed by the UI's `electron-auth`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces |
| Language | TypeScript 5.7+ (ES2022, ESNext modules, strict) |
| Build | Vite 6 (UI), tsc (core / fno-client / electron) |
| UI Framework | React 19 |
| UI Components | Fluent UI v9 (`@fluentui/react-components` + `@fluentui/react-icons`) |
| Styling | Fluent tokens + Tailwind 4 (utility classes) |
| Graph Visualization | @xyflow/react 12 (React Flow) |
| Tree View | react-arborist 3 |
| Panels | react-resizable-panels 2 |
| State | Zustand 5 |
| XML Parsing | fast-xml-parser 4 |
| Auth | `@azure/msal-browser` (web) / `@azure/msal-node` (Electron) |
| Testing | Vitest 3 (`core` + `fno-client`) |
| Desktop | Electron 33 |
| Deployment | Vercel (UI + `/api/fno` serverless proxy) |
| Runtime | Node.js ≥ 20 |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9
- For F&O server connections: a Microsoft Entra **app registration** in your tenant with delegated permission on `https://<env>.dynamics.com` and **"Allow public client flows" = Yes**, redirect URI `http://localhost` (Electron loopback) or your origin (browser popup).

### Install

```bash
pnpm install
```

### Development (Web)

```bash
pnpm dev
```

Opens the Vite dev server at `http://localhost:5173`.

### Development (Electron)

```bash
pnpm dev:electron
```

Starts the Vite dev server and opens an Electron window pointing to it. Required for loopback MSAL sign-in to F&O environments that block popup origins.

### Build

```bash
pnpm build
```

Builds all packages: `core` → tsc, `fno-client` → tsc, `ui` → Vite production bundle, `electron` → tsc (main + preload).

### Test

```bash
pnpm test
```

Runs Vitest unit tests in `core` and `fno-client` (XML parser, GUID registry, ER OData client, path-key, auth-scope tests).

```bash
pnpm test:watch   # watch mode
```

---

## Usage

### Loading from disk

1. **Export ER configurations** from D365FO as XML files (Data Model, Model Mapping, Format).
2. **Open the app** (web or Electron) and **drag & drop** the XML files onto the landing page or the Config Explorer.
3. **Explore** configurations in the left-side tree, grouped by kind.
4. **Click** a configuration row to open the visual designer; **double-click** any deeper node for a focused detail tab.
5. **Click** any node to see its properties in the right-side inspector.

### Loading from a live F&O environment

1. Open the **D365 F&O server** tab on the landing page.
2. **Add a connection profile** — display name, environment URL (`https://<org>.<region>.dynamics.com`), tenant id, client id of your Entra app registration.
3. **Connect** — sign in via MSAL popup (web) or loopback (Electron).
4. Browse the **solutions** column, click a solution to list its configurations, **drill down** by clicking rows that have children.
5. **Multi-select** Formats / Mappings / DataModels across drill levels using the checkboxes (rows without a downloadable GUID are disabled — drill into them instead).
6. Click **Load selected** — the client downloads each configuration via the typed ER storage operations, auto-includes ancestor DataModels and any cross-referenced models, and ingests them into the workspace.

### Cross-cutting workflows

- **Drill down** into format binding expressions to trace them through model mappings to source tables.
- **Where-used** finds all usages of a table, enum, class, or datasource across all loaded configurations.
- **Search** jumps directly to the matching datasource, binding, format element, transformation, or validation rule.
- **Command palette** (`Ctrl/⌘+P`) for fast navigation across configurations, tabs, and actions.

### Recommended workflows

- **Single file loaded** — explorer browsing, properties, and local search work, but deep trace flows stop where dependent configurations are missing.
- **Model + Model Mapping** — model path bindings, datasource resolution, and mapping-side drill-down become fully useful.
- **Model + Model Mapping + Format** — enables the full end-to-end workflow: format binding → model binding → datasource → where-used trace.
- **F&O direct load** — recommended over manual XML export when iterating against a live environment; auto-resolves derived models and ancestor chains.
- **Consultant view** — walking business users through structure and relationships without GUIDs, raw XML metadata, or low-level type noise.
- **Technical view** — troubleshooting IDs, GUID ownership, raw datasource types, selected fields, and low-level format attributes.

---

## Project Structure — Detailed

```
packages/core/src/
├── index.ts                    # Public API re-exports
├── parser/
│   ├── xml-parser.ts           # Main XML→typed object parser (incl. ErFnoBundle unwrap)
│   └── xml-parser.test.ts
├── registry/
│   ├── guid-registry.ts        # GUID indexer + cross-reference engine
│   └── guid-registry.test.ts
└── types/
    ├── index.ts                # Barrel re-export
    ├── common.ts               # ERConfiguration, ERSolution, ERComponentKind, ERDirection
    ├── model.ts                # Data model types
    ├── mapping.ts              # Model mapping types
    ├── format.ts               # Format types
    └── expressions.ts          # Expression AST

packages/fno-client/src/
├── index.ts                    # Public API
├── types.ts                    # FnoConnection, FnoTransport, summaries, error classes
├── auth.ts                     # Scope / token helpers   (+ auth.test.ts)
├── odata.ts                    # ER custom-service client (+ odata.test.ts)
└── path-key.ts                 # Synthetic fno:// path builder (+ path-key.test.ts)

packages/ui/src/
├── main.tsx                    # React root
├── index.css                   # Global styles
├── i18n.ts                     # Czech / English translations
├── components/
│   ├── App.tsx                 # Shell + status bar
│   ├── FluentRoot.tsx          # Fluent provider + theming
│   ├── ErrorBoundary.tsx
│   ├── LandingPage.tsx         # Drop-zone + F&O tab
│   ├── FnoConnectPanel.tsx     # F&O profiles, sign-in, browse, ingest
│   ├── ActivityBar.tsx
│   ├── Toolbar.tsx
│   ├── TabBar.tsx
│   ├── ConfigExplorer.tsx      # Grouped tree with kind chips
│   ├── DesignerView.tsx        # Model / Mapping / Format designers
│   ├── PropertyInspector.tsx
│   ├── SearchPanel.tsx
│   ├── CommandPalette.tsx
│   ├── ClickablePath.tsx
│   ├── PathTooltipCard.tsx
│   ├── DrillDownPanel.tsx
│   └── ToastHost.tsx
├── fno/
│   ├── auth-factory.ts         # Picks browser vs electron auth at runtime
│   ├── browser-auth.ts         # @azure/msal-browser popup flow
│   ├── electron-auth.ts        # Calls into Electron main via preload
│   ├── electron-bridge.ts      # Type-safe wrapper around window.electronAPI
│   ├── session.ts              # Token cache + listSolutions/listComponents/download
│   └── transport.ts            # fetch transport (direct or via /api/fno proxy)
├── state/
│   ├── store.ts                # Zustand store (state + actions)
│   └── fno-profiles.ts         # Persisted F&O connection profiles
└── utils/
    ├── file-loading.ts
    ├── content-cache.ts
    ├── label-resolver.ts
    ├── enum-display.ts
    ├── format-binding-display.ts
    └── theme-colors.ts

packages/ui/api/
└── fno.ts                      # Vercel serverless proxy for /api/fno

packages/electron/src/
├── main.ts                     # Electron main process
├── preload.ts                  # Context bridge (file dialog + fno auth IPC)
└── fno/
    └── ipc.ts                  # @azure/msal-node loopback flow handlers
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

ER formulas are parsed into a discriminated-union AST (`ERExpression`) with node types:

| Kind | Description |
|---|---|
| `ItemValue` | Data path reference (e.g. `CompanyInfo.Name`) |
| `Constant` | Literal value (string, number, boolean, null, date) |
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

## Deployment

The UI deploys to **Vercel** as a static SPA with one serverless function:

- `vercel.json` configures `pnpm install` + `pnpm --filter @er-visualizer/ui build`, output `packages/ui/dist`.
- `packages/ui/api/fno.ts` is a small proxy that forwards browser requests to `https://<env>.dynamics.com/api/services/...` so the SPA can talk to F&O without hitting CORS.

For Electron desktop builds, run `pnpm build` and ship the resulting `packages/electron/dist` + `packages/ui/dist` with your packager of choice (electron-builder, electron-forge, …).

---

## License

[MIT](LICENSE)
