# D365FO ER Visualizer

Visual designer and analyzer for Dynamics 365 Finance & Operations **Electronic Reporting** configurations

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)

Load ER XML files from disk or connect directly to a live F&O environment — then navigate data models, model mappings, and format definitions in an interactive visual workspace.

---

## Why

ER configurations are large, deeply nested XML files. Tracing a binding from a format element back through a model mapping to a concrete D365FO table datasource requires opening multiple files and matching GUIDs by hand.

This tool parses the full ER XML bundle, merges cross-references across all loaded configurations, and presents the whole stack in an interactive visual workspace — so you can navigate format → mapping → model → datasource in seconds instead of minutes.

---

## Capabilities

| | |
|---|---|
| 📂 **XML & live ingestion** | Parse raw ER XML bundles from disk (drag-and-drop) or pull directly from a live F&O environment via MSAL + ER custom services |
| 🌳 **Visual designers** | Interactive node-graph views for DataModel, ModelMapping, and Format — powered by React Flow |
| 🔍 **Search & where-used** | Full-text search across all loaded configurations; trace any element to every format binding, model binding, or datasource that references it |
| 🧩 **Expression drill-down** | Split workbench: expression tree on the left, mapping/datasource resolution on the right — navigate through calculated fields to concrete sources |
| 🏷️ **Property inspector** | Context-aware property grid for any selected node — files, containers, fields, datasources, bindings, format elements |
| 🔗 **Clickable paths** | Identifiers in ER expressions are hyperlinks; hovering shows a tooltip card with the resolved source |
| 🌐 **F&O server browser** | Connect to a live environment, browse the ER solution hierarchy, multi-select configurations across drill levels, and ingest them in one click |
| ⌨️ **Command palette** | `Ctrl/⌘+K` jump-to-anything across configurations, tabs, and panel actions |
| 🖥️ **Electron shell** | Optional native desktop app with native file-open dialogs and loopback MSAL sign-in |
| 🌍 **Czech / English UI** | `cs` and `en` — auto-detected from OS locale |

---

## Quick Start

### Web (local)

```bash
pnpm install
pnpm dev        # Vite dev server → http://localhost:5173
```

Drag and drop one or more ER XML files onto the landing page, or click **Open files**.

### Electron (native desktop)

```bash
pnpm dev:electron   # Vite + Electron window; required for loopback MSAL sign-in
```

### Marketing site & documentation

```bash
pnpm dev:site   # Next.js dev server → http://localhost:3000
```

The public site (`/`, `/features`, `/docs/*`) lives in `packages/site`. The SPA is served by the
same deployment under `/app`.

### Build & test

```bash
pnpm build      # core → tsc, fno-client → tsc, ui → Vite bundle, electron → tsc, site → Next
pnpm build:web  # production web deploy — SPA built with base /app/, staged into the site, then Next
pnpm test       # Vitest — core XML parser + GUID registry
pnpm --filter @er-visualizer/fno-client test   # fno-client ER service + path-key tests
```

---

## F&O Live Connection

1. Switch to the **D365 F&O server** tab and click **New profile**.
2. Enter your environment URL, tenant ID, and the client ID of an Entra app registration with delegated `https://<env>.dynamics.com` permission and *"Allow public client flows" = Yes*.
3. Click **Connect** — MSAL signs you in via popup (browser) or loopback window (Electron).
4. Browse the ER solution tree, tick the configurations you want, and click **Load selected**. Ancestor DataModels are auto-included.

---

## Monorepo Layout

```
d365fo-er-visualizer/
├── packages/
│   ├── core/          # XML parser, TS types, GUID registry
│   ├── fno-client/    # Host-agnostic F&O API client — MSAL helpers, ER service calls
│   ├── ui/            # React + Vite SPA — designer, explorer, inspector, F&O panel
│   ├── site/          # Next.js marketing site + docs; hosts the SPA at /app and /api/fno
│   └── electron/      # Electron shell — native file dialogs + loopback MSAL
├── docs/              # Architecture notes
├── scripts/           # stage-app.mjs (SPA → site/public/app), integration test
├── pnpm-workspace.yaml
└── package.json
```

---

## Tech Stack

| | |
|---|---|
| Monorepo | pnpm workspaces |
| Language | TypeScript 5.7+ |
| Build | Vite 6 (UI), Next 15 (site), tsc (core / fno-client / electron) |
| UI | React 19 + Fluent UI v9 |
| Graph | React Flow (`@xyflow/react`) |
| State | Zustand 5 |
| XML | fast-xml-parser 4 |
| Auth | `@azure/msal-browser` (web) / `@azure/msal-node` (Electron) |
| Site | Next 15 (App Router) + Tailwind 4 + MDX |
| Testing | Vitest 3 |
| Deployment | Vercel — Next site, SPA under `/app`, `/api/fno` edge proxy |

---

## Deployment

One Vercel project serves everything:

| Path | Served by |
|---|---|
| `/`, `/features`, `/docs/*` | Next.js pages from `packages/site` — statically prerendered |
| `/app` | The Vite SPA, staged into `packages/site/public/app` at build time |
| `/api/fno` | Edge route handler proxying F&O calls (F&O sends no CORS headers) |

`pnpm build:web` runs the whole chain: build the SPA with `APP_BASE=/app/`, copy it into the
site's `public/app`, then `next build`.

### Vercel project settings

| Setting | Value |
|---|---|
| **Root Directory** | `packages/site` |
| **Framework preset** | Next.js (from `packages/site/vercel.json`) |
| **Build command** | `pnpm run build:all` (from `packages/site/vercel.json`) |
| `NEXT_PUBLIC_SITE_URL` | Production origin, e.g. `https://er-visualizer.example.com` — used for canonical URLs, `sitemap.xml`, and Open Graph tags |

> **Migrating an existing deployment:** the Root Directory used to be `packages/ui`. Change it to
> `packages/site` — the old `packages/ui/vercel.json` and `packages/ui/api/fno.ts` have been
> replaced by the site package and its edge route.

The proxy forwards only to `*.dynamics.com` over HTTPS and stores nothing; the target URL travels
in the `X-Fno-Target-Url` header. No environment variable is needed for it.

---

## License

[MIT](LICENSE)
