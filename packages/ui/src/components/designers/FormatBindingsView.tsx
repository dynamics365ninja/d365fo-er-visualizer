import React, { useMemo, useState } from 'react';
import { TextBulletListTreeRegular } from '@fluentui/react-icons';
import { type ModelUsageNode } from '../../utils/format-model-usage';
import { ClickablePath } from '../ClickablePath';
import { DrillDownTrigger } from '../DrillDownPanel';
import { locale, t } from '../../i18n';
import { getConsultantBindingLabel } from '../../utils/consultant-labels';
import { getFormatBindingDisplayLabel, groupFormatBindingsByCategory, type NormalizedFormatBinding, type NormalizedFormatBindingGroup } from '../../utils/format-binding-display';
import {
  BINDING_INTENT_ORDER,
  classifyBindingIntent,
  getBindingIntentHint,
  getBindingIntentItemLabel,
  getBindingIntentLabel,
  type BindingIntent,
} from '../../utils/format-binding-sections';
import { getFormatTypeBadgeSurface } from '../../utils/theme-colors';
import { ExpressionDetailLink } from './shared';
import { getFormatTypeColor } from './format-type';

// ── Bindings tab ──

/** Above this many bindings the tab opens as an outline of its sections. */
export const BINDING_OUTLINE_THRESHOLD = 40;

