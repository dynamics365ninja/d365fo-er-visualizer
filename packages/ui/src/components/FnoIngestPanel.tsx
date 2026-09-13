import { useEffect, useState } from 'react';
import { Button } from '@fluentui/react-components';
import {
  ArrowSyncRegular,
  CheckmarkCircleFilled,
  CloudArrowDownRegular,
  DismissCircleFilled,
  SubtractCircleRegular,
} from '@fluentui/react-icons';
import { t, useLocale } from '../i18n';
import { useAppStore, type FnoIngestItem, type FnoIngestProgress } from '../state/store';
import { DependencyKindIcon, dependencyKindLabel } from './DependencyPromptDialog';

const INGEST_STEPS = [
  { key: 'prepare', cs: 'Příprava', en: 'Preparing' },
  { key: 'dm', cs: 'Datové modely', en: 'Data models' },
  { key: 'fm', cs: 'Formáty a mapování', en: 'Formats & mappings' },
  { key: 'mm', cs: 'Mapování modelů', en: 'Model mappings' },
  { key: 'finalize', cs: 'Dokončení', en: 'Finalizing' },
] as const;

/** Map the free-text ingest status onto one of the five pipeline phases. */
export function activeIngestStep(status: string): number {
  const s = status.toLowerCase();
  if (!s) return -1;
  if (s.includes('přípravu') || s.includes('prepar')) return 0;
  if (s.includes('datamodel') || s.includes('datov')) return 1;
  if (s.includes('mapping') || s.includes('mapov')) return 3;
  if (s.includes('form') || s.includes('konfigurace') || s.includes('configuration')) return 2;
  if (s.includes('dokon') || s.includes('řeš') || s.includes('resolv') || s.includes('cross')) return 4;
  return 2;
}

function statusLabel(status: FnoIngestItem['status']): string {
  switch (status) {
    case 'queued': return t.fnoIngestStatusQueued;
    case 'downloading': return t.fnoIngestStatusDownloading;
    case 'done': return t.fnoIngestStatusDone;
    case 'empty': return t.fnoIngestStatusEmpty;
    case 'failed': return t.fnoIngestStatusFailed;
    case 'skipped': return t.fnoIngestStatusSkipped;
  }
}

function StatusIcon({ status }: { status: FnoIngestItem['status'] }) {
  if (status === 'done') return <CheckmarkCircleFilled className="fno-ingest-row__icon fno-ingest-row__icon--done" fontSize={15} />;
  if (status === 'failed') return <DismissCircleFilled className="fno-ingest-row__icon fno-ingest-row__icon--failed" fontSize={15} />;
  if (status === 'empty' || status === 'skipped') return <SubtractCircleRegular className="fno-ingest-row__icon fno-ingest-row__icon--empty" fontSize={15} />;
  if (status === 'downloading') return <ArrowSyncRegular className="fno-ingest-row__icon fno-ingest-row__icon--active" fontSize={15} style={{ animation: 'spin 1.2s linear infinite' }} />;
  return <span className="fno-ingest-row__icon fno-ingest-row__dot" />;
}

function useElapsedSeconds(startedAt: number | null, finishedAt: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt || finishedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt, finishedAt]);
  if (!startedAt) return 0;
  return Math.max(0, Math.round(((finishedAt ?? now) - startedAt) / 1000));
}

/**
 * Structured progress of an F&O download: phase stepper, per-configuration
 * rows (selected vs. auto-resolved dependencies), counters and elapsed time.
 * Rendered as a modal overlay on the landing page and as a compact card in
 * the explorer while the workspace is still empty.
 */
