import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataBarVerticalFilled } from '@fluentui/react-icons';
import { DataModelList } from './DataModelList';
import { DataModelGraph } from './DataModelGraph';
import { FilterField } from '../FilterField';
import { useAppStore, resolveDeepExpression } from '../../state/store';
import { ClickablePath } from '../ClickablePath';
import { DrillDownTrigger } from '../DrillDownPanel';
import { t } from '../../i18n';
import { type ERConfiguration, type ERDataModelContent } from '@er-visualizer/core';
import { ExpressionDetailLink, SlidingTabs, enumLabelFor } from './shared';

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
  const [listFilter, setListFilter] = useState('');
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
          {t.dmDesignerTitle}
        </span>
        <div className="fmt-header-stats">
          <span className="fmt-stat" style={{ color: 'var(--er-model)' }}>{t.statsRoots(stats.roots)}</span>
          <span className="fmt-stat">{t.statsRecords(stats.records)}</span>
          <span className="fmt-stat" style={{ color: 'var(--er-format)' }}>{t.statsEnums(stats.enums)}</span>
          <span className="fmt-stat">{t.statsFields(stats.fields)}</span>
          <span className="fmt-stat">{t.statsRelations(stats.edges)}</span>
        </div>
      </div>
      {/* List / Graph as tabs in the toolbar row, like the sub-views of the
          format and mapping designers: tabs on the left never move, the filter
          (list only) takes the right edge. */}
      <div className="fmt-toolbar">
        <SlidingTabs
          tabs={[
            { id: 'list' as const, label: t.modelViewList },
            { id: 'graph' as const, label: t.modelViewGraph },
          ]}
          activeId={view}
          onChange={chooseView}
        />
        {view === 'list' && (
          <FilterField
            value={listFilter}
            onChange={setListFilter}
            placeholder={t.modelListFilterPlaceholder}
            ariaLabel={t.modelListFilterPlaceholder}
            style={{ width: 180, marginLeft: 'auto' }}
          />
        )}
      </div>
      {view === 'list' ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <DataModelList containers={dm.containers} configIndex={configIndex} filter={listFilter} />
        </div>
      ) : (
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataModelGraph containers={dm.containers} selectedId={selectedId} showTechnicalDetails={showTechnicalDetails} />
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
            <span className="focused-detail-card__title">{t.dmDatasourceProperties}</span>
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
            <div className="focused-detail-empty">{t.dmNoRelevantBindings}</div>
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
