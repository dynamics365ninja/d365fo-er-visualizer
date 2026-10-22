import { useEffect, useState } from 'react';
import type { ERConfiguration, ERFormatContent } from '@er-visualizer/core';
import { parseXlsxBase64, type XlsxWorkbook } from '../../utils/xlsx-parser';
import { compareWorkbooks, isWorkbookTemplate, type WorkbookComparison } from '../../utils/template-diff';

export type TemplateComparisonState =
  /** Neither side embeds a workbook. */
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
    status: 'ready';
    /** `null` on a side that embeds no workbook — everything on the other side is then added or removed. */
    older: XlsxWorkbook | null;
    newer: XlsxWorkbook | null;
    olderFile?: string;
    newerFile?: string;
    comparison: WorkbookComparison;
  };

const EMPTY_WORKBOOK: XlsxWorkbook = { sheets: [], definedNames: new Map(), definedRanges: new Map(), namedAreas: [] };

/** Parsed workbooks by their base64, so switching the view or reopening a comparison does not unzip them again. */
const parsed = new Map<string, Promise<XlsxWorkbook>>();
const MAX_PARSED = 6;

function parseCached(base64: string): Promise<XlsxWorkbook> {
  let promise = parsed.get(base64);
  if (!promise) {
    promise = parseXlsxBase64(base64);
    // A failed parse is not kept: the next attempt tries again.
    promise.catch(() => parsed.delete(base64));
    parsed.set(base64, promise);
    while (parsed.size > MAX_PARSED) parsed.delete(parsed.keys().next().value!);
  }
  return promise;
}

export function workbookTemplateOf(cfg: ERConfiguration | undefined): { filename: string; base64: string } | undefined {
  if (cfg?.content.kind !== 'Format') return undefined;
  const template = (cfg.content as ERFormatContent).formatVersion?.format?.template;
  return template && isWorkbookTemplate(template) ? { filename: template.filename, base64: template.base64! } : undefined;
}

/** The two Excel templates of a format comparison, unzipped and compared. */
export function useTemplateComparison(older: ERConfiguration | undefined, newer: ERConfiguration | undefined): TemplateComparisonState {
  const olderTemplate = workbookTemplateOf(older);
  const newerTemplate = workbookTemplateOf(newer);
  const olderBase64 = olderTemplate?.base64;
  const newerBase64 = newerTemplate?.base64;
  const olderFile = olderTemplate?.filename;
  const newerFile = newerTemplate?.filename;
  const [state, setState] = useState<TemplateComparisonState>(() => (olderBase64 || newerBase64 ? { status: 'loading' } : { status: 'none' }));

  useEffect(() => {
    if (!olderBase64 && !newerBase64) {
      setState({ status: 'none' });
      return;
    }
    let cancelled = false;
    setState(current => (current.status === 'loading' ? current : { status: 'loading' }));
    Promise.all([
      olderBase64 ? parseCached(olderBase64) : Promise.resolve(null),
      newerBase64 ? parseCached(newerBase64) : Promise.resolve(null),
    ]).then(([a, b]) => {
      if (cancelled) return;
      setState({
        status: 'ready',
        older: a,
        newer: b,
        olderFile,
        newerFile,
        comparison: compareWorkbooks(a ?? EMPTY_WORKBOOK, b ?? EMPTY_WORKBOOK),
      });
    }, (error: unknown) => {
      if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    });
    return () => { cancelled = true; };
  }, [olderBase64, newerBase64, olderFile, newerFile]);

  return state;
}
