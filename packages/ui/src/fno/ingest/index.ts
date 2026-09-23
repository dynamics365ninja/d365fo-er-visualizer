/**
 * F&O ingest pipeline — the UI-independent half of "Load selected".
 */

export { runFnoIngest, loadDownloadIntoWorkspace } from './run-ingest';
export { planIngest } from './plan';
export { resolveInheritedLabels } from './labels';
export { ZERO_GUID_LOWER, componentKey, descriptorNamesFromContainers, isUsableGuid } from './shared';
export type {
  FnoIngestClient,
  FnoIngestDeps,
  FnoIngestNotice,
  FnoIngestProgressSink,
  FnoIngestQueuedItem,
  FnoIngestRequest,
  FnoIngestResult,
  FnoIngestWorkspace,
} from './types';
