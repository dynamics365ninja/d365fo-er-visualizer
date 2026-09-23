/**
 * React glue for the F&O ingest pipeline (`fno/ingest`): owns the
 * AbortController of the running "Load selected", wires the pipeline to the
 * app store and turns its result into the success toast.
 *
 * Progress lives in the app store, so a run keeps going — and keeps
 * reporting — after the panel that started it unmounts. Only Disconnect and
 * switching environment cancel it (`cancel`).
 */

import { useCallback, useRef, useState } from 'react';
import type { ErConfigSummary, ErSolutionSummary, FnoConnection } from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { useAppStore } from '../../state/store';
import { fnoSession } from '../../fno/session';
import { runFnoIngest, type FnoIngestDeps, type FnoIngestResult } from '../../fno/ingest';

/** The pipeline's view of the app: F&O session, workspace and download log. */
function appIngestDeps(): FnoIngestDeps {
  const store = useAppStore.getState;
  return {
    client: fnoSession,
    workspace: {
      configurations: () => store().configurations,
      loadXml: (xml, filePath) => { store().loadXmlFile(xml, filePath); },
      addInheritedLabels: (targets, labels) => store().addInheritedLabels(targets, labels),
      refreshLabelPool: () => store().refreshLabelPool(),
    },
    progress: {
      begin: items => store().beginFnoIngest(items),
      status: text => store().setFnoIngestStatus(text),
      updateItem: item => store().updateFnoIngestItem(item),
      items: () => store().fnoIngestProgress.items,
      end: () => store().endFnoIngest(),
    },
    notify: notice => { store().pushToast(notice); },
  };
}

export interface UseFnoIngestOptions {
  activeProfile: FnoConnection | null;
  selected: Map<string, ErConfigSummary>;
  allDataModelsSeen: Map<string, ErConfigSummary>;
  solutions: ErSolutionSummary[];
  /** Root model → full component list; read live while the run proceeds. */
  rootComponentCache: Map<string, ErConfigSummary[]>;
  setSelected: (next: Map<string, ErConfigSummary>) => void;
  onFilesLoaded?: () => void;
}

export function useFnoIngest({
  activeProfile,
  selected,
  allDataModelsSeen,
  solutions,
  rootComponentCache,
  setSelected,
  onFilesLoaded,
}: UseFnoIngestOptions): {
  ingesting: boolean;
  loadSelected: () => Promise<void>;
  cancel: () => void;
} {
  const pushToast = useAppStore(s => s.pushToast);
  const [ingesting, setIngesting] = useState(false);
  // Cancels the running "Load selected" pipeline (see loadSelected).
  const ingestAbortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    ingestAbortRef.current?.abort();
  }, []);

  const loadSelected = useCallback(async () => {
    if (!activeProfile) return;
    if (selected.size === 0) return;
    // Aborted by Disconnect / switching environment: stop issuing requests
    // (and, above all, stop re-acquiring a token the user just gave up).
    const ingestAbort = new AbortController();
    ingestAbortRef.current?.abort();
    ingestAbortRef.current = ingestAbort;
    setIngesting(true);
    useAppStore.setState({ cancelFnoIngest: () => ingestAbort.abort() });
    let result: FnoIngestResult;
    try {
      result = await runFnoIngest({
        connection: activeProfile,
        selected,
        allDataModelsSeen,
        solutions,
        rootComponentCache,
        signal: ingestAbort.signal,
      }, appIngestDeps());
    } finally {
      if (ingestAbortRef.current === ingestAbort) {
        ingestAbortRef.current = null;
        useAppStore.setState({ cancelFnoIngest: null });
      }
      setIngesting(false);
    }
    // Cancelled: whatever arrived is in the workspace, but this is no success.
    if (result.cancelled) return;
    if (result.loaded > 0) {
      // Clear the queue when the entire batch resolved (success or
      // benign empty). Partial *real* failures stay selected for retry.
      if (result.loaded + result.skippedEmpty === result.queued) setSelected(new Map());
      pushToast({ kind: 'success', message: t.fnoLoadedCount(result.loaded) });
      onFilesLoaded?.();
    }
  }, [activeProfile, selected, allDataModelsSeen, solutions, rootComponentCache, setSelected, pushToast, onFilesLoaded]);

  return { ingesting, loadSelected, cancel };
}
