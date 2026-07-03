import React, { useState } from 'react';

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

  return (
    <div
      className={`expand-slider ${size === 'compact' ? 'expand-slider--compact' : ''}`}
      role="group"
      aria-label={`${expandLabel} / ${collapseLabel}`}
    >
      <div
        className={`expand-slider__thumb ${lastAction ? 'expand-slider__thumb--visible' : ''} ${lastAction === 'collapse' ? 'expand-slider__thumb--right' : ''}`}
        aria-hidden="true"
      />
      <button
        type="button"
        className={`expand-slider__option ${lastAction === 'expand' ? 'active' : ''}`}
        onClick={() => { setLastAction('expand'); onExpand(); }}
        title={expandLabel}
        aria-label={expandLabel}
      >
        {expandIcon}
      </button>
      <button
        type="button"
        className={`expand-slider__option ${lastAction === 'collapse' ? 'active' : ''}`}
        onClick={() => { setLastAction('collapse'); onCollapse(); }}
        title={collapseLabel}
        aria-label={collapseLabel}
      >
        {collapseIcon}
      </button>
    </div>
  );
}
