import { useSyncExternalStore } from 'react';

/** Czech plural form: 1 → `one`, 2–4 → `few`, 0 and 5+ → `many`. */
export function csPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  if (abs >= 2 && abs <= 4) return few;
  return many;
}

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
  /** Short code of the active language, shown on the language toggle. */
  languageCode: string;
  /** Name of the active language, in that language. */
  languageCurrent: string;
  home: string;
  loadXml: string;
  searchPlaceholder: string;
  search: string;
  propRevealInExplorer: string;
  whereUsedPlaceholder: string;
  whereUsedLabel: string;
  find: string;
  hideExplorer: string;
  showExplorer: string;
  showDetails: string;
  hideDetails: string;
  /* The theme switch names the mode it is in, as `<themeLabel>: <mode>` — the
     same wording the marketing site uses, translated. */
  themeLabel: string;
  lightTheme: string;
  darkTheme: string;
  systemTheme: string;
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
  /** Touch equivalent: double-click is not a reliable gesture on a tablet. */
  openInExplorerTouch: string;
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
  filterRecent: string;
  filterSuggestions: string;
  filterMatchCount: (n: number) => string;
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
  explorerActiveMapping: string;
  explorerActiveMappingHint: string;
  detailOverview: string;
  attributes: string;
  drillSteps: (n: number) => string;
  back: string;
  closeConfiguration: string;
  closeAllConfigurations: string;
  workspaceManager: string;
  workspaceLoaded: string;
  workspaceEmpty: string;
  workspaceAddRecent: string;
  workspaceAdd: string;
  workspaceAddFiles: string;
  workspaceAvailable: string;
  workspaceAvailableEmpty: string;
  workspaceFilterPlaceholder: string;
  workspaceReopenAll: string;
  workspaceAddFromFno: string;
  workspaceSourceFile: string;
  workspaceSourceFno: string;
  workspaceRemoveFromCache: string;
  workspaceLinkedTo: (model: string) => string;
  workspaceUnlinked: string;
  workspaceClosedHint: string;
  workspaceNoMatch: string;
  depPromptTitle: string;
  depPromptBodyFormat: (name: string) => string;
  depPromptBodyMapping: (name: string) => string;
  depPromptBodyModel: (name: string) => string;
  depPromptBodyFno: (name: string) => string;
  depPromptConfirm: string;
  depPromptOnlyThis: string;
  depPromptCancel: string;
  fnoIngestTitle: string;
  fnoIngestDone: string;
  fnoIngestSummary: (done: number, total: number) => string;
  fnoIngestFailed: (n: number) => string;
  fnoIngestEmpty: (n: number) => string;
  fnoIngestExplicit: string;
  fnoIngestAuto: string;
  fnoIngestStatusQueued: string;
  fnoIngestStatusDownloading: string;
  fnoIngestStatusDone: string;
  fnoIngestStatusEmpty: string;
  fnoIngestStatusSkipped: string;
  fnoIngestStatusFailed: string;
  fnoIngestNoId: string;
  fnoIngestHint: string;
  fnoIngestClose: string;
  fnoIngestOpenWorkspace: string;
  explorerUnlinked: string;
  explorerLoading: string;
  fnoFooterIdle: string;
  fnoFooterDownloading: string;
  openInExplorerAction: string;
  explorerActionShort: string;
  noSelection: string;
  selectElementHint: string;
  viewLabel: string;
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
  drillTriggerHint: string;
  drillTriggerTabHint: string;
  drillCollapsibleLabel: string;
  drillOpenExplorerFull: string;
  drillLegendClickable: string;
  drillLegendFunction: string;
  drillLegendLiteral: string;
  drillZoomIn: string;
  drillZoomInto: (name: string) => string;
  drillCurrentPart: string;
  drillUsedDataTitle: string;
  drillUsedDataHint: string;
  drillUsedDataEmpty: string;
  drillLabelTitle: string;
  drillLabelHint: string;
  drillLabelId: string;
  drillLabelElement: string;
  drillLabelEmpty: string;
  resizeDialog: string;
  drillHowFilledTitle: string;
  drillHowFilledHint: string;
  lineageTitle: string;
  lineageHint: string;
  lineageFormulaLabel: string;
  lineageExpand: string;
  lineageCollapse: string;
  lineageShowInPath: (name: string) => string;
  lineageOpenSegment: (path: string) => string;
  lineagePeekTitle: string;
  lineagePeekEmpty: string;
  lineagePeekClose: string;
  lineageStageOrigin: string;
  lineageStageModelPath: string;
  lineageModelDefinition: string;
  lineageModelDefinitionTitle: string;
  lineageStageMapping: string;
  lineageStageSource: string;
  lineageStageFormula: string;
  lineageStageUserParam: string;
  lineageStageGroupBy: string;
  lineageStageEntity: string;
  lineageStageUnresolved: string;
  drillFormulaMapping: string;
  drillFocusModelPath: string;
  drillFocusExpression: string;
  drillOriginalExpression: string;
  drillForward: string;
  drillSourcePropsTitle: string;
  drillHowFilledHintSingle: string;
  drillHowFilledHintMany: string;
  drillSourceDetailTitle: string;
  drillSourceTarget: string;
  drillUserParameterNote: string;
  // Results / counts
  searchResultCount: (n: number) => string;
  propChildren: string;
  propDataType: string;
  propExcelRange: string;
  // Property inspector
  propId: string;
  propType: string;
  propName: string;
  propEncoding: string;
  propMaxLen: string;
  propValue: string;
  propTransform: string;
  propTransformUnnamed: string;
  propExcluded: string;
  propYes: string;
  propDirection: string;
  formatDirectionImport: string;
  formatDirectionExport: string;
  formatDirectionUnknown: string;
  importLinkedMappingsLabel: string;
  importNoLinkedMappings: string;
  // Landing page – hero
  landingBadge: string;
  landingTitle: string;
  landingSub: string;
  landingDocsLink: string;
  landingHomeLinkLabel: string;
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
  undo: string;
  removeFromHistory: string;
  historyFileRemoved: (name: string) => string;
  historyFilesCleared: (n: number) => string;
  historySessionsCleared: (n: number) => string;
  workspaceClosedAll: (n: number) => string;
  workspaceUndoCloseAll: string;
  fnoRemoveProfileConfirmTitle: (name: string) => string;
  fnoRemoveProfileConfirmBody: string;
  cancel: string;
  modelViewLabel: string;
  modelViewList: string;
  modelViewGraph: string;
  modelListFilterPlaceholder: string;
  modelListLabel: string;
  modelListMoreMatches: (n: number) => string;
  recentSessionLoadFailed: (reason: string) => string;
  splitResize: string;
  searchShowMore: (next: number, remaining: number) => string;
  drillTruncated: string;
  fnoIngestCancel: string;
  landingOpen: string;
  // Landing page – footer
  landingFooter: string;

  // Recent files, samples, validator, shortcuts, forward nav
  recentFiles: string;
  recentConfigs: string;
  recentOpen: string;
  recentAddToOpen: string;
  recentMoreActions: string;
  recentSourceFile: string;
  recentSourceFiles: string;
  recentSourceFileNamed: (file: string) => string;
  recentSourceFno: string;
  recentSourceFnoHost: (host: string) => string;
  recentBundledFrom: (file: string) => string;
  recentNotCached: string;
  recentNotCachedHint: string;
  recentOpenConfigHint: string;
  recentSessionUnavailable: string;
  recentSessionContents: (n: number) => string;
  recentSessionCount: (n: number) => string;
  recentShowAll: (n: number) => string;
  recentShowLess: string;
  recentFilterPlaceholder: string;
  noRecentFiles: string;
  clearRecent: string;
  recentReloadHint: string;
  recentSessions: string;
  recentSessionTitle: (count: number) => string;
  recentSessionMergeHint: string;
  recentSessionReplaceHint: string;
  recentSessionFileHint: string;
  loadSample: string;
  validatorOk: string;
  validatorIssues: (n: number) => string;
  forward: string;
  /** Explorer kebab menu — the only survivors of the removed command palette. */
  cmdCollapseAll: string;
  cmdExpandAll: string;
  cmdExportWhereUsed: string;

  // Toasts / errors
  toastLoadFailed: (file: string) => string;
  dismiss: string;
  panelMaximize: string;
  panelRestore: string;
  panelClose: string;

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
  fnoProfileNameHint: string;
  fnoEnvUrl: string;
  fnoEnvUrlHint: string;
  fnoEnvUrlInvalid: string;
  fnoSignInHint: string;
  fnoMissingBuiltInClientId: string;
  fnoRedirectUriHint: string;
  fnoRedirectUriCopy: string;
  fnoRedirectUriCopied: string;
  fnoSaveProfile: string;
  fnoUpdateProfile: string;
  fnoNewProfile: string;
  fnoNewProfileTitle: string;
  fnoEditProfileTitle: string;
  fnoEditProfile: string;
  fnoCancel: string;
  fnoConnect: string;
  fnoDisconnect: string;
  fnoConnecting: string;
  fnoConnected: (user: string) => string;
  fnoProfiles: string;
  fnoNoProfiles: string;
  fnoNoProfilesHint: string;
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
  fnoIngestAborted: (message: string) => string;
  excelCellGoToStructure: string;
  statusDerivedFromModel: string;
  statusDerivedFromModelTitle: (kind: string, parentName: string) => string;
  statusGuidCount: (n: number) => string;
  fnoMappingNotAvailable: (names: string[]) => string;
  fnoMappingNoDataModel: string;
  fnoModelIdNotExposed: (names: string[]) => string;
  fnoImportMappingNotFound: (names: string[]) => string;

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
  propNotBound: string;
  propValidations: string;
  /** Empty state of the model-mapping designer's Validations tab. */
  mappingNoValidations: string;
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
  errorChunkTitle: string;
  errorChunkDescription: string;
  errorReload: string;

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
  excelTemplateImage: string;
  excelTemplateImages: (n: number) => string;
  excelTemplateDropHint: string;
  excelTemplateDropActive: string;
  excelTemplateDropInvalid: string;
  excelTemplateLoadBtn: string;
  pdfConvertedFrom: (source: string) => string;
  pdfNoSourceComponent: string;
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
  fnoStatusResolvingLabels: string;
  fnoStatusScanMappings: string;
  fnoStatusDownloadingMM: string;
  fnoStatusDownloadingMMCount: (n: number) => string;
  fnoStatusLateDM: string;
  fnoSkippedDerived: (name: string) => string;
  fnoSkippedDraft: (name: string) => string;
  fnoDraftOnly: string;
  fnoDraftOnlyHint: string;
  fnoSelectedCount: (n: number) => string;
  fnoSelectedCountLabel: string;
  treeCollapseNode: string;
  treeExpandNode: string;
  fnoPickModelHint: string;
  fnoNoConfigurationsHint: string;
  fnoFilterModels: string;
  fnoFilterConfigurations: string;
  fnoSearchEverywhere: string;
  fnoSearchEverywhereHint: string;
  fnoSearchResults: (query: string) => string;
  fnoSearchProgress: (done: number, total: number) => string;
  fnoSearchHits: (n: number) => string;
  fnoSearchNoHits: (query: string) => string;
  fnoSearchClear: string;
  fnoNoModelMatch: (query: string) => string;
  fnoNoModelMatchHint: string;
  fnoSearchOpenModel: (model: string) => string;
  fnoSearchFailed: (n: number) => string;
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

  // Audit fixes (a11y labels, former inline ternaries)
  designerWorkspaceEyebrow: string;
  designerUnsupportedView: (kind: string) => string;
  excelLegendConstantWord: string;
  dsCrossCompany: string;
  dsNestedCount: (n: number) => string;
  dsGroupBy: string;
  dsAggregated: string;
  dsImplicitType: string;
  dsImplicitHint: string;
  dsModelField: string;
  dsModelNotLoaded: string;
  bindingCount: (n: number) => string;
  bindingVia: string;
  searchNoResultsInScope: string;
  searchRelatedOnly: string;
  searchRelatedOnlyHint: string;
  searchAllConfigs: string;
  searchAllConfigsHint: string;
  searchRelatedEmpty: string;
  searchHiddenByRelated: (n: number) => string;
  searchHiddenByRelatedShort: (n: number) => string;
  searchGroupDefinition: (name: string) => string;
  searchGroupDefinitionHint: (name: string) => string;
  searchCatStructure: string;
  searchCatBindings: string;
  searchCatExpressions: string;
  searchCatDatasources: string;
  searchCatReferences: string;
  wuCatBindings: string;
  wuCatExpressions: string;
  wuCatFormat: string;
  pathSegmentDatasource: string;
  tooltipClickToNavigate: string;
  activityBarLabel: string;
  propLabels: string;
  propUnknownType: (type: string) => string;
  labelTextNotFound: string;
  kindDataModel: string;
  kindModelMapping: string;
  kindFormat: string;
  nodeTypeLabel: (type: string) => string;
  closeTab: (label: string) => string;
  splitOpenBeside: string;
  splitOpenLeft: string;
  splitOpenRight: string;
  splitMoveLeft: string;
  splitMoveRight: string;
  splitCloseSideGroup: string;
  splitCloseMainGroup: string;
  drillPinAsTab: string;
  drillOpenBeside: string;
  drillOpenBesideHint: string;
  notificationsLabel: string;
  drillOpenAsTab: string;
  // Model designer badges, text preview, error boundary areas
  modelRootBadge: string;
  modelEnumBadge: string;
  previewRepeatingStart: (name: string) => string;
  previewRepeatingEnd: (name: string) => string;
  excelSheet: string;
  excelRange: string;
  excelCell: string;
  formatTypeFile: string;
  errorAreaLanding: string;
  errorAreaDesigner: string;
  validationActionBadge: (value: string) => string;
  validationSeverityBadge: (value: string) => string;
  // F&O connection panel
  fnoRootNoSolutions: (root: string) => string;
  fnoNoSolutionsFound: string;
  fnoCustomRootHint: string;
  fnoCustomRootPlaceholder: string;
  fnoTypeMapping: string;
  fnoTypeModel: string;
  fnoUnreachableMapping: string;
  fnoNoDownloadableContent: string;
  fnoBranchNodeHint: string;
  fnoViaParent: string;
  fnoDrillInto: string;
  fnoUnknownError: string;
  fnoErrServiceNotFound: (url: string, serviceUrl: string, operation: string) => string;
  fnoErrEndpointNotFound: (status: string) => string;
  fnoErrForbidden: (status: string) => string;
  fnoErrRedirectDesktop: string;
  fnoErrRedirectWeb: (uri: string) => string;
  fnoErrClientIdUnavailable: string;
  fnoErrConsentRequired: string;
  fnoErrScopeMismatch: string;
  fnoErrWrongTenant: string;
  fnoErrCodeUsed: (code: string) => string;
  fnoErrMfaRequired: (code: string) => string;
  fnoErrPublicClientFlows: string;
  fnoErrRedirectIsSpa: string;

  // ─── F&O sign-in module loading (fno/auth-factory.ts) ───
  fnoAuthModuleLoadFailed: (moduleName: string) => string;
  fnoAuthElectronBridgeMissing: string;

  // ─── File loading (utils/file-loading.ts) ───
  fileNotXml: string;

  // ─── Format binding sections (utils/format-binding-sections.ts, format-binding-display.ts) ───
  bindingIntentLabels: Record<'direct' | 'calculated' | 'condition' | 'text' | 'property', string>;
  bindingIntentItemLabels: Record<'direct' | 'calculated' | 'condition' | 'text' | 'property', string>;
  bindingIntentHints: Record<'direct' | 'calculated' | 'condition' | 'text' | 'property', string>;
  formatBindingCategoryLabels: Record<'data' | 'visibility' | 'formatting' | 'property', string>;
  formatBindingValueBadge: string;

  // ─── Configuration warnings (state/config-warnings.ts) ───
  warnLoadDataModelForDrillDown: string;
  warnFormatWithoutMapping: string;
  warnBrokenDatasourceRefs: (formatName: string, count: number, detail: string, hidden: number) => string;

  // ─── Explorer tree section labels (state/tree-builder.ts) ───
  treeDsGroupLabels: Record<string, string>;
  treeDataModelSections: { roots: string; enums: string; records: string };
  treeMappingSections: { title: string; dataSources: string; bindings: string; validations: string };
  treeFormatSections: { outputStructure: string; modelMappings: string; enumerations: string; transformations: string; dataSources: string; bindings: string; noBindings: string };
  treeGroupBySections: { groupedBy: string; aggregated: string };
  groupOther: string;
  treeEmbeddedMappingUsedSuffix: string;

  // ─── Store toasts (state/store.ts) ───
  toastNewerVersionOpen: (fileName: string, version: string | number, loadedVersion?: string | number) => string;
  toastLoadFailedWithMessage: (fileName: string, message: string) => string;
  toastConfigClosed: (name: string) => string;
  toastReopen: string;
  toastSessionNotCached: string;
  toastSessionFilesMissing: (files: string) => string;
  toastAlreadyOpen: (label: string) => string;
  toastFileNotCached: (label: string) => string;

  // ─── Path tooltip rows (utils/path-tooltip.ts) ───
  pathTipInside: string;
  pathTipReadsTables: string;
  pathTipCallsClasses: string;
  pathTipViaCalcFields: string;
  pathTipOpenDatasource: string;
  pathTipOpenBinding: string;
  pathTipSource: string;
  pathTipTableField: string;
  pathTipClassMember: string;
  pathTipEnumValue: string;
  pathTipDatasourceField: string;
  pathTipModelField: string;
  pathTipMappingBinding: string;
  pathTipRecord: string;
  pathTipRecordFieldsBound: (n: number) => string;
  pathTipNearestBinding: string;
  pathTipMapping: string;
  pathTipNoBinding: string;
  pathTipModelRoot: string;
  pathTipDataModel: string;
  pathTipUserParameter: string;

  // ─── Consultant view words (utils/consultant-labels.ts) ───
  consultantFormatTypeLabels: Record<string, string>;
  consultantElementFallback: string;
  consultantDataTypeLabels: Record<string, string>;
  consultantFieldTypeLabels: Record<number, string>;
  consultantBindingCategoryLabels: Record<'data' | 'visibility' | 'formatting' | 'property', string>;
  consultantPropertyLabels: Record<string, string>;
  consultantTurnedOff: string;
  consultantTurnedOn: string;
  consultantCondition: string;

  // ─── Enum type labels (utils/enum-display.ts) ───
  enumTypeLabels: Record<'Ax' | 'DataModel' | 'Format', string>;

  // ─── Configuration kind labels (DependencyPromptDialog.tsx, ConfigExplorer.tsx) ───
  configKindLabels: { DataModel: string; ModelMapping: string; Format: string };
  explorerKindPills: { DataModel: string; ModelMapping: string; Format: string };
  explorerGroupLabels: { DataModel: string; ModelMapping: string; Format: string };
  explorerChipLabels: { DataModel: string; ModelMapping: string; Format: string };

  // ─── F&O ingest steps (FnoIngestPanel.tsx) ───
  fnoIngestSteps: { prepare: string; dm: string; fm: string; mm: string; finalize: string };

  // ─── Data source groups (designers/DatasourceTree.tsx) ───
  dsGroupLabelsTechnical: Record<string, string>;
  dsGroupLabelsConsultant: Record<string, string>;
  dsImportFormat: string;
  dsGroupedBy: string;

  // ─── Data model designer (designers/DataModelDesigner.tsx) ───
  dmDesignerTitle: string;
  dmDatasourceProperties: string;
  dmNoRelevantBindings: string;

  // ─── Format designer tabs (designers/FormatDesigner.tsx) ───
  fmtTabStructureTitle: string;
  fmtTabBindingsTitle: string;
  fmtTabDatasourcesTitle: string;
  fmtTabPreviewTitle: string;
  fmtTabEmbeddedMapping: string;
  fmtTabEmbeddedMappingTitle: string;
  fmtElementsOutsideStructure: string;

  // ─── Format preview (designers/FormatPreview.tsx) ───
  previewUnresolvedValues: string;
  previewSampleData: string;
  previewKeepPlaceholder: string;
  previewHideUnresolved: string;
  previewCsvView: string;
  previewFirstRowHeader: string;

  // ─── Model mapping designer (designers/ModelMappingDesigner.tsx) ───
  mmDefinitionTitleTechnical: string;
  mmDefinitionTitle: string;
  mmDefinition: string;
  mmClickToSwitch: (title: string) => string;
  mmDesignerTitle: string;
  mmDesignerHint: string;
  mmRuleCount: (n: number) => string;
  mmBranchBindingCount: (n: number) => string;

  // ─── Search panel (SearchPanel.tsx) ───
  searchExampleSections: { mapping: string; calc: string; output: string };
  searchExamplePresets: { model: string; companyInfo: string; labels: string; round: string; conditional: string; calculated: string; dateFormat: string; numberFormat: string; concatenate: string };
  whereUsedExampleSections: { impact: string; trace: string };
  whereUsedExamplePresets: { table: string; enumType: string; lookup: string; parameter: string; ledgerAccount: string; calculated: string };
  searchShowingFirst: (shown: number, total: number) => string;
  searchScopeResultsAria: string;
  whereUsedScopeAria: string;
  searchReachAria: string;
  searchScopeAll: string;
  searchScopeFormat: string;
  searchScopeMapping: string;
  searchScopeModel: string;
  searchMinChars: (n: number) => string;
  searchLblFormatExpression: string;
  searchLblVisibility: string;
  searchLblFormatting: string;
  searchLblProperty: string;
  searchLblTable: string;
  searchLblEnum: string;
  searchLblClass: string;
  searchLblParameter: string;
  searchLblField: string;
  searchLblBinding: string;
  searchLblExpression: string;
  searchLblCalcField: string;
  searchLblFieldType: string;
  searchLblModelRef: string;
  searchLblBaseRef: string;
  searchLblFormatRef: string;
  searchLblReference: string;
  searchLblUnresolvedRef: string;
  searchExprSource: (component: string) => string;
  searchExprParam: (component: string) => string;
  searchKindLabels: { Format: string; ModelMapping: string; DataModel: string };
  searchTabDatasources: string;
  searchLocalizeBindingKind: (label: string) => string;
  searchRefKindLabels: { calc: string; param: string; agg: string; validation: string; message: string };

  // ─── Format bindings view (designers/FormatBindingsView.tsx) ───
  fbReadsPrefix: string;
  fbReadsSuffix: (n: number) => string;
  fbMappingPrefix: string;
  fbMappingNotLoadedFor: (descriptor: string | null | undefined) => string;
  fbUnmappedCount: (n: number) => string;
  fbLoadModelForLabels: string;
  fbOnlyUnmappedHint: string;
  fbOnlyUnmapped: string;
  fbAllFieldsMapped: string;
  fbBranchUnmappedCount: (n: number) => string;
  fbUsageCount: (n: number) => string;
  fbLineMapping: string;
  fbFieldNeverFilledHint: string;
  fbNoMappingBinding: string;
  fbMappingNotLoaded: string;
  fbRecordFieldsBound: string;
  fbLineFormat: string;
  fbMoreUsages: (n: number) => string;
  fbLayoutByFormat: string;
  fbLayoutByFormatHint: string;
  fbLayoutByModel: string;
  fbLayoutByModelHint: string;
  fbToolbarAria: string;
  fbLayoutAria: string;
  fbNothingInSelectedTypes: (hiddenList: string) => string;
  fbShowAll: string;
  fbHiddenByFilter: (n: number) => string;

  // ─── Drill-down panel (DrillDownPanel.tsx) ───
  drillBadgeLabels: Record<string, string>;
  drillBadgeGroupLabels: Record<string, string>;
  drillSourceFallback: string;
  drillRuleStop: string;
  drillRuleWarning: string;
  drillUnresolved: string;
  drillMappingNode: string;
  drillParamEnteredAtRunTime: string;
  drillNoDataReference: string;
  drillCopy: string;
  drillCopied: (value: string) => string;
  drillCopyFailed: string;
  drillAutoCompact: (nodes: number) => string;
  drillViewAria: string;
  drillViewDetailHint: string;
  drillViewDetail: string;
  drillViewTreeHint: string;
  drillViewTree: string;
  drillLabelModeAria: string;
  drillCompactHint: string;
  drillCompact: string;
  drillFullHint: string;
  drillFull: string;
  drillShowUnresolvedHint: string;
  drillValidationDetails: string;
  drillRuleCount: (n: number) => string;

  // ─── Where-used text matches (state/where-used.ts) ───
  whereUsedTextMatchName: (query: string) => string;
}

