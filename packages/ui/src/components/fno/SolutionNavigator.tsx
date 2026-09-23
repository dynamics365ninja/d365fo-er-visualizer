/**
 * Left column of the F&O browser: the DataModel navigator, its name filter
 * and the entry point of the cross-model search.
 */

import React, { useMemo } from 'react';
import {
  Button,
  Input,
  Spinner,
  Caption1,
  Caption2,
  Body1Strong,
  Badge,
  Tooltip,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  SearchRegular,
  DocumentSearchRegular,
  DismissRegular,
  ChevronRightRegular,
  ChevronDownRegular,
  TableSimpleRegular,
} from '@fluentui/react-icons';
import type { ErSolutionSummary } from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { SkeletonListItem } from './common';
import {
  MIN_SEARCH_CHARS,
  buildSolutionTree,
  solNodeMatchesFilter,
  type DeepSearchState,
  type SolutionNode,
} from './listing';
import { useFnoPanelStyles } from './styles';

export interface SolutionNavigatorProps {
  solutions: ErSolutionSummary[];
  loadingSolutions: boolean;
  solutionFilter: string;
  setSolutionFilter: (value: string) => void;
  activeSolution: string | null;
  expandedSolutions: ReadonlySet<string>;
  toggleExpanded: (name: string) => void;
  handlePickSolution: (solutionName: string) => void;
  search: DeepSearchState | null;
  runSearch: () => Promise<void>;
  clearSearch: () => void;
  customRoot: string;
  setCustomRoot: (value: string) => void;
  handleRetryWithRoot: () => void;
}

