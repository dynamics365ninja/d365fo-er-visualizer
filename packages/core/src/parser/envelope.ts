// The `ERSolutionVersion` envelope: bare-content wrapping for F&O custom-service
// payloads, component kind detection and the shared solution/version metadata.
import type {
  ERSolutionVersion,
  ERSolution,
  ERLabel,
  ERPrerequisites,
  ERPrerequisiteGroup,
} from '../types/common.js';
import { asArray, getAttr, getContents, getContentsArray, parseXmlDocument } from './xml-document.js';
import type { XmlNode } from './xml-document.js';

// ─── Bare content envelope ───

/**
 * Names of ER content roots that F&O's custom-service XML endpoints
 * (`GetEffectiveFormatMappingByID`, `GetModelMappingByID`,
 * `GetDataModelByIDAndRevision`) may return **without** the enclosing
 * `<ERSolutionVersion>` envelope. When we detect one of these at the
 * top level we synthesize a minimal envelope so the existing parser
 * pipeline can proceed.
 *
 * Two tiers:
 *  - **Version-level** roots live directly under `Contents.` in the
 *    envelope (e.g. `ERFormatVersion`).
 *  - **Inner** roots live deeper (e.g. `ERTextFormat` lives under
 *    `ERFormatVersion > Format`). F&O `GetEffectiveFormatMappingByID`
 *    confirmed on EU sandbox returns a bare `ERTextFormat` root.
 */
const BARE_VERSION_ROOTS = new Set([
  'ERFormatMappingVersion',
  'ERFormatVersion',
  'ERModelMappingVersion',
  'ERDataModelVersion',
]);

/** Empty `ERFormatMappingVersion` used when only the format side was returned. */
function emptyFormatMappingVersion(): Record<string, unknown> {
  return {
    '@_DateTime': '',
    '@_Description': '',
    '@_Number': '0',
    '@_ID.': '00000000-0000-0000-0000-000000000000,0',
    Mapping: {
      ERFormatMapping: {
        '@_ID.': '',
        '@_Name': '',
        '@_Format': '',
        '@_FormatVersion': '',
        Binding: { ERFormatBinding: {} },
        Datasource: {},
      },
    },
  };
}

/**
 * True when an `@_Name` hint is a placeholder the F&O browser minted for a
 * component it pulled without a listing row (`DataModel {guid}`,
 * `Format {guid}`, `… (default mapping)`), rather than a real configuration
 * name. Placeholders must not outrank the content root's own `Name`.
 */
function isSyntheticNameHint(hint: string | undefined): boolean {
  if (!hint) return true;
  if (hint.includes('(default mapping)')) return true;
  return /^(DataModel|ModelMapping|Format|Unknown)\s+\{?[0-9a-fA-F-]{36}\}?$/.test(hint.trim());
}

/**
 * Wrap a bare content node in a synthetic `ERSolutionVersion` envelope
 * so `parseSolutionVersion` + `detectComponentKind` can run unchanged.
 * Attribute names mirror F&O's exported XML.
 *
 * Returns null when nothing recognizable is at the top level.
 */
