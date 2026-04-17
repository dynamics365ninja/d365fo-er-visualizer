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
  showDetails: string;
  hideDetails: string;
  lightTheme: string;
  darkTheme: string;
  consultantView: string;
  technicalView: string;
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
  lightBindings: string;
  lightDataSources: string;
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
  closeConfiguration: string;
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
  propDirection: string;
  formatDirectionImport: string;
  formatDirectionExport: string;
  formatDirectionUnknown: string;
  // Status bar
  statusConfigs: (n: number) => string;
  // Landing page – hero
  landingBadge: string;
  landingTitle: string;
  landingSub: string;
  // Landing page – drop zone
  landingDropPrimary: string;
  landingDropRelease: string;
  landingDropSecondary: string;
  landingLoading: string;
  landingDropAriaLabel: string;
  landingPillModel: string;
  landingPillMapping: string;
  landingPillFormat: string;
  // Landing page – errors & loaded
  landingErrors: string;
  landingDismiss: string;
  landingLoaded: (n: number) => string;
  landingOpen: string;
  // Landing page – cards
  landingCardModelTitle: string;
  landingCardModelSubtitle: string;
  landingCardModelDesc: string;
  landingCardModelFeatures: string[];
  landingCardModelHint: string;
  landingCardMappingTitle: string;
  landingCardMappingSubtitle: string;
  landingCardMappingDesc: string;
  landingCardMappingFeatures: string[];
  landingCardMappingHint: string;
  landingCardFormatTitle: string;
  landingCardFormatSubtitle: string;
  landingCardFormatDesc: string;
  landingCardFormatFeatures: string[];
  landingCardFormatHint: string;
  // Landing page – how it works
  landingHowTitle: string;
  landingStep1Title: string;
  landingStep1Desc: string;
  landingStep2Title: string;
  landingStep2Desc: string;
  landingStep3Title: string;
  landingStep3Desc: string;
  landingStep4Title: string;
  landingStep4Desc: string;
  // Landing page – footer
  landingFooter: string;
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
  whereUsed: 'Místa použití',
  whereUsedPlaceholder: 'např. TaxTrans, CustTable, MyCalcField…',
  whereUsedLabel: 'Zadej název tabulky, výčtu, třídy nebo datasource:',
  find: 'Najít',
  hideExplorer: 'Skrýt Explorer',
  showExplorer: 'Zobrazit Explorer',
  hideProperties: 'Skrýt Vlastnosti',
  showProperties: 'Zobrazit Vlastnosti',
  showDetails: 'Zobrazit detaily',
  hideDetails: 'Skrýt detaily',
  lightTheme: 'Světlý režim',
  darkTheme: 'Tmavý režim',
  consultantView: 'Konzultantský pohled',
  technicalView: 'Technický pohled',
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
  lightBindings: 'Napojení',
  lightDataSources: 'Zdroje dat',
  elements: 'prvků',
  bound: 'vázaných',
  unbound: 'nevázaných',
  structural: 'strukturních',
  statsTooltip: (b: number, u: number, s: number) => `${b} vázaných + ${u} nevázaných + ${s} strukturních`,
  transforms: 'transformací',
  clearFilter: 'Vymazat filtr',
  clearSearch: 'Vymazat hledání',
  clearWhereUsedSearch: 'Vymazat hledání míst použití',
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
  closeConfiguration: 'Zavřít konfiguraci',
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
  propDirection: 'Směr',
  formatDirectionImport: 'Import',
  formatDirectionExport: 'Export',
  formatDirectionUnknown: 'Neznámý směr',

  // Status bar
  statusConfigs: (n: number) => `${n} konfigurace`,

  // Landing page
  landingBadge: 'D365 Finance & Operations · Electronic Reporting',
  landingTitle: 'D365FO ER Visualizer',
  landingSub: 'Přehledné pracovní místo pro konfigurace elektronického výkaznictví: modely, mapování i formáty na jednom místě. Snadno se proklikáš od formulí až ke zdrojovým tabulkám, dohledáš where-used vazby a přeskakuješ mezi souvisejícími soubory.',
  landingDropPrimary: 'Přetáhni ER XML soubory sem',
  landingDropRelease: 'Pusť soubory',
  landingDropSecondary: 'nebo klikni pro výběr · můžeš načíst více souborů najednou',
  landingLoading: 'Načítání souborů…',
  landingDropAriaLabel: 'Přetáhni XML soubory sem',
  landingPillModel: '📐 Model',
  landingPillMapping: '🔗 Mapování',
  landingPillFormat: '📄 Formát',
  landingErrors: '⚠️ Chyby načítání',
  landingDismiss: 'Zavřít',
  landingLoaded: (n: number) => `✅ ${n} konfigurac${n === 1 ? 'e načtena' : 'e načteny'}`,
  landingOpen: 'Přejít do návrháře →',
  landingCardModelTitle: 'Data Model',
  landingCardModelSubtitle: 'Datový model konfigurované agendy',
  landingCardModelDesc: 'Definuje, jaká data konfigurace zpracovává — záznamy, seznamy, výčtové hodnoty a jejich pole. Slouží jako společný základ, na který se napojuje mapování i formát.',
  landingCardModelFeatures: [
    'Vizualizace jako hierarchický strom',
    'Přehled polí a datových typů každého záznamu',
    'Navigace po odkazech mezi záznamy (vnořené záznamy, seznamy)',
    'Barevné rozlišení kořenových prvků, záznamů a výčtů',
  ],
  landingCardModelHint: 'Tax declaration model.xml',
  landingCardMappingTitle: 'Model Mapping',
  landingCardMappingSubtitle: 'Napojení modelu na data v D365 FO',
  landingCardMappingDesc: 'Určuje, odkud se data pro model berou — z tabulek, pohledů, tříd, výčtů nebo vypočítaných polí v Dynamics 365 Finance & Operations.',
  landingCardMappingFeatures: [
    'Prohlížeč vazeb: ke každé cestě v modelu vidíte zdrojový výraz',
    'Strom datových zdrojů (tabulky, třídy, vypočítaná pole …)',
    'Rozklad složených výrazů a vypočítaných polí krok za krokem',
    'Sledování závislostí — na které tabulky a třídy se konfigurace odkazuje',
  ],
  landingCardMappingHint: 'Tax declaration model mapping.xml',
  landingCardFormatTitle: 'Format',
  landingCardFormatSubtitle: 'Šablona výstupního nebo vstupního souboru',
  landingCardFormatDesc: 'Popisuje strukturu generovaného (nebo čteného) souboru — XML, Excel, Word, PDF, CSV či prostý text. Každý prvek může obsahovat formuli napojující data z mapování.',
  landingCardFormatFeatures: [
    'Rozpoznání typu souboru (XML / Excel / Word / PDF / Text)',
    'Stromový náhled všech prvků včetně vložených formulí',
    'Proklik z formule přes datový zdroj až ke zdrojové tabulce',
    'Přehled transformací a výčtových hodnot definovaných ve formátu',
  ],
  landingCardFormatHint: 'VAT declaration XML (CZ).xml',
  landingHowTitle: 'Jak to funguje',
  landingStep1Title: 'Načti soubory',
  landingStep1Desc: 'Přetáhni nebo vyber ER XML soubory. Nejlepší je načíst všechny tři typy (Model + Mapování + Formát), protože teprve pak funguje plný drill-down napříč konfigurací.',
  landingStep2Title: 'Projdi strom konfigurace',
  landingStep2Desc: 'V levém panelu Exploreru vidíš hierarchii celé konfigurace. Kliknutím vybereš prvek, dvojklikem si otevřeš jeho vizualizaci na nové záložce.',
  landingStep3Title: 'Klikni na formuli',
  landingStep3Desc: 'V pohledu Formát nebo Mapování klikni na libovolný výraz. Uvidíš celý řetězec vazeb: formule → vypočtená pole → zdrojová tabulka, třída nebo enum.',
  landingStep4Title: 'Místa použití',
  landingStep4Desc: 'V panelu 🔍 Hledat zadej název tabulky, třeba &quot;TaxTrans&quot;, a spusť &quot;Místa použití&quot;. Zobrazí se všechny formátové elementy, které z této tabulky čerpají data.',
  landingFooter: 'D365 FO ER Visualizer · Electronic Reporting Configuration Inspector',
};

