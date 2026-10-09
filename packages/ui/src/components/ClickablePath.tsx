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

  // Lists render their formulas non-interactive, a row each: those segments
  // are plain text and need none of the hover machinery below.
  return (
    <span style={{ fontFamily: 'var(--er-font-mono)', fontSize: 11, ...style }}>
      {segments.map((seg, i) => (interactive
        ? <SmartSegment key={i} segment={seg} configIndex={configIndex} highlight={highlight} />
        : <span key={i} style={segmentStyle(seg, false, false)}>{highlightSegmentText(seg.text, highlight)}</span>))}
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

function segmentStyle(segment: PathSegment, canResolve: boolean, isResolved: boolean): React.CSSProperties {
  return {
    color: isResolved ? 'var(--syn-resolved)' : SEGMENT_COLORS[segment.kind],
    cursor: canResolve ? 'pointer' : undefined,
    textDecoration: isResolved ? 'underline' : undefined,
    textDecorationStyle: isResolved ? 'dotted' : undefined,
    textUnderlineOffset: '3px',
  };
}

function SmartSegment({ segment, configIndex, highlight }: {
  segment: PathSegment;
  configIndex: number;
  highlight?: string;
}) {
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

  const canResolve = Boolean(segment.chain);

  // The store is read when the name is hovered, not subscribed to: an
  // expression renders a segment per name, and a subscription each made a
  // long formula expensive to mount for names nobody points at.
  const resolve = useCallback(() => {
    const store = useAppStore.getState();
    return buildPathTooltip(segment, {
      deep: path => resolveDeepExpression(path, store.configurations, configIndex),
      datasource: name => store.resolveDatasource(name, configIndex),
      modelPath: path => store.resolveModelPath(path, configIndex),
      datasourceNode: (ds, ci) => store.findDatasourceNode(ds.name, ci, ds.parentPath),
      bindingsBelow: path => store.findModelPathBindings(path, configIndex).length,
    });
  }, [segment, configIndex]);

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
    useAppStore.getState().navigateToTreeNode(treeNodeId);
  }, [treeNodeId]);

  const isResolved = treeNodeId != null;

  return (
    <>
      <span
        className={isResolved ? 'clickable-path-segment' : canResolve ? 'clickable-path-can-resolve' : undefined}
        style={segmentStyle(segment, canResolve, isResolved)}
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
