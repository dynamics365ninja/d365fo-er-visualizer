import { useSyncExternalStore } from 'react';

// ─── Internationalisation ───────────────────────────────────────────────────
// Detects OS/browser locale and returns the correct translation dict.
// Supported: cs (Czech), en (English, default)

export type Locale = 'cs' | 'en';

const LOCALE_STORAGE_KEY = 'er-visualizer.locale';

function detectLocale(): Locale {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored === 'cs' || stored === 'en') return stored;
    } catch {
      // Ignore storage failures and fall back to browser locale.
    }
  }
  const lang =
    (typeof navigator !== 'undefined' ? navigator.language : undefined) ?? 'en';
  return lang.toLowerCase().startsWith('cs') ? 'cs' : 'en';
}

const listeners = new Set<() => void>();

export let locale: Locale = detectLocale();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocale(): Locale {
  return locale;
}

export function setLocale(nextLocale: Locale): void {
  if (locale === nextLocale) return;
  locale = nextLocale;
  t = locale === 'cs' ? cs : en;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Ignore storage failures and keep in-memory state only.
    }
  }
  listeners.forEach(listener => listener());
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

// ─── Translations type ────────────────────────────────────────────────────

export interface Translations {
  // App shell
  appName: string;
  appSubtitle: string;
  language: string;
  languageCzech: string;
  languageEnglish: string;
  home: string;
  loadXml: string;
  searchPlaceholder: string;
  search: string;
  whereUsed: string;
  propRevealInExplorer: string;
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
  explorerFilterByKind: string;
  explorerSort: string;
  explorerViewFlat: string;
  explorerViewHierarchy: string;
  explorerSortLoadOrder: string;
  explorerSortNameAsc: string;
  explorerSortNameDesc: string;
  explorerResultsCount: (visible: number, total: number) => string;
  explorerMoreActions: string;
  explorerOpenInTab: string;
  detailOverview: string;
  attributes: string;
  drillSteps: (n: number) => string;
  back: string;
  closeConfiguration: string;
  closeAllConfigurations: string;
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
  drillAnalyzing: string;
  drillHintClickable: string;
  drillHintEmpty: string;
  drillStepMappingTitle: string;
  drillStepDatasourceTitle: string;
  drillStepDepsTitle: string;
  drillStepFormulaTitle: string;
  drillStepUserParameterTitle: string;
  drillStepGroupedListTitle: string;
  drillStepAggregationTitle: (name: string) => string;
  drillStepChildrenTitle: string;
  drillRestart: string;
  drillPopOut: string;
  drillOpenInTab: string;
  drillClickToToggle: string;
  drillCollapsibleLabel: string;
  drillOpenExplorerFull: string;
  drillLegendClickable: string;
  drillLegendFunction: string;
  drillLegendLiteral: string;
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
  importLinkedMappingsLabel: string;
  importNoLinkedMappings: string;
  // Status bar
  statusConfigs: (n: number) => string;
  statusConfigsWord: string;
  // Landing page – hero
  landingBadge: string;
  landingTitle: string;
  landingSub: string;
  landingDocsLink: string;
  landingSourceLabel: string;
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
  // Landing page – footer
  landingFooter: string;

  // Recent files, samples, validator, shortcuts, forward nav
  recentFiles: string;
  noRecentFiles: string;
  clearRecent: string;
  recentReloadHint: string;
  recentSessions: string;
  recentSessionTitle: (count: number) => string;
  recentSessionReloadHint: string;
  loadSample: string;
  validatorOk: string;
  validatorIssues: (n: number) => string;
  forward: string;
  commandPalette: string;
  commandPaletteHint: string;
  cmdFilter: string;
  cmdGroupNav: string;
  cmdGroupOpen: string;
  cmdGroupView: string;
  cmdGroupTools: string;
  cmdLoadXml: string;
  cmdToggleSearch: string;
  cmdToggleExplorer: string;
  cmdToggleProperties: string;
  cmdToggleTheme: string;
  cmdToggleTechnical: string;
  cmdCollapseAll: string;
  cmdExpandAll: string;
  cmdGoHome: string;
  cmdBack: string;
  cmdForward: string;
  cmdExportWhereUsed: string;

  // Toasts / errors
  toastLoadFailed: (file: string) => string;
  dismiss: string;

  // Tooltips in ClickablePath
  pathClickToNavigate: string;
  pathTable: string;
  pathEnum: string;
  pathClass: string;
  pathCalcField: string;
  pathDatasource: string;
  pathNotFound: string;

  // Breadcrumb / status bar warnings
  warnings: string;
  noWarnings: string;
  breadcrumbHome: string;

  // F&O connector
  fnoTabLocal: string;
  fnoTabRemote: string;
  fnoHeading: string;
  fnoSubheading: string;
  fnoProfileName: string;
  fnoEnvUrl: string;
  fnoTenantId: string;
  fnoClientId: string;
  fnoSaveProfile: string;
  fnoUpdateProfile: string;
  fnoNewProfile: string;
  fnoConnect: string;
  fnoDisconnect: string;
  fnoConnecting: string;
  fnoConnected: (user: string) => string;
  fnoProfiles: string;
  fnoNoProfiles: string;
  fnoRemoveProfile: string;
  fnoSolutions: string;
  fnoConfigurations: string;
  fnoLoading: string;
  fnoLoadSelected: string;
  fnoSelectAll: string;
  fnoSelectNone: string;
  fnoFilterByType: string;
  fnoAllTypes: string;
  fnoSignInFailed: (msg: string) => string;
  fnoProfileSaved: (name: string) => string;
  fnoProfileUpdated: (name: string) => string;
  fnoLoadingFailed: (msg: string) => string;
  fnoDownloadFailed: (name: string, msg: string) => string;
  fnoLoadedCount: (n: number) => string;
  fnoMappingNotAvailable: (names: string[]) => string;
  fnoMappingNoDataModel: string;

