import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppsListDetailRegular, InfoRegular, MoreVerticalRegular } from '@fluentui/react-icons';
import { Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Tooltip } from '@fluentui/react-components';
import { useAppStore, resolveDeepExpression } from '../../state/store';
import { datasourcePathKey } from '../../utils/datasource-tree';
import { ClickablePath } from '../ClickablePath';
import { t } from '../../i18n';
import { formatEnumDisplayName } from '../../utils/enum-display';
import { getConsultantFormatTypeLabel } from '../../utils/consultant-labels';

export function findTreeNodeByMatch(node: any, predicate: (candidate: any) => boolean): any | null {
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findTreeNodeByMatch(child, predicate);
    if (found) return found;
  }
  return null;
}

function extractFirstModelReference(expression: string): string | null {
  const match = expression.match(/model[.\\](?:'[^']*'|[A-Za-z0-9_$]+)(?:(?:[.\\])(?:'[^']*'|[A-Za-z0-9_$]+))*/i);
  return match?.[0] ?? null;
}

function normalizeModelReferenceVariants(expression: string): string[] {
  const reference = extractFirstModelReference(expression);
  if (!reference) return [];

  const body = reference.replace(/^model[.\\]/i, '');
  const segments = body.split(/[.\\]/).filter(Boolean);
  const variants = [
    segments.join('\\'),
    segments.join('.'),
    segments.join('/'),
  ];

  return [...new Set(variants)];
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Marks every occurrence of `query` inside `text` — the tree filter used to
 *  show which rows matched, but never *what* in them matched. */
export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExpLiteral(needle)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === needle.toLowerCase()
          ? <mark key={i} className="search-highlight">{part}</mark>
          : <React.Fragment key={i}>{part}</React.Fragment>,
      )}
    </>
  );
}

export function ExpressionDetailLink({ expression, configIndex, className, interactive = true, highlight }: { expression: string; configIndex: number; className?: string; interactive?: boolean; highlight?: string }) {
  const configurations = useAppStore(s => s.configurations);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);
  const resolveBinding = useAppStore(s => s.resolveBinding);
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);

  const navigateExpressionTarget = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();

    const modelReference = extractFirstModelReference(expression);
    if (modelReference) {
      const resolvedModel = resolveModelPath(modelReference, configIndex);
      const targetNodeId = resolvedModel?.bindingTreeNodeId ?? resolvedModel?.datasourceTreeNodeId;
      if (targetNodeId) {
        navigateToTreeNode(targetNodeId);
        return;
      }

      for (const variant of normalizeModelReferenceVariants(expression)) {
        const bindingResult = resolveBinding(variant, configIndex);
        if (bindingResult?.treeNodeId) {
          navigateToTreeNode(bindingResult.treeNodeId);
          return;
        }
      }
    }

    const deepResult = resolveDeepExpression(expression, configurations, configIndex);
    const resolvedDatasource = deepResult?.nestedDs ?? deepResult?.rootDs;
    const resolvedConfigIndex = deepResult?.rootDsConfigIndex ?? configIndex;
    if (resolvedDatasource) {
      const nodeId = findDatasourceNode(resolvedDatasource.name, resolvedConfigIndex, resolvedDatasource.parentPath);
      if (nodeId) {
        navigateToTreeNode(nodeId);
        return;
      }
    }

    const directDatasourceName = expression.split(/[.(]/)[0]?.replace(/['"]/g, '').trim();
    if (!directDatasourceName) return;

    const directResolution = resolveDatasource(directDatasourceName, configIndex);
    if (directResolution?.treeNodeId) {
      navigateToTreeNode(directResolution.treeNodeId);
    }
  }, [expression, configIndex, configurations, findDatasourceNode, navigateToTreeNode, resolveBinding, resolveDatasource, resolveModelPath]);

  return (
    <span className={className} onClick={interactive ? navigateExpressionTarget : undefined} title={interactive ? t.openInExplorerAction : undefined}>
      <ClickablePath expression={expression} configIndex={configIndex} mode="binding-expr" interactive={false} highlight={highlight} />
    </span>
  );
}

/**
 * Returns `true` for a brief window right after `active` flips from false → true,
 * so callers can layer a one-shot "just navigated here" flash animation on top of
 * their normal `.selected`/`.search-match` styling (e.g. jumping in from Search
 * or Where-Used). Re-navigating to the same element re-triggers the flash.
 */
export function useNavFlash(active: boolean, duration = 1400): boolean {
  const [flash, setFlash] = useState(false);
  const wasActive = useRef(false);

  useEffect(() => {
    if (active && !wasActive.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), duration);
      wasActive.current = active;
      return () => clearTimeout(timer);
    }
    wasActive.current = active;
  }, [active, duration]);

  return flash;
}

/**
 * The designer header's usage hint.
 *
 * It used to be a sentence pinned to the right of every designer header —
 * permanent instructions that cost a header line and were read once. It is the
 * same text, parked behind an icon that sits at the end of the header (a
 * long-press reaches it on touch).
 */
