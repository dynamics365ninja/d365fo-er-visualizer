import React, { useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { t, useLocale } from '../../i18n';
import { buildLabelPool, labelDisplayText, labelLanguageTag } from '../../utils/label-resolver';
import { primaryValueSources, type ElementFill } from '../../utils/format-lineage';
import { DrillDownTrigger } from '../DrillDownPanel';
import { ClickablePath } from '../ClickablePath';
import { constraintPhrases, ElementBadges, FillKindPill, isUnmappedLink, SourceChips, UnmappedMark } from './lineage-parts';

/**
 * Everything about how one format element gets its value, top to bottom:
 * the binding, the model field and the mapping expression behind it, the
 * D365FO tables and fields it ends in, what selects the records, the
 * condition, and the length / format rules.
 */
export function ElementFillCard({ fill, configIndex, mappingLoaded, compact }: {
  fill: ElementFill;
  configIndex: number;
  mappingLoaded: boolean;
  compact?: boolean;
}) {
  const locale = useLocale();
  const configurations = useAppStore(s => s.configurations);
  const labels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);
  const labelOf = useCallback((ref?: string) => {
    if (!ref) return undefined;
    const text = labelDisplayText(ref, labels, labelLanguageTag(locale));
    return text && text !== ref ? text : undefined;
  }, [labels, locale]);

  const valueLinks = fill.modelLinks.filter(link => link.role === 'value');
  const primary = primaryValueSources(fill);
  const selection = fill.sources.filter(src => src.role === 'context' && (src.kind === 'table' || src.kind === 'parameter' || src.kind === 'field'));
  const conditionSources = fill.sources.filter(src => src.role === 'condition' && (src.kind === 'field' || src.kind === 'table'));
  const rules = constraintPhrases(fill.constraints);
  const drill = fill.resolvedBinding ?? fill.binding ?? '';

  if (fill.fill === 'structure' && !fill.binding && fill.conditions.length === 0 && rules.length === 0) return null;

  return (
    <section className={`fill-card${compact ? ' fill-card--compact' : ''}`} aria-label={t.fillCardTitle}>
      <header className="fill-card__head">
        <span className="fill-card__title">{t.fillCardTitle}</span>
        {(fill.fill !== 'structure' || fill.binding) && <FillKindPill kind={fill.fill} />}
        <ElementBadges fill={fill} />
      </header>
      <dl className="fill-card__rows">
        {fill.binding && (
          <>
            <dt>{fill.repeating ? t.fillCardRepeats : t.fillCardValue}</dt>
            <dd>
              {fill.fill === 'constant' && fill.constant != null
                ? <span className="spec-constant">“{fill.constant}”</span>
                : (
                  <DrillDownTrigger expression={drill} configIndex={configIndex} elementName={fill.displayName} className="fill-card__expr">
                    <ClickablePath expression={fill.binding} configIndex={configIndex} mode="binding-expr" interactive={false} />
                  </DrillDownTrigger>
                )}
            </dd>
          </>
        )}
        {valueLinks.map(link => (
          <React.Fragment key={link.path}>
            <dt>{t.fillCardModel}</dt>
            <dd>
              <span className="fill-card__model">{link.path}</span>
              {labelOf(link.field?.label) && <span className="fill-card__label">{labelOf(link.field?.label)}</span>}
              {isUnmappedLink(fill, mappingLoaded, link) && <UnmappedMark path={link.path} />}
            </dd>
            {link.fill && (
              <>
                <dt>{t.fillCardMapping}</dt>
                <dd className="fill-card__expr">
                  <ClickablePath expression={link.fill.expression} configIndex={link.fill.sources[0]?.configIndex ?? configIndex} mode="binding-expr" interactive={false} />
                </dd>
              </>
            )}
          </React.Fragment>
        ))}
        {(primary.length > 0 || (fill.binding && fill.fill !== 'constant')) && (
          <>
            <dt>{t.fillCardSource}</dt>
            <dd>{primary.length > 0 ? <SourceChips sources={primary} max={6} /> : <span className="spec-muted">{t.fillCardNoSource}</span>}</dd>
          </>
        )}
        {selection.length > 0 && (
          <>
            <dt>{t.fillCardSelection}</dt>
            <dd><SourceChips sources={selection} max={6} /></dd>
          </>
        )}
        {fill.conditions.map((condition, i) => (
          <React.Fragment key={`c${i}`}>
            <dt>{t.fillCardCondition}</dt>
            <dd className="fill-card__expr">
              <DrillDownTrigger expression={condition} configIndex={configIndex} elementName={fill.displayName}>
                <ClickablePath expression={condition} configIndex={configIndex} mode="binding-expr" interactive={false} />
              </DrillDownTrigger>
              {i === fill.conditions.length - 1 && conditionSources.length > 0 && <SourceChips sources={conditionSources} max={4} />}
            </dd>
          </React.Fragment>
        ))}
        {rules.length > 0 && (
          <>
            <dt>{t.fillCardRules}</dt>
            <dd>{rules.join(' · ')}</dd>
          </>
        )}
        {fill.otherBindings.map(binding => (
          <React.Fragment key={binding.property}>
            <dt>{binding.property || t.fillCardOther}</dt>
            <dd className="fill-card__expr"><ClickablePath expression={binding.expression} configIndex={configIndex} mode="binding-expr" interactive={false} /></dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  );
}
