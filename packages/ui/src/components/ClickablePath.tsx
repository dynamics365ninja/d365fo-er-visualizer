import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, resolveDeepExpression } from '../state/store';
import { PathTooltipCard } from './PathTooltipCard';
import { buildPathTooltip, parseExpressionSegments, type PathSegment, type PathTooltipData } from '../utils/path-tooltip';

interface ClickablePathProps {
  /** The expression or path string, e.g. "model.CompanyInfo.Name" or "CompanyInfo.'name()'" */
  expression: string;
  /** Config index for context when resolving datasources */
  configIndex: number;
  /** What kind of references to resolve */
  mode?: 'binding-expr' | 'model-path' | 'auto';
  style?: React.CSSProperties;
  interactive?: boolean;
  /** Active filter query — occurrences are marked inside the rendered text. */
  highlight?: string;
}

/** Sweeping the pointer across a formula should not flash a card per name. */
const SHOW_DELAY_MS = 220;

/**
 * Renders an expression string with clickable segments.
 * Datasource names and model paths are resolved on hover.
 * If a reference resolves, it becomes clickable with a tooltip.
 */
export function ClickablePath({ expression, configIndex, mode = 'auto', style, interactive = true, highlight }: ClickablePathProps) {
  const segments = useMemo(() => parseExpressionSegments(expression, mode), [expression, mode]);

  return (
    <span style={{ fontFamily: 'monospace', fontSize: 11, ...style }}>
      {segments.map((seg, i) => (
        <SmartSegment key={i} segment={seg} configIndex={configIndex} interactive={interactive} highlight={highlight} />
      ))}
    </span>
  );
}

/** Wraps every occurrence of `query` in `text` so a filtered list can show
 *  what matched, not just that something did. */
function highlightSegmentText(text: string, query: string | undefined): React.ReactNode {
  const needle = query?.trim();
  if (!needle) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === needle.toLowerCase()
      ? <mark key={i} className="search-highlight">{part}</mark>
      : <React.Fragment key={i}>{part}</React.Fragment>,
  );
}

const SEGMENT_COLORS: Record<PathSegment['kind'], string> = {
  identifier: 'var(--syn-identifier)',
  'model-path': 'var(--syn-path)',
  operator: 'var(--syn-operator)',
  literal: 'var(--syn-literal)',
  separator: 'var(--syn-separator)',
};

function SmartSegment({ segment, configIndex, interactive, highlight }: {
  segment: PathSegment;
  configIndex: number;
  interactive: boolean;
  highlight?: string;
}) {
  const resolveDatasource = useAppStore(s => s.resolveDatasource);
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const findModelPathBindings = useAppStore(s => s.findModelPathBindings);
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const configurations = useAppStore(s => s.configurations);

  const [tooltip, setTooltip] = useState<{ data: PathTooltipData; anchor: DOMRect } | null>(null);
  const [treeNodeId, setTreeNodeId] = useState<string | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  // The card is anchored to where the name was; once the list scrolls, it
  // would point at something else.
  useEffect(() => {
    if (!tooltip) return;
    const hide = () => setTooltip(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [tooltip]);

  const canResolve = interactive && Boolean(segment.chain);

  const resolve = useCallback(() => buildPathTooltip(segment, {
    deep: path => resolveDeepExpression(path, configurations, configIndex),
    datasource: name => resolveDatasource(name, configIndex),
    modelPath: path => resolveModelPath(path),
    datasourceNode: (ds, ci) => findDatasourceNode(ds.name, ci, ds.parentPath),
    bindingsBelow: path => findModelPathBindings(path).length,
  }), [segment, configurations, configIndex, resolveDatasource, resolveModelPath, findModelPathBindings, findDatasourceNode]);

  const handleMouseEnter = useCallback((event: React.MouseEvent<HTMLSpanElement>) => {
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    const anchor = event.currentTarget.getBoundingClientRect();
    const data = resolve();
    setTreeNodeId(data?.navigation?.treeNodeId ?? null);
    if (!data) return;
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => setTooltip({ data, anchor }), SHOW_DELAY_MS);
  }, [resolve]);

  const handleMouseLeave = useCallback(() => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
    setTooltip(null);
    // Kept briefly so a click that lands just as the pointer leaves still navigates.
    clearTimer.current = setTimeout(() => setTreeNodeId(null), 300);
  }, []);

  const handleClick = useCallback((event: React.MouseEvent) => {
    // The row around the expression has its own click behaviour.
    event.stopPropagation();
    if (!treeNodeId) return;
    setTooltip(null);
    navigateToTreeNode(treeNodeId);
  }, [treeNodeId, navigateToTreeNode]);

  const isResolved = treeNodeId != null;

  return (
    <>
      <span
        className={isResolved ? 'clickable-path-segment' : canResolve ? 'clickable-path-can-resolve' : undefined}
        style={{
          color: isResolved ? 'var(--syn-resolved)' : SEGMENT_COLORS[segment.kind],
          cursor: canResolve ? 'pointer' : undefined,
          textDecoration: isResolved ? 'underline' : undefined,
          textDecorationStyle: isResolved ? 'dotted' : undefined,
          textUnderlineOffset: '3px',
        }}
        onMouseEnter={canResolve ? handleMouseEnter : undefined}
        onMouseLeave={canResolve ? handleMouseLeave : undefined}
        onClick={isResolved ? handleClick : undefined}
      >
        {highlightSegmentText(segment.text, highlight)}
      </span>
      {tooltip && <PathTooltipCard data={tooltip.data} anchor={tooltip.anchor} />}
    </>
  );
}
