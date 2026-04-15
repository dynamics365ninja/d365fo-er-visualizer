// ─── Internationalisation ───────────────────────────────────────────────────
// Detects OS/browser locale and returns the correct translation dict.
// Supported: cs (Czech), en (English, default)

export type Locale = 'cs' | 'en';

function detectLocale(): Locale {
  const lang =
    (typeof navigator !== 'undefined' ? navigator.language : undefined) ?? 'en';
  return lang.toLowerCase().startsWith('cs') ? 'cs' : 'en';
}

export const locale: Locale = detectLocale();

// ─── Translations type ────────────────────────────────────────────────────

export interface Translations {
  // App shell
  appName: string;
  appSubtitle: string;
  home: string;
  loadXml: string;
  searchPlaceholder: string;
  search: string;
  whereUsed: string;
  whereUsedPlaceholder: string;
  whereUsedLabel: string;
  find: string;
  hideExplorer: string;
  showExplorer: string;
  hideProperties: string;
  showProperties: string;
  explorer: string;
  properties: string;
  configurations: string;
  noResults: string;
  noResultsFor: (q: string) => string;
  found: (n: number) => string;
  examples: string;
  // Designer
  openInExplorer: string;
  collapse: string;
  expand: string;
  filter: string;
  structure: string;
  bindings: string;
  dataSources: string;
  elements: string;
  bound: string;
  unbound: string;
  structural: string;
  statsTooltip: (b: number, u: number, s: number) => string;
  transforms: string;
  clearFilter: string;
  clearSearch: string;
  clearWhereUsedSearch: string;
  noConfigurationsLoaded: string;
  loadXmlHint: string;
  focusedDetail: string;
  node: string;
  elementType: string;
  datasourceType: string;
  path: string;
  expression: string;
  explorerFilterPlaceholder: string;
  detailOverview: string;
  attributes: string;
  drillSteps: (n: number) => string;
  back: string;
  openInExplorerAction: string;
  explorerActionShort: string;
  noSelection: string;
  selectElementHint: string;
  viewLabel: string;
  compactDensity: string;
  comfortableDensity: string;
  // Drill-down panel
  drillDown: string;
  drillLabelFormat: string;
  drillLabelMapping: string;
  drillLabelDatasource: string;
  drillLabelTable: string;
  drillLabelEnum: string;
  drillLabelClass: string;
  drillLabelCalcField: string;
  drillLabelFormula: string;
  drillLabelChildren: string;
  drillLabelExpression: string;
  drillUnbound: string;
  drillNoModelMapping: string;
  drillPathNotFound: (p: string) => string;
  drillClickToTrace: string;
  drillActualPaths: string;
  drillMore: (n: number) => string;
  drillCurrentRecord: string;
  drillComplexExpr: string;
  drillCompoundExpr: string;
  drillInteractiveExpr: string;
  drillConstant: string;
  drillDsNotFound: (name: string) => string;
  // Results / counts
  searchResultCount: (n: number) => string;
  propChildren: string;
  // Property inspector
  propId: string;
  propType: string;
  propName: string;
  propEncoding: string;
  propMaxLen: string;
  propValue: string;
  propTransform: string;
  propExcluded: string;
  propYes: string;
  // Status bar
  statusConfigs: (n: number) => string;
  // Landing page
  landingBadge: string;
  landingTitle: string;
  landingSub: string;
  landingDropPrimary: string;
  landingDropSecondary: string;
  landingLoaded: (n: number) => string;
  landingOpen: string;
  landingErrors: string;
  landingDismiss: string;
  landingHowTitle: string;
  landingStep1Title: string;
  landingStep1Desc: string;
  landingStep2Title: string;
  landingStep2Desc: string;
  landingStep3Title: string;
  landingStep3Desc: string;
  landingStep4Title: string;
  landingStep4Desc: string;
}

// ─── Translation dictionaries ─────────────────────────────────────────────

