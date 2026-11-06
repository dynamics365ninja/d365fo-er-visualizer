import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PANEL_VISIBILITY,
  loadPanelVisibility,
  oneOf,
  panelGroupSaveId,
  parseBoolean,
  readPreference,
  sanitizePanelVisibility,
  savePanelVisibility,
  writePreference,
} from './ui-preferences';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

function stubStorage(storage: Storage = memoryStorage()): Storage {
  vi.stubGlobal('window', { localStorage: storage });
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ui preferences', () => {
  it('reads back what was written, under its own key', () => {
    const storage = stubStorage();
    writePreference('explorer.hierarchy', true);
    expect(storage.getItem('er-visualizer.ui.explorer.hierarchy')).toBe('true');
    expect(readPreference('explorer.hierarchy', false, parseBoolean)).toBe(true);
  });

  it('falls back to the default for nothing stored, a value of another shape, or unparsable text', () => {
    const storage = stubStorage();
    const parseSort = oneOf(['loadOrder', 'nameAsc', 'nameDesc'] as const);
    expect(readPreference('explorer.sort', 'loadOrder', parseSort)).toBe('loadOrder');
    storage.setItem('er-visualizer.ui.explorer.sort', JSON.stringify('byColour'));
    expect(readPreference('explorer.sort', 'loadOrder', parseSort)).toBe('loadOrder');
    storage.setItem('er-visualizer.ui.explorer.sort', '{not json');
    expect(readPreference('explorer.sort', 'loadOrder', parseSort)).toBe('loadOrder');
    storage.setItem('er-visualizer.ui.explorer.sort', JSON.stringify('nameDesc'));
    expect(readPreference('explorer.sort', 'loadOrder', parseSort)).toBe('nameDesc');
  });

  it('keeps working when storage is blocked or full', () => {
    stubStorage({
      ...memoryStorage(),
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    expect(() => writePreference('search.relatedOnly', false)).not.toThrow();
    expect(readPreference('search.relatedOnly', true, parseBoolean)).toBe(true);
  });

  it('works without a window at all', () => {
    vi.stubGlobal('window', undefined);
    expect(() => writePreference('x', 1)).not.toThrow();
    expect(readPreference('x', 2, () => 3)).toBe(2);
  });
});

describe('panel visibility', () => {
  it('opens as the user left the panels', () => {
    stubStorage();
    expect(loadPanelVisibility()).toEqual(DEFAULT_PANEL_VISIBILITY);
    savePanelVisibility({ explorer: false, side: true, sideTab: 'where-used' });
    expect(loadPanelVisibility()).toEqual({ explorer: false, side: true, sideTab: 'where-used' });
  });

  it('makes a stored value whole, field by field', () => {
    expect(sanitizePanelVisibility({ explorer: false, side: 'yes', sideTab: 'outline' })).toEqual({
      explorer: false,
      side: false,
      sideTab: 'properties',
    });
    expect(sanitizePanelVisibility(null)).toEqual(DEFAULT_PANEL_VISIBILITY);
    expect(sanitizePanelVisibility([true])).toEqual(DEFAULT_PANEL_VISIBILITY);
  });

  it('keeps the panel sizes of a tablet and of a desktop apart', () => {
    expect(panelGroupSaveId('shell', false)).not.toBe(panelGroupSaveId('shell', true));
    expect(panelGroupSaveId('shell', false)).not.toBe(panelGroupSaveId('work', false));
  });
});