function wrapBareContent(doc: Record<string, unknown>): Record<string, unknown> | null {
  const contents: Record<string, unknown> = Object.create(null);

  // Tier 1 — Version-level roots: insert as-is.
  for (const [key, value] of Object.entries(doc)) {
    if (BARE_VERSION_ROOTS.has(key)) contents[key] = value;
  }

  // Tier 2 — Inner content roots. Each needs to be rewrapped in the
  // corresponding `*Version` node at the correct depth. `ERTextFormat`
  // additionally requires a stub `ERFormatMappingVersion` so the
  // "Format requires both halves" check in `detectComponentKind`
  // still passes — but only if the response doesn't also include a
  // real `ERFormatMapping` (F&O's `GetEffectiveFormatMappingByID`
  // returns both halves as separate fragments inside the same bundle;
  // stubbing first would shadow the real one and drop every binding).
  if (!contents['ERFormatVersion'] && doc['ERTextFormat']) {
    contents['ERFormatVersion'] = {
      '@_DateTime': '',
      '@_Description': '',
      '@_Number': '0',
      '@_ID.': '00000000-0000-0000-0000-000000000000,0',
      Format: { ERTextFormat: doc['ERTextFormat'] },
    };
  }
  if (!contents['ERFormatMappingVersion'] && doc['ERFormatMapping']) {
    contents['ERFormatMappingVersion'] = {
      '@_DateTime': '',
      '@_Description': '',
      '@_Number': '0',
      '@_ID.': '00000000-0000-0000-0000-000000000000,0',
      Mapping: { ERFormatMapping: doc['ERFormatMapping'] },
    };
  }
  // Only stub an empty mapping half when the response carried a
  // format grammar but no mapping fragment at all.
  if (contents['ERFormatVersion'] && !contents['ERFormatMappingVersion']) {
    contents['ERFormatMappingVersion'] = emptyFormatMappingVersion();
  }
  if (!contents['ERDataModelVersion'] && doc['ERModelDefinition']) {
    contents['ERDataModelVersion'] = {
      '@_DateTime': '',
      '@_Description': '',
      '@_Number': '0',
      '@_ID.': '00000000-0000-0000-0000-000000000000,0',
      Model: { ERDataModel: doc['ERModelDefinition'] },
    };
  }
  // F&O `GetDataModelByIDAndRevision` on ac365lab-factory (2026-04)
  // returns the data model under a bare `ERDataModel` root (rather
  // than `ERModelDefinition`). Treat them as equivalent.
  if (!contents['ERDataModelVersion'] && doc['ERDataModel']) {
    contents['ERDataModelVersion'] = {
      '@_DateTime': '',
      '@_Description': '',
      '@_Number': '0',
      '@_ID.': '00000000-0000-0000-0000-000000000000,0',
      Model: { ERDataModel: doc['ERDataModel'] },
    };
  }
  // `GetModelMappingByID` answers with a bare `ERModelMapping` root. When the
  // download also spliced in sibling definitions (as `ERModelMappingVersion`
  // nodes harvested from the other descriptors), both halves must survive:
  // skipping the bare root because a version node already exists silently
  // dropped the very definition F&O resolved. Append it last so
  // `selectVersionNode` still treats it as the primary one.
  if (doc['ERModelMapping']) {
    const bareMappingVersion = {
      '@_DateTime': '',
      '@_Description': '',
      '@_Number': '0',
      '@_ID.': '00000000-0000-0000-0000-000000000000,0',
      Mapping: { ERModelMapping: doc['ERModelMapping'] },
    };
    const existing = contents['ERModelMappingVersion'];
    contents['ERModelMappingVersion'] = existing
      ? [...(Array.isArray(existing) ? existing : [existing]), bareMappingVersion]
      : bareMappingVersion;
  }

  if (Object.keys(contents).length === 0) return null;

  // `GetEffectiveFormatMappingByID` ships the whole label dictionary as an
  // `ERClassList` sibling of the format fragments. Without it `resolveLabel`
  // has no translations and every name renders as a raw `@GER_LABEL:` id.
  const aggregatedLabels: unknown[] = [];
  const classLists = (doc as Record<string, unknown>)['ERClassList'];
  for (const cl of Array.isArray(classLists) ? classLists : classLists ? [classLists] : []) {
    if (!cl || typeof cl !== 'object') continue;
    const clContents =
      (cl as Record<string, unknown>)['Contents.'] ??
      (cl as Record<string, unknown>)['Contents'];
    if (!clContents || typeof clContents !== 'object') continue;
    const labels = (clContents as Record<string, unknown>)['ERLabel'];
    if (!labels) continue;
    for (const lbl of Array.isArray(labels) ? labels : [labels]) {
      aggregatedLabels.push(lbl);
    }
  }

  // Surface the component's *own* Name / Description onto the
  // synthetic `ERSolution` so the UI tab title and designer header
  // don't come out blank. F&O's custom services return only the
  // inner content (ERTextFormat / ERFormatMapping / ERModelDefinition
  // / ERModelMapping) without the enclosing solution envelope, so we
  // pick the name from whichever fragment is present.
  //
  // Order matters:
  //  • The transport-injected `@_Name` hint (= component.configurationName
  //    from the F&O listing, e.g. "Invoice format (CZ)") wins whenever it
  //    looks like a real listing name. It is the only source that knows
  //    WHICH configuration was downloaded. A DERIVED configuration inherits
  //    the base's content verbatim — `GetEffectiveFormatMappingByID` /
  //    `GetDataModelByIDAndRevision` return the *effective* payload, whose
  //    `ERTextFormat.Name` / `ERModelDefinition.Name` is still the BASE
  //    configuration's name — so trusting the element name labelled a
  //    derived configuration after its parent.
  //  • The content roots follow as the fallback for payloads that carry no
  //    hint at all (a bare fragment loaded from disk).
  //  • Synthetic `@_Name` placeholders ("DataModel {guid}", "Format {guid}",
  //    "… (default mapping)") are NOT promoted — the UI mints those when a
  //    dependency is pulled without a listing row, so the element's own name
  //    is the better answer there.
  const rawNameHint = doc['@_Name'] as string | undefined;
  // Only promote the hint when it looks like a real listing name.
  const realNameHint = isSyntheticNameHint(rawNameHint) ? undefined : rawNameHint || undefined;
  const nameHintSources: (string | undefined)[] = [
    realNameHint,
    (doc['ERTextFormat'] as Record<string, unknown> | undefined)?.['@_Name'] as string | undefined,
    (doc['ERFormatMapping'] as Record<string, unknown> | undefined)?.['@_Name'] as string | undefined,
    (doc['ERModelDefinition'] as Record<string, unknown> | undefined)?.['@_Name'] as string | undefined,
    (doc['ERModelMapping'] as Record<string, unknown> | undefined)?.['@_Name'] as string | undefined,
    (doc['ERDataModel'] as Record<string, unknown> | undefined)?.['@_Name'] as string | undefined,
    // Absolute last resort: any @_Name hint (including synthetic placeholders).
    rawNameHint,
  ];
  const solutionName = nameHintSources.find(s => typeof s === 'string' && s.length > 0) ?? '';
  const descHintSources: (string | undefined)[] = [
    (doc['ERTextFormat'] as Record<string, unknown> | undefined)?.['@_Description'] as string | undefined,
    (doc['ERFormatMapping'] as Record<string, unknown> | undefined)?.['@_Description'] as string | undefined,
    (doc['ERModelDefinition'] as Record<string, unknown> | undefined)?.['@_Description'] as string | undefined,
    (doc['ERModelMapping'] as Record<string, unknown> | undefined)?.['@_Description'] as string | undefined,
    (doc['ERDataModel'] as Record<string, unknown> | undefined)?.['@_Description'] as string | undefined,
    (doc['@_Description'] as string | undefined),
  ];
  const solutionDesc = descHintSources.find(s => typeof s === 'string' && s.length > 0) ?? '';

  // Pick up an optional version hint from the F&O bundle wrapper
  // (`<ErFnoBundle Version="…">`) so the explorer's version pill and
  // the status-bar chip can show the F&O configuration version even
  // when the inner XML payload doesn't carry a real ERSolutionVersion
  // envelope.
  const versionHintSources: (string | undefined)[] = [
    (doc['@_Version'] as string | undefined),
    (doc['@_PublicVersionNumber'] as string | undefined),
  ];
  const publicVersionNumber = versionHintSources.find(
    s => typeof s === 'string' && s.length > 0,
  ) ?? '';

  // Solution identity. Custom services strip the ERSolution envelope, so the
  // transport forwards the component's own GUID (`SolutionId`) and its
  // inheritance parent (`Base`) on the bundle wrapper; a bare
  // `ERSolutionVersion` fragment inside the bundle may carry `Base` too.
  const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
  const solutionId = asStr(doc['@_SolutionId']) ?? '';
  const baseHint =
    asStr(doc['@_Base']) ??
    asStr((doc['ERSolutionVersion'] as Record<string, unknown> | undefined)?.['@_Base']) ??
    asStr((doc['ERSolution'] as Record<string, unknown> | undefined)?.['@_Base']);

  // Minimal `ERSolutionVersion` envelope. Fields default to empty;
  // `parseSolutionVersion` tolerates missing attrs / ERSolution via its
  // `?? ''` / `?? '0'` fallbacks (except `Missing ERSolution element`,
  // so we inject a bare `ERSolution` too).
  return {
    ERSolutionVersion: {
      '@_DateTime': '',
      '@_Description': solutionDesc,
      '@_Number': '0',
      '@_PublicVersionNumber': publicVersionNumber,
      '@_VersionStatus': '0',
      Solution: {
        ERSolution: {
          '@_ID.': solutionId,
          '@_Name': solutionName,
          '@_Description': solutionDesc,
          ...(baseHint ? { '@_Base': baseHint } : {}),
          Contents: { 'Ref.': [] },
          Labels: {
            ERClassList: {
              Contents: { ERLabel: aggregatedLabels },
            },
          },
          Vendor: { ERVendor: { '@_Name': '', '@_Url': '' } },
        },
      },
      Contents: contents,
      Prerequisites: undefined,
    },
  };
}

