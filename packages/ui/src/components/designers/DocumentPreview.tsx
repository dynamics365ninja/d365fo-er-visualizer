import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowDownloadRegular,
  ArrowRepeatAllRegular,
  BranchForkRegular,
  CopyRegular,
  DismissRegular,
  QuestionCircleRegular,
} from '@fluentui/react-icons';
import type { ERFormatElement } from '@er-visualizer/core';
import { t } from '../../i18n';
import { useTabState } from '../../utils/tab-view-state';
import { elementFill, type FormatLineage } from '../../utils/format-lineage';
import { buildPreviewDocument, lineElementKeys, type PreviewLine, type PreviewValueMode } from '../../utils/format-preview';
import { normalizeGuid } from '../../utils/format-binding-display';
import { downloadTextFile, safeFileName } from '../../utils/field-spec-export';
import { ElementFillCard } from './ElementFillCard';

const MODES: PreviewValueMode[] = ['sample', 'source', 'expression', 'name'];

/** Plain text of the file lines, annotations left out. */
function fileText(lines: readonly PreviewLine[], kind: 'xml' | 'text' | 'other'): string {
  return lines
    .filter(line => !line.note)
    .map(line => `${kind === 'xml' ? '  '.repeat(line.indent) : ''}${line.segments.map(segment => segment.text).join('')}`)
    .join('\n');
}

function Ruler({ width }: { width: number }) {
  const columns = Math.max(10, Math.ceil(width / 10) * 10);
  let marks = '';
  for (let i = 1; i <= columns; i++) marks += i % 10 === 0 ? String((i / 10) % 10) : i % 5 === 0 ? '+' : '·';
  return (
    <div className="doc-preview__line doc-preview__ruler" aria-label={t.docPreviewRuler}>
      <span className="doc-preview__gutter" aria-hidden />
      <span className="doc-preview__code">{marks}</span>
    </div>
  );
}

/**
 * The file the format writes, as a document you can read and point at:
 * values inline, repeating and conditional sections marked, and every value
 * linked to the element — and through it to the model and D365FO — it
 * comes from.
 */
