import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightRegular, DocumentRegular, LinkRegular } from '@fluentui/react-icons';
import { useAppStore } from '../state/store';
import type { TreeNode } from '../state/store';
import { t } from '../i18n';
import { buildLabelPool, labelDisplayText, labelLanguageTag } from '../utils/label-resolver';
import { buildImpactIndex, findImpactEntities, type FormatUsage, type ImpactMatch, type MappingUsage, type UsageRole, type WhereUsedTarget } from '../utils/impact-index';
import { getConsultantFormatTypeLabel } from '../utils/consultant-labels';
import { useLocale } from '../i18n';
import { FormatElementIcon } from './designers/format-type';

/** How many rows a section lists before "show all". */
const SECTION_ROWS = 12;
/** How many entity cards open expanded. */
const OPEN_CARDS = 3;

export interface WhereUsedFilter {
  allowsConfigIndex: (index: number) => boolean;
  allowsDefinition: (definition?: string) => boolean;
}

function findNode(nodes: TreeNode[], predicate: (node: TreeNode) => boolean, preferredDefinition?: string): TreeNode | null {
  let fallback: TreeNode | null = null;
  const walk = (list: TreeNode[]): TreeNode | null => {
    for (const node of list) {
      if (predicate(node)) {
        if (!preferredDefinition || node.mappingDefinition === preferredDefinition) return node;
        fallback ??= node;
      }
      if (node.children) {
        const found = walk(node.children);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(nodes) ?? fallback;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q || !text) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="search-highlight">{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</>;
}

function RoleTag({ role }: { role: UsageRole }) {
  if (role === 'value') return null;
  return <span className={`impact-role impact-role--${role}`} title={t.impactRoleHints[role]}>{t.impactRoleLabels[role]}</span>;
}

/**
 * Where-used as impact analysis: each matching table, field, datasource or
 * model field with the model fields the mappings fill from it and the format
 * elements that end up reading it, grouped by configuration.
 */
export function WhereUsedView({ query, target, scope, filter, expandSignal, onEmpty }: {
  query: string;
  target: WhereUsedTarget | null;
  scope: 'all' | 'mapping' | 'format';
  /** "Related only": the configurations and definitions the active tab belongs to; `null` = everything. */
  filter: WhereUsedFilter | null;
  expandSignal: { version: number; expanded: boolean };
  /** Told whether anything structural was found, so the panel can word its empty state. */
  onEmpty?: (empty: boolean) => void;
}) {
  const locale = useLocale();
  const configurations = useAppStore(s => s.configurations);
  const treeNodes = useAppStore(s => s.treeNodes);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const [includeIndirect, setIncludeIndirect] = useState(false);

  const index = useMemo(() => buildImpactIndex(configurations), [configurations]);
  const labelPool = useMemo(() => {
    const modelIndex = configurations.findIndex(cfg => cfg.content.kind === 'DataModel');
    return buildLabelPool(configurations, Math.max(0, modelIndex));
  }, [configurations]);
  const labelOf = useCallback((ref?: string) => {
    if (!ref) return undefined;
    const text = labelDisplayText(ref, labelPool, labelLanguageTag(locale));
    return text && text !== ref ? text : undefined;
  }, [labelPool, locale]);

  const matches = useMemo(
    () => findImpactEntities(index, query, { target, labelOf, limit: 80 }),
    [index, query, target, labelOf],
  );

  const cards = useMemo(() => matches.map(match => {
    const keep = (role: UsageRole) => includeIndirect || role !== 'context';
    const allMapping = (index.mappingUsages.get(match.entity.key) ?? [])
      .filter(u => !filter || (filter.allowsConfigIndex(u.configIndex) && filter.allowsDefinition(u.definition)));
    const allFormat = (index.formatUsages.get(match.entity.key) ?? [])
      .filter(u => !filter || filter.allowsConfigIndex(u.configIndex));
    const mapping = scope === 'format' ? [] : allMapping.filter(u => keep(u.role));
    const format = scope === 'mapping' ? [] : allFormat.filter(u => keep(u.role));
    const hidden = (scope === 'format' ? 0 : allMapping.length - allMapping.filter(u => keep(u.role)).length)
      + (scope === 'mapping' ? 0 : allFormat.length - allFormat.filter(u => keep(u.role)).length);
    return { match, mapping, format, hidden };
  }).filter(card => card.mapping.length + card.format.length + card.hidden > 0), [matches, index, filter, scope, includeIndirect]);

  const indirectTotal = cards.reduce((n, card) => n + card.hidden, 0);
  const elementTotal = cards.reduce((n, card) => n + card.format.length, 0);
  const formatTotal = new Set(cards.flatMap(card => card.format.map(u => u.configIndex))).size;

  useEffect(() => { onEmpty?.(cards.length === 0); }, [cards.length, onEmpty]);

  const openMapping = useCallback((usage: MappingUsage) => {
    const root = treeNodes[usage.configIndex];
    if (!root) return;
    const node = findNode(root.children ?? [], n => n.type === 'binding' && String(n.data?.path ?? '').toLowerCase() === usage.path.toLowerCase(), usage.definition);
    navigateToTreeNode((node ?? root).id);
  }, [treeNodes, navigateToTreeNode]);

  const openElement = useCallback((usage: FormatUsage) => {
    const node = findNode(treeNodes, n => n.type === 'formatElement' && n.configIndex === usage.configIndex && n.data?.id === usage.elementId);
    if (node) navigateToTreeNode(node.id);
  }, [treeNodes, navigateToTreeNode]);

  if (cards.length === 0) return null;

  return (
    <div className="impact">
      <div className="impact__summary">
        <span>{t.impactSummary(cards.length, elementTotal, formatTotal)}</span>
        {(indirectTotal > 0 || includeIndirect) && (
          <button type="button" className="impact__indirect" onClick={() => setIncludeIndirect(v => !v)} title={t.impactIndirectHint} aria-pressed={includeIndirect}>
            {includeIndirect ? t.impactIndirectHide : t.impactIndirectToggle(indirectTotal)}
          </button>
        )}
      </div>
      {cards.map(({ match, mapping, format, hidden }, i) => (
        <ImpactCard
          // A new query starts every card in its default state.
          key={`${query}|${match.entity.key}`}
          match={match}
          mapping={mapping}
          format={format}
          hidden={hidden}
          defaultOpen={i < OPEN_CARDS}
          expandSignal={expandSignal}
          query={query}
          labelOf={labelOf}
          configName={index => configurations[index]?.solutionVersion.solution.name ?? `#${index}`}
          showTechnicalDetails={showTechnicalDetails}
          onOpenMapping={openMapping}
          onOpenElement={openElement}
          onShowIndirect={() => setIncludeIndirect(true)}
        />
      ))}
    </div>
  );
}

function ImpactCard({ match, mapping, format, hidden, defaultOpen, expandSignal, query, labelOf, configName, showTechnicalDetails, onOpenMapping, onOpenElement, onShowIndirect }: {
  match: ImpactMatch;
  mapping: MappingUsage[];
  format: FormatUsage[];
  hidden: number;
  defaultOpen: boolean;
  expandSignal: { version: number; expanded: boolean };
  query: string;
  labelOf: (ref?: string) => string | undefined;
  configName: (index: number) => string;
  showTechnicalDetails: boolean;
  onOpenMapping: (usage: MappingUsage) => void;
  onOpenElement: (usage: FormatUsage) => void;
  onShowIndirect: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (expandSignal.version > 0) setOpen(expandSignal.expanded);
  }, [expandSignal.version, expandSignal.expanded]);

  const { entity } = match;
  const label = labelOf(entity.label);
  const mappingGroups = useMemo(() => groupBy(mapping, u => `${u.configIndex}|${u.definition}`), [mapping]);
  const formatGroups = useMemo(() => groupBy(format, u => String(u.configIndex)), [format]);
  const filledFields = new Set(mapping.map(u => u.path.toLowerCase())).size;

  const subtitle = entity.kind === 'datasource'
    ? [configName(entity.configIndex ?? 0), entity.definition].filter(Boolean).join(' › ')
    : entity.kind === 'modelField'
      ? [label, entity.container, entity.paths && entity.paths.length > 0 ? entity.paths.join(', ') : undefined].filter(Boolean).join(' · ')
      : undefined;

  return (
    <section className={`impact-card impact-card--${entity.kind}${match.score === 4 ? ' impact-card--target' : ''}`}>
      <button type="button" className="impact-card__head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className={`tree-chevron ${open ? 'open' : ''}`} />
        <span className={`impact-kind impact-kind--${entity.kind}`}>{t.impactKindLabels[entity.kind]}</span>
        <span className="impact-card__name" title={entity.name}><Highlight text={entity.kind === 'modelField' ? (entity.field ?? entity.name) : entity.name} query={query} /></span>
        <span className="impact-card__subtitle">
          <span className="impact-card__counts">{t.impactCounts(filledFields, format.length, formatGroups.length)}</span>
          {subtitle && <span className="impact-card__subtitle-text" title={subtitle}><Highlight text={subtitle} query={query} /></span>}
        </span>
      </button>
      {open && (
        <div className="impact-card__body">
          {mapping.length === 0 && format.length === 0 && hidden > 0 && (
            <button type="button" className="impact__indirect impact__indirect--inline" onClick={onShowIndirect} title={t.impactIndirectHint}>
              {t.impactOnlyIndirect(hidden)}
            </button>
          )}
          {mappingGroups.map(([key, usages]) => (
            <UsageSection
              key={`m:${key}`}
              icon={<LinkRegular fontSize={13} />}
              title={`${configName(usages[0].configIndex)} › ${usages[0].definition}`}
              kind="mapping"
              rows={usages}
              render={usage => (
                <button type="button" className="impact-row" onClick={() => onOpenMapping(usage)} title={`${usage.path}\n${usage.expression}`}>
                  <span className="impact-row__main">
                    <span className="impact-row__leaf"><Highlight text={usage.path.split(/[\\/]/).pop() ?? usage.path} query={query} /></span>
                    <span className="impact-row__path">{usage.path}</span>
                    <RoleTag role={usage.role} />
                    <ArrowRightRegular className="impact-row__arrow" />
                  </span>
                  <span className="impact-row__expr"><Highlight text={usage.expression} query={query} /></span>
                </button>
              )}
            />
          ))}
          {formatGroups.map(([key, usages]) => (
            <UsageSection
              key={`f:${key}`}
              icon={<DocumentRegular fontSize={13} />}
              title={configName(usages[0].configIndex)}
              kind="format"
              rows={usages}
              render={usage => (
                <button type="button" className="impact-row" onClick={() => onOpenElement(usage)} title={`${usage.elementPath.join(' / ')}${usage.expression ? `\n${usage.expression}` : ''}`}>
                  <span className="impact-row__main">
                    <FormatElementIcon type={usage.elementType} fontSize={12} />
                    <span className="impact-row__leaf"><Highlight text={usage.displayName} query={query} /></span>
                    {!showTechnicalDetails && <span className="impact-row__type">{getConsultantFormatTypeLabel(usage.elementType)}</span>}
                    <RoleTag role={usage.role} />
                    <ArrowRightRegular className="impact-row__arrow" />
                  </span>
                  <span className="impact-row__path">{usage.elementPath.slice(1, -1).join(' / ')}</span>
                  {(usage.expression || usage.via) && (
                    <span className="impact-row__expr">
                      {usage.expression && <Highlight text={usage.expression} query={query} />}
                      {usage.via && <span className="impact-row__via">{t.impactVia(usage.via)}</span>}
                    </span>
                  )}
                </button>
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UsageSection<T>({ icon, title, kind, rows, render }: {
  icon: React.ReactNode;
  title: string;
  kind: 'mapping' | 'format';
  rows: T[];
  render: (row: T) => React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SECTION_ROWS);
  return (
    <div className={`impact-section impact-section--${kind}`}>
      <div className="impact-section__head">
        {icon}
        <span className="impact-section__title" title={title}>{kind === 'mapping' ? `${t.impactFillsTitle} · ` : ''}{title}</span>
        <span className="impact-section__count">{rows.length}</span>
      </div>
      <div className="impact-section__rows">
        {shown.map((row, i) => <React.Fragment key={i}>{render(row)}</React.Fragment>)}
        {rows.length > shown.length && (
          <button type="button" className="impact-section__more" onClick={() => setAll(true)}>{t.impactShowAllRows(rows.length)}</button>
        )}
      </div>
    </div>
  );
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item); else map.set(k, [item]);
  }
  return Array.from(map.entries());
}
