import { t } from '../i18n';
import { principalValueSource, type ElementFill } from './format-lineage';

/**
 * `format` → `model` → `mapping` → `source` are the kinds of a full trace;
 * `value` is where it ends early (a constant, an expression of the format's
 * own), `gap` is where it breaks (unbound, unmapped, mapping not loaded).
 */
export type TraceStepKind = 'format' | 'model' | 'mapping' | 'source' | 'value' | 'gap';

export interface TraceStep {
  kind: TraceStepKind;
  /** What the step is: Format, Model, Table field, … */
  label: string;
  /** The name, path or expression at that step; empty when the label says it all. */
  text: string;
}

/**
 * The way the value of a format element takes to its data, as far as the
 * loaded configurations show it: the element, the model field it reads, the
 * mapping binding that fills that field, and the table field the value comes
 * from. Built from the same lineage as the property inspector's fill card.
 */
export function traceSteps(
  fill: Pick<ElementFill, 'displayName' | 'fill' | 'constant' | 'binding' | 'modelLinks' | 'formatSources' | 'sources'>,
  mappingLoaded: boolean,
): TraceStep[] {
  const steps: TraceStep[] = [{ kind: 'format', label: t.traceStepFormat, text: fill.displayName }];
  if (fill.fill === 'constant') {
    steps.push({ kind: 'value', label: t.fillKindLabels.constant, text: fill.constant ?? fill.binding ?? '' });
    return steps;
  }
  if (fill.fill === 'unbound') {
    steps.push({ kind: 'gap', label: t.fillKindLabels.unbound, text: '' });
    return steps;
  }
  const link = fill.modelLinks.find(l => l.role === 'value') ?? fill.modelLinks[0];
  if (link) {
    steps.push({ kind: 'model', label: t.traceStepModel, text: link.path });
    steps.push(link.fill
      ? { kind: 'mapping', label: t.traceStepMapping, text: link.fill.expression }
      : { kind: 'gap', label: t.traceStepMapping, text: mappingLoaded ? t.specUnmapped : t.traceMappingMissing });
  } else if (fill.formatSources.length > 0) {
    steps.push({ kind: 'mapping', label: t.fillKindLabels.datasource, text: fill.formatSources[0].name });
  } else if (fill.binding) {
    steps.push({ kind: 'value', label: t.traceStepExpression, text: fill.binding });
  }
  const source = principalValueSource(fill);
  if (source) steps.push({ kind: 'source', label: t.sourceKindLabels[source.kind], text: source.name });
  return steps;
}
