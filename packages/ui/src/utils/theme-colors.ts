export const formatTypeColorVarMap: Record<string, string> = {
  File: 'var(--format-type-file)',
  XMLElement: 'var(--format-type-xml-element)',
  XMLAttribute: 'var(--format-type-xml-attribute)',
  XMLSequence: 'var(--format-type-xml-sequence)',
  String: 'var(--format-type-string)',
  Numeric: 'var(--format-type-numeric)',
  DateTime: 'var(--format-type-datetime)',
  Base64: 'var(--format-type-base64)',
  ExcelFile: 'var(--format-type-file)',
  ExcelSheet: 'var(--format-type-xml-element)',
  ExcelRange: 'var(--format-type-xml-attribute)',
  ExcelCell: 'var(--format-type-excel-cell)',
  ExcelHeader: 'var(--format-type-xml-element)',
  ExcelFooter: 'var(--format-type-xml-element)',
  TextSequence: 'var(--format-type-text-sequence)',
  TextLine: 'var(--format-type-text-line)',
  WordFile: 'var(--format-type-base64)',
  PDFFile: 'var(--format-type-pdf)',
};

export function getFormatTypeThemeColor(type: string): string {
  return formatTypeColorVarMap[type] ?? 'var(--er-text-muted)';
}

export const formatTypeBadgeSurfaceVarMap: Record<string, string> = {
  File: 'var(--er-success-soft)',
  XMLElement: 'var(--er-info-soft)',
  XMLAttribute: 'var(--er-warning-soft)',
  XMLSequence: 'var(--er-model-soft)',
  String: 'var(--er-danger-soft)',
  Numeric: 'var(--er-success-soft)',
  DateTime: 'var(--er-warning-soft)',
  Base64: 'var(--er-info-soft)',
  ExcelFile: 'var(--er-success-soft)',
  ExcelSheet: 'var(--er-info-soft)',
  ExcelRange: 'var(--er-warning-soft)',
  ExcelCell: 'var(--er-info-soft)',
  ExcelHeader: 'var(--er-info-soft)',
  ExcelFooter: 'var(--er-info-soft)',
  TextSequence: 'var(--er-model-soft)',
  TextLine: 'var(--er-danger-soft)',
  WordFile: 'var(--er-info-soft)',
  PDFFile: 'var(--er-danger-soft)',
};

export function getFormatTypeBadgeSurface(type: string): string {
  return formatTypeBadgeSurfaceVarMap[type] ?? 'var(--bg-secondary)';
}