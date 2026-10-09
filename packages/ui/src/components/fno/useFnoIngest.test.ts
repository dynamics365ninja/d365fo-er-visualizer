import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import { useAppStore } from '../../state/store';
import { ingestSummaryToast } from './useFnoIngest';

describe('ingestSummaryToast', () => {
  it('reports a clean download as a success', () => {
    expect(ingestSummaryToast({ loaded: 3, warnings: [] }, 0)).toEqual({
      kind: 'success',
      message: t.fnoLoadedCount(3),
    });
  });

  it('counts what did not arrive and offers the log', () => {
    // The download dialog no longer stays up on a gap; this toast is where the
    // user learns about it, and "Details" reopens the log.
    const toast = ingestSummaryToast({ loaded: 3, warnings: ['No id for the destination mapping.'] }, 2);
    expect(toast).toMatchObject({
      kind: 'warning',
      message: `${t.fnoLoadedWithGaps(3, 2)}\n\nNo id for the destination mapping.`,
      action: { label: t.fnoIngestShowLog },
    });
    useAppStore.getState().beginFnoIngest([{ key: 'k', name: 'Statement format', kind: 'Format', explicit: true }]);
    useAppStore.getState().endFnoIngest();
    toast!.action!.onClick();
    expect(useAppStore.getState().fnoIngestLogOpen).toBe(true);
    useAppStore.getState().hideFnoIngestLog();
    useAppStore.getState().setFnoIngestStatus('');
  });

  it('says when nothing arrived at all', () => {
    expect(ingestSummaryToast({ loaded: 0, warnings: [] }, 1)?.message).toBe(t.fnoLoadedNothing);
  });

  it('stays quiet when there is nothing to report', () => {
    expect(ingestSummaryToast({ loaded: 0, warnings: [] }, 0)).toBeNull();
  });
});
