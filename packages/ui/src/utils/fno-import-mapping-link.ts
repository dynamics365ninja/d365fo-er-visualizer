const GUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ZERO_GUID_LOWER = '00000000-0000-0000-0000-000000000000';

/**
 * Bare lowercased GUID out of any of the forms ER uses: `guid`, `{guid}` and
 * `{guid},N` (an id paired with its revision number).
 */
function normalize(guid: string | undefined): string {
  const match = (guid ?? '').match(new RegExp(GUID_BODY, 'i'));
  return match ? match[0].toLowerCase() : '';
}

/**
 * Every format an import mapping declares as its datasource, i.e. the
 * `FormatGUID` of each `<ERImportFormatDatasource/>` in the payload.
 *
 * This is the only link between an import format and the mapping that parses it
 * into the model, and it runs mapping → format: the format's own XML says
 * nothing about it.
 */
export function importFormatGuidsInMapping(xml: string): Set<string> {
  const out = new Set<string>();
  const tagRe = /<ERImportFormatDatasource\b[^>]*\/?>/gi;
  const attrRe = new RegExp(`\\bFormatGUID\\s*=\\s*"\\{?(${GUID_BODY})\\}?"`, 'i');
  for (const [tag] of xml.matchAll(tagRe)) {
    const guid = normalize(tag.match(attrRe)?.[1]);
    if (guid && guid !== ZERO_GUID_LOWER) out.add(guid);
  }
  return out;
}

/** The `<Datasource>` sections of a mapping payload, concatenated. */
function datasourceSections(xml: string): string {
  return (xml.match(/<Datasource[\s>][\s\S]*?<\/Datasource>/gi) ?? []).join('');
}

/**
 * Which of the three model-mapping shapes a payload is. The shape, not the
 * name, is what says whether a mapping can belong to the format being loaded:
 *
 *  - `format-to-model` — the model is filled by an import format
 *    (`ERImportFormatDatasource`). An import format always has one of these on
 *    itself: the format parses the file straight into the model.
 *  - `to-model` — the model definition is filled from other datasources
 *    (AX tables and the like). This is the export side.
 *  - `from-model` — the model definition is empty: the mapping takes an
 *    already-filled model and writes it through transformation formulas into
 *    D365FO datasources. This is the mapping an import format ends in, and it
 *    names no format at all, so no id links it back to one — only the model
 *    and the data container descriptor do.
 */
export type MappingShape = 'format-to-model' | 'to-model' | 'from-model';

export function mappingShape(xml: string): MappingShape {
  if (importFormatGuidsInMapping(xml).size > 0) return 'format-to-model';
  // A filled model definition always defines where each item's value comes
  // from; an empty one has no ValueSource at all.
  return /<ValueSource[\s>]/i.test(datasourceSections(xml)) ? 'to-model' : 'from-model';
}

/**
 * How a downloaded mapping relates to the formats of the current load.
 * `bound` / `other-format` refine `format-to-model` by the format it names.
 */
export type ImportMappingLink = 'bound' | 'other-format' | 'to-model' | 'from-model';

export function importMappingLink(
  xml: string,
  loadedImportFormatGuids: ReadonlySet<string>,
): ImportMappingLink {
  const shape = mappingShape(xml);
  if (shape !== 'format-to-model') return shape;
  for (const guid of importFormatGuidsInMapping(xml)) {
    if (loadedImportFormatGuids.has(guid)) return 'bound';
  }
  return 'other-format';
}

/**
 * Whether a mapping that downloaded fine answers the question for its data
 * model, so the walk over the remaining descriptor probes can stop.
 *
 * Only an import format needs the judgement: a mapping that names a *different*
 * format cannot be its parse step, and an export-side `to-model` mapping is not
 * its mapping either — unless the same load also holds an export format, which
 * is exactly what that mapping is for.
 */
export function mappingSettlesWalk(
  link: ImportMappingLink,
  load: { hasImportFormat: boolean; hasExportFormat: boolean },
): boolean {
  if (!load.hasImportFormat) return true;
  if (link === 'other-format') return false;
  if (link === 'to-model') return load.hasExportFormat;
  return true;
}

interface LoadedConfigLike {
  kind: string;
  solutionVersion?: { solution?: { id?: string } };
  content?: unknown;
}

/**
 * What the workspace holds after the format downloads: the ids an import format
 * can be referenced by, and whether an export format is in the load at all.
 *
 * `ERImportFormatDatasource.FormatGUID` is the inner `ERTextFormat` id — *not*
 * the ERSolution id the listing hands out — so both go in the set, and so does
 * the format-mapping id, because F&O builds differ on which one they write.
 */
export function loadedFormatIdentity(configurations: readonly LoadedConfigLike[]): {
  importGuids: Set<string>;
  hasImportFormat: boolean;
  hasExportFormat: boolean;
} {
  const importGuids = new Set<string>();
  let hasExportFormat = false;
  const add = (guid: string | undefined): void => {
    const lower = normalize(guid);
    if (lower && lower !== ZERO_GUID_LOWER) importGuids.add(lower);
  };
  for (const cfg of configurations) {
    if (cfg.kind !== 'Format') continue;
    const content = cfg.content as {
      direction?: string;
      formatVersion?: { id?: string; format?: { id?: string } };
      formatMappingVersion?: { id?: string };
    } | undefined;
    if (content?.direction !== 'Import') {
      hasExportFormat = true;
      continue;
    }
    add(cfg.solutionVersion?.solution?.id);
    add(content.formatVersion?.id);
    add(content.formatVersion?.format?.id);
    add(content.formatMappingVersion?.id);
  }
  return { importGuids, hasImportFormat: importGuids.size > 0, hasExportFormat };
}
