import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  TableRegular,
  CodeRegular,
  TagRegular,
  CalculatorRegular,
  LinkRegular,
  ArrowForwardRegular,
  BranchRegular,
} from '@fluentui/react-icons';
import type { PathTooltipData, PathTooltipRowIcon } from '../utils/path-tooltip';

function RowIcon({ icon }: { icon?: PathTooltipRowIcon }) {
  switch (icon) {
    case 'table': return <TableRegular fontSize={13} />;
    case 'class': return <CodeRegular fontSize={13} />;
    case 'enum': return <TagRegular fontSize={13} />;
    case 'calc': return <CalculatorRegular fontSize={13} />;
    case 'link': return <LinkRegular fontSize={13} />;
    case 'branch': return <BranchRegular fontSize={13} />;
    default: return null;
  }
}

/** Space between the hovered name and the card, and between the card and the window edge. */
const GAP = 6;
const VIEWPORT_PADDING = 8;

/**
 * The card shown over a name in an expression. It hangs off the name itself —
 * below it, or above when there is no room — instead of chasing the pointer,
 * and is styled from the design tokens like every other floating surface.
 */
export function PathTooltipCard({ data, anchor }: { data: PathTooltipData; anchor: DOMRect }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let top = anchor.bottom + GAP;
    if (top + height > window.innerHeight - VIEWPORT_PADDING) top = anchor.top - height - GAP;
    const left = Math.max(VIEWPORT_PADDING, Math.min(anchor.left, window.innerWidth - width - VIEWPORT_PADDING));
    setPos({ left, top: Math.max(VIEWPORT_PADDING, top) });
  }, [anchor, data]);

  return (
    <div
      ref={ref}
      className={`path-tooltip-card path-tooltip-card--${data.kind}${pos ? ' is-visible' : ''}`}
      style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + GAP }}
      role="tooltip"
    >
      <div className="path-tooltip-card__head">
        <div className="path-tooltip-card__eyebrow">
          <span className="path-tooltip-card__dot" aria-hidden="true" />
          {data.eyebrow}
        </div>
        <div className="path-tooltip-card__title">{data.title}</div>
        {data.path.length > 1 && (
          <div className="path-tooltip-card__path">
            {data.path.map((name, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="path-tooltip-card__sep">.</span>}
                <span className={i === data.activeIndex ? 'is-active' : i > data.activeIndex ? 'is-after' : undefined}>{name}</span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {data.rows.length > 0 && (
        <dl className="path-tooltip-card__rows">
          {data.rows.map((row, i) => (
            <div key={i} className={`path-tooltip-card__row${row.muted ? ' is-muted' : ''}`}>
              <dt>
                {row.icon && <RowIcon icon={row.icon} />}
                {row.label}
              </dt>
              <dd className={row.mono ? 'is-mono' : undefined}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {data.navigation && (
        <div className="path-tooltip-card__foot">
          <span>{data.navigation.hint}</span>
          <ArrowForwardRegular fontSize={12} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