  // Property inspector labels
  propDescription: string;
  propVersion: string;
  propVendor: string;
  propStatus: string;
  propBase: string;
  propBaseGuid: string;
  propKind: string;
  propLabelsCount: (n: number) => string;
  propLabel: string;
  propFields: string;
  propIsRoot: string;
  propIsEnum: string;
  propTypeDescriptor: string;
  propHost: string;
  propParentPath: string;
  propTable: string;
  propCrossCompany: string;
  propSelectedFields: string;
  propEnumName: string;
  propEnumType: string;
  propImportFormatGuid: string;
  propClassName: string;
  propEdt: string;
  propVisibilityExpr: string;
  propModelPath: string;
  propSyntaxVersion: string;
  propCondition: string;
  propMessage: string;
  propRule: (n: number) => string;
  propProperty: string;
  propValueDefault: string;
  propMappingVersion: string;
  propModel: string;
  propModelVersion: string;
  propDatasources: string;
  propBindings: string;
  propValidations: string;
  propModelGuid: string;
  propModelVersionRaw: string;
  propRootContainer: string;
  propMappingRevision: string;
  propValues: string;
  propListToGroup: string;
  propCompleted: string;
  propNo: string;
  propComponentGuid: string;

  // Error boundary
  errorLabel: string;
  errorTitle: string;
  errorDescription: string;
  errorRetry: string;

  // Excel preview
  excelWorkbook: string;
  excelInput: string;
  excelOutput: string;
  excelRangeCount: (n: number) => string;
  excelCellCount: (n: number) => string;
  excelNoSheets: string;
  excelEmptySheet: string;
  excelHeader: string;
  excelFooter: string;
  excelRepeatingVertical: string;
  excelRepeatingHorizontal: string;
  excelLegendDynamic: string;
  excelLegendConstant: string;
  excelTemplateView: string;
  excelShowTemplate: string;
  excelTemplateLoading: string;
  excelTemplateError: string;
  excelStructureView: string;
  excelTemplateCells: (n: number) => string;
  excelTemplateMerged: (n: number) => string;
  excelTemplateDropHint: string;
  excelTemplateDropActive: string;
  excelTemplateDropInvalid: string;
  excelTemplateLoadBtn: string;
  previewLabel: string;
  previewDescription: string;

  // Format stats
  statsRoots: (n: number) => string;
  statsRecords: (n: number) => string;
  statsEnums: (n: number) => string;
  statsFields: (n: number) => string;
  statsRelations: (n: number) => string;
  modelHierarchyHint: string;
  moreFields: (n: number) => string;

  // Search panel
  searchInLabel: string;
  exampleHintTable: string;
  exampleHintEnum: string;
  exampleHintLookup: string;
  exampleHintParam: string;
  exampleHintIdentifier: string;
  exampleHintFunction: string;
  exampleHintCalcField: string;
  searchRefCount: (n: number) => string;
  whereUsedSummary: (occurrences: number, files: number) => string;
  navigateToDatasource: string;
  textOccurrences: string;
  inExpressions: string;
  deadDatasource: string;
  deadDatasourceDesc: string;

  // FnoConnectPanel status
  fnoStatusPreparing: string;
  fnoStatusDownloadingDM: (n: number) => string;
  fnoStatusDownloadingFM: (n: number) => string;
  fnoStatusResolvingDM: string;
  fnoStatusScanMappings: string;
  fnoStatusDownloadingMM: string;
  fnoStatusDownloadingMMCount: (n: number) => string;
  fnoStatusLateDM: string;
  fnoSkippedDerived: (name: string) => string;
  fnoSelectedCount: (n: number) => string;
  fnoFilterModels: string;
  fnoBack: string;
  fnoRetry: string;
  fnoNoChildren: (name: string) => string;
  fnoDownloadInfo: string;
  fnoCredentials: string;

  // New feature translations
  embeddedMapping: string;
  structureFilterAll: string;
  structureFilterBound: string;
  structureFilterUnbound: string;
  whereUsedAction: string;
}

// ─── Translation dictionaries ─────────────────────────────────────────────

