import React, { useCallback, useMemo, useRef } from 'react';
import { ArrowDownloadRegular, WarningRegular, InfoRegular } from '@fluentui/react-icons';
import { useAppStore } from '../../state/store';
import { t, useLocale } from '../../i18n';
import { useVirtualTree } from '../../utils/use-virtual-tree';
import { buildLabelPool, labelDisplayText, labelLanguageTag } from '../../utils/label-resolver';
import { getConsultantDataTypeLabel } from '../../utils/consultant-labels';
import { primaryValueSources, specificationRows, type ElementFill, type FillKind, type FormatLineage } from '../../utils/format-lineage';
import { buildFieldSpecCsv, downloadTextFile, safeFileName } from '../../utils/field-spec-export';
import { normalizeGuid } from '../../utils/format-binding-display';
import { DrillDownTrigger } from '../DrillDownPanel';
import { ClickablePath } from '../ClickablePath';
import { FormatElementIcon } from './format-type';
import { HighlightMatch } from './shared';
import { ElementBadges, FillKindPill, isUnmappedLink, SourceChips, TypeCell, UnmappedMark } from './lineage-parts';

export type SpecMode = 'all' | 'fields' | 'unbound' | 'calculated' | 'conditional' | 'repeating';
const MODES: SpecMode[] = ['all', 'fields', 'unbound', 'calculated', 'conditional', 'repeating'];
const SUMMARY_KINDS: FillKind[] = ['model', 'calculated', 'datasource', 'constant', 'unbound'];

function matchesMode(row: ElementFill, mode: SpecMode): boolean {
  switch (mode) {
    case 'fields': return row.isField;
    case 'unbound': return row.isField && row.fill === 'unbound';
    case 'calculated': return row.fill === 'calculated' || row.fill === 'datasource';
    case 'conditional': return row.conditions.length > 0;
    case 'repeating': return row.repeating;
    default: return true;
  }
}

function matchesText(row: ElementFill, needle: string, labelOf: (ref?: string) => string | undefined): boolean {
  if (!needle) return true;
  const haystack = [
    row.displayName,
    row.binding,
    ...row.conditions,
    ...row.modelLinks.map(link => link.path),
    ...row.modelLinks.map(link => labelOf(link.field?.label)),
    ...row.modelLinks.map(link => link.fill?.expression),
    ...row.sources.map(src => src.name),
  ];
  return haystack.some(value => value?.toLowerCase().includes(needle));
}

/**
 * The format as a field specification: one row per element with how it is
 * filled, the model field and mapping behind it, the D365FO source, the
 * conditions and length rules — the table a consultant writes by hand today.
 */
