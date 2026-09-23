/** The workspace-wide keyboard shortcuts App listens for. */
export type WorkspaceShortcut = 'search' | 'whereUsed' | 'explorer' | 'properties' | 'back' | 'forward';

type ShortcutKeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

const CTRL_SHORTCUTS: Record<string, WorkspaceShortcut> = {
  f: 'search',
  u: 'whereUsed',
  b: 'explorer',
  j: 'properties',
};

/**
 * Which shortcut a keydown is, if any. Only the exact chord counts: the
 * browser owns Ctrl+Shift+B (bookmarks bar), Ctrl+Shift+J (console) and
 * Ctrl+Shift+U (Unicode input), so a Shift or Alt on top of Ctrl+<key> is
 * left alone. The key is compared case-insensitively so Caps Lock still works.
 */
export function matchWorkspaceShortcut(e: ShortcutKeyEvent): WorkspaceShortcut | null {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey) {
    return CTRL_SHORTCUTS[e.key.toLowerCase()] ?? null;
  }
  if (e.altKey && !mod && !e.shiftKey) {
    if (e.key === 'ArrowLeft') return 'back';
    if (e.key === 'ArrowRight') return 'forward';
  }
  return null;
}