export function DocumentPreview({ lineage, root, kind, configName, configIndex, selectedId, onSelect, onOpenStructure, tabId }: {
  lineage: FormatLineage;
  root: ERFormatElement;
  kind: 'xml' | 'text' | 'other';
  configName: string;
  configIndex: number;
  selectedId: string | null;
  onSelect: (elementId: string) => void;
  onOpenStructure: (elementId: string) => void;
  tabId?: string;
}) {
  const [mode, setMode] = useTabState<PreviewValueMode>(tabId, 'preview.mode', 'sample');
  const [iterations, setIterations] = useTabState(tabId, 'preview.iterations', 2);
  const [showNotes, setShowNotes] = useTabState(tabId, 'preview.notes', true);
  const [hideUnbound, setHideUnbound] = useTabState(tabId, 'preview.hideUnbound', false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [detailClosed, setDetailClosed] = useState(false);
  const [copied, setCopied] = useState(false);

  const doc = useMemo(() => buildPreviewDocument(lineage, root, kind, { mode, iterations, hideUnbound }, {
    repeats: t.docPreviewRepeats,
    condition: t.docPreviewCondition,
    optional: t.docPreviewOptional,
  }), [lineage, root, kind, mode, iterations, hideUnbound]);

  const lines = showNotes ? doc.lines : doc.lines.filter(line => !line.note);
  // File line numbers: annotations are not lines of the file.
  const lineNumbers = useMemo(() => {
    const numbers = new Map<string, number>();
    let n = 0;
    for (const line of doc.lines) if (!line.note) numbers.set(line.key, ++n);
    return numbers;
  }, [doc]);
  const selectedKey = selectedId ? normalizeGuid(selectedId) : null;
  const hoverKey = hoverId ? normalizeGuid(hoverId) : null;
  // A line hears about the selection and the hover only when it shows that
  // element: moving the mouse over a value then re-renders two lines, not a
  // document of thousands of segments.
  const keysByLine = useMemo(() => new Map(doc.lines.map(line => [line.key, lineElementKeys(line)])), [doc]);
  const selectedFill = useMemo(() => {
    const fill = elementFill(lineage, selectedId ?? undefined);
    return fill?.absorbedInto ? elementFill(lineage, fill.absorbedInto) ?? fill : fill;
  }, [lineage, selectedId]);

  const pick = useCallback((elementId: string | undefined) => {
    if (!elementId) return;
    setDetailClosed(false);
    onSelect(elementId);
  }, [onSelect]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fileText(doc.lines, kind));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access denied — nothing useful to report beyond not copying.
    }
  };

  const download = () => {
    const extension = kind === 'xml' ? 'xml' : 'txt';
    downloadTextFile(`${safeFileName(configName)} - ${t.previewLabel}.${extension}`, fileText(doc.lines, kind), kind === 'xml' ? 'application/xml;charset=utf-8' : 'text/plain;charset=utf-8');
  };

  return (
    <div className="doc-preview">
      <div className="doc-preview__toolbar">
        <div className="doc-preview__modes" role="group" aria-label={t.docPreviewModeAria}>
          {MODES.map(m => (
            <button key={m} type="button" className={`spec-mode ${mode === m ? 'active' : ''}`} aria-pressed={mode === m} title={t.docPreviewModeHints[m]} onClick={() => setMode(m)}>
              {t.docPreviewModeLabels[m]}
            </button>
          ))}
        </div>
        <label className="doc-preview__records" title={t.docPreviewRecords}>
          <ArrowRepeatAllRegular fontSize={13} aria-hidden />
          <span>{t.docPreviewRecords}</span>
          <select value={iterations} onChange={event => setIterations(Number(event.target.value))}>
            {[1, 2, 3, 5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="doc-preview__check" title={t.docPreviewNotesHint}>
          <input type="checkbox" checked={showNotes} onChange={event => setShowNotes(event.target.checked)} />
          {t.docPreviewNotes}
        </label>
        <label className="doc-preview__check" title={t.docPreviewHideUnboundHint}>
          <input type="checkbox" checked={hideUnbound} onChange={event => setHideUnbound(event.target.checked)} />
          {t.docPreviewHideUnbound}
        </label>
        <span className="doc-preview__spacer" />
        <button type="button" className="doc-preview__action" onClick={copy} title={t.docPreviewCopyHint}>
          <CopyRegular fontSize={13} aria-hidden /> {copied ? t.docPreviewCopied : t.docPreviewCopy}
        </button>
        <button type="button" className="doc-preview__action" onClick={download} title={t.docPreviewDownloadHint}>
          <ArrowDownloadRegular fontSize={13} aria-hidden /> {t.docPreviewDownload}
        </button>
      </div>
      <div className="doc-preview__legend">
        <span className="doc-legend doc-legend--repeat"><span className="doc-legend__swatch" />{t.docPreviewLegendRepeat}</span>
        <span className="doc-legend doc-legend--condition"><span className="doc-legend__swatch" />{t.docPreviewLegendCondition}</span>
        <span className="doc-legend doc-legend--constant"><span className="doc-legend__swatch" />{t.docPreviewLegendConstant}</span>
        <span className="doc-legend doc-legend--unbound"><span className="doc-legend__swatch" />{t.docPreviewLegendUnbound}</span>
        {doc.fixedWidth && <span className="doc-legend doc-legend--padding"><span className="doc-legend__swatch" />{t.docPreviewLegendPadding}</span>}
        <span className="doc-preview__hint">{t.docPreviewSelectHint}</span>
      </div>

      <div className="doc-preview__body">
        <div className={`doc-preview__doc doc-preview__doc--${kind}`} onMouseLeave={() => setHoverId(null)}>
          {lines.length === 0 && <p className="spec-view__empty">{t.docPreviewEmpty}</p>}
          {doc.fixedWidth && <Ruler width={doc.width} />}
          {lines.map(line => {
            const keys = keysByLine.get(line.key);
            return (
              <DocumentLine
                key={line.key}
                line={line}
                lineNumber={lineNumbers.get(line.key)}
                kind={kind}
                lineage={lineage}
                selectedKey={selectedKey && keys?.has(selectedKey) ? selectedKey : null}
                hoverKey={hoverKey && keys?.has(hoverKey) ? hoverKey : null}
                onPick={pick}
                onHover={setHoverId}
                onOpenStructure={onOpenStructure}
              />
            );
          })}
        </div>
        {selectedFill && !detailClosed && (
          <aside className="doc-preview__detail">
            <div className="doc-preview__detail-head">
              <span className="doc-preview__detail-name" title={selectedFill.path.slice(1).join(' / ')}>{selectedFill.displayName}</span>
              <button type="button" className="doc-preview__detail-close" onClick={() => setDetailClosed(true)} aria-label={t.docPreviewClose} title={t.docPreviewClose}>
                <DismissRegular fontSize={13} />
              </button>
            </div>
            <div className="doc-preview__detail-path">{selectedFill.path.slice(1, -1).join(' / ')}</div>
            <ElementFillCard fill={selectedFill} configIndex={configIndex} mappingLoaded={Boolean(lineage.mapping)} compact />
          </aside>
        )}
      </div>
    </div>
  );
}

/** One line of the document. Memoized: see `keysByLine`. */
const DocumentLine = React.memo(function DocumentLine({ line, lineNumber, kind, lineage, selectedKey, hoverKey, onPick, onHover, onOpenStructure }: {
  line: PreviewLine;
  lineNumber: number | undefined;
  kind: 'xml' | 'text' | 'other';
  lineage: FormatLineage;
  /** The selected element, when this line shows it. */
  selectedKey: string | null;
  /** The hovered element, when this line shows it. */
  hoverKey: string | null;
  onPick: (elementId: string | undefined) => void;
  onHover: (elementId: string) => void;
  onOpenStructure: (elementId: string) => void;
}) {
  return (
    <div className={`doc-preview__line${line.note ? ` doc-preview__note doc-preview__note--${line.note.kind}` : ''}`}>
      <span className="doc-preview__gutter">
        {line.bands.map((band, i) => (
          <span key={i} className={`doc-band doc-band--${band.kind}${selectedKey === normalizeGuid(band.elementId) ? ' doc-band--active' : ''}`} />
        ))}
        <span className="doc-preview__lineno">{lineNumber ?? ''}</span>
      </span>
      {line.note ? (
        <button
          type="button"
          className="doc-preview__note-text"
          style={{ paddingLeft: kind === 'xml' ? line.indent * 16 : 0 }}
          onClick={() => onPick(line.note!.elementId)}
          onDoubleClick={() => onOpenStructure(line.note!.elementId)}
        >
          {line.note.kind === 'repeat' ? <ArrowRepeatAllRegular fontSize={12} aria-hidden />
            : line.note.kind === 'condition' ? <BranchForkRegular fontSize={12} aria-hidden />
            : <QuestionCircleRegular fontSize={12} aria-hidden />}
          {line.note.text}
        </button>
      ) : (
        <span className="doc-preview__code" style={{ paddingLeft: kind === 'xml' ? `${line.indent * 2}ch` : 0 }}>
          {line.segments.map((segment, i) => {
            const id = segment.elementId;
            const key = id ? normalizeGuid(id) : null;
            const className = `doc-seg doc-seg--${segment.role}${key && key === selectedKey ? ' doc-seg--selected' : ''}${key && key === hoverKey ? ' doc-seg--hover' : ''}${segment.role === 'unbound' && !segment.text ? ' doc-seg--empty' : ''}`;
            if (!id) return <span key={i} className={className}>{segment.text}</span>;
            const fill = elementFill(lineage, id);
            return (
              <span
                key={i}
                className={className}
                title={fill ? [fill.path.slice(1).join(' / '), fill.binding, fill.sources.find(s => s.role === 'value' && s.kind === 'field')?.name].filter(Boolean).join('\n') : undefined}
                onMouseEnter={() => onHover(id)}
                onClick={() => onPick(id)}
                onDoubleClick={() => onOpenStructure(id)}
              >
                {segment.role === 'padding' ? segment.text.replace(/ /g, '·') : segment.text}
              </span>
            );
          })}
        </span>
      )}
    </div>
  );
});
