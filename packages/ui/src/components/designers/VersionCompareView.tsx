import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowDownloadRegular,
  BranchCompareRegular,
  DocumentTableRegular,
  InfoRegular,
  ListRegular,
  OpenRegular,
} from '@fluentui/react-icons';
import type { ERConfiguration, ERLabel } from '@er-visualizer/core';
import { useAppStore, type CompareMode } from '../../state/store';
import { isExactBase } from '../../state/base-configuration';
import { t, useLocale } from '../../i18n';
import { FilterField } from '../FilterField';
import { FormatElementIcon } from './format-type';
import { HighlightMatch } from './shared';
import { locateSearchDoc } from '../SearchResultsView';
import { buildLabelPool, labelDisplayText, labelLanguageTag, looksLikeLabelRef } from '../../utils/label-resolver';
import { downloadTextFile, safeFileName } from '../../utils/field-spec-export';
import { getBestVersion } from '../../utils/model-hierarchy';
import type { SearchDoc } from '../../utils/search-index';
import { diffFormulaLines, formatFormula, type FormulaLine, type FormulaRow } from '../../utils/expression-format';
import { ClickablePath } from '../ClickablePath';
import { foldUnchanged } from '../../utils/sequence-diff';
import { useTabState } from '../../utils/tab-view-state';
import { ComparePreview, type TemplateFocus } from './ComparePreview';
import { useTemplateComparison } from './useTemplateComparison';
import {
  buildVersionDiffCsv,
  diffConfigurations,
  diffListItems,
  inlineChange,
  LIST_KEYS,
  type ChangeKind,
  type ListRow,
  type DiffEntry,
  type DiffSection,
  type PropertyChange,
  type VersionDiff,
} from '../../utils/version-diff';

type ChangeFilter = 'all' | ChangeKind;
const FILTERS: ChangeFilter[] = ['all', 'changed', 'added', 'removed'];
const CHANGE_MARK: Record<ChangeKind, string> = { added: '+', removed: '−', changed: '~' };
/** Entries a section shows before it offers "Show more" — a whole format can differ. */
const SECTION_PAGE = 150;

const BOOLEAN_KEYS = new Set([
  'crossCompany', 'isRoot', 'isEnum', 'typeHost', 'stopProcessing',
  'style:bold', 'style:italic', 'style:underline', 'style:wrap',
]);
/** Template cell properties whose value is a colour, shown with a swatch. */
const COLOR_KEYS = new Set(['style:fontColor', 'style:fill']);
const LABEL_KEYS = new Set(['label', 'description']);
/** ER formulas: laid out on lines, coloured, compared line by line. */
function isFormulaKey(key: string): boolean {
  return key === 'binding' || key.startsWith('binding:') || key === 'expression' || key === 'condition'
    || key === 'message' || key === 'listToGroup';
}
/** Values shown in the code face. */
function isCodeKey(key: string): boolean {
  return isFormulaKey(key) || LIST_KEYS.has(key);
}
/** Unchanged lines of a formula kept around a change; longer runs fold. */
const FORMULA_CONTEXT = 3;

export function propertyLabel(key: string): string {
  if (key.startsWith('@')) return key.slice(1);
  if (key.startsWith('style:')) return t.compareStyleProps[key.slice('style:'.length)] ?? key.slice('style:'.length);
  if (key.startsWith('binding:')) return t.compareBindingOf(key.slice('binding:'.length));
  return t.compareProps[key] ?? key;
}

export function sectionTitle(section: DiffSection): string {
  const title = t.compareSectionLabels[section.kind];
  const scope = section.scope
    ?? (section.id.startsWith('embedded:') ? t.compareEmbeddedMapping : undefined)
    ?? (section.id === 'orphanBindings' ? t.compareOrphanBindings : undefined);
  return scope ? `${title} · ${scope}` : title;
}

