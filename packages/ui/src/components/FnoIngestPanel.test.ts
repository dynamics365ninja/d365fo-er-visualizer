import { describe, it, expect } from 'vitest';
import { ingestBarPercent, ingestGaps } from './FnoIngestPanel';
import type { FnoIngestItem, FnoIngestProgress } from '../state/store';

function item(status: FnoIngestItem['status'], name = 'Statement import format'): FnoIngestItem {
  return { key: `${name}::${status}`, name, kind: 'Format', status, explicit: true };
}

function finished(items: FnoIngestItem[], startedAt = 1_000): FnoIngestProgress {
  return { active: false, phase: 'finalize', startedAt, finishedAt: startedAt + 5_000, items };
}

describe('ingestGaps', () => {
  it('lists the rows that brought nothing into the workspace', () => {
    // The reported case: an import format arrives with its model, but the
    // destination mapping has no id in F&O. The run still ends on its own —
    // the gap goes to the summary toast, whose Details reopen the log.
    const progress = finished([
      item('done'),
      item('skipped', 'Mapping to destination'),
      item('failed', 'Broken format'),
      item('empty', 'Derived model'),
    ]);
    expect(ingestGaps(progress).map(i => i.name)).toEqual(['Mapping to destination', 'Broken format', 'Derived model']);
  });

  it('is empty when everything arrived', () => {
    expect(ingestGaps(finished([item('done'), item('done', 'Bank statement model')]))).toEqual([]);
    expect(ingestGaps(finished([]))).toEqual([]);
  });
});

describe('ingestBarPercent', () => {
  it('holds its furthest point when the run adds rows', () => {
    // 4 of 4 formats done, then the listing scan adds two mappings: 4/6.
    const before = ingestBarPercent(4, 4, true, 0);
    expect(before).toBe(95);
    expect(ingestBarPercent(4, 6, true, before)).toBe(95);
  });

  it('does not reach the end before the run finishes', () => {
    expect(ingestBarPercent(3, 3, true, 0)).toBe(95);
    expect(ingestBarPercent(3, 3, false, 95)).toBe(100);
  });

  it('moves forward with the downloads', () => {
    expect(ingestBarPercent(1, 4, true, 0)).toBe(25);
    expect(ingestBarPercent(2, 4, true, 25)).toBe(50);
  });
});
