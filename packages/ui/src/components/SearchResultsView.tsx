import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightRegular,
  ArrowSyncRegular,
  CheckmarkCircleRegular,
  DataBarVerticalRegular,
  DatabaseRegular,
  DocumentRegular,
  LinkRegular,
  MathFormulaRegular,
  SearchRegular,
  TextBulletListLtrRegular,
} from '@fluentui/react-icons';
import type { ERConfiguration } from '@er-visualizer/core';
import { useAppStore } from '../state/store';
import type { TreeNode } from '../state/store';
import { t, useLocale } from '../i18n';
import { buildDatasourceLookupKey } from '../state/expression-resolution';
import { excerptAround, normalizeSearchText, SEARCH_CATEGORY_ORDER, type SearchCategory, type SearchDoc, type SearchMatch } from '../utils/search-index';
import { getConsultantFieldTypeLabel, getConsultantFormatTypeLabel } from '../utils/consultant-labels';
import type { WhereUsedTarget } from '../utils/impact-index';
import { labelLanguageTag } from '../utils/label-resolver';
import { FormatElementIcon } from './designers/format-type';

function Highlight({ text, query }: { text: string | undefined; query: string }) {
  const value = text ?? '';
  const q = normalizeSearchText(query.trim());
  if (!q) return <>{value}</>;
  // Positions are found on the accent-free text, which keeps the length of
  // precomposed characters, so they map back onto the original.
  const norm = normalizeSearchText(value);
  const parts: React.ReactNode[] = [];
  let from = 0;
  let at = norm.indexOf(q);
  let key = 0;
  while (at >= 0 && norm.length === value.normalize('NFC').length) {
    parts.push(value.slice(from, at));
    parts.push(<mark key={key++} className="search-highlight">{value.slice(at, at + q.length)}</mark>);
    from = at + q.length;
    at = norm.indexOf(q, from);
  }
  parts.push(value.slice(from));
  return <>{parts}</>;
}

function findNode(root: TreeNode | undefined, predicate: (node: TreeNode) => boolean, preferredDefinition?: string): TreeNode | null {
  if (!root) return null;
  let fallback: TreeNode | null = null;
  const stack: TreeNode[] = [...(root.children ?? [])];
  while (stack.length) {
    const node = stack.shift()!;
    if (predicate(node)) {
      if (!preferredDefinition || node.mappingDefinition === preferredDefinition) return node;
      fallback ??= node;
    }
    if (node.children) stack.unshift(...node.children);
  }
  return fallback;
}

/** The explorer node a search document stands for. */
export function locateSearchDoc(treeNodes: TreeNode[], doc: SearchDoc): TreeNode | null {
  const root = treeNodes[doc.configIndex];
  const { locate } = doc;
  const lower = (value: unknown) => String(value ?? '').toLowerCase();
  switch (locate.type) {
    case 'formatElement':
      return findNode(root, n => n.type === 'formatElement' && lower(n.data?.id) === lower(locate.id));
    case 'field':
      return findNode(root, n => n.type === 'field' && n.ownerName === locate.container && n.name === locate.field)
        ?? findNode(root, n => n.type === 'container' && n.name === locate.container);
    case 'container':
      return findNode(root, n => n.type === 'container' && n.name === locate.name);
    case 'binding':
      return findNode(root, n => n.type === 'binding' && n.data?.path === locate.path, doc.definition);
    case 'datasource': {
      const key = buildDatasourceLookupKey(locate.name, locate.parentPath);
      return findNode(root, n => n.type === 'datasource' && buildDatasourceLookupKey(n.data?.name ?? n.name, n.data?.parentPath) === key, doc.definition);
    }
    case 'validation':
      return findNode(root, n => n.type === 'validation' && n.data?.path === locate.path, doc.definition);
    case 'formatEnum':
      return findNode(root, n => n.type === 'enum' && n.name === locate.name)
        ?? findNode(root, n => n.type === 'enum' && String(n.name).startsWith(locate.name));
    case 'transformation':
      return findNode(root, n => n.type === 'transformation' && n.name === locate.name);
    default:
      return null;
  }
}

/** The where-used a search hit can start, when it is something that is used. */
export function whereUsedTargetForDoc(doc: SearchDoc): { query: string; target: WhereUsedTarget | null } | null {
  if (doc.kind === 'modelField' && doc.locate.type === 'field') {
    return { query: doc.name, target: { kind: 'modelField', container: doc.locate.container, field: doc.locate.field } };
  }
  if ((doc.kind === 'datasource' || doc.kind === 'calculatedField') && doc.locate.type === 'datasource') {
    if (doc.subtype === 'Table' && doc.detail) return { query: doc.detail, target: { kind: 'table', name: doc.detail } };
    if ((doc.subtype === 'Enum' || doc.subtype === 'ModelEnum' || doc.subtype === 'FormatEnum') && doc.detail) return { query: doc.detail, target: { kind: 'enum', name: doc.detail } };
    if ((doc.subtype === 'Class' || doc.subtype === 'Object') && doc.detail) return { query: doc.detail, target: { kind: 'class', name: doc.detail } };
    return { query: doc.name, target: { kind: 'datasource', configIndex: doc.configIndex, name: doc.locate.name, parentPath: doc.locate.parentPath } };
  }
  return null;
}