export const SolutionNavigator: React.FC<SolutionNavigatorProps> = ({
  solutions,
  loadingSolutions,
  solutionFilter,
  setSolutionFilter,
  activeSolution,
  expandedSolutions,
  toggleExpanded,
  handlePickSolution,
  search,
  runSearch,
  clearSearch,
  customRoot,
  setCustomRoot,
  handleRetryWithRoot,
}) => {
  const styles = useFnoPanelStyles();
  const searchActive = search !== null;

  const solutionTree = useMemo<SolutionNode[]>(() => buildSolutionTree(solutions), [solutions]);

  // Roots left after the text filter — also tells the panel when a query
  // matched no model at all, which is the moment to point at the deep search.
  const visibleSolutionTree = useMemo(() => {
    const q = solutionFilter.trim().toLowerCase();
    if (!q) return solutionTree;
    return solutionTree.filter(node => solNodeMatchesFilter(node, q));
  }, [solutionTree, solutionFilter]);

  // ── Recursive solution-row renderer ─────────────────────────────────────
  const renderSolNode = (node: SolutionNode, depth: number): React.ReactNode => {
    const { sol, children } = node;
    const hasChildren = children.length > 0;
    const isExpanded = expandedSolutions.has(sol.solutionName);
    const isActive = activeSolution === sol.solutionName;
    const q = solutionFilter.toLowerCase();

    const visibleChildren = solutionFilter
      ? children.filter(c => solNodeMatchesFilter(c, q))
      : children;

    // Fluent spacingHorizontalM ≈ 12px; add 16px per extra level
    const basePad = 12;
    const padLeft = depth > 0 ? `${basePad + depth * 16}px` : undefined;
    const padLeftActive = depth > 0 ? `${basePad + depth * 16 - 3}px` : undefined;

    return (
      <React.Fragment key={sol.solutionName}>
        <div
          className={mergeClasses(
            styles.listItem,
            isActive
              ? (depth > 0 ? styles.listItemChildActive : styles.listItemActive)
              : (depth > 0 ? styles.listItemChild : ''),
          )}
          style={depth > 0 ? { paddingLeft: isActive ? padLeftActive : padLeft } : undefined}
          onClick={() => handlePickSolution(sol.solutionName)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') handlePickSolution(sol.solutionName); }}
        >
          {hasChildren ? (
            <div
              className={styles.expandBtn}
              role="button"
              tabIndex={0}
              aria-label={isExpanded ? t.treeCollapseNode : t.treeExpandNode}
              onClick={e => { e.stopPropagation(); toggleExpanded(sol.solutionName); }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); toggleExpanded(sol.solutionName); } }}
            >
              {isExpanded
                ? <ChevronDownRegular fontSize={12} />
                : <ChevronRightRegular fontSize={12} />}
            </div>
          ) : (
            <div className={styles.expandBtnPlaceholder} />
          )}
          <div className={styles.listItemContent}>
            {depth === 0 ? (
              <Body1Strong style={{ display: 'block' }}>{sol.solutionName}</Body1Strong>
            ) : (
              <Caption1 style={{ display: 'block', fontWeight: '600' }}>{sol.solutionName}</Caption1>
            )}
            {sol.publisher && depth === 0 && (
              <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>{sol.publisher}</Caption1>
            )}
          </div>
          {hasChildren && (
            <Badge appearance="outline" size="small" style={{ flexShrink: 0, fontSize: '10px' }}>
              {children.length}
            </Badge>
          )}
        </div>
        {(isExpanded || !!solutionFilter) && visibleChildren.map(child => renderSolNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className={styles.listBox}>
      <div className={styles.listHeader}>
        <div className={styles.listHeaderLeft}>
          <TableSimpleRegular fontSize={16} style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }} />
          <Body1Strong style={{ whiteSpace: 'nowrap' }}>{t.fnoSolutions}</Body1Strong>
          {!loadingSolutions && solutionTree.length > 0 && (
            <Badge appearance="filled" color="brand" size="small" style={{ flexShrink: 0 }}>
              {solutionTree.length}
            </Badge>
          )}
        </div>
        {loadingSolutions && <Spinner size="tiny" />}
      </div>
      <div className={styles.listSearchBar}>
        <div className={styles.listSearchRow}>
          <Input
            size="small"
            placeholder={t.fnoFilterModels}
            value={solutionFilter}
            onChange={(_, d) => setSolutionFilter(d.value)}
            onKeyDown={e => { if (e.key === 'Enter') void runSearch(); }}
            contentBefore={<SearchRegular />}
            style={{ width: '100%' }}
          />
          {/* The text box filters model names instantly; this walks the
              models' contents, which costs one API call per root. */}
          <Tooltip content={t.fnoSearchEverywhereHint} relationship="label">
            <Button
              size="small"
              appearance={searchActive ? 'primary' : 'outline'}
              icon={search?.running ? <Spinner size="tiny" /> : <DocumentSearchRegular />}
              disabled={solutionFilter.trim().length < MIN_SEARCH_CHARS || loadingSolutions || search?.running}
              aria-label={t.fnoSearchEverywhere}
              onClick={() => void runSearch()}
              style={{ width: '100%' }}
            >
              {t.fnoSearchEverywhere}
            </Button>
          </Tooltip>
        </div>
        {search && (
          <div className={styles.searchNote}>
            <Caption2 className={styles.searchNoteText}>
              {search.running
                ? t.fnoSearchProgress(search.scanned, search.total)
                : t.fnoSearchHits(search.results.length)}
            </Caption2>
            <Button
              size="small"
              appearance="subtle"
              icon={<DismissRegular />}
              aria-label={t.fnoSearchClear}
              title={t.fnoSearchClear}
              onClick={clearSearch}
            />
          </div>
        )}
      </div>
      <div className={styles.listScroll}>
        {/* Skeleton while loading */}
        {loadingSolutions && (
          <>
            <SkeletonListItem wide delay={0} />
            <SkeletonListItem delay={80} />
            <SkeletonListItem wide delay={160} />
            <SkeletonListItem delay={240} />
            <SkeletonListItem wide delay={320} />
          </>
        )}

        {!loadingSolutions && visibleSolutionTree.map(node => renderSolNode(node, 0))}

        {/* A query that hits no model name is exactly the case the
            cross-model search exists for — say so instead of a blank. */}
        {!loadingSolutions && solutionTree.length > 0 && visibleSolutionTree.length === 0 && (
          <div className={styles.emptyState}>
            <DocumentSearchRegular fontSize={28} style={{ opacity: 0.3 }} />
            <Caption1>{t.fnoNoModelMatch(solutionFilter.trim())}</Caption1>
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              {t.fnoNoModelMatchHint}
            </Caption1>
          </div>
        )}

        {!loadingSolutions && solutionTree.length === 0 && !solutionFilter && (
          <div className={styles.emptyState}>
            <TableSimpleRegular fontSize={32} style={{ opacity: 0.3 }} />
            <Caption1>{t.fnoNoSolutionsFound}</Caption1>
            <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
              {t.fnoCustomRootHint}
            </Caption1>
            <div className={styles.emptyStateRow}>
              <Input
                size="small"
                placeholder={t.fnoCustomRootPlaceholder}
                value={customRoot}
                onChange={(_, d) => setCustomRoot(d.value)}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button
                size="small"
                appearance="primary"
                disabled={!customRoot.trim() || loadingSolutions}
                onClick={handleRetryWithRoot}
              >
                {t.fnoRetry}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