/** Elements listed per model field before the rest hide behind "+N more". */
const MODEL_USAGE_CHIP_LIMIT = 8;

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
  const cs = locale === 'cs';
  const fieldsWord = cs
    ? (stats.fields >= 1 && stats.fields <= 4 ? 'pole' : 'polí')
    : (stats.fields === 1 ? 'field' : 'fields');

  return (
    <>
      <div className="fmt-model-summary">
        <span>
          {cs ? 'Formát čte ' : 'The format reads '}
          <strong>{stats.fields}</strong>
          {cs ? ` ${fieldsWord} modelu` : ` model ${fieldsWord}`}
        </span>
        {mapping
          ? (
            <span>
              {cs ? 'Mapování: ' : 'Mapping: '}
              <button type="button" className="fmt-model-summary-link" onClick={() => onOpenMapping(mapping.configIndex)}>
                {mapping.name}
              </button>
            </span>
          )
          : (
            <span className="fmt-model-summary-warning">
              {cs
                ? `Mapování pro ${descriptor || 'datový model'} není načtené`
                : `No model mapping loaded for ${descriptor || 'the data model'}`}
            </span>
          )}
        {mapping && stats.unmapped > 0 && (
          <span className="fmt-model-summary-warning">
            {cs ? `${stats.unmapped} bez vazby v mapování` : `${stats.unmapped} without a mapping binding`}
          </span>
        )}
        {!dataModelLoaded && (
          <span>{cs ? 'Popisky polí se ukážou po načtení datového modelu' : 'Load the data model to see field labels'}</span>
        )}
        {mapping && (
          <button
            type="button"
            className={`fmt-bind-intent-chip fmt-bind-intent--condition fmt-model-unmapped-toggle ${onlyUnmapped ? 'active' : ''}`}
            aria-pressed={onlyUnmapped}
            disabled={stats.unmapped === 0 && !onlyUnmapped}
            title={cs ? 'Jen pole, která formát čte a mapování neplní' : 'Only fields the format reads and the mapping never fills'}
            onClick={() => onOnlyUnmappedChange(!onlyUnmapped)}
          >
            <span className="fmt-bind-intent-dot" aria-hidden="true" />
            <span>{cs ? 'Jen bez vazby' : 'Unmapped only'}</span>
            <span className="fmt-bind-intent-count">{stats.unmapped}</span>
          </button>
        )}
      </div>

      {tree.length === 0
        ? (onlyUnmapped
            ? <div className="fmt-bind-empty">{cs ? 'Každé pole, které formát čte, má vazbu v mapování.' : 'Every field the format reads has a mapping binding.'}</div>
            : empty)
        : (
          <div className="mm-tree" role="tree">
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
  const cs = locale === 'cs';
  const hasChildren = node.children.length > 0;
  const collapsed = hasChildren && isCollapsed(node.key);
  const used = node.usages.length > 0;
  const label = labelFor(node);
  const usages = showAllUsages ? node.usages : node.usages.slice(0, MODEL_USAGE_CHIP_LIMIT);

  const classes = [
    'mm-tree-row',
    used ? 'mm-binding-row' : 'mm-tree-branch',
    hasChildren ? 'mm-tree-expandable' : '',
    node.unmapped ? 'fmt-model-row--unmapped' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="mm-tree-node" style={{ ['--mm-depth' as string]: depth }}>
      <div className={classes} role="treeitem" aria-expanded={hasChildren ? !collapsed : undefined}>
        <div
          className="mm-tree-head"
          onClick={hasChildren ? () => onToggle(node.key) : undefined}
          style={hasChildren ? { cursor: 'pointer' } : undefined}
        >
          {hasChildren ? (
            <button
              type="button"
              className={`mm-tree-toggle ${collapsed ? '' : 'open'}`}
              aria-label={node.name}
              onClick={event => { event.stopPropagation(); onToggle(node.key); }}
            >
              <span className={`tree-chevron ${collapsed ? '' : 'open'}`} />
            </button>
          ) : (
            <span className="mm-tree-toggle mm-tree-toggle--leaf" aria-hidden />
          )}
          <span className={used ? 'mm-binding-name' : 'mm-tree-branch-name'} style={{ flex: '0 1 auto' }} title={node.path}>
            {node.name}
          </span>
          {label && <span className="fmt-model-label" title={label}>{label}</span>}
          <span className="fmt-model-head-spacer" />
          {hasChildren && node.unmappedCount > 0 && (
            <span
              className="fmt-model-unmapped-badge"
              title={cs ? `Bez vazby v mapování v této větvi: ${node.unmappedCount}` : `Without a mapping binding in this branch: ${node.unmappedCount}`}
            >
              {node.unmappedCount}
            </span>
          )}
          <span
            className="mm-group-count"
            title={cs ? `Použití ve formátu: ${node.usageCount}` : `Uses in the format: ${node.usageCount}`}
          >
            {node.usageCount}
          </span>
          {used && node.mapping && (
            // The row head toggles the branch; the drill-down must not.
            <span style={{ display: 'contents' }} onClick={event => event.stopPropagation()}>
              <DrillDownTrigger
                expression={node.mapping.expressionAsString}
                configIndex={mappingConfigIndex}
                elementName={node.path}
                className="mm-binding-drill"
                label={t.drillCollapsibleLabel}
              >
                <TextBulletListTreeRegular fontSize={16} aria-hidden="true" />
              </DrillDownTrigger>
            </span>
          )}
        </div>

        {used && (
          <div className="fmt-model-body">
            <span className="fmt-model-line-label">{cs ? 'Mapování' : 'Mapping'}</span>
            {node.mapping ? (
              <div className="mm-binding-expr">
                <span className="mm-binding-arrow" aria-hidden>←</span>
                <ClickablePath expression={node.mapping.expressionAsString} configIndex={mappingConfigIndex} mode="binding-expr" />
              </div>
            ) : node.unmapped ? (
              <span
                className="fmt-model-missing"
                title={cs ? 'Mapování toto pole neplní, formát tu dostane prázdnou hodnotu.' : 'The mapping never fills this field, so the format gets an empty value here.'}
              >
                {cs ? 'Bez vazby v mapování' : 'No mapping binding'}
              </span>
            ) : !node.mappingLoaded ? (
              <span className="fmt-model-muted">{cs ? 'Mapování není načtené' : 'Mapping not loaded'}</span>
            ) : (
              <span className="fmt-model-muted">{cs ? 'Záznam — vazby mají jeho pole' : 'Record — its fields carry the bindings'}</span>
            )}

            <span className="fmt-model-line-label">{cs ? 'Formát' : 'Format'}</span>
            <div className="fmt-model-usages">
              {usages.map((usage, i) => {
                const property = usage.binding.bindingCategory === 'data'
                  ? null
                  : (showTechnicalDetails ? getFormatBindingDisplayLabel(usage.binding) : getConsultantBindingLabel(usage.binding));
                return (
                  <button
                    key={`${usage.group.componentId}-${i}`}
                    type="button"
                    className={`fmt-model-usage fmt-bind-intent--${usage.intent}`}
                    title={`${getBindingIntentItemLabel(usage.intent)}: ${usage.binding.expressionAsString}`}
                    onClick={() => onOpenElement(usage.group.componentId)}
                  >
                    <span className="fmt-bind-intent-dot" aria-hidden="true" />
                    <span>{usage.group.elementName}</span>
                    {property && <span className="fmt-model-usage-prop">{property}</span>}
                  </button>
                );
              })}
              {node.usages.length > usages.length && (
                <button type="button" className="fmt-model-summary-link fmt-model-usage-more" onClick={() => setShowAllUsages(true)}>
                  {cs ? `+${node.usages.length - usages.length} dalších` : `+${node.usages.length - usages.length} more`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {hasChildren && !collapsed && (
        <div className="mm-tree-children" role="group">
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
      )}
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
  const cs = locale === 'cs';
  const layouts: Array<{ id: 'format' | 'model'; label: string; title: string }> = [
    {
      id: 'format',
      label: cs ? 'Podle formátu' : 'By format',
      title: cs ? 'Vazby v pořadí, v jakém soubor vzniká' : 'Bindings in the order the file is built',
    },
    {
      id: 'model',
      label: cs ? 'Podle modelu' : 'By model',
      title: cs ? 'Pole datového modelu, která formát čte, a co je plní v mapování' : 'Data model fields the format reads, and what fills them in the mapping',
    },
  ];
  return (
    <div className="fmt-bind-intent-bar" role="toolbar" aria-label={cs ? 'Uspořádání a filtr vazeb' : 'Bindings layout and filter'}>
      <div className="fmt-bind-layout" role="radiogroup" aria-label={cs ? 'Uspořádání vazeb' : 'Bindings layout'}>
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
      <span>{locale === 'cs' ? `Ve vybraných typech vazeb nic není. Skryté: ${hiddenList}.` : `Nothing in the selected binding types. Hidden: ${hiddenList}.`}</span>
      <button type="button" className="fmt-bind-intent-chip" onClick={onShowAll}>
        {locale === 'cs' ? 'Zobrazit vše' : 'Show all'}
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
  const hiddenCount = row.bindings.length - bindings.length;

  return (
    <div className={`fmt-bind-card ${focused ? 'is-focused' : ''}`} ref={cardRef}>
      {/* Header: element type, name, bindings hidden by the filter, reveal action */}
      <div className="fmt-bind-card-head">
        {showTechnicalDetails && (
          <span
            className="fmt-bind-type-badge"
            style={{
              color: getFormatTypeColor(row.elementType),
              background: getFormatTypeBadgeSurface(row.elementType),
              borderColor: `${getFormatTypeColor(row.elementType)}55`,
            }}
          >
            {row.elementType}
          </span>
        )}
        <span className="fmt-bind-card-name" title={row.elementName}>{row.elementName}</span>
        {hiddenCount > 0 && (
          <span
            className="fmt-bind-card-count"
            title={locale === 'cs' ? `Další vazby prvku skryté filtrem: ${hiddenCount}` : `More bindings of this element hidden by the filter: ${hiddenCount}`}
          >
            +{hiddenCount}
          </span>
        )}
        {onReveal && (
          <button
            className="fmt-bind-card-reveal"
            onClick={e => { e.stopPropagation(); onReveal(row.componentId); }}
            title={t.openInExplorerAction}
            aria-label={t.openInExplorerAction}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3 H3 V13 H13 V10" />
              <path d="M9 3 H13 V7" />
              <path d="M13 3 L7 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Bindings: one row per binding, flat, no extra nesting. The badge's
          colour is the binding's intent, the same as its filter chip. */}
      <div className="fmt-bind-card-body">
        {ordered.map((binding, i) => {
          const intent = classifyBindingIntent(binding);
          const label = showTechnicalDetails
            ? getFormatBindingDisplayLabel(binding)
            // A consultant reads what a value binding does; a switch keeps its on/off wording.
            : binding.bindingCategory === 'data' ? getBindingIntentItemLabel(intent) : getConsultantBindingLabel(binding);
          return (
            <div key={`${binding.bindingCategory}-${i}`} className="fmt-bind-row">
              <span
                className={`badge fmt-bind-row-label fmt-bind-intent fmt-bind-intent--${intent}`}
                title={`${getBindingIntentItemLabel(intent)} — ${getBindingIntentHint(intent)}`}
              >
                {label}
              </span>
              {showTechnicalDetails && binding.promotedFromChild && binding.rawElementType && (
                <span className="fmt-binding-origin">{t.bindingVia} {binding.rawElementType}</span>
              )}
              <span className="fmt-bind-row-arrow" aria-hidden="true">←</span>
              <span className="fmt-bind-row-expr">
                <DrillDownTrigger
                  expression={binding.expressionAsString}
                  configIndex={configIndex}
                  elementName={row.elementName}
                >
                  <ExpressionDetailLink expression={binding.expressionAsString} configIndex={configIndex} interactive={false} />
                </DrillDownTrigger>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
