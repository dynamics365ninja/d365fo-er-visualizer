import { describe, it, expect } from 'vitest';
import { shouldKeepIngestLogOpen } from './FnoIngestPanel';
import type { FnoIngestItem, FnoIngestProgress } from '../state/store';

function item(status: FnoIngestItem['status'], name = 'Statement import format'): FnoIngestItem {
  return { key: `${name}::${status}`, name, kind: 'Format', status, explicit: true };
}

function finished(items: FnoIngestItem[], startedAt = 1_000): FnoIngestProgress {
  return { active: false, startedAt, finishedAt: startedAt + 5_000, items };
}

describe('shouldKeepIngestLogOpen', () => {
  it('keeps the log up when something did not arrive', () => {
    // The reported case: the model and its mapping were found but could not be
    // addressed. The batch ends, the app switches to the workspace, and without
    // this the only trace left is a toast.
    expect(shouldKeepIngestLogOpen(finished([item('done'), item('skipped', 'Bank statement model')]), 0)).toBe(true);
    expect(shouldKeepIngestLogOpen(finished([item('failed')]), 0)).toBe(true);
    expect(shouldKeepIngestLogOpen(finished([item('empty')]), 0)).toBe(true);
  });

  it('closes itself when everything arrived', () => {
    expect(shouldKeepIngestLogOpen(finished([item('done'), item('done', 'Bank statement model')]), 0)).toBe(false);
  });

  it('stays closed while the batch is still running', () => {
    // `fnoIngestStatus` drives the overlay during the run; this decides only
    // what happens after it ends.
    const running: FnoIngestProgress = {
      active: true, startedAt: 1_000, finishedAt: null, items: [item('downloading')],
    };
    expect(shouldKeepIngestLogOpen(running, 0)).toBe(false);
  });

  it('honours a dismissal, and reopens for the next batch', () => {
    const first = finished([item('skipped')], 1_000);
    const closedAt = first.finishedAt!;
    expect(shouldKeepIngestLogOpen(first, closedAt)).toBe(false);
    const second = finished([item('skipped')], closedAt + 1);
    expect(shouldKeepIngestLogOpen(second, closedAt)).toBe(true);
  });

  it('does not keep an empty log up', () => {
    expect(shouldKeepIngestLogOpen(finished([]), 0)).toBe(false);
  });
});