export function DesignerHint({ text }: { text: string }) {
  return (
    <Tooltip content={text} relationship="label" withArrow>
      <span className="fmt-header-hint" tabIndex={0} role="note" aria-label={text}>
        <InfoRegular fontSize={14} />
      </span>
    </Tooltip>
  );
}

/** Segmented tab strip with a sliding highlight that animates to the active tab's own position/width. */
export function SlidingTabs<TId extends string>({ tabs, activeId, onChange }: {
  tabs: Array<{ id: TId; label: React.ReactNode; title?: string }>;
  activeId: TId;
  onChange: (id: TId) => void;
}) {
  const btnRefs = useRef<Map<TId, HTMLButtonElement>>(new Map());
  const [thumbRect, setThumbRect] = useState<{ left: number; width: number } | null>(null);

  // Measure when the active tab or the tab set changes, and again whenever a
  // tab button resizes — labels change width with counts, the language and the
  // technical-details toggle, and a wider tab shifts every tab after it. The
  // state update bails out when the rect is unchanged, so it cannot loop.
  useLayoutEffect(() => {
    const measure = () => {
      const btn = btnRefs.current.get(activeId);
      if (!btn) return;
      const next = { left: btn.offsetLeft, width: btn.offsetWidth };
      setThumbRect(prev => (prev && prev.left === next.left && prev.width === next.width) ? prev : next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    btnRefs.current.forEach(btn => observer.observe(btn));
    return () => observer.disconnect();
  }, [activeId, tabs]);

  useEffect(() => {
    const handleResize = () => {
      const btn = btnRefs.current.get(activeId);
      if (!btn) return;
      const next = { left: btn.offsetLeft, width: btn.offsetWidth };
      setThumbRect(prev => (prev && prev.left === next.left && prev.width === next.width) ? prev : next);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeId]);

  return (
    <div className="fmt-sliding-tabs" role="tablist">
      {thumbRect && (
        <div
          className="fmt-sliding-tabs__thumb"
          aria-hidden="true"
          style={{ transform: `translateX(${thumbRect.left}px)`, width: thumbRect.width }}
        />
      )}
      {tabs.map(tab => (
        <button
          key={tab.id}
          ref={el => { if (el) btnRefs.current.set(tab.id, el); else btnRefs.current.delete(tab.id); }}
          type="button"
          role="tab"
          aria-selected={activeId === tab.id}
          className={`fmt-sliding-tabs__btn ${activeId === tab.id ? 'active' : ''}`}
          title={tab.title}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Enum name, with its source kind ("Ax Enum", …) only in the technical view. */
export function enumLabelFor(enumInfo: any, showTechnicalDetails: boolean): string {
  return showTechnicalDetails ? formatEnumDisplayName(enumInfo.enumName, enumInfo) : enumInfo.enumName;
}

/** Element type as it should read in the current mode. */
export function formatTypeLabelFor(type: string, showTechnicalDetails: boolean | undefined): string {
  return showTechnicalDetails ? type : getConsultantFormatTypeLabel(type);
}

/**
 * The datasource a designer tab was opened for, as a datasource path key —
 * the name alone cannot tell apart two `$Split_Note` fields under different
 * model records.
 */
export function datasourceFocusKey(focusNode: any): string | undefined {
  return focusNode?.type === 'datasource' ? datasourcePathKey(focusNode.data?.parentPath, focusNode.name) : undefined;
}

/** Every datasource name in a tree, children included. */
export function collectDatasourceTerms(datasources: any[], out: string[] = []): string[] {
  for (const ds of datasources ?? []) {
    if (ds?.name) out.push(ds.name);
    if (ds?.children?.length) collectDatasourceTerms(ds.children, out);
  }
  return out;
}

export const EMPTY_STRING_SET: ReadonlySet<string> = new Set();

/**
 * A designer row's ⋮ menu. Selecting a row in a designer leaves the explorer
 * alone; this is where the user asks it to follow.
 */
export function RevealInExplorerMenu({ onReveal, onClosed }: { onReveal: () => void; onClosed?: () => void }) {
  return (
    <Menu onOpenChange={(_, data) => { if (!data.open) onClosed?.(); }}>
      <MenuTrigger disableButtonEnhancement>
        <button
          type="button"
          className="fmt-row-actions"
          title={t.explorerMoreActions}
          aria-label={t.explorerMoreActions}
          onClick={event => event.stopPropagation()}
        >
          <MoreVerticalRegular fontSize={14} />
        </button>
      </MenuTrigger>
      {/* The popover is portalled, but React still bubbles its clicks to the
          row, whose onClick would re-select (and re-mute) it right after the
          reveal. */}
      <MenuPopover onClick={event => event.stopPropagation()}>
        <MenuList>
          <MenuItem icon={<AppsListDetailRegular />} onClick={onReveal}>
            {t.propRevealInExplorer}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function fieldTypeLabel(type: number): string {
  const map: Record<number, string> = {
    1: 'Bool', 3: 'Int64', 4: 'Int', 5: 'Real',
    6: 'Str', 7: 'Date', 9: 'Enum', 10: 'Rec',
    11: 'RecList', 13: 'Binary',
  };
  return map[type] ?? '?';
}
