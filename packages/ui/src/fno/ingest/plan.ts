/**
 * Decide what a "Load selected" run fetches beyond what the user ticked: the
 * DataModel each selected Format / ModelMapping lives under.
 */

import type { ErConfigSummary } from '@er-visualizer/fno-client';
import { componentKey } from './shared';
import type { FnoIngestRequest } from './types';

/**
 * The selection plus the DataModels it depends on, keyed by `componentKey`.
 * Empty when nothing is selected.
 */
export function planIngest(
  request: Pick<FnoIngestRequest, 'selected' | 'allDataModelsSeen' | 'solutions' | 'rootComponentCache'>,
): Map<string, ErConfigSummary> {
  const { selected, allDataModelsSeen, solutions, rootComponentCache } = request;
  // Iterate the accumulated selection map directly — items queued at
  // other drill levels are no longer in `filteredComponents` but must
  // still be downloaded.
  const toLoad = Array.from(selected.values());
  if (toLoad.length === 0) return new Map();
  // Auto-include *every* DataModel ancestor for each selected
  // Format / ModelMapping. The ER tree nests Formats under one or
  // more DataModels (root → derived → …) and every intermediate
  // model is needed to resolve inherited bindings. We captured the
  // chain during drill navigation as `ancestorDataModelGuids` on
  // each listed component and now resolve those GUIDs back to
  // downloadable summaries via `allDataModelsSeen`.
  const augmented = new Map(selected);
  const resolveByGuid = (guid: string): ErConfigSummary | undefined => {
    for (const m of allDataModelsSeen.values()) {
      if (m.configurationGuid === guid || m.revisionGuid === guid) return m;
    }
    return undefined;
  };
  for (const c of toLoad) {
    // If the user picked a DataModel explicitly, don't second-guess
    // them, but we still pull ancestors above it below via the
    // parentDataModelGuid path.
    const ancestorGuids = c.ancestorDataModelGuids ?? [];
    // Only include the NEAREST (immediate parent) DataModel — not the
    // entire ancestor chain. For derived formats we want just the derived
    // model, not the base one. The nearest parent is the last element.
    if (ancestorGuids.length > 0) {
      const nearestGuid = ancestorGuids[ancestorGuids.length - 1];
      const model = resolveByGuid(nearestGuid);
      if (model && (model.configurationGuid || model.revisionGuid)) {
        // Only add this ancestor if its name matches the component's solutionName.
        // When browsing via rootSolutionName the nearest GUID-bearing ancestor
        // is the base DataModel — but the format's solutionName may refer to a
        // derived DataModel. Skip it; the name-based fallback below resolves
        // the correct derived DM.
        const solutionName = c.solutionName ?? '';
        const matchesSolutionName =
          !solutionName ||
          model.configurationName === solutionName ||
          model.solutionName === solutionName;
        if (matchesSolutionName) {
          const key = componentKey(model);
          if (!augmented.has(key)) augmented.set(key, model);
        }
      }
    }
    // Backstop for older component objects (without ancestor list)
    // that only have parentDataModelGuid set.
    if (ancestorGuids.length === 0) {
      const nearest = resolveByGuid(c.parentDataModelGuid ?? '')
        ?? resolveByGuid(c.parentDataModelRevisionGuid ?? '');
      if (nearest && (nearest.configurationGuid || nearest.revisionGuid)) {
        const solutionName = c.solutionName ?? '';
        const matchesSolutionName =
          !solutionName ||
          nearest.configurationName === solutionName ||
          nearest.solutionName === solutionName;
        if (matchesSolutionName) {
          const key = componentKey(nearest);
          if (!augmented.has(key)) augmented.set(key, nearest);
        }
      }
    }
  }
  // ── Name-based DataModel fallback ──
  // For import formats (and any Format/ModelMapping whose parent
  // DataModel has no GUID in the listing), the GUID-based paths above
  // leave nothing in `augmented`. Use the component's `solutionName`
  // as the root DataModel's configuration name and look it up in
  // `allDataModelsSeen`. If found (even with a potentially wrong
  // GUID from `findAnyGuid`), include it — a wrong GUID will silently
  // return 200-empty and be skipped without a toast.
  for (const c of toLoad) {
    if (c.componentType === 'DataModel') continue;
    if (!c.solutionName) continue;
    // Already resolved via GUID path?
    const alreadyHasDm = Array.from(augmented.values()).some(
      a => a.componentType === 'DataModel' &&
        (a.configurationName === c.solutionName || a.solutionName === c.solutionName),
    );
    if (alreadyHasDm) continue;
    // Look up the root DataModel by its configuration name.
    const rootByName = Array.from(allDataModelsSeen.values()).find(
      m => m.configurationName === c.solutionName,
    );
    if (rootByName) {

      augmented.set(componentKey(rootByName), rootByName);
      continue;
    }
    // Also try the rootSolutionName from the solutions list — when the user
    // selected a derived solution the DataModel's configurationName is the root.
    const sol = solutions.find(s => s.solutionName === c.solutionName);
    const rootSolName = sol?.rootSolutionName ?? c.solutionName;
    // Guard: only fall back to the ROOT DataModel when the format's solution does
    // NOT have its own DERIVED DataModel. A derived DataModel exists when a component
    // named c.solutionName appears as a DataModel in any cached listing tree. If such
    // a derived DM exists — even with no GUID — adding the root DataModel here would
    // pull in the base mapping instead. The derived DM GUID is found later via the
    // Format XML synth pass (pendingModelFollowUps).
    const hasDerivedDmInCache = Array.from(rootComponentCache.values()).some(comps =>
      comps.some(
        comp => comp.componentType === 'DataModel' && comp.configurationName === c.solutionName,
      ),
    );
    const rootByRootName = !hasDerivedDmInCache && rootSolName !== c.solutionName
      ? Array.from(allDataModelsSeen.values()).find(m => m.configurationName === rootSolName)
      : undefined;
    if (rootByRootName) {

      augmented.set(componentKey(rootByRootName), rootByRootName);
      continue;
    }
    // Last resort: use referencedModelGuid from the listing API's Base field.
    // This is the ERSolution GUID of the DataModel the format references —
    // valid input for GetDataModelByIDAndRevision even when the DataModel
    // listing row itself carried no GUID. Typical for import formats whose
    // root DataModel was never browsed (allDataModelsSeen is empty).
    if (c.referencedModelGuid) {
      const synthDm: ErConfigSummary = {
        solutionName: rootSolName,
        configurationName: rootSolName,
        componentType: 'DataModel',
        configurationGuid: c.referencedModelGuid,
        hasContent: true,
        // Probe high→low so we always get the latest version.
        versionNumbers: [50, 40, 30, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
      };

      augmented.set(componentKey(synthDm), synthDm);
    }
  }
  return augmented;
}
