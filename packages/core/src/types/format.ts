// Format types
import type { ERExpression } from './expressions.js';
import type { ERDatasource } from './mapping.js';

export interface ERFormatVersion {
  id: string;
  dateTime: string;
  description: string;
  number: number;
  format: ERFormat;
}

export interface ERFormat {
  id: string;
  name: string;
  enumDefinitions: ERFormatEnumDefinition[];
  transformations: ERFormatTransformation[];
  rootElement: ERFormatElement;
}

export interface ERFormatEnumDefinition {
  id: string;
  name: string;
  values: ERFormatEnumValue[];
}

export interface ERFormatEnumValue {
  id: string;
  name: string;
}

export interface ERFormatTransformation {
  id: string;
  name: string;
  expressionAsString: string;
  parameterType?: number;
}

// --- Format Elements (hierarchical tree) ---

export type ERFormatElementType =
  | 'File'
  | 'XMLElement'
  | 'XMLAttribute'
  | 'XMLSequence'
  | 'String'
  | 'Numeric'
  | 'DateTime'
  | 'Base64'
  | 'ExcelFile'
  | 'ExcelSheet'
  | 'ExcelRange'
  | 'ExcelCell'
  | 'TextSequence'
  | 'TextLine'
  | 'WordFile'
  | 'PDFFile'
  | 'Unknown';

export interface ERFormatElement {
  id: string;
  name: string;
  elementType: ERFormatElementType;
  encoding?: string;
  maximalLength?: number;
  value?: string;              // constant value for attributes
  transformation?: string;     // GUID ref to transformation
  excludedFromDataSource?: boolean;
  children: ERFormatElement[];
  /** Additional raw attributes from XML for format-specific props */
  attributes: Record<string, string>;
}

// --- Format Mapping ---

export interface ERFormatMappingVersion {
  id: string;
  dateTime: string;
  description: string;
  number: number;
  formatMapping: ERFormatMapping;
}

export interface ERFormatMapping {
  id: string;
  name: string;
  formatId: string;
  formatVersion: string;
  bindings: ERFormatBinding[];
  datasources: ERDatasource[];
}

export interface ERFormatBinding {
  componentId: string;        // GUID ref to format element
  expressionAsString: string;
  propertyName?: string;      // e.g. "Enabled" for conditional visibility
  syntaxVersion?: number;
  expression?: ERExpression;
}
