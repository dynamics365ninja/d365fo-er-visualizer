import React, { useMemo, useState } from 'react';
import { BracesRegular, ChevronRightRegular, OpenRegular, TagRegular } from '@fluentui/react-icons';
import { type ModelUsageNode } from '../../utils/format-model-usage';
import { DrillDownTrigger } from '../DrillDownPanel';
import { ElementDrillDown } from './lineage-parts';
import { t } from '../../i18n';
import { getConsultantBindingLabel, getConsultantFormatTypeLabel } from '../../utils/consultant-labels';
import { getFormatBindingDisplayLabel, groupFormatBindingsByCategory, type NormalizedFormatBinding, type NormalizedFormatBindingGroup } from '../../utils/format-binding-display';
import {
  BINDING_INTENT_ORDER,
  classifyBindingIntent,
  getBindingIntentHint,
  getBindingIntentItemLabel,
  getBindingIntentLabel,
  type BindingIntent,
} from '../../utils/format-binding-sections';
import { FormulaLines } from './shared';
import { FormatElementIcon, getFormatTypeColor } from './format-type';

// ── Bindings tab ──

/** Above this many bindings the tab opens as an outline of its sections. */
export const BINDING_OUTLINE_THRESHOLD = 40;

/** Elements listed per model field before the rest hide behind "+N more". */
const MODEL_USAGE_CHIP_LIMIT = 8;

// ── Shared rows: both layouts read the same way ──
//
// A group (a parent element of the format, a record of the model) is a header
// row that folds; an item (a format element, a model field) is a row with its
// icon, name and a muted description, and under it one line per binding — a
// coloured dot and label, then the value. Top-level groups stay in view while
// their items scroll. No counts: the rows say what is there.

/** The format element's icon in the colour of its type, as in the structure. */
export function FormatTypeIcon({ type }: { type: string }) {
  return (
    <span className="fb-icon" style={{ color: getFormatTypeColor(type) }}>
      <FormatElementIcon type={type} fontSize={16} />
    </span>
  );
}

/** A group's header: twistie, icon, title and a muted description. */
export function BindingGroupHead({ depth, open, onToggle, icon, title, description, hint }: {
  depth: number;
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: string;
  hint?: string;
}) {
  return (
    <div
      className={`fb-head fb-head--group${depth === 0 ? ' fb-head--top' : ''}`}
      style={{ ['--fb-depth' as string]: depth }}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      title={hint}
      onClick={onToggle}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onToggle();
      }}
    >
      <span className={`fb-twistie${open ? ' open' : ''}`} aria-hidden><ChevronRightRegular fontSize={16} /></span>
      {icon}
      <span className="fb-title">{title}</span>
      {description && <span className="fb-desc">{description}</span>}
    </div>
  );
}

/** An item: its head row and, under the name, the lines of its bindings. */
export function BindingItem({ depth, icon, name, hint, description, aside, actions, focused, warning, flash, itemRef, toggle, onSelect, lines }: {
  depth: number;
  icon: React.ReactNode;
  name: string;
  hint?: string;
  description?: string;
  aside?: React.ReactNode;
  actions?: React.ReactNode;
  focused?: boolean;
  /** Read by the format but filled by nothing. */
  warning?: boolean;
  /** Just navigated to: a one-shot pulse. */
  flash?: boolean;
  itemRef?: React.Ref<HTMLDivElement>;
  onSelect?: () => void;
  /** An item that also has items under it (a list the format iterates). */
  toggle?: { open: boolean; onToggle: () => void };
  lines?: React.ReactNode;
}) {
  return (
    <div
      ref={itemRef}
      className={`fb-item${focused ? ' is-focused' : ''}${warning ? ' fb-item--warning' : ''}${flash ? ' nav-flash' : ''}`}
      style={{ ['--fb-depth' as string]: depth }}
      onClick={onSelect}
    >
      <div
        className="fb-head fb-head--item"
        onClick={toggle && !onSelect ? toggle.onToggle : undefined}
        style={toggle || onSelect ? { cursor: 'pointer' } : undefined}
      >
        {toggle ? (
          <button
            type="button"
            className={`fb-twistie fb-twistie--button${toggle.open ? ' open' : ''}`}
            aria-expanded={toggle.open}
            aria-label={name}
            onClick={event => { event.stopPropagation(); toggle.onToggle(); }}
          >
            <ChevronRightRegular fontSize={16} />
          </button>
        ) : (
          <span className="fb-twistie fb-twistie--leaf" aria-hidden />
        )}
        {icon}
        <span className="fb-name" title={hint ?? name}>{name}</span>
        {description && <span className="fb-desc" title={description}>{description}</span>}
        <span className="fb-spacer" />
        {aside}
        {actions && <span className="fb-actions">{actions}</span>}
      </div>
      {lines && <div className="fb-lines">{lines}</div>}
    </div>
  );
}

