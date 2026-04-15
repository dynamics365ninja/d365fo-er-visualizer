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
- Verify format type badges keep enough contrast for XML, text, numeric, and PDF-like elements.
- Verify toolbar home button, toggles, and search buttons do not disappear into the background.

## Interaction Flows

- Load at least one Model, one Model Mapping, and one Format file.
- Open a format binding and click through to datasource drill-down.
- Run where-used for a real table such as TaxTrans, CustTable, or VendTable.
- Confirm clickable datasource navigation still lands on the expected tree node.

## Regression Focus

- Check Payment and Advanced Bank Reconciliation sample bundles first when available.
- Re-check landing page on narrow mobile width and standard desktop width.
- Watch for any badge that uses accent color on neutral background without its matching surface tint.