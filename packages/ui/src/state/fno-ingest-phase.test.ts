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
