import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
} from '@xyflow/react';
import { BoxRegular, DataBarVerticalFilled, HomeRegular, TextCaseTitleRegular } from '@fluentui/react-icons';
import { DataModelList } from './DataModelList';
import { useAppStore, resolveDeepExpression } from '../../state/store';
import { ClickablePath } from '../ClickablePath';
import { DrillDownTrigger } from '../DrillDownPanel';
import { locale, t } from '../../i18n';
import { type ERConfiguration, type ERDataModelContent } from '@er-visualizer/core';
import { ExpressionDetailLink, DesignerHint, enumLabelFor, fieldTypeLabel } from './shared';

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

/** The list is where fields are found; the graph gives the overview. Remembered per browser. */
const MODEL_VIEW_KEY = 'er-visualizer.model-view';

function readModelView(): 'list' | 'graph' {
  try {
    return window.localStorage.getItem(MODEL_VIEW_KEY) === 'graph' ? 'graph' : 'list';
  } catch {
    return 'list';
  }
}

export function ModelDesigner({ config, focusNode }: { config: ERConfiguration; focusNode: any | null }) {
  const dm = (config.content as ERDataModelContent).version.model;
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const configIndex = useAppStore(s => s.configurations.indexOf(config));
  const [view, setView] = useState<'list' | 'graph'>(readModelView);
  const chooseView = (next: 'list' | 'graph') => {
    setView(next);
    try { window.localStorage.setItem(MODEL_VIEW_KEY, next); } catch { /* a convenience only */ }
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Selection follows navigation only: the focus effect below reads the
  // containers through a ref, so a rebuilt model (same focusNode) does not
  // snap the selection back over one the user has made since.
  const containersRef = useRef(dm.containers);
  useEffect(() => { containersRef.current = dm.containers; }, [dm.containers]);

  useEffect(() => {
    if (focusNode?.type === 'container' && focusNode.data?.id) {
      setSelectedId(focusNode.data.id);
    }
    if (focusNode?.type === 'field') {
      // Field node ID: cfg-{n}-container-{ci}-field-{fi} — extract container index
      const m = focusNode.id.match(/-container-(\d+)-field-/);
      if (m) {
        const ci = parseInt(m[1], 10);
        const container = containersRef.current[ci];
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
                <span style={{ display: 'inline-flex' }} aria-hidden>
                  {container.isRoot ? <HomeRegular fontSize={14} /> : container.isEnum ? <TextCaseTitleRegular fontSize={14} /> : <BoxRegular fontSize={14} />}
                </span>
                <span>{container.name}</span>
                {container.isRoot && (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 9,
                    background: 'var(--er-info-soft)',
                    border: '1px solid var(--er-info-border)',
                    padding: '1px 5px',
                    borderRadius: 3,
                    color: 'var(--er-info)',
                    fontWeight: 600,
                  }}>{t.modelRootBadge}</span>
                )}
                {container.isEnum && (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 9,
                    background: 'var(--er-warning-soft)',
                    border: '1px solid var(--er-warning-border)',
                    padding: '1px 5px',
                    borderRadius: 3,
                    color: 'var(--er-warning)',
                    fontWeight: 600,
                  }}>{t.modelEnumBadge}</span>
                )}
                <span style={{
                  marginLeft: container.isRoot || container.isEnum ? 0 : 'auto',
                  fontSize: 9,
                  color: 'var(--er-text-muted)',
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
                        color: f.typeDescriptor ? 'var(--er-info)' : 'var(--syn-field-type)',
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
                  <div style={{ padding: '2px 10px', color: 'var(--er-text-muted)', fontSize: 10 }}>
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
              stroke: isRecordList ? 'var(--er-success)' : 'var(--syn-edge)',
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
        <div className="search-scope-toggle dm-view-toggle" role="group" aria-label={t.modelViewLabel}>
          {(['list', 'graph'] as const).map(v => (
            <button
              key={v}
              type="button"
              className={`search-scope-toggle__btn ${view === v ? 'active' : ''}`}
              aria-pressed={view === v}
              onClick={() => chooseView(v)}
            >
              {v === 'list' ? t.modelViewList : t.modelViewGraph}
            </button>
          ))}
        </div>
        <DesignerHint text={t.modelHierarchyHint} />
      </div>
      {view === 'list' ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <DataModelList containers={dm.containers} configIndex={configIndex} />
        </div>
      ) : (
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
      )}
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
