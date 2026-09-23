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
        ├── @er-visualizer/core          ← XML parser · GUID registry · type system
        │
        └── @er-visualizer/fno-client    ← F&O API client (host-agnostic)

   @er-visualizer/design-tokens ← CSS tokens + theme switch shared by UI and site
```

The site depends on the UI only as a build artifact — no imports cross that boundary. The
Electron shell imports `fno-client` for types only; at runtime it talks to the renderer over IPC.

---

## Packages

### `@er-visualizer/core`

Pure TypeScript library, no UI dependencies.

- **XML parser** — `parseERConfiguration(xml, filePath)`: detects component kind, unwraps `ErFnoBundle` / bare-content / base64 payloads, resolves the correct version node, returns a fully-typed `ERConfiguration`. `parseERConfigurations` additionally splits a bundle carrying a data model next to its mapping. Non-fatal findings (unknown format element types, unrecognised datasource handlers) are kept as `Unknown`/`Container` nodes and listed in `ERConfiguration.warnings`.
- **Type system** — interfaces for every ER artifact: `ERDataModel`, `ERModelMapping`, `ERFormat`, `ERDatasource` (13 kinds plus `Unknown`), `ERBinding`, `ERFormatElement`, `ERLabel` (the solution's label dictionary), expression AST (`ERExprCall`, `ERExprIf`, `ERExprCase`, `ERExprBinaryOp`, …).
- **Format element info** — `getFormatElementDataType()` and `getFormatElementExcelRange()` (`format/element-info.ts`): the two per-element facts the UI needs everywhere, derived from the raw element attributes in one place instead of in each view.
- **GUID registry** — `indexConfiguration()` walks every loaded config in a single pass and builds a cross-reference index. The UI uses `indexConfiguration()`, `lookup()` and `search()`; `findRefsTo()`, `findRefsFrom()`, `getAllEntries()`, `register()` and `addCrossRef()` are part of the public API (covered by unit tests) but currently have no caller in the app — where-used (`state/where-used.ts`) walks the workspace trees directly.

**Key design choices:**
- Datasources use a flat interface with optional sub-objects (`tableInfo`, `enumInfo`, `classInfo`, …) — no class hierarchy, trivial JSON serialization.
- Datasources are nested by `ParentPath`. A segment the definition never declares — a data model record under `model` (`model/InvoiceLines/LineBase`), the `Values` of a calculated record list — becomes an `implicit` node instead of lifting the datasource to the root, where two same-named calculated fields could no longer be told apart. The UI's Data sources view (`utils/datasource-tree.ts`) lays the loaded data model's structure over those nodes.
- Expressions use discriminated unions keyed by `kind` — exhaustive `switch`, no `instanceof`.
- Parsing is synchronous — ER files are < 5 MB; async would only add complexity.

### `@er-visualizer/fno-client`

Host-agnostic F&O API client. Network I/O is delegated to a `FnoTransport` so the same code runs in the browser (`fetch` through the site's `/api/fno` proxy) and in Electron (IPC to the main process, which issues the request with Electron's `net.request`). Token acquisition is likewise behind an `AuthProvider` (`@azure/msal-browser` popup/redirect in the browser, `@azure/msal-node` over IPC in Electron).

- **ER services** — calls F&O custom services under `/api/services` (not OData entities): solution/configuration tree enumeration, typed downloads for Format, ModelMapping, and DataModel.
- **Path helpers** — `buildFnoPath` produces synthetic `fno://envHost/solution/config@version` URIs so live configs slot into the same workspace as on-disk XML.
- **Auth helpers** — `buildFnoScope` (`${envUrl}/.default`), `buildAuthority`, `resolveClientId`, `authContextKey`. `FnoConnection.tenantId` / `clientId` are **optional and no longer part of the UI**: a profile is a name plus an `envUrl`. Sign-in uses the host's built-in multi-tenant registration (`VITE_FNO_CLIENT_ID` in the SPA, `FNO_CLIENT_ID` / `built-in-client.ts` in Electron) on the `organizations` authority, so the tenant is whatever the signed-in account belongs to. The fields remain on the type so legacy stored profiles (and `scripts/integration-test.ts`) keep working — when present they override the built-in values.
- **Error hierarchy** — `FnoHttpError`, `FnoSourceUnsupportedError`, `FnoEmptyContentError` with verbose 4xx body propagation. `http.ts` holds the response handling both transports share (JSON parsing, the sign-in-page and upstream-redirect cases), so browser and Electron report a failure the same way.