/**
 * A loaded configuration next to another version of it: every element,
 * binding, data source, model field, validation and label text that was
 * added, removed or changed, the older value beside the newer one.
 */
export function VersionCompareView({ tabId, configIndex, otherKey, mode = 'version' }: {
  tabId: string;
  configIndex: number;
  otherKey: string;
  /** `base`: `otherKey` is the configuration this one was derived from, shown on the left. */
  mode?: CompareMode;
}) {
  const locale = useLocale();
  const configurations = useAppStore(s => s.configurations);
  const other = useAppStore(s => s.comparisonVersions[otherKey]);
  const openVersionComparePicker = useAppStore(s => s.openVersionComparePicker);
  const config = configurations[configIndex];

  const diff = useMemo(() => {
    if (!config || !other || config.content.kind !== other.content.kind) return null;
    // Equal versions keep the other one on the left; a base always is.
    return diffConfigurations(other, config, { keepOrder: mode === 'base' });
  }, [config, other, mode]);

  const labels = useMemo(() => {
    const workspace = buildLabelPool(configurations, configIndex);
    const pool = (cfg: ERConfiguration | undefined): ERLabel[] => (cfg && cfg !== config
      ? [...(cfg.solutionVersion.solution.labels ?? []), ...workspace]
      : workspace);
    return { older: pool(diff?.older), newer: pool(diff?.newer) };
  }, [configurations, configIndex, config, diff]);

  // The Excel templates of both sides, unzipped and compared once they are read.
  const templates = useTemplateComparison(diff?.older, diff?.newer);
  const [view, setView] = useTabState<'changes' | 'preview'>(tabId, 'compare.view', 'changes');
  const [templateFocus, setTemplateFocus] = useState<TemplateFocus | null>(null);

  const allSections = useMemo(() => {
    if (!diff) return [];
    if (templates.status !== 'ready' || templates.comparison.sections.length === 0) return diff.sections;
    // The template's content right after the format structure it is part of.
    const at = diff.sections.findIndex(section => section.kind === 'structure');
    const out = [...diff.sections];
    out.splice(at < 0 ? 0 : at + 1, 0, ...templates.comparison.sections);
    return out;
  }, [diff, templates]);

  const [filter, setFilter] = useState<ChangeFilter>('all');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});

  const labelLang = labelLanguageTag(locale);
  const display = useCallback((key: string, value: string | undefined, side: 'older' | 'newer'): string | undefined => {
    if (value == null) return undefined;
    if (BOOLEAN_KEYS.has(key)) return value === '1' ? t.compareYes : value;
    if (key === 'status') return t.compareStatusLabels[value] ?? value;
    if (key.startsWith('style:') || key === 'drawingKind') return t.compareStyleValues[value] ?? value;
    if (LABEL_KEYS.has(key) && looksLikeLabelRef(value)) {
      const text = labelDisplayText(value, labels[side], labelLang);
      return text && text !== value ? `${text} (${value})` : value;
    }
    return value;
  }, [labels, labelLang]);

  const needle = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!diff) return [];
    return allSections
      .map(section => ({
        section,
        entries: section.entries.filter(entry =>
          (filter === 'all' || entry.change === filter) && (!needle || entryMatches(entry, needle))),
      }))
      .filter(({ entries }) => entries.length > 0);
  }, [diff, allSections, filter, needle]);

  const counts = useMemo(() => {
    const tally: Record<ChangeKind, number> = { added: 0, removed: 0, changed: 0 };
    for (const section of allSections) for (const entry of section.entries) tally[entry.change] += 1;
    return tally;
  }, [allSections]);

  const showInPreview = useCallback((entry: DiffEntry) => {
    if (!entry.templateCell) return;
    const { sheet, olderRef, newerRef } = entry.templateCell;
    setTemplateFocus(current => ({ sheet, olderRef, newerRef, nonce: (current?.nonce ?? 0) + 1 }));
    setView('preview');
  }, [setView]);

  if (!config) return null;
  if (!other || !diff) {
    return <div className="vcmp-empty">{t.compareNoChanges}</div>;
  }

  const loadedSide: 'older' | 'newer' = diff.newer === config ? 'newer' : 'older';
  const name = config.solutionVersion.solution.name || config.filePath;
  const isBase = mode === 'base';
  const sideNames = isBase
    ? { older: t.compareBaseSide, newer: t.compareDerivedSide }
    : { older: t.compareOlder, newer: t.compareNewer };
  // The base version the derived configuration names, when the one compared is another.
  const expectedBaseVersion = isBase ? config.solutionVersion.solution.baseVersion : undefined;
  const actualBaseVersion = isBase ? getBestVersion(diff.older) : undefined;
  const baseVersionDiffers = expectedBaseVersion != null && !isExactBase(diff.older, config);
  const total = counts.added + counts.removed + counts.changed;
  const isFormat = diff.older.content.kind === 'Format';
  const showPreview = isFormat && view === 'preview';
  const sideLabels = {
    older: `${sideNames.older} · v${getBestVersion(diff.older) ?? '?'}`,
    newer: `${sideNames.newer} · v${getBestVersion(diff.newer) ?? '?'}`,
  };

  const exportCsv = () => {
    const csv = buildVersionDiffCsv({ ...diff, sections: allSections, counts }, {
      headers: t.compareCsvHeaders,
      change: change => t.compareChangeLabels[change],
      section: sectionTitle,
      property: propertyLabel,
    });
    downloadTextFile(isBase
      ? `${safeFileName(name)} vs ${safeFileName(diff.older.solutionVersion.solution.name || 'base')}.csv`
      : `${safeFileName(name)} v${getBestVersion(diff.older) ?? ''}-v${getBestVersion(diff.newer) ?? ''}.csv`, csv);
  };

  const toggleSection = (id: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className={`vcmp${showPreview ? ' vcmp--preview' : ''}`}>
      <div className="vcmp__head">
        <div className="vcmp__title">
          <BranchCompareRegular fontSize={16} aria-hidden />
          <span className="vcmp__name" title={name}>{name}</span>
        </div>
        <div className="vcmp-sides">
          <SideCard diff={diff} side="older" label={sideNames.older} loaded={loadedSide === 'older'} locale={locale} />
          <SideCard diff={diff} side="newer" label={sideNames.newer} loaded={loadedSide === 'newer'} locale={locale} />
        </div>
        {isBase ? (
          <div className="vcmp__note vcmp__note--info"><InfoRegular fontSize={13} aria-hidden /> {t.compareBaseNote(diff.older.solutionVersion.solution.name || '')}</div>
        ) : !diff.sameConfiguration && (
          <div className="vcmp__note"><InfoRegular fontSize={13} aria-hidden /> {t.compareDifferentConfigurations}</div>
        )}
        {baseVersionDiffers && (
          <div className="vcmp__note">
            <InfoRegular fontSize={13} aria-hidden />
            <span>{t.compareBaseVersionMismatch(String(expectedBaseVersion), String(actualBaseVersion ?? '?'))}</span>
            <button type="button" className="vcmp__note-action" onClick={() => openVersionComparePicker(configIndex, 'base')}>
              {t.compareBasePickOther}
            </button>
          </div>
        )}
        <div className="vcmp__toolbar">
          {isFormat && (
            <div className="spec-view__modes vcmp__views" role="tablist" aria-label={t.compareViewAria}>
              <button
                type="button"
                role="tab"
                aria-selected={!showPreview}
                className={`spec-mode${!showPreview ? ' active' : ''}`}
                onClick={() => setView('changes')}
              >
                <ListRegular fontSize={13} aria-hidden />
                {t.compareViewChanges}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={showPreview}
                className={`spec-mode${showPreview ? ' active' : ''}`}
                onClick={() => setView('preview')}
                title={t.compareViewPreviewHint}
              >
                <DocumentTableRegular fontSize={13} aria-hidden />
                {t.compareViewPreview}
              </button>
            </div>
          )}
          {!showPreview && (<>
          <div className="spec-view__modes" role="group" aria-label={t.compareFilterAria}>
            {FILTERS.map(f => (
              <button
                key={f}
                type="button"
                className={`spec-mode vcmp-filter vcmp-filter--${f} ${filter === f ? 'active' : ''}`}
                aria-pressed={filter === f}
                disabled={f !== 'all' && counts[f] === 0}
                onClick={() => setFilter(f)}
              >
                {f !== 'all' && <span className="vcmp-mark" aria-hidden>{CHANGE_MARK[f]}</span>}
                {f === 'all' ? t.compareFilterAll : t.compareChangeLabels[f]}
                <span className="spec-mode__count">{f === 'all' ? total : counts[f]}</span>
              </button>
            ))}
          </div>
          <FilterField
            className="vcmp__filter"
            value={query}
            onChange={setQuery}
            placeholder={t.compareFilterPlaceholder}
            ariaLabel={t.compareFilterPlaceholder}
          />
          <button
            type="button"
            className="spec-mode"
            onClick={() => setCollapsed(collapsed.size > 0 ? new Set() : new Set(allSections.map(s => s.id)))}
          >
            {collapsed.size > 0 ? t.compareExpandAll : t.compareCollapseAll}
          </button>
          <button type="button" className="spec-view__export" onClick={exportCsv} title={t.compareExportCsvHint} disabled={total === 0}>
            <ArrowDownloadRegular fontSize={14} aria-hidden />
            {t.specExportCsv}
          </button>
          </>)}
          {templates.status === 'loading' && <span className="vcmp__loading">{t.comparePreviewLoading}</span>}
        </div>
      </div>

      {showPreview ? (
        <div className="vcmp__preview">
          <ComparePreview
            diff={diff}
            configIndex={configIndex}
            tabId={tabId}
            templates={templates}
            focus={templateFocus}
            sideLabels={sideLabels}
            propertyLabel={propertyLabel}
            displayValue={display}
          />
        </div>
      ) : (
      <div className="vcmp__body">
        {total === 0 ? (
          <p className="vcmp-empty">{isBase ? t.compareBaseNoChanges : t.compareNoChanges}</p>
        ) : sections.length === 0 ? (
          <p className="vcmp-empty">{t.compareNoMatches}</p>
        ) : sections.map(({ section, entries }) => {
          const open = !collapsed.has(section.id);
          const limit = limits[section.id] ?? SECTION_PAGE;
          return (
            <section key={section.id} className="vcmp-section">
              <button type="button" className="vcmp-section__head" aria-expanded={open} onClick={() => toggleSection(section.id)}>
                <span className={`tree-chevron ${open ? 'open' : ''}`} aria-hidden />
                <span className="vcmp-section__title">{sectionTitle(section)}</span>
              </button>
              {open && (
                <>
                  <div className="vcmp-grid vcmp-grid--head" aria-hidden>
                    <span />
                    <span>{sideLabels.older}</span>
                    <span>{sideLabels.newer}</span>
                  </div>
                  {entries.slice(0, limit).map(entry => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      section={section}
                      configIndex={configIndex}
                      loadedSide={loadedSide}
                      tabId={tabId}
                      needle={needle}
                      display={display}
                      onShowInPreview={showInPreview}
                    />
                  ))}
                  {entries.length > limit && (
                    <button
                      type="button"
                      className="vcmp-more"
                      onClick={() => setLimits(current => ({ ...current, [section.id]: limit + SECTION_PAGE * 4 }))}
                    >
                      {t.compareShowMore(Math.min(entries.length - limit, SECTION_PAGE * 4))}
                    </button>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
      )}
    </div>
  );
}

function entryMatches(entry: DiffEntry, needle: string): boolean {
  if (entry.path.toLowerCase().includes(needle)) return true;
  if (entry.previousPath?.toLowerCase().includes(needle)) return true;
  if (entry.typeLabel?.toLowerCase().includes(needle)) return true;
  return entry.properties.some(p =>
    p.before?.toLowerCase().includes(needle) || p.after?.toLowerCase().includes(needle) || p.key.toLowerCase().includes(needle));
}

function SideCard({ diff, side, label, loaded, locale }: { diff: VersionDiff; side: 'older' | 'newer'; label: string; loaded: boolean; locale: string }) {
  const cfg = side === 'older' ? diff.older : diff.newer;
  const value = (key: string) => {
    const change = diff.header.find(h => h.key === key);
    return side === 'older' ? change?.before : change?.after;
  };
  const date = value('date');
  const parsedDate = date ? Date.parse(date) : NaN;
  const status = value('status');
  const rows: Array<[string, string | undefined]> = [
    ['date', Number.isFinite(parsedDate) ? new Date(parsedDate).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : date],
    ['status', status ? (t.compareStatusLabels[status] ?? status) : undefined],
    ['versionDescription', value('versionDescription')],
    ['base', value('base')],
    ['file', value('file')],
  ];
  return (
    <div className={`vcmp-side vcmp-side--${side}${loaded ? ' vcmp-side--loaded' : ''}`}>
      <div className="vcmp-side__head">
        <span className="vcmp-side__label">{label}</span>
        <span className="vcmp-side__version">v{getBestVersion(cfg) ?? '?'}</span>
        <span
          className={`vcmp-side__badge${loaded ? ' vcmp-side__badge--loaded' : ''}`}
          title={loaded ? t.compareInWorkspaceHint : t.compareOnlyHereHint}
        >
          {loaded ? t.compareInWorkspace : t.compareOnlyHere}
        </span>
      </div>
      <dl className="vcmp-side__meta">
        {rows.filter(([, v]) => v).map(([key, v]) => (
          <React.Fragment key={key}>
            <dt>{t.compareProps[key]}</dt>
            <dd title={v}>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

const EntryRow = React.memo(function EntryRow({ entry, section, configIndex, loadedSide, tabId, needle, display, onShowInPreview }: {
  entry: DiffEntry;
  section: DiffSection;
  configIndex: number;
  loadedSide: 'older' | 'newer';
  tabId: string;
  needle: string;
  display: (key: string, value: string | undefined, side: 'older' | 'newer') => string | undefined;
  onShowInPreview: (entry: DiffEntry) => void;
}) {
  const treeNodes = useAppStore(s => s.treeNodes);
  const navigateBeside = useAppStore(s => s.navigateToTreeNodeBeside);
  const locate = loadedSide === 'newer' ? entry.locateNewer : entry.locateOlder;
  const definition = loadedSide === 'newer' ? section.definitionNewer : section.definitionOlder;
  const reveal = locate
    ? () => {
      const node = locateSearchDoc(treeNodes, { configIndex, locate, definition } as SearchDoc);
      if (node) navigateBeside(node.id, tabId);
    }
    : undefined;
  const segments = entry.path.split('/');

  return (
    <div className={`vcmp-entry vcmp-entry--${entry.change}`}>
      <div className="vcmp-entry__head">
        <span className={`vcmp-mark vcmp-mark--${entry.change}`} title={t.compareChangeLabels[entry.change]}>{CHANGE_MARK[entry.change]}</span>
        {entry.itemKind === 'element' && entry.typeLabel && <FormatElementIcon type={entry.typeLabel} fontSize={13} />}
        <span className="vcmp-entry__path" title={entry.path}>
          {segments.slice(0, -1).map((segment, i) => <span key={i} className="vcmp-entry__seg">{segment}/</span>)}
          <strong><HighlightMatch text={segments[segments.length - 1] ?? ''} query={needle} /></strong>
        </span>
        {entry.typeLabel && entry.itemKind !== 'element' && <span className="vcmp-entry__type">{entry.typeLabel}</span>}
        {entry.previousPath && <span className="vcmp-entry__was" title={entry.previousPath}>{t.compareRenamedFrom(entry.previousPath)}</span>}
        {reveal && (
          <button type="button" className="vcmp-entry__open" onClick={reveal} title={t.compareShowInDesigner} aria-label={t.compareShowInDesigner}>
            <OpenRegular fontSize={13} />
          </button>
        )}
        {entry.templateCell && (
          <button type="button" className="vcmp-entry__open" onClick={() => onShowInPreview(entry)} title={t.compareShowInPreview} aria-label={t.compareShowInPreview}>
            <DocumentTableRegular fontSize={13} />
          </button>
        )}
      </div>
      {entry.properties.map(property => (isFormulaKey(property.key) ? (
        <div key={property.key} className="vcmp-grid vcmp-prop vcmp-prop--formula">
          <span className="vcmp-prop__key" title={property.key}>{propertyLabel(property.key)}</span>
          <FormulaCompare
            before={property.before}
            after={property.after}
            configIndex={configIndex}
            loadedSide={loadedSide}
            needle={needle}
            onNavigate={nodeId => navigateBeside(nodeId, tabId)}
          />
        </div>
      ) : LIST_KEYS.has(property.key) ? (
        <ListCompare key={property.key} property={property} needle={needle} />
      ) : (
        <PropertyRow key={property.key} property={property} change={entry.change} display={display} />
      )))}
    </div>
  );
});

/**
 * Two formulas line against line, coloured as in the designer. The names of
 * the version loaded in the workspace resolve on hover and open in the
 * designer next to the comparison; the other version's are only coloured —
 * they would resolve against the wrong version.
 */
function FormulaCompare({ before, after, configIndex, loadedSide, needle, onNavigate }: {
  before: string | undefined;
  after: string | undefined;
  configIndex: number;
  loadedSide: 'older' | 'newer';
  needle: string;
  onNavigate: (treeNodeId: string) => void;
}) {
  const [unfolded, setUnfolded] = useState<Set<number>>(() => new Set());
  const items = useMemo(() => {
    const rows = diffFormulaLines(
      before != null ? formatFormula(before) : [],
      after != null ? formatFormula(after) : [],
    );
    return foldUnchanged(rows, FORMULA_CONTEXT);
  }, [before, after]);

  return (
    <div className="vcmp-formula">
      {items.flatMap((item, index) => {
        if (item.kind === 'fold' && !unfolded.has(index)) {
          return [(
            <button
              key={`fold-${index}`}
              type="button"
              className="vcmp-formula__fold"
              onClick={() => setUnfolded(current => new Set(current).add(index))}
            >
              {t.compareUnchangedLines(item.rows.length)}
            </button>
          )];
        }
        const rows = item.kind === 'fold' ? item.rows : [item.row];
        return rows.map((row, k) => (
          <React.Fragment key={`${index}-${k}`}>
            <FormulaCell
              line={row.before}
              rowKind={row.kind}
              side="before"
              empty={before == null && index === 0 && k === 0}
              mark={row.change && row.change.before ? { from: row.change.prefix.length, to: row.change.prefix.length + row.change.before.length, className: 'vcmp-mark-del' } : undefined}
              configIndex={configIndex}
              interactive={loadedSide === 'older'}
              needle={needle}
              onNavigate={onNavigate}
            />
            <FormulaCell
              line={row.after}
              rowKind={row.kind}
              side="after"
              empty={after == null && index === 0 && k === 0}
              mark={row.change && row.change.after ? { from: row.change.prefix.length, to: row.change.prefix.length + row.change.after.length, className: 'vcmp-mark-ins' } : undefined}
              configIndex={configIndex}
              interactive={loadedSide === 'newer'}
              needle={needle}
              onNavigate={onNavigate}
            />
          </React.Fragment>
        ));
      })}
    </div>
  );
}

function FormulaCell({ line, rowKind, side, empty, mark, configIndex, interactive, needle, onNavigate }: {
  line: FormulaLine | undefined;
  rowKind: FormulaRow['kind'];
  side: 'before' | 'after';
  /** The whole value is missing on this side — the first cell says so. */
  empty: boolean;
  mark?: { from: number; to: number; className: string };
  configIndex: number;
  interactive: boolean;
  needle: string;
  onNavigate: (treeNodeId: string) => void;
}) {
  if (!line) {
    return <span className={`vcmp-fl vcmp-fl--gap${empty ? ' vcmp-fl--none' : ''}`}>{empty ? '—' : null}</span>;
  }
  const tone = rowKind === 'same' ? '' : side === 'before' ? ' vcmp-fl--before' : ' vcmp-fl--after';
  return (
    <span className={`vcmp-fl${tone}`} style={{ paddingLeft: `calc(6px + ${line.indent * 2}ch)` }}>
      <ClickablePath
        expression={line.text}
        configIndex={configIndex}
        mode="binding-expr"
        interactive={interactive}
        highlight={needle || undefined}
        mark={mark}
        onNavigate={onNavigate}
      />
    </span>
  );
}

/** Unchanged list items kept around a change; longer runs fold. */
const LIST_CONTEXT = 1;
const LIST_MARK: Record<ListRow['kind'], string> = { same: '', changed: '~', added: '+', removed: '−' };

/**
 * A list value (group-by aggregations and fields, selected table fields,
 * enum values, cached paths) item against item: each on its own line, an
 * item that kept its name facing its newer self with the differing part
 * marked, unchanged runs folded.
 */
function ListCompare({ property, needle }: { property: PropertyChange; needle: string }) {
  const [unfolded, setUnfolded] = useState<Set<number>>(() => new Set());
  const items = useMemo(
    () => foldUnchanged(diffListItems(property.before, property.after), LIST_CONTEXT),
    [property.before, property.after],
  );

  return (
    <div className="vcmp-grid vcmp-prop vcmp-prop--formula">
      <span className="vcmp-prop__key" title={property.key}>{propertyLabel(property.key)}</span>
      <div className="vcmp-formula vcmp-list">
        {items.flatMap((item, index) => {
          if (item.kind === 'fold' && !unfolded.has(index)) {
            return [(
              <button
                key={`fold-${index}`}
                type="button"
                className="vcmp-formula__fold"
                onClick={() => setUnfolded(current => new Set(current).add(index))}
              >
                {t.compareUnchangedItems(item.rows.length)}
              </button>
            )];
          }
          const rows = item.kind === 'fold' ? item.rows : [item.row];
          return rows.map((row, k) => {
            const split = row.kind === 'changed' && row.before != null && row.after != null ? inlineChange(row.before, row.after) : null;
            const first = index === 0 && k === 0;
            return (
              <React.Fragment key={`${index}-${k}`}>
                <ListCell row={row} side="before" split={split} needle={needle} empty={first && property.before == null} />
                <ListCell row={row} side="after" split={split} needle={needle} empty={first && property.after == null} />
              </React.Fragment>
            );
          });
        })}
      </div>
    </div>
  );
}

function ListCell({ row, side, split, needle, empty }: {
  row: ListRow;
  side: 'before' | 'after';
  split: ReturnType<typeof inlineChange> | null;
  needle: string;
  /** The whole list is missing on this side — the first cell says so. */
  empty: boolean;
}) {
  const text = side === 'before' ? row.before : row.after;
  if (text == null) return <span className={`vcmp-fl vcmp-fl--gap${empty ? ' vcmp-fl--none' : ''}`}>{empty ? '—' : null}</span>;
  const tone = row.kind === 'same' ? '' : side === 'before' ? ' vcmp-fl--before' : ' vcmp-fl--after';
  const mark = split
    ? { from: split.prefix.length, to: split.prefix.length + (side === 'before' ? split.before : split.after).length }
    : undefined;
  const nameEnd = text.indexOf(' = ');
  return (
    <span className={`vcmp-fl vcmp-list__item${tone}`}>
      {row.kind !== 'same' && <span className={`vcmp-list__mark vcmp-mark--${row.kind}`} aria-hidden>{LIST_MARK[row.kind]}</span>}
      {segmentText(text, nameEnd > 0 ? nameEnd : -1, mark, side === 'before' ? 'vcmp-mark-del' : 'vcmp-mark-ins', needle)}
    </span>
  );
}

/** The item's name in bold, the differing part marked. */
function segmentText(text: string, nameEnd: number, mark: { from: number; to: number } | undefined, markClass: string, needle: string): React.ReactNode[] {
  const cuts = new Set([0, text.length]);
  if (nameEnd > 0) cuts.add(nameEnd);
  if (mark && mark.to > mark.from) { cuts.add(mark.from); cuts.add(mark.to); }
  const points = [...cuts].sort((a, b) => a - b);
  const out: React.ReactNode[] = [];
  for (let p = 0; p < points.length - 1; p++) {
    const from = points[p];
    const to = points[p + 1];
    const piece = <HighlightMatch text={text.slice(from, to)} query={needle} />;
    const marked = mark && from >= mark.from && to <= mark.to;
    const named = nameEnd > 0 && to <= nameEnd;
    let node: React.ReactNode = piece;
    if (named) node = <strong className="vcmp-list__name">{node}</strong>;
    if (marked) node = <span className={markClass}>{node}</span>;
    out.push(<React.Fragment key={from}>{node}</React.Fragment>);
  }
  return out;
}

function PropertyRow({ property, change, display }: {
  property: PropertyChange;
  change: ChangeKind;
  display: (key: string, value: string | undefined, side: 'older' | 'newer') => string | undefined;
}) {
  const before = display(property.key, property.before, 'older');
  const after = display(property.key, property.after, 'newer');
  const code = isCodeKey(property.key);
  const color = COLOR_KEYS.has(property.key);
  const split = !color && change === 'changed' && before != null && after != null ? inlineChange(before, after) : null;
  const partial = split && (split.prefix.length > 0 || split.suffix.length > 0);
  return (
    <div className="vcmp-grid vcmp-prop">
      <span className="vcmp-prop__key" title={property.key}>{propertyLabel(property.key)}</span>
      <span className={`vcmp-prop__value vcmp-prop__value--before${code ? ' vcmp-code' : ''}${before == null ? ' vcmp-prop__value--none' : ''}`}>
        {before == null ? '—' : partial && split
          ? <>{split.prefix}{split.before && <del>{split.before}</del>}{split.suffix}</>
          : <span className={change !== 'added' ? 'vcmp-del' : undefined}>{color && <ColorSwatch value={before} />}{before}</span>}
      </span>
      <span className={`vcmp-prop__value vcmp-prop__value--after${code ? ' vcmp-code' : ''}${after == null ? ' vcmp-prop__value--none' : ''}`}>
        {after == null ? '—' : partial && split
          ? <>{split.prefix}{split.after && <ins>{split.after}</ins>}{split.suffix}</>
          : <span className={change !== 'removed' ? 'vcmp-ins' : undefined}>{color && <ColorSwatch value={after} />}{after}</span>}
      </span>
    </div>
  );
}

function ColorSwatch({ value }: { value: string }) {
  return /^#[0-9A-F]{6}$/i.test(value) ? <i className="vcmp-swatch" style={{ background: value }} aria-hidden /> : null;
}
