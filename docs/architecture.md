# Architecture

## Overview

pnpm monorepo — six packages with a clear dependency direction:

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

   @er-visualizer/design-tokens ← CSS tokens + theme switch shared by UI and site
```

The site depends on the UI only as a build artifact — no imports cross that boundary. The
Electron shell imports `fno-client` for types only; at runtime it talks to the renderer over IPC.

---

## Packages

### `@er-visualizer/core`

Pure TypeScript library, no UI dependencies.

- **XML parser** — `parseERConfiguration(xml, filePath)`: detects component kind, unwraps `ErFnoBundle` / bare-content / base64 payloads, resolves the correct version node, returns a fully-typed `ERConfiguration`. `parseERConfigurations` additionally splits a bundle carrying a data model next to its mapping. Non-fatal findings (unknown format element types, unrecognised datasource handlers) are kept as `Unknown`/`Container` nodes and listed in `ERConfiguration.warnings`.
- **Type system** — interfaces for every ER artifact: `ERDataModel`, `ERModelMapping`, `ERFormat`, `ERDatasource` (8 kinds), `ERBinding`, `ERFormatElement`, `ERLabel` (the solution's label dictionary), expression AST (`ERExprCall`, `ERExprIf`, `ERExprCase`, `ERExprBinaryOp`, …).
- **Format element info** — `getFormatElementDataType()` and `getFormatElementExcelRange()` (`format/element-info.ts`): the two per-element facts the UI needs everywhere, derived from the raw element attributes in one place instead of in each view.
- **GUID registry** — `indexConfiguration()` walks every loaded config in a single pass and builds a cross-reference index. The UI uses `indexConfiguration()`, `lookup()` and `search()`; `findRefsTo()`, `findRefsFrom()`, `getAllEntries()`, `register()` and `addCrossRef()` are part of the public API (covered by unit tests) but currently have no caller in the app — the where-used feature in the store walks configurations directly.

**Key design choices:**
- Datasources use a flat interface with optional sub-objects (`tableInfo`, `enumInfo`, `classInfo`, …) — no class hierarchy, trivial JSON serialization.
- Expressions use discriminated unions keyed by `kind` — exhaustive `switch`, no `instanceof`.
- Parsing is synchronous — ER files are < 5 MB; async would only add complexity.

### `@er-visualizer/fno-client`

Host-agnostic F&O API client. Network I/O is delegated to a `FnoTransport` so the same code runs in the browser (`fetch` through the site's `/api/fno` proxy) and in Electron (IPC to the main process, which issues the request with Electron's `net.request`). Token acquisition is likewise behind an `AuthProvider` (`@azure/msal-browser` popup/redirect in the browser, `@azure/msal-node` over IPC in Electron).

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
| `whereUsedResults` / `whereUsedScope` | Result of the last where-used trace, and the all / mapping / format scope filter over it |
| `showTechnicalDetails` | Technical/consultant mode (persisted) |
| `themeMode` / `resolvedTheme` | Preference (`system` by default, persisted only when explicit) and what it resolves to |
| `navigationHistory` / `navigationForward` | Back/forward stacks behind `Alt+←` / `Alt+→` |
| `recentFiles` / `recentSessions` / `cachedPaths` | Metadata of previously loaded files and sessions (localStorage) and which of them still have XML in the IndexedDB cache |
| `toasts` | Transient notifications, including the undo affordance after closing a configuration |
| `warnings` | Non-fatal parse findings surfaced per configuration |
| `fnoIngestStatus` / `fnoIngestProgress` | Free-text phase label plus the structured per-configuration download log |

**Key actions:** `loadXmlFile` · `selectNode` · `resolveDatasource` · `resolveBinding` · `resolveModelPath` · `whereUsed` · `loadCachedFile` / `loadRecentSession` · `closeConfigurationWithUndo` · `addInheritedLabels` / `refreshLabelPool` · `beginFnoIngest` / `updateFnoIngestItem` / `endFnoIngest`

**Persistence** — `utils/content-cache.ts` keeps full XML payloads in IndexedDB (`er-visualizer` /
`file-content`); localStorage is too small (~5 MB) for several F&O format exports and holds only
metadata (`recentFiles.v1`, `recentSessions.v1`), preferences and F&O connection profiles
(`state/fno-profiles.ts` — profiles carry no secrets). Nothing is sent anywhere: the cache is
local to the browser. `WorkspaceManager` is the UI over it — what is loaded (grouped by data
model), what can be re-added from the cache, and `DependencyPromptDialog` offering the related
model + mapping when a format or mapping is added back.

**Labels** — `utils/label-resolver.ts` turns `@GER_LABEL:…` references into text. The pool for a
configuration is its own dictionary first, then every other loaded configuration, then a process-wide
pool harvested by `fno/session.ts` from *every* F&O response — including scout, probe and ancestor
downloads that are never loaded as configurations, since only the format response ships the
dictionary. The preferred language follows the app's language switch, not the browser.

**Excel templates** — `utils/xlsx-parser.ts` unpacks the `.xlsx` template embedded in a format
(JSZip) and reads sheets, merged cells, column widths and named ranges, so `DesignerView` can render
the workbook next to the element tree. When the export carries no template the same view accepts one
dropped in by the user.

**Theming** — the rules live in `@er-visualizer/design-tokens/theme` (re-exported by `src/theme.ts`)
next to the CSS that encodes the same precedence, and the marketing site imports the very same
module. `main.tsx` writes `data-theme` before React mounts. `components/ThemeSwitch.tsx` is the one
switch, used by both the landing page and the activity bar. See [Theming](#theming).

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

Styling is Tailwind 4 with CSS custom properties that flip on `prefers-color-scheme`. The header's
`ThemeSwitch` (the site's only client component) and a blocking script in the root layout both go
through `@er-visualizer/design-tokens`, so the site and the SPA render the same control and read and
write one preference — a choice made on either side holds on both, and `system` falls through to the
CSS. See [Theming](#theming).

### `@er-visualizer/electron`

Thin shell — `BrowserWindow` + `contextBridge`. Adds:
- Native file-open dialogs via IPC.
- Loopback MSAL flow for F&O sign-in in environments that block popup origins: `@azure/msal-node` `getAuthCodeUrl` opens the system browser, an ephemeral `http://localhost:<port>/` listener receives the code, `acquireTokenByCode` exchanges it (5-minute timeout). Tokens are cached on disk, encrypted with `safeStorage` when available.
- `fno:request` IPC — forwards HTTPS requests to `*.dynamics.com` hosts only (same allow-list as the site proxy).
- Packaging — `electron-builder` (`pnpm --filter @er-visualizer/electron dist`); the renderer is shipped as `extraResources/ui` from `packages/ui/dist`.

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

