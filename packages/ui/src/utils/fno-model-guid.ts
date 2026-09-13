import type { ErConfigSummary } from '@er-visualizer/fno-client';

const ZERO_GUID_LOWER = '00000000-0000-0000-0000-000000000000';

/** Brace-stripped, lowercased form — the shape every GUID comparison here uses. */
export function normalizeGuid(guid: string | undefined): string {
  return (guid ?? '').replace(/^\{|\}$/g, '').toLowerCase();
}

/**
 * True when the configuration inherits directly from its own data model, i.e.
 * the ERSolution it derives from IS that model.
 *
 * This is the one condition under which a `Base=` reference (the inheritance
 * parent, whether read from the listing row or from the downloaded XML) names
 * the data model. A format derived from another format — the usual shape of a
 * localized variant sitting under a base format — inherits from that base
 * FORMAT, so its `Base=` is a format id. Handing such an id to
 * `GetDataModelByIDAndRevision` or to `GetModelMappingByID(_dataModelGuid)`
 * makes F&O answer HTTP 200 with an empty body, which reads as "the model has
 * no own XML" instead of "we asked with the wrong id".
 */
export function inheritsFromOwnDataModel(comp: Pick<ErConfigSummary,
  'parentConfigName' | 'ownerDataModelName'>): boolean {
  const parent = (comp.parentConfigName ?? '').trim();
  const owner = (comp.ownerDataModelName ?? '').trim();
  return parent.length > 0 && parent === owner;
}

/**
 * The data model GUID a scouted configuration actually reveals, or `undefined`
 * when it reveals none.
 *
 * `refs` are the GUID references found in the downloaded XML and `baseOnly`
 * those of them that came from `Base=` alone. An own (`Model=`) reference is
 * always the data model; a `Base=`-only reference is one only for a
 * configuration that sits directly under its model — see
 * {@link inheritsFromOwnDataModel}.
 */
export function scoutedDataModelGuid(
  comp: Pick<ErConfigSummary, 'parentConfigName' | 'ownerDataModelName'>,
  refs: readonly string[] | undefined,
  baseOnly?: ReadonlySet<string>,
): string | undefined {
  const usable = (refs ?? [])
    .map(normalizeGuid)
    .filter(g => g.length > 0 && g !== ZERO_GUID_LOWER);
  if (usable.length === 0) return undefined;
  const own = usable.filter(g => !baseOnly?.has(g));
  if (own.length > 0) return own[0];
  return inheritsFromOwnDataModel(comp) ? usable[0] : undefined;
}
