import { describe, expect, it } from 'vitest';
import { useAppStore } from './store';

describe('F&O ingest phase', () => {
  it('only moves forward within a run', () => {
    const store = useAppStore.getState;
    store().beginFnoIngest([]);
    store().setFnoIngestStatus('Downloading formats & mappings…', 'fm');
    store().setFnoIngestStatus('Downloading model mappings…', 'mm');
    // The late DataModel pass and a phase-less follow-up must not pull the stepper back.
    store().setFnoIngestStatus('Resolving referenced DataModels…');
    store().setFnoIngestStatus('Downloading DataModels…', 'dm');
    expect(store().fnoIngestProgress.phase).toBe('mm');
    expect(store().fnoIngestStatus).toBe('Downloading DataModels…');
    store().endFnoIngest();
    store().setFnoIngestStatus('');
  });

  it('starts every run from the first phase', () => {
    const store = useAppStore.getState;
    store().beginFnoIngest([]);
    store().setFnoIngestStatus('…', 'finalize');
    store().endFnoIngest();
    store().beginFnoIngest([]);
    expect(store().fnoIngestProgress.phase).toBe('prepare');
    store().endFnoIngest();
    store().setFnoIngestStatus('');
  });
});

describe('F&O download log', () => {
  const store = useAppStore.getState;
  const row = { key: 'a', name: 'Statement format', kind: 'Format' as const, explicit: true };

  it('closes when a run starts and comes back only when asked for', () => {
    store().beginFnoIngest([row]);
    store().endFnoIngest();
    expect(store().fnoIngestLogOpen).toBe(false);
    store().showFnoIngestLog();
    expect(store().fnoIngestLogOpen).toBe(true);
    // The next run starts with its own, live dialog.
    store().beginFnoIngest([row]);
    expect(store().fnoIngestLogOpen).toBe(false);
    store().endFnoIngest();
    store().setFnoIngestStatus('');
  });

  it('is not reopened by closing every configuration', () => {
    // Closing the last configuration brings the landing page back. The log of
    // the download that loaded them must not come along with it.
    store().beginFnoIngest([row]);
    store().endFnoIngest();
    store().showFnoIngestLog();
    store().removeAllConfigurations();
    expect(store().fnoIngestLogOpen).toBe(false);
    store().setFnoIngestStatus('');
  });

  it('has nothing to show before any download', () => {
    useAppStore.setState({ fnoIngestProgress: { active: false, phase: 'prepare', startedAt: null, finishedAt: null, items: [] } });
    store().showFnoIngestLog();
    expect(store().fnoIngestLogOpen).toBe(false);
  });
});
