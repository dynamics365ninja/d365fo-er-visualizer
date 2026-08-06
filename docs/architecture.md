# Architecture

## Overview

pnpm monorepo — five packages with a clear dependency direction:

```
Electron shell (optional)        Next.js site (marketing + docs)
        │                                │
        │                        hosts the SPA build at /app
        │                                │
   React UI (Vite SPA)  ──────────────────
        │
   @er-visualizer/core          ← XML parser · GUID registry · type system
        │
   @er-visualizer/fno-client    ← F&O API client (host-agnostic)
```

The site depends on the UI only as a build artifact — no imports cross that boundary.

---

## Packages

### `@er-visualizer/core`

Pure TypeScript library, no UI dependencies.

- **XML parser** — `parseERConfiguration(xml, filePath)`: detects component kind, unwraps `ErFnoBundle` / bare-content / base64 payloads, resolves the correct version node, returns a fully-typed `ERConfiguration`.
- **Type system** — interfaces for every ER artifact: `ERDataModel`, `ERModelMapping`, `ERFormat`, `ERDatasource` (8 kinds), `ERBinding`, `ERFormatElement`, expression AST (`ERExprCall`, `ERExprIf`, `ERExprCase`, `ERExprBinaryOp`, …).
- **GUID registry** — `indexConfiguration()` walks every loaded config in a single pass and builds a cross-reference index: `lookup()`, `findRefsTo()`, `findRefsFrom()`, `search()`.

**Key design choices:**
- Datasources use a flat interface with optional sub-objects (`tableInfo`, `enumInfo`, `classInfo`, …) — no class hierarchy, trivial JSON serialization.
- Expressions use discriminated unions keyed by `kind` — exhaustive `switch`, no `instanceof`.
- Parsing is synchronous — ER files are < 5 MB; async would only add complexity.

### `@er-visualizer/fno-client`

Host-agnostic F&O API client. Network I/O is delegated to a `FnoTransport` so the same code runs in browser (`fetch`) and Electron (`node:https`).

- **ER services** — calls F&O custom services under `/api/services` (not OData entities): solution/configuration tree enumeration, typed downloads for Format, ModelMapping, and DataModel.
- **Path helpers** — `buildFnoPath` produces synthetic `fno://envHost/solution/config@version` URIs so live configs slot into the same workspace as on-disk XML.
- **Error hierarchy** — `FnoHttpError`, `FnoSourceUnsupportedError`, `FnoEmptyContentError` with verbose 4xx body propagation.

### `@er-visualizer/ui`

React 19 SPA (Vite 6 + Fluent UI v9).

**State:** Zustand 5 (`useAppStore`) — single source of truth.

| Key state | Description |
|---|---|
| `configurations` | All loaded `ERConfiguration` objects |
| `registry` | Merged `GUIDRegistry` across all configs |
| `treeNodes` | Explorer tree hierarchy |
| `selectedNode` | Currently selected tree node |
| `openTabs` / `activeTabId` | Designer tabs |
| `whereUsedResults` | Result of the last where-used trace |
| `showTechnicalDetails` | Technical/consultant mode (persisted) |

**Key actions:** `loadXmlFile` · `selectNode` · `resolveDatasource` · `resolveBinding` · `whereUsed` · `setFnoIngestStatus`

**F&O session** (`state/fno-session.ts`) is kept separate so browsing state (solutions, components, selection across drill levels) survives panel unmounts.

### `@er-visualizer/site`

Next.js 15 (App Router) marketing site and user documentation — the public face of the project and
the only part of the repo written for search engines.

- **Pages** — `/` (marketing), `/features`, `/docs/*`. Documentation pages are MDX with
  `remark-gfm` and `rehype-slug`; the table of contents in `lib/site.ts` drives the sidebar,
  prev/next links, page metadata, and `sitemap.xml` from one source.
- **SEO** — per-page Metadata API entries with canonical URLs, generated `sitemap.xml` and
  `robots.txt`, JSON-LD (`SoftwareApplication`, `FAQPage`, `BreadcrumbList`), and an
  `ImageResponse` Open Graph card.
