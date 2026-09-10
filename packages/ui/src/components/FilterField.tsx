import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import {
  rankSuggestions,
  loadFilterHistory,
  pushFilterHistory,
  splitHighlight,
  type FilterSuggestion,
} from '../utils/filter-suggestions';

interface FilterFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Everything the panel can be filtered by; ranked against what is typed. */
  suggestions?: FilterSuggestion[];
  /** localStorage bucket for the recent-filter list. Omit to keep no history. */
  historyScope?: string;
  /** Called after a suggestion is chosen — e.g. to switch to its view. */
  onPick?: (suggestion: FilterSuggestion) => void;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

interface Row {
  kind: 'group' | 'item';
  label: string;
  suggestion?: FilterSuggestion;
  /** Index among the selectable rows; groups get -1. */
  itemIndex: number;
}

/**
 * The filter box used by the explorer and both designers.
 *
 * On its own a filter box is a guessing game: it only rewards a substring the
 * configuration actually contains, and nothing on screen says what those are.
 * So while typing it proposes the matching names from the panel — with how many
 * rows each one hits — and offers the last few filters when it is empty.
 * Suggestions are proposals, never a rewrite: what is typed keeps filtering as
 * before, whether or not it matches one.
 */
export function FilterField({
  value,
  onChange,
  placeholder,
  suggestions,
  historyScope,
  onPick,
  className,
  style,
  ariaLabel,
}: FilterFieldProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useRef(`filter-suggest-${Math.random().toString(36).slice(2, 9)}`).current;

  // Read once per mount: the list only changes through this component.
  useEffect(() => {
    if (historyScope) setHistory(loadFilterHistory(historyScope));
  }, [historyScope]);

  const commit = useCallback((entry: string) => {
    if (!historyScope) return;
    setHistory(pushFilterHistory(historyScope, entry));
  }, [historyScope]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let itemIndex = 0;
    const pushGroup = (label: string) => out.push({ kind: 'group', label, itemIndex: -1 });
    const pushItem = (suggestion: FilterSuggestion) =>
      out.push({ kind: 'item', label: suggestion.value, suggestion, itemIndex: itemIndex++ });

    if (value.trim().length === 0) {
      if (history.length > 0) {
        pushGroup(t.filterRecent);
        for (const entry of history) pushItem({ value: entry, group: t.filterRecent, count: 0 });
      }
      return out;
    }

    let lastGroup: string | null = null;
    for (const suggestion of rankSuggestions(suggestions ?? [], value)) {
      if (suggestion.group !== lastGroup) {
        pushGroup(suggestion.group);
        lastGroup = suggestion.group;
      }
      pushItem(suggestion);
    }
    return out;
  }, [value, history, suggestions]);

  const items = useMemo(() => rows.filter(row => row.kind === 'item'), [rows]);
  const listOpen = open && items.length > 0;

  // A stale highlight would send Enter somewhere the user cannot see.
  useEffect(() => { setActiveIndex(-1); }, [value]);

  // The list scrolls at ~9 rows, so arrowing past the fold has to bring the
  // highlighted row along — otherwise the keyboard cursor walks off-screen and
  // Enter picks something the user cannot see. `nearest` keeps the list still
  // while the cursor moves inside the visible rows.
  useEffect(() => {
    if (!listOpen || activeIndex < 0) return;
    const active = listRef.current?.querySelector(`[data-item-index="${activeIndex}"]`);
    if (!active) return;
    active.scrollIntoView({ block: 'nearest' });
    // On the first row of a group, take its heading along — a row whose group
    // sits just above the fold loses the only label saying what it is.
    const heading = active.previousElementSibling;
    if (heading?.classList.contains('filter-suggest__group')) heading.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listOpen]);

  const pick = useCallback((suggestion: FilterSuggestion) => {
    onChange(suggestion.value);
    commit(suggestion.value);
    setOpen(false);
    setActiveIndex(-1);
    onPick?.(suggestion);
    inputRef.current?.focus();
  }, [onChange, commit, onPick]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (items.length === 0) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(event.key === 'ArrowDown' ? 0 : items.length - 1);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(prev => {
        const next = prev + step;
        if (next < 0) return items.length - 1;
        if (next >= items.length) return 0;
        return next;
      });
      return;
    }

    if (event.key === 'Enter') {
      const active = activeIndex >= 0 ? items[activeIndex]?.suggestion : undefined;
      if (active) {
        event.preventDefault();
        pick(active);
        return;
      }
      commit(value);
      setOpen(false);
      return;
    }

    if (event.key === 'Escape') {
      // First Escape puts the list away, a second one clears the filter — the
      // list must never swallow the shortcut people use to reset the panel.
      if (listOpen) {
        event.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
        return;
      }
      if (value) {
        event.stopPropagation();
        onChange('');
      }
      return;
    }

    if (event.key === 'Tab') setOpen(false);
  }, [items, open, listOpen, activeIndex, pick, commit, value, onChange]);

  const activeId = activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined;

  return (
    <div className={`filter-field ${className ?? ''}`} style={style}>
      <svg className="filter-field__icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-label={ariaLabel ?? placeholder}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        className="filter-field__input"
        onChange={event => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActiveIndex(-1); commit(value); }}
        onKeyDown={handleKeyDown}
      />
      {value && (
        <button
          type="button"
          onClick={() => { onChange(''); inputRef.current?.focus(); }}
          className="filter-field__clear"
          title={t.clearFilter}
          aria-label={t.clearFilter}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {listOpen && (
        <div className="filter-suggest" id={listId} ref={listRef} role="listbox" aria-label={t.filterSuggestions}>
          {rows.map((row, index) => {
            if (row.kind === 'group') {
              return <div key={`g-${index}`} className="filter-suggest__group" role="presentation">{row.label}</div>;
            }
            const suggestion = row.suggestion!;
            const [before, match, after] = splitHighlight(suggestion.value, value);
            return (
              <div
                key={`i-${index}`}
                id={`${listId}-opt-${row.itemIndex}`}
                data-item-index={row.itemIndex}
                role="option"
                aria-selected={row.itemIndex === activeIndex}
                className={`filter-suggest__item ${row.itemIndex === activeIndex ? 'active' : ''}`}
                // Blur would close the list before the click ever lands.
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(row.itemIndex)}
                onClick={() => pick(suggestion)}
              >
                <span className="filter-suggest__label">
                  {before}<mark>{match}</mark>{after}
                </span>
                {suggestion.count > 1 && (
                  <span className="filter-suggest__count" title={t.filterMatchCount(suggestion.count)}>
                    {suggestion.count}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
