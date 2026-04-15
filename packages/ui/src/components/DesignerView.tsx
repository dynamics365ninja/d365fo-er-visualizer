import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAppStore, resolveDeepExpression } from '../state/store';
import type { DeepResolutionResult } from '../state/store';
import { ClickablePath } from './ClickablePath';
import { DrillDownPanel } from './DrillDownPanel';
import { PropertyInspector } from './PropertyInspector';
import { locale, t } from '../i18n';
import { formatEnumDisplayName } from '../utils/enum-display';
import { buildFormatBindingPresentation, groupFormatBindingsByCategory } from '../utils/format-binding-display';
import { getFormatTypeBadgeSurface, getFormatTypeThemeColor } from '../utils/theme-colors';
import type { ERConfiguration, ERDataModelContent, ERModelMappingContent, ERFormatContent } from '@er-visualizer/core';

export function DesignerView() {
  const activeTabId = useAppStore(s => s.activeTabId);
  const tabs = useAppStore(s => s.openTabs);
  const configs = useAppStore(s => s.configurations);
  const treeNodes = useAppStore(s => s.treeNodes);
  const selectedNode = useAppStore(s => s.selectedNode);

  if (!activeTabId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📐</div>
          <div style={{ fontSize: 14 }}>{t.openInExplorer}</div>
        </div>
      </div>
    );
  }

  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return null;

  const config = configs[tab.configIndex];
  if (!config) return null;

  const tabNode = findTreeNodeById(treeNodes, activeTabId);

  const activeNode = selectedNode?.configIndex === tab.configIndex
    ? selectedNode
    : findTreeNodeById(treeNodes, activeTabId);

  if (tabNode && tabNode.type !== 'file') {
    return <FocusedNodeTab node={tabNode} />;
  }

  if (config.kind === 'DataModel') return <ModelDesigner config={config} focusNode={activeNode} />;
  if (config.kind === 'ModelMapping') return <MappingDesigner config={config} configIndex={tab.configIndex} focusNode={activeNode} />;
  if (config.kind === 'Format') return <FormatDesigner config={config} configIndex={tab.configIndex} focusNode={activeNode} />;

  return <div style={{ padding: 16 }}>Unsupported view for: {config.kind}</div>;
}