const cs: Translations = {
  // App shell
  appName: 'ER Visualizer',
  appSubtitle: 'D365 FO · Electronic Reporting',
  home: 'Domů',
  loadXml: 'Načíst XML',
  searchPlaceholder: 'Název tabulky, pole, cesty…',
  search: 'Hledat',
  whereUsed: 'Where used',
  whereUsedPlaceholder: 'např. TaxTrans, CustTable…',
  whereUsedLabel: 'Zadej název tabulky, výčtu nebo třídy:',
  find: 'Najít',
  hideExplorer: 'Skrýt Explorer',
  showExplorer: 'Zobrazit Explorer',
  hideProperties: 'Skrýt Vlastnosti',
  showProperties: 'Zobrazit Vlastnosti',
  explorer: 'Explorer',
  properties: 'Vlastnosti',
  configurations: 'Konfigurace',
  noResults: 'Nic nenalezeno.',
  noResultsFor: (q: string) => `Nic nenalezeno pro „${q}".`,
  found: (n: number) => `Nalezeno ${n} výskyt${n === 1 ? '' : n < 5 ? 'y' : 'ů'}`,
  examples: 'Příklady:',

  // Designer
  openInExplorer: 'Dvojklikem na prvek v Exploreru otevřeš vizualizaci.',
  collapse: 'Sbalit vše',
  expand: 'Rozbalit vše',
  filter: 'Filtrovat…',
  structure: 'Struktura',
  bindings: 'Binding',
  dataSources: 'Datové zdroje',
  elements: 'prvků',
  bound: 'vázaných',
  unbound: 'nevázaných',
  structural: 'strukturních',
  statsTooltip: (b: number, u: number, s: number) => `${b} vázaných + ${u} nevázaných + ${s} strukturních`,
  transforms: 'transformací',
  clearFilter: 'Vymazat filtr',
  clearSearch: 'Vymazat hledání',
  clearWhereUsedSearch: 'Vymazat where-used hledání',
  noConfigurationsLoaded: 'Nejsou načtené žádné konfigurace.',
  loadXmlHint: 'Klikni na Načíst XML pro import ER konfiguračních souborů.',
  focusedDetail: 'Detail výběru',
  node: 'Uzel',
  elementType: 'Typ prvku',
  datasourceType: 'Typ datového zdroje',
  path: 'Cesta',
  expression: 'Výraz',
  explorerFilterPlaceholder: 'Filtrovat explorer…',
  detailOverview: 'Přehled výběru',
  attributes: 'Atributy',
  drillSteps: (n: number) => `${n} krok${n === 1 ? '' : n < 5 ? 'y' : 'ů'}`,
  back: 'Zpět',
  openInExplorerAction: 'Otevřít v Exploreru',
  explorerActionShort: 'Explorer',
  noSelection: 'Není vybraný žádný prvek.',
  selectElementHint: 'Vyber v exploreru nebo v návrháři uzel, jehož vlastnosti chceš zobrazit.',
  viewLabel: 'Pohled',
  compactDensity: 'Kompaktní',
  comfortableDensity: 'Pohodlný',

  // Drill-down panel
  drillDown: 'Drill-down',
  drillLabelFormat: 'Formát',
  drillLabelMapping: 'Mapování',
  drillLabelDatasource: 'Datový zdroj',
  drillLabelTable: 'Tabulka',
  drillLabelEnum: 'Výčet',
  drillLabelClass: 'Třída',
  drillLabelCalcField: 'Kalkulované pole',
  drillLabelFormula: 'Vzorec',
  drillLabelChildren: 'Potomci',
  drillLabelExpression: 'Výraz',
  drillUnbound: 'Bez bindingu — žádný výraz přiřazen.',
  drillNoModelMapping: 'Odkaz na model. Pro drill-down načti soubor ModelMapping (.xml).',
  drillPathNotFound: (p: string) => `Cesta „${p}" nebyla nalezena v ModelMapping.`,
  drillClickToTrace: 'Klikni na výraz pro další rozbalení →',
  drillActualPaths: 'Binding paths v ModelMapping',
  drillMore: (n: number) => `… a ${n} dalších`,
  drillCurrentRecord: 'Odkaz na aktuální záznam smyčky (@). Zdrojový datový zdroj je definován nadřazeným prvkem ve struktuře formátu.',
  drillComplexExpr: 'Složená ER funkce — výraz nelze jednoduše trasovat na jeden datový zdroj.',
  drillCompoundExpr: 'Porovnávací výraz — obsahuje více model odkazů. Klikni na cestu pro drill-down:',
  drillInteractiveExpr: 'ER výraz — klikni na zvýrazněný odkaz pro drill-down:',
  drillConstant: 'Konstantní hodnota — žádný datový zdroj.',
  drillDsNotFound: (name: string) => `Datový zdroj „${name}" nebyl nalezen v načtených konfiguracích. Zkontroluj, zda je načten správný ModelMapping nebo Format soubor.`,

  // Results / counts
  searchResultCount: (n: number) => `Výsledky: ${n}`,
  propChildren: 'Potomci',
  // Property inspector
  propId: 'ID',
  propType: 'Typ',
  propName: 'Název',
  propEncoding: 'Kódování',
  propMaxLen: 'Max. délka',
  propValue: 'Hodnota',
  propTransform: 'Transformace',
  propExcluded: 'Vyloučeno z DS',
  propYes: 'Ano',

  // Status bar
  statusConfigs: (n: number) => `${n} konfigurace`,

  // Landing page
  landingBadge: 'D365 FO · Electronic Reporting',
  landingTitle: 'ER Visualizer',
  landingSub: 'Interaktivní vizualizace Dynamics 365 Finance ER konfigurací. Načti Model, ModelMapping a Format soubory pro kompletní drill-down analýzu.',
  landingDropPrimary: 'Přetáhni XML soubory sem',
  landingDropSecondary: 'nebo klikni pro výběr souborů',
  landingLoaded: (n: number) => `${n} soubory načteny.`,
  landingOpen: 'Otevřít',
  landingErrors: 'Chyby při načítání',
  landingDismiss: 'Zavřít',
  landingHowTitle: 'Jak to funguje',
  landingStep1Title: '1. Načti XML soubory',
  landingStep1Desc: 'Nahrej DataModel, ModelMapping a Format konfigurační soubory. Pořadí nezáleží — aplikace je propojí automaticky.',
  landingStep2Title: '2. Prozkoumej strukturu',
  landingStep2Desc: 'Explorer zobrazuje hierarchii všech prvků. Dvojklikem otevřeš detailní vizualizaci v pravé části.',
  landingStep3Title: '3. Drill-down na datový zdroj',
  landingStep3Desc: 'Klikni na prvek formátu, uvidíš binding výraz. Klikni na výraz pro rekurzivní rozbalení přes kalkulovaná pole až na zdrojovou tabulku.',
  landingStep4Title: '4. Where-used analýza',
  landingStep4Desc: 'V panelu Where-used zadej název tabulky, výčtu nebo třídy. Aplikace ukáže všechna místa využití od DS přes mapping až na formát.',
};

