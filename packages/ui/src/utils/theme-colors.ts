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
  TextSequence: 'var(--format-type-text-sequence)',
  TextLine: 'var(--format-type-text-line)',
  WordFile: 'var(--format-type-base64)',
  PDFFile: 'var(--format-type-pdf)',
};

export function getFormatTypeThemeColor(type: string): string {
  return formatTypeColorVarMap[type] ?? 'var(--text-secondary)';
}

export const formatTypeBadgeSurfaceVarMap: Record<string, string> = {
  File: 'var(--surface-success-bg)',
  XMLElement: 'var(--surface-info-bg)',
  XMLAttribute: 'var(--surface-warning-bg)',
  XMLSequence: 'var(--surface-purple-bg)',
  String: 'var(--surface-danger-bg)',
  Numeric: 'var(--surface-success-bg)',
  DateTime: 'var(--surface-warning-bg)',
  Base64: 'var(--surface-info-bg)',
  ExcelFile: 'var(--surface-success-bg)',
  ExcelSheet: 'var(--surface-info-bg)',
  ExcelRange: 'var(--surface-warning-bg)',
  ExcelCell: 'var(--surface-info-bg)',
  TextSequence: 'var(--surface-purple-bg)',
  TextLine: 'var(--surface-danger-bg)',
  WordFile: 'var(--surface-info-bg)',
  PDFFile: 'var(--surface-danger-bg)',
};

export function getFormatTypeBadgeSurface(type: string): string {
  return formatTypeBadgeSurfaceVarMap[type] ?? 'var(--bg-secondary)';
}