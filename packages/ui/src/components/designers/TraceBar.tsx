import { useMemo } from 'react';
import { ArrowRightRegular, BranchForkRegular } from '@fluentui/react-icons';
import { useAppStore } from '../../state/store';
import { t, useLocale } from '../../i18n';
import { buildFormatLineage, elementFill } from '../../utils/format-lineage';
import { traceSteps } from '../../utils/trace-steps';
import { ElementDrillDown } from './lineage-parts';

/**
 * The trace of the selected format element, under the designer: one line of
 * kind-coloured steps from the element to the table field, with the full
 * drill-down one click away. Hidden while no format element is selected.
 */
export function TraceBar() {
  useLocale();
  const selectedNode = useAppStore(s => s.selectedNode);
  const configurations = useAppStore(s => s.configurations);
  const configIndex = selectedNode?.type === 'formatElement' && selectedNode.configIndex != null ? selectedNode.configIndex : -1;
  const elementId: string | undefined = configIndex >= 0 ? selectedNode?.data?.id : undefined;
  const lineage = useMemo(
    () => (configIndex >= 0 ? buildFormatLineage(configurations, configIndex) : null),
    [configurations, configIndex],
  );
  const fill = useMemo(() => {
    const own = elementFill(lineage, elementId);
    // An unnamed value node stands for its parent element, as in the inspector.
    return own?.absorbedInto ? elementFill(lineage, own.absorbedInto) ?? own : own;
  }, [lineage, elementId]);
  if (!lineage || !fill) return null;

  const steps = traceSteps(fill, Boolean(lineage.mapping));
  return (
    <nav className="trace-bar" aria-label={t.traceBarAria}>
      <span className="trace-bar__label" aria-hidden>{t.traceBarLabel}</span>
      <ol className="trace-bar__steps">
        {steps.map((step, index) => (
          <li key={`${step.kind}-${index}`} className={`trace-step trace-step--${step.kind}`}>
            {index > 0 && <ArrowRightRegular className="trace-step__arrow" fontSize={14} aria-hidden />}
            <span className="trace-step__chip" title={step.text ? `${step.label}: ${step.text}` : step.label}>
              <span className="trace-step__kind">{step.label}</span>
              {step.text && <code className="trace-step__text">{step.text}</code>}
            </span>
          </li>
        ))}
      </ol>
      {fill.binding && (
        <ElementDrillDown
          configIndex={configIndex}
          elementId={fill.id}
          expression={fill.binding}
          elementName={fill.displayName}
          className="trace-bar__detail"
        >
          <BranchForkRegular fontSize={14} aria-hidden />
          <span>{t.traceOpenDetail}</span>
        </ElementDrillDown>
      )}
    </nav>
  );
}