const DATASOURCE_KIND: Record<string, 'table' | 'enum' | 'class' | 'parameter'> = {
  Table: 'table', Enum: 'enum', ModelEnum: 'enum', FormatEnum: 'enum', Class: 'class', Object: 'class', UserParameter: 'parameter',
};

/** The kind tag: a datasource says which kind of source it is. */
function kindLabel(doc: SearchDoc): string {
  if (doc.kind === 'datasource' && doc.subtype) {
    const kind = DATASOURCE_KIND[doc.subtype];
    if (kind) return t.impactKindLabels[kind];
  }
  return t.searchDocKindLabels[doc.kind];
}

function DocIcon({ doc }: { doc: SearchDoc }) {
  switch (doc.kind) {
    case 'formatElement':
    case 'formatBinding':
      return <FormatElementIcon type={doc.subtype ?? 'Unknown'} fontSize={13} />;
    case 'modelRecord':
    case 'modelField':
      return <DataBarVerticalRegular fontSize={13} />;
    case 'modelEnum':
    case 'enumValue':
    case 'formatEnum':
      return <TextBulletListLtrRegular fontSize={13} />;
    case 'mappingBinding':
      return <LinkRegular fontSize={13} />;
    case 'calculatedField':
      return <MathFormulaRegular fontSize={13} />;
    case 'validation':
      return <CheckmarkCircleRegular fontSize={13} />;
    case 'transformation':
      return <ArrowSyncRegular fontSize={13} />;
    default:
      return <DatabaseRegular fontSize={13} />;
  }
}

function detailText(doc: SearchDoc, showTechnicalDetails: boolean): string | undefined {
  switch (doc.kind) {
    case 'formatElement':
      return [showTechnicalDetails ? doc.subtype : getConsultantFormatTypeLabel(doc.subtype ?? ''), doc.detail].filter(Boolean).join(' · ');
    case 'modelField':
      return [getConsultantFieldTypeLabel(Number(doc.subtype)), doc.detail].filter(Boolean).join(' · ');
    case 'modelRecord':
      return doc.detail === 'root' ? t.searchRootRecord : undefined;
    case 'formatBinding':
      return doc.detail;
    case 'datasource':
    case 'calculatedField':
      return [showTechnicalDetails ? doc.subtype : undefined, doc.detail && doc.detail !== doc.name ? doc.detail : undefined].filter(Boolean).join(' · ');
    default:
      return undefined;
  }
}

/**
 * Search hits grouped by configuration (and mapping definition), split into
 * format structure, data model, bindings, calculations and data sources.
 */
export function SearchResultsView({ matches, query, expandSignal, configurations }: {
  matches: SearchMatch[];
  query: string;
  expandSignal: { version: number; expanded: boolean };
  configurations: ERConfiguration[];
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { configIndex: number; definition?: string; best: number; items: SearchMatch[] }>();
    for (const match of matches) {
      const key = `${match.doc.configIndex}|${match.doc.definition ?? ''}`;
      const group = map.get(key);
      if (group) group.items.push(match);
      else map.set(key, { configIndex: match.doc.configIndex, definition: match.doc.definition, best: match.score, items: [match] });
    }
    // The group holding the best hit leads; ties keep the larger group first.
    return Array.from(map.entries()).sort((a, b) => b[1].best - a[1].best || b[1].items.length - a[1].items.length);
  }, [matches]);

  return (
    <div className="search-results">
      {groups.map(([key, group]) => (
        <ResultGroup
          key={`${query}|${key}`}
          config={configurations[group.configIndex]}
          configIndex={group.configIndex}
          definition={group.definition}
          items={group.items}
          query={query}
          expandSignal={expandSignal}
        />
      ))}
    </div>
  );
}