Progress is exposed twice: `fnoIngestStatus` (a free-text phase label, mapped back onto the five
steps by `activeIngestStep()`) and `fnoIngestProgress` (a structured per-configuration log — queued
/ downloading / done / empty / failed / skipped, with elapsed time). `FnoIngestPanel` renders both,
as a fullscreen dialog on the landing page and a compact in-tree card in ConfigExplorer.

---

## Designer Views

All three use `@xyflow/react`:

- **ModelDesigner** — BFS left-to-right layout of containers; edges for type references.
- **MappingDesigner** — Three columns: datasources → bindings → validations.
- **FormatDesigner** — Hierarchical element tree with binding status badges and category-grouped bindings.

Excel-based formats get a second view next to the element tree: the workbook rendered with its
original layout, merged cells and named ranges, where clicking a named cell selects the format
element bound to it. A `PDFFile` root is only a converter — the designer looks through it to the
component that actually produces the document (usually the Excel one), previews that, and marks the
result with a "converted to PDF" badge.

The **DrillDownPanel** has two modes, remembered in localStorage: the *workbench* (frame stack +
breadcrumb) and a *tree* view that lays the whole expression breakdown out as a React Flow graph.

Non-root explorer items open a **FocusedNodeTab** — a properties-only detail view instead of the full designer.

---

## Theming

Two complementary systems:

- **Fluent UI tokens** (`tokens.*`) — all Fluent component styling; controlled via `FluentProvider`.
- **CSS custom properties** (`--accent`, `--bg-primary/secondary`, `--text-primary/secondary`, `--format-type-*`, `--surface-*-*`) — shared across custom CSS in `index.css`. Light and dark variants both defined; the active one is chosen by `data-theme` on `<html>`.

**Which theme, and who decides.** `@er-visualizer/design-tokens` owns all of it: `tokens.css`
resolves `[data-theme]` → `prefers-color-scheme` → light in CSS, `theme.js` does the same in JS and
carries the switch's icon geometry, and `theme.css` carries its appearance. The switch cycles
**system → light → dark**; only an explicit choice is written to localStorage
(`er-visualizer.themeMode.v2`), so the default keeps following the OS and returning to `system`
clears the key rather than freezing today's OS setting.

**One switch, three places.** The site header, the SPA landing page and the activity-bar rail all
render the same `<button class="er-theme-switch">` with the same shared SVG shapes and the same
`Theme: <mode>` label (translated in the SPA, English on the site). Deliberately a plain button
rather than a Fluent one — that is what lets the SPA and the site share `theme.css` verbatim instead
of maintaining two lookalikes. Restyle it there; there is no per-surface override.

The two surfaces share one origin in the web deployment (`/` and `/app`), hence one key and one
choice. Two consequences worth knowing:

- On `localhost` they are two ports, so two origins — the shared choice does **not** carry across in
  dev. That is the dev setup, not a bug.
- Electron has its own storage and no site next to it; it just keeps its own preference.

Anything that paints before the app boots — `packages/ui/index.html`, the Electron window
background, `<meta name="theme-color">` — mirrors the same fallback with literal `--er-bg-soft`
values, because the tokens are not loaded at that point.

---

## Build

| Package | Tool | Output |
|---|---|---|
| `core` | tsc | `dist/` `.js` + `.d.ts` |
| `fno-client` | tsc | `dist/` `.js` + `.d.ts` |
| `ui` | Vite 6 | `dist/` SPA with code-split chunks |
| `site` | Next 15 | `.next/` — prerendered pages + one edge route |
| `electron` | tsc (two tsconfigs) | `dist/main.js` (ESM) + `dist/preload.cjs` (CommonJS, sandboxed preload) |

The web deployment is `pnpm build:web`: build the SPA with `APP_BASE=/app/`, stage it into
`packages/site/public/app`, then `next build`. Vercel's root directory is `packages/site`.

Vite aliases `@er-visualizer/core` to the core source during dev for instant HMR.

---

## Testing

- **Vitest** (`core`): XML parser round-trips for all three component kinds (bundles, bare content, base64 payloads, unknown element types); GUID registry registration, lookup, and cross-reference search.
- **Vitest** (`fno-client`): `/api/services` custom-service response parsing (solution/component listing, operation-name fallbacks, XML download extraction), path-key building, auth scope/authority helpers.
- **Vitest** (`ui`): store/session helpers, format tree filtering, drill-down expression breakdown and resolution, label reference normalisation and pool precedence, xlsx template parsing (skipped unless `scripts/fixtures/template.b64` exists — the integration test writes it).
- **Integration** (`pnpm test:integration`): `scripts/integration-test.ts` runs against a live F&O environment; see the README.

`pnpm test` at the root runs all three Vitest suites; `pnpm lint` runs `tsc --noEmit` in every package.
