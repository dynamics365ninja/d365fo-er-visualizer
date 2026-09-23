import { describe, it, expect } from 'vitest';
import { matchWorkspaceShortcut } from './workspace-shortcuts';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods,
});

describe('matchWorkspaceShortcut', () => {
  it('matches the plain Ctrl / Cmd chords', () => {
    expect(matchWorkspaceShortcut(key('f', { ctrlKey: true }))).toBe('search');
    expect(matchWorkspaceShortcut(key('u', { ctrlKey: true }))).toBe('whereUsed');
    expect(matchWorkspaceShortcut(key('b', { metaKey: true }))).toBe('explorer');
    expect(matchWorkspaceShortcut(key('j', { ctrlKey: true }))).toBe('properties');
  });

  it('still matches with Caps Lock on', () => {
    expect(matchWorkspaceShortcut(key('B', { ctrlKey: true }))).toBe('explorer');
  });

  it.each(['B', 'J', 'U', 'F'])('leaves Ctrl+Shift+%s to the browser', k => {
    expect(matchWorkspaceShortcut(key(k, { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('leaves Ctrl+Alt chords alone', () => {
    expect(matchWorkspaceShortcut(key('b', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('matches Alt+arrows for history, but not with other modifiers', () => {
    expect(matchWorkspaceShortcut(key('ArrowLeft', { altKey: true }))).toBe('back');
    expect(matchWorkspaceShortcut(key('ArrowRight', { altKey: true }))).toBe('forward');
    expect(matchWorkspaceShortcut(key('ArrowLeft', { altKey: true, shiftKey: true }))).toBeNull();
    expect(matchWorkspaceShortcut(key('ArrowLeft', { altKey: true, ctrlKey: true }))).toBeNull();
  });

  it('ignores unmodified keys', () => {
    expect(matchWorkspaceShortcut(key('b'))).toBeNull();
  });
});
