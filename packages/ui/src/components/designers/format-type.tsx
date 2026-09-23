import {
  ArrowRepeatAllRegular,
  AttachRegular,
  CalendarRegular,
  CodeRegular,
  DocumentDataRegular,
  DocumentPdfRegular,
  DocumentRegular,
  DocumentTableRegular,
  DocumentTextRegular,
  NumberSymbolRegular,
  PanelBottomExpandRegular,
  PanelTopExpandRegular,
  QuestionCircleRegular,
  SelectAllOnRegular,
  TableRegular,
  TextAlignLeftRegular,
  TextFontRegular,
  type FluentIcon,
} from '@fluentui/react-icons';
import { t } from '../../i18n';
import { getFormatTypeThemeColor } from '../../utils/theme-colors';
import { type ERFormatElement } from '@er-visualizer/core';

interface FormatTypeInfo {
  label: string;
  Icon: FluentIcon;
  color: string;
  bg: string;
}

/** The PDF converter component only wraps the component that actually produces the
 *  document (usually an Excel template). Preview/structure logic must look through it. */
export function unwrapConverterRoot(rootElement: ERFormatElement): ERFormatElement {
  if (rootElement?.elementType !== 'PDFFile') return rootElement;
  const inner = rootElement.children?.find(c => c.elementType !== 'Unknown');
  return inner ?? rootElement;
}

export function detectFormatType(rootElement: any): FormatTypeInfo {
  const et = rootElement?.elementType ?? '';
  if (et === 'ExcelFile') return { label: 'Excel', Icon: DocumentTableRegular, color: 'var(--er-success)', bg: 'var(--er-success-soft)' };
  if (et === 'WordFile')  return { label: 'Word',  Icon: DocumentTextRegular, color: 'var(--er-info)', bg: 'var(--er-info-soft)' };
  if (et === 'PDFFile')   return { label: 'PDF',   Icon: DocumentPdfRegular, color: 'var(--er-danger)', bg: 'var(--er-danger-soft)' };
  if (et === 'File' || et === 'XMLElement') {
    // Look at children to determine sub-type
    const children: any[] = rootElement?.children ?? [];
    const childTypes = new Set(children.map((c: any) => c.elementType));
    if (childTypes.has('XMLElement') || et === 'XMLElement') {
      return { label: 'XML', Icon: CodeRegular, color: 'var(--er-info)', bg: 'var(--er-info-soft)' };
    }
    if (childTypes.has('TextSequence') || childTypes.has('TextLine')) {
      return { label: 'Text / CSV', Icon: TextAlignLeftRegular, color: 'var(--er-success)', bg: 'var(--er-success-soft)' };
    }
  }
  if (et === 'TextSequence' || et === 'TextLine') {
    return { label: 'Text', Icon: TextAlignLeftRegular, color: 'var(--er-success)', bg: 'var(--er-success-soft)' };
  }
  return { label: et || t.formatTypeFile, Icon: DocumentRegular, color: 'var(--er-success)', bg: 'var(--er-success-soft)' };
}

export function FormatTypeBadge({ rootElement }: { rootElement: any }) {
  const info = detectFormatType(rootElement);
  const inner = unwrapConverterRoot(rootElement);
  const sourceLabel = inner !== rootElement ? detectFormatType(inner).label : null;
  return (
    <span
      title={sourceLabel ? t.pdfConvertedFrom(sourceLabel) : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 4,
        background: info.bg,
        color: info.color,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: 0.5,
        flexShrink: 0,
        border: `1px solid ${info.color}44`,
      }}
    >
      <info.Icon fontSize={14} aria-hidden />
      <span>{info.label}</span>
      {sourceLabel && <span style={{ fontWeight: 500, opacity: 0.8 }}>← {sourceLabel}</span>}
    </span>
  );
}

export function getFormatTypeColor(type: string): string {
  return getFormatTypeThemeColor(type);
}

/** One icon per format element type, in the format's colour (set by the caller). */
const FORMAT_ELEMENT_ICONS: Record<string, FluentIcon> = {
  File: DocumentRegular,
  XMLElement: CodeRegular,
  XMLSequence: ArrowRepeatAllRegular,
  String: TextFontRegular,
  Numeric: NumberSymbolRegular,
  DateTime: CalendarRegular,
  Base64: DocumentDataRegular,
  ExcelFile: DocumentTableRegular,
  ExcelSheet: TableRegular,
  ExcelRange: SelectAllOnRegular,
  ExcelCell: AttachRegular,
  ExcelHeader: PanelTopExpandRegular,
  ExcelFooter: PanelBottomExpandRegular,
  TextSequence: TextAlignLeftRegular,
  TextLine: TextFontRegular,
  WordFile: DocumentTextRegular,
  PDFFile: DocumentPdfRegular,
};

export function FormatElementIcon({ type, fontSize = 14 }: { type: string; fontSize?: number }) {
  // An attribute has no better picture than the `@` the XML itself uses.
  if (type === 'XMLAttribute') return <span className="fmt-attr-glyph" aria-hidden>@</span>;
  const Icon = FORMAT_ELEMENT_ICONS[type] ?? QuestionCircleRegular;
  return <Icon fontSize={fontSize} aria-hidden />;
}
