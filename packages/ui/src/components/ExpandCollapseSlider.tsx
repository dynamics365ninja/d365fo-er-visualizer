import React, { useState } from 'react';
import { useCoarsePointer } from '../utils/responsive';

interface ExpandCollapseSliderProps {
  onExpand: () => void;
  onCollapse: () => void;
  expandLabel: string;
  collapseLabel: string;
  expandIcon: React.ReactNode;
  collapseIcon: React.ReactNode;
  /** Compact = 22px icon buttons (toolbars); default = 26px (panel headers). */
  size?: 'default' | 'compact';
}

/**
 * Two-way sliding switch that replaces a bare pair of "Expand all" / "Collapse all"
 * icon buttons. Each click still fires its action immediately; the thumb simply
 * slides to the side that was last used, giving compact, consistent visual feedback
 * (same interaction pattern as the density toggle).
 *
 * On touch the icon-only form is both too small to hit and too cryptic without a
 * hover tooltip, so the labels are spelled out and the options grow to a
 * finger-sized height. The sliding thumb is dropped in that mode: the two labels
 * have different widths, so a thumb pinned to 50 % would no longer line up with
 * the option underneath it.
 */
export function ExpandCollapseSlider({
  onExpand,
  onCollapse,
  expandLabel,
  collapseLabel,
  expandIcon,
  collapseIcon,
  size = 'default',
}: ExpandCollapseSliderProps) {
  const [lastAction, setLastAction] = useState<'expand' | 'collapse' | null>(null);
  const labelled = useCoarsePointer();

  return (
    <div
      className={[
        'expand-slider',
        size === 'compact' ? 'expand-slider--compact' : '',
        labelled ? 'expand-slider--labelled' : '',
      ].filter(Boolean).join(' ')}
      role="group"
      aria-label={`${expandLabel} / ${collapseLabel}`}
    >
      {!labelled && (
        <div
          className={`expand-slider__thumb ${lastAction ? 'expand-slider__thumb--visible' : ''} ${lastAction === 'collapse' ? 'expand-slider__thumb--right' : ''}`}
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        className={`expand-slider__option ${lastAction === 'expand' ? 'active' : ''}`}
        onClick={() => { setLastAction('expand'); onExpand(); }}
        title={expandLabel}
        aria-label={expandLabel}
      >
        {expandIcon}
        {labelled && <span className="expand-slider__label">{expandLabel}</span>}
      </button>
      <button
        type="button"
        className={`expand-slider__option ${lastAction === 'collapse' ? 'active' : ''}`}
        onClick={() => { setLastAction('collapse'); onCollapse(); }}
        title={collapseLabel}
        aria-label={collapseLabel}
      >
        {collapseIcon}
        {labelled && <span className="expand-slider__label">{collapseLabel}</span>}
      </button>
    </div>
  );
}