### `@er-visualizer/ui`

React 19 SPA (Vite 6 + Fluent UI v9).

**State:** Zustand 5 (`useAppStore`, `state/store.ts`) — single source of truth. The store itself
holds state and actions; the logic behind them lives in sibling modules under `state/`, re-exported
from `store.ts` so importers keep using one path:

| Module | Responsibility |
|---|---|
| `navigation.ts` | `OpenTab` (node or drill-down tab), back/forward snapshot stacks, remapping tab and node ids after a configuration is closed |
| `persistence.ts` | Recent configurations and sessions in localStorage (metadata only), the technical-details preference |
| `tree-builder.ts` | Explorer `TreeNode` hierarchy per configuration |
| `expression-resolution.ts` | `resolveDatasource` / `resolveBinding` / `resolveModelPath` / `resolveDeepExpression` |
| `where-used.ts` | The where-used walk over the workspace trees |
| `configuration-merge.ts` · `mapping-definitions.ts` · `config-warnings.ts` | Replacing a loaded configuration by path or solution GUID (older versions are dropped), which mapping definition a format binds to, non-fatal warnings |
| `fno-profiles.ts` · `fno-session.ts` | F&O connection profiles and browsing state |

| Key state | Description |
|---|---|
| `configurations` | All loaded `ERConfiguration` objects |
| `registry` | Merged `GUIDRegistry` across all configs |
| `treeNodes` | Explorer tree hierarchy |
| `selectedNode` | Currently selected tree node |
| `openTabs` / `activeTabId` | Designer tabs; `activeTabId` is the tab shown in the left (main) group |
| `splitTabId` / `sideTabIds` / `focusedPane` | The right (side) tab group: its shown tab, its tabs, and which group has focus |
| `searchQuery` / `searchResults` | Search box text and the registry hits (ranked in the panel) |
| `whereUsedResults` / `whereUsedScope` | Result of the last where-used trace, and the all / mapping / format scope filter over it |
| `showTechnicalDetails` | Technical/consultant mode (persisted) |
| `themeMode` / `resolvedTheme` | Preference (`system` by default, persisted only when explicit) and what it resolves to |
| `navigationHistory` / `navigationForward` | Back/forward stacks behind `Alt+←` / `Alt+→` |
| `recentFiles` / `recentSessions` / `cachedPaths` | Metadata of recent configurations and sessions (localStorage) and which of them still have XML in the IndexedDB cache |
| `toasts` | Transient notifications, including the undo affordance after closing configurations or removing history entries |
| `warnings` | Non-fatal parse findings surfaced per configuration |
| `fnoIngestStatus` / `fnoIngestProgress` / `cancelFnoIngest` | Free-text phase label, the structured per-configuration download log, and the cancel handle of the running download |

**Key actions:** `loadXmlFile` · `selectNode` · `openTab` / `openDrillDownTab` · `openTabToSide` / `moveTabToPane` / `reorderTab` / `closePane` · `resolveDatasource` · `resolveBinding` · `resolveModelPath` · `whereUsed` / `executeWhereUsed` · `loadCachedFile` / `loadRecentSession` · `closeConfigurationWithUndo` / `closeAllConfigurationsWithUndo` · `addInheritedLabels` / `refreshLabelPool` · `beginFnoIngest` / `updateFnoIngestItem` / `endFnoIngest`

