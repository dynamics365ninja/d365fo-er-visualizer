import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { t } from '../i18n';

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
  keywords?: string[];
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  extraCommands: CommandItem[];
}

/**
 * VS-Code-style command palette. Opens on Ctrl/Cmd+K, filters with fuzzy-ish
 * contains matching. Arrow keys + Enter navigate, Escape closes.
 */
export function CommandPalette({ open, onClose, extraCommands }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const treeNodes = useAppStore(s => s.treeNodes);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);

  // Build full command list: static commands (passed in) + dynamic tree-node navigation commands.
  const allCommands = useMemo<CommandItem[]>(() => {
    const nav: CommandItem[] = [];
    // Limit to top-level + 2 levels of children to keep palette snappy for huge configs.
    const walk = (nodes: any[], depth: number, trail: string[]) => {
      if (depth > 3) return;
      for (const n of nodes) {
        const title = [...trail, n.name].join(' › ');
        nav.push({
          id: `nav:${n.id}`,
          label: title,
          group: t.cmdGroupNav,
          hint: n.type,
          keywords: [n.type, n.name],
          action: () => navigateToTreeNode(n.id),
        });
        if (n.children) walk(n.children, depth + 1, [...trail, n.name]);
      }
    };
    walk(treeNodes, 0, []);
    return [...extraCommands, ...nav];
  }, [treeNodes, extraCommands, navigateToTreeNode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands.slice(0, 80);
    const tokens = q.split(/\s+/).filter(Boolean);
    return allCommands
      .filter(cmd => {
        const hay = (cmd.label + ' ' + (cmd.keywords?.join(' ') ?? '') + ' ' + cmd.group).toLowerCase();
        return tokens.every(tok => hay.includes(tok));
      })
      .slice(0, 80);
  }, [allCommands, query]);

  // Group commands for display.
  const grouped = useMemo(() => {
    const g = new Map<string, CommandItem[]>();
    for (const cmd of filtered) {
      if (!g.has(cmd.group)) g.set(cmd.group, []);
      g.get(cmd.group)!.push(cmd);
    }
    return Array.from(g.entries());
  }, [filtered]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Focus input on next frame so the open animation has started.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const runActive = () => {
    const cmd = filtered[activeIndex];
    if (!cmd) return;
    cmd.action();
    onClose();
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="cmdk-backdrop" role="dialog" aria-modal="true" aria-label={t.commandPalette} onClick={onClose}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="cmdk-input"
          type="text"
          placeholder={t.cmdFilter}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <div className="cmdk-list" role="listbox" aria-label={t.commandPalette}>
          {grouped.length === 0 && (
            <div className="cmdk-empty">{t.noResults}</div>
          )}
          {grouped.map(([group, items]) => (
            <div key={group} className="cmdk-group">
              <div className="cmdk-group-title">{group}</div>
              {items.map(cmd => {
                const flatIndex = filtered.indexOf(cmd);
                const active = flatIndex === activeIndex;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`cmdk-item${active ? ' cmdk-item--active' : ''}`}
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    onClick={() => { cmd.action(); onClose(); }}
                  >
                    <span className="cmdk-item-label">{cmd.label}</span>
                    {cmd.hint && <span className="cmdk-item-hint">{cmd.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
