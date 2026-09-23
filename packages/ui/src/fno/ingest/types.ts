/**
 * Public API of the F&O ingest pipeline ("Load selected").
 *
 * The pipeline itself knows nothing about React or the app store: everything
 * it reads or writes goes through the interfaces below, so it can run under a
 * fake client in a unit test and keeps running after the panel that started
 * it has unmounted (the progress it reports lives in the app store).
 */

import type { ERConfiguration, ERLabel } from '@er-visualizer/core';
import type {
  ErConfigDownload,
  ErConfigSummary,
  ErSolutionSummary,
  FnoConnection,
} from '@er-visualizer/fno-client';
import type { FnoIngestItem, ToastKind } from '../../state/store';

/** The F&O calls the pipeline makes — `fnoSession` in the app. */
export interface FnoIngestClient {
  listComponents(
    conn: FnoConnection,
    solutionName: string,
    opts?: { signal?: AbortSignal },
  ): Promise<ErConfigSummary[]>;
  downloadConfiguration(
    conn: FnoConnection,
    component: ErConfigSummary,
    signal?: AbortSignal,
    opts?: { silent?: boolean },
  ): Promise<ErConfigDownload>;
}

/** The workspace the downloads land in. */
export interface FnoIngestWorkspace {
  /**
   * Configurations currently in the workspace. Re-read between phases: later
   * phases work from what the earlier downloads parsed into.
   */
  configurations(): readonly ERConfiguration[];
  /** Parse and add one configuration payload. May throw on a parse failure. */
  loadXml(xml: string, filePath: string): void;
  /** Merge labels of a not-loaded ancestor into the configurations inheriting them. */
  addInheritedLabels(targets: { filePaths: readonly string[] }, labels: readonly ERLabel[]): void;
  /** Publish labels harvested from every response of the run. */
  refreshLabelPool(): void;
}

/** A row of the download log, as queued before anything was fetched. */
export type FnoIngestQueuedItem = Pick<FnoIngestItem, 'key' | 'name' | 'kind' | 'explicit'>;

/** Where the pipeline reports progress — the ingest dialog in the app. */
export interface FnoIngestProgressSink {
  begin(items: FnoIngestQueuedItem[]): void;
  /** One-line phase description; `''` once the run is over. */
  status(text: string): void;
  updateItem(item: Pick<FnoIngestItem, 'key' | 'name' | 'kind'> & Partial<FnoIngestItem>): void;
  /** The download log as it stands (rows are also updated by the client). */
  items(): readonly FnoIngestItem[];
  end(): void;
}

/** A user-facing message (a toast in the app). */
export interface FnoIngestNotice {
  kind: ToastKind;
  message: string;
}

/** Everything a run needs to know about the browsing session that started it. */
export interface FnoIngestRequest {
  connection: FnoConnection;
  /** What the user ticked, keyed by `componentKey`. */
  selected: ReadonlyMap<string, ErConfigSummary>;
  /** Every DataModel listed so far (with an id), keyed by `componentKey`. */
  allDataModelsSeen: ReadonlyMap<string, ErConfigSummary>;
  /** Solutions shown in the navigator. */
  solutions: readonly ErSolutionSummary[];
  /** Full component lists fetched per root DataModel name. */
  rootComponentCache: ReadonlyMap<string, readonly ErConfigSummary[]>;
  /** Aborted on Disconnect / environment switch: stops issuing requests. */
  signal: AbortSignal;
}

export interface FnoIngestDeps {
  client: FnoIngestClient;
  workspace: FnoIngestWorkspace;
  progress: FnoIngestProgressSink;
  notify(notice: FnoIngestNotice): void;
}

export interface FnoIngestResult {
  /** Configurations loaded into the workspace (dependencies included). */
  loaded: number;
  /** Downloads that came back without own XML (a benign skip). */
  skippedEmpty: number;
  /** Components the run set out to fetch: the selection plus auto-included ones. */
  queued: number;
  /** The signal was aborted: whatever arrived is loaded, but this is no success. */
  cancelled: boolean;
}
