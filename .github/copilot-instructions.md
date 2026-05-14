# D365FO ER Visualizer — Copilot Instructions

This is a pnpm monorepo for visualizing and generating Dynamics 365 Finance & Operations Electronic Reporting (ER) configurations.

## Workspace Structure

- `packages/core/` — XML parser, GUID registry, TypeScript type definitions for all ER components
- `packages/ui/` — React + Vite SPA (ConfigExplorer, DesignerView, PropertyInspector)
- `packages/electron/` — Optional Electron shell for desktop use
- `packages/fno-client/` — F&O OData/custom-service client for live API access
- `scripts/` — PowerShell scripts for ER format generation/transformation
- `docs/architecture.md` — Full system architecture documentation

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


