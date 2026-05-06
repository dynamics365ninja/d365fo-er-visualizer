# D365FO ER Visualizer

Visual designer and analyzer for **Dynamics 365 Finance & Operations Electronic Reporting (ER)** configurations.

Load ER XML configurations either from disk or **directly from a live F&O environment** (via MSAL + ER custom services) and explore data models, model mappings, and format definitions in an interactive visual workspace — with cross-reference navigation, where-used analysis, expression drill-down, and a full property inspector.

---

## Features

| Feature | Description |
|---|---|
| **XML Parser** | Parses raw D365FO ER XML bundles (DataModel, ModelMapping, Format, FormatMapping) into strongly-typed TypeScript objects. Handles F&O custom-service payloads: synthetic `ErFnoBundle` envelopes, multi-fragment responses, and base64-wrapped XML. |
| **F&O Server Connector** | Connect to a live D365 F&O environment with MSAL (popup in browser, loopback in Electron). Browse the ER solution hierarchy, drill into derived DataModels, multi-select configurations across drill levels, and ingest them directly into the workspace. |
| **Hierarchical Solutions List** | The F&O browser left panel renders a collapsible 2-level tree — root DataModels expand to reveal derived country/region-specific models. Clicking a root auto-expands it and loads its configurations. |
| **Ingest Progress UI** | A full-screen progress card with an indeterminate progress bar and a 5-step checklist (Preparing → DataModels → Formats & Mappings → Model Mappings → Finalizing) tracks the download lifecycle. While configurations are visible in the explorer a compact in-tree banner continues tracking status. |
| **Skeleton Loading** | Solution and configuration lists show animated skeleton rows while the F&O API responds, eliminating blank-state flicker. |
| **Visual Designer** | Interactive node-graph views for each component kind, powered by React Flow (`@xyflow/react`). |
| **Config Explorer** | Tree navigator with kind chips (DataModel / ModelMapping / Format), full-text filter, sort, expand/collapse, version pills, and drag-and-drop XML ingestion. |
| **GUID Registry & Cross-References** | Every GUID in every loaded file is indexed; look up any GUID and see all references to and from it. |
| **Where-Used Analysis** | Trace a table, enum, class, or datasource through datasources → model bindings → format elements. |
| **Expression Drill-Down** | Step through any ER formula from format binding to model mapping to the concrete data source. |
| **Clickable Paths & Tooltips** | Identifiers in expressions resolve to their source tree node; hovering renders a contextual tooltip card. |
| **Search Panel** | Full-text search across the GUID registry and where-used trace mode, with direct navigation to matched elements. |
| **Command Palette** | `Ctrl/⌘+P` jump-to-anything across configurations, tabs, and panel actions. |
| **Format Binding Categories** | Bindings are automatically classified (data / visibility / formatting / property) and grouped. |
| **Multi-file Workspace** | Load multiple ER XML files at once; the registry merges cross-references across all configurations. |
| **Consultant / Technical View** | Toggle between a simplified consultant view and full technical detail; preference persists in `localStorage`. |
| **Toast Notifications & Error Boundary** | Non-blocking feedback for ingestion, network, and parse failures with an app-wide error boundary. |
| **Dark & Light Theme** | Fluent UI theme tokens with semantic surface/accent colors per component type. |
| **i18n** | Czech (`cs`) and English (`en`) UI, auto-detected from OS locale. |
| **Electron Shell** | Optional native desktop app with native file-open dialogs and loopback-flow MSAL sign-in. |

---

## Monorepo Layout

