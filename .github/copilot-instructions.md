# D365FO ER Visualizer — Copilot Instructions

This is a pnpm monorepo for visualizing and generating Dynamics 365 Finance & Operations Electronic Reporting (ER) configurations.

## Workspace Structure

- `packages/core/` — XML parser, GUID registry, TypeScript type definitions for all ER components
- `packages/ui/` — React + Vite SPA with Fluent UI v9 (ConfigExplorer, DesignerView with left/right tab groups, PropertyInspector, SearchPanel, DrillDownPanel); Zustand store in `src/state/` (`store.ts` plus `navigation.ts`, `persistence.ts`, …), designers in `src/components/designers/`, F&O ingest pipeline in `src/fno/ingest/`
- `packages/fno-client/` — F&O client for the ER custom services under `/api/services` (not OData entities)
- `packages/site/` — Next.js marketing site + user documentation; hosts the SPA at `/app` and the `/api/fno` edge proxy
- `packages/design-tokens/` — CSS tokens and the theme switch shared by the SPA and the site
- `packages/electron/` — Optional Electron shell for desktop use
- `scripts/` — `stage-app.mjs` (stages the SPA into the site) and `integration-test.ts` (live F&O integration test)
- `docs/architecture.md` — Full system architecture documentation

## UI Code Conventions

- User-facing text lives in `packages/ui/src/i18n.ts` — one `Translations` interface, Czech and English dictionaries side by side; use `t.<key>`. ESLint (`no-restricted-syntax`) rejects `locale === 'cs' ? … : …` branches. The Czech UI uses formal address.
- Colours come from the `--er-*` tokens of `packages/design-tokens/tokens.css` — no palette hexes. App CSS is split by area under `packages/ui/src/styles/`, imported in order by `src/index.css`; later files override earlier ones, so new overrides go at the end of the last file.
- Icons are `@fluentui/react-icons`, not emoji.
- `pnpm lint` = `tsc --noEmit` everywhere plus ESLint in `ui` with zero warnings; build `core` and `fno-client` first. `pnpm test` runs the Vitest suites of `core`, `fno-client` and `ui`.

## ER Configuration XML Structure

ER configurations are XML files with root element `<ERSolutionVersion>` containing:
- `Solution > ERSolution` — metadata (name, GUID, base reference, vendor, labels)
- `Contents.` — one or more version nodes:
  - `ERFormatVersion` — format tree (XML/text/Excel element hierarchy)
  - `ERModelMappingVersion` — model mapping (datasources, bindings, expressions)
  - `ERFormatMappingVersion` — format-to-model binding bridge
  - `ERDataModelVersion` — data model (containers, items, enums)

## Key Conventions

- GUIDs use `{UPPERCASE-WITH-BRACES}` format in XML attributes (`ID.=`)
- Dot notation in expressions: `parent.Data.child.Data.leaf` (`.Data.` only for optional elements with Multiplicity != "1")
- Slash notation in ItemPath: `parent/Data/child/Data/leaf`
- Element `Multiplicity` values: `"1"` = required (no `.Data.`), `"10"` = optional 0..1 (uses `.Data.`), `"20"` = list 0..N, `"200"` = list 0..N
- `Contents.` (with dot) wraps child elements in the format tree
- Derived configurations use `Base="{parentGUID},version"` attribute


