import type { ERFormatElement, ERFormatElementType } from '../types/format.js';

/**
 * `Data type` as the F&O format designer shows it. Structural components
 * (files, sheets, ranges, sequences) are `Void`; only value-carrying leaves
 * expose a real type.
 */
const dataTypeByElementType: Record<ERFormatElementType, string> = {
  File: 'Void',
  XMLElement: 'Void',
  XMLAttribute: 'String',
  XMLSequence: 'Void',
  String: 'String',
  Numeric: 'Real',
  DateTime: 'DateTime',
  Base64: 'Container',
  ExcelFile: 'Void',
  ExcelSheet: 'Void',
  ExcelRange: 'Void',
  ExcelCell: 'String',
  ExcelHeader: 'Void',
  ExcelFooter: 'Void',
  TextSequence: 'Void',
  TextLine: 'Void',
  WordFile: 'Void',
  PDFFile: 'Void',
  Unknown: 'Void',
};

export function getFormatElementDataType(element: Pick<ERFormatElement, 'elementType'>): string {
  return dataTypeByElementType[element.elementType] ?? 'Void';
}

/**
 * The Excel named range / sheet name an element is bound to. Ranges, cells,
 * headers and footers all store it in the `ExcelRange` attribute; sheets use
 * `ExcelSheetName`.
 */
export function getFormatElementExcelRange(
  element: Pick<ERFormatElement, 'attributes'>,
): string | undefined {
  return element.attributes?.['ExcelRange'] ?? element.attributes?.['ExcelSheetName'];
}
