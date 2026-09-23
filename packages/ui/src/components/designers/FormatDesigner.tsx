import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckmarkCircleRegular, CircleRegular, ArrowUploadRegular, ArrowDownloadRegular } from '@fluentui/react-icons';
import { useAppStore, getScopedMappingDefinitions } from '../../state/store';
import { buildModelUsageTree, countModelUsageIntents, filterModelUsageTree, type ModelUsageNode } from '../../utils/format-model-usage';
import { formatReferencedModelIds, normGuid } from '../../utils/model-hierarchy';
import { countDeclaredDatasources, findModelForDescriptor, type DatasourceModel } from '../../utils/datasource-tree';
import { ExpandCollapseSlider } from '../ExpandCollapseSlider';
import { FilterField } from '../FilterField';
import { t, useLocale } from '../../i18n';
import { buildFormatBindingPresentation } from '../../utils/format-binding-display';
import {
  BINDING_INTENT_ORDER,
  DEFAULT_BINDING_INTENTS,
  buildFormatBindingSections,
  classifyBindingIntent,
  countBindingIntents,
  type BindingIntent,
} from '../../utils/format-binding-sections';
import { buildFormatTreeIndex, type FormatTreeIndex } from '../../utils/format-tree-filter';
import { countTerms, suggestionsFromCounts, type FilterSuggestion } from '../../utils/filter-suggestions';
import { ERDirection, type ERConfiguration, type ERDataModelContent, type ERDatasource, type ERModelMappingContent, type ERFormatContent, type ERFormatTransformation } from '@er-visualizer/core';
import { resolveLabel, buildLabelPool, labelLanguageTag } from '../../utils/label-resolver';
import { useCompactLayout } from '../../utils/responsive';
import { useTabState } from '../../utils/tab-view-state';
import { findTreeNodeByMatch, SlidingTabs, datasourceFocusKey, collectDatasourceTerms, EMPTY_STRING_SET } from './shared';
import { type GroupedDatasourceListHandle, GroupedDatasourceList } from './DatasourceTree';
import { MappingDesigner } from './ModelMappingDesigner';
import { FormatPreview } from './FormatPreview';
import { FormatTypeBadge } from './format-type';
import { FormatStructureTree } from './FormatElementTree';
import { BINDING_OUTLINE_THRESHOLD, ModelUsageView, BindingIntentBar, BindingListEmpty, FormatElementBindingGroup } from './FormatBindingsView';

function getFormatDirectionLabel(direction: ERDirection | undefined): string {
  if (direction === ERDirection.Import) return t.formatDirectionImport;
  if (direction === ERDirection.Export) return t.formatDirectionExport;
  return t.formatDirectionUnknown;
}

/** Every element name in a format tree, children included. */
function collectFormatElementTerms(element: any, out: string[] = []): string[] {
  if (!element) return out;
  if (element.name) out.push(element.name);
  for (const child of element.children ?? []) collectFormatElementTerms(child, out);
  return out;
}

// ─── Format Designer (PRIMARY VIEW) ───

/** Recursively scan all datasources (and their children) for an ImportFormat datasource
 *  that references the given format GUID (braces stripped, lower-cased). */
function hasImportFormatDatasource(datasources: any[], normalizedFormatId: string): boolean {
  for (const ds of datasources) {
    if (ds.type === 'ImportFormat') {
      const raw = (ds.importFormatInfo?.formatGuid ?? '').replace(/[{}]/g, '').toLowerCase();
      if (raw === normalizedFormatId) return true;
    }
    if (ds.children?.length > 0 && hasImportFormatDatasource(ds.children, normalizedFormatId)) {
      return true;
    }
  }
  return false;
}