export function resolveSolutionRoot(xml: string, filePath: string): XmlNode {
  const doc = parseXmlDocument(xml);
  let root = (doc as Record<string, unknown>)['ERSolutionVersion'];
  if (!root) {
    // F&O custom-service downloads (GetEffectiveFormatMappingByID etc.)
    // can return a bare content node without the ERSolutionVersion
    // envelope. The `fno-client` transport wraps multi-fragment
    // responses in a synthetic `<ErFnoBundle>` wrapper, so unwrap that
    // first, then fall back to plain bare-content detection.
    const bundleNode = (doc as Record<string, unknown>)['ErFnoBundle'];
    const sourceDoc = (bundleNode && typeof bundleNode === 'object'
      ? (bundleNode as Record<string, unknown>)
      : (doc as Record<string, unknown>));
    const wrapped = wrapBareContent(sourceDoc);
    if (wrapped) {
      root = wrapped.ERSolutionVersion;
    }
  }
  if (!root) {
    // Surface the raw XML preview so the operator can see what shape
    // the backend actually returned (F&O custom services can return
    // odd envelopes). The warn is cheap and only fires on the error
    // path, so it's safe to ship.
    const topLevelKeys = Object.keys(doc as Record<string, unknown>);
    const preview = xml.slice(0, 600);
    // eslint-disable-next-line no-console
    console.warn('[er-parser] missing ERSolutionVersion root', {
      filePath,
      topLevelKeys,
      xmlLength: xml.length,
      preview,
    });
    throw new Error(
      `Invalid ER configuration XML: missing ERSolutionVersion root element. ` +
        `Got top-level elements [${topLevelKeys.join(', ') || '<none>'}] in a ${xml.length}-char payload. ` +
        `See DevTools Console "[er-parser]" for a 600-char preview.`,
    );
  }

  return root as XmlNode;
}