export function FnoIngestPanel({ variant = 'overlay', onClose }: {
  variant?: 'overlay' | 'card';
  /** Rendered as a Close button once the batch has finished. */
  onClose?: () => void;
}) {
  const loc = useLocale();
  const status = useAppStore(s => s.fnoIngestStatus);
  const progress = useAppStore(s => s.fnoIngestProgress);
  const elapsed = useElapsedSeconds(progress.startedAt, progress.finishedAt);
  const active = progress.active || Boolean(status);
  const step = activeIngestStep(status);

  const items = progress.items;
  const failed = items.filter(i => i.status === 'failed').length;
  const empty = items.filter(i => i.status === 'empty').length;
  const finished = items.filter(i => i.status !== 'queued' && i.status !== 'downloading').length;
  const total = items.length;
  const percent = total > 0 ? Math.round((finished / total) * 100) : 0;

  const isOverlay = variant === 'overlay';

  const body = (
    <div className={`fno-ingest ${isOverlay ? 'fno-ingest--overlay' : 'fno-ingest--card'}`} role="status" aria-live="polite">
      <div className="fno-ingest__head">
        <span className="fno-ingest__icon" aria-hidden="true">
          <CloudArrowDownRegular fontSize={isOverlay ? 22 : 18} />
        </span>
        <div className="fno-ingest__titles">
          <div className="fno-ingest__title">{active ? t.fnoIngestTitle : t.fnoIngestDone}</div>
          <div className="fno-ingest__subtitle">
            {total > 0 ? t.fnoIngestSummary(finished, total) : status}
            {failed > 0 && <span className="fno-ingest__chip fno-ingest__chip--failed">{t.fnoIngestFailed(failed)}</span>}
            {empty > 0 && <span className="fno-ingest__chip fno-ingest__chip--empty">{t.fnoIngestEmpty(empty)}</span>}
          </div>
        </div>
        <span className="fno-ingest__elapsed" title={status}>{elapsed}s</span>
      </div>

      <div className={`fno-ingest__track ${active && total === 0 ? 'fno-ingest__track--indeterminate' : ''}`}>
        <div className="fno-ingest__bar" style={total > 0 ? { width: `${Math.max(percent, active ? 4 : 0)}%` } : undefined} />
      </div>

      <ol className="fno-ingest__steps">
        {INGEST_STEPS.map((s, i) => {
          const state = !active ? 'done' : i < step ? 'done' : i === step ? 'active' : 'pending';
          return (
            <li key={s.key} className={`fno-ingest__step fno-ingest__step--${state}`}>
              <span className="fno-ingest__step-dot" />
              <span className="fno-ingest__step-label">{loc === 'cs' ? s.cs : s.en}</span>
            </li>
          );
        })}
      </ol>

      {active && status && (
        <div className="fno-ingest__status" title={status}>{status}</div>
      )}

      {items.length > 0 && (
        <ul className={`fno-ingest__list ${isOverlay ? '' : 'fno-ingest__list--compact'}`}>
          {items.map(item => (
            <li key={item.key} className={`fno-ingest-row fno-ingest-row--${item.status}`} title={item.message ?? statusLabel(item.status)}>
              <StatusIcon status={item.status} />
              <span className={`fno-ingest-row__kind fno-ingest-row__kind--${item.kind.toLowerCase()}`}>
                <DependencyKindIcon kind={item.kind} />
                {isOverlay && <span>{dependencyKindLabel(item.kind)}</span>}
              </span>
              <span className="fno-ingest-row__name">{item.name}</span>
              <span className={`fno-ingest-row__origin ${item.explicit ? '' : 'fno-ingest-row__origin--auto'}`}>
                {item.explicit ? t.fnoIngestExplicit : t.fnoIngestAuto}
              </span>
              {/* A skipped row carries the reason it was skipped — showing it
                  beats "Skipped" for a configuration the listing clearly found. */}
              <span className="fno-ingest-row__state">
                {item.message && (item.status === 'failed' || item.status === 'skipped')
                  ? item.message
                  : statusLabel(item.status)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isOverlay && (
        <div className="fno-ingest__foot">
          <span className="fno-ingest__hint">{t.fnoIngestHint}</span>
          {onClose && !active && (
            <Button appearance="primary" size="small" onClick={onClose}>{t.fnoIngestClose}</Button>
          )}
        </div>
      )}
    </div>
  );

  if (!isOverlay) return body;
  return <div className="fno-ingest-backdrop">{body}</div>;
}

/**
 * The overlay, mounted once for the whole app.
 *
 * It has to outlive the landing page: the first configuration that arrives
 * switches the app over to the workspace, which used to unmount the dialog
 * mid-run. Rows added at the end of a batch — a model or a mapping the listing
 * found but nothing could address — therefore reached the store and were never
 * drawn, leaving the toast as the only trace. So the log also stays up after the
 * batch ends whenever something did not arrive, until the user closes it.
 */
export function shouldKeepIngestLogOpen(
  progress: Pick<FnoIngestProgress, 'items' | 'startedAt' | 'finishedAt'>,
  closedAt: number,
): boolean {
  if (progress.finishedAt === null) return false;
  const somethingMissing = progress.items.some(
    i => i.status === 'failed' || i.status === 'empty' || i.status === 'skipped',
  );
  if (!somethingMissing) return false;
  // A newer batch beats an earlier dismissal, so the next Load shows its log.
  return (progress.startedAt ?? 0) > closedAt;
}

export function FnoIngestOverlay() {
  const status = useAppStore(s => s.fnoIngestStatus);
  const progress = useAppStore(s => s.fnoIngestProgress);
  const [closedAt, setClosedAt] = useState(0);

  const keepOpenAfterFinish = shouldKeepIngestLogOpen(progress, closedAt);
  if (!status && !keepOpenAfterFinish) return null;
  return (
    <FnoIngestPanel
      variant="overlay"
      onClose={status ? undefined : () => setClosedAt(Date.now())}
    />
  );
}