function ResultGroup({ config, configIndex, definition, items, query, expandSignal }: {
  config: ERConfiguration | undefined;
  configIndex: number;
  definition?: string;
  items: SearchMatch[];
  query: string;
  expandSignal: { version: number; expanded: boolean };
}) {
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (expandSignal.version > 0) setExpanded(expandSignal.expanded);
  }, [expandSignal.version, expandSignal.expanded]);

  const sections = useMemo(() => {
    const byCategory = new Map<SearchCategory, SearchMatch[]>();
    for (const item of items) {
      const list = byCategory.get(item.doc.category);
      if (list) list.push(item); else byCategory.set(item.doc.category, [item]);
    }
    // The section holding the best hit leads: a table query opens on the
    // data sources, a label query on the model.
    return SEARCH_CATEGORY_ORDER
      .filter(category => byCategory.has(category))
      .map(category => ({ category, rows: byCategory.get(category)! }))
      .sort((a, b) => b.rows[0].score - a.rows[0].score);
  }, [items]);

  const kind = config?.kind ?? '';
  const name = config?.solutionVersion.solution.name ?? `#${configIndex}`;
  return (
    <div className="search-result-group">
      <button type="button" className="search-result-group-header" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
        <span className={`tree-chevron ${expanded ? 'open' : ''}`} />
        <DocumentRegular className="search-result-group-icon" />
        <span className="search-result-group-name" title={name}>{name}</span>
        {kind && <span className={`badge badge-${kind.toLowerCase()} badge-tiny`}>{t.searchKindLabels[kind as 'Format' | 'ModelMapping' | 'DataModel'] ?? kind}</span>}
        {definition && <span className="search-result-group-model" title={t.searchGroupDefinitionHint(definition)}>{t.searchGroupDefinition(definition)}</span>}
        <span className="search-result-group-count">{items.length}</span>
      </button>
      {expanded && (
        <div className="search-result-group-body">
          {sections.map(({ category, rows }) => (
            <div key={category} className={`search-cat search-cat--${category}`}>
              <div className="search-cat__header">
                <span className="search-cat__marker" aria-hidden="true" />
                <span className="search-cat__title">{t.searchCategoryLabels[category]}</span>
                <span className="search-cat__count">{rows.length}</span>
              </div>
              <div className="search-cat__rows">
                {rows.map(match => <ResultRow key={match.doc.id} match={match} query={query} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultRow({ match, query }: { match: SearchMatch; query: string }) {
  const locale = useLocale();
  const { doc, field } = match;
  const treeNodes = useAppStore(s => s.treeNodes);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const triggerWhereUsed = useAppStore(s => s.triggerWhereUsed);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);

  const open = useCallback(() => {
    const node = locateSearchDoc(treeNodes, doc) ?? treeNodes[doc.configIndex] ?? null;
    if (node) navigateToTreeNode(node.id);
  }, [treeNodes, doc, navigateToTreeNode]);

  const whereUsed = whereUsedTargetForDoc(doc);
  const detail = detailText(doc, showTechnicalDetails);
  const language = labelLanguageTag(locale).toLowerCase();
  const label = doc.labels?.find(l => normalizeSearchText(l.text).includes(normalizeSearchText(query.trim())))
    ?? doc.labels?.find(l => l.language.toLowerCase() === language || l.language.toLowerCase().startsWith(language.split('-')[0]))
    ?? doc.labels?.[0];
  const expression = doc.expression ? excerptAround(doc.expression, field === 'expression' ? query : '', 70) : undefined;

  return (
    <div className={`search-hit search-hit--${doc.category} search-doc`} role="button" tabIndex={0} onClick={open}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); open(); } }}
      title={[doc.path, doc.expression].filter(Boolean).join('\n')}>
      <div className="search-hit__body">
        <div className="search-hit__row1">
          <span className="search-doc__icon" aria-hidden><DocIcon doc={doc} /></span>
          <span className="search-hit__location"><Highlight text={doc.name} query={query} /></span>
          <span className={`search-doc__kind search-doc__kind--${doc.kind}`}>{kindLabel(doc)}</span>
          {detail && <span className="search-doc__detail" title={detail}><Highlight text={detail} query={query} /></span>}
          {whereUsed && (
            <button
              type="button"
              className="search-doc__where-used"
              title={t.searchWhereUsedHint(whereUsed.query)}
              aria-label={t.searchWhereUsedHint(whereUsed.query)}
              onClick={event => { event.stopPropagation(); triggerWhereUsed(whereUsed.query, whereUsed.target); }}
            >
              <SearchRegular fontSize={13} />
            </button>
          )}
          <ArrowRightRegular className="search-hit__arrow" />
        </div>
        {(doc.path || label) && (
          <div className="search-doc__meta">
            {doc.path && <span className="search-doc__path"><Highlight text={doc.path} query={query} /></span>}
            {label && <span className="search-doc__label" title={doc.labels!.map(l => `${l.language}: ${l.text}`).join('\n')}><Highlight text={label.text} query={query} /></span>}
          </div>
        )}
        {expression && (
          <div className="search-hit__expr"><Highlight text={expression} query={query} /></div>
        )}
      </div>
    </div>
  );
}
