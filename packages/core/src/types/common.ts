// Common types shared across all ER component types

export interface ERSolutionVersion {
  dateTime: string;
  description: string;
  number: number;
  publicVersionNumber: string;
  versionStatus: number;
  prerequisites?: ERPrerequisites;
  solution: ERSolution;
}

export interface ERPrerequisites {
  groups: ERPrerequisiteGroup[];
}

export interface ERPrerequisiteGroup {
  name: string;
  type?: number;
  components: ERPrerequisiteComponent[];
}

export interface ERPrerequisiteComponent {
  id: string;
  version?: string;
  isImplementation?: boolean;
  type?: number;
}

export interface ERSolution {
  id: string;
  name: string;
  description?: string;
  baseSolutionId?: string;
  baseVersion?: number;
  baseName?: string;
  labels: ERLabel[];
  vendor: ERVendor;
  contentRefId: string;
}

export interface ERLabel {
  labelId: string;
  labelValue: string;
  languageId: string;
}

export interface ERVendor {
  name: string;
  url: string;
}

/** Enum for data model field types */
export enum ERFieldType {
  Boolean = 1,
  Int64 = 3,
  Integer = 4,
  Real = 5,
  String = 6,
  Date = 7,
  Enum = 9,
  Container = 10,
  RecordList = 11,
  Binary = 13,
}

/** The three ER component kinds */
export enum ERComponentKind {
  DataModel = 'DataModel',
  ModelMapping = 'ModelMapping',
  Format = 'Format',
}

/** Direction of data flow */
export enum ERDirection {
  Export = 'Export',
  Import = 'Import',
  Unknown = 'Unknown',
}

/** Version status */
export enum ERVersionStatus {
  Draft = 1,
  Completed = 2,
  Shared = 3,
  Discontinued = 4,
}

/** Loaded configuration file (wrapper) */
export interface ERConfiguration {
  filePath: string;
  kind: ERComponentKind;
  solutionVersion: ERSolutionVersion;
  content: ERDataModelContent | ERModelMappingContent | ERFormatContent;
}

// Forward-declared version types (defined in their own modules)
import type { ERDataModelVersion } from './model.js';
import type { ERModelMappingVersion } from './mapping.js';
import type { ERFormatVersion, ERFormatMappingVersion } from './format.js';

// Content discriminators
export interface ERDataModelContent {
  kind: ERComponentKind.DataModel;
  version: ERDataModelVersion;
}

export interface ERModelMappingContent {
  kind: ERComponentKind.ModelMapping;
  version: ERModelMappingVersion;
}

export interface ERFormatContent {
  kind: ERComponentKind.Format;
  formatVersion: ERFormatVersion;
  formatMappingVersion: ERFormatMappingVersion;
}

// Re-export version types for convenience
export type { ERDataModelVersion } from './model.js';
export type { ERModelMappingVersion } from './mapping.js';
export type { ERFormatVersion, ERFormatMappingVersion } from './format.js';
