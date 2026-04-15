# UI Visual Smoke Checklist

Use this after any UI/theme/navigation change.

## Landing Page

- Verify dark and light mode both keep hero title readable and logo card distinct from the background.
- Verify model, mapping, and format pills remain visually distinct and match card accents.
- Verify drop zone hover and dragging states are visible without washing out the text.
- Verify loaded-state success bar and error bar remain readable in both themes.

## Designer And Search

- Verify mapping rows keep clear separation between model path and expression on hover.
- Verify where-used cards keep readable headers, section titles, badges, and empty states in dark mode.
- Verify where-used results also work for datasource names such as calculated fields or grouped datasources, not only tables.
- Verify format type badges keep enough contrast for XML, text, numeric, and PDF-like elements.
- Verify toolbar home button, consultant/technical toggle, mode badge, and search buttons do not disappear into the background.
- Verify search result cards keep the `Explorer` action visible and aligned even for long file paths.

## Interaction Flows

- Load at least one Model, one Model Mapping, and one Format file.
- Open a format binding and click through to datasource drill-down.
- Run where-used for a real table such as TaxTrans, CustTable, or VendTable.
- Run where-used for a datasource name such as a calculated field or GroupBy datasource when available.
- Confirm clickable datasource navigation still lands on the expected tree node.
- Run a free-text search and confirm the result action opens the exact matching node, including GUID-backed items such as format elements, transformations, or validations.
- Double-click a non-root explorer node and confirm the center pane opens only the properties detail without the full designer underneath.
- Toggle consultant mode and technical mode and confirm both the toolbar badge and the visible metadata in explorer/designer/property panes update consistently.

## Regression Focus

- Check Payment and Advanced Bank Reconciliation sample bundles first when available.
- Re-check landing page on narrow mobile width and standard desktop width.
- Watch for any badge that uses accent color on neutral background without its matching surface tint.
- Re-check persisted consultant/technical mode after reload to confirm the chosen detail level is restored.