import type { ErConfigSummary } from '@er-visualizer/fno-client';

const ZERO_GUID_LOWER = '00000000-0000-0000-0000-000000000000';

/** True when `guid` is a non-empty, non-zero GUID — i.e. usable as a download parameter. */
export function isUsableGuid(guid: string | undefined): boolean {
  if (!guid) return false;
  return guid.replace(/^\{|\}$/g, '').toLowerCase() !== ZERO_GUID_LOWER;
}

/** Why a listed configuration cannot be queued for download. */
export type FnoUndownloadableReason =
  /** No completed version — F&O serves the effective (completed) one only. */
  | 'draft-only'
  /** A ModelMapping with neither its own id nor a parent DataModel to resolve it through. */
  | 'unreachable-mapping'
  /** No id at all and nothing to derive one from. */
  | 'no-content';

/**
 * Why this configuration cannot be downloaded, or `null` when it can.
 *
 * Kept as a rule of its own because it decides whether the checkbox in the
 * browser is even enabled, and because the draft case is easy to get subtly
 * wrong: a draft-only configuration has a perfectly good id, so every
 * id-based test says "downloadable" while F&O will answer empty.
 */
export function fnoUndownloadableReason(comp: ErConfigSummary): FnoUndownloadableReason | null {
  // Checked first: it holds even when the ids below look fine.
  if (comp.draftOnly) return 'draft-only';
  if (isUsableGuid(comp.revisionGuid) || isUsableGuid(comp.configurationGuid)) return null;
  // A ModelMapping row from `getFormatSolutionsSubHierarchy` carries no id of
  // its own, but can still be resolved through its parent DataModel — see the
  // (parentDataModelGuid, descriptor) path in `buildDownloadAttempts`.
  if (
    comp.componentType === 'ModelMapping' &&
    (comp.parentDataModelGuid || comp.parentDataModelRevisionGuid)
  ) {
    return null;
  }
  if (comp.componentType === 'ModelMapping') return 'unreachable-mapping';
  return 'no-content';
}

export function isFnoComponentDownloadable(comp: ErConfigSummary): boolean {
  return fnoUndownloadableReason(comp) === null;
}