// ─── Translation dictionaries ─────────────────────────────────────────────

const cs: Translations = {
  // App shell
  appName: 'ER Visualizer',
  appSubtitle: 'D365 FO · Electronic Reporting',
  language: 'Jazyk',
  languageCzech: 'Čeština',
  languageEnglish: 'Angličtina',
  languageCode: 'CZ',
  languageCurrent: 'Čeština',
  home: 'Domů',
  loadXml: 'Načíst XML',
  searchPlaceholder: 'Název tabulky, pole, cesty…',
  search: 'Hledat',
  propRevealInExplorer: 'Zobrazit v Exploreru',
  whereUsedPlaceholder: 'např. TaxTrans, CustTable, MyCalcField…',
  whereUsedLabel: 'Zadejte název tabulky, výčtu, třídy nebo datového zdroje:',
  find: 'Najít',
  hideExplorer: 'Skrýt Explorer',
  showExplorer: 'Zobrazit Explorer',
  showDetails: 'Zobrazit detaily',
  hideDetails: 'Skrýt detaily',
  themeLabel: 'Motiv',
  lightTheme: 'Světlý',
  darkTheme: 'Tmavý',
  systemTheme: 'Podle systému',
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
  openInExplorerTouch: 'V Exploreru klepněte na ⋮ u prvku a zvolte Otevřít v záložce.',
  collapse: 'Sbalit vše',
  expand: 'Rozbalit vše',
  filter: 'Filtrovat…',
  structure: 'Struktura',
  bindings: 'Vazby',
  dataSources: 'Datové zdroje',
  elements: 'prvků',
  bound: 'vázaných',
  unbound: 'nevázaných',
  structural: 'strukturních',
  statsTooltip: (b: number, u: number, s: number) => `${b} vázaných + ${u} nevázaných + ${s} strukturních`,
  transforms: 'transformací',
  clearFilter: 'Vymazat filtr',
  filterRecent: 'Naposledy hledané',
  filterSuggestions: 'Návrhy filtru',
  filterMatchCount: (n: number) => `Počet shod: ${n}`,
  clearSearch: 'Vymazat hledání',
  clearWhereUsedSearch: 'Vymazat hledání míst použití',
  noConfigurationsLoaded: 'Nejsou načtené žádné konfigurace.',
  loadXmlHint: 'Klikněte na Načíst XML pro import ER konfiguračních souborů.',
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
  explorerActiveMapping: 'aktivní',
  explorerActiveMappingHint: 'Tuto definici modelu používá aktivní formát',
  detailOverview: 'Přehled výběru',
  attributes: 'Atributy',
  drillSteps: (n: number) => `${n} ${csPlural(n, 'krok', 'kroky', 'kroků')}`,
  back: 'Zpět',
  closeConfiguration: 'Zavřít konfiguraci',
  closeAllConfigurations: 'Zavřít vše',
  workspaceManager: 'Správa pracovní plochy',
  workspaceLoaded: 'Načtené konfigurace',
  workspaceEmpty: 'Žádná konfigurace není načtena.',
  workspaceAddRecent: 'Přidat z nedávných',
  workspaceAdd: 'Přidat do pracovní plochy',
  workspaceAddFiles: 'Přidat soubory…',
  workspaceAvailable: 'K dispozici (zavřené / v mezipaměti)',
  workspaceAvailableEmpty: 'Žádné další konfigurace v mezipaměti.',
  workspaceFilterPlaceholder: 'Filtrovat konfigurace…',
  workspaceReopenAll: 'Otevřít vše',
  workspaceAddFromFno: 'Přidat z F&O…',
  workspaceSourceFile: 'Soubor',
  workspaceSourceFno: 'F&O',
  workspaceRemoveFromCache: 'Odebrat z mezipaměti',
  workspaceLinkedTo: (model: string) => `Model: ${model}`,
  workspaceUnlinked: 'Bez načteného modelu',
  workspaceClosedHint: 'Zavřené konfigurace zůstávají v mezipaměti prohlížeče a lze je kdykoli znovu otevřít.',
  workspaceNoMatch: 'Filtru neodpovídá žádná konfigurace.',
  depPromptTitle: 'Načíst také související konfigurace?',
  depPromptBodyFormat: (name: string) => `Formát „${name}“ se opírá o datový model a jeho mapování. Bez nich neuvidíte vazby až na zdrojové tabulky.`,
  depPromptBodyMapping: (name: string) => `Mapování „${name}“ patří k datovému modelu. Bez něj nelze zobrazit strukturu modelu.`,
  depPromptBodyModel: (name: string) => `K modelu „${name}“ jsou v mezipaměti další konfigurace.`,
  depPromptBodyFno: (name: string) => `K formátu „${name}“ jsem v aktuálním seznamu našel související konfigurace. Přidat je do výběru ke stažení?`,
  depPromptConfirm: 'Načíst vybrané',
  depPromptOnlyThis: 'Jen tuto konfiguraci',
  depPromptCancel: 'Zrušit',
  fnoIngestTitle: 'Stahování konfigurací z F&O',
  fnoIngestDone: 'Stahování dokončeno',
  fnoIngestSummary: (done: number, total: number) => `${done} z ${total} hotovo`,
  fnoIngestFailed: (n: number) => `${n} selhalo`,
  fnoIngestEmpty: (n: number) => `${n} bez obsahu`,
  fnoIngestExplicit: 'vybráno',
  fnoIngestAuto: 'závislost',
  fnoIngestStatusQueued: 'Ve frontě',
  fnoIngestStatusDownloading: 'Stahuji…',
  fnoIngestStatusDone: 'Hotovo',
  fnoIngestStatusEmpty: 'Bez vlastního XML',
  fnoIngestStatusSkipped: 'Přeskočeno',
  fnoIngestStatusFailed: 'Selhalo',
  fnoIngestNoId: 'F&O nevrací ID',
  fnoIngestHint: 'Datové modely a mapování se doplňují automaticky podle vazeb ve staženém XML.',
  fnoIngestClose: 'Zavřít',
  fnoIngestOpenWorkspace: 'Otevřít pracovní plochu',
  explorerUnlinked: 'Nepřiřazeno',
  explorerLoading: 'Načítám',
  fnoFooterIdle: 'Vyberte konfigurace ke stažení',
  fnoFooterDownloading: 'Stahování konfigurací…',
  openInExplorerAction: 'Otevřít v Exploreru',
  explorerActionShort: 'Explorer',
  noSelection: 'Není vybraný žádný prvek.',
  selectElementHint: 'Vyberte v Exploreru nebo v návrháři uzel, jehož vlastnosti chcete zobrazit.',
  viewLabel: 'Pohled',

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
  drillNoModelMapping: 'Tento odkaz míří do modelu. Pro rozpad načtěte soubor ModelMapping (.xml).',
  drillPathNotFound: (p: string) => `Cesta „${p}" nebyla nalezena v ModelMapping.`,
  drillClickToTrace: 'Klikněte na výraz a pokračujte do další úrovně →',
  drillActualPaths: 'Cesty vazeb v ModelMapping',
  drillMore: (n: number) => `… a ${n} dalších`,
  drillCurrentRecord: 'Odkaz na aktuální záznam smyčky (@). Zdroj hodnoty určuje nadřazený prvek ve struktuře formátu.',
  drillComplexExpr: 'Složená ER funkce — výraz nelze jednoduše trasovat na jeden datový zdroj.',
  drillCompoundExpr: 'Porovnávací výraz — obsahuje více modelových odkazů. Klikněte na cestu pro rozpad:',
  drillInteractiveExpr: 'ER výraz — klikněte na zvýrazněný odkaz pro rozpad:',
  drillConstant: 'Konstantní hodnota — bez datového zdroje.',
  drillDsNotFound: (name: string) => `Datový zdroj „${name}" nebyl nalezen v načtených konfiguracích. Zkontrolujte, zda je načten správný ModelMapping nebo Format soubor.`,
  drillAnalyzing: 'Rozebíraný výraz',
  drillHintClickable: 'Klikněte na zvýrazněné části výrazu a rozpadněte si ho krok po kroku až na původ dat.',
  drillHintEmpty: 'Vyberte prvek s vazbou (formulí) v Návrháři — rozpad ukáže, odkud se hodnota bere.',
  drillStepMappingTitle: 'Jak se hledá v modelu',
  drillStepDatasourceTitle: 'Odkud se bere hodnota',
  drillStepDepsTitle: 'Co hodnotu ovlivňuje',
  drillStepFormulaTitle: 'Výpočet hodnoty — klikněte pro další rozpad',
  drillStepUserParameterTitle: 'Výraz parametru',
  drillStepGroupedListTitle: 'Seskupený seznam',
  drillStepAggregationTitle: (name: string) => `Agregace: ${name}`,
  drillStepChildrenTitle: 'Související zdroje',
  drillRestart: 'Začít znovu',
  drillPopOut: 'Otevřít v okně',
  drillOpenInTab: 'Otevřít v nové záložce',
  drillTriggerHint: 'Kliknutím zobrazíte, odkud se hodnota bere',
  drillTriggerTabHint: 'dvojklik nebo Ctrl+klik otevře záložku',
  drillCollapsibleLabel: 'Zobrazit rozpad hodnoty',
  drillOpenExplorerFull: 'Otevřít v Exploreru →',
  drillLegendClickable: 'Klikatelný odkaz',
  drillLegendFunction: 'ER funkce',
  drillLegendLiteral: 'Literál',
  drillZoomIn: 'Zoom-in',
  drillZoomInto: (name: string) => `Zoom-in do „${name}"`,
  drillCurrentPart: 'Rozebíraná část',
  drillUsedDataTitle: 'Použitá data z D365FO',
  drillUsedDataHint: 'Tabulky, pole a parametry, ze kterých se hodnota tohoto výrazu nakonec čte. Kliknutím na položku se ukáže její místo v cestě hodnoty výše.',
  drillUsedDataEmpty: 'Výraz nečte žádnou tabulku ani pole — jde o konstantu, funkci nebo hodnotu z nadřazeného prvku.',
  drillLabelTitle: 'Překlad popisku',
  drillLabelHint: 'Tento výraz je pouze text z popisku — nečte žádná data z D365FO.',
  drillLabelId: 'ID popisku',
  drillLabelElement: 'Prvek',
  drillLabelEmpty: 'Pro tento popisek není v načtených konfiguracích žádný překlad.',
  resizeDialog: 'Tažením změníte velikost okna (dvojklik obnoví výchozí)',
  drillHowFilledTitle: 'Jak se hodnota naplní',
  drillHowFilledHint: 'Vzorce, kterými vzniká hodnota tohoto kroku. Klikněte na kteroukoli část vzorce a propadnete se do ní.',
  lineageTitle: 'Cesta hodnoty',
  lineageHint: 'Celý řetězec od výrazu ve formátu až k poli v D365FO. Zvýrazněné části výrazů lze rozkliknout — cesta se rozbalí až k danému zdroji.',
  lineageFormulaLabel: 'Vzorec',
  lineageExpand: 'Rozbalit',
  lineageCollapse: 'Sbalit',
  lineageShowInPath: (name: string) => `Ukázat ${name} v cestě hodnoty`,
  lineageOpenSegment: (path: string) => `Zobrazit, co vrací ${path}`,
  lineagePeekTitle: 'Vybraná část výrazu',
  lineagePeekEmpty: 'Tato část výrazu nevede k žádnému datovému zdroji — je to jen mezikrok v cestě.',
  lineagePeekClose: 'Zpět na celý výraz',
  lineageStageOrigin: 'Výraz formátu',
  lineageStageModelPath: 'Cesta v modelu',
  lineageModelDefinition: 'Definice',
  lineageModelDefinitionTitle: 'Definice mapování modelu, ve které byla cesta vyhodnocena',
  lineageStageMapping: 'Vazba v mapování modelu',
  lineageStageSource: 'Datový zdroj',
  lineageStageFormula: 'Vypočtené pole',
  lineageStageUserParam: 'Parametr uživatele',
  lineageStageGroupBy: 'Seskupení',
  lineageStageEntity: 'AX objekt',
  lineageStageUnresolved: 'Nerozpoznaná reference',
  drillFormulaMapping: 'Mapování modelu',
  drillFocusModelPath: 'Cesta v modelu',
  drillFocusExpression: 'Výraz',
  drillOriginalExpression: 'Původní výraz',
  drillForward: 'Vpřed',
  drillSourcePropsTitle: 'Vlastnosti zdroje',
  drillHowFilledHintSingle: 'Vzorec z mapování modelu, kterým se tato cesta naplní daty.',
  drillHowFilledHintMany: 'Výraz používá více cest do modelu. U každé cesty je vzorec, kterým se v mapování naplní — klikněte na cestu nebo na část vzorce a pokračujte hlouběji.',
  drillSourceDetailTitle: 'Detail zdroje hodnoty',
  drillSourceTarget: 'Čte se z',
  drillUserParameterNote: 'Hodnotu zadává uživatel při spuštění reportu — nepochází z modelu ani z tabulky.',

  // Results / counts
  searchResultCount: (n: number) => `Výsledky: ${n}`,
  propChildren: 'Potomci',
  propDataType: 'Datový typ',
  propExcelRange: 'Excel rozsah',
  // Property inspector
  propId: 'ID',
  propType: 'Typ',
  propName: 'Název',
  propEncoding: 'Kódování',
  propMaxLen: 'Max. délka',
  propValue: 'Hodnota',
  propTransform: 'Transformace',
  propTransformUnnamed: 'Nepojmenovaná transformace',
  propExcluded: 'Vyloučeno z datového zdroje',
  propYes: 'Ano',
  propDirection: 'Směr',
  formatDirectionImport: 'Import',
  formatDirectionExport: 'Export',
  formatDirectionUnknown: 'Neznámý směr',
  importLinkedMappingsLabel: 'Mapování na model',
  importNoLinkedMappings: 'Žádné mapování na model nenačteno',

  // Landing page
  landingBadge: 'D365 Finance & Operations · Electronic Reporting',
  landingTitle: 'D365FO ER Visualizer',
  landingSub: 'Načtěte ER konfigurace z disku nebo přímo z prostředí Finance & Operations a začněte trasovat vazby formátů přes mapování až ke zdrojové tabulce, třídě nebo výčtu.',
  landingDocsLink: 'Dokumentace',
  landingHomeLinkLabel: 'Zpět na úvodní stránku D365FO ER Visualizer',
  landingSourceLabel: 'Zdroj konfigurací',
  landingDropPrimary: 'Přetáhněte ER XML soubory sem',
  landingDropRelease: 'Pusťte soubory',
  landingDropSecondary: 'nebo klikněte pro výběr · můžete načíst více souborů najednou',
  landingLoading: 'Načítání souborů…',
  landingDropAriaLabel: 'Přetáhněte XML soubory sem',
  landingPillModel: 'Datový model',
  landingPillMapping: 'Mapování modelu',
  landingPillFormat: 'Formát',
  landingErrors: 'Chyby načítání',
  landingDismiss: 'Zavřít',
  landingLoaded: (n: number) => `${n} ${csPlural(n, 'konfigurace načtena', 'konfigurace načteny', 'konfigurací načteno')}`,
  undo: 'Zpět',
  removeFromHistory: 'Odebrat z historie',
  historyFileRemoved: (name: string) => `„${name}“ odebrán z historie.`,
  historyFilesCleared: (n: number) => `Historie vymazána (${n} ${csPlural(n, 'soubor', 'soubory', 'souborů')}).`,
  historySessionsCleared: (n: number) => `Historie relací vymazána (${n} ${csPlural(n, 'relace', 'relace', 'relací')}).`,
  workspaceClosedAll: (n: number) => `${csPlural(n, 'Zavřena', 'Zavřeny', 'Zavřeno')} ${n} ${csPlural(n, 'konfigurace', 'konfigurace', 'konfigurací')}.`,
  workspaceUndoCloseAll: 'Znovu otevřít',
  fnoRemoveProfileConfirmTitle: (name: string) => `Odebrat profil „${name}“?`,
  fnoRemoveProfileConfirmBody: 'Profil se odebere i s uloženým přihlášením k prostředí. Pro další stahování bude potřeba ho znovu vytvořit a přihlásit se.',
  cancel: 'Zrušit',
  modelViewLabel: 'Zobrazení modelu',
  modelViewList: 'Seznam',
  modelViewGraph: 'Graf',
  modelListFilterPlaceholder: 'Filtrovat pole modelu…',
  modelListLabel: 'Pole datového modelu',
  modelListMoreMatches: (n: number) => `…a ${n} ${csPlural(n, 'další pole', 'další pole', 'dalších polí')} — zužte filtr.`,
  recentSessionLoadFailed: (reason: string) => `Relaci se nepodařilo otevřít: ${reason}. Otevřete soubory znovu z disku.`,
  splitResize: 'Změnit poměr skupin (šipky; dvojklik vrátí na polovinu)',
  searchShowMore: (next: number, remaining: number) => `Zobrazit ${next === remaining ? 'zbývající' : 'dalších'} ${next}${next === remaining ? '' : ` (zbývá ${remaining})`}`,
  drillTruncated: 'Cesta je příliš rozvětvená a nezobrazuje se celá — část zdrojů chybí i v „Použitá data“. Klikněte na část výrazu a rozpad se zúží na ni.',
  fnoIngestCancel: 'Zrušit stahování',
  landingOpen: 'Otevřít návrhář',
  landingFooter: 'D365 FO ER Visualizer · Electronic Reporting Configuration Inspector',

  recentFiles: 'Nedávné soubory',
  recentConfigs: 'Nedávné konfigurace',
  recentOpen: 'Otevřít',
  recentAddToOpen: 'Přidat k otevřeným',
  recentMoreActions: 'Další akce',
  recentSourceFile: 'Místní soubor',
  recentSourceFiles: 'Místní soubory',
  recentSourceFileNamed: (file: string) => `Soubor ${file}`,
  recentSourceFno: 'D365 F&O',
  recentSourceFnoHost: (host: string) => `F&O · ${host}`,
  recentBundledFrom: (file: string) => `Součást souboru ${file}`,
  recentNotCached: 'není uloženo v prohlížeči',
  recentNotCachedHint: 'Obsah už prohlížeč nemá uložený — otevřete soubor znovu z disku nebo ho stáhněte z F&O.',
  recentOpenConfigHint: 'Přidat tuto konfiguraci do pracovní plochy',
  recentSessionUnavailable: 'Konfigurace této relace už prohlížeč nemá uložené. Otevřete je znovu z disku nebo stáhněte z F&O.',
  recentSessionCount: (n: number) => `${n} ${csPlural(n, 'konfigurace', 'konfigurace', 'konfigurací')}`,
  recentSessionContents: (n: number) => `Obsah relace: ${n} ${csPlural(n, 'konfigurace', 'konfigurace', 'konfigurací')}`,
  recentShowAll: (n: number) => `Zobrazit ${csPlural(n, 'celou', 'všechny', 'všech')} ${n}`,
  recentShowLess: 'Zobrazit méně',
  recentFilterPlaceholder: 'Filtrovat nedávné konfigurace…',
  noRecentFiles: 'Žádné nedávno otevřené soubory.',
  recentReloadHint: 'Znovu načíst soubor',
  recentSessions: 'Nedávné relace',
  recentSessionTitle: (count: number) => `Relace (${count} ${csPlural(count, 'soubor', 'soubory', 'souborů')})`,
  recentSessionMergeHint: 'Přidat konfigurace relace k těm, které jsou otevřené',
  recentSessionReplaceHint: 'Zavřít otevřené a otevřít tuto relaci',
  recentSessionFileHint: 'Přidat konfiguraci do pracovní plochy',
  clearRecent: 'Vymazat historii',
  loadSample: 'Načíst ukázkovou konfiguraci',
  validatorOk: 'Konfigurace vypadá v pořádku.',
  validatorIssues: (n: number) => `${n} upozornění`,
  forward: 'Vpřed',
  cmdCollapseAll: 'Sbalit celý strom',
  cmdExpandAll: 'Rozbalit celý strom',
  cmdExportWhereUsed: 'Exportovat místa použití do CSV',

  toastLoadFailed: (file: string) => `Soubor „${file}" se nepodařilo načíst.`,
  dismiss: 'Zavřít',
  panelMaximize: 'Zvětšit panel',
  panelRestore: 'Obnovit velikost panelu',
  panelClose: 'Zavřít panel',

  pathClickToNavigate: 'Klikněte pro navigaci →',
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
  fnoSubheading: 'Načtěte ER konfigurace přímo z prostředí (CHE, Sandbox, UDE).',
  fnoProfileName: 'Název profilu',
  fnoProfileNameHint: 'Jak se prostředí zobrazí v seznamu.',
  fnoEnvUrl: 'URL prostředí',
  fnoEnvUrlHint: 'Adresa, na které běží F&O — bez cesty za doménou.',
  fnoEnvUrlInvalid: 'Zadejte platnou adresu začínající https://',
  fnoSignInHint: 'Po kliknutí na Připojit se otevře standardní přihlášení Microsoftem.',
  fnoMissingBuiltInClientId:
    'Tento build nemá nastavené VITE_FNO_CLIENT_ID, takže se nelze přihlásit. ' +
    'Doplňte do buildu Application (client) ID víceklientské (multi-tenant) SPA registrace ' +
    's delegovaným oprávněním Dynamics ERP a s tímto Redirect URI:',
  fnoRedirectUriHint: 'Redirect URI — zaregistrujte v Entra pod „Single-page application" přesně tuto hodnotu:',
  fnoRedirectUriCopy: 'Kopírovat',
  fnoRedirectUriCopied: 'Redirect URI zkopírováno do schránky.',
  fnoSaveProfile: 'Uložit profil',
  fnoUpdateProfile: 'Uložit změny',
  fnoNewProfile: 'Nový profil',
  fnoNewProfileTitle: 'Nový profil prostředí',
  fnoEditProfileTitle: 'Upravit profil prostředí',
  fnoEditProfile: 'Upravit profil',
  fnoCancel: 'Zrušit',
  fnoConnect: 'Připojit',
  fnoDisconnect: 'Odpojit',
  fnoConnecting: 'Připojuji…',
  fnoConnected: (user: string) => `Připojen jako ${user}`,
  fnoProfiles: 'Prostředí',
  fnoNoProfiles: 'Zatím tu není žádné prostředí.',
  fnoNoProfilesHint: 'Přidejte profil s názvem a URL adresou F&O prostředí a přihlaste se účtem Microsoft.',
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
  fnoLoadedCount: (n: number) => `${csPlural(n, 'Načtena', 'Načteny', 'Načteno')} ${n} ${csPlural(n, 'konfigurace', 'konfigurace', 'konfigurací')} z F&O.`,
  fnoIngestAborted: (message: string) => `Stahování z F&O bylo přerušeno: ${message}`,
  excelCellGoToStructure: 'Kliknutím přejít do struktury',
  statusDerivedFromModel: 'model: ',
  statusDerivedFromModelTitle: (kind, parentName) => `Aktivní konfigurace je ${kind === 'Format' ? 'formát' : 'mapování'} odvozený z modelu „${parentName}“`,
  statusGuidCount: (n) => `GUIDů: ${n}`,
  fnoMappingNotAvailable: (names: string[]) => `ModelMapping nelze stáhnout pro: ${names.join(', ')}. Vazby formátových elementů jsou i přesto dostupné přes FormatMapping.`,
  fnoModelIdNotExposed: (names: string[]) => `F&O nevrací pro tyto modely a jejich mapování žádné ID: ${names.join(', ')}. Není tedy podle čeho je stáhnout — v seznamu jsou proto označené jako přeskočené. U importních formátů to nejde obejít: model je uvedený až v jejich samostatném mapování, samotný formát na model neodkazuje. Stáhl se tedy jen formát; vazby jeho elementů jsou dostupné přes FormatMapping.`,
  fnoImportMappingNotFound: (names: string[]) => `Mapování patřící vybranému importnímu formátu se nenašlo (model: ${names.join(', ')}). F&O vrátilo jen mapování jiných formátů, případně exportní mapování téhož modelu — ta jsou načtená, ale k tomuto formátu nepatří (žádné neuvádí náš formát v ERImportFormatDatasource a žádné nemá prázdnou definici modelu).`,
  fnoMappingNoDataModel: 'ModelMapping se nestahoval — ve staženém formátu nebyl nalezen žádný GUID datového modelu, takže není podle čeho mapování dohledat. Vyberte navíc příslušný datový model (nebo jeho mapování) ve stromu.',

  // Property inspector labels
  propDescription: 'Popis',
  propVersion: 'Verze',
  propVendor: 'Dodavatel',
  propStatus: 'Stav',
  propBase: 'Základ',
  propBaseGuid: 'GUID základu',
  propKind: 'Druh',
  propLabelsCount: (n: number) => `${n} ${csPlural(n, 'záznam', 'záznamy', 'záznamů')}`,
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
  propNotBound: 'Bez vazby',
  propValidations: 'Validace',
  mappingNoValidations: 'Toto mapování nemá žádné validace',
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
  errorChunkTitle: 'Část aplikace se nepodařilo stáhnout.',
  errorChunkDescription: 'Server je nejspíš nedostupný, nebo byla aplikace mezitím aktualizována. Obnovte stránku.',
  errorReload: 'Obnovit stránku',

  // Excel preview
  excelWorkbook: 'Excel sešit',
  excelInput: 'Vstupní',
  excelOutput: 'Výstupní',
  excelRangeCount: (n: number) => `${n} ${csPlural(n, 'oblast', 'oblasti', 'oblastí')}`,
  excelCellCount: (n: number) => `${n} ${csPlural(n, 'buňka', 'buňky', 'buněk')}`,
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
  excelTemplateCells: (n: number) => `${n} ${csPlural(n, 'buňka', 'buňky', 'buněk')}`,
  excelTemplateMerged: (n: number) => `${n} ${csPlural(n, 'sloučená', 'sloučené', 'sloučených')}`,
  excelTemplateImage: 'Obrázek šablony',
  excelTemplateImages: (n: number) => `${n} ${csPlural(n, 'obrázek', 'obrázky', 'obrázků')}`,
  excelTemplateDropHint: 'Přetáhněte sem soubor .xlsx z exportovaného ER solution package',
  excelTemplateDropActive: 'Pusťte soubor .xlsx…',
  excelTemplateDropInvalid: 'Pouze soubory .xlsx',
  excelTemplateLoadBtn: 'Načíst šablonu (.xlsx)',
  pdfConvertedFrom: (source: string) => `Výstup se převádí do PDF ze šablony ${source}`,
  pdfNoSourceComponent: 'PDF převodník neobsahuje žádnou vnořenou komponentu, kterou by šlo zobrazit.',
  previewLabel: 'Náhled',
  previewDescription: 'Náhled struktury souboru — konstantní hodnoty jsou odvozeny z binding výrazů. Dynamické hodnoty (cesty datových zdrojů, funkce) jsou zobrazeny jako {zástupné}.',

  // Format stats
  statsRoots: (n: number) => `${n} ${csPlural(n, 'kořen', 'kořeny', 'kořenů')}`,
  statsRecords: (n: number) => `${n} ${csPlural(n, 'záznam', 'záznamy', 'záznamů')}`,
  statsEnums: (n: number) => `${n} ${csPlural(n, 'výčet', 'výčty', 'výčtů')}`,
  statsFields: (n: number) => `${n} ${csPlural(n, 'pole', 'pole', 'polí')}`,
  statsRelations: (n: number) => `${n} ${csPlural(n, 'relace', 'relace', 'relací')}`,
  modelHierarchyHint: 'Hierarchická mapa · klikněte na kontejner pro zvýraznění',
  moreFields: (n: number) => `+${n} dalších…`,

  // Search panel
  searchInLabel: 'v',
  searchRefCount: (n: number) => `${n} ${csPlural(n, 'odkaz', 'odkazy', 'odkazů')} ve výrazu`,
  whereUsedSummary: (occurrences: number, files: number) => `${occurrences} ${csPlural(occurrences, 'výskyt', 'výskyty', 'výskytů')} v ${files} ${files === 1 ? 'souboru' : 'souborech'}`,
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
  fnoStatusResolvingLabels: 'Dohledávám labely z nadřazených modelů…',
  fnoStatusScanMappings: 'Stahuji konfigurace a hledám mapování…',
  fnoStatusDownloadingMM: 'Stahuji ModelMapping…',
  fnoStatusDownloadingMMCount: (n: number) => `Stahuji Model Mappings (${n})…`,
  fnoStatusLateDM: 'Řeším DataModely z křížových odkazů mapování…',
  fnoSkippedDerived: (name: string) => `„${name}" nemá vlastní XML (odvozená konfigurace) — přeskočeno.`,
  fnoSkippedDraft: (name: string) => `„${name}" má jen rozpracovanou verzi — F&O vydává jen dokončené verze, takže není co stáhnout. Dokončete verzi v F&O (Reporting configurations → Versions → Complete).`,
  fnoDraftOnly: 'Koncept',
  fnoDraftOnlyHint: 'Nelze stáhnout: konfigurace nemá žádnou dokončenou verzi. F&O vydává jen dokončenou (effective) verzi — dokončete ji v F&O (Reporting configurations → Versions → Complete) a pak ji tu bude možné vybrat.',
  fnoSelectedCount: (n: number) => `${n} vybráno (napříč úrovněmi)`,
  fnoSelectedCountLabel: 'vybráno (napříč úrovněmi)',
  treeCollapseNode: 'Sbalit',
  treeExpandNode: 'Rozbalit',
  fnoPickModelHint: 'Vyberte vlevo datový model a projděte jeho konfigurace.',
  fnoNoConfigurationsHint: 'V tomto prostředí nebyly nalezeny žádné ER konfigurace. Přihlaste se do F&O a v Organization administration → Electronic reporting → Configuration providers → Microsoft (Active) → Repositories → LCS → Open → Import naimportujte konfigurace z Lifecycle Services. Poté se připojte znovu. (Detaily: DevTools → Console → filtr „[fno-client]“.)',
  fnoFilterModels: 'Filtrovat modely…',
  fnoFilterConfigurations: 'Filtrovat konfigurace…',
  fnoSearchEverywhere: 'Hledat i ve formátech',
  fnoSearchEverywhereHint: 'Prochází všechny modely a hledá shodu i mezi formáty a mapováními pod nimi. Ke každému modelu si stáhne seznam konfigurací — u velkého prostředí to chvíli trvá.',
  fnoSearchResults: (query: string) => `Výsledky hledání: „${query}“`,
  fnoSearchProgress: (done: number, total: number) => `Procházím modely — ${done}/${total}`,
  fnoSearchHits: (n: number) => `${n} nalezeno`,
  fnoSearchNoHits: (query: string) => `Pro „${query}“ se mezi formáty a mapováními nic nenašlo.`,
  fnoSearchClear: 'Zrušit hledání',
  fnoNoModelMatch: (query: string) => `Žádný model neodpovídá „${query}“.`,
  fnoNoModelMatchHint: 'Formáty a mapování leží až pod modely — najde je tlačítko Hledat i ve formátech.',
  fnoSearchOpenModel: (model: string) => `Otevřít model ${model}`,
  fnoSearchFailed: (n: number) => `${n} ${csPlural(n, 'model', 'modely', 'modelů')} se nepodařilo prohledat — výsledky nemusí být úplné.`,
  fnoBack: '← Zpět',
  fnoRetry: 'Zkusit znovu',
  fnoNoChildren: (name: string) => `Pod „${name}" nejsou žádní potomci.`,
  fnoDownloadInfo: 'Výběrem Formátu se automaticky stáhnou i navázané konfigurace DataModel a ModelMapping. U čistě importních formátů (např. bankovní výpisy) F&O API DataModel neposkytuje — stáhnout lze pouze konfiguraci samotného Formátu.',
  fnoCredentials: 'Přihlašovací údaje',

  // New feature translations
  embeddedMapping: 'Mapování (embedded)',
  structureFilterAll: 'Vše',
  structureFilterBound: 'Svázané',
  structureFilterUnbound: 'Nesvázané',
  whereUsedAction: 'Kde je použito',

  // Audit fixes (a11y labels, former inline ternaries)
  designerWorkspaceEyebrow: 'Pracovní plocha designeru',
  designerUnsupportedView: (kind) => `Nepodporovaný pohled pro: ${kind}`,
  excelLegendConstantWord: 'konstanta',
  dsCrossCompany: 'napříč společnostmi',
  dsNestedCount: (n) => `${n} ${csPlural(n, 'vnořený datový zdroj', 'vnořené datové zdroje', 'vnořených datových zdrojů')}`,
  dsGroupBy: 'Seskupit podle',
  dsAggregated: 'Agregované',
  dsImplicitType: 'Uzel cesty',
  dsImplicitHint: 'Není deklarován jako datový zdroj — je to záznam datového modelu nebo část cesty, pod kterou jsou vnořeny další datové zdroje.',
  dsModelField: 'Pole datového modelu',
  dsModelNotLoaded: 'datový model není načten',
  bindingCount: (n) => `${n} ${csPlural(n, 'vazba', 'vazby', 'vazeb')}`,
  bindingVia: 'přes',
  searchNoResultsInScope: 'V tomto rozsahu nic nenalezeno.',
  searchRelatedOnly: 'Jen související',
  searchRelatedOnlyHint: 'Hledat pouze v otevřené konfiguraci, jejím datovém modelu a mapováních téhož modelu.',
  searchAllConfigs: 'Vše',
  searchAllConfigsHint: 'Hledat ve všech načtených konfiguracích, včetně nesouvisejících modelů.',
  searchRelatedEmpty: 'V související konfiguraci nic nenalezeno — přepněte na „Vše".',
  searchHiddenByRelated: (n: number) => `Skryto v nesouvisejících konfiguracích: ${n}`,
  searchHiddenByRelatedShort: (n: number) => `+${n} jinde`,
  searchGroupDefinition: (name: string) => `Definice: ${name}`,
  searchGroupDefinitionHint: (name: string) => `Definice mapování ${name}`,
  searchCatStructure: 'Struktura',
  searchCatBindings: 'Vazby',
  searchCatExpressions: 'Výrazy',
  searchCatDatasources: 'Datové zdroje',
  searchCatReferences: 'Reference',
  wuCatBindings: 'Vazby v mapování',
  wuCatExpressions: 'Výrazy a validace',
  wuCatFormat: 'Prvky formátu',
  pathSegmentDatasource: 'Zdroj',
  tooltipClickToNavigate: 'Kliknutím přejít',
  activityBarLabel: 'Panel aktivit',
  propLabels: 'Popisky',
  propUnknownType: (type: string) => `Neznámý (${type})`,
  labelTextNotFound: 'Text popisku není v načtených konfiguracích',
  kindDataModel: 'Datový model',
  kindModelMapping: 'Mapování modelu',
  kindFormat: 'Formát',
  nodeTypeLabel: (type: string) => ({
    file: 'Soubor',
    solution: 'Řešení',
    model: 'Model',
    container: 'Kontejner',
    field: 'Pole',
    mapping: 'Mapování',
    datasource: 'Datový zdroj',
    binding: 'Vazba',
    validation: 'Validace',
    format: 'Formát',
    formatElement: 'Prvek formátu',
    formatBinding: 'Vazba formátu',
    enum: 'Výčet',
    enumValue: 'Hodnota výčtu',
    transformation: 'Transformace',
    section: 'Sekce',
  } as Record<string, string>)[type] ?? type,
  closeTab: (label: string) => `Zavřít ${label}`,
  splitOpenBeside: 'Otevřít vedle',
  splitOpenLeft: 'Otevřít vlevo',
  splitOpenRight: 'Otevřít vpravo',
  splitMoveLeft: 'Přesunout do levé skupiny',
  splitMoveRight: 'Přesunout do pravé skupiny',
  splitCloseSideGroup: 'Zavřít pravou skupinu (její záložky se přesunou doleva)',
  splitCloseMainGroup: 'Zavřít levou skupinu (její záložky se přesunou doprava)',
  drillPinAsTab: 'Připnout do záložky',
  drillOpenBeside: 'Otevřít vedle',
  drillOpenBesideHint: 'Otevřít rozpad jako záložku vedle aktivní záložky, pro porovnání',
  notificationsLabel: 'Oznámení',
  drillOpenAsTab: 'Otevřít jako záložku',
  // Model designer badges, text preview, error boundary areas
  modelRootBadge: 'KOŘEN',
  modelEnumBadge: 'VÝČET',
  previewRepeatingStart: (name: string) => `--- ${name} (opakuje se) ---`,
  previewRepeatingEnd: (name: string) => `--- konec ${name} ---`,
  excelSheet: 'List',
  excelRange: 'Oblast',
  excelCell: 'Buňka',
  formatTypeFile: 'Soubor',
  errorAreaLanding: 'Úvodní stránka',
  errorAreaDesigner: 'Návrhář',
  validationActionBadge: (value: string) => `Akce: ${value}`,
  validationSeverityBadge: (value: string) => `Závažnost: ${value}`,
  // F&O connection panel
  fnoRootNoSolutions: (root: string) => `Kořen „${root}“ stále nevrátil žádná řešení. Buď je název vydavatele chybný, nebo prostředí nemá importované žádné ER konfigurace.`,
  fnoNoSolutionsFound: 'Pod známými kořeny nebyla nalezena žádná řešení.',
  fnoCustomRootHint: 'Pokud znáte konkrétní název vydavatele, zadejte ho sem a zkuste to znovu:',
  fnoCustomRootPlaceholder: 'Název vydavatele / kořenového řešení',
  fnoTypeMapping: 'Mapování',
  fnoTypeModel: 'Model',
  fnoUnreachableMapping: 'F&O pro toto mapování modelu nezveřejňuje ID služby. Jeho pravidla jsou součástí XML formátu.',
  fnoNoDownloadableContent: 'Nic ke stažení — odvozená konfigurace, která jen dědí obsah.',
  fnoBranchNodeHint: 'Větev — kliknutím zobrazíte podřízené konfigurace',
  fnoViaParent: 'přes rodiče',
  fnoDrillInto: 'Zobrazit podřízené',
  fnoUnknownError: 'Neznámá chyba',
  fnoErrServiceNotFound: (url: string, serviceUrl: string, operation: string) =>
    `404 Not Found (${url}). Custom service nebo operace na tomto prostředí neexistuje. ` +
    `Otevřete v prohlížeči ${serviceUrl} ` +
    `a zkontrolujte, že operace "${operation}" je v seznamu <Operations>. Pokud má jiný název, upravte ER_SERVICE_OPS v packages/fno-client/src/er-services.ts`,
  fnoErrEndpointNotFound: (status: string) => `${status}. Endpoint na prostředí neexistuje. Ověřte přesnou URL prostředí (bez /namespace) a že jsou ER služby nainstalovány`,
  fnoErrForbidden: (status: string) => `${status}. Uživatel v F&O nemá oprávnění na ER služby. Přidejte uživatele / roli "Electronic reporting developer" nebo "Electronic reporting functional consultant"`,
  fnoErrRedirectDesktop: 'AADSTS50011: Redirect URI nesedí. V App registration → Authentication → Mobile and desktop applications přidejte „http://localhost".',
  fnoErrRedirectWeb: (uri: string) =>
    `AADSTS50011: Redirect URI nesedí. Aplikace posílá přesně:\n` +
    `    ${uri}\n` +
    `Zaregistrujte tuto hodnotu v Entra → App registrations → Authentication → Add a platform → ` +
    `Single-page application (ne „Web", ne „Mobile and desktop applications").\n` +
    `Musí sedět znak po znaku — bez lomítka na konci a bez cesty.\n` +
    `Pozor: každé preview nasazení má vlastní hostname a potřebuje vlastní záznam.`,
  fnoErrClientIdUnavailable: 'AADSTS700016: Application (client) ID zabudované v tomto buildu není v tomto tenantu dostupné. Pokud si nástroj hostujete sami, nastavte VITE_FNO_CLIENT_ID (resp. FNO_CLIENT_ID u desktopu) na vlastní víceklientskou registraci.',
  fnoErrConsentRequired: 'AADSTS65001: Přihlášení nebylo schváleno. Správce tenantu musí aplikaci jednorázově schválit (Entra → Enterprise applications → Admin consent requests) pro delegované oprávnění Dynamics ERP CustomService.FullAccess.',
  fnoErrScopeMismatch: 'AADSTS500011: Scope (envUrl) neodpovídá žádnému service principálu. Ověřte přesnou URL prostředí (bez lomítka na konci) a že v daném tenantu je Dynamics 365 F&O nainstalován.',
  fnoErrWrongTenant: 'AADSTS50020: Přihlášený účet není v tenantu, kde F&O prostředí běží. Přihlaste se pracovním účtem daného tenantu, případně guest účtem, který v něm byl přijat.',
  fnoErrCodeUsed: (code: string) => `AADSTS${code}: Autorizační kód byl již použit nebo je neplatný. Zkuste se přihlásit znovu.`,
  fnoErrMfaRequired: (code: string) => `AADSTS${code}: Je vyžadováno MFA. Projděte výzvou v prohlížeči a zkuste to znovu.`,
  fnoErrPublicClientFlows: 'AADSTS7000218: App registration nemá povolené public client flows. V Entra → App registrations → Authentication zapněte „Allow public client flows" = Yes.',
  fnoErrRedirectIsSpa: 'AADSTS9002326: Redirect URI je u App registration zařazené jako „Single-page application". Přesuňte ho pod „Mobile and desktop applications" (http://localhost).',

  // ─── F&O sign-in module loading (fno/auth-factory.ts) ───
  fnoAuthModuleLoadFailed: (moduleName: string) => `Nepodařilo se načíst přihlašovací modul (${moduleName}). Aplikace ho stahuje až ve chvíli přihlášení a stažení selhalo — typicky když neběží dev server, když se mezitím nasadila nová verze, nebo při výpadku sítě. Načtěte stránku znovu (Ctrl+F5) a zkuste to znovu.`,
  fnoAuthElectronBridgeMissing: 'Electron auth bridge není k dispozici — preload se nenačetl, takže window.electronAPI chybí. Podívejte se do konzole hlavního procesu na "[electron] preload failed to load"; nejčastější příčinou je preload zkompilovaný jako ESM (balíček má "type": "module", sandboxovaný preload musí být CommonJS → dist/preload.cjs). Přebuildujte přes `pnpm --filter @er-visualizer/electron build` a restartujte aplikaci.',

  // ─── File loading (utils/file-loading.ts) ───
  fileNotXml: 'není XML soubor',

  // ─── Format binding sections (utils/format-binding-sections.ts, format-binding-display.ts) ───
  bindingIntentLabels: { direct: 'Přímé hodnoty', calculated: 'Výpočty', condition: 'Podmínky', text: 'Texty', property: 'Vlastnosti' },
  bindingIntentItemLabels: { direct: 'Hodnota', calculated: 'Výpočet', condition: 'Podmínka', text: 'Text', property: 'Vlastnost' },
  bindingIntentHints: { direct: 'Hodnota převzatá beze změny z datového modelu nebo datového zdroje', calculated: 'Hodnota, kterou výraz počítá nebo upravuje — funkce, operátory', condition: 'Kdy se prvek generuje — Enabled, Visible a podobné', text: 'Pevný text nebo konstanta, typicky popisky sloupců (@GER_LABEL)', property: 'Nastavení prvku — název souboru, jazyk, formát, kódování' },
  formatBindingCategoryLabels: { data: 'Data', visibility: 'Viditelnost', formatting: 'Formátování', property: 'Ostatní vlastnosti' },
  formatBindingValueBadge: 'Hodnota',

  // ─── Configuration warnings (state/config-warnings.ts) ───
  warnLoadDataModelForDrillDown: 'Pro plný drill-down načtěte i Data Model soubor.',
  warnFormatWithoutMapping: 'Formát bez Model Mapping — výrazy nebude možné trasovat na zdrojové tabulky.',
  warnBrokenDatasourceRefs: (formatName: string, count: number, detail: string, hidden: number) => `Formát "${formatName}" obsahuje ${count} ${csPlural(count, 'výraz odkazující', 'výrazy odkazující', 'výrazů odkazujících')} na neznámý datový zdroj.\n${detail}${hidden > 0 ? `\n  … a ${hidden} dalších` : ''}`,

  // ─── Explorer tree section labels (state/tree-builder.ts) ───
  treeDsGroupLabels: { DataModel: 'Datový model', Table: 'Tabulky', CalculatedField: 'Výpočtová pole', Class: 'Třídy', Enum: 'AX výčty', ModelEnum: 'Výčty datového modelu', FormatEnum: 'Výčty formátu', ImportFormat: 'Importní formáty', UserParameter: 'Uživatelské parametry', GroupBy: 'Seskupení', Container: 'Kontejnery', Join: 'Spojení', Object: 'Objekty' },
  treeDataModelSections: { roots: 'Definice modelu', enums: 'Výčtové typy', records: 'Záznamy' },
  treeMappingSections: { title: 'Mapování', dataSources: 'Datové zdroje', bindings: 'Vazby', validations: 'Validace' },
  treeFormatSections: { outputStructure: 'Výstupní struktura', modelMappings: 'Mapování modelu', enumerations: 'Výčty', transformations: 'Transformace', dataSources: 'Datové zdroje', bindings: 'Vazby', noBindings: 'bez vazeb' },
  treeGroupBySections: { groupedBy: 'Seskupeno podle', aggregated: 'Agregace' },
  groupOther: 'Ostatní',
  treeEmbeddedMappingUsedSuffix: '  ✓ použito načteným formátem',

  // ─── Store toasts (state/store.ts) ───
  toastNewerVersionOpen: (fileName: string, version: string | number, loadedVersion?: string | number) => `${fileName} (verze ${version}) nebyl načten – již je otevřena novější verze${loadedVersion ? ` ${loadedVersion}` : ''}.`,
  toastLoadFailedWithMessage: (fileName: string, message: string) => `Chyba při načítání ${fileName}: ${message}`,
  toastConfigClosed: (name: string) => `Konfigurace „${name}“ byla zavřena.`,
  toastReopen: 'Znovu otevřít',
  toastSessionNotCached: 'Obsah relace už není v mezipaměti, otevřete soubory znovu ručně.',
  toastSessionFilesMissing: (files: string) => `Některé soubory v relaci nebyly načteny (chybí mezipaměť): ${files}.`,
  toastAlreadyOpen: (label: string) => `„${label}“ už je otevřen v pracovní ploše.`,
  toastFileNotCached: (label: string) => `Obsah „${label}“ už není v mezipaměti, otevřete soubor znovu ručně.`,

  // ─── Path tooltip rows (utils/path-tooltip.ts) ───
  pathTipInside: 'Uvnitř',
  pathTipReadsTables: 'Čte tabulky',
  pathTipCallsClasses: 'Volá třídy',
  pathTipViaCalcFields: 'Přes vypočtená pole',
  pathTipOpenDatasource: 'Kliknutím přejít na zdroj',
  pathTipOpenBinding: 'Kliknutím přejít na vazbu',
  pathTipSource: 'Zdroj',
  pathTipTableField: 'Pole tabulky',
  pathTipClassMember: 'Člen třídy',
  pathTipEnumValue: 'Hodnota výčtu',
  pathTipDatasourceField: 'Pole datového zdroje',
  pathTipModelField: 'Pole datového modelu',
  pathTipMappingBinding: 'Vazba v mapování',
  pathTipRecord: 'Záznam',
  pathTipRecordFieldsBound: (n: number) => `Vazby mají jeho pole (${n})`,
  pathTipNearestBinding: 'Nejbližší vazba',
  pathTipMapping: 'Mapování',
  pathTipNoBinding: 'Žádná vazba v načtených mapováních',
  pathTipModelRoot: 'Kořen modelu',
  pathTipDataModel: 'Datový model',
  pathTipUserParameter: 'Uživatelský parametr',

  // ─── Consultant view words (utils/consultant-labels.ts) ───
  consultantFormatTypeLabels: { File: 'Soubor', ExcelFile: 'Excel', WordFile: 'Word', PDFFile: 'PDF', XMLElement: 'Element', XMLAttribute: 'Atribut', XMLSequence: 'Sekvence', String: 'Text', Numeric: 'Číslo', DateTime: 'Datum a čas', Base64: 'Příloha', ExcelSheet: 'List', ExcelRange: 'Oblast', ExcelCell: 'Buňka', ExcelHeader: 'Záhlaví', ExcelFooter: 'Zápatí', TextSequence: 'Sekvence', TextLine: 'Řádek', Sequence: 'Sekvence', Common: 'Prvek', Empty: 'Prázdný prvek' },
  consultantElementFallback: 'Prvek',
  consultantDataTypeLabels: { String: 'Text', Real: 'Číslo', DateTime: 'Datum a čas', Container: 'Příloha' },
  consultantFieldTypeLabels: { 1: 'Ano/ne', 3: 'Celé číslo', 4: 'Celé číslo', 5: 'Číslo', 6: 'Text', 7: 'Datum', 9: 'Výčet', 10: 'Záznam', 11: 'Seznam záznamů', 13: 'Binární data' },
  consultantBindingCategoryLabels: { data: 'Hodnota', visibility: 'Viditelnost', formatting: 'Formátování', property: 'Další vlastnosti' },
  consultantPropertyLabels: { FileName: 'Název souboru', FileLanguage: 'Jazyk', FileCulture: 'Jazyková verze' },
  consultantTurnedOff: 'Vypnuto',
  consultantTurnedOn: 'Zapnuto',
  consultantCondition: 'Podmínka',

  // ─── Enum type labels (utils/enum-display.ts) ───
  enumTypeLabels: { Ax: 'Výčet AX', DataModel: 'Výčet datového modelu', Format: 'Výčet formátu' },

  // ─── Configuration kind labels (DependencyPromptDialog.tsx, ConfigExplorer.tsx) ───
  configKindLabels: { DataModel: 'Datový model', ModelMapping: 'Mapování modelu', Format: 'Formát' },
  explorerKindPills: { DataModel: 'Model', ModelMapping: 'Mapování', Format: 'Formát' },
  explorerGroupLabels: { DataModel: 'Datové modely', ModelMapping: 'Mapování modelu', Format: 'Formáty' },
  explorerChipLabels: { DataModel: 'Modely', ModelMapping: 'Mapování', Format: 'Formáty' },

  // ─── F&O ingest steps (FnoIngestPanel.tsx) ───
  fnoIngestSteps: { prepare: 'Příprava', dm: 'Datové modely', fm: 'Formáty a mapování', mm: 'Mapování modelů', finalize: 'Dokončení' },

  // ─── Data source groups (designers/DatasourceTree.tsx) ───
  dsGroupLabelsTechnical: { Table: 'Tabulky', CalculatedField: 'Vypočtená pole', Class: 'Třídy', Object: 'Objekty', Enum: 'Výčty AX', ModelEnum: 'Výčty datového modelu', FormatEnum: 'Výčty formátu', ImportFormat: 'Importní formáty', UserParameter: 'Uživatelské parametry', GroupBy: 'Seskupení', Container: 'Kontejnery', Join: 'Spojení', DataModel: 'Datový model' },
  dsGroupLabelsConsultant: { Table: 'Tabulky', CalculatedField: 'Vypočtené hodnoty', Class: 'Logika', Object: 'Objekty', Enum: 'Hodnoty', ModelEnum: 'Hodnoty', FormatEnum: 'Hodnoty', ImportFormat: 'Importní formát', UserParameter: 'Parametry', GroupBy: 'Seskupená data', Container: 'Kontejnery', Join: 'Spojení', DataModel: 'Datový model', Values: 'Hodnoty' },
  dsImportFormat: 'Importní formát',
  dsGroupedBy: 'Seskupení podle',

  // ─── Data model designer (designers/DataModelDesigner.tsx) ───
  dmDesignerTitle: 'Datový model',
  dmDatasourceProperties: 'Vlastnosti datového zdroje',
  dmNoRelevantBindings: 'Žádné relevantní vazby pro vybraný zdroj.',

  // ─── Format designer tabs (designers/FormatDesigner.tsx) ───
  fmtTabStructureTitle: 'Hierarchická struktura prvků formátu s vazbami na datový model',
  fmtTabBindingsTitle: 'Vazby podle účelu — přímé hodnoty, výpočty, podmínky, texty — v pořadí, v jakém soubor vzniká',
  fmtTabDatasourcesTitle: 'Datové zdroje mapování — tabulky, výčty, třídy a vypočítaná pole',
  fmtTabPreviewTitle: 'Náhled generovaného výstupu ve správném formátu',
  fmtTabEmbeddedMapping: 'Mapování',
  fmtTabEmbeddedMappingTitle: 'Mapování modelu zabudované přímo v importním formátu',
  fmtElementsOutsideStructure: 'Prvky mimo strukturu formátu',

  // ─── Format preview (designers/FormatPreview.tsx) ───
  previewUnresolvedValues: 'Nevyřešené hodnoty:',
  previewSampleData: 'Vzorová data',
  previewKeepPlaceholder: 'Ponechat {placeholder}',
  previewHideUnresolved: 'Skrýt nevyřešené',
  previewCsvView: 'CSV zobrazení:',
  previewFirstRowHeader: 'První řádek = hlavička',

  // ─── Model mapping designer (designers/ModelMappingDesigner.tsx) ───
  mmDefinitionTitleTechnical: 'Definice mapování (DataContainerDescriptor — kořenový kontejner datového modelu)',
  mmDefinitionTitle: 'Definice mapování',
  mmDefinition: 'Definice',
  mmClickToSwitch: (title: string) => `${title} — kliknutím přepnete`,
  mmDesignerTitle: 'Mapování modelu',
  mmDesignerHint: 'Klikněte na řádek pro vlastnosti, na výraz pro rozpad hodnoty',
  mmRuleCount: (n: number) => `Počet pravidel: ${n}`,
  mmBranchBindingCount: (n: number) => `Počet vazeb v této větvi: ${n}`,

  // ─── Search panel (SearchPanel.tsx) ───
  searchExampleSections: { mapping: 'Odkud se berou data', calc: 'Výpočty a podmínky', output: 'Podoba výstupu' },
  searchExamplePresets: { model: 'Co všechno čte z datového modelu', companyInfo: 'Kde se používají údaje o firmě', labels: 'Odkud pocházejí popisky', round: 'Kde se zaokrouhlují částky', conditional: 'Podmíněná logika ve výrazech', calculated: 'Počítaná pole a mezisoučty', dateFormat: 'Formátování data a času', numberFormat: 'Formátování čísel', concatenate: 'Skládání textových hodnot' },
  whereUsedExampleSections: { impact: 'Dopad změny', trace: 'Dohledání hodnoty' },
  whereUsedExamplePresets: { table: 'Co se rozbije při změně tabulky', enumType: 'Kde se opírám o výčtový typ', lookup: 'Kde se používá lookup', parameter: 'Kde se uplatní parametr', ledgerAccount: 'Odkud se plní účet', calculated: 'Co stojí za počítaným polem' },
  searchShowingFirst: (shown: number, total: number) => `Zobrazeno prvních ${shown} z ${total}`,
  searchScopeResultsAria: 'Oblast výsledků',
  whereUsedScopeAria: 'Oblast použití',
  searchReachAria: 'Rozsah hledání',
  searchScopeAll: 'Vše',
  searchScopeFormat: 'Formát',
  searchScopeMapping: 'Mapování',
  searchScopeModel: 'Model',
  searchMinChars: (n: number) => `Zadejte alespoň ${n} ${csPlural(n, 'znak', 'znaky', 'znaků')}.`,
  searchLblFormatExpression: 'Výraz formátu',
  searchLblVisibility: 'Viditelnost',
  searchLblFormatting: 'Formátování',
  searchLblProperty: 'Vlastnost',
  searchLblTable: 'Tabulka',
  searchLblEnum: 'Výčet',
  searchLblClass: 'Třída',
  searchLblParameter: 'Parametr',
  searchLblField: 'Pole',
  searchLblBinding: 'Vazba',
  searchLblExpression: 'Výraz',
  searchLblCalcField: 'Výpočet',
  searchLblFieldType: 'Typ pole',
  searchLblModelRef: 'Model',
  searchLblBaseRef: 'Základ',
  searchLblFormatRef: 'Formát',
  searchLblReference: 'Odkaz',
  searchLblUnresolvedRef: 'Nerozpoznaný odkaz',
  searchExprSource: (component: string) => `zdroj: ${component}`,
  searchExprParam: (component: string) => `parametr: ${component}`,
  searchKindLabels: { Format: 'Formát', ModelMapping: 'Mapování', DataModel: 'Model' },
  searchTabDatasources: 'Datové zdroje',
  searchLocalizeBindingKind: (label: string) => { const trimmed = label.trim().toLowerCase(); if (trimmed === 'binding') return 'Vazba'; if (trimmed.startsWith('binding ')) return `Vazba ${label.slice('binding'.length).trim()}`; return label; },
  searchRefKindLabels: { calc: 'Výpočet', param: 'Parametr', agg: 'Agregace', validation: 'Validace', message: 'Zpráva' },

  // ─── Format bindings view (designers/FormatBindingsView.tsx) ───
  fbReadsPrefix: 'Formát čte ',
  fbReadsSuffix: (n: number) => ` ${csPlural(n, 'pole', 'pole', 'polí')} modelu`,
  fbMappingPrefix: 'Mapování: ',
  fbMappingNotLoadedFor: (descriptor: string | null | undefined) => `Mapování pro ${descriptor || 'datový model'} není načtené`,
  fbUnmappedCount: (n: number) => `${n} bez vazby v mapování`,
  fbLoadModelForLabels: 'Popisky polí se ukážou po načtení datového modelu',
  fbOnlyUnmappedHint: 'Jen pole, která formát čte a mapování neplní',
  fbOnlyUnmapped: 'Jen bez vazby',
  fbAllFieldsMapped: 'Každé pole, které formát čte, má vazbu v mapování.',
  fbBranchUnmappedCount: (n: number) => `Bez vazby v mapování v této větvi: ${n}`,
  fbUsageCount: (n: number) => `Použití ve formátu: ${n}`,
  fbLineMapping: 'Mapování',
  fbFieldNeverFilledHint: 'Mapování toto pole neplní, formát tu dostane prázdnou hodnotu.',
  fbNoMappingBinding: 'Bez vazby v mapování',
  fbMappingNotLoaded: 'Mapování není načtené',
  fbRecordFieldsBound: 'Záznam — vazby mají jeho pole',
  fbLineFormat: 'Formát',
  fbMoreUsages: (n: number) => `+${n} dalších`,
  fbLayoutByFormat: 'Podle formátu',
  fbLayoutByFormatHint: 'Vazby v pořadí, v jakém soubor vzniká',
  fbLayoutByModel: 'Podle modelu',
  fbLayoutByModelHint: 'Pole datového modelu, která formát čte, a co je plní v mapování',
  fbToolbarAria: 'Uspořádání a filtr vazeb',
  fbLayoutAria: 'Uspořádání vazeb',
  fbNothingInSelectedTypes: (hiddenList: string) => `Ve vybraných typech vazeb nic není. Skryté: ${hiddenList}.`,
  fbShowAll: 'Zobrazit vše',
  fbHiddenByFilter: (n: number) => `Další vazby prvku skryté filtrem: ${n}`,

  // ─── Drill-down panel (DrillDownPanel.tsx) ───
  drillBadgeLabels: { root: 'Výraz', model: 'Model', mapping: 'Mapování', ds: 'Pole', table: 'AX tabulka', enum: 'AX výčet', class: 'AX třída', calc: 'Vypočtené pole', container: 'Složka', groupby: 'Seskupení', join: 'Spojení', object: 'AX objekt', userparameter: 'Parametr uživatele', param: 'Parametr uživatele', importformat: 'Importní formát', leaf: 'AX tabulka', unknown: 'Neznámé' },
  drillBadgeGroupLabels: { table: 'AX tabulky', enum: 'AX výčty', class: 'AX třídy', calc: 'Vypočtená pole', container: 'Složky', groupby: 'Seskupení', join: 'Spojení', object: 'AX objekty', userparameter: 'Parametry uživatele', param: 'Parametry uživatele', importformat: 'Importní formáty', leaf: 'AX tabulky', unknown: 'Neznámé' },
  drillSourceFallback: 'Zdroj',
  drillRuleStop: 'Zastavit',
  drillRuleWarning: 'Varování',
  drillUnresolved: 'Nevyřešené',
  drillMappingNode: 'Mapování',
  drillParamEnteredAtRunTime: 'zadává uživatel při spuštění',
  drillNoDataReference: 'Žádná datová reference',
  drillCopy: 'Kopírovat',
  drillCopied: (value: string) => `Zkopírováno: ${value}`,
  drillCopyFailed: 'Kopírování se nepodařilo (schránka není dostupná).',
  drillAutoCompact: (nodes: number) => `Auto: kompaktní režim (${nodes} ${csPlural(nodes, 'uzel', 'uzly', 'uzlů')})`,
  drillViewAria: 'Pohled',
  drillViewDetailHint: 'Přehledný detail výrazu',
  drillViewDetail: 'Detail',
  drillViewTreeHint: 'Stromová vizualizace',
  drillViewTree: 'Strom',
  drillLabelModeAria: 'Režim popisků uzlů',
  drillCompactHint: 'Kompaktní režim popisků',
  drillCompact: 'Kompaktní',
  drillFullHint: 'Plný režim popisků',
  drillFull: 'Plný',
  drillShowUnresolvedHint: 'Zobrazit nevyřešené reference',
  drillValidationDetails: 'Detaily validace',
  drillRuleCount: (n: number) => `${n} ${csPlural(n, 'pravidlo', 'pravidla', 'pravidel')}`,

  // ─── Where-used text matches (state/where-used.ts) ───
  whereUsedTextMatchName: (query: string) => `"${query}" (výskyty ve výrazech)`,
};

