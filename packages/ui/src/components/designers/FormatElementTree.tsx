import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { DrillDownTrigger } from '../DrillDownPanel';
import { t, useLocale } from '../../i18n';
import { isTreeArrowKey, treeArrowAction } from '../../utils/tree-keyboard';
import { getBindingCategoryLabel, getConsultantBindingLabel, isXmlNamespaceDeclaration } from '../../utils/consultant-labels';
import { getFormatBindingCategoryLabel, getFormatBindingDisplayLabel, groupFormatBindingsByCategory } from '../../utils/format-binding-display';
import { type FormatTreeIndex } from '../../utils/format-tree-filter';
import { getFormatElementExcelRange, type ERLabel } from '@er-visualizer/core';
import { resolveLabel, buildLabelPool } from '../../utils/label-resolver';
import { firstChildRow, flattenVisibleTree, indexFlatRows, type FlatTreeRow } from '../../utils/flat-tree';
import { useTreeOpenState } from '../../utils/use-tree-open-state';
import { useVirtualTree } from '../../utils/use-virtual-tree';
import { HighlightMatch, ExpressionDetailLink, useNavFlash, RevealInExplorerMenu } from './shared';
import { getFormatTypeColor, formatTypeIcons } from './format-type';

// ── Format Element Tree (virtualized) ──

/**
 * `FormatTreeIndex` precomputes the answers every row used to derive by walking
 * its own subtree — which made rendering O(n²) on every keystroke. Built by
 * `buildFormatTreeIndex` in utils/format-tree-filter.
 *
 * The tree is flattened into the rows it shows (see utils/flat-tree) and only
 * the rows in and around the viewport are mounted, so the open/closed state
 * that each recursive row used to hold lives here instead.
 */

interface FormatStructureTreeProps {
  rootElement: any;
  /** The pane that scrolls the tree. */
  scrollRef: React.RefObject<HTMLElement | null>;
  bindingMap: Map<string, any[]>;
  transformationMap: Map<string, any>;
  configIndex: number;
  filter: string;
  expandMode: 'all' | 'none';
  expandVersion: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  showTechnicalDetails: boolean;
  bindingFilter?: 'all' | 'bound' | 'unbound';
  treeIndex: FormatTreeIndex;
  /** Ancestors of the selected element — those rows auto-expand. */
  selectedAncestors: Set<string>;
  /** Shows the element's node in the explorer — offered in each row's ⋮ menu. */
  onReveal?: (elementId: string) => void;
}

/**
 * Arrow keys work wherever focus sits in the structure tree — on an expression
 * in the binding card under the selected row, or on the list's empty space —
 * by handing the key to the selected row, which owns its expanded state. The
 * forwarded event targets the row itself, so it stops there on the way back up.
 */
function forwardArrowKeyToSelectedRow(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!isTreeArrowKey(event.key) || event.defaultPrevented) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLElement;
  // React bubbles keys from portals (a row's ⋮ menu) up to here too; those
  // arrows belong to the menu.
  if (!event.currentTarget.contains(target)) return;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const row = event.currentTarget.querySelector<HTMLElement>('.fmt-element-row.selected')
    ?? event.currentTarget.querySelector<HTMLElement>('.fmt-element-row');
  if (!row || row === target) return;
  row.focus({ preventScroll: true });
  const forwarded = new KeyboardEvent('keydown', { key: event.key, bubbles: true, cancelable: true });
  row.dispatchEvent(forwarded);
  if (forwarded.defaultPrevented) event.preventDefault();
}

/** What a row hands down to the rows below it while the tree is filtered. */
interface FormatTreeContext {
  /** An ancestor matched and was opened by hand — everything below it shows. */
  showAll: boolean;
}

/** Rendered row height before it is measured: a one-line row plus its gap. */
const ESTIMATED_ROW_HEIGHT = 40;
/** `.fmt-element-row`'s top margin, which collapsed into the list's padding before the rows were absolutely positioned. */
const ROW_GAP = 5;

