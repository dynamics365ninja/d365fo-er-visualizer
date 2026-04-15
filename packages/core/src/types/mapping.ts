// Model Mapping types
import type { ERExpression } from './expressions.js';

export interface ERModelMappingVersion {
  id: string;
  dateTime: string;
  description: string;
  number: number;
  mapping: ERModelMapping;
}

export interface ERModelMapping {
  id: string;
  name: string;
  dataContainerDescriptor: string; // root model container name
  modelId: string;       // GUID of referenced data model
  modelName: string;
  modelVersion: string;  // e.g. "{GUID},151"
  bindings: ERBinding[];
  datasources: ERDatasource[];
  validations: ERValidation[];
  pathsToCache: string[];
}

// --- Bindings ---

export interface ERBinding {
  path: string;           // model path, e.g. "TaxTransactions/Values/TaxAmount"
  expressionAsString: string;
  syntaxVersion?: number;
  expression?: ERExpression;
}

// --- Datasources ---

export type ERDatasourceType =
  | 'Table'
  | 'Enum'
  | 'ModelEnum'
  | 'FormatEnum'
  | 'Class'
  | 'Object'
  | 'UserParameter'
  | 'CalculatedField'
  | 'GroupBy'
  | 'Container'
  | 'Join'
  | 'Unknown';

export interface ERDatasource {
  name: string;
  parentPath?: string;     // e.g. "#Annex/$TaxTransDetailsSales/aggregated"
  type: ERDatasourceType;
  label?: string;
  description?: string;
  children: ERDatasource[];

  // Type-specific properties (polymorphic)
  tableInfo?: ERTableDatasource;
  enumInfo?: EREnumDatasource;
  classInfo?: ERClassDatasource;
  userParamInfo?: ERUserParamDatasource;
  calculatedField?: ERCalculatedFieldDatasource;
  groupByInfo?: ERGroupByDatasource;
}

export type EREnumSourceKind = 'Ax' | 'DataModel' | 'Format';

export interface ERTableDatasource {
  tableName: string;
  isCrossCompany?: boolean;
  selectedFields: string[];
}

export interface EREnumDatasource {
  enumName: string;
  isModelEnum: boolean;
  sourceKind: EREnumSourceKind;
  modelGuid?: string;
}

export interface ERClassDatasource {
  className: string;
}

export interface ERUserParamDatasource {
  extendedDataTypeName?: string;
  expressionAsString?: string;
}

export interface ERCalculatedFieldDatasource {
  expressionAsString: string;
  expression?: ERExpression;
}

export interface ERGroupByDatasource {
  listToGroup: string;
  groupedFields: ERGroupedField[];
  aggregations: ERAggregation[];
}

export interface ERGroupedField {
  name: string;
  path: string;
}

export interface ERAggregation {
  name: string;
  path: string;
  function: string; // SUM, COUNT, AVG, MIN, MAX
}

// --- Validations ---

export interface ERValidation {
  path: string;
  conditions: ERValidationRule[];
}

export interface ERValidationRule {
  id: string;
  conditionExpressionAsString: string;
  conditionExpression?: ERExpression;
  messageExpressionAsString: string;
  messageExpression?: ERExpression;
}