const en: Translations = {
  language: 'Language',
  languageCzech: 'Czech',
  languageEnglish: 'English',
  languageCode: 'EN',
  languageCurrent: 'English',
  appName: 'ER Visualizer',
  appSubtitle: 'D365 FO · Electronic Reporting',
  home: 'Home',
  loadXml: 'Load XML',
  searchPlaceholder: 'Table name, field, path…',
  search: 'Search',
  propRevealInExplorer: 'Reveal in Explorer',
  whereUsedPlaceholder: 'e.g. TaxTrans, CustTable, MyCalcField…',
  whereUsedLabel: 'Enter table, enum, class or datasource name:',
  find: 'Find',
  hideExplorer: 'Hide Explorer',
  showExplorer: 'Show Explorer',
  showDetails: 'Show details',
  hideDetails: 'Hide details',
  themeLabel: 'Theme',
  lightTheme: 'Light',
  darkTheme: 'Dark',
  systemTheme: 'Follow system',
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
  openInExplorerTouch: 'In Explorer, tap ⋮ on an item and choose Open in tab.',
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
  filterRecent: 'Recent filters',
  filterSuggestions: 'Filter suggestions',
  filterMatchCount: (n: number) => `Matches: ${n}`,
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
  explorerActiveMapping: 'active',
  explorerActiveMappingHint: 'This model definition is the one the active format uses',
  detailOverview: 'Selection Overview',
  attributes: 'Attributes',
  drillSteps: (n: number) => `${n} step${n === 1 ? '' : 's'}`,
  back: 'Back',
  closeConfiguration: 'Close configuration',
  closeAllConfigurations: 'Close all',
  workspaceManager: 'Workspace manager',
  workspaceLoaded: 'Loaded configurations',
  workspaceEmpty: 'No configuration is loaded.',
  workspaceAddRecent: 'Add from recent',
  workspaceAdd: 'Add to workspace',
  workspaceAddFiles: 'Add files…',
  workspaceAvailable: 'Available (closed / cached)',
  workspaceAvailableEmpty: 'No further cached configurations.',
  workspaceFilterPlaceholder: 'Filter configurations…',
  workspaceReopenAll: 'Open all',
  workspaceAddFromFno: 'Add from F&O…',
  workspaceSourceFile: 'File',
  workspaceSourceFno: 'F&O',
  workspaceRemoveFromCache: 'Remove from cache',
  workspaceLinkedTo: (model: string) => `Model: ${model}`,
  workspaceUnlinked: 'No loaded model',
  workspaceClosedHint: 'Closed configurations stay in the browser cache and can be reopened any time.',
  workspaceNoMatch: 'No configuration matches the filter.',
  depPromptTitle: 'Also load related configurations?',
  depPromptBodyFormat: (name: string) => `Format "${name}" relies on a data model and its model mapping. Without them you cannot trace bindings down to source tables.`,
  depPromptBodyMapping: (name: string) => `Mapping "${name}" belongs to a data model. Without it the model structure cannot be shown.`,
  depPromptBodyModel: (name: string) => `More cached configurations belong to model "${name}".`,
  depPromptBodyFno: (name: string) => `Related configurations for format "${name}" were found in the current list. Add them to the download selection?`,
  depPromptConfirm: 'Load selected',
  depPromptOnlyThis: 'Only this configuration',
  depPromptCancel: 'Cancel',
  fnoIngestTitle: 'Downloading configurations from F&O',
  fnoIngestDone: 'Download finished',
  fnoIngestSummary: (done: number, total: number) => `${done} of ${total} done`,
  fnoIngestFailed: (n: number) => `${n} failed`,
  fnoIngestEmpty: (n: number) => `${n} without content`,
  fnoIngestExplicit: 'selected',
  fnoIngestAuto: 'dependency',
  fnoIngestStatusQueued: 'Queued',
  fnoIngestStatusDownloading: 'Downloading…',
  fnoIngestStatusDone: 'Done',
  fnoIngestStatusEmpty: 'No own XML',
  fnoIngestStatusSkipped: 'Skipped',
  fnoIngestStatusFailed: 'Failed',
  fnoIngestNoId: 'No id from F&O',
  fnoIngestHint: 'Data models and mappings are resolved automatically from references in the downloaded XML.',
  fnoIngestClose: 'Close',
  fnoIngestOpenWorkspace: 'Open workspace',
  explorerUnlinked: 'Unlinked',
  explorerLoading: 'Loading',
  fnoFooterIdle: 'Select configurations to download',
  fnoFooterDownloading: 'Downloading configurations…',
  openInExplorerAction: 'Open in Explorer',
  explorerActionShort: 'Explorer',
  noSelection: 'No element selected.',
  selectElementHint: 'Select a node in the explorer or designer to inspect its properties.',
  viewLabel: 'View',

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
  drillTriggerHint: 'Click to see where the value comes from',
  drillTriggerTabHint: 'double-click or Ctrl+click opens a tab',
  drillCollapsibleLabel: 'Show value breakdown',
  drillOpenExplorerFull: 'Open in Explorer →',
  drillLegendClickable: 'Clickable reference',
  drillLegendFunction: 'ER function',
  drillLegendLiteral: 'Literal',
  drillZoomIn: 'Zoom in',
  drillZoomInto: (name: string) => `Zoom in to "${name}"`,
  drillCurrentPart: 'Part being analysed',
  drillUsedDataTitle: 'D365FO data used',
  drillUsedDataHint: 'Tables, fields and parameters this expression finally reads from. Click an item to reveal where it sits in the value path above.',
  drillUsedDataEmpty: 'This expression reads no table or field — it is a constant, a function, or a value from the parent element.',
  drillLabelTitle: 'Label translation',
  drillLabelHint: 'This expression is label text only — it reads no D365FO data.',
  drillLabelId: 'Label ID',
  drillLabelElement: 'Element',
  drillLabelEmpty: 'No translation for this label in the loaded configurations.',
  resizeDialog: 'Drag to resize the dialog (double-click to reset)',
  drillHowFilledTitle: 'How the value is filled',
  drillHowFilledHint: 'The formulas that produce this step\'s value. Click any part of a formula to drill into it.',
  lineageTitle: 'Value path',
  lineageHint: 'The whole chain from the format expression down to the field in D365FO. Highlighted parts of a formula are clickable — the path expands down to that source.',
  lineageFormulaLabel: 'Formula',
  lineageExpand: 'Expand',
  lineageCollapse: 'Collapse',
  lineageShowInPath: (name: string) => `Show ${name} in the value path`,
  lineageOpenSegment: (path: string) => `Show what ${path} returns`,
  lineagePeekTitle: 'Selected part of the expression',
  lineagePeekEmpty: 'This part of the path does not lead to a data source of its own — it is only an intermediate hop.',
  lineagePeekClose: 'Back to the whole expression',
  lineageStageOrigin: 'Format expression',
  lineageStageModelPath: 'Model path',
  lineageModelDefinition: 'Definition',
  lineageModelDefinitionTitle: 'Model mapping definition the path was resolved in',
  lineageStageMapping: 'Binding in model mapping',
  lineageStageSource: 'Data source',
  lineageStageFormula: 'Calculated field',
  lineageStageUserParam: 'User parameter',
  lineageStageGroupBy: 'Grouping',
  lineageStageEntity: 'AX object',
  lineageStageUnresolved: 'Unresolved reference',
  drillFormulaMapping: 'Model mapping',
  drillFocusModelPath: 'Model path',
  drillFocusExpression: 'Expression',
  drillOriginalExpression: 'Original expression',
  drillForward: 'Forward',
  drillSourcePropsTitle: 'Source properties',
  drillHowFilledHintSingle: 'The model-mapping formula that fills this path with data.',
  drillHowFilledHintMany: 'The expression uses several model paths. Each one has the formula that fills it in the mapping — click a path or part of a formula to go deeper.',
  drillSourceDetailTitle: 'Value source detail',
  drillSourceTarget: 'Read from',
  drillUserParameterNote: 'Filled in by the user when the report runs — it comes from neither the model nor a table.',

  searchResultCount: (n: number) => `Results: ${n}`,
  propChildren: 'Children',
  propDataType: 'Data type',
  propExcelRange: 'Excel range',
  propId: 'ID',
  propType: 'Type',
  propName: 'Name',
  propEncoding: 'Encoding',
  propMaxLen: 'Max length',
  propValue: 'Value',
  propTransform: 'Transformation',
  propTransformUnnamed: 'Unnamed transformation',
  propExcluded: 'Excluded from DS',
  propYes: 'Yes',
  propDirection: 'Direction',
  formatDirectionImport: 'Import',
  formatDirectionExport: 'Export',
  formatDirectionUnknown: 'Unknown direction',
  importLinkedMappingsLabel: 'Model mappings',
  importNoLinkedMappings: 'No model mappings loaded',

  // Landing page
  landingBadge: 'D365 Finance & Operations · Electronic Reporting',
  landingTitle: 'D365FO ER Visualizer',
  landingSub: 'Load ER configurations from disk or straight from a Finance & Operations environment, then trace format bindings through the model mapping down to the source table, class, or enum.',
  landingDocsLink: 'Documentation',
  landingHomeLinkLabel: 'Back to the D365FO ER Visualizer homepage',
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
  undo: 'Undo',
  removeFromHistory: 'Remove from history',
  historyFileRemoved: (name: string) => `"${name}" removed from history.`,
  historyFilesCleared: (n: number) => `History cleared (${n} file${n === 1 ? '' : 's'}).`,
  historySessionsCleared: (n: number) => `Session history cleared (${n} session${n === 1 ? '' : 's'}).`,
  workspaceClosedAll: (n: number) => `Closed ${n} configuration${n === 1 ? '' : 's'}.`,
  workspaceUndoCloseAll: 'Reopen',
  fnoRemoveProfileConfirmTitle: (name: string) => `Remove profile "${name}"?`,
  fnoRemoveProfileConfirmBody: 'The profile is removed together with its saved sign-in to the environment. To download again you will need to create it and sign in again.',
  cancel: 'Cancel',
  modelViewLabel: 'Model view',
  modelViewList: 'List',
  modelViewGraph: 'Graph',
  modelListFilterPlaceholder: 'Filter model fields…',
  modelListLabel: 'Data model fields',
  modelListMoreMatches: (n: number) => `…and ${n} more field${n === 1 ? '' : 's'} — narrow the filter.`,
  recentSessionLoadFailed: (reason: string) => `The session could not be opened: ${reason}. Open the files again from disk.`,
  splitResize: 'Resize the groups (arrow keys; double-click resets to half)',
  searchShowMore: (next: number, remaining: number) => `Show ${next === remaining ? 'the remaining' : 'the next'} ${next}${next === remaining ? '' : ` (${remaining} left)`}`,
  drillTruncated: 'The path branches too much to show in full — some sources are missing from “Used data” too. Click a part of the expression to narrow the breakdown to it.',
  fnoIngestCancel: 'Cancel download',
  landingOpen: 'Open designer',
  landingFooter: 'D365 FO ER Visualizer · Electronic Reporting Configuration Inspector',

  recentFiles: 'Recent files',
  recentConfigs: 'Recent configurations',
  recentOpen: 'Open',
  recentAddToOpen: 'Add to open',
  recentMoreActions: 'More actions',
  recentSourceFile: 'Local file',
  recentSourceFiles: 'Local files',
  recentSourceFileNamed: (file: string) => `File ${file}`,
  recentSourceFno: 'D365 F&O',
  recentSourceFnoHost: (host: string) => `F&O · ${host}`,
  recentBundledFrom: (file: string) => `Part of ${file}`,
  recentNotCached: 'not stored in the browser',
  recentNotCachedHint: 'The browser no longer has the content — open the file again from disk or download it from F&O.',
  recentOpenConfigHint: 'Add this configuration to the workspace',
  recentSessionUnavailable: 'The browser no longer has the configurations of this session. Open them again from disk or download them from F&O.',
  recentSessionCount: (n: number) => `${n} configuration${n === 1 ? '' : 's'}`,
  recentSessionContents: (n: number) => `Session contents: ${n} configuration${n === 1 ? '' : 's'}`,
  recentShowAll: (n: number) => `Show all ${n}`,
  recentShowLess: 'Show less',
  recentFilterPlaceholder: 'Filter recent configurations…',
  noRecentFiles: 'No recently opened files.',
  recentReloadHint: 'Reload file',
  recentSessions: 'Recent sessions',
  recentSessionTitle: (count: number) => `Session (${count} ${count === 1 ? 'file' : 'files'})`,
  recentSessionMergeHint: 'Add the session’s configurations to the ones that are open',
  recentSessionReplaceHint: 'Close what is open and open this session',
  recentSessionFileHint: 'Add configuration to workspace',
  clearRecent: 'Clear history',
  loadSample: 'Load sample configuration',
  validatorOk: 'Configuration looks fine.',
  validatorIssues: (n: number) => `${n} warning${n === 1 ? '' : 's'}`,
  forward: 'Forward',
  cmdCollapseAll: 'Collapse entire tree',
  cmdExpandAll: 'Expand entire tree',
  cmdExportWhereUsed: 'Export where-used to CSV',

  toastLoadFailed: (file: string) => `Failed to load "${file}".`,
  dismiss: 'Dismiss',
  panelMaximize: 'Maximize panel',
  panelRestore: 'Restore panel size',
  panelClose: 'Close panel',

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
  fnoProfileNameHint: 'How the environment appears in the list.',
  fnoEnvUrl: 'Environment URL',
  fnoEnvUrlHint: 'The address F&O runs on — no path after the domain.',
  fnoEnvUrlInvalid: 'Enter a valid address starting with https://',
  fnoSignInHint: 'Clicking Connect opens the standard Microsoft sign-in.',
  fnoMissingBuiltInClientId:
    'This build has no VITE_FNO_CLIENT_ID configured, so sign-in cannot run. ' +
    'Set it to the Application (client) ID of a multi-tenant SPA registration ' +
    'with the delegated Dynamics ERP permission and this redirect URI:',
  fnoRedirectUriHint: 'Redirect URI — register exactly this value in Entra under "Single-page application":',
  fnoRedirectUriCopy: 'Copy',
  fnoRedirectUriCopied: 'Redirect URI copied to clipboard.',
  fnoSaveProfile: 'Save profile',
  fnoUpdateProfile: 'Save changes',
  fnoNewProfile: 'New profile',
  fnoNewProfileTitle: 'New environment profile',
  fnoEditProfileTitle: 'Edit environment profile',
  fnoEditProfile: 'Edit profile',
  fnoCancel: 'Cancel',
  fnoConnect: 'Connect',
  fnoDisconnect: 'Disconnect',
  fnoConnecting: 'Connecting…',
  fnoConnected: (user: string) => `Connected as ${user}`,
  fnoProfiles: 'Environments',
  fnoNoProfiles: 'No environment here yet.',
  fnoNoProfilesHint: 'Add a profile with a name and the F&O environment URL, then sign in with your Microsoft account.',
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
  fnoIngestAborted: (message: string) => `F&O download was aborted: ${message}`,
  excelCellGoToStructure: 'Click to jump to the structure',
  statusDerivedFromModel: 'model: ',
  statusDerivedFromModelTitle: (kind, parentName) => `Active config is a ${kind === 'Format' ? 'format' : 'mapping'} derived from model "${parentName}"`,
  statusGuidCount: (n) => `GUIDs: ${n}`,
  fnoMappingNotAvailable: (names: string[]) => `ModelMapping could not be downloaded for: ${names.join(', ')}. Format element bindings are still available via FormatMapping.`,
  fnoModelIdNotExposed: (names: string[]) => `F&O exposes no id for these models and their mappings: ${names.join(', ')}. There is nothing to request them with, so they are listed as skipped. For an import format there is no way around it: the model is named only in its separate mapping — the format itself does not reference the model. Only the format was downloaded; its element bindings are still available via FormatMapping.`,
  fnoImportMappingNotFound: (names: string[]) => `The mapping that belongs to the selected import format was not found (model: ${names.join(', ')}). F&O returned other formats' mappings, or the export-side mapping of the same model — they are loaded, but none belongs to this format (none names it in ERImportFormatDatasource, and none has the empty model definition of a destination mapping).`,
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
  propNotBound: 'Not bound',
  propValidations: 'Validations',
  mappingNoValidations: 'This mapping defines no validations',
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
  errorChunkTitle: 'Part of the application could not be downloaded.',
  errorChunkDescription: 'The server is probably unavailable, or the application was updated in the meantime. Reload the page.',
  errorReload: 'Reload page',

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
  excelTemplateImage: 'Template image',
  excelTemplateImages: (n: number) => `${n} image${n === 1 ? '' : 's'}`,
  excelTemplateDropHint: 'Drop the .xlsx file from the exported ER solution package here',
  excelTemplateDropActive: 'Release to load .xlsx…',
  excelTemplateDropInvalid: '.xlsx files only',
  excelTemplateLoadBtn: 'Load template (.xlsx)',
  pdfConvertedFrom: (source: string) => `Output is converted to PDF from the ${source} template`,
  pdfNoSourceComponent: 'The PDF converter contains no nested component that can be previewed.',
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
  fnoStatusResolvingLabels: 'Resolving labels from ancestor models…',
  fnoStatusScanMappings: 'Downloading configurations & scanning for mappings…',
  fnoStatusDownloadingMM: 'Downloading Model Mappings…',
  fnoStatusDownloadingMMCount: (n: number) => `Downloading Model Mappings (${n})…`,
  fnoStatusLateDM: 'Resolving DataModels from mapping cross-references…',
  fnoSkippedDerived: (name: string) => `"${name}" has no own XML (derived configuration) — skipped.`,
  fnoSkippedDraft: (name: string) => `"${name}" has only a draft version — F&O serves completed versions only, so there is nothing to download. Complete the version in F&O (Reporting configurations → Versions → Complete).`,
  fnoDraftOnly: 'Draft',
  fnoDraftOnlyHint: 'Cannot be downloaded: this configuration has no completed version. F&O only serves the completed (effective) version — complete it in F&O (Reporting configurations → Versions → Complete) and it becomes selectable here.',
  fnoSelectedCount: (n: number) => `${n} selected (across levels)`,
  fnoSelectedCountLabel: 'selected (across levels)',
  treeCollapseNode: 'Collapse',
  treeExpandNode: 'Expand',
  fnoPickModelHint: 'Select a Data Model on the left to browse its configurations.',
  fnoNoConfigurationsHint: 'No ER configurations found in this environment. Sign in to F&O and go to Organization administration → Electronic reporting → Configuration providers → Microsoft (Active) → Repositories → LCS → Open → Import to pull configurations from Lifecycle Services. Then reconnect here. (Details: DevTools → Console → filter "[fno-client]".)',
  fnoFilterModels: 'Filter models…',
  fnoFilterConfigurations: 'Filter configurations…',
  fnoSearchEverywhere: 'Search formats too',
  fnoSearchEverywhereHint: 'Walks every model and matches the formats and mappings underneath them as well. It downloads the configuration list of each model, so a large environment takes a while.',
  fnoSearchResults: (query: string) => `Search results: "${query}"`,
  fnoSearchProgress: (done: number, total: number) => `Scanning models — ${done}/${total}`,
  fnoSearchHits: (n: number) => `${n} found`,
  fnoSearchNoHits: (query: string) => `No format or mapping matches "${query}".`,
  fnoSearchClear: 'Clear search',
  fnoNoModelMatch: (query: string) => `No model matches "${query}".`,
  fnoNoModelMatchHint: 'Formats and mappings live below the models — the Search formats too button finds those.',
  fnoSearchOpenModel: (model: string) => `Open model ${model}`,
  fnoSearchFailed: (n: number) => `${n} model(s) could not be scanned — results may be incomplete.`,
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

  // Audit fixes (a11y labels, former inline ternaries)
  designerWorkspaceEyebrow: 'Designer Workspace',
  designerUnsupportedView: (kind) => `Unsupported view for: ${kind}`,
  excelLegendConstantWord: 'constant',
  dsCrossCompany: 'cross-company',
  dsNestedCount: (n) => `${n} nested datasource${n === 1 ? '' : 's'}`,
  dsGroupBy: 'Group By',
  dsAggregated: 'Aggregated',
  dsImplicitType: 'Path node',
  dsImplicitHint: 'Not declared as a datasource — a data model record or a path segment that other datasources are nested under.',
  dsModelField: 'Data model field',
  dsModelNotLoaded: 'data model not loaded',
  bindingCount: (n) => `${n} binding${n === 1 ? '' : 's'}`,
  bindingVia: 'via',
  searchNoResultsInScope: 'No results in this scope.',
  searchRelatedOnly: 'Related only',
  searchRelatedOnlyHint: 'Search only the open configuration, its data model and mappings of the same model.',
  searchAllConfigs: 'All',
  searchAllConfigsHint: 'Search every loaded configuration, including unrelated models.',
  searchRelatedEmpty: 'Nothing in the related configuration — switch to "All".',
  searchHiddenByRelated: (n: number) => `Hidden in unrelated configurations: ${n}`,
  searchHiddenByRelatedShort: (n: number) => `+${n} elsewhere`,
  searchGroupDefinition: (name: string) => `Definition: ${name}`,
  searchGroupDefinitionHint: (name: string) => `Mapping definition ${name}`,
  searchCatStructure: 'Structure',
  searchCatBindings: 'Bindings',
  searchCatExpressions: 'Expressions',
  searchCatDatasources: 'Data sources',
  searchCatReferences: 'References',
  wuCatBindings: 'Mapping bindings',
  wuCatExpressions: 'Expressions and validations',
  wuCatFormat: 'Format elements',
  pathSegmentDatasource: 'DS',
  tooltipClickToNavigate: 'Click to navigate',
  activityBarLabel: 'Activity bar',
  propLabels: 'Labels',
  propUnknownType: (type: string) => `Unknown (${type})`,
  labelTextNotFound: 'Label text not found in loaded configurations',
  kindDataModel: 'Data model',
  kindModelMapping: 'Model mapping',
  kindFormat: 'Format',
  nodeTypeLabel: (type: string) => ({
    file: 'File',
    solution: 'Solution',
    model: 'Model',
    container: 'Container',
    field: 'Field',
    mapping: 'Mapping',
    datasource: 'Data source',
    binding: 'Binding',
    validation: 'Validation',
    format: 'Format',
    formatElement: 'Format element',
    formatBinding: 'Format binding',
    enum: 'Enumeration',
    enumValue: 'Enum value',
    transformation: 'Transformation',
    section: 'Section',
  } as Record<string, string>)[type] ?? type,
  closeTab: (label: string) => `Close ${label}`,
  splitOpenBeside: 'Open to the side',
  splitOpenLeft: 'Open on the left',
  splitOpenRight: 'Open on the right',
  splitMoveLeft: 'Move to the left group',
  splitMoveRight: 'Move to the right group',
  splitCloseSideGroup: 'Close the right group (its tabs move to the left)',
  splitCloseMainGroup: 'Close the left group (its tabs move to the right)',
  drillPinAsTab: 'Pin as tab',
  drillOpenBeside: 'Open to the side',
  drillOpenBesideHint: 'Open the drill-down as a tab next to the active tab, to compare',
  notificationsLabel: 'Notifications',
  drillOpenAsTab: 'Open as tab',
  // Model designer badges, text preview, error boundary areas
  modelRootBadge: 'ROOT',
  modelEnumBadge: 'ENUM',
  previewRepeatingStart: (name: string) => `--- ${name} (repeating) ---`,
  previewRepeatingEnd: (name: string) => `--- end ${name} ---`,
  excelSheet: 'Sheet',
  excelRange: 'Range',
  excelCell: 'Cell',
  formatTypeFile: 'File',
  errorAreaLanding: 'Landing page',
  errorAreaDesigner: 'Designer',
  validationActionBadge: (value: string) => `Action: ${value}`,
  validationSeverityBadge: (value: string) => `Severity: ${value}`,
  // F&O connection panel
  fnoRootNoSolutions: (root: string) => `Root "${root}" still returned no solutions. Either the publisher name is wrong, or the environment has no ER configurations imported.`,
  fnoNoSolutionsFound: 'No solutions found under the known roots.',
  fnoCustomRootHint: 'If you know a specific publisher name, type it here and retry:',
  fnoCustomRootPlaceholder: 'Publisher / root solution name',
  fnoTypeMapping: 'Mapping',
  fnoTypeModel: 'Model',
  fnoUnreachableMapping: 'F&O does not expose a service ID for this ModelMapping. Its rules are bundled into the Format XML.',
  fnoNoDownloadableContent: 'No downloadable content — pure-inheritance derived configuration.',
  fnoBranchNodeHint: 'Branch node — click to drill into children',
  fnoViaParent: 'via parent',
  fnoDrillInto: 'Drill into children',
  fnoUnknownError: 'Unknown error',
  fnoErrServiceNotFound: (url: string, serviceUrl: string, operation: string) =>
    `404 Not Found (${url}). The custom service or operation does not exist on this environment. ` +
    `Open ${serviceUrl} in a browser ` +
    `and check that the operation "${operation}" is listed under <Operations>. If it has a different name, update ER_SERVICE_OPS in packages/fno-client/src/er-services.ts`,
  fnoErrEndpointNotFound: (status: string) => `${status}. The endpoint does not exist on this environment. Check the exact environment URL (without /namespace) and that the ER services are installed`,
  fnoErrForbidden: (status: string) => `${status}. The F&O user has no access to the ER services. Assign the "Electronic reporting developer" or "Electronic reporting functional consultant" role`,
  fnoErrRedirectDesktop: 'AADSTS50011: Redirect URI mismatch. Under App registration → Authentication → Mobile and desktop applications, add "http://localhost".',
  fnoErrRedirectWeb: (uri: string) =>
    `AADSTS50011: Redirect URI mismatch. The app sends exactly:\n` +
    `    ${uri}\n` +
    `Register this value under Entra → App registrations → Authentication → Add a platform → ` +
    `Single-page application (not "Web", not "Mobile and desktop applications").\n` +
    `It must match character for character — no trailing slash and no path.\n` +
    `Note: every preview deployment has its own hostname and needs its own entry.`,
  fnoErrClientIdUnavailable: 'AADSTS700016: The application (client) ID built into this build is not available in this tenant. If you host the tool yourself, set VITE_FNO_CLIENT_ID (FNO_CLIENT_ID for the desktop app) to your own multi-tenant registration.',
  fnoErrConsentRequired: 'AADSTS65001: Sign-in was not consented. A tenant admin has to approve the app once (Entra → Enterprise applications → Admin consent requests) for the delegated permission Dynamics ERP CustomService.FullAccess.',
  fnoErrScopeMismatch: 'AADSTS500011: The scope (envUrl) matches no service principal. Check the exact environment URL (no trailing slash) and that Dynamics 365 F&O is installed in this tenant.',
  fnoErrWrongTenant: 'AADSTS50020: The signed-in account is not in the tenant the F&O environment runs in. Sign in with a work account from that tenant, or a guest account that has been accepted there.',
  fnoErrCodeUsed: (code: string) => `AADSTS${code}: The authorization code has already been used or is invalid. Try signing in again.`,
  fnoErrMfaRequired: (code: string) => `AADSTS${code}: MFA is required. Complete the prompt in the browser and try again.`,
  fnoErrPublicClientFlows: 'AADSTS7000218: The app registration does not allow public client flows. In Entra → App registrations → Authentication, set "Allow public client flows" to Yes.',
  fnoErrRedirectIsSpa: 'AADSTS9002326: The redirect URI is registered as a "Single-page application". Move it under "Mobile and desktop applications" (http://localhost).',

  // ─── F&O sign-in module loading (fno/auth-factory.ts) ───
  fnoAuthModuleLoadFailed: (moduleName: string) => `Could not load the sign-in module (${moduleName}). It is downloaded on demand and the download failed — usually a stopped dev server, a redeploy that replaced the chunk, or a network drop. Reload the page (Ctrl+F5) and try again.`,
  fnoAuthElectronBridgeMissing: 'Electron auth bridge is unavailable — the preload script did not load, so window.electronAPI is missing. Check the main-process console for "[electron] preload failed to load"; the usual cause is a preload compiled as ESM (the package has "type": "module", a sandboxed preload must be CommonJS → dist/preload.cjs). Rebuild with `pnpm --filter @er-visualizer/electron build` and restart the application.',

  // ─── File loading (utils/file-loading.ts) ───
  fileNotXml: 'is not an XML file',

  // ─── Format binding sections (utils/format-binding-sections.ts, format-binding-display.ts) ───
  bindingIntentLabels: { direct: 'Direct values', calculated: 'Calculations', condition: 'Conditions', text: 'Texts', property: 'Properties' },
  bindingIntentItemLabels: { direct: 'Value', calculated: 'Calculation', condition: 'Condition', text: 'Text', property: 'Property' },
  bindingIntentHints: { direct: 'Value taken unchanged from the data model or a data source', calculated: 'Value an expression computes or transforms — functions, operators', condition: 'When the element is generated — Enabled, Visible and the like', text: 'Fixed text or a constant, typically column captions (@GER_LABEL)', property: 'Element settings — file name, language, format, encoding' },
  formatBindingCategoryLabels: { data: 'Data', visibility: 'Visibility', formatting: 'Formatting', property: 'Other Properties' },
  formatBindingValueBadge: 'Value',

  // ─── Configuration warnings (state/config-warnings.ts) ───
  warnLoadDataModelForDrillDown: 'Load a Data Model file as well for a complete drill-down.',
  warnFormatWithoutMapping: 'Format loaded without a Model Mapping — expressions cannot be traced back to source tables.',
  warnBrokenDatasourceRefs: (formatName: string, count: number, detail: string, hidden: number) => `Format "${formatName}" contains ${count} expressions that reference an unknown data source.\n${detail}${hidden > 0 ? `\n  … and ${hidden} more` : ''}`,

  // ─── Explorer tree section labels (state/tree-builder.ts) ───
  treeDsGroupLabels: { DataModel: 'Data model', Table: 'Tables', CalculatedField: 'Calculated Fields', Class: 'Classes', Enum: 'Ax Enums', ModelEnum: 'Data model Enums', FormatEnum: 'Format enums', ImportFormat: 'Import formats', UserParameter: 'User Parameters', GroupBy: 'Group By', Container: 'Containers', Join: 'Joins', Object: 'Objects' },
  treeDataModelSections: { roots: 'Model Definitions', enums: 'Enumerations', records: 'Records' },
  treeMappingSections: { title: 'Mapping', dataSources: 'Data Sources', bindings: 'Bindings', validations: 'Validations' },
  treeFormatSections: { outputStructure: 'Output Structure', modelMappings: 'Model Mappings', enumerations: 'Enumerations', transformations: 'Transformations', dataSources: 'Data Sources', bindings: 'Bindings', noBindings: 'no bindings' },
  treeGroupBySections: { groupedBy: 'Grouped By', aggregated: 'Aggregated' },
  groupOther: 'Other',
  treeEmbeddedMappingUsedSuffix: '  ✓ used by loaded format',

  // ─── Store toasts (state/store.ts) ───
  toastNewerVersionOpen: (fileName: string, version: string | number, loadedVersion?: string | number) => `${fileName} (version ${version}) was not loaded — a newer version${loadedVersion ? ` ${loadedVersion}` : ''} is already open.`,
  toastLoadFailedWithMessage: (fileName: string, message: string) => `Failed to load ${fileName}: ${message}`,
  toastConfigClosed: (name: string) => `Configuration "${name}" was closed.`,
  toastReopen: 'Reopen',
  toastSessionNotCached: 'The session content is no longer cached, please open the files again.',
  toastSessionFilesMissing: (files: string) => `Some files in the session were not loaded (not cached): ${files}.`,
  toastAlreadyOpen: (label: string) => `"${label}" is already open in the workspace.`,
  toastFileNotCached: (label: string) => `"${label}" is no longer cached, please open the file again.`,

  // ─── Path tooltip rows (utils/path-tooltip.ts) ───
  pathTipInside: 'Inside',
  pathTipReadsTables: 'Reads tables',
  pathTipCallsClasses: 'Calls classes',
  pathTipViaCalcFields: 'Via calculated fields',
  pathTipOpenDatasource: 'Click to open the data source',
  pathTipOpenBinding: 'Click to open the binding',
  pathTipSource: 'Source',
  pathTipTableField: 'Table field',
  pathTipClassMember: 'Class member',
  pathTipEnumValue: 'Enum value',
  pathTipDatasourceField: 'Data source field',
  pathTipModelField: 'Data model field',
  pathTipMappingBinding: 'Mapping binding',
  pathTipRecord: 'Record',
  pathTipRecordFieldsBound: (n: number) => `Its fields carry the bindings (${n})`,
  pathTipNearestBinding: 'Nearest binding',
  pathTipMapping: 'Mapping',
  pathTipNoBinding: 'No binding in the loaded mappings',
  pathTipModelRoot: 'Model root',
  pathTipDataModel: 'Data model',
  pathTipUserParameter: 'User parameter',

  // ─── Consultant view words (utils/consultant-labels.ts) ───
  consultantFormatTypeLabels: { File: 'File', ExcelFile: 'Excel', WordFile: 'Word', PDFFile: 'PDF', XMLElement: 'Element', XMLAttribute: 'Attribute', XMLSequence: 'Sequence', String: 'Text', Numeric: 'Number', DateTime: 'Date and time', Base64: 'Attachment', ExcelSheet: 'Sheet', ExcelRange: 'Range', ExcelCell: 'Cell', ExcelHeader: 'Header', ExcelFooter: 'Footer', TextSequence: 'Sequence', TextLine: 'Line', Sequence: 'Sequence', Common: 'Element', Empty: 'Empty element' },
  consultantElementFallback: 'Element',
  consultantDataTypeLabels: { String: 'Text', Real: 'Number', DateTime: 'Date and time', Container: 'Attachment' },
  consultantFieldTypeLabels: { 1: 'Yes/no', 3: 'Whole number', 4: 'Whole number', 5: 'Number', 6: 'Text', 7: 'Date', 9: 'Enumeration', 10: 'Record', 11: 'Record list', 13: 'Binary data' },
  consultantBindingCategoryLabels: { data: 'Value', visibility: 'Visibility', formatting: 'Formatting', property: 'Other properties' },
  consultantPropertyLabels: { FileName: 'File name', FileLanguage: 'Language', FileCulture: 'Culture' },
  consultantTurnedOff: 'Turned off',
  consultantTurnedOn: 'Turned on',
  consultantCondition: 'Condition',

  // ─── Enum type labels (utils/enum-display.ts) ───
  enumTypeLabels: { Ax: 'Ax Enum', DataModel: 'Data model Enum', Format: 'Format enum' },

  // ─── Configuration kind labels (DependencyPromptDialog.tsx, ConfigExplorer.tsx) ───
  configKindLabels: { DataModel: 'Data model', ModelMapping: 'Model mapping', Format: 'Format' },
  explorerKindPills: { DataModel: 'Model', ModelMapping: 'Mapping', Format: 'Format' },
  explorerGroupLabels: { DataModel: 'Data Models', ModelMapping: 'Model Mappings', Format: 'Formats' },
  explorerChipLabels: { DataModel: 'Models', ModelMapping: 'Mappings', Format: 'Formats' },

  // ─── F&O ingest steps (FnoIngestPanel.tsx) ───
  fnoIngestSteps: { prepare: 'Preparing', dm: 'Data models', fm: 'Formats & mappings', mm: 'Model mappings', finalize: 'Finalizing' },

  // ─── Data source groups (designers/DatasourceTree.tsx) ───
  dsGroupLabelsTechnical: { Table: 'Tables', CalculatedField: 'Calculated Fields', Class: 'Classes', Object: 'Objects', Enum: 'Ax Enums', ModelEnum: 'Data model Enums', FormatEnum: 'Format enums', ImportFormat: 'Import formats', UserParameter: 'User Parameters', GroupBy: 'Group By', Container: 'Containers', Join: 'Joins', DataModel: 'Data model' },
  dsGroupLabelsConsultant: { Table: 'Tables', CalculatedField: 'Calculated values', Class: 'Logic', Object: 'Objects', Enum: 'Values', ModelEnum: 'Values', FormatEnum: 'Values', ImportFormat: 'Import format', UserParameter: 'Parameters', GroupBy: 'Grouped data', Container: 'Containers', Join: 'Joins', DataModel: 'Data model', Values: 'Values' },
  dsImportFormat: 'Import format',
  dsGroupedBy: 'Grouped by',

  // ─── Data model designer (designers/DataModelDesigner.tsx) ───
  dmDesignerTitle: 'Data Model',
  dmDatasourceProperties: 'Datasource properties',
  dmNoRelevantBindings: 'No relevant bindings for the selected datasource.',

  // ─── Format designer tabs (designers/FormatDesigner.tsx) ───
  fmtTabStructureTitle: 'Hierarchical structure of format elements with data model bindings',
  fmtTabBindingsTitle: 'Bindings by intent — direct values, calculations, conditions, texts — in the order the file is built',
  fmtTabDatasourcesTitle: 'Mapping data sources — tables, enums, classes and calculated fields',
  fmtTabPreviewTitle: 'Preview of generated output in the correct format',
  fmtTabEmbeddedMapping: 'Mapping',
  fmtTabEmbeddedMappingTitle: 'Model mapping embedded directly in the import format',
  fmtElementsOutsideStructure: 'Elements outside the format structure',

  // ─── Format preview (designers/FormatPreview.tsx) ───
  previewUnresolvedValues: 'Unresolved values:',
  previewSampleData: 'Sample data',
  previewKeepPlaceholder: 'Keep {placeholder}',
  previewHideUnresolved: 'Hide unresolved',
  previewCsvView: 'CSV view:',
  previewFirstRowHeader: 'First row = header',

  // ─── Model mapping designer (designers/ModelMappingDesigner.tsx) ───
  mmDefinitionTitleTechnical: 'Mapping definition (DataContainerDescriptor — root container of the data model)',
  mmDefinitionTitle: 'Mapping definition',
  mmDefinition: 'Definition',
  mmClickToSwitch: (title: string) => `${title} — click to switch`,
  mmDesignerTitle: 'Model mapping',
  mmDesignerHint: 'Click a row for properties, the formula for its value breakdown',
  mmRuleCount: (n: number) => `Number of rules: ${n}`,
  mmBranchBindingCount: (n: number) => `Number of bindings in this branch: ${n}`,

  // ─── Search panel (SearchPanel.tsx) ───
  searchExampleSections: { mapping: 'Where the data comes from', calc: 'Calculations and conditions', output: 'Shape of the output' },
  searchExamplePresets: { model: 'Everything read from the data model', companyInfo: 'Where company details are used', labels: 'Where labels come from', round: 'Where amounts get rounded', conditional: 'Conditional logic in expressions', calculated: 'Calculated fields and subtotals', dateFormat: 'Date and time formatting', numberFormat: 'Number formatting', concatenate: 'Text values being pieced together' },
  whereUsedExampleSections: { impact: 'Impact of a change', trace: 'Tracing a value' },
  whereUsedExamplePresets: { table: 'What breaks if a table changes', enumType: 'Where an enum is relied on', lookup: 'Where a lookup is used', parameter: 'Where a parameter takes effect', ledgerAccount: 'What fills the ledger account', calculated: 'What sits behind a calculated field' },
  searchShowingFirst: (shown: number, total: number) => `Showing first ${shown} of ${total}`,
  searchScopeResultsAria: 'Scope',
  whereUsedScopeAria: 'Scope',
  searchReachAria: 'Search reach',
  searchScopeAll: 'All',
  searchScopeFormat: 'Format',
  searchScopeMapping: 'Mappings',
  searchScopeModel: 'Model',
  searchMinChars: (n: number) => `Type at least ${n} characters.`,
  searchLblFormatExpression: 'Format expression',
  searchLblVisibility: 'Visibility',
  searchLblFormatting: 'Formatting',
  searchLblProperty: 'Property',
  searchLblTable: 'Table',
  searchLblEnum: 'Enum',
  searchLblClass: 'Class',
  searchLblParameter: 'Parameter',
  searchLblField: 'Field',
  searchLblBinding: 'Binding',
  searchLblExpression: 'Expression',
  searchLblCalcField: 'Calc. field',
  searchLblFieldType: 'Field type',
  searchLblModelRef: 'Model ref',
  searchLblBaseRef: 'Base ref',
  searchLblFormatRef: 'Format ref',
  searchLblReference: 'Reference',
  searchLblUnresolvedRef: 'Unresolved reference',
  searchExprSource: (component: string) => `source: ${component}`,
  searchExprParam: (component: string) => `param: ${component}`,
  searchKindLabels: { Format: 'Format', ModelMapping: 'Model Mapping', DataModel: 'Data Model' },
  searchTabDatasources: 'Data Sources',
  searchLocalizeBindingKind: (label: string) => label,
  searchRefKindLabels: { calc: 'Calculated', param: 'Parameter', agg: 'Aggregation', validation: 'Validation', message: 'Message' },

  // ─── Format bindings view (designers/FormatBindingsView.tsx) ───
  fbReadsPrefix: 'The format reads ',
  fbReadsSuffix: (n: number) => ` model ${n === 1 ? 'field' : 'fields'}`,
  fbMappingPrefix: 'Mapping: ',
  fbMappingNotLoadedFor: (descriptor: string | null | undefined) => `No model mapping loaded for ${descriptor || 'the data model'}`,
  fbUnmappedCount: (n: number) => `${n} without a mapping binding`,
  fbLoadModelForLabels: 'Load the data model to see field labels',
  fbOnlyUnmappedHint: 'Only fields the format reads and the mapping never fills',
  fbOnlyUnmapped: 'Unmapped only',
  fbAllFieldsMapped: 'Every field the format reads has a mapping binding.',
  fbBranchUnmappedCount: (n: number) => `Without a mapping binding in this branch: ${n}`,
  fbUsageCount: (n: number) => `Uses in the format: ${n}`,
  fbLineMapping: 'Mapping',
  fbFieldNeverFilledHint: 'The mapping never fills this field, so the format gets an empty value here.',
  fbNoMappingBinding: 'No mapping binding',
  fbMappingNotLoaded: 'Mapping not loaded',
  fbRecordFieldsBound: 'Record — its fields carry the bindings',
  fbLineFormat: 'Format',
  fbMoreUsages: (n: number) => `+${n} more`,
  fbLayoutByFormat: 'By format',
  fbLayoutByFormatHint: 'Bindings in the order the file is built',
  fbLayoutByModel: 'By model',
  fbLayoutByModelHint: 'Data model fields the format reads, and what fills them in the mapping',
  fbToolbarAria: 'Bindings layout and filter',
  fbLayoutAria: 'Bindings layout',
  fbNothingInSelectedTypes: (hiddenList: string) => `Nothing in the selected binding types. Hidden: ${hiddenList}.`,
  fbShowAll: 'Show all',
  fbHiddenByFilter: (n: number) => `More bindings of this element hidden by the filter: ${n}`,

  // ─── Drill-down panel (DrillDownPanel.tsx) ───
  drillBadgeLabels: { root: 'Expression', model: 'Model', mapping: 'Mapping', ds: 'Field', table: 'AX table', enum: 'AX enum', class: 'AX class', calc: 'Calculated field', container: 'Folder', groupby: 'Group by', join: 'Join', object: 'AX object', userparameter: 'User parameter', param: 'User parameter', importformat: 'Import format', leaf: 'AX table', unknown: 'Unknown' },
  drillBadgeGroupLabels: { table: 'AX tables', enum: 'AX enums', class: 'AX classes', calc: 'Calculated fields', container: 'Folders', groupby: 'Group by', join: 'Joins', object: 'AX objects', userparameter: 'User parameters', param: 'User parameters', importformat: 'Import formats', leaf: 'AX tables', unknown: 'Unknown' },
  drillSourceFallback: 'Source',
  drillRuleStop: 'Stop',
  drillRuleWarning: 'Warning',
  drillUnresolved: 'Unresolved',
  drillMappingNode: 'Mapping',
  drillParamEnteredAtRunTime: 'entered by the user at run time',
  drillNoDataReference: 'No data reference',
  drillCopy: 'Copy',
  drillCopied: (value: string) => `Copied: ${value}`,
  drillCopyFailed: 'Copy failed (clipboard is not available).',
  drillAutoCompact: (nodes: number) => `Auto: compact mode (${nodes} nodes)`,
  drillViewAria: 'View',
  drillViewDetailHint: 'Expression detail',
  drillViewDetail: 'Detail',
  drillViewTreeHint: 'Tree view',
  drillViewTree: 'Tree',
  drillLabelModeAria: 'Node label mode',
  drillCompactHint: 'Compact label mode',
  drillCompact: 'Compact',
  drillFullHint: 'Full label mode',
  drillFull: 'Full',
  drillShowUnresolvedHint: 'Show unresolved references',
  drillValidationDetails: 'Validation details',
  drillRuleCount: (n: number) => `${n} ${n === 1 ? 'rule' : 'rules'}`,

  // ─── Where-used text matches (state/where-used.ts) ───
  whereUsedTextMatchName: (query: string) => `"${query}" (occurrences in expressions)`,
};

export let t: Translations = locale === 'cs' ? cs : en;

/** Translations for an explicit locale — for callers that are handed one instead of reading the active locale. */
export function getTranslations(forLocale: Locale): Translations {
  return forLocale === 'cs' ? cs : en;
}