**Layout of `src/`:**
- `components/` — the shell (`App`, `ActivityBar`, `Toolbar`, `LandingPage` + `RecentWork`, `ConfigExplorer`, `DesignerView` + `TabBar`, `PropertyInspector`, `SearchPanel`, `DrillDownPanel`, `WorkspaceManager`); `components/designers/` — one designer per component kind plus the shared pieces (`DataModelDesigner` / `DataModelList`, `ModelMappingDesigner`, `FormatDesigner` / `FormatElementTree` / `FormatBindingsView`, `DatasourceTree`, `FormatPreview` / `ExcelPreview`); `components/fno/` — the F&O browser (profiles, solution navigator, configuration browser, `useFnoIngest`).
- `fno/` — host glue for `fno-client` (browser / Electron auth and transport, session, label harvesting) and `fno/ingest/`, the UI-independent ingest pipeline.
- `utils/` — pure helpers, most with a test next to them: search ranking and node lookup, where-used query and categories, datasource trees, label resolver, xlsx parser, content cache, keyboard handling (`workspace-shortcuts.ts`, `tree-keyboard.ts`), virtualized trees (`flat-tree.ts`, `use-virtual-tree.ts`), tab drag and split ratio.
- `i18n.ts` — every user-facing string, Czech and English side by side (see below).
- `index.css` + `styles/` — see [Styles](#styles).

**Persistence** — `utils/content-cache.ts` keeps full XML payloads in IndexedDB (`er-visualizer` /
`file-content`); localStorage is too small (~5 MB) for several F&O format exports and holds only
metadata (`recentFiles.v1`, `recentSessions.v1`), preferences and F&O connection profiles
(`state/fno-profiles.ts` — profiles carry no secrets). Nothing is sent anywhere: the cache is
local to the browser. `WorkspaceManager` is the UI over it — what is loaded (grouped by data
model), what can be re-added from the cache, and `DependencyPromptDialog` offering the related
model + mapping when a format or mapping is added back. On the landing page, `RecentWork` lists the recent
sessions and recent configurations from the same metadata (named as the explorer names them —
`utils/recent-display.ts`); closing everything keeps the last workspace as a session.

**Labels** — `utils/label-resolver.ts` turns `@GER_LABEL:…` references into text. The pool for a
configuration is its own dictionary first, then every other loaded configuration, then a process-wide
pool harvested by `fno/session.ts` from *every* F&O response — including scout, probe and ancestor
downloads that are never loaded as configurations, since only the format response ships the
dictionary. The preferred language follows the app's language switch, not the browser.

**Excel templates** — `utils/xlsx-parser.ts` unpacks the `.xlsx` template embedded in a format
(JSZip) and reads sheets, merged cells, column widths and named ranges, so the format designer's
Preview (`designers/ExcelPreview.tsx`) can render the workbook. When the export carries no template the same view accepts one
dropped in by the user.

**Theming** — the rules live in `@er-visualizer/design-tokens/theme` (re-exported by `src/theme.ts`)
next to the CSS that encodes the same precedence, and the marketing site imports the very same
module. `main.tsx` writes `data-theme` before React mounts. `components/ThemeSwitch.tsx` is the one
switch, used by both the landing page and the activity bar. See [Theming](#theming).

**Language** — `i18n.ts` defines one `Translations` interface and two dictionaries (`cs` first, then
`en`); components read `t.<key>` and re-render on `useLocale()`. The locale comes from localStorage
(`er-visualizer.locale`), else the browser language, and is switched on the landing page or in the
activity bar. The Czech UI uses formal address. An ESLint `no-restricted-syntax` rule over
`components/`, `state/`, `utils/` and `fno/` rejects `locale === 'cs' ? … : …` branches, so text
cannot bypass the dictionaries.

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
  F&O environment hosts only (`*.operations[.<region>].dynamics.com`, `*.cloudax`, `*.axcloud`,
  `*.sandbox.ax.dynamics.com`) over HTTPS, rejects foreign origins server-side, and streams the
  upstream body back without storing anything.

Styling is Tailwind 4 with CSS custom properties that flip on `prefers-color-scheme`. The header's
`ThemeSwitch` (the site's only client component) and a blocking script in the root layout both go
through `@er-visualizer/design-tokens`, so the site and the SPA render the same control and read and
write one preference — a choice made on either side holds on both, and `system` falls through to the
CSS. See [Theming](#theming).

### `@er-visualizer/electron`

Thin shell — `BrowserWindow` + `contextBridge`. Adds:
- Native file-open dialogs via IPC.
- Loopback MSAL flow for F&O sign-in in environments that block popup origins: `@azure/msal-node` `getAuthCodeUrl` (with PKCE) opens the system browser, an ephemeral `http://localhost:<port>/` listener receives the code, `acquireTokenByCode` exchanges it (5-minute timeout). Each connection remembers its own account. Tokens are cached on disk encrypted with `safeStorage`, or kept in memory only when the OS offers no encryption.
- `fno:request` IPC — validates the caller and payload and forwards GET/POST requests to F&O environment hosts only (the site proxy's allow-list plus `cloud.onebox` dev VMs); `fno:abort` cancels a request by id.
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
            ├─ DesignerView      ← open tabs, in one or two groups → per-kind designers
            ├─ PropertyInspector ← selectedNode
            ├─ SearchPanel       ← registry.search() (ranked by utils/search-relevance) + whereUsed()
            ├─ ClickablePath     ← resolveDatasource / resolveBinding
            └─ DrillDownPanel    ← resolveDeepExpression
```

---

## F&O Ingest Pipeline

**Load selected** in `FnoConnectPanel` goes through `components/fno/useFnoIngest.ts` (the React glue,
which owns the `AbortController` behind **Cancel download**) into `runFnoIngest` in `fno/ingest/` —
UI-independent, tested on its own. It runs 5 sequential phases:

| Phase | What happens |
|---|---|
| 0 — GUID discovery | Scout downloads resolve DataModel GUIDs missing from the listing API |
| 1 — DataModels | Downloaded in parallel; cross-reference GUIDs harvested for follow-up |
| 2 — Formats & Mappings | Selected non-DataModel configs downloaded; listing walk builds pending mapping branches |
| 3 — Model Mappings | `GetModelMappingByID` per DataModel GUID; batched, first-success skips siblings |
| 4 — Late DataModels | GUIDs discovered inside ModelMapping XML fetched in a final follow-up pass; then labels inherited from ancestor data models are resolved |

Progress is exposed twice: `fnoIngestStatus` (a free-text phase label, mapped back onto the five
steps by `activeIngestStep()`) and `fnoIngestProgress` (a structured per-configuration log — queued
/ downloading / done / empty / failed / skipped, with elapsed time). `FnoIngestPanel` renders both,
as a fullscreen overlay (`FnoIngestOverlay`) and a compact in-tree card in ConfigExplorer.

---

## Designer Views

`DesignerView` picks the designer by component kind:

- **Data model** (`DataModelDesigner`) — a *List* / *Graph* switch, list by default and remembered
  per browser. The list (`DataModelList`) shows the fields as a tree with type, enum and label, a
  filter over every field with its full path, a field name that opens the model-path drill-down, and
  a where-used button per field. The graph is `@xyflow/react`: BFS left-to-right layout of
  containers, edges for type references.
- **Model mapping** (`ModelMappingDesigner`) — tabs for bindings (the flat binding paths nested into
  the tree the F&O designer shows), data sources and validations. The binding tree and the datasource
  lists are virtualized (`utils/use-virtual-tree.ts`, `@tanstack/react-virtual`).
- **Format** (`FormatDesigner`) — tabs for the element structure (`FormatElementTree`), bindings
  grouped by intent (`FormatBindingsView`), data sources, a preview, and any embedded model mapping.

Clicking a formula (format structure rows, mapping bindings and validations, the Bindings view) or a
datasource name opens the drill-down dialog; double-click or `Ctrl`+click opens it as a tab. Per-row
actions such as **Reveal in Explorer** live in each row's ⋮ menu.

**Tab groups.** Like an IDE, the designer can split into a left (main) and a right (side) group,
each with its own tab strip (`TabBar.tsx`). A tab moves by dragging it onto the other strip or into
the other group's content, through the tab context menu (**Move to the left group** / **Move to the
right group** / **Open to the side**), or from the drill-down dialog's **Open to the side**; dragging
within a strip reorders. The group clicked last has focus, and tabs opened from the explorer, search
or a drill-down land there. A group closes with its last tab, and its ✕ merges its tabs into the
other. The divider is draggable (arrow keys, double-click resets; the ratio is remembered —
`utils/split-ratio.ts`); below ~720px the strips stack and only the focused group shows. The store
keeps the groups consistent in `normalizeGroups`.

Excel-based formats get a second view next to the element tree: the workbook rendered with its
original layout, merged cells and named ranges, where clicking a named cell selects the format
element bound to it. A `PDFFile` root is only a converter — the designer looks through it to the
component that actually produces the document (usually the Excel one), previews that, and marks the
result with a "converted to PDF" badge.

The **DrillDownPanel** opens as a dialog (with **Pin as tab** and **Open to the side**) or as a
drill-down tab, and has two views, remembered in localStorage: **Detail** (the value path from the
expression down to D365FO tables, enums and classes, plus the *D365FO data used* summary; clicking
a part of the expression narrows the breakdown to it) and **Tree**, which lays the whole breakdown
out as a React Flow graph. When the breakdown hits its depth or node limit, it says so.

Explorer items below a configuration's root open that configuration's designer with the item
selected; items that carry an expression open a drill-down tab.

---

## Theming

Two complementary systems:

- **Fluent UI tokens** (`tokens.*`) — all Fluent component styling; controlled via `FluentProvider`.
- **CSS custom properties** — the `--er-*` brand tokens from `@er-visualizer/design-tokens/tokens.css`, used directly by the app's CSS and inline styles. `styles/base.css` adds only a thin semantic layer on top (`--bg-primary/secondary/tertiary` and `--border-color`, which re-level inside dialogs, `--kind-*`, `--format-type-*`). Light and dark variants both defined; the active one is chosen by `data-theme` on `<html>`. Do not hard-code palette hexes.

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

### Styles

`src/index.css` imports Tailwind, the shared `tokens.css` and `theme.css`, then the app's own CSS,
split by area under `src/styles/` and imported in a fixed order — `base`, `designers`,
`ingest-where-used`, `drill-down`, `landing-explorer-dialogs`, `reset-and-polish`, `modern-ux`,
`explorer-panels`, `touch-and-refinements`. Later files still override earlier ones, so new
overrides go at the end of the last file.

---

## Build

| Package | Tool | Output |
|---|---|---|
| `core` | tsc | `dist/` `.js` + `.d.ts` |
| `fno-client` | tsc | `dist/` `.js` + `.d.ts` |
| `ui` | `tsc -b` + Vite 6 | `dist/` SPA with code-split chunks |
| `site` | Next 15 | `.next/` — prerendered pages + one edge route |
| `electron` | tsc (two tsconfigs) | `dist/main.js` (ESM) + `dist/preload.cjs` (CommonJS, sandboxed preload) |

The web deployment is `pnpm build:web`: build the SPA with `APP_BASE=/app/`, stage it into
`packages/site/public/app`, then `next build`. Vercel's root directory is `packages/site`.

Vite aliases `@er-visualizer/core` and `@er-visualizer/fno-client` to their sources for instant HMR.
Type-checking the UI and Electron still reads the libraries' emitted `.d.ts`, so build `core` and
`fno-client` before `pnpm lint` (CI does exactly that).

---

## Testing

- **Vitest** (`core`): XML parser round-trips for all three component kinds (bundles, bare content, base64 payloads, unknown element types); GUID registry registration, lookup, and cross-reference search.
- **Vitest** (`fno-client`): `/api/services` custom-service response parsing (solution/component listing, operation-name fallbacks, XML download extraction), shared HTTP response handling, path-key building, auth scope/authority helpers.
- **Vitest** (`ui`): store, tab groups and navigation, undo and session restore, the F&O ingest pipeline and browser auth, format tree filtering, drill-down expression breakdown and resolution, search ranking and node lookup, where-used, data model list, keyboard shortcuts, label reference normalisation and pool precedence, the dark-palette token copies, xlsx template parsing (skipped unless `scripts/fixtures/template.b64` exists — the integration test writes it).
- **Integration** (`pnpm test:integration`): `scripts/integration-test.ts` runs against a live F&O environment; see the README.

`pnpm test` at the root runs all three Vitest suites; `pnpm lint` runs `tsc --noEmit` in every package, plus ESLint (`--max-warnings 0`) in `ui` — the Rules of Hooks and the i18n rule above.