/** One line under an item: a dot in the line's colour and its label, then the value. */
export function BindingLine({ tone, label, hint, children }: { tone: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <>
      <span className={`fb-line-label ${tone}`} title={hint}>
        <span className="fb-dot" aria-hidden />
        {label}
      </span>
      <div className="fb-line-value">{children}</div>
    </>
  );
}

/** A formula after the arrow that says where the value comes from. */
export function BindingExpression({ children }: { children: React.ReactNode }) {
  return (
    <span className="fb-expr">
      <span className="fb-arrow" aria-hidden>←</span>
      <span className="fb-expr-text">{children}</span>
    </span>
  );
}

/** The Bindings tab by model: summary line and the tree of model paths the format reads. */
export function ModelUsageView({
  tree, stats, descriptor, mapping, dataModelLoaded, onlyUnmapped, onOnlyUnmappedChange,
  isCollapsed, onToggle, labelFor, showTechnicalDetails, onOpenElement, onOpenMapping, empty,
}: {
  tree: ModelUsageNode[];
  stats: { fields: number; unmapped: number };
  descriptor: string;
  mapping: { name: string; configIndex: number } | null;
  dataModelLoaded: boolean;
  onlyUnmapped: boolean;
  onOnlyUnmappedChange: (next: boolean) => void;
  isCollapsed: (key: string) => boolean;
  onToggle: (key: string) => void;
  labelFor: (node: ModelUsageNode) => string | undefined;
  showTechnicalDetails: boolean;
  onOpenElement: (elementId: string) => void;
  onOpenMapping: (configIndex: number) => void;
  empty: React.ReactNode;
}) {
  return (
    <>
      <div className="fmt-model-summary">
        <span>
          {t.fbReadsPrefix}
          <strong>{stats.fields}</strong>
          {t.fbReadsSuffix(stats.fields)}
        </span>
        {mapping
          ? (
            <span>
              {t.fbMappingPrefix}
              <button type="button" className="fmt-model-summary-link" onClick={() => onOpenMapping(mapping.configIndex)}>
                {mapping.name}
              </button>
            </span>
          )
          : (
            <span className="fmt-model-summary-warning">
              {t.fbMappingNotLoadedFor(descriptor)}
            </span>
          )}
        {mapping && stats.unmapped > 0 && (
          <span className="fmt-model-summary-warning">
            {t.fbUnmappedCount(stats.unmapped)}
          </span>
        )}
        {!dataModelLoaded && (
          <span>{t.fbLoadModelForLabels}</span>
        )}
        {mapping && (
          <button
            type="button"
            className={`fmt-bind-intent-chip fmt-bind-intent--condition fmt-model-unmapped-toggle ${onlyUnmapped ? 'active' : ''}`}
            aria-pressed={onlyUnmapped}
            disabled={stats.unmapped === 0 && !onlyUnmapped}
            title={t.fbOnlyUnmappedHint}
            onClick={() => onOnlyUnmappedChange(!onlyUnmapped)}
          >
            <span className="fmt-bind-intent-dot" aria-hidden="true" />
            <span>{t.fbOnlyUnmapped}</span>
            <span className="fmt-bind-intent-count">{stats.unmapped}</span>
          </button>
        )}
      </div>

      {tree.length === 0
        ? (onlyUnmapped
            ? <div className="fmt-bind-empty">{t.fbAllFieldsMapped}</div>
            : empty)
        : (
          <div className="fb-tree" role="tree">
            {tree.map(node => (
              <ModelUsageTreeRows
                key={node.key}
                node={node}
                depth={0}
                mappingConfigIndex={mapping?.configIndex ?? 0}
                isCollapsed={isCollapsed}
                onToggle={onToggle}
                labelFor={labelFor}
                showTechnicalDetails={showTechnicalDetails}
                onOpenElement={onOpenElement}
              />
            ))}
          </div>
        )}
    </>
  );
}

/**
 * One model path: its field label, the mapping binding that fills it (with the
 * drill-down), and the format elements that read it.
 */