const en: Translations = {
  appName: 'ER Visualizer',
  appSubtitle: 'D365 FO · Electronic Reporting',
  home: 'Home',
  loadXml: 'Load XML',
  searchPlaceholder: 'Table name, field, path…',
  search: 'Search',
  whereUsed: 'Where used',
  whereUsedPlaceholder: 'e.g. TaxTrans, CustTable…',
  whereUsedLabel: 'Enter table, enum or class name:',
  find: 'Find',
  hideExplorer: 'Hide Explorer',
  showExplorer: 'Show Explorer',
  hideProperties: 'Hide Properties',
  showProperties: 'Show Properties',
  explorer: 'Explorer',
  properties: 'Properties',
  configurations: 'Configurations',
  noResults: 'Nothing found.',
  noResultsFor: (q: string) => `Nothing found for "${q}".`,
  found: (n: number) => `Found ${n} result${n === 1 ? '' : 's'}`,
  examples: 'Examples:',

  openInExplorer: 'Double-click an item in the Explorer to open its visualization.',
  collapse: 'Collapse all',
  expand: 'Expand all',
  filter: 'Filter…',
  structure: 'Structure',
  bindings: 'Bindings',
  dataSources: 'Data Sources',
  elements: 'elements',
  bound: 'bound',
  unbound: 'unbound',
  structural: 'structural',
  statsTooltip: (b: number, u: number, s: number) => `${b} bound + ${u} unbound + ${s} structural`,
  transforms: 'transforms',
  clearFilter: 'Clear filter',
  clearSearch: 'Clear search',
  clearWhereUsedSearch: 'Clear where-used search',
  noConfigurationsLoaded: 'No configurations loaded.',
  loadXmlHint: 'Click Load XML to import ER configuration files.',
  focusedDetail: 'Focused Detail',
  node: 'Node',
  elementType: 'Element Type',
  datasourceType: 'Datasource Type',
  path: 'Path',
  expression: 'Expression',
  explorerFilterPlaceholder: 'Filter explorer…',
  detailOverview: 'Selection Overview',
  attributes: 'Attributes',
  drillSteps: (n: number) => `${n} step${n === 1 ? '' : 's'}`,
  back: 'Back',
  openInExplorerAction: 'Open in Explorer',
  explorerActionShort: 'Explorer',
  noSelection: 'No element selected.',
  selectElementHint: 'Select a node in the explorer or designer to inspect its properties.',
  viewLabel: 'View',
  compactDensity: 'Compact',
  comfortableDensity: 'Comfortable',

  drillDown: 'Drill-down',
  drillLabelFormat: 'Format',
  drillLabelMapping: 'Mapping',
  drillLabelDatasource: 'Datasource',
  drillLabelTable: 'Table',
  drillLabelEnum: 'Enum',
  drillLabelClass: 'Class',
  drillLabelCalcField: 'Calculated field',
  drillLabelFormula: 'Formula',
  drillLabelChildren: 'Children',
  drillLabelExpression: 'Expression',
  drillUnbound: 'No binding — no expression assigned.',
  drillNoModelMapping: 'Model reference. Load the ModelMapping (.xml) file to enable drill-down.',
  drillPathNotFound: (p: string) => `Path "${p}" not found in ModelMapping.`,
  drillClickToTrace: 'Click expression to expand further →',
  drillActualPaths: 'Binding paths in ModelMapping',
  drillMore: (n: number) => `… and ${n} more`,
  drillCurrentRecord: 'Reference to the current loop record (@). The source datasource is defined by the parent element in the format structure.',
  drillComplexExpr: 'Complex ER function — expression cannot be traced to a single datasource.',
  drillCompoundExpr: 'Comparison expression — contains multiple model references. Click a path to drill down:',
  drillInteractiveExpr: 'ER formula — click a highlighted reference to drill down:',
  drillConstant: 'Constant value — no datasource.',
  drillDsNotFound: (name: string) => `Datasource "${name}" not found in loaded configurations. Check that the correct ModelMapping or Format file is loaded.`,

  searchResultCount: (n: number) => `Results: ${n}`,
  propChildren: 'Children',
  propId: 'ID',
  propType: 'Type',
  propName: 'Name',
  propEncoding: 'Encoding',
  propMaxLen: 'Max length',
  propValue: 'Value',
  propTransform: 'Transformation',
  propExcluded: 'Excluded from DS',
  propYes: 'Yes',

  statusConfigs: (n: number) => `${n} configuration${n === 1 ? '' : 's'}`,

  landingBadge: 'D365 FO · Electronic Reporting',
  landingTitle: 'ER Visualizer',
  landingSub: 'Interactive visualization of Dynamics 365 Finance ER configurations. Load Model, ModelMapping and Format files for complete drill-down analysis.',
  landingDropPrimary: 'Drop XML files here',
  landingDropSecondary: 'or click to browse',
  landingLoaded: (n: number) => `${n} file${n === 1 ? '' : 's'} loaded.`,
  landingOpen: 'Open',
  landingErrors: 'Load errors',
  landingDismiss: 'Dismiss',
  landingHowTitle: 'How it works',
  landingStep1Title: '1. Load XML files',
  landingStep1Desc: 'Upload DataModel, ModelMapping and Format configuration files. Order does not matter — the app links them automatically.',
  landingStep2Title: '2. Explore the structure',
  landingStep2Desc: 'The Explorer shows the full element hierarchy. Double-click to open a detailed visualization on the right.',
  landingStep3Title: '3. Drill down to data source',
  landingStep3Desc: 'Click a format element to see its binding expression. Click the expression to recursively expand through calculated fields all the way to the source table.',
  landingStep4Title: '4. Where-used analysis',
  landingStep4Desc: 'In the Where-used panel, type a table, enum or class name. The app shows every usage from the datasource through mapping to the format element.',
};

export const t: Translations = locale === 'cs' ? cs : en;
