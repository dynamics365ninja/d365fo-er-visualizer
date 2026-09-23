// XML Parser: Parses ER configuration XML files into typed objects
import { ERComponentKind } from '../types/common.js';
import type {
  ERSolutionVersion,
  ERConfiguration,
  ERDataModelContent,
  ERModelMappingContent,
  ERFormatContent,
} from '../types/common.js';
import { getContents } from './xml-document.js';
import type { XmlNode } from './xml-document.js';
import { detectComponentKind, parseSolutionVersion, resolveSolutionRoot } from './envelope.js';
import { parseDataModelVersion } from './model.js';
import { parseModelMappingVersion } from './mapping.js';
import { parseFormatVersions } from './format.js';
import { collectParseWarnings } from './warnings.js';

// ─── Public API ───

export function parseERConfiguration(xml: string, filePath: string): ERConfiguration {
  const root = resolveSolutionRoot(xml, filePath);
  const solutionVersion = parseSolutionVersion(root);
  const kind = detectComponentKind(root);
  return buildConfiguration(root, kind, solutionVersion, filePath);
}

/**
 * Same as {@link parseERConfiguration} but splits a bundle that carries both a
 * data model and a model mapping into two configurations instead of dropping
 * the model half. F&O exports a derived model mapping together with its parent
 * `ERDataModelVersion`, and the single-kind detection only kept the mapping.
 *
 * The extra data-model entry gets a derived, deterministic `filePath` so
 * repeated loads of the same bundle replace rather than duplicate it.
 */
export function parseERConfigurations(xml: string, filePath: string): ERConfiguration[] {
  const root = resolveSolutionRoot(xml, filePath);
  const solutionVersion = parseSolutionVersion(root);
  const kind = detectComponentKind(root);
  const primary = buildConfiguration(root, kind, solutionVersion, filePath);

  if (kind !== 'ModelMapping') return [primary];

  const contents = getContents(root);
  if (!contents?.['ERDataModelVersion']) return [primary];

  try {
    const version = parseDataModelVersion(root);
    const modelGuid = version.id.split(',')[0] || version.model.id;
    const model: ERConfiguration = {
      filePath: `${filePath}#datamodel:${modelGuid}`,
      kind: ERComponentKind.DataModel,
      solutionVersion,
      content: { kind: ERComponentKind.DataModel, version },
    };
    return [model, primary];
  } catch {
    // A malformed model half must not cost us the mapping.
    return [primary];
  }
}

/**
 * Parses the content half of one configuration. Non-fatal diagnostics raised
 * along the way are collected and attached as `ERConfiguration.warnings`.
 */
function buildConfiguration(
  root: XmlNode,
  kind: string,
  solutionVersion: ERSolutionVersion,
  filePath: string,
): ERConfiguration {
  const { result: content, warnings } = collectParseWarnings(() => parseContent(root, kind));
  return {
    filePath,
    kind: kind as ERComponentKind,
    solutionVersion,
    content,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function parseContent(
  root: XmlNode,
  kind: string,
): ERDataModelContent | ERModelMappingContent | ERFormatContent {
  switch (kind) {
    case 'DataModel':
      return {
        kind: ERComponentKind.DataModel,
        version: parseDataModelVersion(root),
      };
    case 'ModelMapping':
      return {
        kind: ERComponentKind.ModelMapping,
        version: parseModelMappingVersion(root),
      };
    case 'Format':
      return {
        kind: ERComponentKind.Format,
        ...parseFormatVersions(root),
      };
    default:
      throw new Error(`Unknown ER component kind`);
  }
}

export { asArray, getAttr, getContents, getContentsArray } from './xml-document.js';