function ModelUsageTreeRows({ node, depth, mappingConfigIndex, isCollapsed, onToggle, labelFor, showTechnicalDetails, onOpenElement }: {
  node: ModelUsageNode;
  depth: number;
  mappingConfigIndex: number;
  isCollapsed: (key: string) => boolean;
  onToggle: (key: string) => void;
  labelFor: (node: ModelUsageNode) => string | undefined;
  showTechnicalDetails: boolean;
  onOpenElement: (elementId: string) => void;
}) {
  const [showAllUsages, setShowAllUsages] = useState(false);
  const hasChildren = node.children.length > 0;
  const open = hasChildren && !isCollapsed(node.key);
  const used = node.usages.length > 0;
  const label = labelFor(node);
  const usages = showAllUsages ? node.usages : node.usages.slice(0, MODEL_USAGE_CHIP_LIMIT);
  const icon = hasChildren
    ? <span className="fb-icon fb-icon--record"><BracesRegular fontSize={16} /></span>
    : <span className="fb-icon fb-icon--field"><TagRegular fontSize={16} /></span>;

  const children = open && (
    <div role="group">
      {node.children.map(child => (
        <ModelUsageTreeRows
          key={child.key}
          node={child}
          depth={depth + 1}
          mappingConfigIndex={mappingConfigIndex}
          isCollapsed={isCollapsed}
          onToggle={onToggle}
          labelFor={labelFor}
          showTechnicalDetails={showTechnicalDetails}
          onOpenElement={onOpenElement}
        />
      ))}
    </div>
  );

  // A record the format only reads fields of: a group.
  if (!used) {
    return (
      <div role="treeitem" aria-expanded={hasChildren ? open : undefined}>
        <BindingGroupHead
          depth={depth}
          open={open}
          onToggle={() => onToggle(node.key)}
          icon={icon}
          title={node.name}
          description={label}
          hint={node.path}
        />
        {children}
      </div>
    );
  }

  // A field the format reads: how the mapping fills it, which elements read it.
  return (
    <div role="treeitem" aria-expanded={hasChildren ? open : undefined}>
      <BindingItem
        depth={depth}
        icon={icon}
        name={node.name}
        hint={node.path}
        description={label}
        warning={node.unmapped}
        toggle={hasChildren ? { open, onToggle: () => onToggle(node.key) } : undefined}
        lines={(
          <>
            <BindingLine tone="fb-tone--mapping" label={t.fbLineMapping}>
              {node.mapping ? (
                <BindingExpression>
                  <DrillDownTrigger expression={node.mapping.expressionAsString} configIndex={mappingConfigIndex} elementName={node.path}>
                    <FormulaLines expression={node.mapping.expressionAsString} configIndex={mappingConfigIndex} />
                  </DrillDownTrigger>
                </BindingExpression>
              ) : node.unmapped ? (
                <span className="fb-note fb-note--warning" title={t.fbFieldNeverFilledHint}>{t.fbNoMappingBinding}</span>
              ) : !node.mappingLoaded ? (
                <span className="fb-note">{t.fbMappingNotLoaded}</span>
              ) : (
                <span className="fb-note">{t.fbRecordFieldsBound}</span>
              )}
            </BindingLine>
            <BindingLine tone="fb-tone--format" label={t.fbLineFormat}>
              <div className="fb-chips">
                {usages.map((usage, i) => {
                  const property = usage.binding.bindingCategory === 'data'
                    ? null
                    : (showTechnicalDetails ? getFormatBindingDisplayLabel(usage.binding) : getConsultantBindingLabel(usage.binding));
                  return (
                    <button
                      key={`${usage.group.componentId}-${i}`}
                      type="button"
                      className={`fb-chip fmt-bind-intent--${usage.intent}`}
                      title={`${getBindingIntentItemLabel(usage.intent)}: ${usage.binding.expressionAsString}`}
                      onClick={() => onOpenElement(usage.group.componentId)}
                    >
                      <span className="fb-dot" aria-hidden />
                      <span>{usage.group.elementName}</span>
                      {property && <span className="fb-chip-prop">{property}</span>}
                    </button>
                  );
                })}
                {node.usages.length > usages.length && (
                  <button type="button" className="fb-more" onClick={() => setShowAllUsages(true)}>
                    {t.fbMoreUsages(node.usages.length - usages.length)}
                  </button>
                )}
              </div>
            </BindingLine>
          </>
        )}
      />
      {children}
    </div>
  );
}