// ─── Component Kind Detection ───

export function detectComponentKind(root: XmlNode): string {
  const contents = getContents(root);
  if (!contents) throw new Error('Missing Contents. in ERSolutionVersion');

  // Check Format first: a Format export bundle can include a
  // datasource ERModelMappingVersion alongside its Format halves —
  // that's still a Format component, the embedded mapping is
  // metadata for the format's import datasources.
  if (contents['ERFormatVersion'] && contents['ERFormatMappingVersion']) return 'Format';
  if (contents['ERFormatVersion'] || contents['ERFormatMappingVersion']) {
    throw new Error(
      'Incomplete ER format XML: both ERFormatVersion and ERFormatMappingVersion are required',
    );
  }
  // ModelMapping wins over DataModel when both are present: F&O's
  // `GetModelMappingByID` response bundles `parmModel` (the parent
  // DataModel) and `parmModelMapping` together, but the DataModel was
  // already fetched separately via `GetDataModelByIDAndRevision`. If
  // we returned 'DataModel' here the bundle would be parsed as a
  // duplicate model and the mapping payload would be dropped on the
  // floor.
  if (contents['ERModelMappingVersion']) return 'ModelMapping';
  if (contents['ERDataModelVersion']) return 'DataModel';

  throw new Error('Cannot detect ER component type from XML structure');
}

// ─── Solution Version (shared envelope) ───

export function parseSolutionVersion(root: XmlNode): ERSolutionVersion {
  const solNode = root['Solution']?.['ERSolution'];

  return {
    dateTime: getAttr(root, 'DateTime') ?? '',
    description: getAttr(root, 'Description') ?? '',
    number: parseInt(getAttr(root, 'Number') ?? '0', 10),
    publicVersionNumber: getAttr(root, 'PublicVersionNumber') ?? '',
    versionStatus: parseInt(getAttr(root, 'VersionStatus') ?? '0', 10),
    prerequisites: parsePrerequisites(root['Prerequisites']),
    solution: parseSolution(solNode),
  };
}