const cs: Translations = {
  // App shell
  appName: 'ER Visualizer',
  appSubtitle: 'D365 FO · Electronic Reporting',
  language: 'Jazyk',
  languageCzech: 'Čeština',
  languageEnglish: 'Angličtina',
  home: 'Domů',
  loadXml: 'Načíst XML',
  searchPlaceholder: 'Název tabulky, pole, cesty…',
  search: 'Hledat',
  whereUsed: 'Místa použití',
  propRevealInExplorer: 'Zobrazit v Exploreru',
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
  found: (n: number) => `Výskyty: ${n}`,
  examples: 'Příklady:',

  // Designer
  openInExplorer: 'V Exploreru otevřete vizualizaci dvojklikem na vybraný prvek.',
  collapse: 'Sbalit vše',
  expand: 'Rozbalit vše',
  filter: 'Filtrovat…',
  structure: 'Struktura',
  bindings: 'Vazby',
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
  explorerFilterByKind: 'Filtrovat podle druhu',
  explorerSort: 'Řazení',
  explorerViewFlat: 'Zobrazit plochý seznam',
  explorerViewHierarchy: 'Zobrazit hierarchii modelů',
  explorerSortLoadOrder: 'Pořadí načtení',
  explorerSortNameAsc: 'Název vzestupně (A–Z)',
  explorerSortNameDesc: 'Název sestupně (Z–A)',
  explorerResultsCount: (v, t) => `Zobrazeno ${v} z ${t}`,
  explorerMoreActions: 'Další akce',
  explorerOpenInTab: 'Otevřít v záložce',
  detailOverview: 'Přehled výběru',
  attributes: 'Atributy',
  drillSteps: (n: number) => `${n} krok${n === 1 ? '' : n < 5 ? 'y' : 'ů'}`,
  back: 'Zpět',
  closeConfiguration: 'Zavřít konfiguraci',
  closeAllConfigurations: 'Zavřít vše',
  openInExplorerAction: 'Otevřít v Exploreru',
  explorerActionShort: 'Explorer',
  noSelection: 'Není vybraný žádný prvek.',
  selectElementHint: 'Vyber v exploreru nebo v návrháři uzel, jehož vlastnosti chceš zobrazit.',
  viewLabel: 'Pohled',
  compactDensity: 'Kompaktní',
  comfortableDensity: 'Pohodlný',

  // Drill-down panel
  drillDown: 'Rozpad',
  drillLabelFormat: 'Formát',
  drillLabelMapping: 'Mapování',
  drillLabelDatasource: 'Zdroj hodnoty',
  drillLabelTable: 'Tabulka',
  drillLabelEnum: 'Výčet',
  drillLabelClass: 'Třída',
  drillLabelCalcField: 'Výpočet',
  drillLabelFormula: 'Výpočetní pravidlo',
  drillLabelChildren: 'Související zdroje',
  drillLabelExpression: 'Výraz',
  drillUnbound: 'Hodnota není napojena — chybí jí výraz.',
  drillNoModelMapping: 'Tento odkaz míří do modelu. Pro rozpad načti soubor ModelMapping (.xml).',
  drillPathNotFound: (p: string) => `Cesta „${p}" nebyla nalezena v ModelMapping.`,
  drillClickToTrace: 'Klikni na výraz a pokračuj do další úrovně →',
  drillActualPaths: 'Cesty vazeb v ModelMapping',
  drillMore: (n: number) => `… a ${n} dalších`,
  drillCurrentRecord: 'Odkaz na aktuální záznam smyčky (@). Zdroj hodnoty určuje nadřazený prvek ve struktuře formátu.',
  drillComplexExpr: 'Složená ER funkce — výraz nelze jednoduše trasovat na jeden datový zdroj.',
  drillCompoundExpr: 'Porovnávací výraz — obsahuje více modelových odkazů. Klikni na cestu pro rozpad:',
  drillInteractiveExpr: 'ER výraz — klikni na zvýrazněný odkaz pro rozpad:',
  drillConstant: 'Konstantní hodnota — bez zdroje dat.',
  drillDsNotFound: (name: string) => `Datový zdroj „${name}" nebyl nalezen v načtených konfiguracích. Zkontroluj, zda je načten správný ModelMapping nebo Format soubor.`,
  drillAnalyzing: 'Rozebíraný výraz',
  drillHintClickable: 'Klikni na zvýrazněné části výrazu a rozpadni si ho krok po kroku až na původ dat.',
  drillHintEmpty: 'Vyber prvek s vazbou (formulí) v Návrháři — rozpad ukáže, odkud se hodnota bere.',
  drillStepMappingTitle: 'Jak se hledá v modelu',
  drillStepDatasourceTitle: 'Odkud se bere hodnota',
  drillStepDepsTitle: 'Co hodnotu ovlivňuje',
  drillStepFormulaTitle: 'Výpočet hodnoty — klikni pro další rozpad',
  drillStepUserParameterTitle: 'Výraz parametru',
  drillStepGroupedListTitle: 'Seskupený seznam',
  drillStepAggregationTitle: (name: string) => `Agregace: ${name}`,
  drillStepChildrenTitle: 'Související zdroje',
  drillRestart: 'Začít znovu',
  drillPopOut: 'Otevřít v okně',
  drillOpenInTab: 'Otevřít v nové záložce',
  drillClickToToggle: 'Klikněte pro zobrazení / skrytí detailu výrazu',
  drillCollapsibleLabel: 'Zobrazit rozpad hodnoty',
  drillOpenExplorerFull: 'Otevřít v Exploreru →',
  drillLegendClickable: 'Klikatelný odkaz',
  drillLegendFunction: 'ER funkce',
  drillLegendLiteral: 'Literál',

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
  importLinkedMappingsLabel: 'Mapování na model',
  importNoLinkedMappings: 'Žádné mapování na model nenačteno',

  // Status bar
  statusConfigs: (n: number) => `${n} konfigurace`,
  statusConfigsWord: 'konfigurace',

  // Landing page
  landingBadge: 'D365 Finance & Operations · Electronic Reporting',
  landingTitle: 'D365FO ER Visualizer',
  landingSub: 'Načti ER konfigurace z disku nebo přímo z prostředí Finance & Operations a začni trasovat vazby formátů přes mapování až ke zdrojové tabulce, třídě nebo výčtu.',
  landingDocsLink: 'Dokumentace',
  landingSourceLabel: 'Zdroj konfigurací',
  landingDropPrimary: 'Přetáhni ER XML soubory sem',
  landingDropRelease: 'Pusť soubory',
  landingDropSecondary: 'nebo klikni pro výběr · můžeš načíst více souborů najednou',
  landingLoading: 'Načítání souborů…',
  landingDropAriaLabel: 'Přetáhni XML soubory sem',
  landingPillModel: 'Datový model',
  landingPillMapping: 'Mapování modelu',
  landingPillFormat: 'Formát',
  landingErrors: 'Chyby načítání',
  landingDismiss: 'Zavřít',
  landingLoaded: (n: number) => `${n} konfigurac${n === 1 ? 'e načtena' : 'e načteny'}`,
  landingOpen: 'Otevřít návrhář',
  landingFooter: 'D365 FO ER Visualizer · Electronic Reporting Configuration Inspector',

  recentFiles: 'Nedávné soubory',
  noRecentFiles: 'Žádné nedávno otevřené soubory.',
  recentReloadHint: 'Dvojklik pro znovunačtení souboru',
  recentSessions: 'Nedávné relace',
  recentSessionTitle: (count: number) => `Relace (${count} ${count === 1 ? 'soubor' : count >= 2 && count <= 4 ? 'soubory' : 'souborů'})`,
  recentSessionReloadHint: 'Dvojklik pro načtení celé relace',
  clearRecent: 'Vymazat historii',
  loadSample: 'Načíst ukázkovou konfiguraci',
  validatorOk: 'Konfigurace vypadá v pořádku.',
  validatorIssues: (n: number) => `${n} upozornění`,
  forward: 'Vpřed',
  commandPalette: 'Paleta příkazů',
  commandPaletteHint: 'Ctrl+K / Cmd+K',
  cmdFilter: 'Zadej příkaz nebo vyhledej…',
  cmdGroupNav: 'Navigace',
  cmdGroupOpen: 'Soubory',
  cmdGroupView: 'Pohled',
  cmdGroupTools: 'Nástroje',
  cmdLoadXml: 'Načíst ER XML…',
  cmdToggleSearch: 'Hledat / Místa použití',
  cmdToggleExplorer: 'Přepnout Explorer',
  cmdToggleProperties: 'Přepnout Vlastnosti',
  cmdToggleTheme: 'Přepnout světlý/tmavý režim',
  cmdToggleTechnical: 'Přepnout technický pohled',
  cmdCollapseAll: 'Sbalit celý strom',
  cmdExpandAll: 'Rozbalit celý strom',
  cmdGoHome: 'Přejít na úvodní obrazovku',
  cmdBack: 'Zpět v historii',
  cmdForward: 'Vpřed v historii',
  cmdExportWhereUsed: 'Exportovat místa použití do CSV',

  toastLoadFailed: (file: string) => `Soubor „${file}" se nepodařilo načíst.`,
  dismiss: 'Zavřít',

  pathClickToNavigate: 'Klikni pro navigaci →',
  pathTable: 'Tabulka',
  pathEnum: 'Výčet',
  pathClass: 'Třída',
  pathCalcField: 'Kalkulované pole',
  pathDatasource: 'Datový zdroj',
  pathNotFound: 'Nenalezeno',

  warnings: 'Upozornění',
  noWarnings: 'Žádná upozornění.',
  breadcrumbHome: 'Domů',

  fnoTabLocal: 'Lokální soubory',
  fnoTabRemote: 'D365 F&O server',
  fnoHeading: 'Připojení k Dynamics 365 F&O',
  fnoSubheading: 'Načti ER konfigurace přímo z prostředí (CHE, Sandbox, UDE).',
  fnoProfileName: 'Název profilu',
  fnoEnvUrl: 'URL prostředí',
  fnoTenantId: 'Tenant ID (Entra)',
  fnoClientId: 'Application (client) ID',
  fnoSaveProfile: 'Uložit profil',
  fnoUpdateProfile: 'Uložit změny',
  fnoNewProfile: 'Nový profil',
  fnoConnect: 'Připojit',
  fnoDisconnect: 'Odpojit',
  fnoConnecting: 'Připojuji…',
  fnoConnected: (user: string) => `Připojen jako ${user}`,
  fnoProfiles: 'Uložené profily',
  fnoNoProfiles: 'Zatím žádný profil. Vyplň údaje nahoře a stiskni „Uložit profil".',
  fnoRemoveProfile: 'Odebrat profil',
  fnoSolutions: 'ER řešení',
  fnoConfigurations: 'Konfigurace',
  fnoLoading: 'Načítám…',
  fnoLoadSelected: 'Načíst vybrané',
  fnoSelectAll: 'Vybrat vše',
  fnoSelectNone: 'Zrušit výběr',
  fnoFilterByType: 'Typ komponenty',
  fnoAllTypes: 'Všechny',
  fnoSignInFailed: (msg: string) => `Přihlášení selhalo: ${msg}`,
  fnoProfileSaved: (name: string) => `Profil „${name}" uložen.`,
  fnoProfileUpdated: (name: string) => `Profil „${name}" aktualizován.`,
  fnoLoadingFailed: (msg: string) => `Načítání selhalo: ${msg}`,
  fnoDownloadFailed: (name: string, msg: string) => `Stažení „${name}" selhalo: ${msg}`,
  fnoLoadedCount: (n: number) => `Načteno ${n} konfigurací z F&O.`,
  fnoMappingNotAvailable: (names: string[]) => `ModelMapping nelze stáhnout pro: ${names.join(', ')}. Vazby formátových elementů jsou i přesto dostupné přes FormatMapping.`,
  fnoMappingNoDataModel: 'ModelMapping se nestahoval — ve staženém formátu nebyl nalezen žádný GUID datového modelu, takže není podle čeho mapování dohledat. Vyber navíc příslušný datový model (nebo jeho mapování) ve stromu.',

  // Property inspector labels
  propDescription: 'Popis',
  propVersion: 'Verze',
  propVendor: 'Dodavatel',
  propStatus: 'Stav',
  propBase: 'Základ',
  propBaseGuid: 'GUID základu',
  propKind: 'Druh',
  propLabelsCount: (n: number) => `${n} záznamů`,
  propLabel: 'Popisek',
  propFields: 'Pole',
  propIsRoot: 'Je kořen',
  propIsEnum: 'Je výčet',
  propTypeDescriptor: 'Type Descriptor',
  propHost: 'Host',
  propParentPath: 'Nadřazená cesta',
  propTable: 'Tabulka',
  propCrossCompany: 'Cross-Company',
  propSelectedFields: 'Vybraná pole',
  propEnumName: 'Název výčtu',
  propEnumType: 'Typ výčtu',
  propImportFormatGuid: 'GUID importního formátu',
  propClassName: 'Název třídy',
  propEdt: 'EDT',
  propVisibilityExpr: 'Výraz viditelnosti',
  propModelPath: 'Cesta v modelu',
  propSyntaxVersion: 'Verze syntaxe',
  propCondition: 'Podmínka',
  propMessage: 'Zpráva',
  propRule: (n: number) => `Pravidlo ${n}`,
  propProperty: 'Vlastnost',
  propValueDefault: 'Hodnota (výchozí)',
  propMappingVersion: 'Verze mapování',
  propModel: 'Model',
  propModelVersion: 'Verze modelu',
  propDatasources: 'Datové zdroje',
  propBindings: 'Vazby',
  propValidations: 'Validace',
  propModelGuid: 'GUID modelu',
  propModelVersionRaw: 'Verze modelu (raw)',
  propRootContainer: 'Kořenový kontejner',
  propMappingRevision: 'Revize mapování',
  propValues: 'Hodnoty',
  propListToGroup: 'Seskupení seznamu',
  propCompleted: 'Dokončeno',
  propNo: 'Ne',
  propComponentGuid: 'GUID komponenty',

  // Error boundary
  errorLabel: 'Chyba',
  errorTitle: 'Něco se pokazilo.',
  errorDescription: 'Tato část aplikace narazila na neočekávanou chybu. Zbytek aplikace by měl fungovat dál.',
  errorRetry: 'Zkusit znovu',

  // Excel preview
  excelWorkbook: 'Excel sešit',
  excelInput: 'Vstupní',
  excelOutput: 'Výstupní',
  excelRangeCount: (n: number) => `${n} oblast${n === 1 ? '' : n < 5 ? 'i' : 'í'}`,
  excelCellCount: (n: number) => `${n} buň${n === 1 ? 'ka' : n < 5 ? 'ky' : 'ek'}`,
  excelNoSheets: 'Ve struktuře formátu nebyly nalezeny žádné listy Excelu.',
  excelEmptySheet: 'Prázdný list',
  excelHeader: 'Záhlaví',
  excelFooter: 'Zápatí',
  excelRepeatingVertical: 'opakující se svisle',
  excelRepeatingHorizontal: 'opakující se vodorovně',
  excelLegendDynamic: 'datově vázaný',
  excelLegendConstant: 'odvozeno z výrazu',
  excelTemplateView: 'Šablona',
  excelShowTemplate: 'Zobrazit Excel šablonu',
  excelTemplateLoading: 'Načítání Excel šablony…',
  excelTemplateError: 'Chyba při čtení šablony',
  excelStructureView: 'Struktura',
  excelTemplateCells: (n: number) => `${n} buň${n === 1 ? 'ka' : n < 5 ? 'ky' : 'ek'}`,
  excelTemplateMerged: (n: number) => `${n} sloučen${n === 1 ? 'á' : n < 5 ? 'é' : 'ých'}`,
  excelTemplateDropHint: 'Přetáhněte sem soubor .xlsx z exportovaného ER solution package',
  excelTemplateDropActive: 'Pusťte soubor .xlsx…',
  excelTemplateDropInvalid: 'Pouze soubory .xlsx',
  excelTemplateLoadBtn: 'Načíst šablonu (.xlsx)',
  previewLabel: 'Náhled',
  previewDescription: 'Náhled struktury souboru — konstantní hodnoty jsou odvozeny z binding výrazů. Dynamické hodnoty (cesty datových zdrojů, funkce) jsou zobrazeny jako {zástupné}.',

  // Format stats
  statsRoots: (n: number) => `${n} kořenů`,
  statsRecords: (n: number) => `${n} záznamů`,
  statsEnums: (n: number) => `${n} výčtů`,
  statsFields: (n: number) => `${n} polí`,
  statsRelations: (n: number) => `${n} relací`,
  modelHierarchyHint: 'Hierarchická mapa · klikni na kontejner pro zvýraznění',
  moreFields: (n: number) => `+${n} dalších…`,

  // Search panel
  searchInLabel: 'v',
  exampleHintTable: 'tabulka',
  exampleHintEnum: 'enum',
  exampleHintLookup: 'lookup',
  exampleHintParam: 'parametr',
  exampleHintIdentifier: 'identifikátor',
  exampleHintFunction: 'funkce',
  exampleHintCalcField: 'kalkulované pole',
  searchRefCount: (n: number) => `${n} ${n === 1 ? 'odkaz' : n < 5 ? 'odkazy' : 'odkazů'} ve výrazu`,
  whereUsedSummary: (occurrences: number, files: number) => `${occurrences} ${occurrences === 1 ? 'výskyt' : occurrences < 5 ? 'výskyty' : 'výskytů'} v ${files} ${files === 1 ? 'souboru' : 'souborech'}`,
  navigateToDatasource: 'Přejít na datový zdroj',
  textOccurrences: 'Textové výskyty ve výrazech',
  inExpressions: 've výrazech',
  deadDatasource: 'Nevyužitý datový zdroj',
  deadDatasourceDesc: 'žádný binding neodkazuje na tento zdroj',

  // FnoConnectPanel status
  fnoStatusPreparing: 'Připravuji…',
  fnoStatusDownloadingDM: (n: number) => `Stahuji DataModely (${n})…`,
  fnoStatusDownloadingFM: (n: number) => `Stahuji formáty a mapování (${n})…`,
  fnoStatusResolvingDM: 'Řeším odkazované DataModely…',
  fnoStatusScanMappings: 'Stahuji konfigurace a hledám mapování…',
  fnoStatusDownloadingMM: 'Stahuji ModelMapping…',
  fnoStatusDownloadingMMCount: (n: number) => `Stahuji Model Mappings (${n})…`,
  fnoStatusLateDM: 'Řeším DataModely z křížových odkazů mapování…',
  fnoSkippedDerived: (name: string) => `„${name}" nemá vlastní XML (odvozená konfigurace) — přeskočeno.`,
  fnoSelectedCount: (n: number) => `${n} vybráno (napříč úrovněmi)`,
  fnoFilterModels: 'Filtrovat modely…',
  fnoBack: '← Zpět',
  fnoRetry: 'Zkusit znovu',
  fnoNoChildren: (name: string) => `Pod „${name}" nejsou žádné potomky.`,
  fnoDownloadInfo: 'Výběrem Formátu se automaticky stáhnou i navázané konfigurace DataModel a ModelMapping. U čistě importních formátů (např. bankovní výpisy) F&O API DataModel neposkytuje — stáhnout lze pouze konfiguraci samotného Formátu.',
  fnoCredentials: 'Přihlašovací údaje',

  // New feature translations
  embeddedMapping: 'Mapování (embedded)',
  structureFilterAll: 'Vše',
  structureFilterBound: 'Svázané',
  structureFilterUnbound: 'Nesvázané',
  whereUsedAction: 'Kde je použito',
};