export function FieldSpecView({ lineage, configIndex, filter, mode, onModeChange, scrollRef, selectedId, onSelect, onOpenStructure }: {
  lineage: FormatLineage;
  configIndex: number;
  filter: string;
  mode: SpecMode;
  onModeChange: (mode: SpecMode) => void;
  scrollRef: React.RefObject<HTMLElement | null>;
  selectedId: string | null;
  onSelect: (elementId: string) => void;
  onOpenStructure: (elementId: string) => void;
}) {
  const locale = useLocale();
  const configurations = useAppStore(s => s.configurations);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);

  const labels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);
  const labelOf = useCallback((ref?: string) => {
    if (!ref) return undefined;
    const text = labelDisplayText(ref, labels, labelLanguageTag(locale));
    return text && text !== ref ? text : undefined;
  }, [labels, locale]);

  const allRows = useMemo(() => specificationRows(lineage), [lineage]);
  const needle = filter.trim().toLowerCase();

  /* Matching rows keep their ancestors on screen (dimmed), so a field is
     never shown without the section it sits in. */
  const rows = useMemo(() => {
    if (mode === 'all' && !needle) return allRows.map(row => ({ row, context: false }));
    const keep = new Set<string>();
    const parentOf = new Map<string, string | undefined>();
    for (const row of allRows) parentOf.set(normalizeGuid(row.id), row.parentId ? normalizeGuid(row.parentId) : undefined);
    const hits = new Set<string>();
    for (const row of allRows) {
      if (matchesMode(row, mode) && matchesText(row, needle, labelOf)) {
        const id = normalizeGuid(row.id);
        hits.add(id);
        let up: string | undefined = id;
        while (up && !keep.has(up)) { keep.add(up); up = parentOf.get(up); }
      }
    }
    return allRows
      .filter(row => keep.has(normalizeGuid(row.id)))
      .map(row => ({ row, context: !hits.has(normalizeGuid(row.id)) }));
  }, [allRows, mode, needle, labelOf]);

  const modeCounts = useMemo(() => {
    const counts = {} as Record<SpecMode, number>;
    for (const m of MODES) counts[m] = m === 'all' ? allRows.length : allRows.filter(row => matchesMode(row, m)).length;
    return counts;
  }, [allRows]);

  const containerRef = useRef<HTMLDivElement>(null);
  const virtualRows = useMemo(() => rows.map(entry => ({ id: entry.row.id })), [rows]);
  const { virtualizer, scrollMargin } = useVirtualTree({ rows: virtualRows, scrollRef, containerRef, estimateSize: 46 });

  const mappingLoaded = Boolean(lineage.mapping);
  const configName = configurations[configIndex]?.solutionVersion.solution.name ?? 'format';
  const mappingConfigName = lineage.mapping ? configurations[lineage.mapping.configIndex]?.solutionVersion.solution.name : undefined;

  const exportCsv = () => {
    const csv = buildFieldSpecCsv(allRows, {
      labelFor: labelOf,
      dataTypeLabel: dataType => (showTechnicalDetails ? dataType : getConsultantDataTypeLabel(dataType)),
    });
    downloadTextFile(`${safeFileName(configName)} - ${t.fmtTabSpec}.csv`, csv);
  };

  const { stats } = lineage;

  return (
    <div className="spec-view">
      <div className="spec-view__head">
        <div className="spec-view__summary">
          <span className="spec-view__total">{t.specFieldsCount(stats.fields)}</span>
          {SUMMARY_KINDS.map(kind => {
            const count = kind === 'model' ? stats.model : kind === 'calculated' ? stats.calculated : kind === 'datasource' ? stats.datasource : kind === 'constant' ? stats.constant : stats.unbound;
            if (count === 0) return null;
            return (
              <span key={kind} className={`spec-view__kind spec-view__kind--${kind}`} title={t.fillKindHints[kind]}>
                <span className="spec-view__kind-dot" aria-hidden />
                {count} {t.fillKindLabels[kind].toLowerCase()}
              </span>
            );
          })}
        </div>
        <div className="spec-view__modes" role="group" aria-label={t.specModeAria}>
          {MODES.map(m => (
            <button
              key={m}
              type="button"
              className={`spec-mode ${mode === m ? 'active' : ''}`}
              aria-pressed={mode === m}
              disabled={m !== 'all' && modeCounts[m] === 0}
              onClick={() => onModeChange(m)}
            >
              {t.specModeLabels[m]}
              <span className="spec-mode__count">{modeCounts[m]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="spec-view__export" onClick={exportCsv} title={t.specExportHint}>
          <ArrowDownloadRegular fontSize={14} aria-hidden />
          {t.specExportCsv}
        </button>
      </div>
      <div className={`spec-view__context ${mappingLoaded ? '' : 'spec-view__context--warn'}`}>
        {mappingLoaded
          ? <><InfoRegular fontSize={13} aria-hidden /> {t.specMappingContext(`${mappingConfigName ? `${mappingConfigName} › ` : ''}${lineage.mapping!.label}`)}</>
          : <><WarningRegular fontSize={13} aria-hidden /> {t.specNoMapping}</>}
        {!lineage.context.dataModel && <span className="spec-view__context-note">{t.specNoDataModel}</span>}
      </div>

      <div className="spec-grid spec-grid--head" role="row">
        <span role="columnheader">{t.specColElement}</span>
        <span role="columnheader">{t.specColType}</span>
        <span role="columnheader">{t.specColFill}</span>
        <span role="columnheader">{t.specColValue}</span>
        <span role="columnheader">{t.specColModel}</span>
        <span role="columnheader">{t.specColSource}</span>
      </div>

      {rows.length === 0 ? (
        <p className="spec-view__empty">{t.specEmpty}</p>
      ) : (
        <div ref={containerRef} className="spec-rows" role="table" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(item => {
            const { row, context } = rows[item.index];
            return (
              <SpecRow
                key={row.id}
                ref={virtualizer.measureElement}
                index={item.index}
                start={item.start - scrollMargin}
                row={row}
                context={context}
                selected={selectedId != null && normalizeGuid(selectedId) === normalizeGuid(row.id)}
                configIndex={configIndex}
                needle={needle}
                labelOf={labelOf}
                mappingLoaded={mappingLoaded}
                showTechnicalDetails={showTechnicalDetails}
                onSelect={onSelect}
                onOpenStructure={onOpenStructure}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

const SpecRow = React.memo(React.forwardRef<HTMLDivElement, {
  index: number;
  start: number;
  row: ElementFill;
  context: boolean;
  selected: boolean;
  configIndex: number;
  needle: string;
  labelOf: (ref?: string) => string | undefined;
  mappingLoaded: boolean;
  showTechnicalDetails: boolean;
  onSelect: (elementId: string) => void;
  onOpenStructure: (elementId: string) => void;
}>(function SpecRow({ index, start, row, context, selected, configIndex, needle, labelOf, mappingLoaded, showTechnicalDetails, onSelect, onOpenStructure }, ref) {
  const valueLinks = row.modelLinks.filter(link => link.role === 'value');
  const primary = primaryValueSources(row);
  const drillExpression = row.resolvedBinding ?? row.binding ?? '';
  return (
    <div
      ref={ref}
      data-index={index}
      role="row"
      className={`spec-grid spec-row spec-row--${row.fill}${row.isField ? ' spec-row--field' : ' spec-row--section'}${selected ? ' selected' : ''}${context ? ' spec-row--context' : ''}`}
      style={{ transform: `translateY(${start}px)` }}
      onClick={() => onSelect(row.id)}
      onDoubleClick={() => onOpenStructure(row.id)}
      title={row.isField ? undefined : t.specOpenStructure}
    >
      <span role="cell" className="spec-cell spec-cell--element" style={{ paddingLeft: 8 + row.depth * 14 }}>
        <FormatElementIcon type={row.element.elementType} fontSize={13} />
        <span className="spec-cell__name" title={row.path.join(' / ')}>
          <HighlightMatch text={row.displayName} query={needle} />
        </span>
        <ElementBadges fill={row} />
      </span>
      <span role="cell" className="spec-cell"><TypeCell fill={row} showTechnicalDetails={showTechnicalDetails} /></span>
      <span role="cell" className="spec-cell">
        {(row.fill !== 'structure' || row.binding) && <FillKindPill kind={row.fill} />}
      </span>
      <span role="cell" className="spec-cell spec-cell--value">
        {row.fill === 'constant' && row.constant != null ? (
          <span className="spec-constant">“{row.constant}”</span>
        ) : row.binding ? (
          <DrillDownTrigger expression={drillExpression} configIndex={configIndex} elementName={row.displayName} className="spec-expr">
            <ClickablePath expression={row.binding} configIndex={configIndex} mode="binding-expr" interactive={false} highlight={needle} />
          </DrillDownTrigger>
        ) : null}
        {row.conditions.map((condition, i) => (
          <span key={i} className="spec-condition" title={t.specCondition(condition)}>
            {t.specCondition(condition)}
          </span>
        ))}
      </span>
      <span role="cell" className="spec-cell spec-cell--model">
        {valueLinks.map(link => {
          const label = labelOf(link.field?.label);
          const unmapped = isUnmappedLink(row, mappingLoaded, link);
          return (
            <span key={link.path} className="spec-model" title={[link.path, label, link.fill ? t.specViaMapping(link.fill.path, link.fill.expression) : undefined].filter(Boolean).join('\n')}>
              <span className="spec-model__path">
                {link.segments.slice(0, -1).map((segment, i) => <span key={i} className="spec-model__seg">{segment}/</span>)}
                <strong><HighlightMatch text={link.segments[link.segments.length - 1] ?? ''} query={needle} /></strong>
              </span>
              {label && <span className="spec-model__label">{label}</span>}
              {unmapped && <UnmappedMark path={link.path} />}
            </span>
          );
        })}
      </span>
      <span role="cell" className="spec-cell spec-cell--source">
        <SourceChips sources={primary} />
        {valueLinks.length > 0 && primary.length === 0 && valueLinks.some(link => link.fill) && (
          <span className="spec-muted" title={valueLinks.map(link => link.fill?.expression).filter(Boolean).join('\n')}>
            {valueLinks.map(link => link.fill?.expression).filter(Boolean).join(', ')}
          </span>
        )}
      </span>
    </div>
  );
}));