function parseSolution(node: XmlNode | undefined): ERSolution {
  if (!node) throw new Error('Missing ERSolution element');

  // F&O splits the label dictionary into one ERClassList per language pack,
  // so `Labels` can hold an array — flatten all of them into one table.
  const labels: ERLabel[] = asArray(node['Labels']?.['ERClassList'])
    .flatMap((classList: any) => getContentsArray(classList, 'ERLabel'))
    .map((l: any) => ({
      labelId: getAttr(l, 'LabelId') ?? '',
      labelValue: getAttr(l, 'LabelValue') ?? '',
      languageId: getAttr(l, 'LanguageId') ?? '',
    }));

  const vendorNode = node['Vendor']?.['ERVendor'];
  const contentRefNode = getContents(node);
  const refNode = asArray(contentRefNode?.['Ref.'])[0];

  return {
    id: getAttr(node, 'ID.') ?? '',
    name: getAttr(node, 'Name') ?? '',
    description: getAttr(node, 'Description'),
    baseSolutionId: parseBaseId(getAttr(node, 'Base')),
    baseVersion: parseBaseVersion(getAttr(node, 'Base')),
    baseName: getAttr(node, 'BaseName.o.'),
    labels,
    vendor: {
      name: getAttr(vendorNode, 'Name') ?? '',
      url: getAttr(vendorNode, 'Url') ?? '',
    },
    contentRefId: getAttr(refNode, 'ID.') ?? '',
  };
}

function parseBaseId(base: string | undefined): string | undefined {
  if (!base) return undefined;
  const match = base.match(/^\{[^}]+\}/);
  if (match) return match[0];
  // Tolerate a bare GUID without braces (seen in F&O custom-service payloads).
  const bare = base.match(/^[0-9a-fA-F-]{36}/);
  return bare ? `{${bare[0]}}` : undefined;
}

function parseBaseVersion(base: string | undefined): number | undefined {
  if (!base) return undefined;
  const match = base.match(/,(\d+)$/);
  return match ? parseInt(match[1], 10) : undefined;
}

function getNodeVersionId(node: XmlNode | undefined): string | undefined {
  const idAttr = getAttr(node, 'ID.');
  return idAttr?.split(',')[0];
}

function getSolutionContentRefIds(root: XmlNode | undefined): string[] {
  const solutionNode = root?.['Solution']?.['ERSolution'];
  const contentRefs = asArray(getContents(solutionNode)?.['Ref.']);
  return contentRefs
    .map(ref => getAttr(ref, 'ID.'))
    .filter((id): id is string => Boolean(id))
    .map(id => id.split(',')[0]);
}

export function selectVersionNode(root: XmlNode, elementName: string): XmlNode | undefined {
  const contents = getContents(root);
  const nodes = asArray(contents?.[elementName]);

  if (nodes.length === 0) {
    return undefined;
  }

  const refIds = new Set(getSolutionContentRefIds(root));
  if (refIds.size > 0) {
    const referencedNode = nodes.find(node => {
      const versionId = getNodeVersionId(node);
      return versionId ? refIds.has(versionId) : false;
    });
    if (referencedNode) {
      return referencedNode;
    }
  }

  return nodes[nodes.length - 1];
}

function parsePrerequisites(node: XmlNode | undefined): ERPrerequisites | undefined {
  if (!node) return undefined;
  const erPrereq = node['ERPrerequisites'];
  if (!erPrereq) return undefined;

  const groups: ERPrerequisiteGroup[] = getContentsArray(erPrereq, 'ERPrerequisiteGroup').map(
    (g: any) => ({
      name: getAttr(g, 'Name') ?? '',
      type: getAttr(g, 'Type') ? parseInt(getAttr(g, 'Type')!, 10) : undefined,
      components: getContentsArray(g, 'ERPrerequisiteComponent').map((c: any) => ({
        id: getAttr(c, 'Id') ?? '',
        version: getAttr(c, 'Version'),
        isImplementation: getAttr(c, 'IsImplementation') === '1',
        type: getAttr(c, 'Type') ? parseInt(getAttr(c, 'Type')!, 10) : undefined,
      })),
    }),
  );

  return { groups };
}

export function selectReferencedVersionNodes(root: XmlNode, elementName: string): XmlNode[] {
  const contents = getContents(root);
  const nodes = asArray(contents?.[elementName]);

  if (nodes.length === 0) return [];

  const refIds = new Set(getSolutionContentRefIds(root));
  if (refIds.size === 0) return nodes;

  const referencedNodes = nodes.filter(node => {
    const versionId = getNodeVersionId(node);
    return versionId ? refIds.has(versionId) : false;
  });

  return referencedNodes.length > 0 ? referencedNodes : nodes;
}