const en: Translations = {
  language: 'Language',
  languageCzech: 'Czech',
  languageEnglish: 'English',
  appName: 'ER Visualizer',
  appSubtitle: 'D365 FO · Electronic Reporting',
  home: 'Home',
  loadXml: 'Load XML',
  searchPlaceholder: 'Table name, field, path…',
  search: 'Search',
  whereUsed: 'Where used',
  propRevealInExplorer: 'Reveal in Explorer',
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
  found: (n: number) => `Usages: ${n}`,
  examples: 'Examples:',

  openInExplorer: 'In Explorer, double-click the selected item to open its visualization.',
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
  explorerFilterByKind: 'Filter by kind',
  explorerSort: 'Sort',
  explorerViewFlat: 'Show flat list',
  explorerViewHierarchy: 'Show model hierarchy',
  explorerSortLoadOrder: 'Load order',
  explorerSortNameAsc: 'Name ascending (A–Z)',
  explorerSortNameDesc: 'Name descending (Z–A)',
  explorerResultsCount: (v, t) => `Showing ${v} of ${t}`,
  explorerMoreActions: 'More actions',
  explorerOpenInTab: 'Open in tab',
  detailOverview: 'Selection Overview',
  attributes: 'Attributes',
  drillSteps: (n: number) => `${n} step${n === 1 ? '' : 's'}`,
  back: 'Back',
  closeConfiguration: 'Close configuration',
  closeAllConfigurations: 'Close all',
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
  drillLabelDatasource: 'Value source',
  drillLabelTable: 'Table',
  drillLabelEnum: 'Enum',
  drillLabelClass: 'Class',
  drillLabelCalcField: 'Calculation',
  drillLabelFormula: 'Calculation rule',
  drillLabelChildren: 'Related sources',
  drillLabelExpression: 'Expression',
  drillUnbound: 'This value is not connected — no expression assigned.',
  drillNoModelMapping: 'This reference points to the model. Load the ModelMapping (.xml) file to continue.',
  drillPathNotFound: (p: string) => `Path "${p}" not found in ModelMapping.`,
  drillClickToTrace: 'Click the expression to continue to the next level →',
  drillActualPaths: 'Binding paths in ModelMapping',
  drillMore: (n: number) => `… and ${n} more`,
  drillCurrentRecord: 'Reference to the current loop record (@). The value source is defined by the parent element in the format structure.',
  drillComplexExpr: 'Complex ER function — expression cannot be traced to a single datasource.',
  drillCompoundExpr: 'Comparison expression — contains multiple model references. Click a path to drill down:',
  drillInteractiveExpr: 'ER formula — click a highlighted reference to drill down:',
  drillConstant: 'Constant value — no data source behind it.',
  drillDsNotFound: (name: string) => `Datasource "${name}" not found in loaded configurations. Check that the correct ModelMapping or Format file is loaded.`,
  drillAnalyzing: 'Expression breakdown',
  drillHintClickable: 'Click highlighted parts of the expression to break it down step by step to the data origin.',
  drillHintEmpty: 'Pick an element with a binding (formula) in the Designer — the breakdown shows where the value comes from.',
  drillStepMappingTitle: 'How model lookup works',
  drillStepDatasourceTitle: 'Where the value comes from',
  drillStepDepsTitle: 'What affects the value',
  drillStepFormulaTitle: 'Value calculation — click to continue',
  drillStepUserParameterTitle: 'Parameter expression',
  drillStepGroupedListTitle: 'Grouped list',
  drillStepAggregationTitle: (name: string) => `Aggregation: ${name}`,
  drillStepChildrenTitle: 'Related sources',
  drillRestart: 'Restart',
  drillPopOut: 'Open in dialog',
  drillOpenInTab: 'Open in new tab',
  drillClickToToggle: 'Click to show / hide expression detail',
  drillCollapsibleLabel: 'Show value breakdown',
  drillOpenExplorerFull: 'Open in Explorer →',
  drillLegendClickable: 'Clickable reference',
  drillLegendFunction: 'ER function',
  drillLegendLiteral: 'Literal',

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
  importLinkedMappingsLabel: 'Model mappings',
  importNoLinkedMappings: 'No model mappings loaded',

  statusConfigs: (n: number) => `${n} configuration${n === 1 ? '' : 's'}`,
  statusConfigsWord: 'configurations',

  // Landing page
  landingBadge: 'D365 Finance & Operations · Electronic Reporting',
  landingTitle: 'D365FO ER Visualizer',
  landingSub: 'Load ER configurations from disk or straight from a Finance & Operations environment, then trace format bindings through the model mapping down to the source table, class, or enum.',
  landingDocsLink: 'Documentation',
  landingSourceLabel: 'Configuration source',
  landingDropPrimary: 'Drop ER XML files here',
  landingDropRelease: 'Release files',
  landingDropSecondary: 'or click to browse · you can load multiple files at once',
  landingLoading: 'Loading files…',
  landingDropAriaLabel: 'Drop XML files here',
  landingPillModel: 'Data model',
  landingPillMapping: 'Model mapping',
  landingPillFormat: 'Format',
  landingErrors: 'Load errors',
  landingDismiss: 'Dismiss',
  landingLoaded: (n: number) => `${n} configuration${n === 1 ? '' : 's'} loaded`,
  landingOpen: 'Open designer',
  landingFooter: 'D365 FO ER Visualizer · Electronic Reporting Configuration Inspector',

  recentFiles: 'Recent files',
  noRecentFiles: 'No recently opened files.',
  recentReloadHint: 'Double-click to reload file',
  recentSessions: 'Recent sessions',
  recentSessionTitle: (count: number) => `Session (${count} ${count === 1 ? 'file' : 'files'})`,
  recentSessionReloadHint: 'Double-click to load the whole session',
  clearRecent: 'Clear history',
  loadSample: 'Load sample configuration',
  validatorOk: 'Configuration looks fine.',
  validatorIssues: (n: number) => `${n} warning${n === 1 ? '' : 's'}`,
  forward: 'Forward',
  commandPalette: 'Command palette',
  commandPaletteHint: 'Ctrl+K / Cmd+K',
  cmdFilter: 'Type a command or search…',
  cmdGroupNav: 'Navigation',
  cmdGroupOpen: 'Files',
  cmdGroupView: 'View',
  cmdGroupTools: 'Tools',
  cmdLoadXml: 'Load ER XML…',
  cmdToggleSearch: 'Search / Where used',
  cmdToggleExplorer: 'Toggle Explorer',
  cmdToggleProperties: 'Toggle Properties',
  cmdToggleTheme: 'Toggle light/dark theme',
  cmdToggleTechnical: 'Toggle technical view',
  cmdCollapseAll: 'Collapse entire tree',
  cmdExpandAll: 'Expand entire tree',
  cmdGoHome: 'Go to landing',
  cmdBack: 'Navigate back',
  cmdForward: 'Navigate forward',
  cmdExportWhereUsed: 'Export where-used to CSV',

  toastLoadFailed: (file: string) => `Failed to load "${file}".`,
  dismiss: 'Dismiss',

  pathClickToNavigate: 'Click to navigate →',
  pathTable: 'Table',
  pathEnum: 'Enum',
  pathClass: 'Class',
  pathCalcField: 'Calculated field',
  pathDatasource: 'Datasource',
  pathNotFound: 'Not found',

  warnings: 'Warnings',
  noWarnings: 'No warnings.',
  breadcrumbHome: 'Home',

  fnoTabLocal: 'Local files',
  fnoTabRemote: 'D365 F&O server',
  fnoHeading: 'Connect to Dynamics 365 F&O',
  fnoSubheading: 'Load ER configurations directly from an environment (CHE, Sandbox, UDE).',
  fnoProfileName: 'Profile name',
  fnoEnvUrl: 'Environment URL',
  fnoTenantId: 'Tenant ID (Entra)',
  fnoClientId: 'Application (client) ID',
  fnoSaveProfile: 'Save profile',
  fnoUpdateProfile: 'Save changes',
  fnoNewProfile: 'New profile',
  fnoConnect: 'Connect',
  fnoDisconnect: 'Disconnect',
  fnoConnecting: 'Connecting…',
  fnoConnected: (user: string) => `Connected as ${user}`,
  fnoProfiles: 'Saved profiles',
  fnoNoProfiles: 'No profile yet. Fill in the fields above and press "Save profile".',
  fnoRemoveProfile: 'Remove profile',
  fnoSolutions: 'ER solutions',
  fnoConfigurations: 'Configurations',
  fnoLoading: 'Loading…',
  fnoLoadSelected: 'Load selected',
  fnoSelectAll: 'Select all',
  fnoSelectNone: 'Clear selection',
  fnoFilterByType: 'Component type',
  fnoAllTypes: 'All',
  fnoSignInFailed: (msg: string) => `Sign-in failed: ${msg}`,
  fnoProfileSaved: (name: string) => `Profile "${name}" saved.`,
  fnoProfileUpdated: (name: string) => `Profile "${name}" updated.`,
  fnoLoadingFailed: (msg: string) => `Loading failed: ${msg}`,
  fnoDownloadFailed: (name: string, msg: string) => `Download of "${name}" failed: ${msg}`,
  fnoLoadedCount: (n: number) => `Loaded ${n} configuration${n === 1 ? '' : 's'} from F&O.`,
  fnoMappingNotAvailable: (names: string[]) => `ModelMapping could not be downloaded for: ${names.join(', ')}. Format element bindings are still available via FormatMapping.`,
  fnoMappingNoDataModel: 'No ModelMapping was attempted — the downloaded format carries no data model GUID, so there is nothing to resolve a mapping against. Select the data model (or its mapping) in the tree as well.',

  // Property inspector labels
  propDescription: 'Description',
  propVersion: 'Version',
  propVendor: 'Vendor',
  propStatus: 'Status',
  propBase: 'Base',
  propBaseGuid: 'Base GUID',
  propKind: 'Kind',
  propLabelsCount: (n: number) => `${n} entries`,
  propLabel: 'Label',
  propFields: 'Fields',
  propIsRoot: 'Is Root',
  propIsEnum: 'Is Enum',
  propTypeDescriptor: 'Type Descriptor',
  propHost: 'Host',
  propParentPath: 'Parent Path',
  propTable: 'Table',
  propCrossCompany: 'Cross-Company',
  propSelectedFields: 'Selected Fields',
  propEnumName: 'Enum Name',
  propEnumType: 'Enum Type',
  propImportFormatGuid: 'Import Format GUID',
  propClassName: 'Class Name',
  propEdt: 'EDT',
  propVisibilityExpr: 'Visibility Expr',
  propModelPath: 'Model Path',
  propSyntaxVersion: 'Syntax Version',
  propCondition: 'Condition',
  propMessage: 'Message',
  propRule: (n: number) => `Rule ${n}`,
  propProperty: 'Property',
  propValueDefault: 'Value (default)',
  propMappingVersion: 'Mapping Version',
  propModel: 'Model',
  propModelVersion: 'Model Version',
  propDatasources: 'Datasources',
  propBindings: 'Bindings',
  propValidations: 'Validations',
  propModelGuid: 'Model GUID',
  propModelVersionRaw: 'Model Version (raw)',
  propRootContainer: 'Root Container',
  propMappingRevision: 'Mapping Revision',
  propValues: 'Values',
  propListToGroup: 'List to Group',
  propCompleted: 'Completed',
  propNo: 'No',
  propComponentGuid: 'Component GUID',

  // Error boundary
  errorLabel: 'Error',
  errorTitle: 'Something went wrong.',
  errorDescription: 'This part of the application encountered an unexpected error. The rest of the application should continue to work.',
  errorRetry: 'Try again',

  // Excel preview
  excelWorkbook: 'Excel Workbook',
  excelInput: 'Input',
  excelOutput: 'Output',
  excelRangeCount: (n: number) => `${n} range${n === 1 ? '' : 's'}`,
  excelCellCount: (n: number) => `${n} cell${n === 1 ? '' : 's'}`,
  excelNoSheets: 'No Excel sheets found in format structure.',
  excelEmptySheet: 'Empty sheet',
  excelHeader: 'Header',
  excelFooter: 'Footer',
  excelRepeatingVertical: 'repeating vertical',
  excelRepeatingHorizontal: 'repeating horizontal',
  excelLegendDynamic: 'data-bound',
  excelLegendConstant: 'resolved from expression',
  excelTemplateView: 'Template',
  excelShowTemplate: 'Show Excel template',
  excelTemplateLoading: 'Loading Excel template…',
  excelTemplateError: 'Error reading template',
  excelStructureView: 'Structure',
  excelTemplateCells: (n: number) => `${n} cell${n === 1 ? '' : 's'}`,
  excelTemplateMerged: (n: number) => `${n} merged`,
  excelTemplateDropHint: 'Drop the .xlsx file from the exported ER solution package here',
  excelTemplateDropActive: 'Release to load .xlsx…',
  excelTemplateDropInvalid: '.xlsx files only',
  excelTemplateLoadBtn: 'Load template (.xlsx)',
  previewLabel: 'Preview',
  previewDescription: 'File structure preview — constant values are resolved from binding expressions. Dynamic values (datasource paths, functions) are shown as {placeholders}.',

  // Format stats
  statsRoots: (n: number) => `${n} root${n === 1 ? '' : 's'}`,
  statsRecords: (n: number) => `${n} record${n === 1 ? '' : 's'}`,
  statsEnums: (n: number) => `${n} enum${n === 1 ? '' : 's'}`,
  statsFields: (n: number) => `${n} field${n === 1 ? '' : 's'}`,
  statsRelations: (n: number) => `${n} relation${n === 1 ? '' : 's'}`,
  modelHierarchyHint: 'Hierarchy map · click a container to highlight',
  moreFields: (n: number) => `+${n} more…`,

  // Search panel
  searchInLabel: 'in',
  exampleHintTable: 'table',
  exampleHintEnum: 'enum',
  exampleHintLookup: 'lookup',
  exampleHintParam: 'parameter',
  exampleHintIdentifier: 'identifier',
  exampleHintFunction: 'function',
  exampleHintCalcField: 'calc. field',
  searchRefCount: (n: number) => `${n} reference${n === 1 ? '' : 's'} in expression`,
  whereUsedSummary: (occurrences: number, files: number) => `${occurrences} occurrence${occurrences === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`,
  navigateToDatasource: 'Navigate to datasource',
  textOccurrences: 'Text occurrences in expressions',
  inExpressions: 'in expressions',
  deadDatasource: 'Dead datasource',
  deadDatasourceDesc: 'no binding references this source',

  // FnoConnectPanel status
  fnoStatusPreparing: 'Preparing…',
  fnoStatusDownloadingDM: (n: number) => `Downloading DataModels (${n})…`,
  fnoStatusDownloadingFM: (n: number) => `Downloading Formats & Mappings (${n})…`,
  fnoStatusResolvingDM: 'Resolving referenced DataModels…',
  fnoStatusScanMappings: 'Downloading configurations & scanning for mappings…',
  fnoStatusDownloadingMM: 'Downloading Model Mappings…',
  fnoStatusDownloadingMMCount: (n: number) => `Downloading Model Mappings (${n})…`,
  fnoStatusLateDM: 'Resolving DataModels from mapping cross-references…',
  fnoSkippedDerived: (name: string) => `"${name}" has no own XML (derived configuration) — skipped.`,
  fnoSelectedCount: (n: number) => `${n} selected (across levels)`,
  fnoFilterModels: 'Filter models…',
  fnoBack: '← Back',
  fnoRetry: 'Retry',
  fnoNoChildren: (name: string) => `No children under "${name}".`,
  fnoDownloadInfo: 'Selecting a Format automatically downloads its linked DataModel and ModelMapping configurations as well. For purely import formats (e.g. bank statements), F&O API does not expose the DataModel — only the Format configuration itself can be downloaded.',
  fnoCredentials: 'Credentials',

  // New feature translations
  embeddedMapping: 'Mapping (embedded)',
  structureFilterAll: 'All',
  structureFilterBound: 'Bound',
  structureFilterUnbound: 'Unbound',
  whereUsedAction: 'Where used',
};

export let t: Translations = locale === 'cs' ? cs : en;