export function FormatDesigner({ config, configIndex, focusNode, tabId }: { config: ERConfiguration; configIndex: number; focusNode: any | null; tabId?: string }) {
  const fc = config.content as ERFormatContent;
  const fmt = fc.formatVersion.format;
  const fmtMap = fc.formatMappingVersion.formatMapping;
  const rootElement = fmt.rootElement;
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const selectNode = useAppStore(s => s.selectNode);
  const treeNodes = useAppStore(s => s.treeNodes);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const configurations = useAppStore(s => s.configurations);
  // Model labels and the view tabs' tooltips are memoized in the app's
  // language, so a switch has to recompute them.
  const activeLocale = useLocale();
  const labelLang = labelLanguageTag(activeLocale);
  // Below ~900px the tabs, the three tools and the filter no longer fit on one
  // toolbar line, so the tools move up into the header, which has slack there.
  const toolsInHeader = useCompactLayout();

  const [filter, setFilter] = useTabState(tabId, 'format.filter', '');
  const [view, setView] = useTabState<'structure' | 'bindings' | 'datasources' | 'preview' | 'embedded-mapping'>(tabId, 'format.view', 'structure');
  // Start collapsed: a fully expanded format tree buries the top level under
  // hundreds of rows. Expand-all is one click away in the toolbar.
  const [structureExpandMode, setStructureExpandMode] = useState<'all' | 'none'>('none');
  const [structureExpandVersion, setStructureExpandVersion] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedEmbeddedMappingIdx, setSelectedEmbeddedMappingIdx] = useTabState(tabId, 'format.embeddedMapping', 0);
  const [structureBindingFilter, setStructureBindingFilter] = useTabState<'all' | 'bound' | 'unbound'>(tabId, 'format.bindingFilter', 'all');

  // For import formats: find all loaded standalone ModelMapping configs that reference this format
  const linkedMappings = useMemo(() => {
    if (fc.direction !== ERDirection.Import) return [];
    const normalizedFormatId = fmt.id.replace(/[{}]/g, '').toLowerCase();
    const result: Array<{ name: string; configIdx: number }> = [];
    configurations.forEach((cfg, idx) => {
      if (idx === configIndex) return;
      if (cfg.content.kind !== 'ModelMapping') return;
      const version = (cfg.content as ERModelMappingContent).version;
      const definitions: any[] = (version as any).mappings?.length ? (version as any).mappings : [version.mapping];
      if (definitions.some(mm => hasImportFormatDatasource(mm?.datasources ?? [], normalizedFormatId))) {
        result.push({ name: cfg.solutionVersion.solution.name, configIdx: idx });
      }
    });
    return result;
  }, [fc.direction, fmt.id, configurations, configIndex]);

  useEffect(() => {
    if (!focusNode) return;
    if (focusNode.type === 'formatElement' && focusNode.data?.id) {
      setView('structure');
      setSelectedElementId(focusNode.data.id);
      return;
    }
    if (focusNode.type === 'formatBinding') {
      setView('bindings');
      if (focusNode.data?.componentId) {
        setSelectedElementId(focusNode.data.componentId);
      }
      return;
    }
    if (focusNode.type === 'datasource') {
      setView('datasources');
      return;
    }
  }, [focusNode, setView]);

  const bindingPresentation = useMemo(
    () => buildFormatBindingPresentation(rootElement, fmtMap.bindings),
    [rootElement, fmtMap.bindings],
  );
  const bindingMap = bindingPresentation.bindingMap;

  // Transformation lookup: GUID → transformation
  const transformationMap = useMemo(() => {
    const map = new Map<string, ERFormatTransformation>();
    for (const t of fmt.transformations) {
      map.set(t.id, t);
    }
    return map;
  }, [fmt.transformations]);

  // Statistics
  const stats = useMemo(() => {
    let totalElements = 0;
    let boundElements = 0;
    let unboundElements = 0;
    let structuralElements = 0; // containers/sequences — bindable by design but count separately
    const typeCount: Record<string, number> = {};
    const countElements = (el: any) => {
      totalElements++;
      typeCount[el.elementType] = (typeCount[el.elementType] || 0) + 1;
      const elBindings = bindingMap.get(el.id) ?? [];
      const hasMainBinding = elBindings.some(
        (b: any) => b.bindingCategory === 'data' && b.expressionAsString?.trim()
      );
      const hasChildren = el.children && el.children.length > 0;
      if (hasMainBinding) {
        boundElements++;
      } else if (!hasChildren) {
        unboundElements++;
      } else {
        // structural container — has children, no data binding (normal)
        structuralElements++;
      }
      el.children?.forEach(countElements);
    };
    countElements(rootElement);
    return { totalElements, boundElements, unboundElements, structuralElements, typeCount, bindings: fmtMap.bindings.length, datasources: countDeclaredDatasources(fmtMap.datasources), enums: fmt.enumDefinitions.length, transformations: fmt.transformations.length };
  }, [rootElement, bindingMap, fmtMap, fmt]);

  // Bindings view. Elements whose only bindings are trivial switches
  // (`Enabled ← false`) stay out of both layouts.
  const meaningfulBindingGroups = useMemo(() => {
    const isTrivialExpr = (expr: string) => /^(false|true|0|1|""|'')$/i.test(expr.trim());
    return bindingPresentation.groups.filter(row => {
      if (row.dataBindings.length > 0) return true;
      return row.bindings.some(binding => !isTrivialExpr(binding.expressionAsString ?? ''));
    });
  }, [bindingPresentation.groups]);

  // The format layout narrows elements by the text filter; its intent chips
  // count what the text filter let through.
  const filteredBindingGroups = useMemo(() => {
    if (!filter) return meaningfulBindingGroups;
    const lower = filter.toLowerCase();
    return meaningfulBindingGroups.filter(row =>
      row.elementName.toLowerCase().includes(lower) ||
      row.elementType.toLowerCase().includes(lower) ||
      row.bindings.some(binding =>
        binding.expressionAsString?.toLowerCase().includes(lower) ||
        binding.bindingDisplayLabel.toLowerCase().includes(lower),
      ),
    );
  }, [meaningfulBindingGroups, filter]);

  const [bindingsLayout, setBindingsLayout] = useTabState<'format' | 'model'>(tabId, 'format.bindingsLayout', 'format');
  const [bindingIntents, setBindingIntents] = useTabState<readonly BindingIntent[]>(tabId, 'format.bindingIntents', DEFAULT_BINDING_INTENTS);
  const bindingIntentCounts = useMemo(() => countBindingIntents(filteredBindingGroups), [filteredBindingGroups]);

  /* Model layout: what the format reads from its data model, and what in the
     model mapping fills it. The mapping is the definition for the format's own
     DataContainerDescriptor — embedded in the format first, then any loaded
     mapping configuration, preferring one built on the same model. */
  const loadedModels = useMemo(() => configurations
    .filter(cfg => cfg.content.kind === 'DataModel')
    .map(cfg => (cfg.content as ERDataModelContent).version.model), [configurations]);
  const modelContext = useMemo(() => {
    const modelDatasources = fmtMap.datasources.filter(ds => ds.type === 'DataModel');
    const modelNames = new Set((modelDatasources.length > 0 ? modelDatasources.map(ds => ds.name) : ['model']).map(name => name.toLowerCase()));
    const descriptor = modelDatasources.map(ds => ds.modelInfo?.dataContainerDescriptorName?.trim()).find(Boolean) ?? '';
    const descriptorKey = descriptor.toLowerCase();
    const modelIds = new Set(formatReferencedModelIds(fc).map(normGuid));

    const candidates: Array<{ definition: any; configIndex: number }> = [];
    if (descriptorKey) {
      for (const i of [configIndex, ...configurations.map((_, index) => index).filter(index => index !== configIndex)]) {
        const kind = configurations[i]?.content.kind;
        if (kind !== 'ModelMapping' && i !== configIndex) continue;
        for (const definition of getScopedMappingDefinitions(configurations, i)) {
          if ((definition?.dataContainerDescriptor ?? '').trim().toLowerCase() === descriptorKey) {
            candidates.push({ definition, configIndex: i });
          }
        }
      }
    }
    const mapping = candidates.find(candidate => modelIds.has(normGuid(candidate.definition.modelId))) ?? candidates[0] ?? null;

    const model = findModelForDescriptor(loadedModels, descriptor, modelIds);

    return { modelNames, descriptor, mapping, dataModel: model ? { model, descriptor } : null };
  }, [fmtMap.datasources, fc, configurations, configIndex, loadedModels]);

  const modelUsageTree = useMemo(() => buildModelUsageTree({
    rootElement,
    groups: meaningfulBindingGroups,
    modelNames: modelContext.modelNames,
    mappingBindings: modelContext.mapping?.definition.bindings ?? null,
    dataModel: modelContext.dataModel,
  }), [rootElement, meaningfulBindingGroups, modelContext]);

  const modelLabels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);
  const modelFieldLabel = useCallback((node: ModelUsageNode): string | undefined => {
    const resolved = resolveLabel(node.field?.label, modelLabels, labelLang);
    return resolved?.localized ?? resolved?.enUs;
  }, [modelLabels, labelLang]);

  /* Data sources: a `model` datasource shows the structure of the data model
     it enters through its own descriptor, preferring the model it names. */
  const resolveDatasourceModel = useCallback((datasource: ERDatasource): DatasourceModel | null => {
    const descriptor = datasource.modelInfo?.dataContainerDescriptorName?.trim();
    if (!descriptor) return null;
    const preferredIds = new Set(
      [normGuid(datasource.modelInfo?.modelGuid), ...formatReferencedModelIds(fc).map(normGuid)].filter(Boolean),
    );
    const model = findModelForDescriptor(loadedModels, descriptor, preferredIds);
    return model ? { model, descriptor } : null;
  }, [loadedModels, fc]);
  const modelLabelFor = useCallback((labelRef: string | undefined): string | undefined => {
    const resolved = resolveLabel(labelRef, modelLabels, labelLang);
    return resolved?.localized ?? resolved?.enUs;
  }, [modelLabels, labelLang]);

  // The text filter matches a model path, its field label, its mapping
  // expression or an element that reads it; a match keeps its subtree.
  const textFilteredModelTree = useMemo(() => {
    if (!filter) return modelUsageTree;
    const lower = filter.toLowerCase();
    return filterModelUsageTree(modelUsageTree, {
      matchNode: node =>
        node.path.toLowerCase().includes(lower)
        || Boolean(modelFieldLabel(node)?.toLowerCase().includes(lower))
        || Boolean(node.mapping?.expressionAsString?.toLowerCase().includes(lower))
        || node.usages.some(usage => usage.group.elementName.toLowerCase().includes(lower)),
    });
  }, [modelUsageTree, filter, modelFieldLabel]);

  const modelIntentCounts = useMemo(() => countModelUsageIntents(textFilteredModelTree), [textFilteredModelTree]);
  const intentModelTree = useMemo(() => {
    const active = new Set(bindingIntents);
    return filterModelUsageTree(textFilteredModelTree, { keepUsage: usage => active.has(usage.intent) });
  }, [textFilteredModelTree, bindingIntents]);

  const [onlyUnmappedModelPaths, setOnlyUnmappedModelPaths] = useTabState(tabId, 'format.onlyUnmappedModelPaths', false);
  const visibleModelTree = useMemo(
    () => (onlyUnmappedModelPaths ? filterModelUsageTree(intentModelTree, { onlyUnmapped: true }) : intentModelTree),
    [intentModelTree, onlyUnmappedModelPaths],
  );
  const modelUsageStats = useMemo(() => ({
    fields: intentModelTree.reduce((sum, node) => sum + node.fieldCount, 0),
    unmapped: intentModelTree.reduce((sum, node) => sum + node.unmappedCount, 0),
  }), [intentModelTree]);

  // The element the user navigated to (explorer, search) keeps all of its
  // bindings on screen even when their intent is filtered out — otherwise the
  // jump would land on nothing.
  const focusBindingElementId: string | undefined = focusNode?.type === 'formatBinding' ? focusNode.data?.componentId : undefined;

  const bindingSections = useMemo(() => {
    const active = new Set(bindingIntents);
    return buildFormatBindingSections(
      rootElement,
      filteredBindingGroups,
      binding => active.has(classifyBindingIntent(binding)) || binding.componentId === focusBindingElementId,
    );
  }, [rootElement, filteredBindingGroups, bindingIntents, focusBindingElementId]);

  const shownBindingCount = useMemo(
    () => bindingSections.reduce((sum, section) => sum + section.entries.reduce((n, entry) => n + entry.bindings.length, 0), 0),
    [bindingSections],
  );

  /* Filter terms for the three list views, each row carrying the view it
     belongs to so picking one also lands on the right tab. */
  const filterSuggestions = useMemo<FilterSuggestion[]>(() => [
    ...suggestionsFromCounts(countTerms(collectFormatElementTerms(rootElement)), t.structure, 'structure'),
    ...suggestionsFromCounts(
      // The unfiltered groups on purpose: a pool derived from the filtered
      // rows would shrink as the user types and stop proposing anything.
      countTerms(bindingPresentation.groups.map(row => row.elementName)),
      t.bindings,
      'bindings',
    ),
    ...suggestionsFromCounts(countTerms(collectDatasourceTerms(fmtMap.datasources)), t.dataSources, 'datasources'),
  ], [rootElement, bindingPresentation.groups, fmtMap.datasources]);

  /* Collapse state as a mode plus the sections toggled against it, not as a
     list of collapsed keys: a section that only appears once another intent is
     switched on then follows the mode instead of popping up open inside a
     collapsed outline. */
  const [bindingOutline, setBindingOutline] = useState(false);
  const [toggledBindingSections, setToggledBindingSections] = useState<ReadonlySet<string>>(EMPTY_STRING_SET);

  // A long list opens as an outline of its sections, a short one fully open.
  // Decided once per format, so later filtering never re-collapses what the
  // user opened.
  const bindingOutlineInitForRef = useRef<unknown>(null);
  useEffect(() => {
    if (bindingOutlineInitForRef.current === config) return;
    if (bindingSections.length === 0 || filter) return;
    bindingOutlineInitForRef.current = config;
    setBindingOutline(shownBindingCount > BINDING_OUTLINE_THRESHOLD);
    setToggledBindingSections(EMPTY_STRING_SET);
  }, [config, bindingSections.length, shownBindingCount, filter]);

  // The section holding a navigated-to element is held open until the user
  // folds it themselves.
  const focusedBindingSectionKey = useMemo(
    () => focusBindingElementId
      ? bindingSections.find(section => section.entries.some(entry => entry.group.componentId === focusBindingElementId))?.key
      : undefined,
    [bindingSections, focusBindingElementId],
  );
  const [bindingFocusDismissedFor, setBindingFocusDismissedFor] = useState<unknown>(null);
  const heldOpenBindingSectionKey = bindingFocusDismissedFor === focusNode ? undefined : focusedBindingSectionKey;

  // A text filter suspends the collapse state so every match is visible.
  const isBindingSectionCollapsed = (key: string) =>
    !filter && key !== heldOpenBindingSectionKey && bindingOutline !== toggledBindingSections.has(key);

  const toggleBindingSection = useCallback((key: string) => {
    if (key === heldOpenBindingSectionKey) {
      // Fold it: from here on the section follows the normal collapse state.
      setBindingFocusDismissedFor(focusNode);
      setToggledBindingSections(prev => {
        const next = new Set(prev);
        if (bindingOutline) next.delete(key); else next.add(key);
        return next;
      });
      return;
    }
    setToggledBindingSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, [heldOpenBindingSectionKey, focusNode, bindingOutline]);

  const expandAllBindingSections = useCallback(() => {
    setBindingOutline(false);
    setToggledBindingSections(EMPTY_STRING_SET);
  }, []);

  const collapseAllBindingSections = useCallback(() => {
    setBindingOutline(true);
    setToggledBindingSections(EMPTY_STRING_SET);
    setBindingFocusDismissedFor(focusNode);
  }, [focusNode]);

  const focusedBindingCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusBindingElementId) return;
    const timer = setTimeout(() => focusedBindingCardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    return () => clearTimeout(timer);
    // focusNode, not only the id: navigating to the same element again is a new
    // request to bring its card into view.
  }, [focusNode, focusBindingElementId]);

  // One pass over the element tree answers the filter / binding / ancestry
  // questions for every row; see FormatTreeIndex.
  const treeIndex = useMemo<FormatTreeIndex>(
    () => buildFormatTreeIndex(rootElement, bindingMap, filter),
    [rootElement, bindingMap, filter],
  );

  /** Walk up from the selection — O(depth) instead of a subtree scan per row. */
  const selectedAncestors = useMemo(() => {
    const set = new Set<string>();
    let current = selectedElementId ? treeIndex.parentOf.get(selectedElementId) : undefined;
    while (current) {
      if (set.has(current)) break;
      set.add(current);
      current = treeIndex.parentOf.get(current);
    }
    return set;
  }, [selectedElementId, treeIndex]);

  const dsListRef = useRef<GroupedDatasourceListHandle>(null);
  // Scrolls the structure tree, which virtualizes its rows against it.
  const listPaneRef = useRef<HTMLDivElement>(null);

  const revealFormatElementInExplorer = useCallback((elementId: string) => {
    const rootNode = treeNodes[configIndex];
    if (!rootNode) return;
    const match = findTreeNodeByMatch(rootNode, candidate => candidate.type === 'formatElement' && candidate.data?.id === elementId);
    if (match?.id) navigateToTreeNode(match.id);
  }, [treeNodes, configIndex, navigateToTreeNode]);

  const handleSelectFormatElement = useCallback((elementId: string | null) => {
    // A click or an arrow key merely selects the element so its binding details
    // expand inline and the inspector follows. The explorer does not: showing
    // the element there is an explicit action — the row's ⋮ menu calls
    // `revealFormatElementInExplorer` for that.
    setSelectedElementId(elementId);
    if (elementId) {
      const rootNode = treeNodes[configIndex];
      if (rootNode) {
        const match = findTreeNodeByMatch(rootNode, n => n.type === 'formatElement' && n.data?.id === elementId);
        if (match) selectNode(match.id, { revealInExplorer: false });
      }
    }
  }, [treeNodes, configIndex, selectNode]);

  // The same two words as the model-mapping designer, in both view modes: the
  // consultant-mode aliases ("Links" / "Zdroje dat") named the very things F&O
  // itself calls bindings and data sources.
  type FormatViewId = 'structure' | 'bindings' | 'datasources' | 'preview' | 'embedded-mapping';
  const formatTabs = useMemo<Array<{ id: FormatViewId; label: React.ReactNode; title: string }>>(() => {
    const tabs: Array<{ id: FormatViewId; label: React.ReactNode; title: string }> = [
      {
        id: 'structure',
        label: `${t.structure} (${stats.totalElements})`,
        title: t.fmtTabStructureTitle,
      },
      {
        id: 'bindings',
        label: `${t.bindings} (${shownBindingCount})`,
        title: t.fmtTabBindingsTitle,
      },
      {
        id: 'datasources',
        label: `${t.dataSources} (${stats.datasources})`,
        title: t.fmtTabDatasourcesTitle,
      },
      {
        id: 'preview',
        label: t.previewLabel,
        title: t.fmtTabPreviewTitle,
      },
    ];
    if (fc.embeddedModelMappingVersions.length > 0) {
      tabs.push({
        id: 'embedded-mapping',
        label: `${t.fmtTabEmbeddedMapping} (${fc.embeddedModelMappingVersions.length})`,
        title: t.fmtTabEmbeddedMappingTitle,
      });
    }
    return tabs;
    // `t` is swapped on a language switch; activeLocale is what tells the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.totalElements, stats.datasources, shownBindingCount, fc.embeddedModelMappingVersions.length, activeLocale]);

  /* Expand/collapse. Rendered either in the toolbar next to the filter
     (desktop, unchanged) or up in the header — below ~900px the tabs, this and
     the filter no longer share one toolbar line, and the header is the only
     bar with room left. */
  const designerTools = (
    <>
      {(view === 'structure' || view === 'bindings' || view === 'datasources') && (
        <ExpandCollapseSlider
          size="compact"
          expandLabel={t.expand}
          collapseLabel={t.collapse}
          expandIcon={
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 6 L8 2 L12 6" />
              <path d="M4 10 L8 14 L12 10" />
            </svg>
          }
          collapseIcon={
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 3 L8 7 L12 3" />
              <path d="M4 13 L8 9 L12 13" />
            </svg>
          }
          onExpand={() => {
            if (view === 'structure') {
              setStructureExpandMode('all');
              setStructureExpandVersion(version => version + 1);
            } else if (view === 'bindings') {
              expandAllBindingSections();
            } else {
              dsListRef.current?.expandAll();
            }
          }}
          onCollapse={() => {
            if (view === 'structure') {
              setStructureExpandMode('none');
              setStructureExpandVersion(version => version + 1);
            } else if (view === 'bindings') {
              collapseAllBindingSections();
            } else {
              dsListRef.current?.collapseAll();
            }
          }}
        />
      )}
    </>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header Bar ── */}
      <div className="fmt-header">
        <FormatTypeBadge rootElement={rootElement} />
        <span className="fmt-stat fmt-stat-direction">
          {fc.direction === ERDirection.Import ? <ArrowDownloadRegular fontSize={13} /> : <ArrowUploadRegular fontSize={13} />}
          {getFormatDirectionLabel(fc.direction)}
        </span>
        <div className="fmt-header-stats">
          <button
            type="button"
            className={`fmt-stat fmt-stat-bound fmt-stat-btn ${view === 'structure' && structureBindingFilter === 'bound' ? 'active' : ''}`}
            title={`${stats.boundElements} ${t.bound}`}
            onClick={() => { setView('structure'); setStructureBindingFilter(f => f === 'bound' ? 'all' : 'bound'); }}
          ><CheckmarkCircleRegular fontSize={13} /> {stats.boundElements} <span className="fmt-stat-btn__word">{t.bound}</span></button>
          <button
            type="button"
            className={`fmt-stat fmt-stat-unbound fmt-stat-btn ${view === 'structure' && structureBindingFilter === 'unbound' ? 'active' : ''}`}
            title={`${stats.unboundElements} ${t.unbound}`}
            onClick={() => { setView('structure'); setStructureBindingFilter(f => f === 'unbound' ? 'all' : 'unbound'); }}
          ><CircleRegular fontSize={13} /> {stats.unboundElements} <span className="fmt-stat-btn__word">{t.unbound}</span></button>
        </div>
        {toolsInHeader && <div className="fmt-header-tools">{designerTools}</div>}
      </div>

      {/* ── Linked Mappings banner (import formats only) ── */}
      {fc.direction === ERDirection.Import && (
        <div className="fmt-linked-mappings-bar">
          <span className="fmt-linked-mappings-label">
            <ArrowDownloadRegular fontSize={13} />
            {t.importLinkedMappingsLabel}
          </span>
          {linkedMappings.length === 0
            ? <span className="fmt-linked-mappings-empty">{t.importNoLinkedMappings}</span>
            : linkedMappings.map(lm => (
                <button
                  key={lm.configIdx}
                  className="fmt-linked-mapping-chip"
                  onClick={() => {
                    const rootNode = treeNodes[lm.configIdx];
                    if (rootNode) navigateToTreeNode(rootNode.id);
                  }}
                >
                  {lm.name}
                </button>
              ))
          }
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="fmt-toolbar">
        <SlidingTabs tabs={formatTabs} activeId={view} onChange={setView} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          {!toolsInHeader && designerTools}
          {/* The preview and embedded-mapping views have their own content
              (the mapping designer carries its own filter), so the text
              filter is only offered where it actually filters something. */}
          {view !== 'preview' && view !== 'embedded-mapping' && (
            <FilterField
              value={filter}
              onChange={setFilter}
              placeholder={t.filter}
              suggestions={filterSuggestions}
              historyScope="format"
              onPick={suggestion => { if (suggestion.view) setView(suggestion.view as typeof view); }}
            />
          )}
        </div>
      </div>

      {/* Layout switch and intent filter: outside the scrolling list so they stay in reach. */}
      {view === 'bindings' && (
        <BindingIntentBar
          layout={bindingsLayout}
          onLayoutChange={setBindingsLayout}
          counts={bindingsLayout === 'model' ? modelIntentCounts : bindingIntentCounts}
          active={bindingIntents}
          onChange={setBindingIntents}
        />
      )}

      {/* ── Main Content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: tree / list */}
        <div className="designer-list-pane" ref={listPaneRef}>
          {view === 'structure' && (
            <FormatStructureTree
              rootElement={rootElement}
              scrollRef={listPaneRef}
              bindingMap={bindingMap}
              transformationMap={transformationMap}
              configIndex={configIndex}
              filter={filter}
              expandMode={structureExpandMode}
              expandVersion={structureExpandVersion}
              selectedId={selectedElementId}
              onSelect={handleSelectFormatElement}
              showTechnicalDetails={showTechnicalDetails}
              bindingFilter={structureBindingFilter}
              treeIndex={treeIndex}
              selectedAncestors={selectedAncestors}
              onReveal={revealFormatElementInExplorer}
            />
          )}

          {view === 'embedded-mapping' && fc.embeddedModelMappingVersions.length > 0 && (
            <>
              {fc.embeddedModelMappingVersions.length > 1 && (
                <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
                  {fc.embeddedModelMappingVersions.map((emv, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`fmt-tab-btn ${selectedEmbeddedMappingIdx === idx ? 'active' : ''}`}
                      onClick={() => setSelectedEmbeddedMappingIdx(idx)}
                    >
                      {emv.mapping.name}
                    </button>
                  ))}
                </div>
              )}
              <MappingDesigner
                mapping={fc.embeddedModelMappingVersions[selectedEmbeddedMappingIdx].mapping}
                configIndex={configIndex}
                focusNode={null}
              />
            </>
          )}

          {view === 'bindings' && bindingsLayout === 'model' && (
            <ModelUsageView
              tree={visibleModelTree}
              stats={modelUsageStats}
              descriptor={modelContext.descriptor}
              mapping={modelContext.mapping
                ? {
                    name: modelContext.mapping.configIndex === configIndex
                      ? modelContext.mapping.definition.name
                      : `${configurations[modelContext.mapping.configIndex]?.solutionVersion.solution.name} › ${modelContext.mapping.definition.name}`,
                    configIndex: modelContext.mapping.configIndex,
                  }
                : null}
              dataModelLoaded={Boolean(modelContext.dataModel)}
              onlyUnmapped={onlyUnmappedModelPaths}
              onOnlyUnmappedChange={setOnlyUnmappedModelPaths}
              isCollapsed={key => isBindingSectionCollapsed(`m:${key}`)}
              onToggle={key => toggleBindingSection(`m:${key}`)}
              labelFor={modelFieldLabel}
              showTechnicalDetails={showTechnicalDetails}
              onOpenElement={elementId => {
                setView('structure');
                handleSelectFormatElement(elementId);
              }}
              onOpenMapping={target => {
                if (target === configIndex) {
                  setView('embedded-mapping');
                  return;
                }
                const rootNode = treeNodes[target];
                if (rootNode) navigateToTreeNode(rootNode.id);
              }}
              empty={<BindingListEmpty filter={filter} counts={modelIntentCounts} active={bindingIntents} onShowAll={() => setBindingIntents(BINDING_INTENT_ORDER)} />}
            />
          )}

          {view === 'bindings' && bindingsLayout === 'format' && (
            bindingSections.length === 0
              ? <BindingListEmpty filter={filter} counts={bindingIntentCounts} active={bindingIntents} onShowAll={() => setBindingIntents(BINDING_INTENT_ORDER)} />
              : bindingSections.map(section => {
                  const collapsed = isBindingSectionCollapsed(section.key);
                  const count = section.entries.reduce((n, entry) => n + entry.bindings.length, 0);
                  const unresolvedName = t.fmtElementsOutsideStructure;
                  const toggle = () => toggleBindingSection(section.key);
                  return (
                    <div key={section.key} className="mm-group">
                      <div
                        className="mm-group-header"
                        role="button"
                        tabIndex={0}
                        aria-expanded={!collapsed}
                        onClick={toggle}
                        onKeyDown={event => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          toggle();
                        }}
                      >
                        <span className={`tree-chevron ${collapsed ? '' : 'open'}`} />
                        <span className="mm-group-name fmt-bind-section-trail" title={section.unresolved ? unresolvedName : section.trail.join(' › ')}>
                          {section.unresolved
                            ? <span>{unresolvedName}</span>
                            : section.trail.map((name, i) => (
                                <React.Fragment key={i}>
                                  {i > 0 && <span className="fmt-bind-section-sep" aria-hidden="true">›</span>}
                                  <span>{name}</span>
                                </React.Fragment>
                              ))}
                        </span>
                        <span className="mm-group-count" title={t.bindingCount(count)}>{count}</span>
                      </div>
                      {!collapsed && section.entries.map(entry => {
                        const focused = entry.group.componentId === focusBindingElementId;
                        return (
                          <FormatElementBindingGroup
                            key={entry.group.componentId}
                            row={entry.group}
                            bindings={entry.bindings}
                            focused={focused}
                            cardRef={focused ? focusedBindingCardRef : undefined}
                            configIndex={configIndex}
                            onReveal={revealFormatElementInExplorer}
                            showTechnicalDetails={showTechnicalDetails}
                          />
                        );
                      })}
                    </div>
                  );
                })
          )}

          {view === 'datasources' && (
            <GroupedDatasourceList ref={dsListRef} datasources={fmtMap.datasources} filter={filter} resolveModel={resolveDatasourceModel} labelFor={modelLabelFor} configIndex={configIndex} navigateToTreeNode={navigateToTreeNode} focusKey={datasourceFocusKey(focusNode)} />
          )}

          <div style={{ display: view === 'preview' ? 'contents' : 'none' }}>
            <FormatPreview rootElement={rootElement} direction={fc.direction} bindingMap={bindingMap} configIndex={configIndex} tabId={tabId} onNavigateToElement={(elementId) => {
              setStructureExpandMode('all');
              setStructureExpandVersion(v => v + 1);
              setView('structure');
              setSelectedElementId(elementId);
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}