```
d365fo-er-visualizer/
├── packages/
│   ├── core/          # Pure TypeScript library — XML parser, types, GUID registry
│   ├── fno-client/    # Host-agnostic D365 F&O API client — MSAL helpers, ER service calls
│   ├── ui/            # React + Vite SPA — designer, explorer, inspector, F&O panel
│   └── electron/      # Electron shell — native desktop wrapper + loopback MSAL
├── docs/              # Architecture notes
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vercel.json        # Vercel deployment config (UI + /api/fno serverless proxy)
└── package.json       # Root monorepo scripts
```

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
| `App` | Shell — three-panel layout (explorer / designer / properties) with resizable panels and a config-chip status bar. |
| `FluentRoot` | Fluent UI provider with light/dark theme switching. |
| `ErrorBoundary` | App-wide React error boundary. |
| `LandingPage` | Drag-and-drop / file-open entry point and F&O server tab. Hosts the fullscreen ingest progress overlay. |
| `FnoConnectPanel` | Connection profile management, MSAL sign-in, hierarchical ER solution browser (collapsible 2-level tree), multi-select & ingest with ingest progress tracking. |
| `ActivityBar` | Left rail switching between explorer, search, outline, and settings panels. |
| `Toolbar` | File open, home navigation, panel toggles. |
| `ConfigExplorer` | Tree of loaded configurations grouped by kind, with filter, sort, version pills, drag-and-drop ingestion, and an ingest progress banner. |
| `TabBar` | Multi-tab navigation for open designer views. |
| `DesignerView` | Routes to `ModelDesigner`, `MappingDesigner`, or `FormatDesigner`; renders focused detail tabs for non-root nodes. |
| `PropertyInspector` | Context-aware property grid for any selected node — files, containers, fields, datasources, bindings, format elements. |
| `SearchPanel` | Full-text search across the GUID registry with where-used trace mode. |
| `CommandPalette` | `Ctrl/⌘+P` jump-to-anything. |
| `ClickablePath` | ER expressions with clickable identifiers that navigate to their source. |
| `PathTooltipCard` | Hover preview for resolved paths (datasource / model mapping / binding). |
| `DrillDownPanel` | Step-by-step drill from a format binding expression to the concrete data source. |
| `ToastHost` | Non-blocking toast notifications. |

**State management:** Zustand 5 (`useAppStore`) with actions for XML ingestion, node selection, tab management, datasource/binding resolution, where-used analysis, and toast queue. F&O connection profiles persist in `state/fno-profiles.ts` (localStorage). F&O browsing state (solutions, components, selection) persists in `state/fno-session.ts` so it survives panel unmounts.

**F&O integration layer** (`src/fno/`):

| Module | Purpose |
|---|---|
| `auth-factory.ts` | Picks `browser-auth` (MSAL popup) or `electron-auth` (IPC bridge) at runtime. |
| `browser-auth.ts` | `@azure/msal-browser` PKCE popup flow. |
| `electron-auth.ts` + `electron-bridge.ts` | IPC calls into Electron main for loopback flow. |
| `session.ts` | Caches tokens; exposes `listSolutions`, `listComponents`, `downloadConfiguration`. |
| `transport.ts` | Browser `fetch` transport; in production routes through `/api/fno` (Vercel proxy) to bypass browser CORS. |

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
# core package (XML parser, GUID registry)
pnpm test

# fno-client package (ER OData client, path-key, auth-scope helpers)
pnpm --filter @er-visualizer/fno-client test

# watch mode (core)
pnpm test:watch
```

---

## F&O Connection Quick-Start

1. Open the app and switch to the **D365 F&O server** tab.
2. Click **New profile** and fill in environment URL, tenant ID, and client ID of your Entra app registration.
3. Click **Connect** — MSAL signs you in via popup (browser) or loopback window (Electron).
4. The left panel shows root ER DataModels. Click **▶** to expand derived country/region variants.
5. Click any DataModel row to load its configurations in the right panel. Drill further with the **›** icon.
6. Tick the configurations you want, then click **Load selected**. Ancestor DataModels and cross-referenced models are auto-included.

> **Tip:** Selection persists across drill levels — queue items from multiple DataModels before loading.

---

## Deployment

The web SPA deploys to **Vercel** as a static bundle with one serverless function:

- Root `vercel.json` sets build command to `pnpm --filter @er-visualizer/ui build`, output `packages/ui/dist`.
- `packages/ui/api/fno.ts` proxies browser requests to `https://<env>.dynamics.com/api/services/…` to avoid CORS. Set the `FNO_TARGET` environment variable in Vercel to your F&O base URL.

For Electron, run `pnpm build` and package `packages/electron/dist` + `packages/ui/dist` with electron-builder or electron-forge.

---

## License

[MIT](LICENSE)
