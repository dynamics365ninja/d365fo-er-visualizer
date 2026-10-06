/**
 * Small pieces that show how a format element is filled — shared by the field
 * specification, the preview and the property inspector, so a "calculation"
 * or a repeating section looks the same wherever it appears.
 */
import React, { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { ArrowRepeatAllRegular, BranchForkRegular, WarningRegular } from '@fluentui/react-icons';
import { t } from '../../i18n';
import type { SourceRef } from '../../utils/datasource-lineage';
import { buildFormatLineage, elementFill, expressionAtElement, type ElementConstraints, type ElementFill, type FillKind } from '../../utils/format-lineage';
import { getConsultantDataTypeLabel } from '../../utils/consultant-labels';
import { DrillDownTrigger } from '../DrillDownPanel';

export function FillKindPill({ kind, compact }: { kind: FillKind; compact?: boolean }) {
  return (
    <span className={`fill-pill fill-pill--${kind}${compact ? ' fill-pill--compact' : ''}`} title={t.fillKindHints[kind]}>
      {t.fillKindLabels[kind]}
    </span>
  );
}

/** Repeat / optional / condition markers of an element. */
export function ElementBadges({ fill }: { fill: Pick<ElementFill, 'repeating' | 'repeatInferred' | 'optional' | 'conditions' | 'binding'> }) {
  return (
    <>
      {fill.repeating && (
        <span
          className={`elem-badge elem-badge--repeat${fill.repeatInferred ? ' elem-badge--inferred' : ''}`}
          title={fill.repeatInferred ? t.specRepeatsInferred : t.specRepeats(fill.binding ?? '')}
        >
          <ArrowRepeatAllRegular fontSize={11} aria-hidden />
          {t.specRepeatBadge}
        </span>
      )}
      {fill.optional && (
        <span className="elem-badge elem-badge--optional" title={t.specOptionalHint}>0..1</span>
      )}
      {fill.conditions.length > 0 && (
        <span className="elem-badge elem-badge--condition" title={fill.conditions.map(t.specCondition).join('\n')}>
          <BranchForkRegular fontSize={11} aria-hidden />
          {t.specConditionBadge}
        </span>
      )}
    </>
  );
}

/** Length / format / padding rules as short phrases. */
export function constraintPhrases(constraints: ElementConstraints): string[] {
  const out: string[] = [];
  const { minLength, maxLength } = constraints;
  if (minLength && maxLength) out.push(`${t.specLengthRange(minLength, maxLength)} ${t.specLengthUnit}`);
  else if (maxLength) out.push(t.specMaxLength(maxLength));
  else if (minLength) out.push(t.specMinLength(minLength));
  if (constraints.format) out.push(t.specFormat(constraints.format));
  if (constraints.padding) out.push(t.specPadding(constraints.padding, constraints.alignment));
  if (constraints.delimiter) out.push(t.specDelimiter(constraints.delimiter));
  if (constraints.lineEnd) out.push(t.specLineEnd(constraints.lineEnd));
  if (constraints.transformation) out.push(t.specTransformation(constraints.transformation));
  return out;
}

/** The data type in the words of the current view, plus the length rules. */
export function TypeCell({ fill, showTechnicalDetails }: { fill: ElementFill; showTechnicalDetails: boolean }) {
  const typeLabel = fill.isField || fill.fill !== 'structure'
    ? (showTechnicalDetails ? fill.dataType : getConsultantDataTypeLabel(fill.dataType))
    : undefined;
  const phrases = constraintPhrases(fill.constraints);
  return (
    <span className="spec-type">
      {typeLabel && <span className="spec-type__name">{typeLabel}</span>}
      {phrases.length > 0 && <span className="spec-type__rules">{phrases.join(' · ')}</span>}
    </span>
  );
}

const SOURCE_KIND_CLASS: Record<SourceRef['kind'], string> = {
  table: 'table', field: 'field', enum: 'enum', class: 'class', parameter: 'param', datasource: 'ds', importFormat: 'ds',
};

export function SourceChip({ source, onClick }: { source: SourceRef; onClick?: (source: SourceRef) => void }) {
  const title = [
    t.sourceKindLabels[source.kind],
    source.definition ? t.specMappingContext(source.definition) : undefined,
    source.formula,
    source.edt ? `EDT ${source.edt}` : undefined,
  ].filter(Boolean).join('\n');
  const content = (
    <>
      <span className="src-chip__kind" aria-hidden>{t.sourceKindLabels[source.kind].charAt(0)}</span>
      <span className="src-chip__name">{source.name}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={`src-chip src-chip--${SOURCE_KIND_CLASS[source.kind]}`} title={title} onClick={event => { event.stopPropagation(); onClick(source); }}>
      {content}
    </button>
  ) : (
    <span className={`src-chip src-chip--${SOURCE_KIND_CLASS[source.kind]}`} title={title}>{content}</span>
  );
}

export function SourceChips({ sources, max = 3, onClick }: { sources: readonly SourceRef[]; max?: number; onClick?: (source: SourceRef) => void }) {
  if (sources.length === 0) return null;
  const shown = sources.slice(0, max);
  const rest = sources.length - shown.length;
  return (
    <span className="src-chips">
      {shown.map(source => <SourceChip key={`${source.kind}:${source.name}`} source={source} onClick={onClick} />)}
      {rest > 0 && <span className="src-chips__more" title={sources.slice(max).map(s => s.name).join('\n')}>+{rest}</span>}
    </span>
  );
}

/** A model field the format reads that nothing in the mapping fills. */
export function UnmappedMark({ path }: { path: string }) {
  return (
    <span className="src-unmapped" title={t.specUnmappedHint(path)}>
      <WarningRegular fontSize={12} aria-hidden />
      {t.specUnmapped}
    </span>
  );
}

/** Whether a value model link reads a field the loaded mapping leaves unbound. */
export function isUnmappedLink(fill: ElementFill, mappingLoaded: boolean, link: ElementFill['modelLinks'][number]): boolean {
  if (!mappingLoaded || link.fill) return false;
  // Records and lists carry no value of their own.
  if (link.field && (link.field.type === 10 || link.field.type === 11)) return false;
  return fill.isField || link.role === 'value';
}

/**
 * The expression a drill-down should resolve for a binding of `elementId`:
 * a `@` path inside a repeating element becomes the full path of its list.
 */
export function useDrillExpression(configIndex: number, elementId: string | undefined, expression: string): string {
  const configurations = useAppStore(s => s.configurations);
  return useMemo(() => {
    if (!expression.includes('@')) return expression;
    return expressionAtElement(elementFill(buildFormatLineage(configurations, configIndex), elementId), expression);
  }, [configurations, configIndex, elementId, expression]);
}

/** A drill-down trigger for a format binding, with `@` resolved for the element. */
export function ElementDrillDown({ configIndex, elementId, expression, elementName, className, children }: {
  configIndex: number;
  elementId: string | undefined;
  expression: string;
  elementName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const resolved = useDrillExpression(configIndex, elementId, expression);
  return <DrillDownTrigger expression={resolved} configIndex={configIndex} elementName={elementName} className={className}>{children}</DrillDownTrigger>;
}
