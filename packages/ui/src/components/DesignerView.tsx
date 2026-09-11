import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
} from '@xyflow/react';
import {
  AppsListDetailRegular,
  ArrowEnterRegular,
  CursorHoverRegular,
  DataPieRegular,
  DataBarVerticalFilled,
  LinkFilled,
  DocumentFilled,
  CheckmarkCircleRegular,
  CircleRegular,
  ArrowSyncRegular,
  ArrowUploadRegular,
  ArrowDownloadRegular,
  SearchRegular,
  InfoRegular,
  MoreVerticalRegular,
} from '@fluentui/react-icons';
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tooltip } from '@fluentui/react-components';
import '@xyflow/react/dist/style.css';
import { useAppStore, resolveDeepExpression, selectMappingDefinition, getScopedMappingDefinitions } from '../state/store';
import { buildModelUsageTree, countModelUsageIntents, filterModelUsageTree, type ModelUsageNode } from '../utils/format-model-usage';
import { formatReferencedModelIds, normGuid } from '../utils/model-hierarchy';
import { ClickablePath } from './ClickablePath';
import { DrillDownBody, DrillDownTrigger } from './DrillDownPanel';
import { PropertyInspector } from './PropertyInspector';
import { ExpandCollapseSlider } from './ExpandCollapseSlider';
import { FilterField } from './FilterField';
import { locale, t } from '../i18n';
import { formatEnumDisplayName } from '../utils/enum-display';
import { adjacentRow, isTreeArrowKey, treeArrowAction } from '../utils/tree-keyboard';
import { getBindingCategoryLabel, getConsultantBindingLabel, getConsultantFormatTypeLabel, isXmlNamespaceDeclaration } from '../utils/consultant-labels';
import { buildFormatBindingPresentation, getFormatBindingCategoryLabel, getFormatBindingDisplayLabel, groupFormatBindingsByCategory, type NormalizedFormatBinding, type NormalizedFormatBindingGroup } from '../utils/format-binding-display';
import {
  BINDING_INTENT_ORDER,
  DEFAULT_BINDING_INTENTS,
  buildFormatBindingSections,
  classifyBindingIntent,
  countBindingIntents,
  getBindingIntentHint,
  getBindingIntentItemLabel,
  getBindingIntentLabel,
  type BindingIntent,
} from '../utils/format-binding-sections';
import { buildFormatTreeIndex, type FormatTreeIndex } from '../utils/format-tree-filter';
import { countTerms, suggestionsFromCounts, type FilterSuggestion } from '../utils/filter-suggestions';
import { getFormatTypeBadgeSurface, getFormatTypeThemeColor } from '../utils/theme-colors';
import { ERDirection, getFormatElementExcelRange, type ERConfiguration, type ERDataModelContent, type ERModelMappingContent, type ERFormatContent, type ERFormatElement, type ERLabel } from '@er-visualizer/core';
import { resolveLabel, buildLabelPool } from '../utils/label-resolver';
import { useCoarsePointer, useCompactLayout } from '../utils/responsive';
import { useTabState, pruneTabViewState } from '../utils/tab-view-state';
import { parseXlsxBase64, colToLetter, type XlsxWorkbook, type XlsxCell as XlsxCellType, type XlsxMerge, type XlsxArea, type XlsxDrawing, type XlsxAnchorPoint } from '../utils/xlsx-parser';

function getFormatDirectionLabel(direction: ERDirection | undefined): string {
  if (direction === ERDirection.Import) return t.formatDirectionImport;
  if (direction === ERDirection.Export) return t.formatDirectionExport;
  return t.formatDirectionUnknown;
}

/**
 * The definition to render for a ModelMapping config: prefer the definition the
 * user actually selected in the explorer (the mapping node itself or any node
 * under it), falling back to the one the loaded format binds to.
 */
function resolveActiveMappingDefinition(version: any, configs: any[], activeNode: any): any {
  if (activeNode?.type === 'mapping' && activeNode.data) return activeNode.data;
  const definitions: any[] = Array.isArray(version?.mappings) && version.mappings.length > 0
    ? version.mappings
    : (version?.mapping ? [version.mapping] : []);
  // Multi-definition tree ids look like "cfg-2-mapping-1-binding-5".
  const match = typeof activeNode?.id === 'string'
    ? activeNode.id.match(/^cfg-\d+-mapping-(\d+)(?:-|$)/)
    : null;
  if (match) {
    const definition = definitions[Number(match[1])];
    if (definition) return definition;
  }
  return selectMappingDefinition(version, configs);
}

/**
 * Restrict a solution's mapping definitions to the one that actually owns the
 * selected datasource. Definitions of different DataContainerDescriptors reuse
 * the same datasource names (`ReportDataProvider`, `Parameters`, …), so without
 * this the property panel lists bindings from a foreign model root.
 */
function scopeDefinitionsToDatasource(definitions: any[], selected: any): any[] {
  if (definitions.length <= 1 || !selected) return definitions;

  const owns = (list: any[]): boolean => {
    for (const ds of list ?? []) {
      if (ds === selected) return true;
      if (ds.children?.length && owns(ds.children)) return true;
    }
    return false;
  };

  const owners = definitions.filter(definition => owns(definition?.datasources ?? []));
  return owners.length > 0 ? owners : definitions;
}

function getNodeHeaderIcon(node: any): React.ReactNode {
  const kind = node?.data?.kind ?? node?.data?.content?.kind;
  const nodeType = node?.type;

  if (kind === 'DataModel') return <DataBarVerticalFilled fontSize={14} />;
  if (kind === 'ModelMapping') return <LinkFilled fontSize={14} />;
  if (kind === 'Format') return <DocumentFilled fontSize={14} />;

  if (nodeType === 'mapping' || nodeType === 'binding' || nodeType === 'formatBinding') {
    return <LinkFilled fontSize={14} />;
  }

  if (nodeType === 'validation') {
    return <CheckmarkCircleRegular fontSize={14} />;
  }

  if (nodeType === 'transformation') {
    return <ArrowSyncRegular fontSize={14} />;
  }

  if (
    nodeType === 'datasource'
    || nodeType === 'field'
    || nodeType === 'container'
    || nodeType === 'enum'
    || nodeType === 'enumValue'
    || nodeType === 'model'
  ) {
    return <DataBarVerticalFilled fontSize={14} />;
  }

  return <DocumentFilled fontSize={14} />;
}

