import React, { useMemo, useState } from 'react';
import { ArrowDownloadRegular, ArrowUploadRegular, DocumentPdfRegular } from '@fluentui/react-icons';
import { useAppStore } from '../../state/store';
import { locale, t } from '../../i18n';
import { ERDirection, type ERFormatContent, type ERFormatElement } from '@er-visualizer/core';
import { renderXmlHighlightedMarkup } from '../../utils/xml-highlight';
import { formatTypeLabelFor } from './shared';
import { type BindingMap, type PreviewPlaceholderMode, type PreviewRenderOptions, previewValue } from './preview-values';
import { ExcelVisualPreview } from './ExcelPreview';
import { unwrapConverterRoot, detectFormatType } from './format-type';

type DelimitedPreviewData = {
  delimiter: string;
  rows: string[][];
  columnCount: number;
};

function parseDelimitedPreview(text: string): DelimitedPreviewData | null {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  const candidates = [';', ',', '\t'];
  const scored = candidates.map(delimiter => ({
    delimiter,
    score: lines.slice(0, 12).reduce((sum, line) => sum + Math.max(0, line.split(delimiter).length - 1), 0),
  }));

  const best = scored.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score <= 0) return null;

  const rows = lines.map(line => line.split(best.delimiter).map(cell => cell.trim()));
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columnCount < 2) return null;

  return { delimiter: best.delimiter, rows, columnCount };
}