- **Hosts the SPA** — `scripts/stage-app.mjs` copies `packages/ui/dist` into `public/app`, and a
  rewrite maps `/app` to its entry document. The SPA must be built with `APP_BASE=/app/`.
- **`/api/fno`** — edge route handler proxying F&O calls, since F&O sends no CORS headers. Allows
  `*.dynamics.com` over HTTPS only; streams the upstream body back without storing anything.

Styling is Tailwind 4 with CSS custom properties that flip on `prefers-color-scheme` — no theme
switcher, no client-side theme state.

### `@er-visualizer/electron`

Thin shell — `BrowserWindow` + `contextBridge`. Adds:
- Native file-open dialogs via IPC.
- Loopback MSAL flow (`@azure/msal-node` `acquireTokenInteractive`) for F&O sign-in in environments that block popup origins.

---

## Data Flow

```
ER XML (disk) or F&O API response
      │
      ▼
parseERConfiguration()           ← core
      │ typed ERConfiguration
      ▼
loadXmlFile() in Zustand store
      ├─ append to configurations[]
      ├─ rebuild GUIDRegistry
      ├─ build TreeNode[] hierarchy
      └─ trigger React re-render
            │
            ├─ ConfigExplorer    ← treeNodes
            ├─ DesignerView      ← active config (ReactFlow)
            ├─ PropertyInspector ← selectedNode
            ├─ SearchPanel       ← registry.search() + whereUsed()
            ├─ ClickablePath     ← resolveDatasource / resolveBinding
            └─ DrillDownPanel    ← resolveDeepExpression
```

---

## F&O Ingest Pipeline

`FnoConnectPanel.handleLoadSelected` runs 5 sequential phases:

| Phase | What happens |
|---|---|
| 0 — GUID discovery | Scout downloads resolve DataModel GUIDs missing from the listing API |
| 1 — DataModels | Downloaded in parallel; cross-reference GUIDs harvested for follow-up |
| 2 — Formats & Mappings | Selected non-DataModel configs downloaded; listing walk builds pending mapping branches |
| 3 — Model Mappings | `GetModelMappingByID` per DataModel GUID; batched, first-success skips siblings |
| 4 — Late DataModels | GUIDs discovered inside ModelMapping XML fetched in a final follow-up pass |

Progress is exposed via `fnoIngestStatus` (a label string in the store) and rendered as a fullscreen modal on the landing page and a compact in-tree banner in ConfigExplorer.

---

## Designer Views

All three use `@xyflow/react`:

- **ModelDesigner** — BFS left-to-right layout of containers; edges for type references.
- **MappingDesigner** — Three columns: datasources → bindings → validations.
- **FormatDesigner** — Hierarchical element tree with binding status badges and category-grouped bindings.

Non-root explorer items open a **FocusedNodeTab** — a properties-only detail view instead of the full designer.

---

## Theming

Two complementary systems:

- **Fluent UI tokens** (`tokens.*`) — all Fluent component styling; controlled via `FluentProvider`.
- **CSS custom properties** (`--accent`, `--bg-primary/secondary`, `--text-primary/secondary`, `--format-type-*`, `--surface-*-*`) — shared across custom CSS in `index.css`. Light and dark variants both defined; active mode stored in Zustand and persisted in localStorage.

---

## Build

| Package | Tool | Output |
|---|---|---|
| `core` | tsc | `dist/` `.js` + `.d.ts` |
| `fno-client` | tsc | `dist/` `.js` + `.d.ts` |
| `ui` | Vite 6 | `dist/` SPA with code-split chunks |
| `site` | Next 15 | `.next/` — prerendered pages + one edge route |
| `electron` | tsc | `dist/main.js` + `dist/preload.js` |

The web deployment is `pnpm build:web`: build the SPA with `APP_BASE=/app/`, stage it into
`packages/site/public/app`, then `next build`. Vercel's root directory is `packages/site`.

Vite aliases `@er-visualizer/core` to the core source during dev for instant HMR.

---

## Testing

- **Vitest** (`core`): XML parser round-trips for all three component kinds; GUID registry registration, lookup, and cross-reference search.
- **Vitest** (`fno-client`): ER service OData parsing, path-key building, auth scope helpers.