const en: Translations = {
  appName: 'ER Visualizer',
  appSubtitle: 'D365 FO · Electronic Reporting',
  home: 'Home',
  loadXml: 'Load XML',
  searchPlaceholder: 'Table name, field, path…',
  search: 'Search',
  whereUsed: 'Where used',
  whereUsedPlaceholder: 'e.g. TaxTrans, CustTable, MyCalcField…',
  whereUsedLabel: 'Enter table, enum, class or datasource name:',
  find: 'Find',
  hideExplorer: 'Hide Explorer',
  showExplorer: 'Show Explorer',
  hideProperties: 'Hide Properties',
  showProperties: 'Show Properties',
  showDetails: 'Show details',
  hideDetails: 'Hide details',
  lightTheme: 'Light mode',
  darkTheme: 'Dark mode',
  consultantView: 'Consultant view',
  technicalView: 'Technical view',
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
  lightBindings: 'Links',
  lightDataSources: 'Data sources',
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
  closeConfiguration: 'Close configuration',
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
  propDirection: 'Direction',
  formatDirectionImport: 'Import',
  formatDirectionExport: 'Export',
  formatDirectionUnknown: 'Unknown direction',

  statusConfigs: (n: number) => `${n} configuration${n === 1 ? '' : 's'}`,

  // Landing page
  landingBadge: 'D365 Finance & Operations · Electronic Reporting',
  landingTitle: 'D365FO ER Visualizer',
  landingSub: 'A clear workspace for Electronic Reporting configurations: data models, mappings and formats in one place. Easily trace formulas back to source tables, find where-used references, and jump between related files.',
  landingDropPrimary: 'Drop ER XML files here',
  landingDropRelease: 'Release files',
  landingDropSecondary: 'or click to browse · you can load multiple files at once',
  landingLoading: 'Loading files…',
  landingDropAriaLabel: 'Drop XML files here',
  landingPillModel: '📐 Model',
  landingPillMapping: '🔗 Mapping',
  landingPillFormat: '📄 Format',
  landingErrors: '⚠️ Load errors',
  landingDismiss: 'Dismiss',
  landingLoaded: (n: number) => `✅ ${n} configuration${n === 1 ? '' : 's'} loaded`,
  landingOpen: 'Open designer →',
  landingCardModelTitle: 'Data Model',
  landingCardModelSubtitle: 'Data model of the configured agenda',
  landingCardModelDesc: 'Defines what data the configuration processes — records, lists, enumeration values and their fields. Serves as the common foundation that mapping and format connect to.',
  landingCardModelFeatures: [
    'Visualize as a hierarchical tree',
    'Overview of fields and data types for each record',
    'Navigate references between records (nested records, lists)',
    'Color-coded root elements, records, and enumerations',
  ],
  landingCardModelHint: 'Tax declaration model.xml',
  landingCardMappingTitle: 'Model Mapping',
  landingCardMappingSubtitle: 'Connects the model to D365 FO data',
  landingCardMappingDesc: 'Determines where the model data comes from — tables, views, classes, enums, or calculated fields in Dynamics 365 Finance & Operations.',
  landingCardMappingFeatures: [
    'Binding browser: see the source expression for every model path',
    'Data-source tree (tables, classes, calculated fields …)',
    'Step-by-step breakdown of complex expressions and calculated fields',
    'Dependency tracking — which tables and classes the configuration references',
  ],
  landingCardMappingHint: 'Tax declaration model mapping.xml',
  landingCardFormatTitle: 'Format',
  landingCardFormatSubtitle: 'Output or input file template',
  landingCardFormatDesc: 'Describes the structure of the generated (or consumed) file — XML, Excel, Word, PDF, CSV or plain text. Every element can contain a formula linked to mapping data.',
  landingCardFormatFeatures: [
    'Detect file type (XML / Excel / Word / PDF / Text)',
    'Tree view of all elements including embedded formulas',
    'Click through from formula via data source to source table',
    'Overview of transformations and enumeration values defined in the format',
  ],
  landingCardFormatHint: 'VAT declaration XML (CZ).xml',
  landingHowTitle: 'How it works',
  landingStep1Title: 'Load files',
  landingStep1Desc: 'Drag-and-drop or select ER XML files. For full cross-configuration drill-down, load all three types (Model + Mapping + Format).',
  landingStep2Title: 'Browse the configuration tree',
  landingStep2Desc: 'The Explorer panel on the left shows the full configuration hierarchy. Click to select an element, double-click to open its visualization in a new tab.',
  landingStep3Title: 'Click a formula',
  landingStep3Desc: 'In the Format or Mapping view, click any expression. You will see the full chain of bindings: formula → calculated fields → source table, class or enum.',
  landingStep4Title: 'Where used',
  landingStep4Desc: 'In the 🔍 Search panel, enter a table name such as &quot;TaxTrans&quot; and run &quot;Where used&quot;. All format elements that consume data from that table will be shown.',
  landingFooter: 'D365 FO ER Visualizer · Electronic Reporting Configuration Inspector',
};

export const t: Translations = locale === 'cs' ? cs : en;
