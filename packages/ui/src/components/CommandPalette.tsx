import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  Input,
  makeStyles,
  tokens,
  mergeClasses,
} from '@fluentui/react-components';
import { SearchRegular } from '@fluentui/react-icons';
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

const useStyles = makeStyles({
  surface: {
    width: '640px',
    maxWidth: '90vw',
    padding: 0,
  },
  body: {
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '70vh',
  },
  input: {
    borderTopLeftRadius: tokens.borderRadiusMedium,
    borderTopRightRadius: tokens.borderRadiusMedium,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  list: {
    overflowY: 'auto',
    padding: '4px 0',
  },
  empty: {
    padding: '16px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  group: {
    padding: '4px 0',
  },
  groupTitle: {
    padding: '4px 12px',
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: tokens.colorNeutralForeground3,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '6px 12px',
    border: 'none',
    background: 'transparent',
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    cursor: 'pointer',
    textAlign: 'left',
    ':hover': {
      background: tokens.colorSubtleBackgroundHover,
    },
  },
  itemActive: {
    background: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    ':hover': {
      background: tokens.colorBrandBackgroundHover,
    },
  },
  hint: {
    fontSize: tokens.fontSizeBase200,
    opacity: 0.8,
    marginLeft: '12px',
  },
});

/**
 * Command palette — Fluent UI v9 `Dialog` + `Input`.
 * Opens on Ctrl/Cmd+K, filters with whitespace-tokenised contains match.
 */
export function CommandPalette({ open, onClose, extraCommands }: Props) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const treeNodes = useAppStore(s => s.treeNodes);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);

  const allCommands = useMemo<CommandItem[]>(() => {
    const nav: CommandItem[] = [];
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
    const toks = q.split(/\s+/).filter(Boolean);
    return allCommands
      .filter(cmd => {
        const hay = (cmd.label + ' ' + (cmd.keywords?.join(' ') ?? '') + ' ' + cmd.group).toLowerCase();
        return toks.every(tok => hay.includes(tok));
      })
      .slice(0, 80);
  }, [allCommands, query]);

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
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

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
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => { if (!d.open) onClose(); }}
      modalType="modal"
    >
      <DialogSurface className={styles.surface} aria-label={t.commandPalette}>
        <DialogBody className={styles.body} onKeyDown={onKeyDown}>
          <Input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(_, d) => setQuery(d.value)}
            placeholder={t.cmdFilter}
            contentBefore={<SearchRegular />}
            appearance="underline"
            size="large"
          />
          <div className={styles.list} role="listbox" aria-label={t.commandPalette}>
            {grouped.length === 0 && (
              <div className={styles.empty}>{t.noResults}</div>
            )}
            {grouped.map(([group, items]) => (
              <div key={group} className={styles.group}>
                <div className={styles.groupTitle}>{group}</div>
                {items.map(cmd => {
                  const flatIndex = filtered.indexOf(cmd);
                  const active = flatIndex === activeIndex;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={mergeClasses(styles.item, active && styles.itemActive)}
                      onMouseEnter={() => setActiveIndex(flatIndex)}
                      onClick={() => { cmd.action(); onClose(); }}
                    >
                      <span>{cmd.label}</span>
                      {cmd.hint && <span className={styles.hint}>{cmd.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
