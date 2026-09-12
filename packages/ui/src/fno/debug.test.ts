import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dumpFnoDebug, fnoDebugEnabled, fnoDebugMatches, recordFnoDebug } from './debug';

/** The recorder reads `window.localStorage`; the UI tests run in node. */
function setSwitch(value: string | null): void {
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => (key === 'er_debug_fno' ? value : null),
    },
  };
}

describe('fno debug recorder', () => {
  beforeEach(() => setSwitch(null));
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it('stays off until the switch is set', () => {
    expect(fnoDebugEnabled()).toBe(false);
    expect(fnoDebugMatches('anything')).toBe(false);
  });

  it("records everything when the switch is '1'", () => {
    setSwitch('1');
    expect(fnoDebugEnabled()).toBe(true);
    expect(fnoDebugMatches('Sales invoice (Excel)')).toBe(true);
    expect(fnoDebugMatches(undefined)).toBe(true);
  });

  it('treats any other value as a case-insensitive name filter', () => {
    setSwitch('sales invoice');
    expect(fnoDebugMatches('Asl Sales Invoice (Excel)')).toBe(true);
    expect(fnoDebugMatches('Intrastat')).toBe(false);
    expect(fnoDebugMatches(undefined)).toBe(false);
  });

  it('prints one blob per dump and starts over afterwards', () => {
    setSwitch('1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordFnoDebug('download', { asked: 'Sales invoice (Excel)' });
    dumpFnoDebug('load selected');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('Sales invoice (Excel)');
    // Entries are consumed: a second dump with nothing new stays quiet.
    dumpFnoDebug('load selected');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('keeps Maps and Sets readable in the dump', () => {
    setSwitch('1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordFnoDebug('plan', { seen: new Map([['a', 1]]), baseOnly: new Set(['g1']) });
    dumpFnoDebug('plan');
    const printed = log.mock.calls[0][0] as string;
    expect(printed).toContain('"a": 1');
    expect(printed).toContain('"g1"');
  });

  it('records nothing while the switch is off', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordFnoDebug('download', { asked: 'x' });
    setSwitch('1');
    dumpFnoDebug('load selected');
    expect(log).not.toHaveBeenCalled();
  });
});