export function BindingIntentBar({ layout, onLayoutChange, counts, active, onChange }: {
  layout: 'format' | 'model';
  onLayoutChange: (layout: 'format' | 'model') => void;
  counts: Record<BindingIntent, number>;
  active: readonly BindingIntent[];
  onChange: (next: readonly BindingIntent[]) => void;
}) {
  const layouts: Array<{ id: 'format' | 'model'; label: string; title: string }> = [
    {
      id: 'format',
      label: t.fbLayoutByFormat,
      title: t.fbLayoutByFormatHint,
    },
    {
      id: 'model',
      label: t.fbLayoutByModel,
      title: t.fbLayoutByModelHint,
    },
  ];
  return (
    <div className="fmt-bind-intent-bar" role="toolbar" aria-label={t.fbToolbarAria}>
      <div className="fmt-bind-layout" role="radiogroup" aria-label={t.fbLayoutAria}>
        {layouts.map(option => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={layout === option.id}
            className={layout === option.id ? 'active' : ''}
            title={option.title}
            onClick={() => onLayoutChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="fmt-bind-bar-sep" aria-hidden="true" />
      {BINDING_INTENT_ORDER.map(intent => {
        const isActive = active.includes(intent);
        return (
          <button
            key={intent}
            type="button"
            className={`fmt-bind-intent-chip fmt-bind-intent--${intent} ${isActive ? 'active' : ''}`}
            aria-pressed={isActive}
            // An intent with nothing in it can still be switched off, never on.
            disabled={counts[intent] === 0 && !isActive}
            title={getBindingIntentHint(intent)}
            onClick={() => onChange(isActive
              ? active.filter(other => other !== intent)
              : BINDING_INTENT_ORDER.filter(other => other === intent || active.includes(other)))}
          >
            <span className="fmt-bind-intent-dot" aria-hidden="true" />
            <span>{getBindingIntentLabel(intent)}</span>
            <span className="fmt-bind-intent-count">{counts[intent]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** An empty list says whether the chips are what hides the bindings, and offers to undo that. */
export function BindingListEmpty({ filter, counts, active, onShowAll }: {
  filter: string;
  counts: Record<BindingIntent, number>;
  active: readonly BindingIntent[];
  onShowAll: () => void;
}) {
  const hidden = BINDING_INTENT_ORDER.filter(intent => !active.includes(intent) && counts[intent] > 0);
  if (hidden.length === 0) {
    return <div className="fmt-bind-empty">{filter ? t.noResults : `${t.bindings}: 0`}</div>;
  }
  const hiddenList = hidden.map(intent => `${getBindingIntentLabel(intent)} (${counts[intent]})`).join(', ');
  return (
    <div className="fmt-bind-empty">
      <span>{t.fbNothingInSelectedTypes(hiddenList)}</span>
      <button type="button" className="fmt-bind-intent-chip" onClick={onShowAll}>
        {t.fbShowAll}
      </button>
    </div>
  );
}

// ── Binding card: an element and the bindings of it that pass the filter ──

export function FormatElementBindingGroup({ row, bindings, focused, cardRef, configIndex, onReveal, showTechnicalDetails }: {
  row: NormalizedFormatBindingGroup;
  bindings: NormalizedFormatBinding[];
  focused?: boolean;
  cardRef?: React.Ref<HTMLDivElement>;
  configIndex: number;
  onReveal?: (elementId: string) => void;
  showTechnicalDetails: boolean;
}) {
  // Values first, then conditions and properties — the inspector's order.
  const ordered = useMemo(() => groupFormatBindingsByCategory(bindings).flatMap(category => category.bindings), [bindings]);

  return (
    <BindingItem
      depth={1}
      itemRef={cardRef}
      focused={focused}
      icon={<FormatTypeIcon type={row.elementType} />}
      name={row.elementName}
      description={showTechnicalDetails ? row.elementType : getConsultantFormatTypeLabel(row.elementType)}
      actions={onReveal && (
        <button
          type="button"
          className="fb-action"
          onClick={e => { e.stopPropagation(); onReveal(row.componentId); }}
          title={t.openInExplorerAction}
          aria-label={t.openInExplorerAction}
        >
          <OpenRegular fontSize={14} />
        </button>
      )}
      lines={ordered.map((binding, i) => {
        const intent = classifyBindingIntent(binding);
        const label = showTechnicalDetails
          ? getFormatBindingDisplayLabel(binding)
          // A consultant reads what a value binding does; a switch keeps its on/off wording.
          : binding.bindingCategory === 'data' ? getBindingIntentItemLabel(intent) : getConsultantBindingLabel(binding);
        return (
          <BindingLine
            key={`${binding.bindingCategory}-${i}`}
            tone={`fmt-bind-intent--${intent}`}
            label={label}
            hint={`${getBindingIntentItemLabel(intent)} — ${getBindingIntentHint(intent)}`}
          >
            {showTechnicalDetails && binding.promotedFromChild && binding.rawElementType && (
              <span className="fb-note">{t.bindingVia} {binding.rawElementType}</span>
            )}
            <BindingExpression>
              <ElementDrillDown
                expression={binding.expressionAsString}
                configIndex={configIndex}
                elementId={row.componentId}
                elementName={row.elementName}
              >
                <FormulaLines expression={binding.expressionAsString} configIndex={configIndex} />
              </ElementDrillDown>
            </BindingExpression>
          </BindingLine>
        );
      })}
    />
  );
}