export function FormatStructureTree({ rootElement, scrollRef, bindingMap, transformationMap, configIndex, filter, expandMode, expandVersion, selectedId, onSelect, showTechnicalDetails, bindingFilter, treeIndex, selectedAncestors, onReveal }: FormatStructureTreeProps) {
  const configurations = useAppStore(s => s.configurations);
  const labels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);

  // Rows opened and closed by hand, on top of expand-all / collapse-all. A new
  // expand-all or collapse-all starts over from its own mode.
  const { overrides: openOverrides, setOpen } = useTreeOpenState(`${expandMode}#${expandVersion}`);
  // While filtering, rows the user opened themselves. Reset whenever the
  // filter changes, so a new query starts from the same collapsed state everywhere.
  const { overrides: manualOverrides, setOpen: setManual } = useTreeOpenState(filter);

  // A row opened because the selection sat below it stays open once the
  // selection moves up, as in the explorer — otherwise ← to the parent would
  // fold the parent shut in the same keystroke.
  useEffect(() => {
    if (selectedAncestors.size > 0) setOpen(selectedAncestors, true);
  }, [selectedAncestors, setOpen]);

  const hasMatchingDescendant = useCallback(
    (element: any) => (element.children ?? []).some((child: any) => treeIndex.subtreeMatch.has(child.id)),
    [treeIndex],
  );

  const rows = useMemo(() => flattenVisibleTree<any, FormatTreeContext>([rootElement], {
    getId: element => element.id,
    getChildren: element => element.children,
    context: { showAll: false },
    isVisible: (element, context) => {
      const matchesFilter = !filter || treeIndex.selfMatch.has(element.id);
      const descendantMatches = !filter || treeIndex.subtreeMatch.has(element.id);
      if (filter && !context.showAll && !matchesFilter && !descendantMatches) return false;

      if (!showTechnicalDetails && isXmlNamespaceDeclaration(element)) return false;

      // Binding filter
      if (bindingFilter && bindingFilter !== 'all') {
        const hasBound = (bindingMap.get(element.id) ?? []).some((b: any) => b.bindingCategory === 'data');
        if (bindingFilter === 'bound' && !hasBound) {
          // Still show if it has children (structural container) that lead to a binding.
          if (!(element.children?.length > 0)) return false;
          if (!treeIndex.subtreeBound.has(element.id)) return false;
        }
        if (bindingFilter === 'unbound' && hasBound) return false;
      }
      return true;
    },
    /*
     * While filtering, only the path *down to* the matches is opened. A node that
     * matches itself stays collapsed: expanding its whole subtree made every
     * descendant look like a match too (search "ReferenceNumber", land on VetaA5,
     * and its children appear as if they contained the word). The chevron still
     * opens it, and everything below a match is exempt from the filter — so the
     * children are there when you want them.
     */
    isExpanded: element => (filter
      ? hasMatchingDescendant(element) || manualOverrides.get(element.id) === true
      // Auto-expand when the selection lives somewhere below this element.
      : (openOverrides.get(element.id) ?? expandMode === 'all') || selectedAncestors.has(element.id)),
    // Only an explicit chevron click lifts the filter for the subtree.
    // Auto-expanding a match used to do it too, which made every
    // descendant of a hit look like a hit of its own.
    childContext: (element, context) => ({
      showAll: context.showAll || ((!filter || treeIndex.selfMatch.has(element.id)) && manualOverrides.get(element.id) === true),
    }),
  }), [rootElement, filter, treeIndex, showTechnicalDetails, bindingFilter, bindingMap, hasMatchingDescendant, manualOverrides, openOverrides, expandMode, selectedAncestors]);

  const indexById = useMemo(() => indexFlatRows(rows), [rows]);
  const selectedIndex = selectedId ? indexById.get(selectedId) : undefined;
  // One tab stop for the whole tree: the selected row, or the root before
  // anything is selected. It stays mounted wherever the list is scrolled.
  const tabStopIndex = selectedId ? selectedIndex : (rows.length > 0 ? 0 : undefined);
  // The row that has focus stays mounted too, until focus moves on: an arrow
  // key pressed after scrolling it out of view must not lose focus with it.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIndex = focusedId ? indexById.get(focusedId) : undefined;

  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { virtualizer, scrollMargin } = useVirtualTree({
    rows,
    scrollRef,
    containerRef,
    estimateSize: ESTIMATED_ROW_HEIGHT,
    pinned: [tabStopIndex, focusedIndex],
    paddingStart: ROW_GAP,
  });

  // Scroll into view when an element becomes selected (e.g. navigate from
  // template preview) — once, as soon as its row is shown. A row that is
  // folded or filtered away and comes back is scrolled to again, as the
  // remounted row used to.
  const scrolledToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || selectedIndex == null) { scrolledToRef.current = null; return; }
    // Not before the virtualizer has found the pane (see useVirtualTree) —
    // this runs again on the render that attaches it.
    if (scrolledToRef.current === selectedId || !virtualizer.scrollElement) return;
    scrolledToRef.current = selectedId;
    // Arrow keys move the selection, so focus follows it — but only when
    // focus is already in this tree, never pulled in from the explorer or
    // the search panel. A keyboard step only nudges the row into view;
    // re-centring on every ↓ made the list lurch.
    const inTree = Boolean(document.activeElement?.closest('.fmt-structure-list'));
    virtualizer.scrollToIndex(selectedIndex, { align: inTree ? 'auto' : 'center' });
    if (inTree) {
      // The selected row is pinned, so it is rendered even before the scroll lands.
      const row = listRef.current?.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(selectedId)}"]`);
      row?.focus({ preventScroll: true });
    }
  });

  // Row callbacks read the current rows through a ref, so they keep their
  // identity and the memoized rows are not re-rendered by a fresh closure.
  const latest = useRef({ rows, indexById, filter });
  latest.current = { rows, indexById, filter };

  const setExpanded = useCallback((id: string, open: boolean) => {
    if (latest.current.filter) setManual(id, open);
    else setOpen(id, open);
  }, [setManual, setOpen]);

  const step = useCallback((id: string, action: 'previous' | 'next' | 'firstChild') => {
    const { rows: current, indexById: index } = latest.current;
    const at = index.get(id);
    if (at == null) return;
    // The flat list holds every visible row, rendered or not.
    const target = action === 'firstChild'
      ? firstChildRow(current, at)
      : current[at + (action === 'next' ? 1 : -1)];
    if (target) onSelect(target.id);
  }, [onSelect]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      className="fmt-structure-list"
      role="tree"
      aria-label={t.structure}
      // Focusable, but not a tab stop: a click on empty space keeps
      // focus in the tree so the arrows still reach it.
      tabIndex={-1}
      onKeyDown={forwardArrowKeyToSelectedRow}
      onFocus={event => setFocusedId((event.target as HTMLElement).dataset.elementId ?? null)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null); }}
    >
      <div ref={containerRef} style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
        {virtualItems.map(item => {
          const row = rows[item.index];
          if (!row) return null;
          const element = row.node;
          const isManual = manualOverrides.get(row.id) === true;
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - scrollMargin}px)` }}
            >
              <FormatElementRow
                row={row}
                bindingMap={bindingMap}
                transformationMap={transformationMap}
                configIndex={configIndex}
                labels={labels}
                filter={filter}
                isSelected={row.id === selectedId}
                isTabStop={item.index === tabStopIndex}
                manuallyExpanded={isManual}
                // While filtering, a row that leads to a match stays open — its chevron
                // can't close it either.
                collapsible={filter ? isManual && !hasMatchingDescendant(element) : true}
                onSelect={onSelect}
                onSetExpanded={setExpanded}
                onStep={step}
                showTechnicalDetails={showTechnicalDetails}
                treeIndex={treeIndex}
                onReveal={onReveal}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface FormatElementRowProps {
  row: FlatTreeRow<any>;
  bindingMap: Map<string, any[]>;
  transformationMap: Map<string, any>;
  configIndex: number;
  labels: ERLabel[];
  filter: string;
  isSelected: boolean;
  isTabStop: boolean;
  /** Opened by hand while filtering. */
  manuallyExpanded: boolean;
  /** ← would actually fold the row — false while a filter holds it open. */
  collapsible: boolean;
  onSelect: (id: string) => void;
  onSetExpanded: (id: string, open: boolean) => void;
  onStep: (id: string, action: 'previous' | 'next' | 'firstChild') => void;
  showTechnicalDetails: boolean;
  treeIndex: FormatTreeIndex;
  /** Shows the element's node in the explorer — offered in each row's ⋮ menu. */
  onReveal?: (elementId: string) => void;
}

/**
 * One element of the structure tree. Memoized, and handed the selection as a
 * plain flag — moving the selection re-renders the old and the new row rather
 * than every mounted one.
 */
const FormatElementRow = React.memo(function FormatElementRow({ row, bindingMap, transformationMap, configIndex, labels, filter, isSelected, isTabStop, manuallyExpanded, collapsible, onSelect, onSetExpanded, onStep, showTechnicalDetails, treeIndex, onReveal }: FormatElementRowProps) {
  const { node: element, depth, hasChildren, expanded: isExpanded } = row;
  // Not re-rendered by its parent on a language switch any more (memo), so it
  // listens for one itself.
  const activeLocale = useLocale();

  const bindings = bindingMap.get(element.id) ?? [];
  const bindingCategories = useMemo(() => groupFormatBindingsByCategory(bindings), [bindings]);
  const mainBinding = bindings.find(b => b.bindingCategory === 'data');
  const conditionalBindings = bindings.filter(b => b.bindingCategory !== 'data');
  const transformation = element.transformation ? transformationMap.get(element.transformation) : null;

  // Resolve label for this element
  const labelRef = element.attributes?.['Label'];
  const resolvedLabel = useMemo(() => resolveLabel(labelRef, labels), [labelRef, labels, activeLocale]);
  // An unresolved reference is only an id — worth showing in the technical view alone.
  const labelText = resolvedLabel?.localized ?? resolvedLabel?.enUs ?? (showTechnicalDetails && resolvedLabel?.id ? resolvedLabel.id : undefined);
  const excelRange = getFormatElementExcelRange(element);

  const matchesFilter = !filter || treeIndex.selfMatch.has(element.id);
  const navFlash = useNavFlash(isSelected);

  /*
   * A row can match through a binding the collapsed row never shows — most
   * often Visibility/Enabled — or through its element type alone. Without this
   * the row looked like a false positive: "VetaA5" with the term nowhere on it.
   */
  const matchReason = filter ? treeIndex.matchReason.get(element.id) : undefined;
  const matchedBinding = useMemo(() => {
    if (matchReason !== 'binding') return null;
    const found = treeIndex.matchedBinding.get(element.id) ?? null;
    // The data binding is already printed on the row — no need to repeat it.
    return found && found === mainBinding ? null : found;
  }, [matchReason, treeIndex, element.id, mainBinding]);

  const rowRef = React.useRef<HTMLDivElement>(null);

  // Closing the ⋮ menu hands focus back to the row rather than the ⋮ button:
  // on the button, ↓ reopens the menu instead of walking the tree. Focus that
  // has already moved elsewhere — a click outside the menu — is left alone.
  const returnFocusToRow = () => requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active || active === document.body || rowRef.current?.contains(active)) {
      rowRef.current?.focus({ preventScroll: true });
    }
  });

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Modified arrows are taken: Alt+← / Alt+→ walk the navigation history.
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const action = treeArrowAction(event.key, {
      hasChildren,
      expanded: isExpanded,
      collapsible,
      hasParent: treeIndex.parentOf.has(element.id),
    });
    if (!action) return;
    event.preventDefault();
    if (action === 'expand' || action === 'collapse') {
      onSetExpanded(element.id, action === 'expand');
    } else if (action === 'parent') {
      onSelect(treeIndex.parentOf.get(element.id)!);
    } else {
      // Steps through the flat list of visible rows, so the target may not
      // be rendered yet. The first child is the first one that is actually
      // shown: a filter, the binding filter or the consultant view can hide
      // the first one in the data.
      onStep(element.id, action);
    }
  };

  return (
    <>
      {/* Element Row */}
      <div
        ref={rowRef}
        role="treeitem"
        aria-level={depth + 1}
        // Most siblings are not in the DOM, so the position is spelled out.
        aria-setsize={row.setSize}
        aria-posinset={row.posInSet}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        // One tab stop for the whole tree: the selected row, or the root
        // before anything is selected.
        tabIndex={isTabStop ? 0 : -1}
        data-element-id={element.id}
        className={`fmt-element-row ${isSelected ? 'selected' : ''} ${!mainBinding ? 'unbound' : ''} ${filter && matchesFilter ? 'search-match' : ''} ${navFlash ? 'nav-flash' : ''}`}
        // The row's top margin used to collapse into the previous row's bottom
        // margin; absolutely positioned rows don't collapse, so only the bottom
        // one is kept.
        style={{ paddingLeft: depth * 20 + 4, marginTop: 0 }}
        onClick={() => onSelect(element.id)}
        onKeyDown={handleRowKeyDown}
      >
        {/* Expand/Collapse Toggle */}
        <span
          className="fmt-toggle"
          onClick={e => {
            e.stopPropagation();
            if (!hasChildren) return;
            onSetExpanded(element.id, filter ? !manuallyExpanded : !isExpanded);
          }}
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
            <HighlightMatch text={element.elementType} query={filter} />
          </span>
        )}

        {/* Element Name */}
        <span className="fmt-element-name">
          <HighlightMatch text={element.name} query={filter} />
        </span>

        {/* ExcelRange address */}
        {excelRange && excelRange !== element.name && (
          <span className="fmt-meta" style={{ fontFamily: 'var(--font-mono, monospace)' }}>[{excelRange}]</span>
        )}

        {/* Resolved label */}
        {labelText && (
          <span className="fmt-meta" title={resolvedLabel?.raw ?? ''} style={{ fontStyle: 'italic' }}>
            — {labelText}
          </span>
        )}

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
          <span className="fmt-transform" title={`${t.propTransform}: ${transformation.expressionAsString}`}>
            🔄 {transformation.name}
          </span>
        )}

        {/* Conditional Bindings indicators */}
        {conditionalBindings.length > 0 && conditionalBindings.map((cb: any, i: number) => {
          const label = showTechnicalDetails ? getFormatBindingDisplayLabel(cb) : getConsultantBindingLabel(cb);
          return (
            <span key={i} className="fmt-cond-badge" title={`${label}: ${cb.expressionAsString}`}>
              {label}
            </span>
          );
        })}

        {/* Main Binding — the original formula shown inline */}
        {mainBinding && (
          <span className="fmt-binding-inline" onClick={e => e.stopPropagation()}>
            ← <ExpressionDetailLink expression={mainBinding.expressionAsString} configIndex={configIndex} highlight={filter} />
          </span>
        )}

        {/* Unbound indicator — leaf element with no data binding */}
        {!mainBinding && element.children && element.children.length === 0 && (
          <span className="fmt-unbound-marker">○ {t.unbound}</span>
        )}

        {/* Row actions — the explorer only follows the designer from here. */}
        {onReveal && <RevealInExplorerMenu onReveal={() => onReveal(element.id)} onClosed={returnFocusToRow} />}
      </div>

      {/* Why this row matched, when the match is not visible on the row itself. */}
      {matchedBinding && (
        <div className="fmt-match-reason" style={{ paddingLeft: depth * 20 + 30 }}>
          <span className="fmt-match-reason__prop">
            {showTechnicalDetails
              ? getFormatBindingDisplayLabel(matchedBinding)
              : getConsultantBindingLabel(matchedBinding)}
          </span>
          <ExpressionDetailLink
            expression={matchedBinding.expressionAsString}
            configIndex={configIndex}
            interactive={false}
            highlight={filter}
          />
        </div>
      )}

      {/* Expanded Binding Details — shown when element is selected */}
      {/* Only when there is something to show: an element without bindings
          would open a card that merely says so. */}
      {isSelected && bindings.length > 0 && (
        <div className="fmt-binding-expanded" style={{ marginLeft: depth * 20 + 28 }}>
          {bindingCategories.map(category => (
            <div key={category.key}>
              <div className="fmt-binding-category-title">
                {showTechnicalDetails ? getFormatBindingCategoryLabel(category.key) : getBindingCategoryLabel(category.key)} ({category.bindings.length})
              </div>
              {category.bindings.map((b: any, i: number) => (
                <div key={`${category.key}-${i}`} className="fmt-binding-detail-row">
                  <span className={`badge ${category.key === 'data' ? 'badge-success' : 'badge-prop'}`}>
                    {showTechnicalDetails ? getFormatBindingDisplayLabel(b) : getConsultantBindingLabel(b)}
                  </span>
                  {showTechnicalDetails && b.promotedFromChild && b.rawElementType && (
                    <span className="fmt-binding-origin">{t.bindingVia} {b.rawElementType}</span>
                  )}
                  <span className="fmt-binding-formula">
                    <DrillDownTrigger
                      expression={b.expressionAsString}
                      configIndex={configIndex}
                      elementName={element.name}
                    >
                      <ExpressionDetailLink expression={b.expressionAsString} configIndex={configIndex} interactive={false} />
                    </DrillDownTrigger>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
});