export function FormatPreview({ rootElement, direction, bindingMap, configIndex, onNavigateToElement, tabId }: { rootElement: ERFormatElement; direction: ERDirection | undefined; bindingMap: BindingMap; configIndex: number; onNavigateToElement?: (elementId: string) => void; tabId?: string }) {
  const isPdf = rootElement?.elementType === 'PDFFile';
  const previewRoot = unwrapConverterRoot(rootElement);
  const info = detectFormatType(previewRoot);
  const template = useAppStore(s => {
    const cfg = s.configurations[configIndex];
    if (!cfg || cfg.content.kind !== 'Format') return undefined;
    return (cfg.content as ERFormatContent).formatVersion.format.template;
  });
  const [placeholderMode, setPlaceholderMode] = useState<PreviewPlaceholderMode>('sample');
  const [csvFirstRowHeader, setCsvFirstRowHeader] = useState(true);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const previewOptions = useMemo<PreviewRenderOptions>(
    () => ({ placeholderMode, showTechnicalDetails }),
    [placeholderMode, showTechnicalDetails],
  );
  const preview = useMemo(() => generateFormatPreview(previewRoot, bindingMap, previewOptions), [previewRoot, bindingMap, previewOptions]);
  const delimitedPreview = useMemo(() => parseDelimitedPreview(preview), [preview]);

  // Visual spreadsheet preview for Excel formats (including Excel wrapped in a PDF converter)
  if (info.label === 'Excel') {
    return (
      <ExcelVisualPreview
        key={`excel-${configIndex}`}
        rootElement={previewRoot}
        direction={direction}
        bindingMap={bindingMap}
        configIndex={configIndex}
        template={template}
        onNavigateToElement={onNavigateToElement}
        pdfOutput={isPdf}
        tabId={tabId}
      />
    );
  }

  if (isPdf && previewRoot === rootElement) {
    return <div style={{ padding: 16, fontSize: 12, color: 'var(--er-text-muted)' }}><DocumentPdfRegular fontSize={13} aria-hidden /> {t.pdfNoSourceComponent}</div>;
  }

  const showDelimitedTable = (info.label === 'Text / CSV' || info.label === 'Text') && delimitedPreview !== null;
  const tableHeaderCells = showDelimitedTable && delimitedPreview
    ? (csvFirstRowHeader
      ? (delimitedPreview.rows[0] ?? Array.from({ length: delimitedPreview.columnCount }, (_, i) => `C${i + 1}`))
      : Array.from({ length: delimitedPreview.columnCount }, (_, i) => `C${i + 1}`))
    : [];
  const tableRows = showDelimitedTable && delimitedPreview
    ? (csvFirstRowHeader ? delimitedPreview.rows.slice(1) : delimitedPreview.rows)
    : [];
  const previewBlockStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono, "Cascadia Code", Consolas, monospace)',
    fontSize: 12,
    lineHeight: 1.6,
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    color: 'var(--er-text)',
    background: 'var(--bg-secondary)',
    padding: 16,
    borderRadius: 6,
    border: '1px solid var(--border-subtle)',
  };
  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--er-text-muted)' }}>
        {direction === ERDirection.Import
          ? <><ArrowDownloadRegular fontSize={13} aria-hidden /> {t.excelInput}</>
          : <><ArrowUploadRegular fontSize={13} aria-hidden /> {t.excelOutput}</>} — {t.previewDescription}
      </div>
      {isPdf && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--er-text-muted)' }}>
          <DocumentPdfRegular fontSize={13} aria-hidden /> {t.pdfConvertedFrom(info.label)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--er-text-muted)' }}>{locale === 'cs' ? 'Nevyřešené hodnoty:' : 'Unresolved values:'}</span>
        <button
          type="button"
          onClick={() => setPlaceholderMode('sample')}
          style={{
            border: placeholderMode === 'sample' ? '1px solid var(--er-accent)' : '1px solid var(--border-color)',
            background: placeholderMode === 'sample' ? 'color-mix(in srgb, var(--er-accent) 16%, transparent)' : 'var(--bg-secondary)',
            color: 'var(--er-text)',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {locale === 'cs' ? 'Vzorová data' : 'Sample data'}
        </button>
        <button
          type="button"
          onClick={() => setPlaceholderMode('braces')}
          style={{
            border: placeholderMode === 'braces' ? '1px solid var(--er-accent)' : '1px solid var(--border-color)',
            background: placeholderMode === 'braces' ? 'color-mix(in srgb, var(--er-accent) 16%, transparent)' : 'var(--bg-secondary)',
            color: 'var(--er-text)',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {locale === 'cs' ? 'Ponechat {placeholder}' : 'Keep {placeholder}'}
        </button>
        <button
          type="button"
          onClick={() => setPlaceholderMode('omit')}
          style={{
            border: placeholderMode === 'omit' ? '1px solid var(--er-accent)' : '1px solid var(--border-color)',
            background: placeholderMode === 'omit' ? 'color-mix(in srgb, var(--er-accent) 16%, transparent)' : 'var(--bg-secondary)',
            color: 'var(--er-text)',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {locale === 'cs' ? 'Skrýt nevyřešené' : 'Hide unresolved'}
        </button>
      </div>
      {showDelimitedTable && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--er-text-muted)' }}>{locale === 'cs' ? 'CSV zobrazení:' : 'CSV view:'}</span>
          <button
            type="button"
            onClick={() => setCsvFirstRowHeader(v => !v)}
            style={{
              border: csvFirstRowHeader ? '1px solid var(--er-accent)' : '1px solid var(--border-color)',
              background: csvFirstRowHeader ? 'color-mix(in srgb, var(--er-accent) 16%, transparent)' : 'var(--bg-secondary)',
              color: 'var(--er-text)',
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            {locale === 'cs' ? 'První řádek = hlavička' : 'First row = header'}
          </button>
        </div>
      )}
      {info.label === 'XML' ? (
        <pre
          style={previewBlockStyle}
          dangerouslySetInnerHTML={{ __html: renderXmlHighlightedMarkup(preview) }}
        />
      ) : showDelimitedTable && delimitedPreview ? (
        <div style={{ ...previewBlockStyle, overflow: 'auto', padding: 0 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', width: 56, padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--er-text-muted)', fontSize: 11 }}>#</th>
                {Array.from({ length: delimitedPreview.columnCount }, (_, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border-subtle)',
                      color: 'var(--er-text-muted)',
                      fontSize: 11,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {(tableHeaderCells[i] ?? `C${i + 1}`) || `C${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td style={{ textAlign: 'right', padding: '5px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--er-text-muted)', fontSize: 11 }}>{rowIndex + (csvFirstRowHeader ? 2 : 1)}</td>
                  {Array.from({ length: delimitedPreview.columnCount }, (_, colIndex) => (
                    <td
                      key={colIndex}
                      style={{
                        padding: '5px 8px',
                        borderBottom: '1px solid var(--border-subtle)',
                        borderLeft: colIndex === 0 ? '1px solid var(--border-subtle)' : undefined,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        verticalAlign: 'top',
                      }}
                      title={row[colIndex] ?? ''}
                    >
                      {row[colIndex] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre style={previewBlockStyle}>{preview}</pre>
      )}
    </div>
  );
}

/** Build a file preview from the ER Format element tree using binding expressions. */
function generateFormatPreview(rootElement: ERFormatElement, bm: BindingMap, options: PreviewRenderOptions): string {
  const root = unwrapConverterRoot(rootElement);
  const info = detectFormatType(root);
  if (info.label === 'XML') return generateXmlPreview(root, 0, bm, options);
  if (info.label === 'Text / CSV' || info.label === 'Text') return generateTextPreview(root, bm, options);
  if (info.label === 'Excel') return generateExcelPreview(root, bm, options);
  // Fallback: generic tree-like view
  return generateGenericPreview(root, 0, bm, options);
}

function generateXmlPreview(el: ERFormatElement, depth: number, bm: BindingMap, options: PreviewRenderOptions): string {
  const indent = '  '.repeat(depth);
  const name = el.name || el.elementType;

  if (el.elementType === 'File') {
    const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const body = el.children.map(c => generateXmlPreview(c, 0, bm, options)).join('\n').trim();
    return body ? `${header}${body}` : header;
  }

  if (el.elementType === 'XMLAttribute') {
    return ''; // Attributes are rendered inline on the parent element
  }

  if (el.elementType === 'XMLSequence') {
    const inner = el.children.map(c => generateXmlPreview(c, depth, bm, options)).join('');
    if (!inner.trim() && options.placeholderMode === 'omit') return '';
    return inner;
  }

  if (el.elementType === 'XMLElement') {
    const attrs = el.children
      .filter(c => c.elementType === 'XMLAttribute')
      .map(a => ({ name: a.name, value: previewValue(a, bm, options) }))
      .filter(a => a.value !== '')
      .map(a => ` ${a.name}="${a.value}"`)
      .join('');
    const nonAttrChildren = el.children.filter(c => c.elementType !== 'XMLAttribute');

    if (nonAttrChildren.length === 0) {
      const val = previewValue(el, bm, options);
      if (!attrs && !val && options.placeholderMode === 'omit') return '';
      if (attrs) return `${indent}<${name}${attrs}>${val}</${name}>\n`;
      return `${indent}<${name}>${val}</${name}>\n`;
    }

    const inner = nonAttrChildren.map(c => generateXmlPreview(c, depth + 1, bm, options)).join('');
    if (!attrs && !inner.trim() && options.placeholderMode === 'omit') return '';
    return `${indent}<${name}${attrs}>\n${inner}${indent}</${name}>\n`;
  }

  // String/Numeric/DateTime etc. inside XML — render as text content
  if (['String', 'Numeric', 'DateTime', 'Base64'].includes(el.elementType)) {
    const value = previewValue(el, bm, options);
    if (!value && options.placeholderMode === 'omit') return '';
    return `${indent}${value}\n`;
  }

  // Default
  const inner = el.children.map(c => generateXmlPreview(c, depth + 1, bm, options)).join('');
  return inner;
}

function generateTextPreview(root: ERFormatElement, bm: BindingMap, options: PreviewRenderOptions): string {
  const lines: string[] = [];

  const walk = (el: ERFormatElement) => {
    if (el.elementType === 'TextLine' || el.elementType === 'String') {
      const children = el.children ?? [];
      if (children.length > 0) {
        const fields = children.map(c => previewValue(c, bm, options));
        lines.push(fields.join(';'));
      } else {
        lines.push(previewValue(el, bm, options));
      }
    } else if (el.elementType === 'TextSequence') {
      lines.push(t.previewRepeatingStart(el.name));
      for (const child of el.children) walk(child);
      lines.push(t.previewRepeatingEnd(el.name));
    } else if (el.elementType === 'File' || el.elementType === 'XMLSequence') {
      for (const child of el.children) walk(child);
    } else if (el.children.length > 0) {
      for (const child of el.children) walk(child);
    } else {
      lines.push(previewValue(el, bm, options));
    }
  };

  walk(root);
  return lines.filter(line => line || options.placeholderMode !== 'omit').join('\n');
}

function generateExcelPreview(root: ERFormatElement, bm: BindingMap, options: PreviewRenderOptions): string {
  const lines: string[] = [];
  const walk = (el: ERFormatElement, depth: number) => {
    const indent = '  '.repeat(depth);
    if (el.elementType === 'ExcelFile') {
      lines.push(`${t.excelWorkbook}`);
      for (const child of el.children) walk(child, depth + 1);
    } else if (el.elementType === 'ExcelSheet') {
      lines.push(`${indent}${t.excelSheet}: "${el.name}"`);
      for (const child of el.children) walk(child, depth + 1);
    } else if (el.elementType === 'ExcelRange' || el.elementType === 'ExcelHeader' || el.elementType === 'ExcelFooter') {
      const sectionLabel = el.elementType === 'ExcelHeader' ? `${t.excelHeader}` : el.elementType === 'ExcelFooter' ? `${t.excelFooter}` : `${t.excelRange}`;
      lines.push(`${indent}${sectionLabel}: ${el.name}`);
      for (const child of el.children) walk(child, depth + 1);
    } else if (el.elementType === 'ExcelCell') {
      lines.push(`${indent}${t.excelCell}: ${el.name} = ${previewValue(el, bm, options)}`);
    } else {
      lines.push(`${indent}${formatTypeLabelFor(el.elementType, options.showTechnicalDetails)}: ${el.name}`);
      for (const child of el.children) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return lines.join('\n');
}

function generateGenericPreview(el: ERFormatElement, depth: number, bm: BindingMap, options: PreviewRenderOptions): string {
  const indent = '  '.repeat(depth);
  const label = `${formatTypeLabelFor(el.elementType, options.showTechnicalDetails)}: ${el.name}`;
  const pv = previewValue(el, bm, options);
  const val = pv !== `{${el.name}}` ? ` = ${pv}` : '';
  const line = `${indent}${label}${val}\n`;
  return line + el.children.map(c => generateGenericPreview(c, depth + 1, bm, options)).join('');
}

// ── Format type detection ──