export function DesignerView() {
  const activeTabId = useAppStore(s => s.activeTabId);
  const tabs = useAppStore(s => s.openTabs);
  const configs = useAppStore(s => s.configurations);
  const treeNodes = useAppStore(s => s.treeNodes);
  const selectedNode = useAppStore(s => s.selectedNode);
  const coarse = useCoarsePointer();
  const openHint = coarse ? t.openInExplorerTouch : t.openInExplorer;

  useEffect(() => { pruneTabViewState(tabs.map(tb => tb.id)); }, [tabs]);

  if (!activeTabId) {
    return (
      <div className="designer-empty-state">
        <div className="designer-empty-card" role="region" aria-live="polite">
          <div className="designer-empty-card__header">
            <div className="designer-empty-card__icon" aria-hidden>
              <DataPieRegular fontSize={20} />
            </div>
            <div className="designer-empty-card__titles">
              <div className="designer-empty-card__eyebrow">{t.designerWorkspaceEyebrow}</div>
              <h2 className="designer-empty-card__title">{t.noSelection}</h2>
            </div>
          </div>

          <p className="designer-empty-card__text">{t.selectElementHint}</p>

          <div className="designer-empty-card__steps" aria-label={openHint}>
            <div className="designer-empty-step">
              <span className="designer-empty-step__icon" aria-hidden><AppsListDetailRegular fontSize={14} /></span>
              <span className="designer-empty-step__text">{t.explorer}</span>
            </div>
            <span className="designer-empty-step__arrow" aria-hidden><ArrowEnterRegular fontSize={12} /></span>
            <div className="designer-empty-step">
              <span className="designer-empty-step__icon" aria-hidden><CursorHoverRegular fontSize={14} /></span>
              <span className="designer-empty-step__text">{openHint}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return null;

  const config = configs[tab.configIndex];
  if (!config) return null;

  // Drill-down tabs carry their own expression/element — render the drill-down body directly
  if (tab.kind === 'drillDown') {
    return (
      <div className="drilldown-tab-host">
        <DrillDownBody
          expression={tab.expression}
          configIndex={tab.configIndex}
          elementName={tab.elementName}
          variant="tab"
        />
      </div>
    );
  }

  const tabNode = findTreeNodeById(treeNodes, activeTabId);

  const activeNode = selectedNode?.configIndex === tab.configIndex
    ? selectedNode
    : findTreeNodeById(treeNodes, activeTabId);

  if (tabNode && tabNode.type !== 'file') {
    return <FocusedNodeTab node={tabNode} />;
  }

  if (config.kind === 'DataModel') return <ModelDesigner key={tab.id} config={config} focusNode={activeNode} />;
  if (config.kind === 'ModelMapping') return <MappingDesigner key={tab.id} tabId={tab.id} mapping={resolveActiveMappingDefinition((config.content as ERModelMappingContent).version, configs, activeNode)} configIndex={tab.configIndex} focusNode={activeNode} />;
  if (config.kind === 'Format') return <FormatDesigner key={tab.id} tabId={tab.id} config={config} configIndex={tab.configIndex} focusNode={activeNode} />;

  return <div style={{ padding: 16 }}>{t.designerUnsupportedView(config.kind)}</div>;
}

function FocusedNodeTab({ node }: { node: any }) {
  const configs = useAppStore(s => s.configurations);
  const selectedNode = useAppStore(s => s.selectedNode);
  const focusNode = selectedNode?.configIndex === node.configIndex ? selectedNode : node;
  const config = node.configIndex != null ? configs[node.configIndex] : null;

  if (!config || node.configIndex == null) {
    return (
      <div className="focused-node-tab">
        <div className="focused-node-tab-header">
          <span className="focused-node-tab-icon">{getNodeHeaderIcon(node)}</span>
          <span className="focused-node-tab-title">{node.name}</span>
        </div>
        <div className="focused-node-tab-body">
          <PropertyInspector nodeOverride={node} />
        </div>
      </div>
    );
  }

  if (node.type === 'mapping' && node.configIndex != null) {
    return <MappingDesigner mapping={node.data} configIndex={node.configIndex} focusNode={focusNode} />;
  }

  // After collapsing the redundant inner wrapper, the configuration
  // root itself (`type: 'file'`) is the entry point for the designer.
  // Dispatch on `config.kind` so clicking the configuration row in
  // the explorer opens the same view as before.
  if (node.type === 'file' && config.kind === 'DataModel') {
    return <ModelDesigner config={config} focusNode={focusNode} />;
  }
  if (node.type === 'file' && config.kind === 'ModelMapping' && node.configIndex != null) {
    const mappingContent = config.content as { version?: { mapping?: unknown } };
    const mapping = mappingContent.version ? resolveActiveMappingDefinition(mappingContent.version, configs, focusNode) : undefined;
    if (mapping) {
      return <MappingDesigner mapping={mapping} configIndex={node.configIndex} focusNode={focusNode} />;
    }
  }
  if (node.type === 'file' && config.kind === 'Format') {
    return <FormatDesigner config={config} configIndex={node.configIndex} focusNode={focusNode} />;
  }

  if (node.type === 'formatElement' && config.kind === 'Format') {
    return <FormatElementFocusTab node={node} configIndex={node.configIndex} />;
  }

  return (
    <div className="focused-node-tab">
      <div className="focused-node-tab-header">
        <span className="focused-node-tab-icon">{getNodeHeaderIcon(node)}</span>
        <span className="focused-node-tab-title">{node.name}</span>
      </div>
      <div className="focused-node-tab-body">
        <PropertyInspector nodeOverride={node} />
      </div>
    </div>
  );
}

function FormatElementFocusTab({ node, configIndex }: { node: any; configIndex: number }) {
  const configs = useAppStore(s => s.configurations);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);

  const { bindings, categories } = useMemo(() => {
    const cfg = configs[configIndex];
    if (!cfg || cfg.content.kind !== 'Format') return { bindings: [] as any[], categories: [] as any[] };
    const fc = cfg.content as ERFormatContent;
    const presentation = buildFormatBindingPresentation(fc.formatVersion.format.rootElement, fc.formatMappingVersion.formatMapping.bindings);
    const b = presentation.bindingMap.get(node.data.id) ?? [];
    return { bindings: b, categories: groupFormatBindingsByCategory(b) };
  }, [configs, configIndex, node.data.id]);

  const childTreeNodes = (node.children ?? []).filter((c: any) => c.type === 'formatElement');

  return (
    <div className="focused-node-tab">
      <div className="focused-node-tab-body">
        {bindings.length === 0 && childTreeNodes.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 12 }}>
            {t.bindings}: 0
          </div>
        )}

        {bindings.length > 0 && (
          <div className="property-section">
            <div className="property-section-title">{t.bindings} ({bindings.length})</div>
            {categories.map(category => (
              <div key={category.key}>
                {categories.length > 1 && (
                  <div className="fmt-detail-subsection-title">
                    {showTechnicalDetails ? getFormatBindingCategoryLabel(category.key) : getBindingCategoryLabel(category.key)} ({category.bindings.length})
                  </div>
                )}
                {category.bindings.map((b: any, i: number) => (
                  <div key={`${category.key}-${i}`} className="fmt-detail-binding">
                    <span className={`badge ${category.key === 'data' ? 'badge-success' : 'badge-prop'}`} style={{ marginRight: 6 }}>
                      {showTechnicalDetails ? getFormatBindingDisplayLabel(b) : getConsultantBindingLabel(b)}
                    </span>
                    {showTechnicalDetails && b.promotedFromChild && b.rawElementType && (
                      <span className="fmt-binding-origin">{t.bindingVia} {b.rawElementType}</span>
                    )}
                    <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11 }}>
                      <DrillDownTrigger
                        expression={b.expressionAsString}
                        configIndex={configIndex}
                        elementName={node.data.name}
                      >
                        <ClickablePath expression={b.expressionAsString} configIndex={configIndex} mode="binding-expr" interactive={false} />
                      </DrillDownTrigger>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {childTreeNodes.length > 0 && (
          <div className="property-section">
            <div className="property-section-title">{t.propChildren} ({childTreeNodes.length})</div>
            {childTreeNodes.map((child: any) => (
              <div
                key={child.id}
                className="fmt-detail-child"
                onClick={() => navigateToTreeNode(child.id)}
              >
                <span style={{ marginRight: 6 }}>{child.icon}</span>
                <span>{child.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function findTreeNodeById(nodes: any[], id: string): any | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findTreeNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function findTreeNodeByMatch(node: any, predicate: (candidate: any) => boolean): any | null {
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findTreeNodeByMatch(child, predicate);
    if (found) return found;
  }
  return null;
}

function extractFirstModelReference(expression: string): string | null {
  const match = expression.match(/model[.\\](?:'[^']*'|[A-Za-z0-9_$]+)(?:(?:[.\\])(?:'[^']*'|[A-Za-z0-9_$]+))*/i);
  return match?.[0] ?? null;
}

function normalizeModelReferenceVariants(expression: string): string[] {
  const reference = extractFirstModelReference(expression);
  if (!reference) return [];

  const body = reference.replace(/^model[.\\]/i, '');
  const segments = body.split(/[.\\]/).filter(Boolean);
  const variants = [
    segments.join('\\'),
    segments.join('.'),
    segments.join('/'),
  ];

  return [...new Set(variants)];
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Marks every occurrence of `query` inside `text` — the tree filter used to
 *  show which rows matched, but never *what* in them matched. */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExpLiteral(needle)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === needle.toLowerCase()
          ? <mark key={i} className="search-highlight">{part}</mark>
          : <React.Fragment key={i}>{part}</React.Fragment>,
      )}
    </>
  );
}

function ExpressionDetailLink({ expression, configIndex, className, interactive = true, highlight }: { expression: string; configIndex: number; className?: string; interactive?: boolean; highlight?: string }) {
  const configurations = useAppStore(s => s.configurations);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);
  const resolveBinding = useAppStore(s => s.resolveBinding);
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);

  const navigateExpressionTarget = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();

    const modelReference = extractFirstModelReference(expression);
    if (modelReference) {
      const resolvedModel = resolveModelPath(modelReference);
      const targetNodeId = resolvedModel?.bindingTreeNodeId ?? resolvedModel?.datasourceTreeNodeId;
      if (targetNodeId) {
        navigateToTreeNode(targetNodeId);
        return;
      }

      for (const variant of normalizeModelReferenceVariants(expression)) {
        const bindingResult = resolveBinding(variant, configIndex);
        if (bindingResult?.treeNodeId) {
          navigateToTreeNode(bindingResult.treeNodeId);
          return;
        }
      }
    }

    const deepResult = resolveDeepExpression(expression, configurations, configIndex);
    const resolvedDatasource = deepResult?.nestedDs ?? deepResult?.rootDs;
    const resolvedConfigIndex = deepResult?.rootDsConfigIndex ?? configIndex;
    if (resolvedDatasource) {
      const nodeId = findDatasourceNode(resolvedDatasource.name, resolvedConfigIndex, resolvedDatasource.parentPath);
      if (nodeId) {
        navigateToTreeNode(nodeId);
        return;
      }
    }

    const directDatasourceName = expression.split(/[.(]/)[0]?.replace(/['"]/g, '').trim();
    if (!directDatasourceName) return;

    const directResolution = resolveDatasource(directDatasourceName, configIndex);
    if (directResolution?.treeNodeId) {
      navigateToTreeNode(directResolution.treeNodeId);
    }
  }, [expression, configIndex, configurations, findDatasourceNode, navigateToTreeNode, resolveBinding, resolveDatasource, resolveModelPath]);

  return (
    <span className={className} onClick={interactive ? navigateExpressionTarget : undefined} title={interactive ? t.openInExplorerAction : undefined}>
      <ClickablePath expression={expression} configIndex={configIndex} mode="binding-expr" interactive={false} highlight={highlight} />
    </span>
  );
}

/**
 * Returns `true` for a brief window right after `active` flips from false → true,
 * so callers can layer a one-shot "just navigated here" flash animation on top of
 * their normal `.selected`/`.search-match` styling (e.g. jumping in from Search
 * or Where-Used). Re-navigating to the same element re-triggers the flash.
 */
function useNavFlash(active: boolean, duration = 1400): boolean {
  const [flash, setFlash] = useState(false);
  const wasActive = useRef(false);

  useEffect(() => {
    if (active && !wasActive.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), duration);
      wasActive.current = active;
      return () => clearTimeout(timer);
    }
    wasActive.current = active;
  }, [active, duration]);

  return flash;
}

/**
 * The designer header's usage hint.
 *
 * It used to be a sentence pinned to the right of every designer header —
 * permanent instructions that cost a header line and were read once. It is the
 * same text, parked behind an icon that sits at the end of the header (a
 * long-press reaches it on touch).
 */
function DesignerHint({ text }: { text: string }) {
  return (
    <Tooltip content={text} relationship="label" withArrow>
      <span className="fmt-header-hint" tabIndex={0} role="note" aria-label={text}>
        <InfoRegular fontSize={14} />
      </span>
    </Tooltip>
  );
}

/** Segmented tab strip with a sliding highlight that animates to the active tab's own position/width. */
function SlidingTabs<TId extends string>({ tabs, activeId, onChange }: {
  tabs: Array<{ id: TId; label: React.ReactNode; title?: string }>;
  activeId: TId;
  onChange: (id: TId) => void;
}) {
  const btnRefs = useRef<Map<TId, HTMLButtonElement>>(new Map());
  const [thumbRect, setThumbRect] = useState<{ left: number; width: number } | null>(null);

  // Re-measure on every render (tab labels can change width — e.g. counts, locale,
  // technical-details toggle), but bail out of the state update when the measured
  // rect is unchanged so this can never trigger an infinite render loop.
  useLayoutEffect(() => {
    const btn = btnRefs.current.get(activeId);
    if (!btn) return;
    const next = { left: btn.offsetLeft, width: btn.offsetWidth };
    setThumbRect(prev => (prev && prev.left === next.left && prev.width === next.width) ? prev : next);
  });

  useEffect(() => {
    const handleResize = () => {
      const btn = btnRefs.current.get(activeId);
      if (!btn) return;
      const next = { left: btn.offsetLeft, width: btn.offsetWidth };
      setThumbRect(prev => (prev && prev.left === next.left && prev.width === next.width) ? prev : next);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeId]);

  return (
    <div className="fmt-sliding-tabs" role="tablist">
      {thumbRect && (
        <div
          className="fmt-sliding-tabs__thumb"
          aria-hidden="true"
          style={{ transform: `translateX(${thumbRect.left}px)`, width: thumbRect.width }}
        />
      )}
      {tabs.map(tab => (
        <button
          key={tab.id}
          ref={el => { if (el) btnRefs.current.set(tab.id, el); else btnRefs.current.delete(tab.id); }}
          type="button"
          role="tab"
          aria-selected={activeId === tab.id}
          className={`fmt-sliding-tabs__btn ${activeId === tab.id ? 'active' : ''}`}
          title={tab.title}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Enum name, with its source kind ("Ax Enum", …) only in the technical view. */
function enumLabelFor(enumInfo: any, showTechnicalDetails: boolean): string {
  return showTechnicalDetails ? formatEnumDisplayName(enumInfo.enumName, enumInfo) : enumInfo.enumName;
}

/** Element type as it should read in the current mode. */
function formatTypeLabelFor(type: string, showTechnicalDetails: boolean | undefined): string {
  return showTechnicalDetails ? type : getConsultantFormatTypeLabel(type);
}

function getDatasourceGroupLabel(type: string, showTechnicalDetails: boolean): string {
  if (showTechnicalDetails) {
    return dsGroupLabels[locale === 'cs' ? 'cs' : 'en'][type] ?? type;
  }

  const csLabels: Record<string, string> = {
    Table: 'Tabulky',
    CalculatedField: 'Vypočtené hodnoty',
    Class: 'Logika',
    Object: 'Objekty',
    Enum: 'Hodnoty',
    ModelEnum: 'Hodnoty',
    FormatEnum: 'Hodnoty',
    ImportFormat: 'Importní formát',
    UserParameter: 'Parametry',
    GroupBy: 'Seskupená data',
    Container: 'Kontejnery',
    Join: 'Spojení',
    DataModel: 'Datový model',
    Values: 'Hodnoty',
  };
  const enLabels: Record<string, string> = {
    Table: 'Tables',
    CalculatedField: 'Calculated values',
    Class: 'Logic',
    Object: 'Objects',
    Enum: 'Values',
    ModelEnum: 'Values',
    FormatEnum: 'Values',
    ImportFormat: 'Import format',
    UserParameter: 'Parameters',
    GroupBy: 'Grouped data',
    Container: 'Containers',
    Join: 'Joins',
    DataModel: 'Data model',
    Values: 'Values',
  };
  const labels = locale === 'cs' ? csLabels : enLabels;
  return labels[type] ?? (locale === 'cs' ? 'Ostatní' : 'Other');
}

/** Returns true if ds or any of its descendants has the given name */
function containsDatasourceName(ds: any, name: string): boolean {
  if (ds.name === name) return true;
  return (ds.children ?? []).some((c: any) => containsDatasourceName(c, name));
}

/** Datasource types the consultant view names; the rest share one "Other" group. */
const CONSULTANT_DS_GROUP_TYPES = new Set(['Table', 'CalculatedField', 'Class', 'Object', 'ImportFormat', 'UserParameter', 'GroupBy', 'Container', 'Join', 'DataModel']);

function getDatasourceGroupKey(type: string, showTechnicalDetails: boolean): string {
  if (showTechnicalDetails) return type;
  // The three enum kinds share a key, and that key needs a label of its own —
  // without one the enums fell through to "Other", next to the real "Other".
  if (type === 'Enum' || type === 'ModelEnum' || type === 'FormatEnum') return 'Values';
  return CONSULTANT_DS_GROUP_TYPES.has(type) ? type : 'Other';
}

// ─── Model Designer ───

const NODE_W = 280;
const NODE_H_BASE = 56; // header
const NODE_H_FIELD = 20; // per field
const H_GAP = 60;
const V_GAP = 80;

/** Compute a hierarchical left-to-right layout for model containers */
function buildModelLayout(containers: any[]) {
  const containerMap = new Map(containers.map(c => [c.id, c]));

  // Build adjacency: which containers reference which (via typeDescriptor)
  const children = new Map<string, string[]>(); // parent id → child ids
  const parentCount = new Map<string, number>(); // child id → count of parents
  for (const c of containers) {
    for (const item of c.items) {
      if (item.typeDescriptor && containerMap.has(item.typeDescriptor)) {
        if (!children.has(c.id)) children.set(c.id, []);
        const existing = children.get(c.id)!;
        if (!existing.includes(item.typeDescriptor)) {
          existing.push(item.typeDescriptor);
          parentCount.set(item.typeDescriptor, (parentCount.get(item.typeDescriptor) ?? 0) + 1);
        }
      }
    }
  }

  // Separate: roots (isRoot), enums, records
  const roots = containers.filter(c => c.isRoot);
  const enums = containers.filter(c => c.isEnum);
  const records = containers.filter(c => !c.isRoot && !c.isEnum);

  // BFS level assignment starting from roots
  const level = new Map<string, number>();
  const queue: { id: string; lv: number }[] = roots.map(r => ({ id: r.id, lv: 0 }));
  while (queue.length > 0) {
    const { id, lv } = queue.shift()!;
    if (level.has(id)) continue;
    level.set(id, lv);
    for (const child of children.get(id) ?? []) {
      if (!level.has(child)) queue.push({ id: child, lv: lv + 1 });
    }
  }
  // Records not reached by BFS go at end
  for (const c of records) {
    if (!level.has(c.id)) level.set(c.id, (Math.max(...Array.from(level.values()), -1) + 1));
  }
  // Enums: separate column on the right
  const maxLevel = Math.max(...Array.from(level.values()), 0);

  // Group by level
  const byLevel = new Map<number, string[]>();
  for (const [id, lv] of level) {
    if (!byLevel.has(lv)) byLevel.set(lv, []);
    byLevel.get(lv)!.push(id);
  }

  // Compute node heights
  const nodeHeight = (c: any) => NODE_H_BASE + c.items.length * NODE_H_FIELD + 8;

  // Assign X/Y positions — nodes at the same level stack vertically
  const positions = new Map<string, { x: number; y: number }>();
  const colWidth = NODE_W + H_GAP;

  for (const [lv, ids] of byLevel) {
    let y = 0;
    for (const id of ids) {
      const c = containerMap.get(id);
      positions.set(id, { x: lv * colWidth, y });
      y += nodeHeight(c) + V_GAP;
    }
  }

  // Enums: far right column
  const enumColX = (maxLevel + 1) * colWidth;
  let enumY = 0;
  for (const c of enums) {
    positions.set(c.id, { x: enumColX, y: enumY });
    enumY += nodeHeight(c) + V_GAP;
  }

  return { positions, nodeHeight };
}

function ModelDesigner({ config, focusNode }: { config: ERConfiguration; focusNode: any | null }) {
  const dm = (config.content as ERDataModelContent).version.model;
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (focusNode?.type === 'container' && focusNode.data?.id) {
      setSelectedId(focusNode.data.id);
    }
    if (focusNode?.type === 'field') {
      // Field node ID: cfg-{n}-container-{ci}-field-{fi} — extract container index
      const m = focusNode.id.match(/-container-(\d+)-field-/);
      if (m) {
        const ci = parseInt(m[1], 10);
        const container = dm.containers[ci];
        if (container?.id) setSelectedId(container.id);
      }
    }
  }, [focusNode]);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const containerMap = new Map(dm.containers.map(c => [c.id, c]));
    const { positions, nodeHeight } = buildModelLayout(dm.containers);

    dm.containers.forEach(container => {
      const pos = positions.get(container.id) ?? { x: 0, y: 0 };
      const isSelected = selectedId === container.id;

      // Color scheme per container kind
      const headerBg = container.isRoot
        ? 'var(--er-model-soft)'
        : container.isEnum
          ? 'var(--er-format-soft)'
          : 'var(--er-surface-2)';
      const headerColor = container.isRoot
        ? 'var(--er-model)'
        : container.isEnum
          ? 'var(--er-format)'
          : 'var(--er-text-muted)';

      nodes.push({
        id: container.id,
        position: pos,
        data: {
          label: (
            <div
              onClick={() => setSelectedId(id => id === container.id ? null : container.id)}
              style={{ textAlign: 'left', width: NODE_W, cursor: 'pointer' }}
            >
              {/* Header */}
              <div style={{
                fontWeight: 700,
                padding: '5px 10px',
                background: headerBg,
                color: headerColor,
                borderRadius: '5px 5px 0 0',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{ fontSize: 14 }}>
                  {container.isRoot ? '🏠' : container.isEnum ? '🔤' : '📦'}
                </span>
                <span>{container.name}</span>
                {container.isRoot && (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 9,
                    background: 'var(--surface-info-bg)',
                    border: '1px solid var(--surface-info-border)',
                    padding: '1px 5px',
                    borderRadius: 3,
                    color: 'var(--surface-info-fg)',
                    fontWeight: 600,
                  }}>{t.modelRootBadge}</span>
                )}
                {container.isEnum && (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 9,
                    background: 'var(--surface-warning-bg)',
                    border: '1px solid var(--surface-warning-border)',
                    padding: '1px 5px',
                    borderRadius: 3,
                    color: 'var(--surface-warning-fg)',
                    fontWeight: 600,
                  }}>{t.modelEnumBadge}</span>
                )}
                <span style={{
                  marginLeft: container.isRoot || container.isEnum ? 0 : 'auto',
                  fontSize: 9,
                  color: 'var(--text-secondary)',
                  fontWeight: 400,
                }}>{t.statsFields(container.items.length)}</span>
              </div>
              {/* Fields */}
              <div style={{
                padding: '4px 0',
                fontSize: 11,
                background: 'var(--syn-node-bg)',
                borderRadius: '0 0 5px 5px',
                maxHeight: 240,
                overflow: 'hidden',
              }}>
                {container.items.slice(0, 14).map((f: any, fi: number) => (
                  <div key={fi} style={{
                    padding: '1px 10px',
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    borderBottom: fi < container.items.length - 1 ? '1px solid var(--border-color)' : 'none',
                  }}>
                    <span style={{ color: 'var(--syn-identifier)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </span>
                    {showTechnicalDetails && (
                      <span style={{
                        color: f.typeDescriptor ? 'var(--surface-info-fg)' : 'var(--syn-field-type)',
                        fontSize: 10,
                        fontWeight: f.typeDescriptor ? 600 : 400,
                        flexShrink: 0,
                      }}>
                        {f.typeDescriptor ? `→ ${containerMap.get(f.typeDescriptor)?.name ?? f.typeDescriptor.slice(1, 9)}` : fieldTypeLabel(f.type)}
                      </span>
                    )}
                  </div>
                ))}
                {container.items.length > 14 && (
                  <div style={{ padding: '2px 10px', color: 'var(--text-secondary)', fontSize: 10 }}>
                    {t.moreFields(container.items.length - 14)}
                  </div>
                )}
              </div>
            </div>
          ),
        },
        type: 'default',
        // Explicit width/height (not just `style`): React Flow's MiniMap skips
        // any node without dimensions on the node object itself, which is why
        // the minimap used to render an empty frame.
        width: NODE_W,
        height: nodeHeight(container),
        style: {
          background: 'var(--er-surface)',
          border: `1px solid ${isSelected ? 'var(--er-accent)' : 'var(--er-border)'}`,
          borderRadius: 'var(--er-radius-lg)',
          padding: 0,
          width: NODE_W,
          boxShadow: isSelected ? '0 0 0 2px var(--er-accent-border)' : 'var(--er-shadow-1)',
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });

      // TypeDescriptor edges
      container.items.forEach((item: any) => {
        if (item.typeDescriptor && containerMap.has(item.typeDescriptor)) {
          const isRecordList = item.type === 11;
          edges.push({
            id: `${container.id}-${item.name}-${item.typeDescriptor}`,
            source: container.id,
            target: item.typeDescriptor,
            label: item.name,
            animated: isRecordList,
            style: {
              stroke: isRecordList ? 'var(--accent-text-success)' : 'var(--syn-edge)',
              strokeWidth: isRecordList ? 2 : 1,
              strokeDasharray: item.type === 10 ? '5,3' : undefined,
            },
            labelStyle: { fontSize: 9, fill: 'var(--syn-edge-label)', fontFamily: 'monospace' },
            labelBgStyle: { fill: 'var(--bg-primary)', fillOpacity: 0.8 },
            type: 'smoothstep',
          });
        }
      });
    });

    return { nodes, edges };
  }, [dm, selectedId, showTechnicalDetails]);

  // Stats
  const stats = useMemo(() => ({
    roots: dm.containers.filter(c => c.isRoot).length,
    records: dm.containers.filter(c => !c.isRoot && !c.isEnum).length,
    enums: dm.containers.filter(c => c.isEnum).length,
    fields: dm.containers.reduce((s, c) => s + c.items.length, 0),
    edges: dm.containers.reduce((s, c) => s + c.items.filter((it: any) => it.typeDescriptor).length, 0),
  }), [dm]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {focusNode && focusNode.type !== 'file' && focusNode.type !== 'model' && (
        <ActiveTabNodeSummary node={focusNode} configIndex={focusNode.configIndex ?? 0} />
      )}
      {/* Header bar */}
      <div className="fmt-header">
        <span className="fmt-header-title">
          <DataBarVerticalFilled fontSize={15} />
          {locale === 'cs' ? 'Datový model' : 'Data Model'}
        </span>
        <div className="fmt-header-stats">
          <span className="fmt-stat" style={{ color: 'var(--er-model)' }}>{t.statsRoots(stats.roots)}</span>
          <span className="fmt-stat">{t.statsRecords(stats.records)}</span>
          <span className="fmt-stat" style={{ color: 'var(--er-format)' }}>{t.statsEnums(stats.enums)}</span>
          <span className="fmt-stat">{t.statsFields(stats.fields)}</span>
          <span className="fmt-stat">{t.statsRelations(stats.edges)}</span>
        </div>
        <DesignerHint text={t.modelHierarchyHint} />
      </div>
      <div style={{ flex: 1 }}>
        <ReactFlow nodes={nodes} edges={edges} fitView nodesConnectable={false} nodesDraggable proOptions={{ hideAttribution: true }}>
          <Background color="var(--er-border)" gap={20} variant={'dots' as any} />
          <Controls />
          <MiniMap
            pannable
            zoomable
            className="er-minimap"
            maskColor="color-mix(in srgb, var(--er-bg-soft) 72%, transparent)"
            /* Full-strength kind hues: the soft surface tints used before were
               within a shade of the minimap background, so it read as empty. */
            nodeColor={(n) => {
              const c = dm.containers.find(c => c.id === n.id);
              if (!c) return 'var(--er-border-strong)';
              return c.isRoot ? 'var(--er-model)' : c.isEnum ? 'var(--er-format)' : 'var(--er-mapping)';
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

// ─── Mapping Designer ───

interface BindingTreeNode {
  /** Full binding path — also the collapse-state key. */
  key: string;
  /** Last path segment, i.e. what the F&O designer shows at this level. */
  name: string;
  children: BindingTreeNode[];
  binding?: any;
  /** Number of bindings in this subtree, including this node. */
  count: number;
}

/**
 * Turn the flat `parent/child/leaf` binding paths into the nested structure the
 * F&O model-mapping designer shows. Intermediate levels that carry no binding
 * of their own are still materialised so the hierarchy stays continuous.
 */
function buildBindingTree(bindings: any[]): BindingTreeNode[] {
  const roots: BindingTreeNode[] = [];
  const index = new Map<string, BindingTreeNode>();

  const ensure = (path: string): BindingTreeNode => {
    const existing = index.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf('/');
    const node: BindingTreeNode = {
      key: path,
      name: slash >= 0 ? path.slice(slash + 1) : path,
      children: [],
      count: 0,
    };
    index.set(path, node);
    if (slash >= 0) ensure(path.slice(0, slash)).children.push(node);
    else roots.push(node);
    return node;
  };

  for (const b of bindings) ensure(b.path).binding = b;

  const tally = (node: BindingTreeNode): number => {
    // Children keep insertion order — i.e. the order in which the paths
    // appear in the ER configuration — instead of an alphabetical sort.
    node.count = (node.binding ? 1 : 0) + node.children.reduce((sum, c) => sum + tally(c), 0);
    return node.count;
  };
  for (const root of roots) tally(root);
  return roots;
}

/** Every datasource name in a tree, children included. */
function collectDatasourceTerms(datasources: any[], out: string[] = []): string[] {
  for (const ds of datasources ?? []) {
    if (ds?.name) out.push(ds.name);
    if (ds?.children?.length) collectDatasourceTerms(ds.children, out);
  }
  return out;
}

/** Every element name in a format tree, children included. */
function collectFormatElementTerms(element: any, out: string[] = []): string[] {
  if (!element) return out;
  if (element.name) out.push(element.name);
  for (const child of element.children ?? []) collectFormatElementTerms(child, out);
  return out;
}

const EMPTY_STRING_SET: ReadonlySet<string> = new Set();

/** Every ancestor path of `path`, outermost first. */
function bindingAncestorKeys(path: string): string[] {
  const segments = path.split('/');
  return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'));
}

function MappingDesigner({ mapping, configIndex, focusNode, tabId }: { mapping: any; configIndex: number; focusNode: any | null; tabId?: string }) {

  const mm = mapping;
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const selectNode = useAppStore(s => s.selectNode);
  const treeNodes = useAppStore(s => s.treeNodes);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const [filter, setFilter] = useTabState(tabId, 'mapping.filter', '');
  const [view, setView] = useTabState<'bindings' | 'datasources' | 'validations'>(tabId, 'mapping.view', 'bindings');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const focusBindingPath: string | undefined = focusNode?.type === 'binding' ? focusNode.data?.path : undefined;
  const focusValidationPath: string | undefined = focusNode?.type === 'validation' ? focusNode.data?.path : undefined;
  const bindingScrollRef = useRef<HTMLDivElement | null>(null);
  const validationScrollRef = useRef<HTMLDivElement | null>(null);
  const dsListRef = useRef<GroupedDatasourceListHandle>(null);

  useEffect(() => {
    if (!focusNode) return;
    if (focusNode.type === 'binding') {
      setView('bindings');
      const focusPath = focusNode.data?.path as string | undefined;
      if (focusPath) {
        // Open every level on the way down to the focused binding.
        const ancestors = bindingAncestorKeys(focusPath);
        setCollapsedGroups(prev => {
          const next = new Set(prev);
          for (const key of ancestors) next.delete(key);
          return next;
        });
      }
    }
    // A validation used to land on the binding tree, which never lists it —
    // the row the user came from simply was not there.
    if (focusNode.type === 'validation') setView('validations');
    if (focusNode.type === 'datasource') setView('datasources');
  }, [focusNode]);

  useEffect(() => {
    if (!focusValidationPath) return;
    const timer = setTimeout(() => validationScrollRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    return () => clearTimeout(timer);
  }, [focusValidationPath]);

  useEffect(() => {
    if (!focusBindingPath) return;
    const timer = setTimeout(() => bindingScrollRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    return () => clearTimeout(timer);
  }, [focusBindingPath]);

  // Briefly flash the navigated-to row (e.g. jumping in from Search/Where-Used)
  // on top of its normal highlight, then let it settle back to the plain state.
  const [flashBindingPath, setFlashBindingPath] = useState<string | null>(null);
  useEffect(() => {
    if (!focusBindingPath) return;
    setFlashBindingPath(focusBindingPath);
    const timer = setTimeout(() => setFlashBindingPath(null), 1400);
    return () => clearTimeout(timer);
  }, [focusBindingPath]);

  // Trivial constant detector — same logic as Format bindings
  const isTrivialExpr = (expr: string) => /^(false|true|0|1|""|'')$/i.test(expr.trim());

  // Deduplicated, filtered bindings arranged as the designer's own hierarchy
  const bindingTree = useMemo(() => {
    // 1. Deduplicate by path
    const seen = new Set<string>();
    const deduped: typeof mm.bindings = [];
    for (const b of mm.bindings) {
      if (!seen.has(b.path)) {
        seen.add(b.path);
        deduped.push(b);
      }
    }

    // 2. Remove trivial constant expressions (e.g. Enabled = false)
    const meaningful = deduped.filter((b: any) => !isTrivialExpr(b.expressionAsString));

    // 3. Apply text filter
    const lower = filter.toLowerCase();
    const textFiltered = filter
      ? meaningful.filter((b: any) =>
          b.path.toLowerCase().includes(lower) ||
          b.expressionAsString.toLowerCase().includes(lower)
        )
      : meaningful;

    // 4. Nest by path segments
    return buildBindingTree(textFiltered);
  }, [mm.bindings, filter]);

  const toggleGroup = useCallback((g: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  }, []);

  const collapseAllKeys = useCallback((nodes: BindingTreeNode[]): string[] => {
    const keys: string[] = [];
    const walk = (list: BindingTreeNode[]) => {
      for (const n of list) {
        if (n.children.length > 0) { keys.push(n.key); walk(n.children); }
      }
    };
    walk(nodes);
    return keys;
  }, []);

  const expandAllBindings = useCallback(() => setCollapsedGroups(new Set()), []);
  const collapseAllBindings = useCallback(() => {
    setCollapsedGroups(new Set(collapseAllKeys(bindingTree)));
  }, [bindingTree, collapseAllKeys]);

  const selectBindingByPath = useCallback((path: string) => {
    const rootNode = treeNodes[configIndex];
    if (!rootNode) return;
    const match = findTreeNodeByMatch(rootNode, n => n.type === 'binding' && n.data?.path === path);
    // As in the format designer: selecting a row leaves the explorer alone;
    // the row's ⋮ menu reveals it there.
    if (match) selectNode(match.id, { revealInExplorer: false });
  }, [treeNodes, configIndex, selectNode]);

  const selectValidationByPath = useCallback((path: string) => {
    const rootNode = treeNodes[configIndex];
    if (!rootNode) return;
    const match = findTreeNodeByMatch(rootNode, n => n.type === 'validation' && n.data?.path === path);
    if (match) selectNode(match.id, { revealInExplorer: false });
  }, [treeNodes, configIndex, selectNode]);

  const revealBindingInExplorer = useCallback((path: string) => {
    const rootNode = treeNodes[configIndex];
    const match = rootNode ? findTreeNodeByMatch(rootNode, n => n.type === 'binding' && n.data?.path === path) : null;
    if (match) navigateToTreeNode(match.id);
  }, [treeNodes, configIndex, navigateToTreeNode]);

  const revealValidationInExplorer = useCallback((path: string) => {
    const rootNode = treeNodes[configIndex];
    const match = rootNode ? findTreeNodeByMatch(rootNode, n => n.type === 'validation' && n.data?.path === path) : null;
    if (match) navigateToTreeNode(match.id);
  }, [treeNodes, configIndex, navigateToTreeNode]);

  // Every level starts closed, not just the roots — the tree opens as the user
  // clicks down through it. This runs once per mapping (not on every filter
  // keystroke, which used to re-collapse everything and hide filter matches)
  // and keeps the path to a focused binding open.
  const collapseInitForRef = useRef<unknown>(null);
  useEffect(() => {
    if (collapseInitForRef.current === mm) return;
    if (bindingTree.length === 0 || filter) return;
    collapseInitForRef.current = mm;
    const next = new Set(collapseAllKeys(bindingTree));
    if (focusBindingPath) for (const key of bindingAncestorKeys(focusBindingPath)) next.delete(key);
    setCollapsedGroups(next);
  }, [mm, bindingTree, filter, collapseAllKeys, focusBindingPath]);

  // While a text filter is active every match must be visible, so the
  // user's manual collapse state is suspended (and restored when cleared).
  const effectiveCollapsedGroups = filter ? EMPTY_STRING_SET : collapsedGroups;

  const totalShown = bindingTree.reduce((n, g) => n + g.count, 0);

  const validations: any[] = mm.validations ?? [];
  const filteredValidations = useMemo(() => {
    if (!filter) return validations;
    const lower = filter.toLowerCase();
    return validations.filter((validation: any) =>
      validation.path?.toLowerCase().includes(lower) ||
      (validation.conditions ?? []).some((rule: any) =>
        rule.conditionExpressionAsString?.toLowerCase().includes(lower) ||
        rule.messageExpressionAsString?.toLowerCase().includes(lower) ||
        rule.severity?.toLowerCase().includes(lower) ||
        rule.action?.toLowerCase().includes(lower)
      )
    );
  }, [validations, filter]);

  /* What the three tabs can be filtered by, with how many rows each term hits.
     The pool deliberately crosses tab boundaries: typing a datasource name
     while Bindings is open should still offer it and take you to it, which is
     what `view` on the suggestion is for. */
  const filterSuggestions = useMemo<FilterSuggestion[]>(() => [
    ...suggestionsFromCounts(
      countTerms((mm.bindings ?? []).flatMap((binding: any) => String(binding.path ?? '').split('/'))),
      t.bindings,
      'bindings',
    ),
    ...suggestionsFromCounts(countTerms(collectDatasourceTerms(mm.datasources)), t.dataSources, 'datasources'),
    ...suggestionsFromCounts(
      countTerms((mm.validations ?? []).flatMap((validation: any) => String(validation.path ?? '').split('/'))),
      t.propValidations,
      'validations',
    ),
  ], [mm.bindings, mm.datasources, mm.validations]);

  const filteredDatasources = useMemo(() => {
    if (!filter) return mm.datasources;
    const lower = filter.toLowerCase();
    return mm.datasources.filter((ds: any) =>
      ds.name.toLowerCase().includes(lower) ||
      ds.type.toLowerCase().includes(lower) ||
      ds.tableInfo?.tableName?.toLowerCase().includes(lower)
    );
  }, [mm.datasources, filter]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Identity only — the counts moved out of here because the view tabs
          right below already carry them, once each. */}
      <div className="fmt-header">
        <span className="fmt-header-title">
          <LinkFilled fontSize={15} />
          {locale === 'cs' ? 'Mapování modelu' : 'Model mapping'}
        </span>
        <div className="fmt-header-stats">
          {(mm.dataContainerDescriptor || mm.name) && (
            <span
              className="fmt-stat"
              title={showTechnicalDetails
                ? (locale === 'cs'
                  ? 'Definice mapování (DataContainerDescriptor — kořenový kontejner datového modelu)'
                  : 'Mapping definition (DataContainerDescriptor — root container of the data model)')
                : (locale === 'cs' ? 'Definice mapování' : 'Mapping definition')}
            >
              {locale === 'cs' ? 'Definice' : 'Definition'}: {
                // The descriptor is the model root's technical name; consultants
                // get the definition's own name.
                showTechnicalDetails && mm.name && mm.dataContainerDescriptor && mm.name !== mm.dataContainerDescriptor
                  ? `${mm.name} (${mm.dataContainerDescriptor})`
                  : (showTechnicalDetails ? (mm.dataContainerDescriptor || mm.name) : (mm.name || mm.dataContainerDescriptor))
              }
            </span>
          )}
        </div>
        <DesignerHint text={locale === 'cs'
          ? 'Klikni na řádek pro vlastnosti, na lupu pro rozpad výrazu'
          : 'Click a row for properties, the magnifier for the expression drill-down'}
        />
      </div>
      <div className="fmt-toolbar">
        <SlidingTabs
          tabs={[
            { id: 'bindings' as const, label: `${t.bindings} (${totalShown})` },
            { id: 'datasources' as const, label: `${t.dataSources} (${mm.datasources.length})` },
            { id: 'validations' as const, label: `${t.propValidations} (${filteredValidations.length})` },
          ]}
          activeId={view}
          onChange={setView}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          {view === 'bindings' && (
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
              onExpand={expandAllBindings}
              onCollapse={collapseAllBindings}
            />
          )}
          {view === 'datasources' && (
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
              onExpand={() => dsListRef.current?.expandAll()}
              onCollapse={() => dsListRef.current?.collapseAll()}
            />
          )}
          <FilterField
            value={filter}
            onChange={setFilter}
            placeholder={t.filter}
            suggestions={filterSuggestions}
            historyScope="mapping"
            onPick={suggestion => { if (suggestion.view) setView(suggestion.view as typeof view); }}
            style={{ width: 180 }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="designer-scroll-pane">
        {view === 'bindings' && (
          bindingTree.length === 0
            ? <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 12 }}>{t.noResults}</div>
            : <div className="mm-tree" role="tree">
                {bindingTree.map(node => (
                  <BindingTreeRows
                    key={node.key}
                    node={node}
                    depth={0}
                    collapsed={effectiveCollapsedGroups}
                    onToggle={toggleGroup}
                    configIndex={configIndex}
                    focusBindingPath={focusBindingPath}
                    flashBindingPath={flashBindingPath}
                    focusRef={bindingScrollRef}
                    onSelectBinding={selectBindingByPath}
                    onRevealBinding={revealBindingInExplorer}
                  />
                ))}
              </div>
        )}

        {view === 'datasources' && (
          <GroupedDatasourceList ref={dsListRef} datasources={filteredDatasources} filtering={Boolean(filter)} configIndex={configIndex} navigateToTreeNode={navigateToTreeNode} focusDsName={focusNode?.type === 'datasource' ? focusNode.name : undefined} />
        )}

        {view === 'validations' && (
          filteredValidations.length === 0
            ? <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 12 }}>
                {validations.length === 0 ? t.mappingNoValidations : t.noResults}
              </div>
            : <div className="mm-validation-list">
                {filteredValidations.map((validation: any, vi: number) => (
                  <ValidationRow
                    key={`${validation.path}-${vi}`}
                    validation={validation}
                    configIndex={configIndex}
                    focused={validation.path === focusValidationPath}
                    focusRef={validationScrollRef}
                    onSelect={selectValidationByPath}
                    onReveal={revealValidationInExplorer}
                  />
                ))}
              </div>
        )}
      </div>
    </div>
  );
}

/**
 * One validation of a model mapping: the model path it guards, plus a card per
 * rule with its condition and message expressions. Both expressions get the
 * same drill-down affordance as a binding — a validation message is usually
 * the more tangled of the two formulas.
 */
function ValidationRow({ validation, configIndex, focused, focusRef, onSelect, onReveal }: {
  validation: any;
  configIndex: number;
  focused: boolean;
  focusRef: React.MutableRefObject<HTMLDivElement | null>;
  onSelect: (path: string) => void;
  onReveal?: (path: string) => void;
}) {
  const rules: any[] = validation.conditions ?? [];

  return (
    <div
      className={`mm-binding-row mm-validation-row ${focused ? 'search-match' : ''}`}
      ref={focused ? focusRef : null}
      onClick={() => onSelect(validation.path)}
    >
      <div className="mm-tree-head">
        <span className="mm-validation-icon" aria-hidden><CheckmarkCircleRegular fontSize={14} /></span>
        <span className="mm-binding-name" title={validation.path}>{validation.path}</span>
        {rules.length > 1 && (
          <span
            className="mm-group-count"
            title={locale === 'cs' ? `Počet pravidel: ${rules.length}` : `Number of rules: ${rules.length}`}
          >{rules.length}</span>
        )}
        {onReveal && <RevealInExplorerMenu onReveal={() => onReveal(validation.path)} />}
      </div>
      {rules.map((rule: any, ri: number) => (
        <div key={rule.id ?? ri} className="mm-validation-rule">
          <div className="mm-validation-rule-head">
            <span className="mm-validation-rule-title">{t.propRule(ri + 1)}</span>
            {/* The XML stores these as bare codes (Action="1"), so the badge
                says which attribute the value belongs to. */}
            {rule.severity && <span className="mm-validation-badge">{t.validationSeverityBadge(rule.severity)}</span>}
            {rule.action && <span className="mm-validation-badge">{t.validationActionBadge(rule.action)}</span>}
          </div>
          <ValidationExpression
            label={t.propCondition}
            expression={rule.conditionExpressionAsString}
            configIndex={configIndex}
            elementName={`${validation.path} — ${t.propCondition}`}
          />
          <ValidationExpression
            label={t.propMessage}
            expression={rule.messageExpressionAsString}
            configIndex={configIndex}
            elementName={`${validation.path} — ${t.propMessage}`}
          />
        </div>
      ))}
    </div>
  );
}

function ValidationExpression({ label, expression, configIndex, elementName }: {
  label: string;
  expression: string | undefined;
  configIndex: number;
  elementName: string;
}) {
  const expr = (expression ?? '').trim();
  if (!expr) return null;
  return (
    <div className="mm-validation-expr">
      <span className="mm-validation-expr-label">{label}</span>
      <div className="mm-binding-expr">
        <ClickablePath expression={expr} configIndex={configIndex} />
      </div>
      <DrillDownTrigger
        expression={expr}
        configIndex={configIndex}
        elementName={elementName}
        className="mm-binding-drill"
      >
        <SearchRegular fontSize={14} />
        <span>{locale === 'cs' ? 'Rozpad' : 'Drill-down'}</span>
      </DrillDownTrigger>
    </div>
  );
}

/**
 * One level of the model-mapping binding hierarchy. Container levels render as
 * collapsible branches, bound levels additionally render their expression and
 * the drill-down trigger, so a node that is both keeps a single row.
 */
function BindingTreeRows({
  node, depth, collapsed, onToggle, configIndex, focusBindingPath, flashBindingPath, focusRef, onSelectBinding, onRevealBinding,
}: {
  node: BindingTreeNode;
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  configIndex: number;
  focusBindingPath?: string;
  flashBindingPath: string | null;
  focusRef: React.MutableRefObject<HTMLDivElement | null>;
  onSelectBinding: (path: string) => void;
  /** Shows the binding's node in the explorer — offered in each bound row's ⋮ menu. */
  onRevealBinding?: (path: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = hasChildren && collapsed.has(node.key);
  const binding = node.binding;
  const isFocused = !!binding && node.key === focusBindingPath;
  const navFlash = isFocused && flashBindingPath === node.key;

  const classes = [
    'mm-tree-row',
    binding ? 'mm-binding-row' : 'mm-tree-branch',
    hasChildren ? 'mm-tree-expandable' : '',
    isFocused ? 'search-match' : '',
    navFlash ? 'nav-flash' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="mm-tree-node" style={{ ['--mm-depth' as string]: depth }}>
      <div
        className={classes}
        role="treeitem"
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        ref={isFocused ? focusRef : null}
        onClick={() => {
          if (binding) onSelectBinding(node.key);
          else if (hasChildren) onToggle(node.key);
        }}
      >
        <div className="mm-tree-head">
          {hasChildren ? (
            <button
              type="button"
              className={`mm-tree-toggle ${isCollapsed ? '' : 'open'}`}
              aria-label={node.name}
              onClick={e => { e.stopPropagation(); onToggle(node.key); }}
            >
              <span className={`tree-chevron ${isCollapsed ? '' : 'open'}`} />
            </button>
          ) : (
            <span className="mm-tree-toggle mm-tree-toggle--leaf" aria-hidden />
          )}
          <span className={binding ? 'mm-binding-name' : 'mm-tree-branch-name'}>{node.name}</span>
          {hasChildren && (
            <span
              className="mm-group-count"
              title={locale === 'cs' ? `Počet vazeb v této větvi: ${node.count}` : `Number of bindings in this branch: ${node.count}`}
            >{node.count}</span>
          )}
          {binding && (
            <DrillDownTrigger
              expression={binding.expressionAsString}
              configIndex={configIndex}
              elementName={node.name}
              className="mm-binding-drill"
            >
              <SearchRegular fontSize={14} />
              <span>{locale === 'cs' ? 'Rozpad' : 'Drill-down'}</span>
            </DrillDownTrigger>
          )}
          {binding && onRevealBinding && <RevealInExplorerMenu onReveal={() => onRevealBinding(node.key)} />}
        </div>
        {binding && (
          <div className="mm-binding-expr">
            <span className="mm-binding-arrow" aria-hidden>←</span>
            <ClickablePath expression={binding.expressionAsString} configIndex={configIndex} mode="binding-expr" />
          </div>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <div className="mm-tree-children" role="group">
          {node.children.map(child => (
            <BindingTreeRows
              key={child.key}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              configIndex={configIndex}
              focusBindingPath={focusBindingPath}
              flashBindingPath={flashBindingPath}
              focusRef={focusRef}
              onSelectBinding={onSelectBinding}
              onRevealBinding={onRevealBinding}
            />
          ))}
        </div>
      )}
    </div>
  );
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

function FormatDesigner({ config, configIndex, focusNode, tabId }: { config: ERConfiguration; configIndex: number; focusNode: any | null; tabId?: string }) {
  const fc = config.content as ERFormatContent;
  const fmt = fc.formatVersion.format;
  const fmtMap = fc.formatMappingVersion.formatMapping;
  const rootElement = fmt.rootElement;
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const selectNode = useAppStore(s => s.selectNode);
  const treeNodes = useAppStore(s => s.treeNodes);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const configurations = useAppStore(s => s.configurations);
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
  }, [focusNode]);

  const bindingPresentation = useMemo(
    () => buildFormatBindingPresentation(rootElement, fmtMap.bindings),
    [rootElement, fmtMap.bindings],
  );
  const bindingMap = bindingPresentation.bindingMap;

  // Transformation lookup: GUID → transformation
  const transformationMap = useMemo(() => {
    const map = new Map<string, typeof fmt.transformations[0]>();
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
    return { totalElements, boundElements, unboundElements, structuralElements, typeCount, bindings: fmtMap.bindings.length, datasources: fmtMap.datasources.length, enums: fmt.enumDefinitions.length, transformations: fmt.transformations.length };
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

    const models = configurations
      .filter(cfg => cfg.content.kind === 'DataModel')
      .map(cfg => (cfg.content as ERDataModelContent).version.model);
    const model = descriptorKey
      ? [...models.filter(m => modelIds.has(normGuid(m.id))), ...models.filter(m => !modelIds.has(normGuid(m.id)))]
          .find(m => m.containers.some(c => c.name.toLowerCase() === descriptorKey || c.id.toLowerCase() === descriptorKey))
      : undefined;

    return { modelNames, descriptor, mapping, dataModel: model ? { model, descriptor } : null };
  }, [fmtMap.datasources, fc, configurations, configIndex]);

  const modelUsageTree = useMemo(() => buildModelUsageTree({
    rootElement,
    groups: meaningfulBindingGroups,
    modelNames: modelContext.modelNames,
    mappingBindings: modelContext.mapping?.definition.bindings ?? null,
    dataModel: modelContext.dataModel,
  }), [rootElement, meaningfulBindingGroups, modelContext]);

  const modelLabels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);
  const modelFieldLabel = useCallback((node: ModelUsageNode): string | undefined => {
    const resolved = resolveLabel(node.field?.label, modelLabels);
    return resolved?.localized ?? resolved?.enUs;
  }, [modelLabels, locale]);

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
  }, [focusNode]);

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

  // Filter for datasources view
  const filteredDatasources = useMemo(() => {
    if (!filter) return fmtMap.datasources;
    const lower = filter.toLowerCase();
    return fmtMap.datasources.filter((ds: any) =>
      ds.name.toLowerCase().includes(lower) ||
      ds.type.toLowerCase().includes(lower) ||
      ds.tableInfo?.tableName?.toLowerCase().includes(lower)
    );
  }, [fmtMap.datasources, filter]);

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
        title: locale === 'cs' ? 'Hierarchická struktura prvků formátu s vazbami na datový model' : 'Hierarchical structure of format elements with data model bindings',
      },
      {
        id: 'bindings',
        label: `${t.bindings} (${shownBindingCount})`,
        title: locale === 'cs'
          ? 'Vazby podle účelu — přímé hodnoty, výpočty, podmínky, texty — v pořadí, v jakém soubor vzniká'
          : 'Bindings by intent — direct values, calculations, conditions, texts — in the order the file is built',
      },
      {
        id: 'datasources',
        label: `${t.dataSources} (${stats.datasources})`,
        title: locale === 'cs' ? 'Datové zdroje mapování — tabulky, výčty, třídy a vypočítaná pole' : 'Mapping data sources — tables, enums, classes and calculated fields',
      },
      {
        id: 'preview',
        label: t.previewLabel,
        title: locale === 'cs' ? 'Náhled generovaného výstupu ve správném formátu' : 'Preview of generated output in the correct format',
      },
    ];
    if (fc.embeddedModelMappingVersions.length > 0) {
      tabs.push({
        id: 'embedded-mapping',
        label: `${locale === 'cs' ? 'Mapování' : 'Mapping'} (${fc.embeddedModelMappingVersions.length})`,
        title: locale === 'cs' ? 'Mapování modelu zabudované přímo v importním formátu' : 'Model mapping embedded directly in the import format',
      });
    }
    return tabs;
  }, [stats.totalElements, stats.datasources, shownBindingCount, fc.direction, fc.embeddedModelMappingVersions.length]);

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
        <div className="designer-list-pane">
          {view === 'structure' && (
            <div
              className="fmt-structure-list"
              role="tree"
              aria-label={t.structure}
              // Focusable, but not a tab stop: a click on empty space keeps
              // focus in the tree so the arrows still reach it.
              tabIndex={-1}
              onKeyDown={forwardArrowKeyToSelectedRow}
            >
              <FormatElementTree
                element={rootElement}
                depth={0}
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
            </div>
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
                  const unresolvedName = locale === 'cs' ? 'Prvky mimo strukturu formátu' : 'Elements outside the format structure';
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
            <GroupedDatasourceList ref={dsListRef} datasources={filteredDatasources} filtering={Boolean(filter)} configIndex={configIndex} navigateToTreeNode={navigateToTreeNode} focusDsName={focusNode?.type === 'datasource' ? focusNode.name : undefined} />
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

// ── Format file preview ──

type BindingMap = Map<string, import('../utils/format-binding-display').NormalizedFormatBinding[]>;

/**
 * Try to extract a fixed (constant) value from a binding expression string.
 * Returns the constant if the expression is a pure double-quoted string literal
 * (e.g. `"HD: "`), a number, or a boolean.
 * Returns '' for dynamic expressions — data paths like
 * `'Control statement'.'$A5'.aggregated.'$TaxBaseStd'` use single-quoted
 * identifiers joined by `'.'` and must be rejected.
 */
function extractConstantFromExpression(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) return '';
  // Only double-quoted strings are ER string constants.
  // Single quotes are used for identifier quoting in paths.
  const strMatch = trimmed.match(/^"([^"]*)"$/);
  if (strMatch) return strMatch[1];
  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  // Boolean
  if (trimmed === 'true' || trimmed === 'false') return trimmed;
  // Everything else is dynamic — no constant
  return '';
}

type PreviewPlaceholderMode = 'sample' | 'omit' | 'braces';

type PreviewRenderOptions = {
  placeholderMode: PreviewPlaceholderMode;
  /** Consultant mode must not see raw ER element type names in the preview. */
  showTechnicalDetails?: boolean;
};

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickByHash(values: string[], seed: string): string {
  if (values.length === 0) return '';
  return values[hashString(seed) % values.length];
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function sampleValueForElement(el: ERFormatElement): string {
  const name = el.name ?? '';
  const seed = `${el.id}|${el.name}|${el.elementType}`;
  const lower = normalizeForMatch(name);
  const numericLikeName = /(amount|sum|total|price|tax|base|castka|sazba|rate|percent|pct|qty|quantity|count|pocet|index|poradi|id|number|num|cislo|ref|value|hodnota|saldo|debit|credit|net|gross|subtotal)/.test(lower);

  if (el.elementType === 'Numeric') {
    return pickByHash(['0', '1', '12', '105.45', '999.99'], seed);
  }
  if (numericLikeName) return pickByHash(['0', '1', '12', '105.45', '999.99'], seed);
  if (el.elementType === 'DateTime') {
    return pickByHash(['2026-01-15', '2026-03-31', '2026-06-01T10:30:00'], seed);
  }
  if (/(is|has|flag|enabled|active|valid|platny|aktivni)/.test(lower)) return pickByHash(['true', 'false'], seed);
  if (/(date|datum)/.test(lower)) return pickByHash(['2026-01-15', '2026-03-31'], seed);
  if (/(time|cas)/.test(lower)) return pickByHash(['10:30:00', '14:05:22'], seed);
  if (/(vat|dic)/.test(lower)) return pickByHash(['CZ699001234', 'CZ12345678'], seed);
  if (/(ico)/.test(lower)) return pickByHash(['12345678', '27654321'], seed);
  if (/(code|kod)/.test(lower)) return pickByHash(['A001', 'INV001', 'DOC2026'], seed);
  if (/(name|nazev|company|firma|customer|partner)/.test(lower)) return pickByHash(['Contoso s.r.o.', 'Fabrikam a.s.', 'Adventure Works'], seed);
  if (/(city|mesto)/.test(lower)) return pickByHash(['Praha', 'Brno', 'Ostrava'], seed);
  if (/(street|ulice)/.test(lower)) return pickByHash(['Dlouha 15', 'Masarykova 21', 'Nova 8'], seed);
  if (/(zip|psc|postal)/.test(lower)) return pickByHash(['11000', '60200', '70200'], seed);
  if (/(country|stat)/.test(lower)) return pickByHash(['CZ', 'SK', 'DE'], seed);

  return `Sample(${name || 'Value'})`;
}

/** True for the synthetic `Sample(...)` placeholders produced by sampleValueForElement. */
function isSamplePlaceholder(value: string): boolean {
  return /^Sample\(.*\)$/.test(value);
}

/** Format an element's preview value: constant from binding expression or configurable unresolved fallback.
 *  el.value is always an expression path in ER format XML, never a display constant — skip it. */
function previewValue(el: ERFormatElement, bindingMap: BindingMap, options: PreviewRenderOptions): string {
  const bindings = bindingMap.get(el.id);
  if (bindings) {
    const dataBinding = bindings.find(b => b.bindingCategory === 'data');
    if (dataBinding?.expressionAsString) {
      const constant = extractConstantFromExpression(dataBinding.expressionAsString);
      if (constant) return constant;
    }
  }
  if (options.placeholderMode === 'omit') return '';
  if (options.placeholderMode === 'sample') return sampleValueForElement(el);
  return `{${el.name}}`;
}

// ── Visual Excel Spreadsheet Preview ──

interface ExcelSheetData {
  name: string;
  header: ExcelSectionData | null;
  footer: ExcelSectionData | null;
  ranges: ExcelRangeData[];
  cells: ExcelCellData[];
}

interface ExcelSectionData {
  name: string;
  type: 'header' | 'footer';
  cells: ExcelCellData[];
}

interface ExcelRangeData {
  name: string;
  excelRange: string;
  replicationDirection: string;
  cells: ExcelCellData[];
  children: ExcelRangeData[];
}

interface ExcelCellData {
  name: string;
  excelRange: string;
  value: string;
  /** Resolved label text (from ERLabel) if the cell has a Label attribute */
  label?: string;
}

function collectExcelSheets(root: ERFormatElement, bm: BindingMap, labels?: ERLabel[], options: PreviewRenderOptions = { placeholderMode: 'sample' }): ExcelSheetData[] {
  const sheets: ExcelSheetData[] = [];

  const resolveCellLabel = (el: ERFormatElement): string | undefined => {
    const labelRef = el.attributes?.['Label'];
    if (!labelRef) return undefined;
    const resolved = resolveLabel(labelRef, labels);
    return resolved?.localized ?? resolved?.enUs ?? undefined;
  };

  const collectCells = (el: ERFormatElement): ExcelCellData[] => {
    if (el.elementType === 'ExcelCell') {
      return [{
        name: el.name,
        excelRange: el.attributes?.['ExcelRange'] ?? el.name,
        value: previewValue(el, bm, options),
        label: resolveCellLabel(el),
      }];
    }
    return el.children.flatMap(c => collectCells(c));
  };

  const collectRanges = (el: ERFormatElement): ExcelRangeData[] => {
    if (el.elementType === 'ExcelRange') {
      return [{
        name: el.name,
        excelRange: el.attributes?.['ExcelRange'] ?? el.name,
        replicationDirection: el.attributes?.['ReplicationDirection'] === '1' ? 'vertical' : el.attributes?.['ReplicationDirection'] === '2' ? 'horizontal' : '',
        cells: el.children.filter(c => c.elementType === 'ExcelCell').map(c => ({
          name: c.name,
          excelRange: c.attributes?.['ExcelRange'] ?? c.name,
          value: previewValue(c, bm, options),
          label: resolveCellLabel(c),
        })),
        children: el.children.filter(c => c.elementType === 'ExcelRange').flatMap(c => collectRanges(c)),
      }];
    }
    return el.children.flatMap(c => collectRanges(c));
  };

  const walkSheet = (el: ERFormatElement) => {
    if (el.elementType === 'ExcelSheet') {
      const header = el.children.find(c => c.elementType === 'ExcelHeader');
      const footer = el.children.find(c => c.elementType === 'ExcelFooter');
      const bodyChildren = el.children.filter(c => c.elementType !== 'ExcelHeader' && c.elementType !== 'ExcelFooter');
      sheets.push({
        name: el.name,
        header: header ? { name: header.name, type: 'header', cells: collectCells(header) } : null,
        footer: footer ? { name: footer.name, type: 'footer', cells: collectCells(footer) } : null,
        ranges: bodyChildren.flatMap(c => collectRanges(c)),
        cells: bodyChildren.filter(c => c.elementType === 'ExcelCell').map(c => ({
          name: c.name,
          excelRange: c.attributes?.['ExcelRange'] ?? c.name,
          value: previewValue(c, bm, options),
          label: resolveCellLabel(c),
        })),
      });
    } else {
      for (const child of el.children) walkSheet(child);
    }
  };
  walkSheet(root);

  // Many Excel formats have no ExcelSheet wrapper — cells/ranges sit directly under ExcelFile.
  // Treat the root as an implicit single sheet in that case.
  if (sheets.length === 0 && (root.elementType === 'ExcelFile' || root.elementType === 'ExcelSheet')) {
    const header = root.children.find(c => c.elementType === 'ExcelHeader');
    const footer = root.children.find(c => c.elementType === 'ExcelFooter');
    const bodyChildren = root.children.filter(c => c.elementType !== 'ExcelHeader' && c.elementType !== 'ExcelFooter');
    sheets.push({
      name: root.name || 'Sheet1',
      header: header ? { name: header.name, type: 'header', cells: collectCells(header) } : null,
      footer: footer ? { name: footer.name, type: 'footer', cells: collectCells(footer) } : null,
      ranges: bodyChildren.flatMap(c => collectRanges(c)),
      cells: bodyChildren.filter(c => c.elementType === 'ExcelCell').map(c => ({
        name: c.name,
        excelRange: c.attributes?.['ExcelRange'] ?? c.name,
        value: previewValue(c, bm, options),
        label: resolveCellLabel(c),
      })),
    });
  }

  return sheets;
}

/**
 * Both Excel previews reproduce a spreadsheet whose cell colours come from the
 * workbook itself and are authored for white paper. Rendering them on a dark
 * theme surface put dark text on a dark background, so the sheet area keeps a
 * fixed light palette in both themes — like a print preview. Only the
 * surrounding chrome (toolbar, legend, sheet tabs) follows the theme.
 */
const excelPaper = {
  cellBg: '#ffffff',
  cellText: '#1a1a1a',
  mutedText: '#5f6368',
  headerBg: '#f3f3f3',
  headerText: '#5f6368',
  cellBorder: '#d4d4d4',
  gridBg: '#e9e9e9',
  sectionBg: '#f7f7f7',
  rangeBg: '#eef4f0',
  dynamicText: '#8a3fa0',
};

/** Theme-aware chrome around the paper: ribbon, sheet tabs, range accents. */
const excelColors = {
  sheetTab: '#217346',
  sheetTabText: '#fff',
  cellBorder: 'var(--border-subtle)',
  // The Excel green is kept for borders and accents only — green text on a
  // green tint was unreadable in both themes.
  rangeBorder: '#217346',
  cellBg: 'var(--bg-primary)',
};

// ── Build cell-address → binding map from format tree ──
function buildCellBindingMap(root: ERFormatElement, bm: BindingMap, labels?: ERLabel[], options: PreviewRenderOptions = { placeholderMode: 'sample' }): Map<string, { value: string; name: string; label?: string; elementId: string }> {
  const map = new Map<string, { value: string; name: string; label?: string; elementId: string }>();
  const walk = (el: ERFormatElement) => {
    if (el.elementType === 'ExcelCell') {
      const addr = el.attributes?.['ExcelRange'] ?? el.name;
      const labelRef = el.attributes?.['Label'];
      let label: string | undefined;
      if (labelRef && labels) {
        const resolved = resolveLabel(labelRef, labels);
        label = resolved?.enUs ?? resolved?.localized ?? undefined;
      }
      map.set(addr.toUpperCase(), { value: previewValue(el, bm, options), name: el.name, label, elementId: el.id });
    }
    for (const child of el.children) walk(child);
  };
  walk(root);
  return map;
}

// ── Excel Template Grid (renders parsed .xlsx with binding overlays) ──

/** English Metric Units per CSS pixel (Office uses 914400 EMU per inch at 96 dpi). */
const EMU_PER_PX = 9525;
/** Height of the sticky column-letter header row, in px. */
const EXCEL_HEADER_H = 20;
/** Width of the sticky row-number gutter, in px. */
const EXCEL_GUTTER_W = 32;
/** Row height used when the sheet does not store an explicit one. */
const EXCEL_DEFAULT_ROW_H = 20;

/** Marks an Excel preview that is only an intermediate step — F&O converts it to PDF. */
function PdfOutputBadge() {
  return (
    <span
      title={t.pdfConvertedFrom('Excel')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 8px',
        borderRadius: 3,
        border: '1px solid rgba(255,255,255,0.4)',
        background: 'rgba(255,255,255,0.15)',
        color: excelColors.sheetTabText,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      📕 PDF
    </span>
  );
}

function ExcelTemplateGrid({
  workbook,
  filename,
  bindingMap,
  rootElement,
  labels,
  pdfOutput,
  onSwitchToStructure,
  onElementClick,
}: {
  workbook: XlsxWorkbook;
  filename: string;
  bindingMap: BindingMap;
  rootElement: ERFormatElement;
  labels?: ERLabel[];
  pdfOutput?: boolean;
  onSwitchToStructure: () => void;
  onElementClick?: (elementId: string) => void;
}) {
  const [activeSheet, setActiveSheet] = useState(0);
  /** Cell the pointer is over — drives the highlight of the cell and its named area. */
  const [hoveredRef, setHoveredRef] = useState<string | null>(null);
  const previewOptions = useMemo<PreviewRenderOptions>(() => ({ placeholderMode: 'sample' }), []);
  const cellBindings = useMemo(() => buildCellBindingMap(rootElement, bindingMap, labels, previewOptions), [rootElement, bindingMap, labels, previewOptions]);

  // Reverse map: cell ref (e.g. "B3") → named range (e.g. "CONTACTINFO_LABEL")
  // Needed because ExcelRange attribute stores named range names, not cell addresses.
  const cellRefToNamedRange = useMemo(() => {
    const map = new Map<string, string>();
    for (const [name, ref] of workbook.definedNames) {
      map.set(ref.toUpperCase(), name); // name is already uppercased in parser
    }
    return map;
  }, [workbook.definedNames]);

  /**
   * Every cell covered by a named range, mapped to that range. A named range
   * can span several cells, so hovering any of them highlights the whole area
   * rather than the single cell under the pointer.
   */
  const cellRefToArea = useMemo(() => {
    const map = new Map<string, { name: string; area: XlsxArea }>();
    for (const [name, area] of workbook.definedRanges ?? []) {
      const width = area.endCol - area.startCol + 1;
      const height = area.endRow - area.startRow + 1;
      // A runaway whole-column range would paint the entire sheet.
      if (width * height > 2000) continue;
      for (let row = area.startRow; row <= area.endRow; row++) {
        for (let col = area.startCol; col <= area.endCol; col++) {
          const ref = colToLetter(col) + row;
          if (!map.has(ref)) map.set(ref, { name, area });
        }
      }
    }
    return map;
  }, [workbook.definedRanges]);

  const sheet = workbook.sheets[Math.min(activeSheet, workbook.sheets.length - 1)];
  if (!sheet) return null;

  // Build grid bounds
  let maxCol = 0;
  let maxRow = 0;
  for (const row of sheet.rows) {
    if (row.index > maxRow) maxRow = row.index;
    for (const cell of row.cells) {
      if (cell.col > maxCol) maxCol = cell.col;
    }
  }
  for (const merge of sheet.merges) {
    if (merge.endCol > maxCol) maxCol = merge.endCol;
    if (merge.endRow > maxRow) maxRow = merge.endRow;
  }
  // A logo or a floating title may sit past the last filled cell (F&O anchors
  // the report header in the drawing layer), so the grid has to reach it or the
  // overlay would be clipped away.
  for (const drawing of [...sheet.images, ...sheet.textShapes]) {
    const endCol = (drawing.to?.col ?? drawing.from.col) + 1;
    const endRow = (drawing.to?.row ?? drawing.from.row) + 1;
    if (endCol > maxCol) maxCol = endCol;
    if (endRow > maxRow) maxRow = endRow;
  }
  // Limit to reasonable viewport
  maxCol = Math.min(maxCol, 30);
  maxRow = Math.min(maxRow, 200);

  // Build cell lookup: "A1" → cell
  const cellMap = new Map<string, XlsxCellType>();
  for (const row of sheet.rows) {
    for (const cell of row.cells) {
      cellMap.set(cell.ref, cell);
    }
  }

  // Build merge lookup: "A1" → merge (for top-left cell)
  const mergeMap = new Map<string, XlsxMerge>();
  const mergedCells = new Set<string>(); // cells that are part of a merge but not the anchor
  for (const m of sheet.merges) {
    const anchorRef = colToLetter(m.startCol) + m.startRow;
    mergeMap.set(anchorRef, m);
    for (let r = m.startRow; r <= m.endRow; r++) {
      for (let c = m.startCol; c <= m.endCol; c++) {
        const ref = colToLetter(c) + r;
        if (ref !== anchorRef) mergedCells.add(ref);
      }
    }
  }

  // Column widths in pixels (approx 8px per character width unit)
  const colWidth = (col: number) => {
    const w = sheet.colWidths.get(col);
    return w ? Math.max(30, Math.round(w * 8)) : 64;
  };

  // Row heights in pixels. The drawing layer is positioned against the same
  // geometry, so an approximated row height would push the logo off its band.
  const rowHeights = new Map<number, number>();
  for (const row of sheet.rows) {
    if (row.height != null && row.height > 0) {
      rowHeights.set(row.index, Math.max(6, Math.round(row.height * (96 / 72))));
    }
  }
  const rowHeight = (row: number) => rowHeights.get(row) ?? EXCEL_DEFAULT_ROW_H;

  /** Left edge of a 1-based column, relative to the top-left of the table. */
  const colX = (col: number) => {
    let x = EXCEL_GUTTER_W;
    for (let c = 1; c < col; c++) x += colWidth(c);
    return x;
  };
  /** Top edge of a 1-based row, relative to the top-left of the table. */
  const rowY = (row: number) => {
    let y = EXCEL_HEADER_H;
    for (let r = 1; r < row; r++) y += rowHeight(r);
    return y;
  };
  /** Anchor (0-based col/row + EMU offsets) → pixel position on the grid. */
  const anchorToPx = (a: XlsxAnchorPoint) => ({
    x: colX(a.col + 1) + a.colOff / EMU_PER_PX,
    y: rowY(a.row + 1) + a.rowOff / EMU_PER_PX,
  });
  const drawingBox = (d: XlsxDrawing) => {
    const start = anchorToPx(d.from);
    if (d.to) {
      const end = anchorToPx(d.to);
      return { left: start.x, top: start.y, width: Math.max(1, end.x - start.x), height: Math.max(1, end.y - start.y) };
    }
    return {
      left: start.x,
      top: start.y,
      width: Math.max(1, (d.ext?.cx ?? 0) / EMU_PER_PX),
      height: Math.max(1, (d.ext?.cy ?? 0) / EMU_PER_PX),
    };
  };

  const gridWidth = colX(maxCol + 1);
  const gridHeight = rowY(maxRow + 1);
  const drawings = [...sheet.images, ...sheet.textShapes];

  const totalCells = sheet.rows.reduce((s, r) => s + r.cells.length, 0);

  // Hover highlight: a named area wins over the single cell, because that is
  // the unit an ER binding actually writes into.
  const hovered = hoveredRef ? cellRefToArea.get(hoveredRef) : undefined;
  const hoveredCell = hoveredRef ? refToCoords(hoveredRef) : null;
  const highlightArea: XlsxArea | null = hovered
    ? hovered.area
    : hoveredCell
      ? { startCol: hoveredCell.col, startRow: hoveredCell.row, endCol: hoveredCell.col, endRow: hoveredCell.row }
      : null;
  /** True when the cell (or the merge it anchors) overlaps the highlighted area. */
  const isHighlighted = (col: number, row: number, colSpan: number, rowSpan: number): boolean => (
    !!highlightArea
    && col <= highlightArea.endCol && col + colSpan - 1 >= highlightArea.startCol
    && row <= highlightArea.endRow && row + rowSpan - 1 >= highlightArea.startRow
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: excelColors.sheetTab,
        color: excelColors.sheetTabText,
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 14 }}>📄</span>
        <span>{t.excelTemplateView}: {filename}</span>
        {pdfOutput && <PdfOutputBadge />}
        <button
          onClick={onSwitchToStructure}
          style={{
            marginLeft: 8,
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.4)',
            borderRadius: 3,
            background: 'rgba(255,255,255,0.15)',
            color: excelColors.sheetTabText,
          }}
          title={t.excelStructureView}
        >
          📊 {t.excelStructureView}
        </button>
        <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 11, opacity: 0.8 }}>
          {hoveredRef
            ? `${hovered ? `${hovered.name} · ${colToLetter(hovered.area.startCol)}${hovered.area.startRow}:${colToLetter(hovered.area.endCol)}${hovered.area.endRow}` : hoveredRef}`
            : `${t.excelTemplateCells(totalCells)}${sheet.merges.length > 0 ? `, ${t.excelTemplateMerged(sheet.merges.length)}` : ''}${sheet.images.length > 0 ? `, ${t.excelTemplateImages(sheet.images.length)}` : ''}`}
        </span>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflow: 'auto', background: excelPaper.gridBg }} onMouseLeave={() => setHoveredRef(null)}>
        <div style={{ position: 'relative', width: gridWidth, minHeight: gridHeight }}>
        <table style={{
          borderCollapse: 'collapse',
          fontSize: 11,
          fontFamily: 'Calibri, "Segoe UI", sans-serif',
          tableLayout: 'fixed',
        }}>
          {/* Column headers */}
          <thead>
            <tr style={{ height: EXCEL_HEADER_H }}>
              <th style={{
                width: EXCEL_GUTTER_W,
                minWidth: EXCEL_GUTTER_W,
                background: excelPaper.headerBg,
                borderRight: `1px solid ${excelPaper.cellBorder}`,
                borderBottom: `1px solid ${excelPaper.cellBorder}`,
                position: 'sticky',
                top: 0,
                left: 0,
                zIndex: 3,
              }} />
              {Array.from({ length: maxCol }, (_, i) => i + 1).map(col => (
                <th key={col} style={{
                  width: colWidth(col),
                  minWidth: colWidth(col),
                  padding: '2px 4px',
                  background: highlightArea && col >= highlightArea.startCol && col <= highlightArea.endCol
                    ? 'color-mix(in srgb, var(--accent) 30%, ' + excelPaper.headerBg + ')'
                    : excelPaper.headerBg,
                  color: excelPaper.headerText,
                  fontWeight: 500,
                  fontSize: 10,
                  textAlign: 'center',
                  borderRight: `1px solid ${excelPaper.cellBorder}`,
                  borderBottom: `1px solid ${excelPaper.cellBorder}`,
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                }}>
                  {colToLetter(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRow }, (_, i) => i + 1).map(row => (
              <tr key={row} style={{ height: rowHeight(row) }}>
                {/* Row header */}
                <td style={{
                  padding: '1px 4px',
                  background: highlightArea && row >= highlightArea.startRow && row <= highlightArea.endRow
                    ? 'color-mix(in srgb, var(--accent) 30%, ' + excelPaper.headerBg + ')'
                    : excelPaper.headerBg,
                  color: excelPaper.headerText,
                  fontWeight: 500,
                  fontSize: 10,
                  textAlign: 'center',
                  borderRight: `1px solid ${excelPaper.cellBorder}`,
                  borderBottom: `1px solid ${excelPaper.cellBorder}`,
                  position: 'sticky',
                  left: 0,
                  zIndex: 1,
                }}>
                  {row}
                </td>
                {Array.from({ length: maxCol }, (_, i) => i + 1).map(col => {
                  const ref = colToLetter(col) + row;
                  // Skip cells that are part of a merge (not the anchor)
                  if (mergedCells.has(ref)) return null;

                  const merge = mergeMap.get(ref);
                  const colSpan = merge ? (merge.endCol - merge.startCol + 1) : 1;
                  const rowSpan = merge ? (merge.endRow - merge.startRow + 1) : 1;

                  const xlsxCell = cellMap.get(ref);
                  // Look up binding: first try direct cell ref, then via named range
                  const namedRange = cellRefToNamedRange.get(ref.toUpperCase());
                  const binding = cellBindings.get(ref.toUpperCase()) ?? (namedRange ? cellBindings.get(namedRange) : undefined);
                  const hasBinding = !!binding;
                  const hasValue = xlsxCell && xlsxCell.value !== '';
                  const cellStyle = xlsxCell?.style;

                  // Determine display value — always prefer the original Excel cell text
                  let displayValue = '';
                  if (hasValue) {
                    displayValue = xlsxCell.value;
                  } else if (hasBinding) {
                    displayValue = binding.value;
                  }

                  // Resolve fill color from Excel style (solid fills only).
                  const xlsxBg = cellStyle?.fillType === 'solid' && cellStyle.fgColor
                    ? `#${cellStyle.fgColor.slice(-6)}`
                    : undefined;
                  const borderStyle = () => `1px solid ${excelPaper.cellBorder}`;
                  const highlighted = isHighlighted(col, row, colSpan, rowSpan);

                  return (
                    <td
                      key={col}
                      colSpan={colSpan > 1 ? colSpan : undefined}
                      rowSpan={rowSpan > 1 ? rowSpan : undefined}
                      title={hasBinding
                        ? `${binding.name}${binding.label ? ` — ${binding.label}` : ''}\n${binding.value}${onElementClick ? `\n🔍 ${t.excelCellGoToStructure}` : ''}`
                        : xlsxCell?.value || undefined}
                      onClick={hasBinding && onElementClick ? () => onElementClick(binding.elementId) : undefined}
                      onMouseEnter={() => setHoveredRef(ref)}
                      style={{
                        padding: '1px 3px',
                        borderRight: borderStyle(),
                        borderBottom: borderStyle(),
                        borderTop: cellStyle?.borderTop && cellStyle.borderTop !== 'none' ? `1px solid ${excelPaper.cellBorder}` : undefined,
                        borderLeft: cellStyle?.borderLeft && cellStyle.borderLeft !== 'none' ? `1px solid ${excelPaper.cellBorder}` : undefined,
                        background: xlsxBg ?? excelPaper.cellBg,
                        color: cellStyle?.fontColor
                              ? `#${cellStyle.fontColor.slice(-6)}`
                              : excelPaper.cellText,
                        fontStyle: cellStyle?.italic ? 'italic' : undefined,
                        fontWeight: cellStyle?.bold ? 700 : undefined,
                        textDecoration: cellStyle?.underline ? 'underline' : undefined,
                        fontSize: cellStyle?.fontSize ? `${cellStyle.fontSize}pt` : undefined,
                        whiteSpace: cellStyle?.wrapText ? 'normal' : 'nowrap',
                        textAlign: cellStyle?.hAlign === 'center' ? 'center' : cellStyle?.hAlign === 'right' ? 'right' : undefined,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: merge ? undefined : colWidth(col),
                        height: rowHeight(row),
                        cursor: hasBinding && onElementClick ? 'pointer' : undefined,
                        // The whole named area lights up together, so it is obvious
                        // how far the range under the pointer reaches.
                        boxShadow: highlighted
                          ? 'inset 0 0 0 1px var(--accent), inset 0 0 0 999px color-mix(in srgb, var(--accent) 16%, transparent)'
                          : undefined,
                      }}
                    >
                      {displayValue}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Drawing layer — logos and floating text boxes sit above the cells.
            F&O report templates keep the company logo and the report title
            here, so without this overlay the header band renders empty. */}
        {drawings.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {sheet.images.map(img => {
              const box = drawingBox(img);
              return (
                <img
                  key={`img-${img.id}`}
                  src={img.dataUrl}
                  alt={img.name || t.excelTemplateImage}
                  title={img.name || t.excelTemplateImage}
                  style={{
                    position: 'absolute',
                    left: box.left,
                    top: box.top,
                    width: box.width,
                    height: box.height,
                    objectFit: 'fill',
                  }}
                />
              );
            })}
            {sheet.textShapes.map(shape => {
              const box = drawingBox(shape);
              return (
                <div
                  key={`txt-${shape.id}`}
                  title={shape.name || undefined}
                  style={{
                    position: 'absolute',
                    left: box.left,
                    top: box.top,
                    width: box.width,
                    height: box.height,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: shape.align === 'ctr' ? 'center' : shape.align === 'r' ? 'flex-end' : 'flex-start',
                    fontSize: shape.fontSize ? `${shape.fontSize}pt` : undefined,
                    fontWeight: shape.bold ? 700 : undefined,
                    color: shape.color ? `#${shape.color}` : excelPaper.cellText,
                    lineHeight: 1.1,
                    overflow: 'hidden',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {shape.text}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* Legend */}
      <div style={{
        padding: '4px 12px',
        fontSize: 10,
        color: 'var(--text-secondary)',
        borderTop: `1px solid ${excelColors.cellBorder}`,
        background: 'var(--bg-secondary)',
        display: 'flex',
        gap: 12,
        flexShrink: 0,
      }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>📄 {t.excelTemplateView} · 📊 {t.excelStructureView}</span>
      </div>

      {/* Sheet tabs */}
      {workbook.sheets.length > 1 && (
        <div style={{
          display: 'flex',
          gap: 0,
          borderTop: `2px solid ${excelColors.sheetTab}`,
          background: 'var(--bg-secondary)',
          padding: '0 8px',
          overflow: 'auto',
          flexShrink: 0,
        }}>
          {workbook.sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSheet(i)}
              style={{
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: i === activeSheet ? 700 : 400,
                cursor: 'pointer',
                border: 'none',
                borderTop: i === activeSheet ? `2px solid ${excelColors.sheetTab}` : '2px solid transparent',
                background: i === activeSheet ? excelColors.cellBg : 'transparent',
                color: i === activeSheet ? excelColors.sheetTab : 'var(--text-secondary)',
                marginTop: -2,
                transition: 'all 0.15s',
              }}
            >
              📃 {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Convert a cell reference such as "AB12" to 1-based coordinates. */
function refToCoords(ref: string): { col: number; row: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: parseInt(match[2], 10) };
}

/** Collect all unique cell addresses from a sheet to derive column letters for the header. */
function collectSheetColumns(sheet: ExcelSheetData): string[] {
  const cols = new Set<string>();
  const extractCol = (addr: string) => {
    const m = addr.match(/^([A-Z]+)\d/);
    if (m) cols.add(m[1]);
  };
  for (const c of sheet.cells) extractCol(c.excelRange);
  const walkRange = (r: ExcelRangeData) => {
    for (const c of r.cells) extractCol(c.excelRange);
    for (const child of r.children) walkRange(child);
  };
  for (const r of sheet.ranges) walkRange(r);
  if (sheet.header) for (const c of sheet.header.cells) extractCol(c.excelRange);
  if (sheet.footer) for (const c of sheet.footer.cells) extractCol(c.excelRange);
  // Sort alphabetically (A, B, C, ..., AA, AB, ...)
  return Array.from(cols).sort((a, b) => a.length - b.length || a.localeCompare(b));
}

function ExcelVisualPreview({ rootElement, direction, bindingMap, configIndex, template, onNavigateToElement, pdfOutput, tabId }: { rootElement: ERFormatElement; direction: ERDirection | undefined; bindingMap: BindingMap; configIndex: number; template?: { filename: string; base64?: string }; onNavigateToElement?: (elementId: string) => void; pdfOutput?: boolean; tabId?: string }) {
  const configurations = useAppStore(s => s.configurations);
  const labels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);
  const previewOptions = useMemo<PreviewRenderOptions>(() => ({ placeholderMode: 'sample' }), []);
  const sheets = useMemo(() => collectExcelSheets(rootElement, bindingMap, labels, previewOptions), [rootElement, bindingMap, labels, previewOptions, locale]);
  const [activeSheet, setActiveSheet] = useTabState(tabId, 'excel.sheet', 0);
  const [selectedCell, setSelectedCell] = useState<ExcelCellData | null>(null);
  // Default to template view when template is available (even filename-only — shows drop zone)
  const [viewMode, setViewMode] = useTabState<'structure' | 'template'>(tabId, 'excel.viewMode', template ? 'template' : 'structure');
  const [xlsxData, setXlsxData] = useState<XlsxWorkbook | null>(null);
  const [xlsxError, setXlsxError] = useState<string | null>(null);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [droppedBase64, setDroppedBase64] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragInvalid, setDragInvalid] = useState(false);

  const effectiveBase64 = droppedBase64 ?? template?.base64 ?? null;

  // A dropped workbook belongs to the format it was dropped on. Switching to
  // another format tab reuses this component instance, so the override has to
  // be cleared or the previous format's template leaks into the new one.
  const templateKey = `${configIndex}\u0000${template?.filename ?? ''}`;
  const templateKeyRef = useRef(templateKey);
  if (templateKeyRef.current !== templateKey) {
    templateKeyRef.current = templateKey;
    if (droppedBase64 !== null) setDroppedBase64(null);
  }

  // Parse xlsx whenever effectiveBase64 becomes available.
  // The parsed workbook is cached against the base64 it came from: without
  // that key the guard below (`xlsxData` already set) would keep showing the
  // template of the format that was open first when several Excel formats are
  // loaded and the user switches tabs.
  const parsedForRef = useRef<string | null>(null);
  // Leaving the preview while the workbook is still parsing must not set
  // state on an unmounted component (the effect itself re-runs on every
  // state change, so a per-run flag would cancel the in-flight parse).
  // StrictMode mounts, unmounts and remounts in dev, so the flag has to be
  // raised again on remount — otherwise the parse result is dropped and the
  // preview stays on "loading" forever.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (!effectiveBase64) {
      parsedForRef.current = null;
      if (xlsxData) setXlsxData(null);
      if (xlsxError) setXlsxError(null);
      return;
    }
    if (parsedForRef.current === effectiveBase64) return;
    parsedForRef.current = effectiveBase64;
    setXlsxData(null);
    setXlsxError(null);
    setXlsxLoading(true);
    parseXlsxBase64(effectiveBase64)
      .then(wb => {
        if (!mountedRef.current || parsedForRef.current !== effectiveBase64) return;
        setXlsxData(wb); setXlsxLoading(false);
      })
      .catch(err => {
        if (!mountedRef.current || parsedForRef.current !== effectiveBase64) return;
        setXlsxError(String(err)); setXlsxLoading(false);
      });
  }, [effectiveBase64, xlsxData, xlsxError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setDragInvalid(false);
    const file = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.xlsx'));
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      // data:...;base64,XXXXX → take the part after the comma
      const b64 = dataUrl.split(',')[1];
      if (b64) {
        setDroppedBase64(b64);
        setXlsxData(null);
        setXlsxError(null);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const hasXlsx = Array.from(e.dataTransfer.items).some(
      item => item.kind === 'file' && (item.type.includes('spreadsheet') || item.type === '' /* filename-only drag */),
    );
    setIsDragOver(true);
    setDragInvalid(!hasXlsx && e.dataTransfer.items.length > 0);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only fire when leaving the outermost element
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as HTMLElement | null)) {
      setIsDragOver(false);
      setDragInvalid(false);
    }
  }, []);

  if (sheets.length === 0) {
    return <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 12 }}>{t.excelNoSheets}</div>;
  }

  // If template mode is active and data is ready, render template view
  if (viewMode === 'template') {
    if (xlsxLoading) {
      return <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 12 }}>{t.excelTemplateLoading}</div>;
    }
    if (xlsxError) {
      return (
        <div
          style={{ padding: 24, color: 'var(--error)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
          onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
        >
          <div>{t.excelTemplateError}: {xlsxError}</div>
          <div style={{ color: 'var(--text-secondary)' }}>{t.excelTemplateDropHint}</div>
        </div>
      );
    }
    if (xlsxData) {
      return (
        <ExcelTemplateGrid
          workbook={xlsxData}
          filename={template?.filename ?? ''}
          bindingMap={bindingMap}
          rootElement={rootElement}
          labels={labels}
          pdfOutput={pdfOutput}
          onSwitchToStructure={() => setViewMode('structure')}
          onElementClick={onNavigateToElement ? (elementId) => {
            setViewMode('structure');
            onNavigateToElement(elementId);
          } : undefined}
        />
      );
    }
    // No binary yet — show drop zone
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 16,
          background: isDragOver
            ? (dragInvalid ? 'rgba(var(--error-rgb,220,38,38),0.08)' : 'rgba(var(--accent-rgb,3,131,135),0.08)')
            : 'var(--bg-secondary)',
          border: `2px dashed ${isDragOver ? (dragInvalid ? 'var(--error,#dc2626)' : 'var(--focus-border,#038387)') : 'var(--border-color,#444)'}`,
          borderRadius: 8,
          margin: 16,
          transition: 'background 0.15s, border-color 0.15s',
          cursor: 'default',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 40 }}>{isDragOver ? (dragInvalid ? '🚫' : '📂') : '📄'}</span>
        <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
          {isDragOver
            ? (dragInvalid ? t.excelTemplateDropInvalid : t.excelTemplateDropActive)
            : t.excelTemplateLoadBtn}
        </div>
        {template?.filename && !isDragOver && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono,monospace)' }}>
            {template.filename}
          </div>
        )}
        {!isDragOver && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 320 }}>
            {t.excelTemplateDropHint}
          </div>
        )}
        <label style={{
          marginTop: 4,
          padding: '6px 14px',
          fontSize: 12,
          border: '1px solid var(--border-color,#444)',
          borderRadius: 4,
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          background: 'var(--bg-primary)',
        }}>
          {t.excelTemplateLoadBtn}
          <input
            type="file"
            accept=".xlsx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                const b64 = (ev.target?.result as string)?.split(',')[1];
                if (b64) { setDroppedBase64(b64); setXlsxData(null); setXlsxError(null); }
              };
              reader.readAsDataURL(file);
              e.target.value = '';
            }}
          />
        </label>
        <button
          onClick={() => setViewMode('structure')}
          style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          {t.excelStructureView}
        </button>
      </div>
    );
  }

  const sheet = sheets[Math.min(activeSheet, sheets.length - 1)];
  const columns = collectSheetColumns(sheet);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-secondary)' }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drag overlay (structure view) */}
      {isDragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: dragInvalid ? 'rgba(220,38,38,0.12)' : 'rgba(3,131,135,0.12)',
          border: `3px dashed ${dragInvalid ? '#dc2626' : '#038387'}`,
          pointerEvents: 'none',
          borderRadius: 4,
        }}>
          <span style={{ fontSize: 14, background: 'var(--bg-primary)', padding: '8px 16px', borderRadius: 6, fontWeight: 600, color: dragInvalid ? '#dc2626' : '#038387' }}>
            {dragInvalid ? t.excelTemplateDropInvalid : t.excelTemplateDropActive}
          </span>
        </div>
      )}
      {/* Ribbon-like toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: excelColors.sheetTab,
        color: excelColors.sheetTabText,
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 14 }}>📊</span>
        <span>{direction === ERDirection.Import ? t.excelInput : t.excelOutput} {t.excelWorkbook}</span>
        {pdfOutput && <PdfOutputBadge />}
        {template && (
          <div style={{ display: 'flex', marginLeft: 8, border: '1px solid rgba(255,255,255,0.4)', borderRadius: 3, overflow: 'hidden' }}>
            <button
              onClick={() => setViewMode('structure')}
              style={{
                padding: '2px 10px',
                fontSize: 11,
                cursor: 'pointer',
                border: 'none',
                background: 'rgba(255,255,255,0.3)',
                color: excelColors.sheetTabText,
                fontWeight: 700,
              }}
            >
              📊 {t.excelStructureView}
            </button>
            <button
              onClick={() => setViewMode('template')}
              style={{
                padding: '2px 10px',
                fontSize: 11,
                cursor: 'pointer',
                border: 'none',
                borderLeft: '1px solid rgba(255,255,255,0.3)',
                background: 'transparent',
                color: excelColors.sheetTabText,
                fontWeight: 400,
              }}
            >
              📄 {effectiveBase64 ? t.excelTemplateView : t.excelTemplateLoadBtn}
            </button>
          </div>
        )}
        <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 11, opacity: 0.8 }}>
          {sheet ? `${t.excelRangeCount(sheet.ranges.length)}, ${t.excelCellCount(sheet.cells.length + sheet.ranges.reduce((sum, r) => sum + r.cells.length, 0))}` : ''}
        </span>
      </div>

      {/* Name Box + Formula Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        borderBottom: `1px solid ${excelPaper.cellBorder}`,
        background: excelPaper.cellBg,
        flexShrink: 0,
      }}>
        <div style={{
          width: 120,
          padding: '4px 8px',
          fontSize: 11,
          fontWeight: 600,
          borderRight: `1px solid ${excelPaper.cellBorder}`,
          fontFamily: 'var(--font-mono, monospace)',
          color: excelPaper.cellText,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {selectedCell?.excelRange ?? ''}
        </div>
        <div style={{
          padding: '4px 6px',
          fontSize: 11,
          color: excelPaper.mutedText,
          borderRight: `1px solid ${excelPaper.cellBorder}`,
          fontStyle: 'italic',
        }}>
          <i>fx</i>
        </div>
        <div style={{
          flex: 1,
          padding: '4px 8px',
          fontSize: 11,
          fontFamily: 'var(--font-mono, monospace)',
          color: excelPaper.cellText,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {selectedCell ? (() => {
            const parts: string[] = [];
            if (selectedCell.name !== selectedCell.excelRange) parts.push(selectedCell.name);
            if (selectedCell.label) parts.push(selectedCell.label);
            parts.push(selectedCell.value);
            return parts.join(': ');
          })() : ''}
        </div>
      </div>

      {/* Column headers */}
      {columns.length > 0 && (
        <div style={{
          display: 'flex',
          borderBottom: `1px solid ${excelPaper.cellBorder}`,
          background: excelPaper.headerBg,
          flexShrink: 0,
          paddingLeft: 32,
        }}>
          {columns.map(col => (
            <div key={col} style={{
              minWidth: 80,
              flex: 1,
              maxWidth: 220,
              padding: '2px 8px',
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 600,
              color: excelPaper.headerText,
              borderRight: `1px solid ${excelPaper.cellBorder}`,
              userSelect: 'none',
            }}>
              {col}
            </div>
          ))}
        </div>
      )}

      {/* Spreadsheet area */}
      <div style={{ flex: 1, overflow: 'auto', padding: 0, background: excelPaper.gridBg }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          border: `1px solid ${excelPaper.cellBorder}`,
          overflow: 'hidden',
          background: excelPaper.cellBg,
          minHeight: '100%',
        }}>
          {/* Header section */}
          {sheet.header && sheet.header.cells.length > 0 && (
            <ExcelSectionBlock section={sheet.header} onCellClick={setSelectedCell} />
          )}

          {/* Loose cells at sheet level */}
          {sheet.cells.length > 0 && (
            <div style={{ borderBottom: `1px solid ${excelPaper.cellBorder}` }}>
              <ExcelCellGrid cells={sheet.cells} onCellClick={setSelectedCell} selectedCell={selectedCell} />
            </div>
          )}

          {/* Ranges */}
          {sheet.ranges.map((range, i) => (
            <ExcelRangeBlock key={i} range={range} depth={0} onCellClick={setSelectedCell} selectedCell={selectedCell} />
          ))}

          {/* Footer section */}
          {sheet.footer && sheet.footer.cells.length > 0 && (
            <ExcelSectionBlock section={sheet.footer} onCellClick={setSelectedCell} />
          )}

          {/* Empty state */}
          {sheet.cells.length === 0 && sheet.ranges.length === 0 && !sheet.header && !sheet.footer && (
            <div style={{ padding: 24, textAlign: 'center', color: excelPaper.mutedText, fontSize: 12 }}>{t.excelEmptySheet}</div>
          )}
        </div>
      </div>

      {/* Legend — sits on the paper so its colour samples match the grid */}
      <div style={{
        padding: '4px 12px',
        fontSize: 10,
        color: excelPaper.mutedText,
        borderTop: `1px solid ${excelPaper.cellBorder}`,
        background: excelPaper.headerBg,
        display: 'flex',
        gap: 12,
        flexShrink: 0,
      }}>
        <span><span style={{ color: excelPaper.dynamicText, fontStyle: 'italic' }}>Sample(…)</span> = {t.excelLegendDynamic}</span>
        <span><span style={{ fontWeight: 600 }}>{t.excelLegendConstantWord}</span> = {t.excelLegendConstant}</span>
      </div>

      {/* Sheet tabs at bottom */}
      {sheets.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 0,
          borderTop: `2px solid ${excelColors.sheetTab}`,
          background: 'var(--bg-secondary)',
          padding: '0 8px',
          overflow: 'auto',
          flexShrink: 0,
        }}>
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => { setActiveSheet(i); setSelectedCell(null); }}
              style={{
                padding: '6px 16px',
                fontSize: 12,
                fontWeight: i === activeSheet ? 700 : 400,
                cursor: 'pointer',
                border: 'none',
                borderTop: i === activeSheet ? `2px solid ${excelColors.sheetTab}` : '2px solid transparent',
                background: i === activeSheet ? excelColors.cellBg : 'transparent',
                color: i === activeSheet ? excelColors.sheetTab : 'var(--text-secondary)',
                marginTop: -2,
                transition: 'all 0.15s',
              }}
            >
              📃 {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExcelSectionBlock({ section, onCellClick }: { section: ExcelSectionData; onCellClick?: (cell: ExcelCellData) => void }) {
  const isHeader = section.type === 'header';
  return (
    <div style={{
      background: excelPaper.sectionBg,
      borderLeft: `3px solid ${isHeader ? `${excelColors.rangeBorder}66` : excelPaper.cellBorder}`,
      borderBottom: `1px solid ${excelPaper.cellBorder}`,
    }}>
      <div style={{
        padding: '4px 12px',
        fontSize: 11,
        fontWeight: 600,
        color: excelPaper.mutedText,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        {isHeader ? '🔼' : '🔽'} {isHeader ? t.excelHeader : t.excelFooter}
      </div>
      <ExcelCellGrid cells={section.cells} onCellClick={onCellClick} />
    </div>
  );
}

function ExcelRangeBlock({ range, depth, onCellClick, selectedCell }: { range: ExcelRangeData; depth: number; onCellClick?: (cell: ExcelCellData) => void; selectedCell?: ExcelCellData | null }) {
  const repIcon = range.replicationDirection === 'vertical' ? '↕' : range.replicationDirection === 'horizontal' ? '↔' : '';
  return (
    <div style={{
      borderBottom: `1px solid ${excelPaper.cellBorder}`,
      marginLeft: depth * 8,
      borderLeft: depth > 0 ? `2px solid ${excelColors.rangeBorder}44` : undefined,
    }}>
      {/* Range header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        background: excelPaper.rangeBg,
        borderBottom: `1px solid ${excelPaper.cellBorder}`,
      }}>
        <span style={{ fontSize: 13 }}>📐</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: excelPaper.cellText }}>{range.excelRange}</span>
        {range.name !== range.excelRange && (
          <span style={{ fontSize: 11, color: excelPaper.mutedText }}>({range.name})</span>
        )}
        {repIcon && (
          <span style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 3,
            border: `1px solid ${excelColors.rangeBorder}66`,
            color: excelPaper.cellText,
            fontWeight: 600,
          }}>
            {repIcon} {range.replicationDirection === 'vertical' ? t.excelRepeatingVertical : t.excelRepeatingHorizontal}
          </span>
        )}
      </div>

      {/* Cells in this range */}
      {range.cells.length > 0 && (
        <ExcelCellGrid cells={range.cells} onCellClick={onCellClick} selectedCell={selectedCell} />
      )}

      {/* Nested ranges */}
      {range.children.map((child, i) => (
        <ExcelRangeBlock key={i} range={child} depth={depth + 1} onCellClick={onCellClick} selectedCell={selectedCell} />
      ))}
    </div>
  );
}

function ExcelCellGrid({ cells, onCellClick, selectedCell }: { cells: ExcelCellData[]; onCellClick?: (cell: ExcelCellData) => void; selectedCell?: ExcelCellData | null }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: 0,
    }}>
      {cells.map((cell, i) => {
        // Values rendered as Sample(...) stand in for data-bound cells; anything
        // else is a constant derived from the binding expression.
        const isDynamic = isSamplePlaceholder(cell.value);
        const hasDistinctAddress = cell.excelRange && cell.excelRange !== cell.name;
        const isSelected = selectedCell?.excelRange === cell.excelRange && selectedCell?.name === cell.name;
        const isHovered = hoveredIndex === i;
        return (
          <div
            key={i}
            onClick={() => onCellClick?.(cell)}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(prev => (prev === i ? null : prev))}
            style={{
            padding: '6px 12px',
            borderRight: `1px solid ${excelPaper.cellBorder}`,
            borderBottom: `1px solid ${excelPaper.cellBorder}`,
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 0,
            cursor: 'pointer',
            outline: isSelected
              ? `2px solid ${excelColors.rangeBorder}`
              : isHovered ? `2px solid ${excelColors.rangeBorder}80` : undefined,
            outlineOffset: -2,
            background: isSelected
              ? `${excelColors.rangeBorder}0a`
              : isHovered ? `${excelColors.rangeBorder}12` : undefined,
            transition: 'outline 0.1s, background 0.1s',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              minWidth: 0,
            }}>
              <span style={{
                fontSize: 10,
                color: excelPaper.mutedText,
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {cell.excelRange}
              </span>
              {hasDistinctAddress && (
                <span style={{
                  fontSize: 11,
                  color: excelPaper.cellText,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }} title={cell.name}>
                  {cell.name}
                </span>
              )}
            </div>
            {cell.label && (
              <span style={{
                fontSize: 10,
                color: excelPaper.mutedText,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontStyle: 'italic',
              }} title={cell.label}>
                {cell.label}
              </span>
            )}
            <span style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 11,
              color: isDynamic ? excelPaper.dynamicText : excelPaper.cellText,
              fontStyle: isDynamic ? 'italic' : undefined,
              fontWeight: isDynamic ? 400 : 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }} title={cell.value}>
              {cell.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightXmlTag(tag: string): string {
  const punctColor = 'var(--text-secondary)';
  const tagColor = 'var(--accent)';
  const attrColor = 'var(--surface-warning-fg)';
  const valueColor = 'var(--surface-success-fg)';

  const escapedTag = escapeHtml(tag);
  const openMatch = tag.match(/^<\/?([A-Za-z_][A-Za-z0-9_.:-]*)/);
  const closeMatch = tag.match(/^<\/?([A-Za-z_][A-Za-z0-9_.:-]*)\s*>$/);
  const tagName = openMatch?.[1] ?? closeMatch?.[1] ?? null;

  let result = escapedTag
    .replace(/(&lt;\/?|\/?&gt;|\?&gt;|&lt;\?)/g, `<span style="color:${punctColor}">$1</span>`);

  if (tagName) {
    const escapedName = escapeHtml(tagName);
    result = result.replace(escapedName, `<span style="color:${tagColor};font-weight:600">${escapedName}</span>`);
  }

  result = result.replace(
    /([A-Za-z_][A-Za-z0-9_.:-]*)(\s*=\s*)(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g,
    `<span style="color:${attrColor}">$1</span>$2<span style="color:${valueColor}">$3</span>`,
  );

  return result;
}

function renderXmlHighlightedMarkup(xml: string): string {
  const parts: string[] = [];
  const tagRegex = /<[^>]+>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xml)) !== null) {
    const textBefore = xml.slice(lastIndex, match.index);
    if (textBefore) parts.push(escapeHtml(textBefore));
    parts.push(highlightXmlTag(match[0]));
    lastIndex = match.index + match[0].length;
  }

  const tail = xml.slice(lastIndex);
  if (tail) parts.push(escapeHtml(tail));
  return parts.join('');
}

type DelimitedPreviewData = {
  delimiter: string;
  rows: string[][];
  columnCount: number;
};

function parseDelimitedPreview(text: string): DelimitedPreviewData | null {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  const candidates = [';', ',', '\t'];
  const scored = candidates.map(delimiter => ({
    delimiter,
    score: lines.slice(0, 12).reduce((sum, line) => sum + Math.max(0, line.split(delimiter).length - 1), 0),
  }));

  const best = scored.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score <= 0) return null;

  const rows = lines.map(line => line.split(best.delimiter).map(cell => cell.trim()));
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columnCount < 2) return null;

  return { delimiter: best.delimiter, rows, columnCount };
}

function FormatPreview({ rootElement, direction, bindingMap, configIndex, onNavigateToElement, tabId }: { rootElement: ERFormatElement; direction: ERDirection | undefined; bindingMap: BindingMap; configIndex: number; onNavigateToElement?: (elementId: string) => void; tabId?: string }) {
  const isPdf = rootElement?.elementType === 'PDFFile';
  const previewRoot = unwrapConverterRoot(rootElement);
  const info = detectFormatType(previewRoot);
  const template = useAppStore(s => {
    const cfg = s.configurations[configIndex];
    if (!cfg || cfg.content.kind !== 'Format') return undefined;
    return (cfg.content as ERFormatContent).formatVersion.format.template;
  });
  const [placeholderMode, setPlaceholderMode] = useState<PreviewPlaceholderMode>('sample');
  const [csvFirstRowHeader, setCsvFirstRowHeader] = useState(true);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const previewOptions = useMemo<PreviewRenderOptions>(
    () => ({ placeholderMode, showTechnicalDetails }),
    [placeholderMode, showTechnicalDetails],
  );
  const preview = useMemo(() => generateFormatPreview(previewRoot, bindingMap, previewOptions), [previewRoot, bindingMap, previewOptions]);
  const delimitedPreview = useMemo(() => parseDelimitedPreview(preview), [preview]);

  // Visual spreadsheet preview for Excel formats (including Excel wrapped in a PDF converter)
  if (info.label === 'Excel') {
    return (
      <ExcelVisualPreview
        key={`excel-${configIndex}`}
        rootElement={previewRoot}
        direction={direction}
        bindingMap={bindingMap}
        configIndex={configIndex}
        template={template}
        onNavigateToElement={onNavigateToElement}
        pdfOutput={isPdf}
        tabId={tabId}
      />
    );
  }

  if (isPdf && previewRoot === rootElement) {
    return <div style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary)' }}>📕 {t.pdfNoSourceComponent}</div>;
  }

  const showDelimitedTable = (info.label === 'Text / CSV' || info.label === 'Text') && delimitedPreview !== null;
  const tableHeaderCells = showDelimitedTable && delimitedPreview
    ? (csvFirstRowHeader
      ? (delimitedPreview.rows[0] ?? Array.from({ length: delimitedPreview.columnCount }, (_, i) => `C${i + 1}`))
      : Array.from({ length: delimitedPreview.columnCount }, (_, i) => `C${i + 1}`))
    : [];
  const tableRows = showDelimitedTable && delimitedPreview
    ? (csvFirstRowHeader ? delimitedPreview.rows.slice(1) : delimitedPreview.rows)
    : [];
  const previewBlockStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono, "Cascadia Code", Consolas, monospace)',
    fontSize: 12,
    lineHeight: 1.6,
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    color: 'var(--text-primary)',
    background: 'var(--bg-secondary)',
    padding: 16,
    borderRadius: 6,
    border: '1px solid var(--border-subtle)',
  };
  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
        {direction === ERDirection.Import ? `📥 ${t.excelInput}` : `📤 ${t.excelOutput}`} — {t.previewDescription}
      </div>
      {isPdf && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
          📕 {t.pdfConvertedFrom(info.label)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{locale === 'cs' ? 'Nevyřešené hodnoty:' : 'Unresolved values:'}</span>
        <button
          type="button"
          onClick={() => setPlaceholderMode('sample')}
          style={{
            border: placeholderMode === 'sample' ? '1px solid var(--accent)' : '1px solid var(--border-color)',
            background: placeholderMode === 'sample' ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {locale === 'cs' ? 'Vzorová data' : 'Sample data'}
        </button>
        <button
          type="button"
          onClick={() => setPlaceholderMode('braces')}
          style={{
            border: placeholderMode === 'braces' ? '1px solid var(--accent)' : '1px solid var(--border-color)',
            background: placeholderMode === 'braces' ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {locale === 'cs' ? 'Ponechat {placeholder}' : 'Keep {placeholder}'}
        </button>
        <button
          type="button"
          onClick={() => setPlaceholderMode('omit')}
          style={{
            border: placeholderMode === 'omit' ? '1px solid var(--accent)' : '1px solid var(--border-color)',
            background: placeholderMode === 'omit' ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {locale === 'cs' ? 'Skrýt nevyřešené' : 'Hide unresolved'}
        </button>
      </div>
      {showDelimitedTable && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{locale === 'cs' ? 'CSV zobrazení:' : 'CSV view:'}</span>
          <button
            type="button"
            onClick={() => setCsvFirstRowHeader(v => !v)}
            style={{
              border: csvFirstRowHeader ? '1px solid var(--accent)' : '1px solid var(--border-color)',
              background: csvFirstRowHeader ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            {locale === 'cs' ? 'První řádek = hlavička' : 'First row = header'}
          </button>
        </div>
      )}
      {info.label === 'XML' ? (
        <pre
          style={previewBlockStyle}
          dangerouslySetInnerHTML={{ __html: renderXmlHighlightedMarkup(preview) }}
        />
      ) : showDelimitedTable && delimitedPreview ? (
        <div style={{ ...previewBlockStyle, overflow: 'auto', padding: 0 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', width: 56, padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: 11 }}>#</th>
                {Array.from({ length: delimitedPreview.columnCount }, (_, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {(tableHeaderCells[i] ?? `C${i + 1}`) || `C${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td style={{ textAlign: 'right', padding: '5px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: 11 }}>{rowIndex + (csvFirstRowHeader ? 2 : 1)}</td>
                  {Array.from({ length: delimitedPreview.columnCount }, (_, colIndex) => (
                    <td
                      key={colIndex}
                      style={{
                        padding: '5px 8px',
                        borderBottom: '1px solid var(--border-subtle)',
                        borderLeft: colIndex === 0 ? '1px solid var(--border-subtle)' : undefined,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        verticalAlign: 'top',
                      }}
                      title={row[colIndex] ?? ''}
                    >
                      {row[colIndex] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre style={previewBlockStyle}>{preview}</pre>
      )}
    </div>
  );
}

/** Build a file preview from the ER Format element tree using binding expressions. */
function generateFormatPreview(rootElement: ERFormatElement, bm: BindingMap, options: PreviewRenderOptions): string {
  const root = unwrapConverterRoot(rootElement);
  const info = detectFormatType(root);
  if (info.label === 'XML') return generateXmlPreview(root, 0, bm, options);
  if (info.label === 'Text / CSV' || info.label === 'Text') return generateTextPreview(root, bm, options);
  if (info.label === 'Excel') return generateExcelPreview(root, bm, options);
  // Fallback: generic tree-like view
  return generateGenericPreview(root, 0, bm, options);
}

function generateXmlPreview(el: ERFormatElement, depth: number, bm: BindingMap, options: PreviewRenderOptions): string {
  const indent = '  '.repeat(depth);
  const name = el.name || el.elementType;

  if (el.elementType === 'File') {
    const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const body = el.children.map(c => generateXmlPreview(c, 0, bm, options)).join('\n').trim();
    return body ? `${header}${body}` : header;
  }

  if (el.elementType === 'XMLAttribute') {
    return ''; // Attributes are rendered inline on the parent element
  }

  if (el.elementType === 'XMLSequence') {
    const inner = el.children.map(c => generateXmlPreview(c, depth, bm, options)).join('');
    if (!inner.trim() && options.placeholderMode === 'omit') return '';
    return inner;
  }

  if (el.elementType === 'XMLElement') {
    const attrs = el.children
      .filter(c => c.elementType === 'XMLAttribute')
      .map(a => ({ name: a.name, value: previewValue(a, bm, options) }))
      .filter(a => a.value !== '')
      .map(a => ` ${a.name}="${a.value}"`)
      .join('');
    const nonAttrChildren = el.children.filter(c => c.elementType !== 'XMLAttribute');

    if (nonAttrChildren.length === 0) {
      const val = previewValue(el, bm, options);
      if (!attrs && !val && options.placeholderMode === 'omit') return '';
      if (attrs) return `${indent}<${name}${attrs}>${val}</${name}>\n`;
      return `${indent}<${name}>${val}</${name}>\n`;
    }

    const inner = nonAttrChildren.map(c => generateXmlPreview(c, depth + 1, bm, options)).join('');
    if (!attrs && !inner.trim() && options.placeholderMode === 'omit') return '';
    return `${indent}<${name}${attrs}>\n${inner}${indent}</${name}>\n`;
  }

  // String/Numeric/DateTime etc. inside XML — render as text content
  if (['String', 'Numeric', 'DateTime', 'Base64'].includes(el.elementType)) {
    const value = previewValue(el, bm, options);
    if (!value && options.placeholderMode === 'omit') return '';
    return `${indent}${value}\n`;
  }

  // Default
  const inner = el.children.map(c => generateXmlPreview(c, depth + 1, bm, options)).join('');
  return inner;
}

function generateTextPreview(root: ERFormatElement, bm: BindingMap, options: PreviewRenderOptions): string {
  const lines: string[] = [];

  const walk = (el: ERFormatElement) => {
    if (el.elementType === 'TextLine' || el.elementType === 'String') {
      const children = el.children ?? [];
      if (children.length > 0) {
        const fields = children.map(c => previewValue(c, bm, options));
        lines.push(fields.join(';'));
      } else {
        lines.push(previewValue(el, bm, options));
      }
    } else if (el.elementType === 'TextSequence') {
      lines.push(t.previewRepeatingStart(el.name));
      for (const child of el.children) walk(child);
      lines.push(t.previewRepeatingEnd(el.name));
    } else if (el.elementType === 'File' || el.elementType === 'XMLSequence') {
      for (const child of el.children) walk(child);
    } else if (el.children.length > 0) {
      for (const child of el.children) walk(child);
    } else {
      lines.push(previewValue(el, bm, options));
    }
  };

  walk(root);
  return lines.filter(line => line || options.placeholderMode !== 'omit').join('\n');
}

function generateExcelPreview(root: ERFormatElement, bm: BindingMap, options: PreviewRenderOptions): string {
  const lines: string[] = [];
  const walk = (el: ERFormatElement, depth: number) => {
    const indent = '  '.repeat(depth);
    if (el.elementType === 'ExcelFile') {
      lines.push(`📊 ${t.excelWorkbook}`);
      for (const child of el.children) walk(child, depth + 1);
    } else if (el.elementType === 'ExcelSheet') {
      lines.push(`${indent}📃 ${t.excelSheet}: "${el.name}"`);
      for (const child of el.children) walk(child, depth + 1);
    } else if (el.elementType === 'ExcelRange' || el.elementType === 'ExcelHeader' || el.elementType === 'ExcelFooter') {
      const sectionLabel = el.elementType === 'ExcelHeader' ? `🔼 ${t.excelHeader}` : el.elementType === 'ExcelFooter' ? `🔽 ${t.excelFooter}` : `📐 ${t.excelRange}`;
      lines.push(`${indent}${sectionLabel}: ${el.name}`);
      for (const child of el.children) walk(child, depth + 1);
    } else if (el.elementType === 'ExcelCell') {
      lines.push(`${indent}📎 ${t.excelCell}: ${el.name} = ${previewValue(el, bm, options)}`);
    } else {
      lines.push(`${indent}${formatTypeLabelFor(el.elementType, options.showTechnicalDetails)}: ${el.name}`);
      for (const child of el.children) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return lines.join('\n');
}

function generateGenericPreview(el: ERFormatElement, depth: number, bm: BindingMap, options: PreviewRenderOptions): string {
  const indent = '  '.repeat(depth);
  const label = `${formatTypeLabelFor(el.elementType, options.showTechnicalDetails)}: ${el.name}`;
  const pv = previewValue(el, bm, options);
  const val = pv !== `{${el.name}}` ? ` = ${pv}` : '';
  const line = `${indent}${label}${val}\n`;
  return line + el.children.map(c => generateGenericPreview(c, depth + 1, bm, options)).join('');
}

// ── Format type detection ──

interface FormatTypeInfo {
  label: string;
  icon: string;
  color: string;
  bg: string;
}

/** The PDF converter component only wraps the component that actually produces the
 *  document (usually an Excel template). Preview/structure logic must look through it. */
function unwrapConverterRoot(rootElement: ERFormatElement): ERFormatElement {
  if (rootElement?.elementType !== 'PDFFile') return rootElement;
  const inner = rootElement.children?.find(c => c.elementType !== 'Unknown');
  return inner ?? rootElement;
}

function detectFormatType(rootElement: any): FormatTypeInfo {
  const et = rootElement?.elementType ?? '';
  if (et === 'ExcelFile') return { label: 'Excel', icon: '📊', color: 'var(--surface-success-fg)', bg: 'var(--surface-success-bg)' };
  if (et === 'WordFile')  return { label: 'Word',  icon: '📝', color: 'var(--surface-info-fg)', bg: 'var(--surface-info-bg)' };
  if (et === 'PDFFile')   return { label: 'PDF',   icon: '📕', color: 'var(--surface-danger-fg)', bg: 'var(--surface-danger-bg)' };
  if (et === 'File' || et === 'XMLElement') {
    // Look at children to determine sub-type
    const children: any[] = rootElement?.children ?? [];
    const childTypes = new Set(children.map((c: any) => c.elementType));
    if (childTypes.has('XMLElement') || et === 'XMLElement') {
      return { label: 'XML', icon: '🏷️', color: 'var(--surface-info-fg)', bg: 'var(--surface-info-bg)' };
    }
    if (childTypes.has('TextSequence') || childTypes.has('TextLine')) {
      return { label: 'Text / CSV', icon: '📃', color: 'var(--surface-success-fg)', bg: 'var(--surface-success-bg)' };
    }
  }
  if (et === 'TextSequence' || et === 'TextLine') {
    return { label: 'Text', icon: '📃', color: 'var(--surface-success-fg)', bg: 'var(--surface-success-bg)' };
  }
  return { label: et || t.formatTypeFile, icon: '📁', color: 'var(--surface-success-fg)', bg: 'var(--surface-success-bg)' };
}

function FormatTypeBadge({ rootElement }: { rootElement: any }) {
  const info = detectFormatType(rootElement);
  const inner = unwrapConverterRoot(rootElement);
  const sourceLabel = inner !== rootElement ? detectFormatType(inner).label : null;
  return (
    <span
      title={sourceLabel ? t.pdfConvertedFrom(sourceLabel) : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 4,
        background: info.bg,
        color: info.color,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: 0.5,
        flexShrink: 0,
        border: `1px solid ${info.color}44`,
      }}
    >
      <span>{info.icon}</span>
      <span>{info.label}</span>
      {sourceLabel && <span style={{ fontWeight: 500, opacity: 0.8 }}>← {sourceLabel}</span>}
    </span>
  );
}

function getFormatTypeColor(type: string): string {
  return getFormatTypeThemeColor(type);
}

const formatTypeIcons: Record<string, string> = {
  File: '📁',
  XMLElement: '🏷️',
  XMLAttribute: '@',
  XMLSequence: '🔁',
  String: '📝',
  Numeric: '🔢',
  DateTime: '📅',
  Base64: '💾',
  ExcelFile: '📊',
  ExcelSheet: '📃',
  ExcelRange: '📐',
  ExcelCell: '📎',
  ExcelHeader: '🔼',
  ExcelFooter: '🔽',
  TextSequence: '📑',
  TextLine: '📝',
  WordFile: '📄',
  PDFFile: '📕',
};

// ── Recursive Format Element Tree ──

/**
 * `FormatTreeIndex` precomputes the answers every row used to derive by walking
 * its own subtree — which made rendering O(n²) on every keystroke. Built by
 * `buildFormatTreeIndex` in utils/format-tree-filter.
 */

interface FormatElementTreeProps {
  element: any;
  depth: number;
  bindingMap: Map<string, any[]>;
  transformationMap: Map<string, any>;
  configIndex: number;
  filter: string;
  showAll?: boolean;
  expandMode: 'all' | 'none';
  expandVersion: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  showTechnicalDetails: boolean;
  bindingFilter?: 'all' | 'bound' | 'unbound';
  treeIndex: FormatTreeIndex;
  /** Ancestors of the selected element — those rows auto-expand. */
  selectedAncestors: Set<string>;
  /** Shows the element's node in the explorer — offered in each row's ⋮ menu. */
  onReveal?: (elementId: string) => void;
}

/**
 * A designer row's ⋮ menu. Selecting a row in a designer leaves the explorer
 * alone; this is where the user asks it to follow.
 */
function RevealInExplorerMenu({ onReveal, onClosed }: { onReveal: () => void; onClosed?: () => void }) {
  return (
    <Menu onOpenChange={(_, data) => { if (!data.open) onClosed?.(); }}>
      <MenuTrigger disableButtonEnhancement>
        <button
          type="button"
          className="fmt-row-actions"
          title={t.explorerMoreActions}
          aria-label={t.explorerMoreActions}
          onClick={event => event.stopPropagation()}
        >
          <MoreVerticalRegular fontSize={14} />
        </button>
      </MenuTrigger>
      {/* The popover is portalled, but React still bubbles its clicks to the
          row, whose onClick would re-select (and re-mute) it right after the
          reveal. */}
      <MenuPopover onClick={event => event.stopPropagation()}>
        <MenuList>
          <MenuItem icon={<AppsListDetailRegular />} onClick={onReveal}>
            {t.propRevealInExplorer}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/**
 * Arrow keys work wherever focus sits in the structure tree — on an expression
 * in the binding card under the selected row, or on the list's empty space —
 * by handing the key to the selected row, which owns its expanded state. The
 * forwarded event targets the row itself, so it stops there on the way back up.
 */
function forwardArrowKeyToSelectedRow(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!isTreeArrowKey(event.key) || event.defaultPrevented) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLElement;
  // React bubbles keys from portals (a row's ⋮ menu) up to here too; those
  // arrows belong to the menu.
  if (!event.currentTarget.contains(target)) return;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const row = event.currentTarget.querySelector<HTMLElement>('.fmt-element-row.selected')
    ?? event.currentTarget.querySelector<HTMLElement>('.fmt-element-row');
  if (!row || row === target) return;
  row.focus({ preventScroll: true });
  const forwarded = new KeyboardEvent('keydown', { key: event.key, bubbles: true, cancelable: true });
  row.dispatchEvent(forwarded);
  if (forwarded.defaultPrevented) event.preventDefault();
}

function FormatElementTree({ element, depth, bindingMap, transformationMap, configIndex, filter, showAll, expandMode, expandVersion, selectedId, onSelect, showTechnicalDetails, bindingFilter, treeIndex, selectedAncestors, onReveal }: FormatElementTreeProps) {
  const [expanded, setExpanded] = useState(expandMode === 'all');
  const configurations = useAppStore(s => s.configurations);
  const labels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);

  useEffect(() => {
    setExpanded(expandMode === 'all');
  }, [expandMode, expandVersion]);

  const bindings = bindingMap.get(element.id) ?? [];
  const bindingCategories = useMemo(() => groupFormatBindingsByCategory(bindings), [bindings]);
  const mainBinding = bindings.find(b => b.bindingCategory === 'data');
  const conditionalBindings = bindings.filter(b => b.bindingCategory !== 'data');
  const transformation = element.transformation ? transformationMap.get(element.transformation) : null;
  const hasChildren = element.children && element.children.length > 0;

  // Resolve label for this element
  const labelRef = element.attributes?.['Label'];
  const resolvedLabel = useMemo(() => resolveLabel(labelRef, labels), [labelRef, labels, locale]);
  // An unresolved reference is only an id — worth showing in the technical view alone.
  const labelText = resolvedLabel?.localized ?? resolvedLabel?.enUs ?? (showTechnicalDetails && resolvedLabel?.id ? resolvedLabel.id : undefined);
  const excelRange = getFormatElementExcelRange(element);

  const matchesFilter = !filter || treeIndex.selfMatch.has(element.id);
  const descendantMatches = !filter || treeIndex.subtreeMatch.has(element.id);

  const isSelected = selectedId === element.id;
  const navFlash = useNavFlash(isSelected);

  // Auto-expand when the selection lives somewhere below this element.
  const selectedIsDescendant = selectedAncestors.has(element.id);

  // When a filter is active, auto-expand any node that matches or has matching descendants.
  // showAll=true means an ancestor already matched — show everything below it.
  // Also auto-expand when a descendant is the navigation target.
  /*
   * While filtering, only the path *down to* the matches is opened. A node that
   * matches itself stays collapsed: expanding its whole subtree made every
   * descendant look like a match too (search "ReferenceNumber", land on VetaA5,
   * and its children appear as if they contained the word). The chevron still
   * opens it, and everything below a match is exempt from the filter — so the
   * children are there when you want them.
   */
  const hasMatchingDescendant = useMemo(
    () => (element.children ?? []).some((child: any) => treeIndex.subtreeMatch.has(child.id)),
    [element.children, treeIndex],
  );

  // Reset the manual override whenever the filter changes, so a new query
  // starts from the same collapsed state everywhere.
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  useEffect(() => {
    setManuallyExpanded(false);
  }, [filter]);

  /*
   * A row can match through a binding the collapsed row never shows — most
   * often Visibility/Enabled — or through its element type alone. Without this
   * the row looked like a false positive: "VetaA5" with the term nowhere on it.
   */
  const matchReason = filter ? treeIndex.matchReason.get(element.id) : undefined;
  const matchedBinding = useMemo(() => {
    if (matchReason !== 'binding') return null;
    const found = treeIndex.matchedBinding.get(element.id) ?? null;
    // The data binding is already printed on the row — no need to repeat it.
    return found && found === mainBinding ? null : found;
  }, [matchReason, treeIndex, element.id, mainBinding]);

  const isExpanded = filter
    ? (hasMatchingDescendant || manuallyExpanded)
    : (expanded || selectedIsDescendant);

  const rowRef = React.useRef<HTMLDivElement>(null);

  // Scroll into view when this element becomes selected (e.g. navigate from template preview)
  useEffect(() => {
    if (isSelected && rowRef.current) {
      // Arrow keys move the selection, so focus follows it — but only when
      // focus is already in this tree, never pulled in from the explorer or
      // the search panel. A keyboard step only nudges the row into view;
      // re-centring on every ↓ made the list lurch.
      const inTree = Boolean(document.activeElement?.closest('.fmt-structure-list'));
      rowRef.current.scrollIntoView(inTree ? { block: 'nearest' } : { behavior: 'smooth', block: 'center' });
      if (inTree) rowRef.current.focus({ preventScroll: true });
    }
  }, [isSelected]);

  // A row opened because the selection sat below it stays open once the
  // selection moves up, as in the explorer — otherwise ← to the parent would
  // fold the parent shut in the same keystroke.
  useEffect(() => {
    if (selectedIsDescendant) setExpanded(true);
  }, [selectedIsDescendant]);

  if (filter && !showAll && !matchesFilter && !descendantMatches) return null;

  if (!showTechnicalDetails && isXmlNamespaceDeclaration(element)) return null;

  // Binding filter
  if (bindingFilter && bindingFilter !== 'all') {
    const hasBound = bindings.some(b => b.bindingCategory === 'data');
    if (bindingFilter === 'bound' && !hasBound) {
      // Still show if it has children (structural container) that lead to a binding.
      if (!hasChildren) return null;
      if (!treeIndex.subtreeBound.has(element.id)) return null;
    }
    if (bindingFilter === 'unbound') {
      const hasBoundUnbound = bindings.some(b => b.bindingCategory === 'data');
      if (hasBoundUnbound) return null;
    }
  }

  // Closing the ⋮ menu hands focus back to the row rather than the ⋮ button:
  // on the button, ↓ reopens the menu instead of walking the tree. Focus that
  // has already moved elsewhere — a click outside the menu — is left alone.
  const returnFocusToRow = () => requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active || active === document.body || rowRef.current?.contains(active)) {
      rowRef.current?.focus({ preventScroll: true });
    }
  });

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Modified arrows are taken: Alt+← / Alt+→ walk the navigation history.
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const action = treeArrowAction(event.key, {
      hasChildren: Boolean(hasChildren),
      expanded: isExpanded,
      // While filtering, a row that leads to a match stays open — its chevron
      // can't close it either.
      collapsible: filter ? manuallyExpanded && !hasMatchingDescendant : true,
      hasParent: treeIndex.parentOf.has(element.id),
    });
    if (!action) return;
    event.preventDefault();
    if (action === 'expand' || action === 'collapse') {
      const open = action === 'expand';
      if (filter) setManuallyExpanded(open);
      else setExpanded(open);
    } else if (action === 'parent') {
      onSelect(treeIndex.parentOf.get(element.id)!);
    } else if (action === 'previous' || action === 'next') {
      // Rendered rows in document order are exactly the visible ones.
      const row = rowRef.current;
      const rows = row ? [...(row.closest('.fmt-structure-list')?.querySelectorAll<HTMLElement>('.fmt-element-row') ?? [])] : [];
      const targetId = row ? adjacentRow(rows, row, action)?.dataset.elementId : undefined;
      if (targetId) onSelect(targetId);
    } else {
      // The first child that actually rendered: a filter, the binding filter
      // or the consultant view can hide the first one in the data.
      const firstChild = rowRef.current?.parentElement?.querySelector<HTMLElement>(':scope > div > .fmt-element-row');
      const childId = firstChild?.dataset.elementId;
      if (childId) onSelect(childId);
    }
  };

  return (
    <div>
      {/* Element Row */}
      <div
        ref={rowRef}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        // One tab stop for the whole tree: the selected row, or the root
        // before anything is selected.
        tabIndex={isSelected || (!selectedId && depth === 0) ? 0 : -1}
        data-element-id={element.id}
        className={`fmt-element-row ${isSelected ? 'selected' : ''} ${!mainBinding ? 'unbound' : ''} ${filter && matchesFilter ? 'search-match' : ''} ${navFlash ? 'nav-flash' : ''}`}
        style={{ paddingLeft: depth * 20 + 4 }}
        onClick={() => onSelect(element.id)}
        onKeyDown={handleRowKeyDown}
      >
        {/* Expand/Collapse Toggle */}
        <span
          className="fmt-toggle"
          onClick={e => {
            e.stopPropagation();
            if (!hasChildren) return;
            if (filter) setManuallyExpanded(v => !v);
            else setExpanded(!expanded);
          }}
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
        >
          <span className={`tree-chevron ${isExpanded ? 'open' : ''}`} />
        </span>

        {/* Type Icon + Badge */}
        <span className="fmt-type-icon" style={{ color: getFormatTypeColor(element.elementType) }}>
          {formatTypeIcons[element.elementType] ?? '❓'}
        </span>
        {showTechnicalDetails && (
          <span className="fmt-type-badge" style={{
            background: getFormatTypeColor(element.elementType) + '20',
            color: getFormatTypeColor(element.elementType),
          }}>
            <HighlightMatch text={element.elementType} query={filter} />
          </span>
        )}

        {/* Element Name */}
        <span className="fmt-element-name">
          <HighlightMatch text={element.name} query={filter} />
        </span>

        {/* ExcelRange address */}
        {excelRange && excelRange !== element.name && (
          <span className="fmt-meta" style={{ fontFamily: 'var(--font-mono, monospace)' }}>[{excelRange}]</span>
        )}

        {/* Resolved label */}
        {labelText && (
          <span className="fmt-meta" title={resolvedLabel?.raw ?? ''} style={{ fontStyle: 'italic' }}>
            — {labelText}
          </span>
        )}

        {/* Constant Value */}
        {element.value && (
          <span className="fmt-const-value">= "{element.value}"</span>
        )}

        {/* Max Length */}
        {showTechnicalDetails && element.maximalLength != null && (
          <span className="fmt-meta">max:{element.maximalLength}</span>
        )}

        {/* Encoding */}
        {showTechnicalDetails && element.encoding && (
          <span className="fmt-meta">[{element.encoding}]</span>
        )}

        {/* Transformation */}
        {transformation && (
          <span className="fmt-transform" title={`${t.propTransform}: ${transformation.expressionAsString}`}>
            🔄 {transformation.name}
          </span>
        )}

        {/* Conditional Bindings indicators */}
        {conditionalBindings.length > 0 && conditionalBindings.map((cb: any, i: number) => {
          const label = showTechnicalDetails ? getFormatBindingDisplayLabel(cb) : getConsultantBindingLabel(cb);
          return (
            <span key={i} className="fmt-cond-badge" title={`${label}: ${cb.expressionAsString}`}>
              {label}
            </span>
          );
        })}

        {/* Main Binding — the original formula shown inline */}
        {mainBinding && (
          <span className="fmt-binding-inline" onClick={e => e.stopPropagation()}>
            ← <ExpressionDetailLink expression={mainBinding.expressionAsString} configIndex={configIndex} highlight={filter} />
          </span>
        )}

        {/* Unbound indicator — leaf element with no data binding */}
        {!mainBinding && hasChildren === false && (
          <span className="fmt-unbound-marker">○ {t.unbound}</span>
        )}

        {/* Row actions — the explorer only follows the designer from here. */}
        {onReveal && <RevealInExplorerMenu onReveal={() => onReveal(element.id)} onClosed={returnFocusToRow} />}
      </div>

      {/* Why this row matched, when the match is not visible on the row itself. */}
      {matchedBinding && (
        <div className="fmt-match-reason" style={{ paddingLeft: depth * 20 + 30 }}>
          <span className="fmt-match-reason__prop">
            {showTechnicalDetails
              ? getFormatBindingDisplayLabel(matchedBinding)
              : getConsultantBindingLabel(matchedBinding)}
          </span>
          <ExpressionDetailLink
            expression={matchedBinding.expressionAsString}
            configIndex={configIndex}
            interactive={false}
            highlight={filter}
          />
        </div>
      )}

      {/* Expanded Binding Details — shown when element is selected */}
      {/* Only when there is something to show: an element without bindings
          would open a card that merely says so. */}
      {isSelected && bindings.length > 0 && (
        <div className="fmt-binding-expanded" style={{ marginLeft: depth * 20 + 28 }}>
          {bindingCategories.map(category => (
            <div key={category.key}>
              <div className="fmt-binding-category-title">
                {showTechnicalDetails ? getFormatBindingCategoryLabel(category.key) : getBindingCategoryLabel(category.key)} ({category.bindings.length})
              </div>
              {category.bindings.map((b: any, i: number) => (
                <div key={`${category.key}-${i}`} className="fmt-binding-detail-row">
                  <span className={`badge ${category.key === 'data' ? 'badge-success' : 'badge-prop'}`}>
                    {showTechnicalDetails ? getFormatBindingDisplayLabel(b) : getConsultantBindingLabel(b)}
                  </span>
                  {showTechnicalDetails && b.promotedFromChild && b.rawElementType && (
                    <span className="fmt-binding-origin">{t.bindingVia} {b.rawElementType}</span>
                  )}
                  <span className="fmt-binding-formula">
                    <DrillDownTrigger
                      expression={b.expressionAsString}
                      configIndex={configIndex}
                      elementName={element.name}
                    >
                      <ExpressionDetailLink expression={b.expressionAsString} configIndex={configIndex} interactive={false} />
                    </DrillDownTrigger>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Children */}
      {hasChildren && isExpanded && element.children.map((child: any, i: number) => (
        <FormatElementTree
          key={child.id ?? i}
          element={child}
          depth={depth + 1}
          bindingMap={bindingMap}
          transformationMap={transformationMap}
          configIndex={configIndex}
          filter={filter}
          // Only an explicit chevron click lifts the filter for the subtree.
          // Auto-expanding a match used to do it too, which made every
          // descendant of a hit look like a hit of its own.
          showAll={showAll || (matchesFilter && manuallyExpanded)}
          expandMode={expandMode}
          expandVersion={expandVersion}
          selectedId={selectedId}
          onSelect={onSelect}
          showTechnicalDetails={showTechnicalDetails}
          bindingFilter={bindingFilter}
          treeIndex={treeIndex}
          selectedAncestors={selectedAncestors}
          onReveal={onReveal}
        />
      ))}
    </div>
  );
}

// ── Bindings tab ──

/** Above this many bindings the tab opens as an outline of its sections. */
const BINDING_OUTLINE_THRESHOLD = 40;

/** Elements listed per model field before the rest hide behind "+N more". */
const MODEL_USAGE_CHIP_LIMIT = 8;

/** The Bindings tab by model: summary line and the tree of model paths the format reads. */
function ModelUsageView({
  tree, stats, descriptor, mapping, dataModelLoaded, onlyUnmapped, onOnlyUnmappedChange,
  isCollapsed, onToggle, labelFor, showTechnicalDetails, onOpenElement, onOpenMapping, empty,
}: {
  tree: ModelUsageNode[];
  stats: { fields: number; unmapped: number };
  descriptor: string;
  mapping: { name: string; configIndex: number } | null;
  dataModelLoaded: boolean;
  onlyUnmapped: boolean;
  onOnlyUnmappedChange: (next: boolean) => void;
  isCollapsed: (key: string) => boolean;
  onToggle: (key: string) => void;
  labelFor: (node: ModelUsageNode) => string | undefined;
  showTechnicalDetails: boolean;
  onOpenElement: (elementId: string) => void;
  onOpenMapping: (configIndex: number) => void;
  empty: React.ReactNode;
}) {
  const cs = locale === 'cs';
  const fieldsWord = cs
    ? (stats.fields >= 1 && stats.fields <= 4 ? 'pole' : 'polí')
    : (stats.fields === 1 ? 'field' : 'fields');

  return (
    <>
      <div className="fmt-model-summary">
        <span>
          {cs ? 'Formát čte ' : 'The format reads '}
          <strong>{stats.fields}</strong>
          {cs ? ` ${fieldsWord} modelu` : ` model ${fieldsWord}`}
        </span>
        {mapping
          ? (
            <span>
              {cs ? 'Mapování: ' : 'Mapping: '}
              <button type="button" className="fmt-model-summary-link" onClick={() => onOpenMapping(mapping.configIndex)}>
                {mapping.name}
              </button>
            </span>
          )
          : (
            <span className="fmt-model-summary-warning">
              {cs
                ? `Mapování pro ${descriptor || 'datový model'} není načtené`
                : `No model mapping loaded for ${descriptor || 'the data model'}`}
            </span>
          )}
        {mapping && stats.unmapped > 0 && (
          <span className="fmt-model-summary-warning">
            {cs ? `${stats.unmapped} bez vazby v mapování` : `${stats.unmapped} without a mapping binding`}
          </span>
        )}
        {!dataModelLoaded && (
          <span>{cs ? 'Popisky polí se ukážou po načtení datového modelu' : 'Load the data model to see field labels'}</span>
        )}
        {mapping && (
          <button
            type="button"
            className={`fmt-bind-intent-chip fmt-bind-intent--condition fmt-model-unmapped-toggle ${onlyUnmapped ? 'active' : ''}`}
            aria-pressed={onlyUnmapped}
            disabled={stats.unmapped === 0 && !onlyUnmapped}
            title={cs ? 'Jen pole, která formát čte a mapování neplní' : 'Only fields the format reads and the mapping never fills'}
            onClick={() => onOnlyUnmappedChange(!onlyUnmapped)}
          >
            <span className="fmt-bind-intent-dot" aria-hidden="true" />
            <span>{cs ? 'Jen bez vazby' : 'Unmapped only'}</span>
            <span className="fmt-bind-intent-count">{stats.unmapped}</span>
          </button>
        )}
      </div>

      {tree.length === 0
        ? (onlyUnmapped
            ? <div className="fmt-bind-empty">{cs ? 'Každé pole, které formát čte, má vazbu v mapování.' : 'Every field the format reads has a mapping binding.'}</div>
            : empty)
        : (
          <div className="mm-tree" role="tree">
            {tree.map(node => (
              <ModelUsageTreeRows
                key={node.key}
                node={node}
                depth={0}
                mappingConfigIndex={mapping?.configIndex ?? 0}
                isCollapsed={isCollapsed}
                onToggle={onToggle}
                labelFor={labelFor}
                showTechnicalDetails={showTechnicalDetails}
                onOpenElement={onOpenElement}
              />
            ))}
          </div>
        )}
    </>
  );
}

/**
 * One model path: its field label, the mapping binding that fills it (with the
 * drill-down), and the format elements that read it.
 */
function ModelUsageTreeRows({ node, depth, mappingConfigIndex, isCollapsed, onToggle, labelFor, showTechnicalDetails, onOpenElement }: {
  node: ModelUsageNode;
  depth: number;
  mappingConfigIndex: number;
  isCollapsed: (key: string) => boolean;
  onToggle: (key: string) => void;
  labelFor: (node: ModelUsageNode) => string | undefined;
  showTechnicalDetails: boolean;
  onOpenElement: (elementId: string) => void;
}) {
  const [showAllUsages, setShowAllUsages] = useState(false);
  const cs = locale === 'cs';
  const hasChildren = node.children.length > 0;
  const collapsed = hasChildren && isCollapsed(node.key);
  const used = node.usages.length > 0;
  const label = labelFor(node);
  const usages = showAllUsages ? node.usages : node.usages.slice(0, MODEL_USAGE_CHIP_LIMIT);

  const classes = [
    'mm-tree-row',
    used ? 'mm-binding-row' : 'mm-tree-branch',
    hasChildren ? 'mm-tree-expandable' : '',
    node.unmapped ? 'fmt-model-row--unmapped' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="mm-tree-node" style={{ ['--mm-depth' as string]: depth }}>
      <div className={classes} role="treeitem" aria-expanded={hasChildren ? !collapsed : undefined}>
        <div
          className="mm-tree-head"
          onClick={hasChildren ? () => onToggle(node.key) : undefined}
          style={hasChildren ? { cursor: 'pointer' } : undefined}
        >
          {hasChildren ? (
            <button
              type="button"
              className={`mm-tree-toggle ${collapsed ? '' : 'open'}`}
              aria-label={node.name}
              onClick={event => { event.stopPropagation(); onToggle(node.key); }}
            >
              <span className={`tree-chevron ${collapsed ? '' : 'open'}`} />
            </button>
          ) : (
            <span className="mm-tree-toggle mm-tree-toggle--leaf" aria-hidden />
          )}
          <span className={used ? 'mm-binding-name' : 'mm-tree-branch-name'} style={{ flex: '0 1 auto' }} title={node.path}>
            {node.name}
          </span>
          {label && <span className="fmt-model-label" title={label}>{label}</span>}
          <span className="fmt-model-head-spacer" />
          {hasChildren && node.unmappedCount > 0 && (
            <span
              className="fmt-model-unmapped-badge"
              title={cs ? `Bez vazby v mapování v této větvi: ${node.unmappedCount}` : `Without a mapping binding in this branch: ${node.unmappedCount}`}
            >
              {node.unmappedCount}
            </span>
          )}
          <span
            className="mm-group-count"
            title={cs ? `Použití ve formátu: ${node.usageCount}` : `Uses in the format: ${node.usageCount}`}
          >
            {node.usageCount}
          </span>
          {used && node.mapping && (
            // The row head toggles the branch; the drill-down must not.
            <span style={{ display: 'contents' }} onClick={event => event.stopPropagation()}>
              <DrillDownTrigger
                expression={node.mapping.expressionAsString}
                configIndex={mappingConfigIndex}
                elementName={node.path}
                className="mm-binding-drill"
              >
                <SearchRegular fontSize={14} />
                <span>{cs ? 'Rozpad' : 'Drill-down'}</span>
              </DrillDownTrigger>
            </span>
          )}
        </div>

        {used && (
          <div className="fmt-model-body">
            <span className="fmt-model-line-label">{cs ? 'Mapování' : 'Mapping'}</span>
            {node.mapping ? (
              <div className="mm-binding-expr">
                <span className="mm-binding-arrow" aria-hidden>←</span>
                <ClickablePath expression={node.mapping.expressionAsString} configIndex={mappingConfigIndex} mode="binding-expr" />
              </div>
            ) : node.unmapped ? (
              <span
                className="fmt-model-missing"
                title={cs ? 'Mapování toto pole neplní, formát tu dostane prázdnou hodnotu.' : 'The mapping never fills this field, so the format gets an empty value here.'}
              >
                {cs ? 'Bez vazby v mapování' : 'No mapping binding'}
              </span>
            ) : !node.mappingLoaded ? (
              <span className="fmt-model-muted">{cs ? 'Mapování není načtené' : 'Mapping not loaded'}</span>
            ) : (
              <span className="fmt-model-muted">{cs ? 'Záznam — vazby mají jeho pole' : 'Record — its fields carry the bindings'}</span>
            )}

            <span className="fmt-model-line-label">{cs ? 'Formát' : 'Format'}</span>
            <div className="fmt-model-usages">
              {usages.map((usage, i) => {
                const property = usage.binding.bindingCategory === 'data'
                  ? null
                  : (showTechnicalDetails ? getFormatBindingDisplayLabel(usage.binding) : getConsultantBindingLabel(usage.binding));
                return (
                  <button
                    key={`${usage.group.componentId}-${i}`}
                    type="button"
                    className={`fmt-model-usage fmt-bind-intent--${usage.intent}`}
                    title={`${getBindingIntentItemLabel(usage.intent)}: ${usage.binding.expressionAsString}`}
                    onClick={() => onOpenElement(usage.group.componentId)}
                  >
                    <span className="fmt-bind-intent-dot" aria-hidden="true" />
                    <span>{usage.group.elementName}</span>
                    {property && <span className="fmt-model-usage-prop">{property}</span>}
                  </button>
                );
              })}
              {node.usages.length > usages.length && (
                <button type="button" className="fmt-model-summary-link fmt-model-usage-more" onClick={() => setShowAllUsages(true)}>
                  {cs ? `+${node.usages.length - usages.length} dalších` : `+${node.usages.length - usages.length} more`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {hasChildren && !collapsed && (
        <div className="mm-tree-children" role="group">
          {node.children.map(child => (
            <ModelUsageTreeRows
              key={child.key}
              node={child}
              depth={depth + 1}
              mappingConfigIndex={mappingConfigIndex}
              isCollapsed={isCollapsed}
              onToggle={onToggle}
              labelFor={labelFor}
              showTechnicalDetails={showTechnicalDetails}
              onOpenElement={onOpenElement}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BindingIntentBar({ layout, onLayoutChange, counts, active, onChange }: {
  layout: 'format' | 'model';
  onLayoutChange: (layout: 'format' | 'model') => void;
  counts: Record<BindingIntent, number>;
  active: readonly BindingIntent[];
  onChange: (next: readonly BindingIntent[]) => void;
}) {
  const cs = locale === 'cs';
  const layouts: Array<{ id: 'format' | 'model'; label: string; title: string }> = [
    {
      id: 'format',
      label: cs ? 'Podle formátu' : 'By format',
      title: cs ? 'Vazby v pořadí, v jakém soubor vzniká' : 'Bindings in the order the file is built',
    },
    {
      id: 'model',
      label: cs ? 'Podle modelu' : 'By model',
      title: cs ? 'Pole datového modelu, která formát čte, a co je plní v mapování' : 'Data model fields the format reads, and what fills them in the mapping',
    },
  ];
  return (
    <div className="fmt-bind-intent-bar" role="toolbar" aria-label={cs ? 'Uspořádání a filtr vazeb' : 'Bindings layout and filter'}>
      <div className="fmt-bind-layout" role="radiogroup" aria-label={cs ? 'Uspořádání vazeb' : 'Bindings layout'}>
        {layouts.map(option => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={layout === option.id}
            className={layout === option.id ? 'active' : ''}
            title={option.title}
            onClick={() => onLayoutChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="fmt-bind-bar-sep" aria-hidden="true" />
      {BINDING_INTENT_ORDER.map(intent => {
        const isActive = active.includes(intent);
        return (
          <button
            key={intent}
            type="button"
            className={`fmt-bind-intent-chip fmt-bind-intent--${intent} ${isActive ? 'active' : ''}`}
            aria-pressed={isActive}
            // An intent with nothing in it can still be switched off, never on.
            disabled={counts[intent] === 0 && !isActive}
            title={getBindingIntentHint(intent)}
            onClick={() => onChange(isActive
              ? active.filter(other => other !== intent)
              : BINDING_INTENT_ORDER.filter(other => other === intent || active.includes(other)))}
          >
            <span className="fmt-bind-intent-dot" aria-hidden="true" />
            <span>{getBindingIntentLabel(intent)}</span>
            <span className="fmt-bind-intent-count">{counts[intent]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** An empty list says whether the chips are what hides the bindings, and offers to undo that. */
function BindingListEmpty({ filter, counts, active, onShowAll }: {
  filter: string;
  counts: Record<BindingIntent, number>;
  active: readonly BindingIntent[];
  onShowAll: () => void;
}) {
  const hidden = BINDING_INTENT_ORDER.filter(intent => !active.includes(intent) && counts[intent] > 0);
  if (hidden.length === 0) {
    return <div className="fmt-bind-empty">{filter ? t.noResults : `${t.bindings}: 0`}</div>;
  }
  const hiddenList = hidden.map(intent => `${getBindingIntentLabel(intent)} (${counts[intent]})`).join(', ');
  return (
    <div className="fmt-bind-empty">
      <span>{locale === 'cs' ? `Ve vybraných typech vazeb nic není. Skryté: ${hiddenList}.` : `Nothing in the selected binding types. Hidden: ${hiddenList}.`}</span>
      <button type="button" className="fmt-bind-intent-chip" onClick={onShowAll}>
        {locale === 'cs' ? 'Zobrazit vše' : 'Show all'}
      </button>
    </div>
  );
}

// ── Binding card: an element and the bindings of it that pass the filter ──

function FormatElementBindingGroup({ row, bindings, focused, cardRef, configIndex, onReveal, showTechnicalDetails }: {
  row: NormalizedFormatBindingGroup;
  bindings: NormalizedFormatBinding[];
  focused?: boolean;
  cardRef?: React.Ref<HTMLDivElement>;
  configIndex: number;
  onReveal?: (elementId: string) => void;
  showTechnicalDetails: boolean;
}) {
  // Values first, then conditions and properties — the inspector's order.
  const ordered = useMemo(() => groupFormatBindingsByCategory(bindings).flatMap(category => category.bindings), [bindings]);
  const hiddenCount = row.bindings.length - bindings.length;

  return (
    <div className={`fmt-bind-card ${focused ? 'is-focused' : ''}`} ref={cardRef}>
      {/* Header: element type, name, bindings hidden by the filter, reveal action */}
      <div className="fmt-bind-card-head">
        {showTechnicalDetails && (
          <span
            className="fmt-bind-type-badge"
            style={{
              color: getFormatTypeColor(row.elementType),
              background: getFormatTypeBadgeSurface(row.elementType),
              borderColor: `${getFormatTypeColor(row.elementType)}55`,
            }}
          >
            {row.elementType}
          </span>
        )}
        <span className="fmt-bind-card-name" title={row.elementName}>{row.elementName}</span>
        {hiddenCount > 0 && (
          <span
            className="fmt-bind-card-count"
            title={locale === 'cs' ? `Další vazby prvku skryté filtrem: ${hiddenCount}` : `More bindings of this element hidden by the filter: ${hiddenCount}`}
          >
            +{hiddenCount}
          </span>
        )}
        {onReveal && (
          <button
            className="fmt-bind-card-reveal"
            onClick={e => { e.stopPropagation(); onReveal(row.componentId); }}
            title={t.openInExplorerAction}
            aria-label={t.openInExplorerAction}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3 H3 V13 H13 V10" />
              <path d="M9 3 H13 V7" />
              <path d="M13 3 L7 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Bindings: one row per binding, flat, no extra nesting. The badge's
          colour is the binding's intent, the same as its filter chip. */}
      <div className="fmt-bind-card-body">
        {ordered.map((binding, i) => {
          const intent = classifyBindingIntent(binding);
          const label = showTechnicalDetails
            ? getFormatBindingDisplayLabel(binding)
            // A consultant reads what a value binding does; a switch keeps its on/off wording.
            : binding.bindingCategory === 'data' ? getBindingIntentItemLabel(intent) : getConsultantBindingLabel(binding);
          return (
            <div key={`${binding.bindingCategory}-${i}`} className="fmt-bind-row">
              <span
                className={`badge fmt-bind-row-label fmt-bind-intent fmt-bind-intent--${intent}`}
                title={`${getBindingIntentItemLabel(intent)} — ${getBindingIntentHint(intent)}`}
              >
                {label}
              </span>
              {showTechnicalDetails && binding.promotedFromChild && binding.rawElementType && (
                <span className="fmt-binding-origin">{t.bindingVia} {binding.rawElementType}</span>
              )}
              <span className="fmt-bind-row-arrow" aria-hidden="true">←</span>
              <span className="fmt-bind-row-expr">
                <DrillDownTrigger
                  expression={binding.expressionAsString}
                  configIndex={configIndex}
                  elementName={row.elementName}
                >
                  <ExpressionDetailLink expression={binding.expressionAsString} configIndex={configIndex} interactive={false} />
                </DrillDownTrigger>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActiveTabNodeSummary({ node, configIndex }: { node: any; configIndex: number }) {
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const configurations = useAppStore(s => s.configurations);

  const normalizeValue = (value: string | undefined) => (value ?? '').trim().toLowerCase();

  const datasourceMatches = useCallback((candidate: any, selected: any) => {
    if (!candidate || !selected) return false;
    const sameName = normalizeValue(candidate.name) === normalizeValue(selected.name);
    if (!sameName) return false;
    const candidateParent = normalizeValue(candidate.parentPath);
    const selectedParent = normalizeValue(selected.parentPath);
    return candidateParent === selectedParent || candidateParent === '' || selectedParent === '';
  }, []);

  const relevantDatasourceBindings = useMemo(() => {
    if (node.type !== 'datasource' || !node.data) return [] as Array<{ path: string; expression: string; source: string }>;

    const cfg = configurations[configIndex];
    if (!cfg) return [];

    const sources: Array<{ sourceName: string; sourceConfigIndex: number; bindings: any[] }> = [];
    if (cfg.content.kind === 'ModelMapping') {
      const version = cfg.content.version as any;
      const definitions: any[] = version.mappings?.length ? version.mappings : [version.mapping];
      for (const mapping of scopeDefinitionsToDatasource(definitions, node.data)) {
        sources.push({
          sourceName: cfg.solutionVersion.solution.name,
          sourceConfigIndex: configIndex,
          bindings: mapping?.bindings ?? [],
        });
      }
    }
    if (cfg.content.kind === 'Format') {
      for (const version of cfg.content.embeddedModelMappingVersions ?? []) {
        const definitions: any[] = (version as any).mappings?.length ? (version as any).mappings : [version.mapping];
        for (const mapping of scopeDefinitionsToDatasource(definitions, node.data)) {
          sources.push({
            sourceName: `${cfg.solutionVersion.solution.name} • ${mapping?.name ?? ''}`,
            sourceConfigIndex: configIndex,
            bindings: mapping?.bindings ?? [],
          });
        }
      }
    }

    const out: Array<{ path: string; expression: string; source: string }> = [];

    for (const source of sources) {
      for (const binding of source.bindings) {
        const expr = String(binding?.expressionAsString ?? '').trim();
        if (!expr) continue;

        const deep = resolveDeepExpression(expr, configurations, source.sourceConfigIndex);
        if (!deep) continue;

        const candidateDatasources = [
          deep.rootDs,
          deep.nestedDs,
          ...(deep.involvedDatasources ?? []).map((d: any) => d.datasource),
        ].filter(Boolean);

        if (!candidateDatasources.some(candidate => datasourceMatches(candidate, node.data))) {
          continue;
        }

        out.push({
          path: String(binding?.path ?? ''),
          expression: expr,
          source: source.sourceName,
        });
      }
    }

    const seen = new Set<string>();
    return out
      .filter(item => {
        const key = `${item.source}|${item.path}|${item.expression}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const bySource = a.source.localeCompare(b.source);
        if (bySource !== 0) return bySource;
        return a.path.localeCompare(b.path);
      });
  }, [configIndex, configurations, datasourceMatches, node.data, node.type]);

  if (node.type === 'datasource') {
    const datasource = node.data ?? {};
    const rows: Array<[string, React.ReactNode]> = [[t.propName, datasource.name ?? '–']];
    // Gated like the property inspector: the raw type and parent path are
    // implementation detail.
    if (showTechnicalDetails) {
      rows.push([t.propType, datasource.type ?? '–'], [t.propParentPath, datasource.parentPath ?? '–']);
    }

    if (datasource.tableInfo?.tableName) rows.push([t.drillLabelTable, datasource.tableInfo.tableName]);
    if (datasource.enumInfo?.enumName) rows.push([t.drillLabelEnum, enumLabelFor(datasource.enumInfo, showTechnicalDetails)]);
    if (datasource.classInfo?.className) rows.push([t.drillLabelClass, datasource.classInfo.className]);
    if (showTechnicalDetails && datasource.calculatedField?.expressionAsString) {
      rows.push([t.expression, <ClickablePath expression={datasource.calculatedField.expressionAsString} configIndex={configIndex} mode="binding-expr" />]);
    }
    if (showTechnicalDetails && datasource.groupByInfo?.listToGroup) {
      rows.push([t.propListToGroup, datasource.groupByInfo.listToGroup]);
    }

    return (
      <div className="fmt-detail-section focused-detail-shell" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="fmt-detail-section-title">{t.focusedDetail}</div>

        <div className="focused-detail-card">
          <div className="focused-detail-card__head">
            <span className="focused-detail-card__title">{locale === 'cs' ? 'Vlastnosti datového zdroje' : 'Datasource properties'}</span>
            <span className="focused-detail-card__badge">{(showTechnicalDetails && datasource.type) || t.nodeTypeLabel('datasource')}</span>
          </div>
          <div className="focused-detail-grid">
            {rows.map(([label, value], index) => (
              <React.Fragment key={`${label}-${index}`}>
                <div className="focused-detail-grid__label">{label}</div>
                <div className="focused-detail-grid__value">{value}</div>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="focused-detail-card">
          <div className="focused-detail-card__head">
            <span className="focused-detail-card__title">{t.bindings}</span>
            <span className="focused-detail-card__badge">{relevantDatasourceBindings.length}</span>
          </div>
          {relevantDatasourceBindings.length === 0 ? (
            <div className="focused-detail-empty">{locale === 'cs' ? 'Žádné relevantní vazby pro vybraný zdroj.' : 'No relevant bindings for the selected datasource.'}</div>
          ) : (
            <div className="focused-detail-binding-list">
              {relevantDatasourceBindings.map((binding, index) => (
                <div key={`${binding.source}-${binding.path}-${index}`} className="focused-detail-binding-row">
                  <div className="focused-detail-binding-row__path">
                    <ClickablePath expression={binding.path} configIndex={configIndex} mode="model-path" />
                  </div>
                  <div className="focused-detail-binding-row__expr">
                    <span className="focused-detail-binding-row__arrow">←</span>
                    <DrillDownTrigger expression={binding.expression} configIndex={configIndex} elementName={datasource.name}>
                      <ExpressionDetailLink expression={binding.expression} configIndex={configIndex} interactive={false} />
                    </DrillDownTrigger>
                  </div>
                  <div className="focused-detail-binding-row__source">{binding.source}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const summaryRows: Array<[string, React.ReactNode]> = [[t.node, node.name]];

  if (showTechnicalDetails) summaryRows.push([t.propType, node.type]);
  if (showTechnicalDetails && node.data?.elementType) summaryRows.push([t.elementType, node.data.elementType]);
  if (showTechnicalDetails && node.data?.type && node.type === 'datasource') summaryRows.push([t.datasourceType, node.data.type]);
  if (showTechnicalDetails && node.data?.path) summaryRows.push([t.path, <ClickablePath expression={node.data.path} configIndex={configIndex} mode="model-path" />]);
  if (showTechnicalDetails && node.data?.expressionAsString) summaryRows.push([t.expression, <ClickablePath expression={node.data.expressionAsString} configIndex={configIndex} mode="binding-expr" />]);
  if (node.data?.tableInfo?.tableName) summaryRows.push([t.drillLabelTable, node.data.tableInfo.tableName]);
  if (node.data?.enumInfo?.enumName) summaryRows.push([t.drillLabelEnum, enumLabelFor(node.data.enumInfo, showTechnicalDetails)]);
  if (node.data?.classInfo?.className) summaryRows.push([t.drillLabelClass, node.data.classInfo.className]);
  if (showTechnicalDetails && node.data?.id) summaryRows.push([t.propId, <span className="prop-value guid" style={{ padding: 0, background: 'transparent' }}>{node.data.id}</span>]);

  return (
    <div className="fmt-detail-section" style={{ borderBottom: '1px solid var(--border-color)' }}>
      <div className="fmt-detail-section-title">{t.focusedDetail}</div>
      <div className="prop-grid" style={{ borderBottom: '1px solid var(--border-color)' }}>
        {summaryRows.map(([label, value], index) => (
          <React.Fragment key={`${label}-${index}`}>
            <div className="prop-label">{label}</div>
            <div className="prop-value">{value}</div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// Keep legacy helpers reachable for future migration work.
// Maps datasource type → an existing badge CSS class
function getDsBadgeClass(type: string): string {
  const map: Record<string, string> = {
    Table: 'badge-table',
    CalculatedField: 'badge-calc',
    Class: 'badge-class',
    Object: 'badge-class',
    Enum: 'badge-enum',
    ModelEnum: 'badge-enum',
    FormatEnum: 'badge-enum',
    ImportFormat: 'badge-import',
    UserParameter: 'badge-param',
    GroupBy: 'badge-table',
    Container: 'badge-export',
    Export: 'badge-export',
    Import: 'badge-import',
  };
  return map[type] ?? 'badge-xml';
}

function getAggregationFunctionBadgeClass(fn: string | undefined): string {
  const normalized = (fn ?? '').trim().toUpperCase();
  if (normalized === 'SUM') return 'ds-row-groupby-fn-sum';
  if (normalized === 'COUNT') return 'ds-row-groupby-fn-count';
  if (normalized === 'AVG' || normalized === 'AVERAGE') return 'ds-row-groupby-fn-avg';
  if (normalized === 'MIN') return 'ds-row-groupby-fn-min';
  if (normalized === 'MAX') return 'ds-row-groupby-fn-max';
  return 'ds-row-groupby-fn-generic';
}

// ── Datasource Row (for Data Sources tab) ──

function FormatDatasourceRow({ ds, configIndex, navigateToTreeNode, focusDsName }: {
  ds: any;
  configIndex: number;
  navigateToTreeNode: (nodeId: string) => void;
  focusDsName?: string;
}) {
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const triggerWhereUsed = useAppStore(s => s.triggerWhereUsed);
  const selectNode = useAppStore(s => s.selectNode);
  const isDirectTarget = Boolean(focusDsName && ds.name === focusDsName);
  const isAncestor = Boolean(focusDsName && !isDirectTarget && containsDatasourceName(ds, focusDsName));
  const [expanded, setExpanded] = useState(false);
  const rowRef = React.useRef<HTMLDivElement>(null);

  // Auto-expand when this row contains the focused descendant
  useEffect(() => {
    if (isAncestor) setExpanded(true);
  }, [isAncestor]);

  // Scroll into view when this row IS the direct target
  useEffect(() => {
    if (isDirectTarget && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isDirectTarget]);
  const groupByFields = ds.groupByInfo?.groupedFields ?? [];
  const aggregatedFields = ds.groupByInfo?.aggregations ?? [];
  const [showGroupedFields, setShowGroupedFields] = useState(groupByFields.length > 0 && groupByFields.length <= 6);
  const [showAggregatedFields, setShowAggregatedFields] = useState(aggregatedFields.length > 0 && aggregatedFields.length <= 6);
  // Selecting a datasource — the row or one of its grouped fields — leaves the
  // explorer alone, as everywhere in the designers; the row's ⋮ menu reveals it.
  const navigateToDatasource = useCallback((name: string, parentPath?: string) => {
    const nodeId = findDatasourceNode(name, configIndex, parentPath);
    if (nodeId) selectNode(nodeId, { revealInExplorer: false });
  }, [findDatasourceNode, configIndex, selectNode]);
  const revealDatasourceInExplorer = useCallback(() => {
    const nodeId = findDatasourceNode(ds.name, configIndex, ds.parentPath);
    if (nodeId) navigateToTreeNode(nodeId);
  }, [findDatasourceNode, configIndex, ds.name, ds.parentPath, navigateToTreeNode]);
  const getParentPathFromModelPath = useCallback((path: string) => {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash >= 0 ? path.slice(0, lastSlash) : undefined;
  }, []);

  useEffect(() => {
    setShowGroupedFields(groupByFields.length > 0 && groupByFields.length <= 6);
    setShowAggregatedFields(aggregatedFields.length > 0 && aggregatedFields.length <= 6);
  }, [ds.name, groupByFields.length, aggregatedFields.length]);

  // Build human-readable target string
  let targetLabel: string | null = null;
  if (ds.tableInfo) {
    targetLabel = ds.tableInfo.tableName;
    if (showTechnicalDetails && ds.tableInfo.isCrossCompany) targetLabel += ` (${t.dsCrossCompany})`;
    if (showTechnicalDetails && ds.tableInfo.selectedFields?.length) targetLabel += ` [${ds.tableInfo.selectedFields.join(', ')}]`;
  } else if (ds.enumInfo) {
    targetLabel = enumLabelFor(ds.enumInfo, showTechnicalDetails);
  } else if (ds.classInfo) {
    targetLabel = ds.classInfo.className;
  } else if (ds.calculatedField) {
    // The group header already says "calculated values"; the formula itself
    // belongs to the technical view and the drill-down — same as the inspector.
    targetLabel = showTechnicalDetails ? (ds.calculatedField.expressionAsString ?? '') : null;
  } else if (ds.importFormatInfo) {
    targetLabel = showTechnicalDetails
      ? ds.importFormatInfo.formatGuid
      : (locale === 'cs' ? 'Importní formát' : 'Import format');
  } else if (ds.groupByInfo) {
    targetLabel = ds.groupByInfo.listToGroup
      ? (showTechnicalDetails
          ? `list: ${ds.groupByInfo.listToGroup}`
          : `${locale === 'cs' ? 'Seskupení podle' : 'Grouped by'}: ${ds.groupByInfo.listToGroup.split('/').pop()}`)
      : null;
  }

  return (
    <div className={`ds-row-wrap${isDirectTarget ? ' search-match' : ''}`} ref={rowRef}>
      <div
        className="ds-row"
        onClick={() => {
          navigateToDatasource(ds.name, ds.parentPath);
        }}
      >
        {/* Line 1: type badge + name + nested toggle */}
        <div className="ds-row-main">
          {showTechnicalDetails && (
            <span className={`badge ${getDsBadgeClass(ds.type)}`} style={{ flexShrink: 0 }}>
              {ds.type}
            </span>
          )}
          <span className="ds-row-name">{ds.name}</span>
          {ds.children?.length > 0 && (
            <span
              className="ds-row-toggle"
              title={t.dsNestedCount(ds.children.length)}
              onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
            >
              {ds.children.length} <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
            </span>
          )}
          <button
            type="button"
            className="ds-row-where-used"
            onClick={e => { e.stopPropagation(); triggerWhereUsed(ds.name); }}
            title={locale === 'cs' ? 'Kde je použito' : 'Where used'}
          >
            🔍
          </button>
          <RevealInExplorerMenu onReveal={revealDatasourceInExplorer} />
        </div>
        {/* Line 2: target reference */}
        {targetLabel && (
          <div className="ds-row-target">
            {ds.calculatedField ? (
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>= {targetLabel}</span>
            ) : (
              <span>→ <strong>{targetLabel}</strong></span>
            )}
          </div>
        )}
      </div>
      {ds.groupByInfo && (groupByFields.length > 0 || aggregatedFields.length > 0) && (
        <div className="ds-row-groupby-meta">
          <div className="ds-row-groupby-grid">
            {groupByFields.length > 0 && (
              <div className="ds-row-groupby-column ds-row-groupby-column-grouped">
                <button
                  type="button"
                  className="ds-row-groupby-column-toggle"
                  onClick={event => {
                    event.stopPropagation();
                    setShowGroupedFields(value => !value);
                  }}
                >
                  <span className="fmt-ds-label">{t.dsGroupBy}</span>
                  <span className="ds-row-groupby-count">{groupByFields.length}</span>
                  <span className={`tree-chevron ${showGroupedFields ? 'open' : ''}`} />
                </button>
                {showGroupedFields && (
                  <div className="ds-row-groupby-list">
                    {groupByFields.map((field: any) => (
                      <button
                        key={field.path}
                        type="button"
                        className="ds-row-groupby-item"
                        onClick={event => {
                          event.stopPropagation();
                          navigateToDatasource(field.name, getParentPathFromModelPath(field.path));
                        }}
                      >
                        {field.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {aggregatedFields.length > 0 && (
              <div className="ds-row-groupby-column ds-row-groupby-column-aggregated">
                <button
                  type="button"
                  className="ds-row-groupby-column-toggle"
                  onClick={event => {
                    event.stopPropagation();
                    setShowAggregatedFields(value => !value);
                  }}
                >
                  <span className="fmt-ds-label">{t.dsAggregated}</span>
                  <span className="ds-row-groupby-count">{aggregatedFields.length}</span>
                  <span className={`tree-chevron ${showAggregatedFields ? 'open' : ''}`} />
                </button>
                {showAggregatedFields && (
                  <div className="ds-row-groupby-list">
                    {aggregatedFields.map((field: any) => (
                      <button
                        key={field.path}
                        type="button"
                        className="ds-row-groupby-item"
                        onClick={event => {
                          event.stopPropagation();
                          navigateToDatasource(field.name, getParentPathFromModelPath(field.path));
                        }}
                      >
                        <span className="ds-row-groupby-item-text">{field.name}</span>
                        {field.function && (
                          <span className={`ds-row-groupby-fn-badge ${getAggregationFunctionBadgeClass(field.function)}`}>
                            {field.function}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Nested children (indented) */}
      {expanded && ds.children?.map((child: any, i: number) => (
        <div key={i} style={{ paddingLeft: 12, borderLeft: '2px solid var(--border-color)', marginLeft: 8 }}>
          <FormatDatasourceRow ds={child} configIndex={configIndex} navigateToTreeNode={navigateToTreeNode} focusDsName={focusDsName} />
        </div>
      ))}
    </div>
  );
}

// ── Grouped Datasource List ──

const dsGroupOrder = ['Table', 'CalculatedField', 'Class', 'Object', 'Enum', 'ModelEnum', 'FormatEnum', 'Values', 'UserParameter', 'GroupBy', 'Container', 'Join', 'DataModel', 'Other'];
/** Group titles in the technical view, one per raw datasource type. */
const dsGroupLabels: Record<'cs' | 'en', Record<string, string>> = {
  cs: {
    Table: 'Tabulky',
    CalculatedField: 'Vypočtená pole',
    Class: 'Třídy',
    Object: 'Objekty',
    Enum: 'Výčty AX',
    ModelEnum: 'Výčty datového modelu',
    FormatEnum: 'Výčty formátu',
    ImportFormat: 'Importní formáty',
    UserParameter: 'Uživatelské parametry',
    GroupBy: 'Seskupení',
    Container: 'Kontejnery',
    Join: 'Spojení',
    DataModel: 'Datový model',
  },
  en: {
    Table: 'Tables',
    CalculatedField: 'Calculated Fields',
    Class: 'Classes',
    Object: 'Objects',
    Enum: 'Ax Enums',
    ModelEnum: 'Data model Enums',
    FormatEnum: 'Format enums',
    ImportFormat: 'Import formats',
    UserParameter: 'User Parameters',
    GroupBy: 'Group By',
    Container: 'Containers',
    Join: 'Joins',
    DataModel: 'Data model',
  },
};

export interface GroupedDatasourceListHandle {
  expandAll: () => void;
  collapseAll: () => void;
}

const GroupedDatasourceList = React.forwardRef<GroupedDatasourceListHandle, {
  datasources: any[];
  configIndex: number;
  navigateToTreeNode: (nodeId: string) => void;
  focusDsName?: string;
  /** True while a text filter is applied — every group is shown expanded. */
  filtering?: boolean;
}>(function GroupedDatasourceList({ datasources, configIndex, navigateToTreeNode, focusDsName, filtering }, ref) {
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const ds of datasources) {
      const type = getDatasourceGroupKey(ds.type || 'Unknown', showTechnicalDetails);
      if (!map.has(type)) map.set(type, []);
      map.get(type)!.push(ds);
    }
    // Sort groups by predefined order, unknowns at the end
    const sorted: [string, any[]][] = [];
    for (const key of dsGroupOrder) {
      if (map.has(key)) { sorted.push([key, map.get(key)!]); map.delete(key); }
    }
    for (const [key, val] of map) { sorted.push([key, val]); }
    return sorted;
  }, [datasources, showTechnicalDetails]);

  // Initial collapse (all groups except the focused one) runs when the list
  // target changes — not on every `datasources` change, which happens on each
  // filter keystroke and used to wipe the user's expand state.
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const groupsInitKey = groups.length === 0 ? '' : 'ready';
  useEffect(() => {
    const current = groupsRef.current;
    if (current.length === 0) return;
    const focusGroupType = focusDsName
      ? current.find(([, items]) => items.some((ds: any) => containsDatasourceName(ds, focusDsName)))?.[0]
      : undefined;
    setCollapsedGroups(new Set(current.map(([type]) => type).filter(t => t !== focusGroupType)));
  }, [focusDsName, configIndex, groupsInitKey]);
  const effectiveCollapsedGroups = filtering ? EMPTY_STRING_SET : collapsedGroups;

  const toggleGroup = useCallback((type: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  const expandAllGroups = useCallback(() => {
    setCollapsedGroups(new Set());
  }, []);

  const collapseAllGroups = useCallback(() => {
    setCollapsedGroups(new Set(groups.map(([type]) => type)));
  }, [groups]);

  React.useImperativeHandle(ref, () => ({
    expandAll: expandAllGroups,
    collapseAll: collapseAllGroups,
  }), [expandAllGroups, collapseAllGroups]);

  return (
    <div>
      {groups.map(([type, items]) => {
        const isCollapsed = effectiveCollapsedGroups.has(type);
        return (
          <div key={type}>
            <div
              className="ds-group-header"
              onClick={() => toggleGroup(type)}
            >
              <span className={`tree-chevron ${!isCollapsed ? 'open' : ''}`} />
              <span className="ds-group-label">{getDatasourceGroupLabel(type, showTechnicalDetails)}</span>
              <span className="ds-group-count">{items.length}</span>
            </div>
            {!isCollapsed && items.map((ds: any, i: number) => (
              <FormatDatasourceRow key={i} ds={ds} configIndex={configIndex} navigateToTreeNode={navigateToTreeNode} focusDsName={focusDsName} />
            ))}
          </div>
        );
      })}
    </div>
  );
});

function fieldTypeLabel(type: number): string {
  const map: Record<number, string> = {
    1: 'Bool', 3: 'Int64', 4: 'Int', 5: 'Real',
    6: 'Str', 7: 'Date', 9: 'Enum', 10: 'Rec',
    11: 'RecList', 13: 'Binary',
  };
  return map[type] ?? '?';
}