function FocusedNodeTab({ node }: { node: any }) {
  return (
    <div className="focused-node-tab">
      <div className="focused-node-tab-header">
        <span className="focused-node-tab-icon">{node.icon}</span>
        <span className="focused-node-tab-title">{node.name}</span>
      </div>
      <div className="focused-node-tab-body">
        <PropertyInspector nodeOverride={node} />
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

type DensityMode = 'comfortable' | 'compact';

function getConsultantFormatTypeLabel(type: string): string {
  const csLabels: Record<string, string> = {
    File: 'Soubor',
    ExcelFile: 'Excel',
    WordFile: 'Word',
    PDFFile: 'PDF',
    XMLElement: 'Element',
    XMLAttribute: 'Atribut',
    XMLSequence: 'Sekvence',
    String: 'Text',
    Base64: 'Příloha',
  };
  const enLabels: Record<string, string> = {
    File: 'File',
    ExcelFile: 'Excel',
    WordFile: 'Word',
    PDFFile: 'PDF',
    XMLElement: 'Element',
    XMLAttribute: 'Attribute',
    XMLSequence: 'Sequence',
    String: 'Text',
    Base64: 'Attachment',
  };
  const labels = locale === 'cs' ? csLabels : enLabels;
  return labels[type] ?? type;
}

function getDatasourceGroupLabel(type: string, showTechnicalDetails: boolean): string {
  if (showTechnicalDetails) {
    return dsGroupLabels[type] ?? `❓ ${type}`;
  }

  const csLabels: Record<string, string> = {
    Table: '🗃️ Tabulky',
    CalculatedField: '🧮 Vypočtené hodnoty',
    Class: '⚙️ Logika',
    Enum: '🔤 Hodnoty',
    ModelEnum: '🔤 Hodnoty',
    FormatEnum: '🔤 Hodnoty',
    UserParameter: '👤 Parametry',
    GroupBy: '📊 Seskupená data',
    Container: '📦 Kontejnery',
  };
  const enLabels: Record<string, string> = {
    Table: '🗃️ Tables',
    CalculatedField: '🧮 Calculated values',
    Class: '⚙️ Logic',
    Enum: '🔤 Values',
    ModelEnum: '🔤 Values',
    FormatEnum: '🔤 Values',
    UserParameter: '👤 Parameters',
    GroupBy: '📊 Grouped data',
    Container: '📦 Containers',
  };
  const labels = locale === 'cs' ? csLabels : enLabels;
  return labels[type] ?? (locale === 'cs' ? '📁 Ostatní' : '📁 Other');
}

function getDatasourceGroupKey(type: string, showTechnicalDetails: boolean): string {
  if (showTechnicalDetails) return type;
  if (type === 'Enum' || type === 'ModelEnum' || type === 'FormatEnum') return 'Values';
  return type;
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
        ? 'var(--surface-info-bg)'
        : container.isEnum
          ? 'var(--surface-warning-bg)'
          : 'var(--surface-success-bg)';
      const headerColor = container.isRoot
        ? 'var(--surface-info-fg)'
        : container.isEnum
          ? 'var(--surface-warning-fg)'
          : 'var(--surface-success-fg)';
      const borderColor = isSelected
        ? 'var(--accent)'
        : container.isRoot
          ? 'var(--surface-info-border)'
          : container.isEnum
            ? 'var(--surface-warning-border)'
            : 'var(--surface-success-border)';

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
                  }}>ROOT</span>
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
                  }}>ENUM</span>
                )}
                <span style={{
                  marginLeft: container.isRoot || container.isEnum ? 0 : 'auto',
                  fontSize: 9,
                  color: 'var(--text-secondary)',
                  fontWeight: 400,
                }}>{container.items.length} fields</span>
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
                    +{container.items.length - 14} more…
                  </div>
                )}
              </div>
            </div>
          ),
        },
        type: 'default',
        style: {
          background: 'transparent',
          border: `2px solid ${borderColor}`,
          borderRadius: 6,
          padding: 0,
          width: NODE_W,
          boxShadow: isSelected ? `0 0 12px ${borderColor}` : 'none',
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
        <span className="fmt-header-title">📐 {dm.name}</span>
        <div className="fmt-header-stats">
          <span className="fmt-stat" style={{ color: 'var(--surface-info-fg)' }}>🏠 {stats.roots} roots</span>
          <span className="fmt-stat" style={{ color: 'var(--surface-success-fg)' }}>📦 {stats.records} records</span>
          <span className="fmt-stat" style={{ color: 'var(--surface-warning-fg)' }}>🔤 {stats.enums} enums</span>
          <span className="fmt-stat">📝 {stats.fields} fields</span>
          <span className="fmt-stat">🔗 {stats.edges} relations</span>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>
          Hierarchická mapa · klikni na kontejner pro zvýraznění
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <ReactFlow nodes={nodes} edges={edges} fitView nodesConnectable={false} nodesDraggable>
          <Background color="var(--border-color)" gap={20} variant={'dots' as any} />
          <Controls />
          <MiniMap
            style={{ background: 'var(--minimap-bg)' }}
            nodeColor={(n) => {
              const c = dm.containers.find(c => c.id === n.id);
              if (!c) return 'var(--minimap-node)';
              return c.isRoot ? 'var(--surface-info-bg)' : c.isEnum ? 'var(--surface-warning-bg)' : 'var(--surface-success-bg)';
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

// ─── Mapping Designer ───

function MappingDesigner({ config, configIndex, focusNode }: { config: ERConfiguration; configIndex: number; focusNode: any | null }) {
  const mm = (config.content as ERModelMappingContent).version.mapping;
  const selectNode = useAppStore(s => s.selectNode);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'bindings' | 'datasources'>('bindings');
  const [density, setDensity] = useState<DensityMode>('comfortable');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!focusNode) return;
    if (focusNode.type === 'binding' || focusNode.type === 'validation') setView('bindings');
  }, [focusNode]);

  // Trivial constant detector — same logic as Format bindings
  const isTrivialExpr = (expr: string) => /^(false|true|0|1|""|'')$/i.test(expr.trim());

  // Grouped, deduplicated, filtered bindings
  const mappingGroups = useMemo(() => {
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
    const meaningful = deduped.filter(b => !isTrivialExpr(b.expressionAsString));

    // 3. Apply text filter
    const lower = filter.toLowerCase();
    const textFiltered = filter
      ? meaningful.filter(b =>
          b.path.toLowerCase().includes(lower) ||
          b.expressionAsString.toLowerCase().includes(lower)
        )
      : meaningful;

    // 4. Group by first path segment (e.g. "TaxTransactions" from "TaxTransactions/Values/Amount")
    const groups = new Map<string, typeof mm.bindings>();
    for (const b of textFiltered) {
      const firstSeg = b.path.split('/')[0];
      if (!groups.has(firstSeg)) groups.set(firstSeg, []);
      groups.get(firstSeg)!.push(b);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, items]) => ({
        group,
        items: [...items].sort((a, b) => a.path.localeCompare(b.path)),
      }));
  }, [mm.bindings, filter]);

  const toggleGroup = useCallback((g: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  }, []);

  useEffect(() => {
    if (mappingGroups.length === 0) return;
    setCollapsedGroups(prev => prev.size > 0 ? prev : new Set(mappingGroups.map(group => group.group)));
  }, [mappingGroups]);

  const totalShown = mappingGroups.reduce((n, g) => n + g.items.length, 0);

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
      {focusNode && focusNode.type !== 'file' && focusNode.type !== 'mapping' && (
        <ActiveTabNodeSummary node={focusNode} configIndex={configIndex} />
      )}
      {/* Header */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-accent)' }}>
          🔗 {mm.name}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            onClick={() => setView('bindings')}
            style={{
              padding: '3px 10px', fontSize: 11, borderRadius: 3, border: 'none', cursor: 'pointer',
              background: view === 'bindings' ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: view === 'bindings' ? 'var(--button-primary-fg)' : 'var(--text-secondary)',
            }}
          >
            {t.bindings} ({totalShown})
          </button>
          <button
            onClick={() => setView('datasources')}
            style={{
              padding: '3px 10px', fontSize: 11, borderRadius: 3, border: 'none', cursor: 'pointer',
              background: view === 'datasources' ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: view === 'datasources' ? 'var(--button-primary-fg)' : 'var(--text-secondary)',
            }}
          >
            {t.dataSources} ({mm.datasources.length})
          </button>
        </div>
        <div className="panel-filter-row">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={t.filter}
            className="fmt-filter-input panel-filter-input"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="fmt-action-btn"
              title={t.clearFilter}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="designer-context-bar">
        <span className="designer-context-chip">{t.viewLabel}: {view === 'bindings' ? t.bindings : t.dataSources}</span>
        {focusNode && <span className="designer-context-chip">{focusNode.name}</span>}
        <div className="designer-density-toggle">
          <button className={`fmt-action-btn ${density === 'comfortable' ? 'active' : ''}`} onClick={() => setDensity('comfortable')}>{t.comfortableDensity}</button>
          <button className={`fmt-action-btn ${density === 'compact' ? 'active' : ''}`} onClick={() => setDensity('compact')}>{t.compactDensity}</button>
        </div>
      </div>

      {/* Content */}
      <div className={`designer-scroll-pane density-${density}`}>
        {view === 'bindings' && (
          mappingGroups.length === 0
            ? <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 12 }}>{t.noResults}</div>
            : mappingGroups.map(({ group, items }) => {
                const collapsed = collapsedGroups.has(group);
                return (
                  <div key={group} className="mm-group">
                    {/* Group header */}
                    <div className="mm-group-header" onClick={() => toggleGroup(group)}>
                      <span className={`tree-chevron ${!collapsed ? 'open' : ''}`} />
                      <span className="mm-group-name">{group}</span>
                      <span className="mm-group-count">{items.length}</span>
                    </div>
                    {/* Group rows */}
                    {!collapsed && items.map((b, i) => {
                      // Tail = the part after the group prefix, e.g. "Values/TaxAmount" from "TaxTransactions/Values/TaxAmount"
                      const tail = b.path.startsWith(group + '/')
                        ? b.path.slice(group.length + 1)
                        : b.path;
                      // Split tail into parent context + field name
                      const slashIdx = tail.lastIndexOf('/');
                      const fieldName = slashIdx >= 0 ? tail.slice(slashIdx + 1) : tail;
                      const parentCtx = slashIdx >= 0 ? tail.slice(0, slashIdx) : null;

                      return (
                        <div key={i} className="mm-binding-row">
                          <div className="mm-binding-field">
                            {parentCtx && (
                              <span className="mm-binding-parent">{parentCtx} /</span>
                            )}
                            <span className="mm-binding-name">{fieldName}</span>
                          </div>
                          <div className="mm-binding-expr">
                            <span className="mm-binding-arrow">←</span>
                            <ClickablePath expression={b.expressionAsString} configIndex={configIndex} mode="binding-expr" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })
        )}

        {view === 'datasources' && (
          <GroupedDatasourceList datasources={filteredDatasources} configIndex={configIndex} navigateToTreeNode={navigateToTreeNode} />
        )}
      </div>
    </div>
  );
}

// ─── Format Designer (PRIMARY VIEW) ───

function FormatDesigner({ config, configIndex, focusNode }: { config: ERConfiguration; configIndex: number; focusNode: any | null }) {
  const fc = config.content as ERFormatContent;
  const fmt = fc.formatVersion.format;
  const fmtMap = fc.formatMappingVersion.formatMapping;
  const rootElement = fmt.rootElement;
  const selectNode = useAppStore(s => s.selectNode);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);
  const registry = useAppStore(s => s.registry);
  const treeNodes = useAppStore(s => s.treeNodes);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);

  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'structure' | 'bindings' | 'datasources'>('structure');
  const [density, setDensity] = useState<DensityMode>('comfortable');
  const [structureExpandMode, setStructureExpandMode] = useState<'all' | 'none'>('all');
  const [structureExpandVersion, setStructureExpandVersion] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [collapsedDetailSections, setCollapsedDetailSections] = useState<Set<string>>(() => new Set(['bindings']));

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

  // Selected element detail
  const selectedElement = useMemo(() => {
    if (!selectedElementId) return null;
    const find = (el: any): any => {
      if (el.id === selectedElementId) return el;
      for (const child of el.children ?? []) {
        const f = find(child);
        if (f) return f;
      }
      return null;
    };
    return find(rootElement);
  }, [selectedElementId, rootElement]);

  const selectedBindings = selectedElement ? (bindingMap.get(selectedElement.id) ?? []) : [];
  const selectedBindingCategories = useMemo(
    () => groupFormatBindingsByCategory(selectedBindings),
    [selectedBindings],
  );
  const selectedAttributeCount = useMemo(
    () => Object.entries(selectedElement?.attributes ?? {})
      .filter(([key]) => !['Encoding', 'MaximalLength', 'Value', 'Transformation', 'ExcludedFromDataSource'].includes(key)).length,
    [selectedElement],
  );

  // Grouped bindings view: entries grouped by format element type first, then by concrete element
  const groupedBindings = useMemo(() => {
    const isTrivialExpr = (expr: string) => /^(false|true|0|1|""|'')$/i.test(expr.trim());

    let rows = bindingPresentation.groups.filter(row => {
      if (row.dataBindings.length > 0) return true;
      return row.bindings.some(binding => !isTrivialExpr(binding.expressionAsString ?? ''));
    });

    if (filter) {
      const lower = filter.toLowerCase();
      rows = rows.filter(row =>
        row.elementName.toLowerCase().includes(lower) ||
        row.elementType.toLowerCase().includes(lower) ||
        row.bindings.some(binding =>
          binding.expressionAsString?.toLowerCase().includes(lower) ||
          binding.bindingDisplayLabel.toLowerCase().includes(lower),
        ),
      );
    }

    rows.sort((a, b) => {
      if (a.dataBindings.length > 0 && b.dataBindings.length === 0) return -1;
      if (a.dataBindings.length === 0 && b.dataBindings.length > 0) return 1;
      return a.elementName.localeCompare(b.elementName);
    });

    return rows;
  }, [bindingPresentation.groups, filter]);

  const groupedBindingsByType = useMemo(() => {
    const groups = new Map<string, typeof groupedBindings>();

    for (const row of groupedBindings) {
      const existing = groups.get(row.elementType) ?? [];
      existing.push(row);
      groups.set(row.elementType, existing);
    }

    return Array.from(groups.entries())
      .sort(([leftType], [rightType]) => leftType.localeCompare(rightType))
      .map(([elementType, rows]) => ({
        elementType,
        rows: rows.sort((left, right) => left.elementName.localeCompare(right.elementName)),
      }));
  }, [groupedBindings]);

  const [collapsedBindingTypeGroups, setCollapsedBindingTypeGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (groupedBindingsByType.length === 0) return;
    setCollapsedBindingTypeGroups(prev => prev.size > 0 ? prev : new Set(groupedBindingsByType.map(group => group.elementType)));
  }, [groupedBindingsByType]);

  const toggleBindingTypeGroup = useCallback((elementType: string) => {
    setCollapsedBindingTypeGroups(prev => {
      const next = new Set(prev);
      if (next.has(elementType)) next.delete(elementType); else next.add(elementType);
      return next;
    });
  }, []);

  const expandAllBindingTypeGroups = useCallback(() => {
    setCollapsedBindingTypeGroups(new Set());
  }, []);

  const collapseAllBindingTypeGroups = useCallback(() => {
    setCollapsedBindingTypeGroups(new Set(groupedBindingsByType.map(group => group.elementType)));
  }, [groupedBindingsByType]);

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

  const toggleDetailSection = useCallback((sectionKey: string) => {
    setCollapsedDetailSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey); else next.add(sectionKey);
      return next;
    });
  }, []);

  const bindingsLabel = showTechnicalDetails ? t.bindings : t.lightBindings;
  const dataSourcesLabel = showTechnicalDetails ? t.dataSources : t.lightDataSources;
  const groupCountLabel = locale === 'cs' ? (showTechnicalDetails ? 'typů' : 'skupin') : (showTechnicalDetails ? 'types' : 'groups');
  const currentViewLabel = view === 'structure' ? t.structure : view === 'bindings' ? bindingsLabel : dataSourcesLabel;
  const currentFocusLabel = selectedElement?.name ?? focusNode?.name ?? fmt.name;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {focusNode && focusNode.type !== 'file' && focusNode.type !== 'format' && (
        <ActiveTabNodeSummary node={focusNode} configIndex={configIndex} />
      )}
      {/* ── Header Bar ── */}
      <div className="fmt-header">
        <FormatTypeBadge rootElement={rootElement} />
        <span className="fmt-header-title">{fmt.name}</span>
        <div className="fmt-header-stats">
          <span className="fmt-stat" title={t.statsTooltip(stats.boundElements, stats.unboundElements, stats.structuralElements)}>
            🏷️ {stats.totalElements} {t.elements}
          </span>
          <span className="fmt-stat fmt-stat-bound" title={`${stats.boundElements} ${t.bound}`}>✓ {stats.boundElements} {t.bound}</span>
          <span className="fmt-stat fmt-stat-unbound" title={`${stats.unboundElements} ${t.unbound}`}>○ {stats.unboundElements} {t.unbound}</span>
          <span className="fmt-stat fmt-stat-structural" title={`${stats.structuralElements} ${t.structural}`}>⬡ {stats.structuralElements} {t.structural}</span>
          <span className="fmt-stat">↔️ {stats.bindings} {bindingsLabel.toLowerCase()} ({groupedBindings.length} {t.elements} / {groupedBindingsByType.length} {groupCountLabel})</span>
          <span className="fmt-stat">📊 {stats.datasources} {dataSourcesLabel.toLowerCase()}</span>
          {stats.enums > 0 && <span className="fmt-stat">🔤 {stats.enums} enums</span>}
          {stats.transformations > 0 && <span className="fmt-stat">🔄 {stats.transformations} {t.transforms}</span>}
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="fmt-toolbar">
        <div style={{ display: 'flex', gap: 4 }}>
          {(['structure', 'bindings', 'datasources'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`fmt-tab-btn ${view === v ? 'active' : ''}`}
            >
              {v === 'structure' ? `${t.structure} (${stats.totalElements})` :
               v === 'bindings' ? `${bindingsLabel} (${groupedBindingsByType.length} ${groupCountLabel})` :
               `${dataSourcesLabel} (${stats.datasources})`}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
          <div className="panel-filter-row">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={t.filter}
              className="fmt-filter-input panel-filter-input"
            />
            {filter && (
              <button
                onClick={() => setFilter('')}
                className="fmt-action-btn"
                title={t.clearFilter}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="designer-context-bar">
        <span className="designer-context-chip">{t.viewLabel}: {currentViewLabel}</span>
        <span className="designer-context-chip">{currentFocusLabel}</span>
        <div className="designer-density-toggle">
          <button className={`fmt-action-btn ${density === 'comfortable' ? 'active' : ''}`} onClick={() => setDensity('comfortable')}>{t.comfortableDensity}</button>
          <button className={`fmt-action-btn ${density === 'compact' ? 'active' : ''}`} onClick={() => setDensity('compact')}>{t.compactDensity}</button>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: tree / list */}
        <div className={`designer-list-pane density-${density}`}>
          {view === 'structure' && (
            <>
              <div className="explorer-toolbar">
                <button
                  onClick={() => {
                    setStructureExpandMode('all');
                    setStructureExpandVersion(version => version + 1);
                  }}
                  className="fmt-action-btn"
                  title={t.expand}
                >
                  {t.expand}
                </button>
                <button
                  onClick={() => {
                    setStructureExpandMode('none');
                    setStructureExpandVersion(version => version + 1);
                  }}
                  className="fmt-action-btn"
                  title={t.collapse}
                >
                  {t.collapse}
                </button>
              </div>
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
                onSelect={setSelectedElementId}
                resolveDatasource={resolveDatasource}
                registry={registry}
                showTechnicalDetails={showTechnicalDetails}
              />
            </>
          )}

          {view === 'bindings' && (
            <>
              <div className="explorer-toolbar">
                <button
                  onClick={expandAllBindingTypeGroups}
                  className="fmt-action-btn"
                  title={t.expand}
                >
                  {t.expand}
                </button>
                <button
                  onClick={collapseAllBindingTypeGroups}
                  className="fmt-action-btn"
                  title={t.collapse}
                >
                  {t.collapse}
                </button>
              </div>
              {groupedBindingsByType.length === 0
                ? <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 16 }}>
                    {filter ? t.noResults : `${t.bindings}: 0`}
                  </div>
                : groupedBindingsByType.map(group => (
                    <div key={group.elementType} className="mm-group">
                      <div className="mm-group-header" onClick={() => toggleBindingTypeGroup(group.elementType)}>
                        <span className={`tree-chevron ${!collapsedBindingTypeGroups.has(group.elementType) ? 'open' : ''}`} />
                        <span className="mm-group-name">{showTechnicalDetails ? group.elementType : getConsultantFormatTypeLabel(group.elementType)}</span>
                        <span className="mm-group-count">{group.rows.length}</span>
                      </div>
                      {!collapsedBindingTypeGroups.has(group.elementType) && group.rows.map(row => (
                        <FormatElementBindingGroup key={row.componentId} row={row} configIndex={configIndex} onNavigate={setSelectedElementId} onReveal={revealFormatElementInExplorer} showTechnicalDetails={showTechnicalDetails} />
                      ))}
                    </div>
                  ))}
            </>
          )}

          {view === 'datasources' && (
            <GroupedDatasourceList datasources={filteredDatasources} configIndex={configIndex} navigateToTreeNode={navigateToTreeNode} />
          )}
        </div>

        {/* Right: Detail Panel */}
        {selectedElement && view === 'structure' && (
          <div className={`fmt-detail-panel density-${density}`}>
            <div className="fmt-detail-header">
              {showTechnicalDetails && (
                <span style={{ color: getFormatTypeColor(selectedElement.elementType), fontWeight: 700 }}>
                  {selectedElement.elementType}
                </span>
              )}
              <span style={{ fontWeight: 600, marginLeft: 6 }}>{selectedElement.name}</span>
              <button
                onClick={() => revealFormatElementInExplorer(selectedElement.id)}
                className="fmt-action-btn fmt-action-btn-compact fmt-detail-action"
                title={t.openInExplorerAction}
              >
                {t.openInExplorerAction}
              </button>
              <button
                onClick={() => setSelectedElementId(null)}
                className="fmt-detail-close"
              >
                ✕
              </button>
            </div>
            <div className="fmt-detail-body">
              <div className="fmt-detail-section">
                <div className="fmt-detail-section-title fmt-detail-section-toggle" onClick={() => toggleDetailSection('overview')}>
                  <span className={`tree-chevron ${!collapsedDetailSections.has('overview') ? 'open' : ''}`} />
                  {t.detailOverview}
                </div>
                {!collapsedDetailSections.has('overview') && <div className="fmt-summary-grid">
                  <div className="fmt-summary-card">
                    <span className="fmt-summary-label">{showTechnicalDetails ? t.propType : t.propName}</span>
                    <span className="fmt-summary-value">{showTechnicalDetails ? selectedElement.elementType : selectedElement.name}</span>
                  </div>
                  <div className="fmt-summary-card">
                    <span className="fmt-summary-label">{t.bindings}</span>
                    <span className="fmt-summary-value">{selectedBindings.length}</span>
                  </div>
                  <div className="fmt-summary-card">
                    <span className="fmt-summary-label">{t.propChildren}</span>
                    <span className="fmt-summary-value">{selectedElement.children?.length ?? 0}</span>
                  </div>
                  <div className="fmt-summary-card">
                    <span className="fmt-summary-label">{t.attributes}</span>
                    <span className="fmt-summary-value">{selectedAttributeCount}</span>
                  </div>
                </div>}
              </div>

              {/* Properties */}
              <div className="fmt-detail-section">
                <div className="fmt-detail-section-title fmt-detail-section-toggle" onClick={() => toggleDetailSection('properties')}>
                  <span className={`tree-chevron ${!collapsedDetailSections.has('properties') ? 'open' : ''}`} />
                  {t.properties}
                </div>
                {!collapsedDetailSections.has('properties') && <div className="prop-grid">
                  <div className="prop-label">{t.propName}</div>
                  <div className="prop-value">{selectedElement.name}</div>
                  {showTechnicalDetails && <>
                    <div className="prop-label">{t.propId}</div>
                    <div className="prop-value guid">{selectedElement.id}</div>
                    <div className="prop-label">{t.propType}</div>
                    <div className="prop-value">{selectedElement.elementType}</div>
                  </>}
                  {showTechnicalDetails && selectedElement.encoding && <>
                    <div className="prop-label">{t.propEncoding}</div>
                    <div className="prop-value">{selectedElement.encoding}</div>
                  </>}
                  {showTechnicalDetails && selectedElement.maximalLength != null && <>
                    <div className="prop-label">{t.propMaxLen}</div>
                    <div className="prop-value">{selectedElement.maximalLength}</div>
                  </>}
                  {selectedElement.value && <>
                    <div className="prop-label">{t.propValue}</div>
                    <div className="prop-value expression">{selectedElement.value}</div>
                  </>}
                  {showTechnicalDetails && selectedElement.transformation && <>
                    <div className="prop-label">{t.propTransform}</div>
                    <div className="prop-value">
                      {transformationMap.get(selectedElement.transformation)?.name ?? selectedElement.transformation}
                    </div>
                  </>}
                  {showTechnicalDetails && selectedElement.excludedFromDataSource && <>
                    <div className="prop-label">{t.propExcluded}</div>
                    <div className="prop-value">{t.propYes}</div>
                  </>}
                  {/* Extra attributes */}
                  {showTechnicalDetails && Object.entries(selectedElement.attributes ?? {})
                    .filter(([k]) => !['Encoding', 'MaximalLength', 'Value', 'Transformation', 'ExcludedFromDataSource'].includes(k))
                    .map(([k, v]) => (
                    <React.Fragment key={k}>
                      <div className="prop-label">{k}</div>
                      <div className="prop-value">{String(v)}</div>
                    </React.Fragment>
                  ))}
                </div>}
              </div>

              {/* Bindings for this element */}
              {selectedBindings.length > 0 && (
                <div className="fmt-detail-section">
                  <div className="fmt-detail-section-title fmt-detail-section-toggle" onClick={() => toggleDetailSection('bindings')}>
                    <span className={`tree-chevron ${!collapsedDetailSections.has('bindings') ? 'open' : ''}`} />
                    {t.bindings} ({selectedBindings.length})
                  </div>
                  {!collapsedDetailSections.has('bindings') && selectedBindingCategories.map(category => (
                    <div key={category.key}>
                      <div className="fmt-detail-subsection-title">{category.label} ({category.bindings.length})</div>
                      {category.bindings.map((b, i) => (
                        <div key={`${category.key}-${i}`} className="fmt-detail-binding">
                          <span className={`badge ${category.key === 'data' ? 'badge-success' : 'badge-prop'}`} style={{ marginRight: 6 }}>
                            {b.bindingDisplayLabel}
                          </span>
                          {showTechnicalDetails && b.promotedFromChild && b.rawElementType && (
                            <span className="fmt-binding-origin">via {b.rawElementType}</span>
                          )}
                          <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11 }}>
                            <ClickablePath expression={b.expressionAsString} configIndex={configIndex} mode="binding-expr" />
                          </div>
                          <DrillDownPanel
                            expression={b.expressionAsString}
                            configIndex={configIndex}
                            elementName={selectedElement.name}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Children summary */}
              {selectedElement.children?.length > 0 && (
                <div className="fmt-detail-section">
                  <div className="fmt-detail-section-title fmt-detail-section-toggle" onClick={() => toggleDetailSection('children')}>
                    <span className={`tree-chevron ${!collapsedDetailSections.has('children') ? 'open' : ''}`} />
                    {t.propChildren} ({selectedElement.children.length})
                  </div>
                  {!collapsedDetailSections.has('children') && selectedElement.children.map((child: any, i: number) => (
                    <div
                      key={i}
                      className="fmt-detail-child"
                      onClick={() => setSelectedElementId(child.id)}
                    >
                      {showTechnicalDetails && (
                        <span style={{ color: getFormatTypeColor(child.elementType), fontSize: 11 }}>
                          {child.elementType}
                        </span>
                      )}
                      <span style={{ marginLeft: 6 }}>{child.name}</span>
                      {bindingMap.has(child.id) && <span style={{ marginLeft: 'auto', color: 'var(--success)', fontSize: 10 }}>●</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Format type detection ──

interface FormatTypeInfo {
  label: string;
  icon: string;
  color: string;
  bg: string;
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
  return { label: et || 'File', icon: '📁', color: 'var(--surface-success-fg)', bg: 'var(--surface-success-bg)' };
}

function FormatTypeBadge({ rootElement }: { rootElement: any }) {
  const info = detectFormatType(rootElement);
  return (
    <span style={{
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
    }}>
      <span>{info.icon}</span>
      <span>{info.label}</span>
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
  TextSequence: '📑',
  TextLine: '📝',
  WordFile: '📄',
  PDFFile: '📕',
};

// ── Recursive Format Element Tree ──

interface FormatElementTreeProps {
  element: any;
  depth: number;
  bindingMap: Map<string, any[]>;
  transformationMap: Map<string, any>;
  configIndex: number;
  filter: string;
  expandMode: 'all' | 'none';
  expandVersion: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  resolveDatasource: (name: string, ci: number) => any;
  registry: any;
  showTechnicalDetails: boolean;
}

function FormatElementTree({ element, depth, bindingMap, transformationMap, configIndex, filter, expandMode, expandVersion, selectedId, onSelect, resolveDatasource, registry, showTechnicalDetails }: FormatElementTreeProps) {
  const [expanded, setExpanded] = useState(expandMode === 'all');
  const [hoverBinding, setHoverBinding] = useState<any | null>(null);

  useEffect(() => {
    setExpanded(expandMode === 'all');
  }, [expandMode, expandVersion]);

  const bindings = bindingMap.get(element.id) ?? [];
  const bindingCategories = useMemo(() => groupFormatBindingsByCategory(bindings), [bindings]);
  const mainBinding = bindings.find(b => b.bindingCategory === 'data');
  const conditionalBindings = bindings.filter(b => b.bindingCategory !== 'data');
  const transformation = element.transformation ? transformationMap.get(element.transformation) : null;
  const hasChildren = element.children && element.children.length > 0;

  const isExpanded = expanded;

  // Filter matching
  const matchesFilter = !filter || element.name.toLowerCase().includes(filter.toLowerCase()) ||
    element.elementType.toLowerCase().includes(filter.toLowerCase()) ||
    bindings.some((b: any) => b.expressionAsString.toLowerCase().includes(filter.toLowerCase()));

  // Check if any descendant matches
  const descendantMatches = useMemo(() => {
    if (!filter) return true;
    const check = (el: any): boolean => {
      if (el.name.toLowerCase().includes(filter.toLowerCase())) return true;
      if (el.elementType.toLowerCase().includes(filter.toLowerCase())) return true;
      const elBindings = bindingMap.get(el.id) ?? [];
      if (elBindings.some((b: any) => b.expressionAsString.toLowerCase().includes(filter.toLowerCase()))) return true;
      return el.children?.some(check) ?? false;
    };
    return check(element);
  }, [filter, element, bindingMap]);

  if (filter && !matchesFilter && !descendantMatches) return null;

  const isSelected = selectedId === element.id;

  return (
    <div>
      {/* Element Row */}
      <div
        className={`fmt-element-row ${isSelected ? 'selected' : ''} ${!mainBinding ? 'unbound' : ''}`}
        style={{ paddingLeft: depth * 20 + 4 }}
        onClick={() => onSelect(element.id)}
      >
        {/* Expand/Collapse Toggle */}
        <span
          className="fmt-toggle"
          onClick={e => { e.stopPropagation(); if (hasChildren) setExpanded(!expanded); }}
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
            {element.elementType}
          </span>
        )}

        {/* Element Name */}
        <span className="fmt-element-name">{element.name}</span>

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
          <span className="fmt-transform" title={`Transform: ${transformation.expressionAsString}`}>
            🔄 {transformation.name}
          </span>
        )}

        {/* Conditional Bindings indicators */}
        {conditionalBindings.length > 0 && conditionalBindings.map((cb: any, i: number) => (
          <span key={i} className="fmt-cond-badge" title={`${cb.bindingDisplayLabel}: ${cb.expressionAsString}`}>
            {cb.bindingDisplayLabel}
          </span>
        ))}

        {/* Main Binding — the original formula shown inline */}
        {mainBinding && (
          <span className="fmt-binding-inline" onClick={e => e.stopPropagation()}>
            ← <ClickablePath expression={mainBinding.expressionAsString} configIndex={configIndex} mode="binding-expr" />
          </span>
        )}

        {/* Unbound indicator — leaf element with no data binding */}
        {!mainBinding && hasChildren === false && (
          <span className="fmt-unbound-marker">○ unbound</span>
        )}
      </div>

      {/* Expanded Binding Details — shown when element is selected */}
      {isSelected && (
        <div className="fmt-binding-expanded" style={{ marginLeft: depth * 20 + 28 }}>
          {bindings.length === 0 ? (
            <div className="fmt-drill-hint fmt-drill-hint-unbound">
              {t.drillUnbound}
            </div>
          ) : bindingCategories.map(category => (
            <div key={category.key}>
              <div className="fmt-binding-category-title">{category.label} ({category.bindings.length})</div>
              {category.bindings.map((b: any, i: number) => (
                <div key={`${category.key}-${i}`} className="fmt-binding-detail-row">
                  <span className={`badge ${category.key === 'data' ? 'badge-success' : 'badge-prop'}`}>{b.bindingDisplayLabel}</span>
                  {showTechnicalDetails && b.promotedFromChild && b.rawElementType && (
                    <span className="fmt-binding-origin">via {b.rawElementType}</span>
                  )}
                  <span className="fmt-binding-formula">
                    <ClickablePath expression={b.expressionAsString} configIndex={configIndex} mode="binding-expr" />
                  </span>
                  <DrillDownPanel
                    expression={b.expressionAsString}
                    configIndex={configIndex}
                    elementName={element.name}
                  />
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
          expandMode={expandMode}
          expandVersion={expandVersion}
          selectedId={selectedId}
          onSelect={onSelect}
          resolveDatasource={resolveDatasource}
          registry={registry}
          showTechnicalDetails={showTechnicalDetails}
        />
      ))}
    </div>
  );
}

// ── Inline Datasource Resolution for Bindings ──

function FormatBindingDetail({ expression, configIndex, resolveDatasource }: {
  expression: string;
  configIndex: number;
  resolveDatasource: (name: string, ci: number) => any;
}) {
  const [expanded, setExpanded] = useState(true);
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const configurations = useAppStore(s => s.configurations);

  // Check if this is a model reference (e.g. "model.CompanyInformation.Name")
  const isModelRef = expression.toLowerCase().startsWith('model.') || expression.toLowerCase().startsWith('model\\');

  // Does ANY loaded config provide a ModelMapping?
  const hasModelMapping = useMemo(
    () => configurations.some(c => c.content.kind === 'ModelMapping'),
    [configurations]
  );

  const modelResult = useMemo(
    () => (isModelRef ? resolveModelPath(expression) : null),
    [isModelRef, expression, resolveModelPath]
  );

  // Extract root datasource name for direct DS resolution
  const dsName = expression.split(/[.\\/]/)[0].split('(')[0].replace(/['"]/g, '').trim();
  const directResult = (!isModelRef && dsName && dsName !== 'model')
    ? resolveDatasource(dsName, configIndex)
    : null;

  // Deep resolution: trace the full expression through nested DS and calculated fields
  const deepResult = useMemo(() => {
    // For direct (non-model) references, try the full expression immediately
    if (!isModelRef) {
      const result = resolveDeepExpression(expression, configurations, configIndex);
      if (result && (result.involvedDatasources.length > 0 || result.calculatedFieldChain.length > 0)) {
        return result;
      }
    }
    // If this is a model ref and a ModelMapping resolved it, deep-resolve the mapping expression
    if (modelResult?.binding?.expressionAsString) {
      const bindingExpr = modelResult.binding.expressionAsString;
      const bindingCi = modelResult.bindingConfigIndex;
      const r = resolveDeepExpression(bindingExpr, configurations, bindingCi);
      if (r && (r.involvedDatasources.length > 0 || r.calculatedFieldChain.length > 0)) {
        return r;
      }
    }
    return null;
  }, [isModelRef, expression, configurations, configIndex, modelResult]);

  const hasMappingInfo = modelResult != null;
  const hasDirectDs = directResult != null;
  const hasDeepInfo = deepResult != null && (deepResult.involvedDatasources.length > 0 || deepResult.calculatedFieldChain.length > 0);

  // Collect actual binding paths from loaded ModelMappings (for debug when not found)
  const mappingDebugInfo = useMemo(() => {
    if (!isModelRef || !hasModelMapping) return null;
    const info: { configName: string; samplePaths: string[]; totalBindings: number }[] = [];
    for (const cfg of configurations) {
      if (cfg.content.kind !== 'ModelMapping') continue;
      const mm = (cfg.content as any).version.mapping;
      info.push({
        configName: cfg.solutionVersion.solution.name,
        totalBindings: mm.bindings.length,
        samplePaths: mm.bindings.slice(0, 12).map((b: any) => b.path).filter(Boolean),
      });
    }
    return info;
  }, [isModelRef, hasModelMapping, configurations]);

  // ── Model ref but no ModelMapping loaded ──
  if (isModelRef && !hasModelMapping) {
    return (
      <div className="fmt-drill-hint">
        📋 Toto je odkaz na model (<code>model.*</code>). Pro drill-down načti soubor{' '}
        <strong>ModelMapping</strong> (.xml) odpovídající tomuto formátu.
      </div>
    );
  }

  // ── Model ref + ModelMapping loaded but path not found ──
  if (isModelRef && hasModelMapping && !hasMappingInfo) {
    const cleanPath = expression.startsWith('model.') ? expression.slice(6) : expression.slice(6);
    return (
      <div className="fmt-drill-hint fmt-drill-hint-warn">
        <div style={{ marginBottom: 4 }}>
          ⚠️ Cesta <code>{cleanPath}</code> nebyla nalezena v ModelMapping.
        </div>
        {mappingDebugInfo?.map((info, i) => (
          <div key={i} className="fmt-debug-paths">
            <div className="fmt-debug-paths-title">
              {info.configName} — {info.totalBindings} binding{info.totalBindings !== 1 ? 's' : ''}
              {info.totalBindings > 12 ? ' (prvních 12)' : ''}:
            </div>
            {info.samplePaths.length === 0
              ? <div className="fmt-debug-path-empty">žádné binding paths</div>
              : info.samplePaths.map((p, j) => <div key={j} className="fmt-debug-path-item">{p}</div>)
            }
          </div>
        ))}
      </div>
    );
  }

  if (!hasMappingInfo && !hasDirectDs && !hasDeepInfo) return null;

  const summaryParts: string[] = [];
  if (hasMappingInfo) {
    summaryParts.push(`📋 ${modelResult!.binding.expressionAsString}`);
    if (modelResult!.datasource) {
      const ds = modelResult!.datasource;
      if (ds.tableInfo) summaryParts.push(`→ 🗃️ ${ds.tableInfo.tableName}`);
      else if (ds.enumInfo) summaryParts.push(`→ 🔤 ${formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo)}`);
      else if (ds.classInfo) summaryParts.push(`→ ⚙️ ${ds.classInfo.className}`);
      else if (ds.calculatedField) summaryParts.push(`→ 🧮 calc`);
      else summaryParts.push(`→ 📊 ${ds.name}`);
    }
  } else if (hasDirectDs) {
    const ds = directResult!.datasource;
    summaryParts.push(`📊 ${dsName}`);
    if (ds.tableInfo) summaryParts.push(`→ 🗃️ ${ds.tableInfo.tableName}`);
    else if (ds.enumInfo) summaryParts.push(`→ 🔤 ${formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo)}`);
    else if (ds.classInfo) summaryParts.push(`→ ⚙️ ${ds.classInfo.className}`);
  }
  if (hasDeepInfo) {
    const tables = deepResult!.involvedDatasources.filter(d => d.tableName);
    const classes = deepResult!.involvedDatasources.filter(d => d.className);
    const enums = deepResult!.involvedDatasources.filter(d => d.enumName);
    if (tables.length > 0) summaryParts.push(`🗃️ ${tables.length} table${tables.length > 1 ? 's' : ''}`);
    if (classes.length > 0) summaryParts.push(`⚙️ ${classes.length} class${classes.length > 1 ? 'es' : ''}`);
    if (enums.length > 0) summaryParts.push(`🔤 ${enums.length} enum${enums.length > 1 ? 's' : ''}`);
    if (deepResult!.calculatedFieldChain.length > 0) summaryParts.push(`🧮 ${deepResult!.calculatedFieldChain.length} calc field${deepResult!.calculatedFieldChain.length > 1 ? 's' : ''}`);
  }

  return (
    <div className="fmt-ds-resolved">
      <span
        className="fmt-ds-toggle"
        onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
        title="Show datasource details"
      >
        {summaryParts.join(' ')} <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
      </span>
      {expanded && (
        <div className="fmt-ds-details">
          {hasMappingInfo && (
            <>
              <div><span className="fmt-ds-label">Model path:</span> {modelResult!.modelPath}</div>
              <div><span className="fmt-ds-label">Mapping expr:</span> <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{modelResult!.binding.expressionAsString}</span></div>
              {modelResult!.datasource && (() => {
                const ds = modelResult!.datasource;
                return (
                  <>
                    <div><span className="fmt-ds-label">DS Name:</span> {ds.name}</div>
                    <div><span className="fmt-ds-label">DS Type:</span> {ds.type}</div>
                    {ds.tableInfo && (
                      <>
                        <div><span className="fmt-ds-label">Table:</span> <strong>{ds.tableInfo.tableName}</strong></div>
                        {ds.tableInfo.isCrossCompany && <div><span className="fmt-ds-label">Cross-Company:</span> Yes</div>}
                        {ds.tableInfo.selectedFields?.length > 0 && <div><span className="fmt-ds-label">Fields:</span> {ds.tableInfo.selectedFields.join(', ')}</div>}
                      </>
                    )}
                    {ds.enumInfo && (
                      <div><span className="fmt-ds-label">Enum:</span> <strong>{formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo)}</strong></div>
                    )}
                    {ds.classInfo && (
                      <div><span className="fmt-ds-label">Class:</span> <strong>{ds.classInfo.className}</strong></div>
                    )}
                    {ds.calculatedField?.expressionAsString && (
                      <div>
                        <span className="fmt-ds-label">Formula:</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--syn-calc)' }}>
                          {ds.calculatedField.expressionAsString}
                        </span>
                      </div>
                    )}
                    {ds.children?.length > 0 && (
                      <div><span className="fmt-ds-label">Nested DS:</span> {ds.children.map((c: any) => c.name).join(', ')}</div>
                    )}
                  </>
                );
              })()}
            </>
          )}
          {!hasMappingInfo && hasDirectDs && (() => {
            const ds = directResult!.datasource;
            return (
              <>
                <div><span className="fmt-ds-label">Name:</span> {ds.name}</div>
                <div><span className="fmt-ds-label">Type:</span> {ds.type}</div>
                {ds.tableInfo && (
                  <>
                    <div><span className="fmt-ds-label">Table:</span> <strong>{ds.tableInfo.tableName}</strong></div>
                    {ds.tableInfo.isCrossCompany && <div><span className="fmt-ds-label">Cross-Company:</span> Yes</div>}
                  </>
                )}
                {ds.enumInfo && <div><span className="fmt-ds-label">Enum:</span> <strong>{formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo)}</strong></div>}
                {ds.classInfo && <div><span className="fmt-ds-label">Class:</span> <strong>{ds.classInfo.className}</strong></div>}
                {ds.calculatedField?.expressionAsString && (
                  <div>
                    <span className="fmt-ds-label">Formula:</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--syn-calc)' }}>
                      {ds.calculatedField.expressionAsString}
                    </span>
                  </div>
                )}
              </>
            );
          })()}

          {/* ── Deep Dependency Analysis ── */}
          {hasDeepInfo && (
            <div className="fmt-deep-deps">
              <div className="fmt-deep-deps-title">🔍 Dependency Analysis</div>

              {/* Calculated Field Chain */}
              {deepResult!.calculatedFieldChain.length > 0 && (
                <div className="fmt-deep-section">
                  <div className="fmt-deep-section-title">🧮 Calculated Field Chain</div>
                  {deepResult!.calculatedFieldChain.map((cf, i) => (
                    <div key={i} className="fmt-deep-calc-item">
                      <span className="fmt-deep-calc-name">{cf.name}</span>
                      <span className="fmt-deep-calc-formula">{cf.formula}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Involved Tables */}
              {(() => {
                const tables = deepResult!.involvedDatasources.filter(d => d.tableName);
                if (tables.length === 0) return null;
                return (
                  <div className="fmt-deep-section">
                    <div className="fmt-deep-section-title">🗃️ Tables ({tables.length})</div>
                    {tables.map((d, i) => (
                      <div key={i} className="fmt-deep-dep-item">
                        <span className="badge badge-table">{d.type}</span>
                        <span className="fmt-deep-dep-name">{d.name}</span>
                        <span className="fmt-deep-dep-target">→ {d.tableName}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Involved Classes */}
              {(() => {
                const classes = deepResult!.involvedDatasources.filter(d => d.className);
                if (classes.length === 0) return null;
                return (
                  <div className="fmt-deep-section">
                    <div className="fmt-deep-section-title">⚙️ Classes ({classes.length})</div>
                    {classes.map((d, i) => (
                      <div key={i} className="fmt-deep-dep-item">
                        <span className="badge badge-class">{d.type}</span>
                        <span className="fmt-deep-dep-name">{d.name}</span>
                        <span className="fmt-deep-dep-target">→ {d.className}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Involved Enums */}
              {(() => {
                const enums = deepResult!.involvedDatasources.filter(d => d.enumName);
                if (enums.length === 0) return null;
                return (
                  <div className="fmt-deep-section">
                    <div className="fmt-deep-section-title">🔤 Enumerations ({enums.length})</div>
                    {enums.map((d, i) => (
                      <div key={i} className="fmt-deep-dep-item">
                        <span className="badge badge-enum">{d.type}</span>
                        <span className="fmt-deep-dep-name">{d.name}</span>
                        <span className="fmt-deep-dep-target">→ {formatEnumDisplayName(d.enumName!, d)}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Binding Row (for Bindings tab) ──

// ── Grouped binding row: shows element name + data binding + optional property bindings ──

function FormatElementBindingGroup({ row, configIndex, onNavigate, onReveal, showTechnicalDetails }: {
  row: any;
  configIndex: number;
  onNavigate: (elementId: string) => void;
  onReveal?: (elementId: string) => void;
  showTechnicalDetails: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalBindings = row.categories.reduce((count: number, category: any) => count + category.bindings.length, 0);

  return (
    <div className="mapping-row-group">
      {/* Main row: element header */}
      <div
        className="mapping-row mapping-row-clickable"
        onClick={() => onNavigate(row.componentId)}
        title={`Navigate to ${row.elementName}`}
      >
        {/* Left: type badge + element name */}
        <div className="mapping-row-path" style={{ minWidth: 180, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {showTechnicalDetails && (
            <span
              className="badge"
              style={{
                color: getFormatTypeColor(row.elementType),
                border: '1px solid currentColor',
                background: getFormatTypeBadgeSurface(row.elementType),
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 3,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                flexShrink: 0,
              }}
            >
              {row.elementType}
            </span>
          )}
          <span style={{ fontWeight: 600, color: 'var(--syn-resolved)' }}>{row.elementName}</span>
        </div>

        <div className="mapping-row-arrow">↕</div>

        <div className="mapping-row-expr" style={{ flex: 1, overflow: 'hidden', color: 'var(--text-secondary)' }}>
          {totalBindings} grouped binding{totalBindings === 1 ? '' : 's'}
        </div>

        {onReveal && (
          <button
            className="fmt-action-btn fmt-action-btn-compact binding-row-action"
            onClick={e => { e.stopPropagation(); onReveal(row.componentId); }}
            title={t.openInExplorerAction}
          >
            {t.openInExplorerAction}
          </button>
        )}

        <span
          title={expanded ? 'Collapse grouped bindings' : 'Expand grouped bindings'}
          onClick={e => { e.stopPropagation(); setExpanded(value => !value); }}
          style={{ marginLeft: 6, flexShrink: 0, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none', padding: '0 4px' }}
        >
          <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
        </span>
      </div>

      {/* Grouped category bindings */}
      {expanded && (
        <div style={{ paddingLeft: 16, borderLeft: '2px solid var(--border-color)', marginLeft: 8, marginBottom: 2 }}>
          {row.categories.map((category: any) => (
            <div key={category.key}>
              <div className="fmt-binding-category-title">{category.label} ({category.bindings.length})</div>
              {category.bindings.map((binding: any, i: number) => (
                <div key={`${category.key}-${i}`} className="mapping-row" style={{ paddingTop: 2, paddingBottom: 2, minHeight: 'unset' }}>
                  <div style={{ minWidth: 180, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span className={`badge ${category.key === 'data' ? 'badge-success' : 'badge-prop'}`} style={{ fontSize: 9 }}>{binding.bindingDisplayLabel}</span>
                    {showTechnicalDetails && binding.promotedFromChild && binding.rawElementType && (
                      <span className="fmt-binding-origin">via {binding.rawElementType}</span>
                    )}
                  </div>
                  <div className="mapping-row-arrow" style={{ color: 'var(--text-secondary)' }}>←</div>
                  <div className="mapping-row-expr" style={{ flex: 1 }}>
                    <ClickablePath expression={binding.expressionAsString} configIndex={configIndex} mode="binding-expr" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveTabNodeSummary({ node, configIndex }: { node: any; configIndex: number }) {
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const summaryRows: Array<[string, React.ReactNode]> = [[t.node, node.name]];

  if (showTechnicalDetails) summaryRows.push([t.propType, node.type]);
  if (showTechnicalDetails && node.data?.elementType) summaryRows.push([t.elementType, node.data.elementType]);
  if (showTechnicalDetails && node.data?.type && node.type === 'datasource') summaryRows.push([t.datasourceType, node.data.type]);
  if (node.data?.path) summaryRows.push([t.path, <ClickablePath expression={node.data.path} configIndex={configIndex} mode="model-path" />]);
  if (node.data?.expressionAsString) summaryRows.push([t.expression, <ClickablePath expression={node.data.expressionAsString} configIndex={configIndex} mode="binding-expr" />]);
  if (node.data?.tableInfo?.tableName) summaryRows.push([t.drillLabelTable, node.data.tableInfo.tableName]);
  if (node.data?.enumInfo?.enumName) summaryRows.push([t.drillLabelEnum, formatEnumDisplayName(node.data.enumInfo.enumName, node.data.enumInfo)]);
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

// ── (legacy, kept for ModelMapping bindings tab) ──

function FormatBindingRow({ binding, configIndex, registry, onNavigate }: {
  binding: any;
  configIndex: number;
  registry: any;
  onNavigate: (elementId: string) => void;
}) {
  // Look up the format element name by componentId
  const elementName = registry.lookup(binding.componentId)?.name ?? binding.componentId.substring(0, 8);

  return (
    <div className="mapping-row mapping-row-clickable" onClick={() => onNavigate(binding.componentId)}>
      <div className="mapping-row-path" style={{ minWidth: 150 }}>
        <span style={{ color: 'var(--syn-resolved)', fontWeight: 600 }}>{elementName}</span>
        {binding.propertyName && <span className="badge badge-prop" style={{ marginLeft: 4 }}>{binding.propertyName}</span>}
      </div>
      <div className="mapping-row-arrow">←</div>
      <div className="mapping-row-expr">
        <ClickablePath expression={binding.expressionAsString} configIndex={configIndex} mode="binding-expr" />
      </div>
    </div>
  );
}

// Maps datasource type → an existing badge CSS class
function getDsBadgeClass(type: string): string {
  const map: Record<string, string> = {
    Table: 'badge-table',
    CalculatedField: 'badge-calc',
    Class: 'badge-class',
    Enum: 'badge-enum',
    ModelEnum: 'badge-enum',
    FormatEnum: 'badge-enum',
    UserParameter: 'badge-param',
    GroupBy: 'badge-table',
    Container: 'badge-export',
    Export: 'badge-export',
    Import: 'badge-import',
  };
  return map[type] ?? 'badge-xml';
}

// ── Datasource Row (for Data Sources tab) ──

function FormatDatasourceRow({ ds, configIndex, navigateToTreeNode }: {
  ds: any;
  configIndex: number;
  navigateToTreeNode: (nodeId: string) => void;
}) {
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const [expanded, setExpanded] = useState(false);

  // Build human-readable target string
  let targetLabel: string | null = null;
  if (ds.tableInfo) {
    targetLabel = ds.tableInfo.tableName;
    if (showTechnicalDetails && ds.tableInfo.isCrossCompany) targetLabel += ' (cross-company)';
    if (showTechnicalDetails && ds.tableInfo.selectedFields?.length) targetLabel += ` [${ds.tableInfo.selectedFields.join(', ')}]`;
  } else if (ds.enumInfo) {
    targetLabel = formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo);
  } else if (ds.classInfo) {
    targetLabel = ds.classInfo.className;
  } else if (ds.calculatedField) {
    targetLabel = ds.calculatedField.expressionAsString ?? '';
  }

  return (
    <div className="ds-row-wrap">
      <div
        className="ds-row"
        onClick={() => {
          const nodeId = findDatasourceNode(ds.name, configIndex);
          if (nodeId) navigateToTreeNode(nodeId);
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
              title={`${ds.children.length} nested datasource${ds.children.length > 1 ? 's' : ''}`}
              onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
            >
              {ds.children.length} <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
            </span>
          )}
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
      {/* Nested children (indented) */}
      {expanded && ds.children?.map((child: any, i: number) => (
        <div key={i} style={{ paddingLeft: 12, borderLeft: '2px solid var(--border-color)', marginLeft: 8 }}>
          <FormatDatasourceRow ds={child} configIndex={configIndex} navigateToTreeNode={navigateToTreeNode} />
        </div>
      ))}
    </div>
  );
}

// ── Grouped Datasource List ──

const dsGroupOrder = ['Table', 'CalculatedField', 'Class', 'Enum', 'ModelEnum', 'FormatEnum', 'UserParameter', 'GroupBy', 'Container'];
const dsGroupLabels: Record<string, string> = {
  Table: '🗃️ Tables',
  CalculatedField: '🧮 Calculated Fields',
  Class: '⚙️ Classes',
  Enum: '🔤 Ax Enums',
  ModelEnum: '📋 Data model Enums',
  FormatEnum: '🏷️ Format enums',
  UserParameter: '👤 User Parameters',
  GroupBy: '📊 Group By',
  Container: '📦 Containers',
};

function GroupedDatasourceList({ datasources, configIndex, navigateToTreeNode }: {
  datasources: any[];
  configIndex: number;
  navigateToTreeNode: (nodeId: string) => void;
}) {
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

  useEffect(() => {
    if (groups.length === 0) return;
    setCollapsedGroups(prev => prev.size > 0 ? prev : new Set(groups.map(([type]) => type)));
  }, [groups]);

  return (
    <div>
      {groups.length > 0 && (
        <div className="explorer-toolbar" style={{ paddingLeft: 10, paddingRight: 10 }}>
          <button className="fmt-action-btn" onClick={expandAllGroups} title="Expand all datasource groups">
            Expand All
          </button>
          <button className="fmt-action-btn" onClick={collapseAllGroups} title="Collapse all datasource groups">
            Collapse All
          </button>
        </div>
      )}
      {groups.map(([type, items]) => {
        const isCollapsed = collapsedGroups.has(type);
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
              <FormatDatasourceRow key={i} ds={ds} configIndex={configIndex} navigateToTreeNode={navigateToTreeNode} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function fieldTypeLabel(type: number): string {
  const map: Record<number, string> = {
    1: 'Bool', 3: 'Int64', 4: 'Int', 5: 'Real',
    6: 'Str', 7: 'Date', 9: 'Enum', 10: 'Rec',
    11: 'RecList', 13: 'Binary',
  };
  return map[type] ?? '?';
}
