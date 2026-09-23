/**
 * The F&O ingest pipeline behind "Load selected": resolves the dependencies of
 * the selected configurations, downloads data models, formats and model
 * mappings in dependency order, resolves inherited labels and reports progress
 * as it goes.
 *
 * UI-independent — see `types.ts` for the contract. The React glue lives in
 * `components/fno/useFnoIngest.ts`.
 */

import type { ErComponentType, ErConfigDownload, ErConfigSummary } from '@er-visualizer/fno-client';
import {
  FnoEmptyContentError,
  extractNameFromPayload,
  isSyntheticComponentName,
  relabelDownload,
} from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { inheritsFromOwnDataModel, normalizeGuid, scoutedDataModelGuid } from '../../utils/fno-model-guid';
import { importMappingLink, loadedFormatIdentity, mappingSettlesWalk, type ImportMappingLink } from '../../utils/fno-import-mapping-link';
import { describeSummary, dumpFnoDebug, recordFnoDebug } from '../debug';
import { resolveInheritedLabels } from './labels';
import { planIngest } from './plan';
import { ZERO_GUID_LOWER, componentKey, descriptorNamesFromContainers } from './shared';
import type { FnoIngestDeps, FnoIngestRequest, FnoIngestResult } from './types';

/**
 * Push a download into the workspace, upgrading placeholder names first.
 *
 * Dependencies resolved by bare GUID are requested under a synthetic
 * `"DataModel {guid}"` name when nothing could name them, which leaves the
 * workspace showing the payload's internal model name ("Invoice") and an
 * unreadable path (`DataModel-fe2349e2-…@224.xml`). Only an *exact* listing
 * match is accepted here: matching by prefix looks tempting ("Invoice" →
 * "Invoice model") but happily picks unrelated siblings such as
 * "Invoice model EMCO - TEST". The reliable naming happens earlier, from the
 * referencing row's `ownerDataModelName`.
 */
export function loadDownloadIntoWorkspace(
  download: ErConfigDownload,
  request: Pick<FnoIngestRequest, 'connection' | 'allDataModelsSeen'>,
  workspace: FnoIngestDeps['workspace'],
): void {
  let final = download;
  if (isSyntheticComponentName(download.source?.configurationName)) {
    const payloadName = extractNameFromPayload(download.xml);
    if (payloadName) {
      const lower = payloadName.toLowerCase();
      const listingMatch = Array.from(request.allDataModelsSeen.values())
        .find(m => (m.configurationName ?? '').toLowerCase() === lower);
      final = relabelDownload(download, {
        envUrl: request.connection.envUrl,
        configurationName: listingMatch?.configurationName ?? payloadName,
        solutionName: listingMatch?.solutionName ?? payloadName,
      });
    }
  }
  workspace.loadXml(final.xml, final.syntheticPath);
}

/**
 * Run one ingest. Never rejects: a failure is reported through `notify` and
 * whatever arrived before it stays loaded. Nothing is fetched when the
 * selection is empty.
 */
export async function runFnoIngest(request: FnoIngestRequest, deps: FnoIngestDeps): Promise<FnoIngestResult> {
  const {
    connection,
    selected,
    allDataModelsSeen,
    rootComponentCache,
    signal: ingestSignal,
  } = request;
  const { client, workspace, progress, notify } = deps;
  const loadDownload = (download: ErConfigDownload) => loadDownloadIntoWorkspace(download, request, workspace);

  const toLoad = Array.from(selected.values());
  if (toLoad.length === 0) return { loaded: 0, skippedEmpty: 0, queued: 0, cancelled: ingestSignal.aborted };
  const augmented = planIngest(request);
  // What the user picked vs. what the pipeline decided to fetch for them —
  // the two differ whenever an ancestor or a mapping is auto-included.
  recordFnoDebug('load-plan', {
    selected: toLoad.map(describeSummary),
    queued: Array.from(augmented.values()).map(describeSummary),
  });
  progress.begin(
    Array.from(augmented.values()).map(c => ({
      key: componentKey(c),
      name: c.configurationName || c.solutionName,
      kind: c.componentType,
      explicit: selected.has(componentKey(c)),
    })),
  );
  // Set a non-empty status immediately so the "Already loaded / Open" button
  // is hidden from the very first moment (fnoIngestStatus gate in LandingPage).
  // Without this, Phase 0 scout downloads run with fnoIngestStatus='', leaving
  // the Open button visible for several seconds while the user has cached configs.
  progress.status(t.fnoStatusPreparing);
  let ok = 0;
  let skippedEmpty = 0;
  let finalToLoad: ErConfigSummary[] = [];
  // Everything below may throw (loadXmlFile rethrows parse failures, the
  // transport may reject). Whatever happens, the ingest overlay must be
  // released — otherwise the landing page stays locked on a stuck dialog.
  try {

    finalToLoad = Array.from(augmented.values());
    // Order: root DataModels first (so downstream imports can resolve
    // references), then ModelMappings, then the rest (Formats).
    finalToLoad.sort((a, b) => {
      const order = (k: ErComponentType) =>
        k === 'DataModel' ? 0 : k === 'ModelMapping' ? 1 : 2;
      return order(a.componentType) - order(b.componentType);
    });

    // Key set of components the user picked explicitly — used to
    // differentiate "real failure on user-selected item" (error toast)
    // from "auto-injected root model had no own XML" (silent skip).
    const explicitKeys = new Set(Array.from(selected.keys()));
    // (ok / skippedEmpty are declared before the try block below)
    // Follow-up queue: DataModel GUIDs extracted from `Model="…"`
    // attributes inside Format / ModelMapping XML. F&O's
    // `getFormatSolutionsSubHierarchy` often returns DataModel rows
    // with only the zero GUID placeholder, so these cross-references
    // inside the downloaded content are the *only* reliable way to
    // discover the real DataModel GUID we can pass to
    // `GetDataModelByIDAndRevision`.
    const pendingModelFollowUps = new Map<string, { guid: string; rev?: number }>();
    // Late-discovered DataModel GUIDs from ModelMapping/Format XML downloaded
    // in the synth pass (passes 3+). Import formats often lack
    // ERFormatMappingVersion.Model in their own XML but the ModelMapping that
    // is synthesised for the same DataModel DOES carry a correct Model= GUID.
    // Harvesting it here lets us download the root DataModel even when passes
    // 1 and 2 couldn't find its GUID.
    const lateModelFollowUps = new Map<string, { guid: string; rev?: number }>();
    // DataModel GUID → real configuration name, harvested from the listing row
    // of the component that referenced it (`ownerDataModelName` is the nearest
    // DataModel ancestor in F&O's hierarchy). The listing exposes no GUIDs for
    // DataModel rows, so this is the only way to name a GUID-only dependency —
    // without it the workspace falls back to the payload's internal model name
    // ("Invoice" instead of the configuration "Invoice model").
    const dmNameHints = new Map<string, { name: string; solutionName: string }>();
    const alreadyLoadedGuids = new Set<string>();
    for (const c of finalToLoad) {
      if (c.componentType === 'DataModel' && c.configurationGuid) {
        alreadyLoadedGuids.add(c.configurationGuid.toLowerCase());
      }
    }

    // Maps DataModel VERSION GUID (from format XML ERModelDataSourceHandler.ModelGuid)
    // → DataModel ERSolution GUID (from listing API `Base` field / referencedModelGuid).
    // WHY: GetModelMappingByID resolves _dataModelGuid via ERSolutionTable.ID;
    // the version GUID isn't there — the ERSolution GUID IS, and resolves correctly.
    const dmVersionToSolutionGuid = new Map<string, string>();

    // Helper: process a single download result, harvest cross-references.
    const harvestRefs = (download: ErConfigDownload) => {
      const refs = download.referencedDataModelGuids ?? [];
      const refRevs = download.referencedDataModelRevisions ?? {};
      const baseOnly = download.referencedBaseOnlyGuids;
      // Capture version GUID → ERSolution GUID mapping from Format downloads.
      // `referencedModelGuid` on a Format component = listing API `Base` field =
      // the ERSolution GUID of the DataModel this format derives from.
      if (download.source.componentType === 'Format') {
        const rawSolGuid = download.source.referencedModelGuid;
        const solGuid = (rawSolGuid ?? '').replace(/^\{|\}$/g, '').toLowerCase();
        if (solGuid && solGuid !== ZERO_GUID_LOWER) {
          for (const guid of refs) {
            const lower = guid.toLowerCase();
            if (lower && lower !== ZERO_GUID_LOWER) {
              dmVersionToSolutionGuid.set(lower, solGuid);
            }
          }
          // Import format XML carries no Base= or Model= → extractReferencedDataModelGuids
          // finds 0 GUIDs. That is by design, not an omission: an export format keeps
          // the model among its own datasources (`ERFormatMapping … Model=`), while an
          // import format is parsed INTO the model by a *separate* ModelMapping
          // configuration that holds the format as its datasource
          // (`ERImportFormatDatasource FormatGUID=`). The pointer runs mapping → format,
          // so no format payload will ever name the model.
          // Use listing API's referencedModelGuid (= ERSolution.Base) as
          // fallback so the synth pass can try GetDataModelByIDAndRevision — but only
          // for a format listed directly under its model, since for a derived format
          // `Base` is the base FORMAT and no data model lives under that id.
          if (refs.length === 0 && !alreadyLoadedGuids.has(solGuid)
            && inheritsFromOwnDataModel(download.source)) {
            if (!pendingModelFollowUps.has(solGuid)) {
              pendingModelFollowUps.set(solGuid, { guid: solGuid, rev: undefined });
            }
          }
        }
      }
      // Determine whether own (Model=) GUIDs exist — if so, Base=-only GUIDs are
      // inheritance parents and must NOT be downloaded as separate DataModels.
      const ownRefs = refs.filter(g => !baseOnly?.has(g.toLowerCase()));
      const hasOwnModelRefs = ownRefs.length > 0;
      // A component that references exactly one own model can lend that model
      // its listing name: `ownerDataModelName` is the DataModel configuration
      // the row lives under, which is precisely the config behind that GUID.
      // With more than one reference the assignment would be ambiguous, so the
      // hint is skipped and the synthetic placeholder stays.
      if (ownRefs.length === 1) {
        const ownerName = download.source.ownerDataModelName?.trim();
        if (ownerName) {
          dmNameHints.set(ownRefs[0].toLowerCase(), {
            name: ownerName,
            solutionName: download.source.solutionName || ownerName,
          });
        }
      }
      const baseNamesTheModel = inheritsFromOwnDataModel(download.source);
      for (const guid of refs) {
        const lower = guid.toLowerCase();
        if (alreadyLoadedGuids.has(lower)) continue;
        // Skip Base=-only GUIDs when the XML already has own Model= references.
        // Base= points to the inheritance parent (base DataModel), which must not
        // be downloaded when we only selected the derived variant. Skip them as
        // well when the parent is not the data model at all — a format derived
        // from another format inherits from that FORMAT, not from a model.
        if (baseOnly?.has(lower) && (hasOwnModelRefs || !baseNamesTheModel)) continue;
        const existing = pendingModelFollowUps.get(lower);
        const rev = refRevs[lower];
        if (!existing || (typeof rev === 'number' && (existing.rev ?? -1) < rev)) {
          pendingModelFollowUps.set(lower, { guid, rev });
        }
      }
    };

    const handleDownloadError = (component: ErConfigSummary, err: unknown) => {
      // A download the user cancelled is no failure worth a toast per item.
      if (ingestSignal?.aborted) return;
      if (err instanceof FnoEmptyContentError) {
        skippedEmpty += 1;
        const wasExplicit = explicitKeys.has(componentKey(component));
        if (wasExplicit) {
          // The toast has to stay short, but a configuration the user picked
          // by hand and did not get deserves the full story somewhere: the
          // error names every id that was probed.
          console.info('[fno-ui] selected component returned no XML', {
            configurationName: component.configurationName,
            componentType: component.componentType,
            solutionName: component.solutionName,
            draftOnly: component.draftOnly ?? false,
            detail: err.message,
          });
          notify({
            kind: 'info',
            // A draft has a fix the user can act on; "no own XML" does not.
            message: component.draftOnly
              ? t.fnoSkippedDraft(component.configurationName)
              : t.fnoSkippedDerived(component.configurationName),
          });
        } else {
          console.info('[fno-ui] auto-included root has no own XML, skipping', component.configurationName);
        }
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      notify({ kind: 'error', message: t.fnoDownloadFailed(component.configurationName, message) });
    };

    // ── Phase 0: mappings that can hand us the model for free ──
    // F&O's listing API returns no GUIDs for DataModel/ModelMapping rows on
    // modern builds. Where a ModelMapping row does carry one,
    // `GetModelMappingByID(mappingGuid)` answers with the DataModel XML too
    // (via parmModel), so including a couple of the model's mappings is a
    // discovery route that costs nothing extra — the mappings are wanted
    // anyway.
    //
    // Downloading sibling *formats* as scouts used to sit here and is gone: a
    // model is in practice either an export model or an import one, and a
    // hybrid is rare. An export format names its model in its own XML, so it
    // never needed a scout; an import format's XML names nothing and neither
    // does any of its siblings'. The scouts therefore paid hundreds of
    // kilobytes each — measured at 12 of a 17-second load — to learn nothing.
    {
      const dmNamesInLoad = new Set(
        finalToLoad
          .filter(c => c.componentType === 'DataModel')
          .flatMap(c => [c.configurationName, c.solutionName].filter(Boolean)),
      );

      for (const fmt of Array.from(selected.values())) {
        if (fmt.componentType !== 'Format') continue;
        // `solutionName` is the ROOT of the listing query — the key the
        // component cache is filled under. `ownerDataModelName` is the nearest
        // DataModel ANCESTOR, i.e. the model this format actually belongs to.
        const listingRootName = fmt.solutionName ?? '';
        const parentDmName = fmt.ownerDataModelName || listingRootName;
        if (!parentDmName || dmNamesInLoad.has(parentDmName)) continue;

        const mmSiblings: ErConfigSummary[] = [];
        for (const [cacheKey, rootComponents] of rootComponentCache) {
          if (cacheKey !== listingRootName) continue;
          for (const c of rootComponents) {
            if (
              c.componentType === 'ModelMapping' &&
              c.configurationGuid &&
              !finalToLoad.some(existing => componentKey(existing) === componentKey(c))
            ) {
              mmSiblings.push(c);
            }
          }
        }
        if (mmSiblings.length > 0) {
          // At most 2 — their download returns the DataModel XML as well.
          for (const mm of mmSiblings.slice(0, 2)) finalToLoad.push(mm);
          dmNamesInLoad.add(parentDmName);
        }
      }
    }

    // ── Phase 1: DataModels (must come first for cross-reference resolution) ──
    const dataModels = finalToLoad.filter(c => c.componentType === 'DataModel');
    const nonDataModels = finalToLoad.filter(c => c.componentType !== 'DataModel');

    // Download DataModels in parallel batches of 4
    const DM_BATCH_SIZE = 2;
    for (let batch = 0; batch < dataModels.length; batch += DM_BATCH_SIZE) {
      const slice = dataModels.slice(batch, batch + DM_BATCH_SIZE);
      progress.status(t.fnoStatusDownloadingDM(Math.min(batch + DM_BATCH_SIZE, dataModels.length)));
      const results = await Promise.allSettled(
        slice.map(async component => {
          const download = await client.downloadConfiguration(connection, component, ingestSignal);
          return { component, download };
        }),
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          loadDownload(result.value.download);
          ok += 1;
          harvestRefs(result.value.download);
        } else {
          const component = slice[results.indexOf(result)];
          handleDownloadError(component, result.reason);
        }
      }
    }

    // Refresh alreadyLoadedGuids with all DataModel GUIDs now in the store.
    // The Phase 0 scout may have identified the DataModel via one revision GUID,
    // while the selected Format XML embeds a DIFFERENT revision GUID for the same
    // DataModel. Without this refresh, harvestRefs would add that second GUID to
    // pendingModelFollowUps and trigger a duplicate DataModel download.
    {
      const freshDmConfigs = workspace.configurations();
      for (const cfg of freshDmConfigs) {
        if (cfg.kind !== 'DataModel') continue;
        const solId = (cfg.solutionVersion?.solution?.id ?? '').replace(/^\{|\}$/g, '').toLowerCase();
        if (solId && solId !== ZERO_GUID_LOWER) alreadyLoadedGuids.add(solId);
        const dmVersionId = ((cfg.content as { version?: { model?: { id?: string } } } | undefined)
          ?.version?.model?.id ?? '').replace(/^\{|\}$/g, '').toLowerCase();
        if (dmVersionId && dmVersionId !== ZERO_GUID_LOWER) alreadyLoadedGuids.add(dmVersionId);
      }
    }

    // ── Phase 2: Downloads + Mapping listing scan run concurrently ──
    // Mapping listing scan runs in parallel with Format/ModelMapping downloads
    // (only queries the listing API). Synth-pass downloads need parsed DM data
    // from the store, so they run after both tasks complete.

    // --- Concurrent task A: download selected Formats + ModelMappings ---
    const downloadSelectedTask = async () => {
      if (nonDataModels.length === 0) return;
      progress.status(t.fnoStatusDownloadingFM(nonDataModels.length));
      const PARALLEL_BATCH_SIZE = 2;
      for (let batch = 0; batch < nonDataModels.length; batch += PARALLEL_BATCH_SIZE) {
        const slice = nonDataModels.slice(batch, batch + PARALLEL_BATCH_SIZE);
        const results = await Promise.allSettled(
          slice.map(async component => {
            const download = await client.downloadConfiguration(connection, component, ingestSignal);
            return { component, download };
          }),
        );
        for (const result of results) {
          if (result.status === 'fulfilled') {
            loadDownload(result.value.download);
            ok += 1;
            harvestRefs(result.value.download);
          } else {
            const component = slice[results.indexOf(result)];
            handleDownloadError(component, result.reason);
          }
        }
      }
      if (pendingModelFollowUps.size > 0) {
        progress.status(t.fnoStatusResolvingDM);
        const followUpEntries = Array.from(pendingModelFollowUps.values());
        const FOLLOW_UP_BATCH_SIZE = 2;
        for (let fub = 0; fub < followUpEntries.length; fub += FOLLOW_UP_BATCH_SIZE) {
          const fuSlice = followUpEntries.slice(fub, fub + FOLLOW_UP_BATCH_SIZE);
          const followUpResults = await Promise.allSettled(
            fuSlice.map(async ({ guid, rev }) => {
              // When we know the exact revision from the XML, probe only that revision.
              // For GUIDs from broad listing-fallback (no revision info), probe high→low
              // so we always get the latest version.
              const versionNumbers = typeof rev === 'number'
                ? [rev]
                : [50, 40, 30, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
              // Try to resolve a real DM name from listing data — enables legacy name-based
              // ops (getRevisionContent etc.) as fallback when GUID-based op returns empty.
              // For import formats, the guid here is the ERSolution GUID from the listing's
              // Base field, not the DataModel version GUID — real name improves hit rate.
              const listingDm = Array.from(allDataModelsSeen.values()).find(
                m => (m.configurationGuid ?? '').replace(/^\{|\}$/g, '').toLowerCase() === guid ||
                     (m.revisionGuid ?? '').replace(/^\{|\}$/g, '').toLowerCase() === guid,
              );
              const dmName = listingDm?.configurationName
                ?? dmNameHints.get(guid.toLowerCase())?.name
                ?? `DataModel ${guid}`;
              const dmSolution = listingDm?.solutionName
                ?? dmNameHints.get(guid.toLowerCase())?.solutionName
                ?? dmName;
              const synth: ErConfigSummary = {
                solutionName: dmSolution,
                configurationName: dmName,
                componentType: 'DataModel',
                configurationGuid: guid,
                hasContent: true,
                version: typeof rev === 'number' ? String(rev) : undefined,
                versionNumbers,
              };
              const download = await client.downloadConfiguration(connection, synth, ingestSignal);
              return { guid, download };
            }),
          );
          for (const result of followUpResults) {
            if (result.status === 'fulfilled') {
              loadDownload(result.value.download);
              ok += 1;
              alreadyLoadedGuids.add(result.value.guid.toLowerCase());
            } else {
              const reason = result.reason;
              if (reason instanceof FnoEmptyContentError) {
                // empty: no own XML
              } else {
                console.warn('[fno-ui] referenced DataModel download failed', reason);
              }
            }
          }
        }
      }
    };

    // --- Concurrent task B: mapping LISTING scan (no downloads yet) ---
    // Only enumerates the hierarchy via listComponents. Actual mapping
    // downloads happen later once parsed DM data is available.
    const alreadyLoadedKeys = new Set(finalToLoad.map(c => componentKey(c)));
    const mappingsToLoad = new Map<string, ErConfigSummary>();
    const visitedScanNames = new Set<string>();
    // DataModel GUIDs discovered during the listing scan (name → configurationGuid).
    // Populated when listComponents returns a DataModel node with a GUID —
    // used in the synth pass to resolve dmByName for derived/customer DataModels.
    const discoveredDmGuidsByName = new Map<string, string>();
    // DataModel names found during the scan that have NO GUID in the listing API.
    // These are derived DataModels whose ERDataModel.ID we need to get via
    // legacy name-based ops.
    const noGuidDmNamesFromScan = new Set<string>();
    const pendingMappingBranchesByDmName = new Map<string, {
      parentDmName: string;
      mappingName: string;
      mappingSolutionName: string;
      mappingVersion: string | undefined;
      /** ERModelMappingTable.Guid from listing — used when DataModel GUID is not yet known. */
      configurationGuid?: string;
      /** ERSolution GUID of the parent DataModel from the listing's Base field. */
      referencedModelGuid?: string;
    }[]>();
    /**
     * ModelMapping configurations listed under each DataModel: every name, and
     * the family roots (a mapping derived from another listed mapping belongs
     * to that family). A descriptor lookup answers with whichever family holds
     * a definition for the container and never says which one it was, so the
     * model's other definitions can only be merged when there is one family.
     */
    const mappingFamiliesByDmName = new Map<string, { names: Set<string>; roots: Set<string> }>();

    const mappingListingScanTask = async () => {
      // Enumerate ModelMapping siblings for loaded DataModels.
      // Only the listing scan (listComponents) runs here — actual
      // mapping downloads require parsed DM data from the store and
      // happen sequentially after both concurrent tasks complete.
    const dmNamesToScan = new Set<string>();
    // Names from explicit / ancestor DataModel summaries.
    for (const c of finalToLoad) {
      if (c.componentType === 'DataModel' && c.configurationName) {
        dmNamesToScan.add(c.configurationName);
      }
    }
    // Names harvested from freshly-loaded model XML (covers the
    // pendingModelFollowUps batch — those start as synthetic
    // `DataModel <guid>` entries with no real name until parsed).
    // IMPORTANT: Only include DataModels whose name matches a format/mapping
    // in the current load. Reading the full store without filtering causes
    // DataModels from *previous* load operations (e.g. "Invoice model" after
    // the user previously loaded that solution) to appear in dmNamesToScan,
    // which triggers listComponents("Invoice model") and downloads "Invoice
    // model mapping" as a spurious second mapping for the derived solution.
    const currentLoadSolutionNames = new Set<string>(
      finalToLoad
        .filter(c => c.componentType === 'Format' || c.componentType === 'ModelMapping')
        .map(c => c.solutionName ?? '')
        .filter(Boolean),
    );
    const loadedConfigs = workspace.configurations();
    for (const cfg of loadedConfigs) {
      if (cfg.kind !== 'DataModel') continue;
      const name = cfg.solutionVersion?.solution?.name;
      if (name && currentLoadSolutionNames.has(name)) dmNamesToScan.add(name);
    }
    // Only scan DataModels that are directly relevant to the selected
    // components — skip browsed-past ancestors to avoid downloading
    // base mappings for derived configurations.
    // For formats whose DataModel is not in finalToLoad (e.g. import formats),
    // add their solutionName so the listing scan finds ModelMapping children.
    // GetModelMappingByID(mappingGuid) returns both the ModelMapping AND the DataModel.
    {
      const dmNamesInLoad = new Set(
        finalToLoad
          .filter(c => c.componentType === 'DataModel')
          .flatMap(c => [c.configurationName, c.solutionName].filter(Boolean)),
      );
      for (const c of finalToLoad) {
        if (c.componentType === 'Format' && c.solutionName && !dmNamesInLoad.has(c.solutionName)) {
          dmNamesToScan.add(c.solutionName);
        }
      }
    }
    // Format children of no-GUID DataModels — collected during the scan and
    // downloaded afterwards to extract the DataModel GUID via Model= attribute.
    const noGuidDmFormatScouts = new Map<string, ErConfigSummary>();
    console.debug('[fno-ui] mappingListingScanTask dmNamesToScan', [...dmNamesToScan]);
    const queue: { name: string; owningDmName: string }[] = Array.from(dmNamesToScan).map(n => ({ name: n, owningDmName: n }));
    while (queue.length > 0) {
      const { name: dmName, owningDmName } = queue.shift()!;
      if (visitedScanNames.has(dmName)) continue;
      visitedScanNames.add(dmName);
      let children: ErConfigSummary[];
      try {
        children = await client.listComponents(connection, dmName, { signal: ingestSignal });
      } catch (err) {
        console.warn('[fno-ui] listComponents failed during mapping scan for', dmName, err);
        continue;
      }
      // Capture the GUID of the root DataModel when it appears as the first element
      // (getFormatSolutionsSubHierarchy includes the query root in its flat output).
      // This is the only place we see the GUID for derived DataModels — the listing
      // of their parent DM returns them without a GUID, but their OWN listing has one.
      if (children.length > 0 && children[0].componentType === 'DataModel' &&
          children[0].configurationName === dmName && children[0].configurationGuid &&
          !discoveredDmGuidsByName.has(dmName)) {
        discoveredDmGuidsByName.set(dmName, children[0].configurationGuid);
      }
      for (const child of children) {
        if (child.componentType === 'DataModel') {
          // Only walk into derived DataModels that are directly relevant
          // (in dmNamesToScan) — avoid recursing into the entire tree
          // which would download base mappings for derived configurations.
          if (child.configurationName && !visitedScanNames.has(child.configurationName)
            && dmNamesToScan.has(child.configurationName)) {
            queue.push({ name: child.configurationName, owningDmName: child.configurationName });
            if (child.configurationGuid) {
              if (!discoveredDmGuidsByName.has(child.configurationName))
                discoveredDmGuidsByName.set(child.configurationName, child.configurationGuid);
            } else {
              // No GUID — track this name for the legacy name-probe retry pass.
              noGuidDmNamesFromScan.add(child.configurationName);
            }
          } else if (child.configurationName && child.configurationGuid
            && !discoveredDmGuidsByName.has(child.configurationName)) {
            // Still record the GUID even if we don't recurse into it.
            discoveredDmGuidsByName.set(child.configurationName, child.configurationGuid);
          }
          continue;
        }
        // Format children of a no-GUID DataModel: collect as scouts for DM GUID extraction.
        // The DM node itself always precedes its DerivedSolutions in the flat DFS list, so
        // noGuidDmNamesFromScan already contains ownerDataModelName by this point.
        if (child.componentType === 'Format' && child.configurationGuid) {
          const ownerDm = child.ownerDataModelName ?? owningDmName;
          if (ownerDm && noGuidDmNamesFromScan.has(ownerDm) && !discoveredDmGuidsByName.has(ownerDm) && !noGuidDmFormatScouts.has(ownerDm)) {
            noGuidDmFormatScouts.set(ownerDm, child);
          }
        }
        if (child.componentType !== 'ModelMapping') continue;
        // Only accept mappings whose ownerDataModelName matches one of
        // the DataModels we're actually downloading. This prevents
        // downloading a derived mapping when a base format is selected
        // (and vice versa). The mapping's model must match the format's model.
        const childOwnerDm = child.ownerDataModelName ?? owningDmName;
        if (!dmNamesToScan.has(childOwnerDm)) continue;
        {
          const families = mappingFamiliesByDmName.get(owningDmName)
            ?? { names: new Set<string>(), roots: new Set<string>() };
          // The listing is depth-first, so a base mapping precedes its derivations.
          if (!child.parentConfigName || !families.names.has(child.parentConfigName)) {
            families.roots.add(child.configurationName);
          }
          families.names.add(child.configurationName);
          mappingFamiliesByDmName.set(owningDmName, families);
        }
        console.debug('[fno-ui] mapping branch found', {
          mappingName: child.configurationName, owningDmName, childOwnerDm,
          hasGuid: !!(child.revisionGuid || child.configurationGuid),
          version: child.version,
        });
        if (!child.revisionGuid && !child.configurationGuid) {
          // No GUID — stash as pending branch; synth pass resolves via descriptor.
          const list = pendingMappingBranchesByDmName.get(owningDmName) ?? [];
          list.push({
            parentDmName: owningDmName,
            mappingName: child.configurationName,
            mappingSolutionName: child.solutionName,
            mappingVersion: child.version,
            referencedModelGuid: child.referencedModelGuid,
          });
          pendingMappingBranchesByDmName.set(owningDmName, list);
          // Drill into mapping branches that have children (derived mappings).
          if (child.hasChildren && child.configurationName && !visitedScanNames.has(child.configurationName)) {
            queue.push({ name: child.configurationName, owningDmName });
          }
          continue;
        }
        // Has a GUID — stash as pending branch with the GUID preserved so the synth
        // pass can use GetModelMappingByID(guid) when the DataModel is not yet known.
        if (alreadyLoadedKeys.has(componentKey(child))) continue;
        const branches = pendingMappingBranchesByDmName.get(owningDmName) ?? [];
        if (!branches.some(b => b.mappingName === child.configurationName)) {
          branches.push({
            parentDmName: owningDmName,
            mappingName: child.configurationName,
            mappingSolutionName: child.solutionName,
            mappingVersion: child.version,
            configurationGuid: child.configurationGuid ?? child.revisionGuid,
            referencedModelGuid: child.referencedModelGuid,
          });
          pendingMappingBranchesByDmName.set(owningDmName, branches);
        }
      }
    }

    // ── Post-scan: extract no-GUID DataModel GUIDs via child format scouts ──
    // For each DataModel with no GUID, we try three escalating approaches:
    // 1. referencedModelGuid on the scout format row (free, from listing Base/ModelID field).
    // 2. Download the format XML and read Model= attributes (extractReferencedDataModelGuids).
    // 3. Probe every non-zero GUID in the format XML with GetDataModelByIDAndRevision
    //    until one succeeds — the first success is the DM GUID.
    for (const [scoutDmName, scoutFormat] of noGuidDmFormatScouts) {
      if (discoveredDmGuidsByName.has(scoutDmName)) continue;

      // Phase 1 — listing row already carries referencedModelGuid (r.Base / r.ModelID).
      // `Base` names the model only for a format listed directly under it; for a
      // format derived from another format it is that base format's id.
      if (scoutFormat.referencedModelGuid && inheritsFromOwnDataModel(scoutFormat)) {
        const lower = normalizeGuid(scoutFormat.referencedModelGuid);
        if (lower && lower !== ZERO_GUID_LOWER) {
          discoveredDmGuidsByName.set(scoutDmName, lower);
          continue;
        }
      }

      // Phase 2 & 3 — download the format XML.
      try {
        const dl = await client.downloadConfiguration(connection, scoutFormat, ingestSignal, { silent: true });

        // Phase 2: standard model-attribute extraction.
        const scoutedGuid = scoutedDataModelGuid(
          scoutFormat,
          dl.referencedDataModelGuids,
          dl.referencedBaseOnlyGuids,
        );
        if (scoutedGuid) discoveredDmGuidsByName.set(scoutDmName, scoutedGuid);

        if (!discoveredDmGuidsByName.has(scoutDmName)) {
          // Phase 3: probe each GUID from the format XML as a potential ERDataModelTable GUID
          // by calling GetModelMappingByID(ZERO, candidateGuid, descriptor).
          const candidateGuids = Array.from(
            new Set(
              (dl.xml.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [])
                .map(g => g.toLowerCase())
                .filter(g => g !== ZERO_GUID_LOWER),
            ),
          );
          const phase3Descriptors = Array.from(
            new Set(
              Array.from(pendingMappingBranchesByDmName.values())
                .flat()
                .map(b => b.mappingName)
                .filter(Boolean)
                .concat(['']),
            ),
          );
          for (const candidateGuid of candidateGuids) {
            if (discoveredDmGuidsByName.has(scoutDmName)) break;
            try {
              const mappingProbe: ErConfigSummary = {
                solutionName: scoutDmName,
                configurationName: scoutDmName,
                componentType: 'ModelMapping',
                parentDataModelGuid: candidateGuid,
                descriptorNameCandidates: phase3Descriptors,
                hasContent: true,
                hasChildren: false,
              };
              await client.downloadConfiguration(connection, mappingProbe, ingestSignal, { silent: true });
              discoveredDmGuidsByName.set(scoutDmName, candidateGuid);
            } catch {
              // Not the DataModel GUID, try next.
            }
          }
          if (!discoveredDmGuidsByName.has(scoutDmName)) {
            // All phases failed. The mapping's ERDataModelTable GUID is not discoverable:
            // - The listing API returns ZERO GUIDs for all ABR-family components
            // - Format XML GUIDs are format-component GUIDs (not the DataModel GUID)
            // - Legacy name-based ops are unavailable in this F&O environment
            // The mapping will be skipped during import.
            console.warn('[fno-ui] scan-scout: DataModel GUID not discoverable — mapping will be skipped', {
              dmName: scoutDmName,
            });
          }
        }
      } catch (err) {
        console.warn('[fno-ui] scan-scout: format download failed', scoutDmName, err);
      }
    }

    // --- Supplementary harvest: ModelMappings from cached root trees ---
    // When the flat tree from listComponents(rootDmName) contains ModelMapping
    // rows, they typically have NO configurationGuid because F&O only attaches
    // GUIDs to *direct* DerivedSolutions. Calling listComponents on the BASE
    // mapping name (e.g. "Tax declaration model mapping") returns its derived
    // variants (CZ, SK, UK …) as direct children — those rows DO carry their
    // ERSolution GUID as ConfigurationGuid, making them downloadable.
    for (const [, rootComponents] of rootComponentCache) {
      // Only process trees that include a DataModel we care about.
      const hasRelevantDm = rootComponents.some(
        c => c.componentType === 'DataModel' && dmNamesToScan.has(c.configurationName ?? ''),
      );
      if (!hasRelevantDm) continue;

      for (const comp of rootComponents) {
        if (comp.componentType !== 'ModelMapping') continue;

        const ownerDmName = comp.ownerDataModelName ?? comp.solutionName ?? '';
        // Only include mappings owned by DataModels we're actually downloading.
        if (!dmNamesToScan.has(ownerDmName)) continue;
        if (comp.configurationGuid || comp.revisionGuid) {
          // Has GUID — stash as pending branch (not mappingsToLoad) so
          // the synth pass downloads only ONE mapping per DataModel.
          if (alreadyLoadedKeys.has(componentKey(comp))) continue;
          const branchList = pendingMappingBranchesByDmName.get(ownerDmName) ?? [];
          if (!branchList.some(b => b.mappingName === comp.configurationName)) {
            branchList.push({
              parentDmName: ownerDmName,
              mappingName: comp.configurationName,
              mappingSolutionName: comp.solutionName,
              mappingVersion: comp.version,
              configurationGuid: comp.configurationGuid ?? comp.revisionGuid,
              referencedModelGuid: comp.referencedModelGuid,
            });
            pendingMappingBranchesByDmName.set(ownerDmName, branchList);
          }
          continue;
        }

        // No GUID. Drill into this base mapping if it has children —
        // derived rows returned at that level expose their own GUIDs.
        if (!comp.hasChildren || !comp.configurationName) continue;
        if (visitedScanNames.has(comp.configurationName)) continue;
        visitedScanNames.add(comp.configurationName);

        let derivedRows: ErConfigSummary[];
        try {
          derivedRows = await client.listComponents(connection, comp.configurationName, { signal: ingestSignal });
        } catch (err) {
          console.warn('[fno-ui] mapping-scan drill into base mapping failed', comp.configurationName, err);
          continue;
        }

        for (const derived of derivedRows) {
          if (derived.componentType !== 'ModelMapping') continue;
          // Strip " mapping" from the mapping name → candidate DM name.
          // e.g. "Derived Tax declaration model mapping (CZ)"
          //    → "Derived Tax declaration model (CZ)"
          const candidateDmName = (derived.configurationName ?? '')
            .replace(/\s+mapping\b/i, '')
            .trim();
          const parentDm =
            Array.from(allDataModelsSeen.values()).find(
              m =>
                dmNamesToScan.has(m.configurationName ?? '') &&
                (m.configurationName === candidateDmName ||
                  m.configurationGuid === derived.parentDataModelGuid),
            ) ??
            Array.from(allDataModelsSeen.values()).find(
              m => dmNamesToScan.has(m.configurationName ?? '') && (m.configurationGuid || m.revisionGuid),
            );

          if (derived.configurationGuid || derived.revisionGuid) {
            // Has GUID — stash as pending branch (not mappingsToLoad).
            if (!alreadyLoadedKeys.has(componentKey(derived))) {
              const branchDmName2 = parentDm?.configurationName ?? candidateDmName;
              // Only include if the owner DM is one we're actually downloading.
              if (!dmNamesToScan.has(branchDmName2)) continue;
              const bList = pendingMappingBranchesByDmName.get(branchDmName2) ?? [];
              if (!bList.some(b => b.mappingName === (derived.configurationName ?? ''))) {
                bList.push({
                  parentDmName: branchDmName2,
                  mappingName: derived.configurationName ?? '',
                  mappingSolutionName: derived.solutionName ?? '',
                  mappingVersion: derived.version,
                  configurationGuid: derived.configurationGuid ?? derived.revisionGuid,
                  referencedModelGuid: derived.referencedModelGuid,
                });
                pendingMappingBranchesByDmName.set(branchDmName2, bList);
              }
            }
          } else {
            // No GUID — add as pending branch only if the candidate DM
            // is one we are actually interested in (present in dmNamesToScan).
            // This prevents SK / base mappings from being queued when the
            // user only selected a CZ format.
            const branchDmName = parentDm?.configurationName ?? candidateDmName;
            if (!branchDmName || !dmNamesToScan.has(branchDmName)) continue;
            const existingBranches = pendingMappingBranchesByDmName.get(branchDmName) ?? [];
            const alreadyPending = existingBranches.some(b => b.mappingName === (derived.configurationName ?? ''));
            if (alreadyPending) continue;
            existingBranches.push({
              parentDmName: branchDmName,
              mappingName: derived.configurationName ?? '',
              mappingSolutionName: derived.solutionName ?? '',
              mappingVersion: derived.version,
              referencedModelGuid: derived.referencedModelGuid,
            });
            pendingMappingBranchesByDmName.set(branchDmName, existingBranches);
          }
        }
      }
    }

    }; // end mappingListingScanTask

    // ── Run listing scan concurrently with Format/ModelMapping downloads ──
    progress.status(t.fnoStatusScanMappings);
    await Promise.all([downloadSelectedTask(), mappingListingScanTask()]);

    // ── Import format: post-download ModelMapping listing scan ──
    // GetEffectiveFormatMappingByID returns only the format XML for import formats.
    // Re-scan DataModels that the concurrent listing scan couldn't see (resolved by
    // the follow-up pass) to discover import ModelMapping children.
    {
      const stripBraces = (g: string | undefined) =>
        (g ?? '').replace(/^\{|\}$/g, '').toLowerCase();
      const nowInStore = workspace.configurations();
      const importDmNamesToScan = new Set<string>();
      for (const fmt of finalToLoad) {
        if (fmt.componentType !== 'Format' || !fmt.referencedModelGuid) continue;
        const rawGuid = stripBraces(fmt.referencedModelGuid);
        if (!rawGuid || rawGuid === ZERO_GUID_LOWER) continue;
        // 1. Prefer the just-downloaded store entry (follow-up pass result).
        const storeDm = nowInStore.find(c => {
          if (c.kind !== 'DataModel') return false;
          const dm = (c.content as ParsedDmContent | undefined)?.version?.model;
          return stripBraces(dm?.id) === rawGuid
            || stripBraces(c.solutionVersion?.solution?.id) === rawGuid;
        });
        const dmName = storeDm?.solutionVersion?.solution?.name
          ?? Array.from(allDataModelsSeen.values()).find(
              m => stripBraces(m.configurationGuid) === rawGuid
                || stripBraces(m.revisionGuid) === rawGuid,
            )?.configurationName;
        if (dmName && !visitedScanNames.has(dmName)) {
          importDmNamesToScan.add(dmName);
        }
      }
      for (const dmName of importDmNamesToScan) {
        if (visitedScanNames.has(dmName)) continue;
        visitedScanNames.add(dmName);
        let children: ErConfigSummary[];
        try {
          children = await client.listComponents(connection, dmName, { signal: ingestSignal });
        } catch (err) {
          console.warn('[fno-ui] import format DM scan failed', dmName, err);
          continue;
        }
        for (const child of children) {
          if (child.componentType !== 'ModelMapping') continue;
          if (!child.configurationGuid && !child.revisionGuid) continue;
          if (alreadyLoadedKeys.has(componentKey(child))) continue;
          // Add as pending branch — the synth pass (already built) won't see these,
          // so push directly into mappingsToLoad for immediate download.
          const dkey = componentKey(child);
          if (!mappingsToLoad.has(dkey)) {
            mappingsToLoad.set(dkey, {
              ...child,
              configurationGuid: child.configurationGuid ?? child.revisionGuid,
            });
          }
        }
      }
    }

    // ── Synth pass: needs parsed DM data from store, runs sequentially ──

    // ── Synthesized ModelMapping fetches via the X++ AOT fallback ──
    progress.status(t.fnoStatusDownloadingMM);
    //
    // Per X++ source (ERConfigurationStorageService.getModelMappingByID,
    // confirmed against the D365FO VM), the second resolution branch
    // selects the **default** ModelMapping for a given DataModel:
    //
    //   var dmTable = ERDataModelTable::findByGUID(_dataModelGuid);
    //   var selector = ERModelMappingTableSelector::constructByModel(
    //       dmTable,
    //       ERDataContainerDescriptorTable::findByName(
    //           dmTable.recID, _dataContainerDescriptorName).RecId);
    //   mappingTable = selector.getModelMapping();
    //
    // `getFormatSolutionsSubHierarchy` cannot list ModelMappings
    // (its WHERE clause filters strictly on ERSolutionTable.Base —
    // ModelMappings live in a separate table), so the listing scan
    // above will miss every standalone mapping. To compensate, for
    // every DataModel we know the GUID of, we synthesize a
    // ModelMapping summary and let `buildDownloadAttempts` invoke
    // the (parent-DM, descriptor name) fallback path. Descriptor
    // name guesses are: empty (default container), DataModel name.
    const synthesizedMappingKeys = new Set<string>();
    // Aggregate every DataModel GUID we know — three sources, in order
    // of trust:
    //   1. Selected / discovered summaries that already carry a GUID
    //      (rare with `getFormatSolutionsSubHierarchy` but possible
    //      for older F&O versions that surface FormatMappingGUID).
    //   2. The freshly-parsed `ERDataModel.id` GUID of every DataModel
    //      configuration that landed in the workspace store during
    //      this Load action — this is the *primary* source on modern
    //      F&O builds, because the listing API never returns DM GUIDs
    //      but the parsed XML payload always does.
    //   3. The cross-references we harvested from Format / mapping
    //      XML (`pendingModelFollowUps`).
    interface DmSynthCandidate {
      guid: string;
      name: string;
      solutionName: string;
      /** Container/descriptor names harvested from parsed model XML. */
      descriptorNames: string[];
      /**
       * ERSolution GUID of this DataModel (from the listing API `Base` field on
       * formats that reference it). Distinct from `guid` which is the DataModel
       * VERSION GUID (from inside the XML). Used as a second `_dataModelGuid`
       * candidate for `GetModelMappingByID` so F&O can resolve the country-
       * specific mapping instead of falling back to the global default.
       */
      solutionGuid?: string;
    }
    const dmGuidIndex = new Map<string, DmSynthCandidate>();
    const recordDm = (
      guid: string | undefined,
      name: string,
      solutionName?: string,
      descriptorNames?: string[],
      solutionGuid?: string,
    ): void => {
      if (!guid) return;
      const lower = normalizeGuid(guid);
      if (!lower || lower === ZERO_GUID_LOWER) return;
      const existing = dmGuidIndex.get(lower);
      if (existing) {
        // Merge descriptor names if a later source has more.
        if (descriptorNames && descriptorNames.length > 0) {
          const merged = new Set(existing.descriptorNames);
          for (const d of descriptorNames) merged.add(d);
          existing.descriptorNames = Array.from(merged);
        }
        // Prefer a real human-readable name over a synthetic
        // `DataModel <guid>` placeholder.
        if (
          existing.name.startsWith('DataModel ') &&
          !name.startsWith('DataModel ')
        ) {
          existing.name = name;
        }
        // Record the ERSolution GUID if not yet known.
        if (solutionGuid && !existing.solutionGuid) {
          existing.solutionGuid = solutionGuid;
        }
        return;
      }
      dmGuidIndex.set(lower, {
        guid: lower, // store normalized form so downstream paths match
        name,
        solutionName: solutionName ?? '<referenced>',
        descriptorNames: descriptorNames ?? [],
        solutionGuid,
      });
    };
    for (const c of finalToLoad) {
      if (c.componentType === 'DataModel') {
        recordDm(c.configurationGuid, c.configurationName, c.solutionName);
        recordDm(c.revisionGuid, c.configurationName, c.solutionName);
      }
    }
    for (const m of allDataModelsSeen.values()) {
      recordDm(m.configurationGuid, m.configurationName, m.solutionName);
      recordDm(m.revisionGuid, m.configurationName, m.solutionName);
    }
    // Pick up GUIDs and descriptor names from parsed DataModel XML in the store.
    // Each `ERDataModel.containers[].name` is a valid `_dataContainerDescriptorName`
    // for `getModelMappingByID`.
    type ParsedDmContent = {
      version?: {
        model?: { id?: string; name?: string; containers?: { name?: string; isRoot?: boolean }[] };
      };
    };
    const refreshedConfigs = workspace.configurations();
    const baseGuidsToFetch = new Map<string, { lowerSelf: string; baseGuid: string }>();
    for (const cfg of refreshedConfigs) {
      if (cfg.kind !== 'DataModel') continue;
      const dm = (cfg.content as ParsedDmContent | undefined)?.version?.model;
      const containerNames = descriptorNamesFromContainers(dm?.containers);
      console.debug('[fno-ui] synth-pass recordDm', {
        dmName: dm?.name,
        dmId: dm?.id,
        containerCount: containerNames.length,
        first3: containerNames.slice(0, 3),
      });
      const baseRaw = cfg.solutionVersion?.solution?.baseSolutionId;
      if (dm?.id) {
        const dmVersionLower = normalizeGuid(dm.id);
        // Look up ERSolution GUID for this DataModel version GUID.
        // Primary: from format XML via harvestRefs. Fallback: from listing API entry.
        // Needed so buildDownloadAttempts can pass _dataModelGuid=ERSolutionGUID,
        // which F&O resolves to the country-specific mapping (not the default).
        let dmSolGuid = dmVersionToSolutionGuid.get(dmVersionLower);
        if (!dmSolGuid) {
          const listingEntry = Array.from(allDataModelsSeen.values()).find(
            m => m.configurationName === (dm.name ?? '') && m.configurationGuid,
          );
          if (listingEntry?.configurationGuid) {
            dmSolGuid = listingEntry.configurationGuid;
          }
        }
        recordDm(
          dm.id,
          dm.name ?? cfg.solutionVersion?.solution?.name ?? '<unknown>',
          cfg.solutionVersion?.solution?.name,
          containerNames,
          dmSolGuid,
        );
      }
      // Capture baseSolutionId so we can walk up the inheritance chain
      // (the listing service can't enumerate ancestors). Strip the
      // surrounding `{}` if F&O included them.
      if (baseRaw) {
        const baseGuid = normalizeGuid(baseRaw);
        if (baseGuid && baseGuid !== ZERO_GUID_LOWER && dm?.id) {
          baseGuidsToFetch.set(baseGuid, {
            lowerSelf: normalizeGuid(dm.id),
            baseGuid,
          });
        }
      }
    }
    // Cross-references harvested earlier in this pass.
    for (const { guid } of pendingModelFollowUps.values()) {
      recordDm(guid, `DataModel ${guid}`);
    }
    // ── Scan parsed Format configs for embedded ModelMapping model IDs ──
    // After parsing, cfg.content.embeddedModelMappingVersions[*].mapping.modelId
    // holds the DataModel GUID in structured form (supplements the regex scan).
    type FormatContent = {
      embeddedModelMappingVersions?: Array<{
        mapping?: { modelId?: string; modelVersion?: string };
      }>;
    };
    for (const cfg of refreshedConfigs) {
      if (cfg.kind !== 'Format') continue;
      const fmtContent = cfg.content as FormatContent | undefined;
      for (const mmv of fmtContent?.embeddedModelMappingVersions ?? []) {
        const modelId = (mmv?.mapping?.modelId ?? '').replace(/^\{|\}$/g, '').toLowerCase();
        if (modelId && modelId !== ZERO_GUID_LOWER) {
          recordDm(modelId, `DataModel ${modelId}`);
        }
        const modelVersionRaw = mmv?.mapping?.modelVersion ?? '';
        const modelVersion = modelVersionRaw.split(',')[0].replace(/^\{|\}$/g, '').toLowerCase();
        if (modelVersion && modelVersion !== ZERO_GUID_LOWER) {
          recordDm(modelVersion, `DataModel ${modelVersion}`);
        }
      }
    }
    // Register base-solution GUIDs in dmGuidIndex for mapping resolution
    // but do NOT download/load the ancestor DataModel XML — for derived
    // configs we only want the derived model, not the entire ancestor chain.
    // ERSolution.Base on a Format (or DM XML Base=) points to parent DataModel's GUID.
    const ancestorVisited = new Set<string>();
    const ancestorQueue = Array.from(baseGuidsToFetch.values()).map(b => b.baseGuid);
    for (const cfg of refreshedConfigs) {
      if (cfg.kind !== 'Format') continue;
      const baseRaw = cfg.solutionVersion?.solution?.baseSolutionId;
      if (!baseRaw) continue;
      const baseGuid = normalizeGuid(baseRaw);
      if (baseGuid && baseGuid !== ZERO_GUID_LOWER && !dmGuidIndex.has(baseGuid)) {
        ancestorQueue.push(baseGuid);
      }
    }
    // Only register ancestor GUIDs in the index (for mapping descriptor
    // resolution) — skip actual download of base DataModels.
    for (const baseGuid of ancestorQueue) {
      if (ancestorVisited.has(baseGuid)) continue;
      ancestorVisited.add(baseGuid);
      if (dmGuidIndex.has(baseGuid)) continue;
      // Register the base GUID so mapping synth pass can reference it,
      // but don't download it.
      recordDm(baseGuid, `DataModel ${baseGuid}`);
    }
    const dmByName = new Map<string, DmSynthCandidate>();
    for (const dm of dmGuidIndex.values()) {
      if (!dm.name.startsWith('DataModel ')) {
        dmByName.set(dm.name, dm);
      }
    }

    // Name-based DataModel probe: last resort when dmGuidIndex is empty and
    // the listing API never exposed GUIDs for DataModel rows.
    if (dmByName.size === 0 && pendingMappingBranchesByDmName.size > 0) {
      const namesToProbe = new Set<string>();
      for (const branches of pendingMappingBranchesByDmName.values()) {
        for (const b of branches) {
          if (b.parentDmName) namesToProbe.add(b.parentDmName);
        }
      }
      for (const dmName of namesToProbe) {
        const synthDm: ErConfigSummary = {
          solutionName: dmName,
          configurationName: dmName,
          componentType: 'DataModel',
          hasContent: false, // no GUID — will use legacy name-based ops
          versionNumbers: [50, 40, 30, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
        };
        try {
          const download = await client.downloadConfiguration(connection, synthDm, ingestSignal);
          loadDownload(download);
          ok += 1;
          const newestConfigs = workspace.configurations();
          const parsedDm = newestConfigs.find(
            c => c.kind === 'DataModel' &&
              (c.solutionVersion?.solution?.name === dmName ||
               (c.content as ParsedDmContent | undefined)?.version?.model?.name === dmName),
          );
          const dm = (parsedDm?.content as ParsedDmContent | undefined)?.version?.model;
          if (dm?.id) {
            const containerNames = descriptorNamesFromContainers(dm.containers);
            recordDm(dm.id, dm.name ?? dmName, parsedDm?.solutionVersion?.solution?.name, containerNames);
            // Also populate dmByName so the branch-resolution pass below finds it.
            const lower = dm.id.replace(/^\{|\}$/g, '').toLowerCase();
            const candidate = dmGuidIndex.get(lower);
            if (candidate) dmByName.set(dmName, candidate);
          }
        } catch (err) {
          if (!(err instanceof FnoEmptyContentError)) {
            console.warn('[fno-ui] synth-pass: name-based DataModel download failed', dmName, err);
          }
        }
      }
    }
    // ── Populate dmByName from GUIDs captured during the listing scan ──
    // discoveredDmGuidsByName holds configurationGuids for DataModel nodes that appeared
    // as the root of their own listComponents result — F&O includes the root node WITH
    // its GUID in that response. Use these to fill gaps in dmByName.
    for (const [dmName, rawGuid] of discoveredDmGuidsByName) {
      if (dmByName.has(dmName)) continue;
      const lower = rawGuid.replace(/^\{|\}$/g, '').toLowerCase();
      if (!lower || lower === ZERO_GUID_LOWER) continue;
      let candidate = dmGuidIndex.get(lower);
      if (!candidate) {
        // Not in the index yet (DM was not downloaded). Create a stub so the
        // synth pass can at least try GetModelMappingByID with this GUID.
        candidate = { name: dmName, guid: lower, solutionName: dmName, solutionGuid: undefined, descriptorNames: [] };
        dmGuidIndex.set(lower, candidate);
      }
      dmByName.set(dmName, candidate);
    }

    // ── Descriptors the loaded Formats actually bind to ──
    // A Format's `model` datasource names exactly one root container descriptor
    // (`ERModelDataSourceHandler/@DataContainerDescriptorName`). F&O returns a
    // *different* ModelMapping per descriptor, so probing descriptors in DataModel
    // order picks an unrelated mapping — its bindings cover only the paths the two
    // descriptors happen to share, which is why header fields resolved while
    // list/row paths (e.g. `model.InvoiceLines.ItemId`) did not.
    type ParsedFormatContent = {
      formatMappingVersion?: {
        formatMapping?: {
          datasources?: {
            modelInfo?: { dataContainerDescriptorName?: string; modelGuid?: string };
          }[];
        };
      };
    };
    /** DataModel GUID (normalized, `''` when unknown) → descriptor names. */
    const formatDescriptorsByDmGuid = new Map<string, string[]>();
    for (const cfg of workspace.configurations()) {
      if (cfg.kind !== 'Format') continue;
      const datasources =
        (cfg.content as ParsedFormatContent | undefined)?.formatMappingVersion?.formatMapping
          ?.datasources ?? [];
      for (const ds of datasources) {
        const descriptor = ds.modelInfo?.dataContainerDescriptorName?.trim();
        if (!descriptor) continue;
        const key = normalizeGuid(ds.modelInfo?.modelGuid);
        const list = formatDescriptorsByDmGuid.get(key) ?? [];
        if (!list.includes(descriptor)) list.push(descriptor);
        formatDescriptorsByDmGuid.set(key, list);
      }
    }
    /** Descriptors declared by formats for `dmGuid`, plus any with an unknown GUID. */
    const formatDescriptorsFor = (dmGuid: string): string[] => [
      ...new Set([
        ...(formatDescriptorsByDmGuid.get(dmGuid) ?? []),
        ...(formatDescriptorsByDmGuid.get('') ?? []),
      ]),
    ];
    /**
     * Root containers to merge the model's other mapping definitions from —
     * only when the listing shows a single mapping family for the model, i.e.
     * when every definition F&O can answer with belongs to the downloaded one.
     */
    const siblingDescriptorsFor = (dm: DmSynthCandidate, listedAs?: string): string[] | undefined => {
      const families = [listedAs, dm.solutionName, dm.name]
        .map(name => (name ? mappingFamiliesByDmName.get(name) : undefined))
        .find(Boolean);
      return families?.roots.size === 1 ? dm.descriptorNames : undefined;
    };
    console.debug('[fno-ui] format-declared descriptors', [...formatDescriptorsByDmGuid]);

    const synthQueue: { synth: ErConfigSummary; dmGuid: string; label: string }[] = [];

    // ── Resolve pending mapping branches ──
    // Each DataModel key in `pendingMappingBranchesByDmName` gets ONE synthQueue entry.
    // buildDownloadAttempts tries descriptor candidates in order and stops at the
    // first success → F&O returns the effective mapping for this environment.
    const dmGuidsWithResolvedBranch = new Set<string>();
    for (const [dmName, branches] of pendingMappingBranchesByDmName) {
      if (branches.length === 0) continue;

      let ownerDm = dmByName.get(dmName);
      if (!ownerDm) {
        // Fallback: any named DM candidate (F&O resolves inheritance automatically).
        for (const candidate of dmGuidIndex.values()) {
          if (!candidate.name.startsWith('DataModel ')) {
            ownerDm = candidate;
            break;
          }
        }
      }
      if (!ownerDm) {
        // Try ERSolution GUID from any branch's referencedModelGuid.
        const refGuid = branches.find(b => b.referencedModelGuid)?.referencedModelGuid;
        if (refGuid) {
          const lowerRef = refGuid.toLowerCase();
          let synthCandidate = dmGuidIndex.get(lowerRef);
          if (!synthCandidate) {
            synthCandidate = {
              name: dmName,
              guid: lowerRef,
              solutionName: branches[0].mappingSolutionName,
              solutionGuid: undefined,
              descriptorNames: [],
            };
            dmGuidIndex.set(lowerRef, synthCandidate);
          }
          if (!dmByName.has(dmName)) dmByName.set(dmName, synthCandidate);
          ownerDm = synthCandidate;
        }
      }

      if (ownerDm) {
        dmGuidsWithResolvedBranch.add(ownerDm.guid);
        // Identify "derived" branches by name prefix: ownerDm.solutionName comes from
        // the parsed DM XML, while the listing API reports all branches under the root
        // solutionName — so format solutionNames are unreliable here. Derived branches
        // come first → primaryBranch.mappingName → legacy ops download by that name.
        const dmSolLower = (ownerDm.solutionName ?? '').toLowerCase();
        const isBranchDerived = (b: { mappingName?: string }) =>
          Boolean(dmSolLower) && (b.mappingName ?? '').toLowerCase().startsWith(dmSolLower);
        const derivedBranches = branches.filter(b => isBranchDerived(b));
        const otherBranches = branches.filter(b => !isBranchDerived(b));
        const allBranchNames = [...new Set([
          ...derivedBranches.map(b => b.mappingName),
          ...otherBranches.map(b => b.mappingName),
        ].filter((s): s is string => Boolean(s)))];
        const descriptors = [...new Set([
          ...formatDescriptorsFor(ownerDm.guid),
          ...ownerDm.descriptorNames,
          ...allBranchNames,
          '',
        ])];
        console.debug('[fno-ui] synth-pass mapping', {
          dmName, dmSolName: ownerDm.solutionName,
          derivedCount: derivedBranches.length,
          firstDerived: derivedBranches[0]?.mappingName ?? '(none)',
        });
        // primaryBranch.mappingName → configurationName → legacy ops ConfigurationName.
        const primaryBranch = derivedBranches[0]
          ?? branches.find(b => b.configurationGuid)
          ?? branches.reduce((best, b) => {
            const bestV = parseInt(best.mappingVersion ?? '0', 10) || 0;
            const bV = parseInt(b.mappingVersion ?? '0', 10) || 0;
            return bV > bestV ? b : best;
          });
        synthQueue.push({
          synth: {
            solutionName: primaryBranch.mappingSolutionName,
            configurationName: primaryBranch.mappingName,
            componentType: 'ModelMapping',
            configurationGuid: primaryBranch.configurationGuid,
            version: primaryBranch.mappingVersion,
            parentDataModelGuid: ownerDm.guid,
            parentDataModelRevisionGuid: ownerDm.solutionGuid,
            descriptorNameCandidates: descriptors,
            siblingDescriptorNames: siblingDescriptorsFor(ownerDm, dmName),
            hasContent: true,
          },
          dmGuid: ownerDm.guid,
          label: `mapping (under ${dmName})`,
        });
      } else {
        // DataModel GUID unknown. If any branch has a mapping GUID, use it —
        // GetModelMappingByID(mappingGuid) returns BOTH the mapping AND the DataModel.
        const branchWithGuid = branches.find(b => b.configurationGuid);
        if (branchWithGuid?.configurationGuid) {
          synthQueue.push({
            synth: {
              solutionName: branchWithGuid.mappingSolutionName,
              configurationName: branchWithGuid.mappingName,
              componentType: 'ModelMapping',
              configurationGuid: branchWithGuid.configurationGuid,
              version: branchWithGuid.mappingVersion,
              hasContent: true,
            },
            dmGuid: branchWithGuid.configurationGuid,
            label: `${branchWithGuid.mappingName} (GUID-direct; DataModel unknown)`,
          });
        } else {
          // No GUID at all — brute-force across all known DataModel GUIDs.
          const branchDescriptors = [...new Set(branches.map(b => b.mappingName).filter(Boolean))];
          for (const candidate of dmGuidIndex.values()) {
            synthQueue.push({
              synth: {
                solutionName: branches[0].mappingSolutionName,
                configurationName: `${dmName} mapping (brute-force)`,
                componentType: 'ModelMapping',
                version: branches[0].mappingVersion,
                parentDataModelGuid: candidate.guid,
                parentDataModelRevisionGuid: candidate.solutionGuid,
                descriptorNameCandidates: [...candidate.descriptorNames, ...branchDescriptors],
                hasContent: true,
              },
              dmGuid: candidate.guid,
              label: `${dmName} mapping (brute-force vs ${candidate.guid})`,
            });
            dmGuidsWithResolvedBranch.add(candidate.guid);
          }
        }
      }
    }

    // Suppress default probes for DMs whose mapping was already loaded in Phase 2
    // (user explicitly selected both a Format and its ModelMapping). The listing scan
    // filtered that mapping via alreadyLoadedKeys so pendingMappingBranchesByDmName
    // has no entry for it — without this seed, the default probe would re-download.
    {
      type MmContent = { version?: { mapping?: { modelId?: string } } };
      for (const cfg of workspace.configurations()) {
        if (cfg.kind !== 'ModelMapping') continue;
        const modelId = ((cfg.content as MmContent | undefined)?.version?.mapping?.modelId ?? '')
          .replace(/^\{|\}$/g, '').toLowerCase();
        if (modelId && modelId !== ZERO_GUID_LOWER) dmGuidsWithResolvedBranch.add(modelId);
      }
    }

    // Default mapping probes for DMs without a direct-GUID entry.
    // Only probe DataModels that are actually in finalToLoad (selected +
    // immediate parent) — skip base/ancestor DataModels to avoid
    // downloading their mappings for derived configurations.
    const loadedDmGuids = new Set<string>();
    for (const c of finalToLoad) {
      if (c.componentType === 'DataModel') {
        if (c.configurationGuid) loadedDmGuids.add(normalizeGuid(c.configurationGuid));
        if (c.revisionGuid) loadedDmGuids.add(normalizeGuid(c.revisionGuid));
      }
    }
    // Supplement loadedDmGuids with GUIDs from parsed DataModel XML (Phase 1).
    // finalToLoad entries for DataModels fetched via name-based ops carry no GUID
    // (the listing API returned none), but Phase 1 parsed the XML and populated
    // dmGuidIndex with the real DataModel VERSION GUID (dm.id from the XML content).
    // Without this, the default mapping probe never fires for no-GUID DataModels.
    {
      // Include DataModels from both explicit finalToLoad entries AND Format solutionNames.
      // When Fix 1 prevents the base DM from entering finalToLoad, a derived DataModel
      // is discovered only via Format XML (pendingModelFollowUps) and never appears in
      // finalToLoad. Including Format solutionNames ensures the default probe still fires.
      const currentLoadDmNames = new Set<string>([
        ...finalToLoad
          .filter(c => c.componentType === 'DataModel')
          .flatMap(c => [c.configurationName, c.solutionName].filter((s): s is string => Boolean(s))),
        // Implied DataModel names from selected Format / ModelMapping solutionNames.
        ...finalToLoad
          .filter(c => c.componentType === 'Format' || c.componentType === 'ModelMapping')
          .map(c => c.solutionName ?? '')
          .filter(Boolean),
      ]);
      for (const dm of dmGuidIndex.values()) {
        if (currentLoadDmNames.has(dm.name) || currentLoadDmNames.has(dm.solutionName)) {
          loadedDmGuids.add(dm.guid);
        }
      }
    }
    /** Queue the "default mapping for this DataModel" probe. */
    const pushDefaultProbe = (dm: DmSynthCandidate, reason: string): void => {
      // Use "<solutionName> mapping" as configurationName so buildDownloadAttempts
      // adds it to descriptorCandidates. GetModelMappingByID resolves by exact
      // mapping name; container names do not work as descriptors.
      const defaultMappingName = dm.solutionName ? `${dm.solutionName} mapping` : `${dm.name} (default mapping)`;
      synthQueue.push({
        synth: {
          solutionName: dm.solutionName,
          configurationName: defaultMappingName,
          componentType: 'ModelMapping',
          parentDataModelGuid: dm.guid,
          parentDataModelRevisionGuid: dm.solutionGuid,
          descriptorNameCandidates: [...formatDescriptorsFor(dm.guid), ...dm.descriptorNames],
          siblingDescriptorNames: siblingDescriptorsFor(dm),
          hasContent: true,
        },
        dmGuid: dm.guid,
        label: `default mapping for ${dm.name} (${reason})`,
      });
    };

    for (const dm of dmGuidIndex.values()) {
      if (dmGuidsWithResolvedBranch.has(dm.guid)) continue;
      if (!loadedDmGuids.has(dm.guid)) continue;
      pushDefaultProbe(dm, 'owned');
    }

    // `loadedDmGuids` deliberately narrows the probes to DataModels of this load
    // (so a derived config doesn't drag in its ancestors' mappings). When it
    // matches nothing — the common case for "select a single Format", where the
    // model is only known from GUIDs inside the format XML — that narrowing left
    // the queue empty and the whole mapping phase was skipped in silence.
    // Fall back to every DataModel GUID we know about.
    if (synthQueue.length === 0 && dmGuidIndex.size > 0) {
      for (const dm of dmGuidIndex.values()) {
        if (dmGuidsWithResolvedBranch.has(dm.guid)) continue;
        pushDefaultProbe(dm, 'fallback: no owned DataModel matched');
      }
    }

    console.info('[fno-ui] model-mapping phase inputs', {
      knownDataModelGuids: dmGuidIndex.size,
      ownedDataModelGuids: loadedDmGuids.size,
      pendingMappingBranches: pendingMappingBranchesByDmName.size,
      listedMappings: mappingsToLoad.size,
      queuedProbes: synthQueue.length,
    });

    // Helper: merge newly discovered DataModel GUIDs from a mapping
    // download into `lateModelFollowUps` so the late pass can download them.
    const collectLateRefs = (download: ErConfigDownload): void => {
      const refs = download.referencedDataModelGuids ?? [];
      const refRevs = download.referencedDataModelRevisions ?? {};
      const baseOnly = download.referencedBaseOnlyGuids;
      const ownRefs = refs.filter(g => !baseOnly?.has(g.toLowerCase()));
      const hasOwnModelRefs = ownRefs.length > 0;
      for (const guid of refs) {
        const lower = guid.toLowerCase();
        if (alreadyLoadedGuids.has(lower)) continue;
        if (pendingModelFollowUps.has(lower)) continue; // already scheduled
        if (baseOnly?.has(lower) && hasOwnModelRefs) continue; // skip base-only when own refs exist
        const existing = lateModelFollowUps.get(lower);
        const rev = refRevs[lower];
        if (!existing || (typeof rev === 'number' && (existing.rev ?? -1) < rev)) {
          lateModelFollowUps.set(lower, { guid, rev });
        }
      }
    };

    // Download synthesized mappings and sibling mappings in parallel
    const allMappingDownloads: {
      synth: ErConfigSummary;
      label: string;
      dmGuid?: string;
      /** Marks the DM as resolved on success without being skipped itself. */
      recordDmGuid?: string;
    }[] = [];

    // One probe per format-declared descriptor, deliberately without `dmGuid` so the
    // "first success wins per DataModel" rule cannot drop them: two formats over the
    // same model (e.g. SalesInvoice and InvoiceCustomer) need two different mappings.
    // Queued FIRST and marked exclusive: F&O returns a different mapping per
    // descriptor, so a heuristic probe that falls back to '' or the mapping name
    // resolves to a sibling mapping the loaded formats never bind to.
    for (const dm of dmGuidIndex.values()) {
      for (const descriptor of formatDescriptorsFor(dm.guid)) {
        const synthKey = `format-descriptor-mapping:${dm.guid}:${descriptor}`;
        if (synthesizedMappingKeys.has(synthKey)) continue;
        synthesizedMappingKeys.add(synthKey);
        allMappingDownloads.push({
          synth: {
            solutionName: dm.solutionName,
            configurationName: `${dm.name} mapping (${descriptor})`,
            componentType: 'ModelMapping',
            parentDataModelGuid: dm.guid,
            parentDataModelRevisionGuid: dm.solutionGuid,
            descriptorNameCandidates: [descriptor],
            descriptorNamesExclusive: true,
            // Resolve exactly this descriptor. The model's other definitions
            // are merged only when they can all belong to the same mapping —
            // otherwise they come from unrelated mapping configurations.
            siblingDescriptorNames: siblingDescriptorsFor(dm),
            hasContent: true,
          },
          recordDmGuid: dm.guid,
          label: `mapping for descriptor "${descriptor}" of ${dm.name}`,
        });
      }
    }
    /** Entries above this index are the heuristic fallbacks. */
    const descriptorProbeCount = allMappingDownloads.length;

    for (const item of synthQueue) {
      // Key by (dmGuid + configurationName) so multiple distinct mappings
      // for the same DataModel (e.g. base + CZ) are all downloaded.
      // The default probe is still suppressed via dmGuidsWithResolvedBranch.
      const synthKey = `synth-mapping:${item.dmGuid}:${item.synth.configurationName}`;
          if (synthesizedMappingKeys.has(synthKey)) continue;
      synthesizedMappingKeys.add(synthKey);
      allMappingDownloads.push({ synth: item.synth, label: item.label, dmGuid: item.dmGuid });
    }

    for (const mapping of mappingsToLoad.values()) {
      allMappingDownloads.push({ synth: mapping, label: mapping.configurationName });
    }

    /**
     * Successful mapping downloads, counted independently of
     * `downloadedMappingDmGuids`: entries coming from `mappingsToLoad` carry
     * no `dmGuid`, so the GUID set stays empty even when a mapping *did*
     * load. Gating the retry pass and the "no mapping" warning on the GUID
     * set alone re-ran the whole retry pass and warned about mappings that
     * were already in the workspace.
     *
     * Declared out here because the report below has to run even when not a
     * single probe could be built — the case where the listing found the
     * mappings but exposed no id to ask for them with.
     */
    let mappingSuccessCount = 0;
    // ── Which mapping can be *ours* (matters for import formats) ──
    // Descriptor-name probing is a search, not a lookup: a model can carry a
    // mapping per bank plus an export-side one, and F&O answers whichever
    // descriptor matched. The payload's shape settles it:
    //  • `format-to-model` names its format in `ERImportFormatDatasource`, so a
    //    candidate naming another format cannot be ours and must not end the walk;
    //  • `to-model` (model definition filled from datasources) is the export
    //    side — only useful when an export format is in the load too;
    //  • `from-model` (model definition empty) is where an import format ends:
    //    it writes the filled model into D365FO datasources and names no format
    //    at all, so only the model and the descriptor tie it to ours. Demanding
    //    a format link here would report the right mapping as missing.
    const formatIdentity = loadedFormatIdentity(workspace.configurations());
    /** Set once a mapping that can be ours arrives — gates the retry pass. */
    let usableMappingFound = false;
    /**
     * Whether a downloaded mapping may stop the walk for its DataModel.
     * Also reports what it decided so the attempt log says why a mapping that
     * downloaded fine did not settle the question.
     */
    const judgeMapping = (xml: string): { settles: boolean; link: ImportMappingLink | null } => {
      if (!formatIdentity.hasImportFormat) {
        usableMappingFound = true;
        return { settles: true, link: null };
      }
      const link = importMappingLink(xml, formatIdentity.importGuids);
      const settles = mappingSettlesWalk(link, formatIdentity);
      if (settles) usableMappingFound = true;
      return { settles, link };
    };
    if (allMappingDownloads.length > 0) {
      progress.status(t.fnoStatusDownloadingMMCount(allMappingDownloads.length));
      // Track DM GUIDs for which a mapping was *successfully* downloaded.
      // Once a branch for a given DM GUID returns real XML, all remaining
      // branches for that DM are skipped. Branches that return empty content
      // do NOT mark the DM as resolved so the next branch in a later batch
      // still gets a chance (a base mapping may be empty while the derived
      // mapping for the same DM GUID carries the customer-deployed logic).
      // NOTE: no within-batch DM-GUID dedup — concurrent requests for the
      // same DM are fine because the store deduplicates by solution GUID.
      const downloadedMappingDmGuids = new Set<string>();
      /** Per-attempt outcome, logged as one table when the phase ends. */
      const mappingAttemptLog: Array<{
        label: string;
        dmGuid: string;
        mapping: string;
        outcome: 'ok' | 'empty' | 'error';
        detail?: string;
      }> = [];
      const recordAttempt = (
        item: { synth: ErConfigSummary; label: string; dmGuid?: string },
        outcome: 'ok' | 'empty' | 'error',
        detail?: string,
      ): void => {
        mappingAttemptLog.push({
          label: item.label,
          dmGuid: item.dmGuid ?? item.synth.parentDataModelGuid ?? '(none)',
          mapping: item.synth.configurationGuid ?? '(by descriptor)',
          outcome,
          detail,
        });
      };
      const MAPPING_BATCH_SIZE = 2;
      for (let batch = 0; batch < allMappingDownloads.length; ) {
        // Never mix descriptor probes with fallbacks in one batch — the
        // fallbacks must see the descriptor results before they decide to run.
        const sliceEnd = batch < descriptorProbeCount
          ? Math.min(batch + MAPPING_BATCH_SIZE, descriptorProbeCount)
          : Math.min(batch + MAPPING_BATCH_SIZE, allMappingDownloads.length);
        const slice = allMappingDownloads.slice(batch, sliceEnd);
        batch = sliceEnd;
        // Only skip entries whose DM GUID was resolved (success) in a prior batch.
        const pending = slice.filter(
          item => !item.dmGuid || !downloadedMappingDmGuids.has(item.dmGuid),
        );
        if (pending.length === 0) continue;
        const results = await Promise.allSettled(
          pending.map(async item => {
            const download = await client.downloadConfiguration(connection, item.synth, ingestSignal);
            return { item, download };
          }),
        );
        results.forEach((result, i) => {
          const item = pending[i];
          if (result.status === 'fulfilled') {
            loadDownload(result.value.download);
            ok += 1;
            mappingSuccessCount += 1;
            const verdict = judgeMapping(result.value.download.xml);
            recordAttempt(item, 'ok', verdict.link ?? undefined);
            // Mark DM as resolved so subsequent branches for the same DM are
            // skipped — unless this mapping belongs to a different format, in
            // which case ours may still be behind one of the remaining probes.
            const resolvedDmGuid = result.value.item.dmGuid ?? result.value.item.recordDmGuid;
            if (resolvedDmGuid && verdict.settles) downloadedMappingDmGuids.add(resolvedDmGuid);
            collectLateRefs(result.value.download);
          } else {
            const reason = result.reason;
            if (reason instanceof FnoEmptyContentError) {
              // empty — try next branch for same DM
              recordAttempt(item, 'empty', reason.message);
            } else {
              recordAttempt(item, 'error', reason instanceof Error ? reason.message : String(reason));
              console.warn('[fno-ui] mapping fetch failed', { label: item.label, reason });
            }
          }
        });
      }
      // ── Retry pass: probe unresolved DataModel names when no mapping was found ──
      // Triggered only when ALL initial download attempts failed (downloadedMappingDmGuids
      // is empty). This handles the case where the customer has a DERIVED DataModel
      // registered in F&O under a different GUID than the one we discovered via GUID-scout.
      // For export formats the initial pass usually SUCCEEDS → no retry needed.
      // For import-only formats the initial pass returns empty → retry fires here.
      // Retry also when mappings *did* arrive but every one of them belongs to
      // another format — that is the case the walk exists for.
      if (mappingSuccessCount === 0 || !usableMappingFound) {
        const retryDownloads: { synth: ErConfigSummary; label: string; dmGuid: string }[] = [];
        for (const [dmName, branches] of pendingMappingBranchesByDmName) {
          if (branches.length === 0) continue;
          const resolvedDm = dmByName.get(dmName);

          // Case A: DM was resolved but all mapping attempts returned empty.
          // Try each branch's referencedModelGuid as an alternative _dataModelGuid.
          // For customer-derived DataModels, referencedModelGuid = ERSolution GUID of the
          // derived DM — F&O may resolve it if it stores a GUID alias on ERDataModelTable.
          if (resolvedDm) {
            const altGuids = new Set<string>();
            for (const branch of branches) {
              if (!branch.referencedModelGuid) continue;
              const lower = branch.referencedModelGuid.replace(/^\{|\}$/g, '').toLowerCase();
              if (!lower || lower === ZERO_GUID_LOWER) continue;
              if (lower === resolvedDm.guid) continue;
              if (lower === (resolvedDm.solutionGuid ?? '').toLowerCase()) continue;
              altGuids.add(lower);
            }
            const allBranchNames = [...new Set(branches.map(b => b.mappingName).filter(Boolean))];
            const primaryBranch = branches.find(b => b.configurationGuid) ?? branches[branches.length - 1];

            // Case A: branch referencedModelGuids as alternative DM GUIDs.
            for (const altGuid of altGuids) {
              const retryDescriptors = [...new Set([...allBranchNames, ...resolvedDm.descriptorNames, ''])];
              const retryKey = `synth-retry:${altGuid}`;
              if (synthesizedMappingKeys.has(retryKey)) continue;
              synthesizedMappingKeys.add(retryKey);
              retryDownloads.push({
                synth: {
                  solutionName: primaryBranch.mappingSolutionName,
                  configurationName: primaryBranch.mappingName,
                  componentType: 'ModelMapping',
                  configurationGuid: primaryBranch.configurationGuid,
                  version: primaryBranch.mappingVersion,
                  parentDataModelGuid: altGuid,
                  descriptorNameCandidates: retryDescriptors,
                  hasContent: true,
                },
                dmGuid: altGuid,
                label: `${primaryBranch.mappingName} (retry altGuid ${altGuid} under ${dmName})`,
              });
            }

            // Case D: try DM GUIDs discovered via the post-scan format scout
            // (derived DM GUID found via GetModelMappingByID probing).
            // These are keyed under derived DM names not yet in dmByName, but they
            // may resolve mappings that are listed under the base DM name.
            for (const [discoveredName, discoveredGuid] of discoveredDmGuidsByName) {
              if (discoveredGuid === resolvedDm.guid) continue;
              if (dmByName.has(discoveredName) && dmByName.get(discoveredName)?.guid === discoveredGuid) continue;
              const retryDescriptorsD = [...new Set([...allBranchNames, ...resolvedDm.descriptorNames, ''])];
              const retryKeyD = `synth-retry-d:${discoveredGuid}:${dmName}`;
              if (synthesizedMappingKeys.has(retryKeyD)) continue;
              synthesizedMappingKeys.add(retryKeyD);
              retryDownloads.push({
                synth: {
                  solutionName: primaryBranch.mappingSolutionName,
                  configurationName: primaryBranch.mappingName,
                  componentType: 'ModelMapping',
                  configurationGuid: primaryBranch.configurationGuid,
                  version: primaryBranch.mappingVersion,
                  parentDataModelGuid: discoveredGuid,
                  descriptorNameCandidates: retryDescriptorsD,
                  hasContent: true,
                },
                dmGuid: discoveredGuid,
                label: `${primaryBranch.mappingName} (retry Case D: discovered ${discoveredName} → ${discoveredGuid})`,
              });
            }

            if (altGuids.size > 0 || retryDownloads.some(r => r.label.includes('Case D'))) continue;
          }

          // Case B: DM unresolved — probe by DataModel name via legacy ops.
          const probeSpec: ErConfigSummary = {
            solutionName: dmName,
            configurationName: dmName,
            componentType: 'DataModel',
            hasContent: false, // no GUID → legacy name-based ops
            versionNumbers: [50, 40, 30, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
          };
          let resolvedGuid: string | undefined;
          try {
            const dmDownload = await client.downloadConfiguration(connection, probeSpec, ingestSignal);
            loadDownload(dmDownload);
            ok += 1;
            const newestConfigs = workspace.configurations();
            const parsedDm = newestConfigs.find(
              c => c.kind === 'DataModel' &&
                (c.solutionVersion?.solution?.name === dmName ||
                 (c.content as ParsedDmContent | undefined)?.version?.model?.name === dmName),
            );
            const dm = (parsedDm?.content as ParsedDmContent | undefined)?.version?.model;
            if (dm?.id) {
              const containerNames = descriptorNamesFromContainers(dm.containers);
              recordDm(dm.id, dm.name ?? dmName, parsedDm?.solutionVersion?.solution?.name, containerNames);
              const lower = dm.id.replace(/^\{|\}$/g, '').toLowerCase();
              const candidate = dmGuidIndex.get(lower);
              if (candidate) {
                dmByName.set(dmName, candidate);
                resolvedGuid = candidate.guid;
              }
            }
          } catch (err) {
            if (!(err instanceof FnoEmptyContentError)) {
              console.warn('[fno-ui] synth-retry: DM name-based probe failed', dmName, err);
            }
          }
          if (!resolvedGuid) continue;
          const ownerDm = dmByName.get(dmName);
          if (!ownerDm) continue;
          const seenBranchNames = new Set<string>();
          for (const branch of branches) {
            const bName = branch.mappingName;
            if (seenBranchNames.has(bName)) continue;
            seenBranchNames.add(bName);
            const retryKey = `synth-mapping:${resolvedGuid}:${bName}`;
            if (synthesizedMappingKeys.has(retryKey)) continue;
            synthesizedMappingKeys.add(retryKey);
            const descriptors = (branch.mappingName ? [branch.mappingName] : []).concat(
              ownerDm.descriptorNames.filter(d => d !== branch.mappingName),
              [''],
            );
            retryDownloads.push({
              synth: {
                solutionName: branch.mappingSolutionName,
                configurationName: bName,
                componentType: 'ModelMapping',
                configurationGuid: branch.configurationGuid,
                version: branch.mappingVersion,
                parentDataModelGuid: ownerDm.guid,
                parentDataModelRevisionGuid: ownerDm.solutionGuid,
                descriptorNameCandidates: descriptors,
                hasContent: true,
              },
              dmGuid: resolvedGuid,
              label: `${bName} (retry under ${dmName})`,
            });
          }
        }
        // Case C: probe no-GUID DataModels from allDataModelsSeen via legacy name-based ops.
        // Handles the scenario where ALL mappings are registered under a DERIVED DataModel
        // whose GUID is unknown because F&O's listing API returns it without a GUID. The derived DM appears in
        // allDataModelsSeen because the user browsed it (rememberDataModels logs it as
        // "DataModel has no GUID — skipping"). We try downloading it by name; if the
        // environment has legacy ops (getRevisionContent / getConfigurationXml), we get
        // its XML → parse its ERDataModel.ID → retry GetModelMappingByID with that GUID.
        if (retryDownloads.length === 0) {
          // Collect all pending branch descriptor candidates (used for each new DM GUID).
          const allPendingDescriptors = [...new Set(
            Array.from(pendingMappingBranchesByDmName.values())
              .flat()
              .map(b => b.mappingName)
              .filter(Boolean),
          )];
          const allPendingBranches = Array.from(pendingMappingBranchesByDmName.values()).flat();
          const primaryBranchGlobal =
            allPendingBranches.find(b => b.configurationGuid) ?? allPendingBranches[allPendingBranches.length - 1];

          // Merge allDataModelsSeen (stale closure) with noGuidDmNamesFromScan
          // (collected live during this ingest). allDataModelsSeen may be empty
          // when the user hasn't browsed the tree first (ingest from a fresh session).
          const noGuidNamesC = new Set<string>(noGuidDmNamesFromScan);
          for (const dm of allDataModelsSeen.values()) {
            if (!dm.configurationGuid && !dm.revisionGuid && dm.configurationName)
              noGuidNamesC.add(dm.configurationName);
          }
          for (const dmNameC of noGuidNamesC) {
            if (dmByName.has(dmNameC)) continue; // already resolved
            let candidateGuid: string | undefined;

            // Step 1 — try legacy name-based download (works on older F&O builds).
            const probeSpecC: ErConfigSummary = {
              solutionName: dmNameC,
              configurationName: dmNameC,
              componentType: 'DataModel',
              hasContent: false, // no GUID → legacy name-based ops
              versionNumbers: [50, 40, 30, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
            };
            try {
              const dmDl = await client.downloadConfiguration(connection, probeSpecC, ingestSignal);
              loadDownload(dmDl);
              ok += 1;
              const newest = workspace.configurations();
              const parsed = newest.find(
                c => c.kind === 'DataModel' &&
                  (c.solutionVersion?.solution?.name === dmNameC ||
                   (c.content as ParsedDmContent | undefined)?.version?.model?.name === dmNameC),
              );
              const parsedModel = (parsed?.content as ParsedDmContent | undefined)?.version?.model;
              if (parsedModel?.id) {
                const lower = parsedModel.id.replace(/^\{|\}$/g, '').toLowerCase();
                if (lower && lower !== ZERO_GUID_LOWER) {
                  const containers = descriptorNamesFromContainers(parsedModel.containers);
                  recordDm(parsedModel.id, parsedModel.name ?? dmNameC, parsed?.solutionVersion?.solution?.name, containers);
                  let cand = dmGuidIndex.get(lower);
                  if (!cand) {
                    cand = { name: dmNameC, guid: lower, solutionName: dmNameC, solutionGuid: undefined, descriptorNames: containers };
                    dmGuidIndex.set(lower, cand);
                  }
                  dmByName.set(dmNameC, cand);
                  candidateGuid = lower;
                }
              }
            } catch (err) {
              if (!(err instanceof FnoEmptyContentError)) {
                console.warn('[fno-ui] synth-retry-C: legacy DM probe failed', dmNameC, err);
              }
            }

            // Step 2 — (OData entities for ER DataModels do not exist in F&O,
            // so this is intentionally left as a no-op. If a future F&O build
            // exposes such an entity, probe it here.)

            if (!candidateGuid || allPendingDescriptors.length === 0 || !primaryBranchGlobal) continue;
            const ownerCand = dmByName.get(dmNameC);
            const descriptorsComb = [...new Set([...allPendingDescriptors, ...(ownerCand?.descriptorNames ?? []), ''])];
            const retryKeyC = `synth-retry-c:${candidateGuid}`;
            if (synthesizedMappingKeys.has(retryKeyC)) continue;
            synthesizedMappingKeys.add(retryKeyC);
            retryDownloads.push({
              synth: {
                solutionName: primaryBranchGlobal.mappingSolutionName,
                configurationName: primaryBranchGlobal.mappingName,
                componentType: 'ModelMapping',
                configurationGuid: primaryBranchGlobal.configurationGuid,
                version: primaryBranchGlobal.mappingVersion,
                parentDataModelGuid: candidateGuid,
                parentDataModelRevisionGuid: ownerCand?.solutionGuid,
                descriptorNameCandidates: descriptorsComb,
                hasContent: true,
              },
              dmGuid: candidateGuid,
              label: `mapping (Case C: ${dmNameC} → ${candidateGuid})`,
            });
          }
        }

        if (retryDownloads.length > 0) {
          progress.status(t.fnoStatusDownloadingMMCount(retryDownloads.length));
          for (let batch = 0; batch < retryDownloads.length; batch += MAPPING_BATCH_SIZE) {
            const slice = retryDownloads.slice(batch, batch + MAPPING_BATCH_SIZE);
            const pending = slice.filter(item => !downloadedMappingDmGuids.has(item.dmGuid));
            if (pending.length === 0) continue;
            const results = await Promise.allSettled(
              pending.map(async item => {
                const dl = await client.downloadConfiguration(connection, item.synth, ingestSignal);
                return { item, dl };
              }),
            );
            results.forEach((result, i) => {
              const item = pending[i];
              if (result.status === 'fulfilled') {
                loadDownload(result.value.dl);
                ok += 1;
                mappingSuccessCount += 1;
                const verdict = judgeMapping(result.value.dl.xml);
                recordAttempt(item, 'ok', verdict.link ?? undefined);
                if (verdict.settles) downloadedMappingDmGuids.add(result.value.item.dmGuid);
                collectLateRefs(result.value.dl);
              } else {
                const reason = result.reason;
                if (reason instanceof FnoEmptyContentError) {
                  // empty — mapping not found for this DM GUID, retry with next
                  recordAttempt(item, 'empty', reason.message);
                } else {
                  recordAttempt(item, 'error', reason instanceof Error ? reason.message : String(reason));
                  console.warn('[fno-ui] synth-retry mapping fetch failed', { label: item.label, reason });
                }
              }
            });
          }
        }
      }
      // All mapping download attempts (including retries) exhausted.
      // One structured log of every attempt — this is what to send when a
      // mapping does not arrive for a selected format.
      console.info(
        `[fno-ui] model-mapping phase: ${mappingSuccessCount}/${mappingAttemptLog.length} attempt(s) returned XML`,
      );
      if (mappingAttemptLog.length > 0) console.table(mappingAttemptLog);
    }

    // ── Report what the listing found but nothing could reach ──
    // Some F&O environments return no id at all for DataModel and
    // ModelMapping rows (import-only models are the common case), and an
    // import format's XML cannot supply one either — its
    // model lives in the separate mapping configuration that references the
    // format, never the other way round. There is then nothing to ask
    // `GetDataModelByIDAndRevision` / `GetModelMappingByID` with, so not a
    // single probe is even built. The
    // configurations were plainly *found* — leaving them off the download log
    // reads as if the connector forgot them, so name them and say why.
    // A load where every mapping that came back belongs to another format is a
    // failure too, even though downloads succeeded.
    const noUsableMapping = mappingSuccessCount > 0 && !usableMappingFound;
    if (mappingSuccessCount === 0 || noUsableMapping) {
      const unreachable: ErConfigSummary[] = [];
      for (const [dmName, branches] of pendingMappingBranchesByDmName) {
        // The model resolved: the mappings failed for some other reason and
        // their own rows already carry it.
        if (dmByName.has(dmName)) continue;
        unreachable.push({
          solutionName: dmName,
          configurationName: dmName,
          componentType: 'DataModel',
          hasContent: false,
        });
        for (const branch of branches) {
          if (!branch.mappingName) continue;
          unreachable.push({
            solutionName: branch.mappingSolutionName,
            configurationName: branch.mappingName,
            componentType: 'ModelMapping',
            version: branch.mappingVersion,
            hasContent: false,
          });
        }
      }
      // A configuration that did arrive keeps its row: the same name can be
      // both a pending branch and an explicitly selected download.
      const loadedRowKeys = new Set(
        progress.items()
          .filter(i => i.status === 'done' || i.status === 'downloading')
          .map(i => i.key),
      );
      for (const comp of unreachable) {
        const key = componentKey(comp);
        if (loadedRowKeys.has(key)) continue;
        progress.updateItem({
          key,
          name: comp.configurationName,
          kind: comp.componentType,
          status: 'skipped',
          message: t.fnoIngestNoId,
        });
      }

      // Warn whenever nothing came back, regardless of how the mappings were
      // discovered. The old condition required `pendingMappingBranchesByDmName`
      // to be non-empty — but the listing service cannot enumerate mappings, so
      // selecting only a Format left that map empty and the failure silent.
      const failedNames = pendingMappingBranchesByDmName.size > 0
        ? [...pendingMappingBranchesByDmName.keys()]
        : [...new Set(allMappingDownloads.map(m => m.synth.solutionName || m.synth.configurationName))];
      if (failedNames.length > 0) {
        notify({
          kind: 'warning',
          message: unreachable.length > 0
            ? t.fnoModelIdNotExposed(failedNames)
            : noUsableMapping
              ? t.fnoImportMappingNotFound(failedNames)
              : t.fnoMappingNotAvailable(failedNames),
        });
      }
    }

    // ── Late DataModel pass ──
    // DataModel GUIDs discovered from ModelMapping XML in the synth pass.
    // Covers import formats: their ModelMapping XML carries the correct Model= attribute.
    if (lateModelFollowUps.size > 0) {
      progress.status(t.fnoStatusLateDM);
      const lateEntries = Array.from(lateModelFollowUps.values());
      const LATE_BATCH_SIZE = 2;
      for (let lb = 0; lb < lateEntries.length; lb += LATE_BATCH_SIZE) {
        const lateSlice = lateEntries.slice(lb, lb + LATE_BATCH_SIZE);
        const lateResults = await Promise.allSettled(
          lateSlice.map(async ({ guid, rev }) => {
            const versionNumbers = typeof rev === 'number'
              ? [rev]
              : [1, 2, 3, 0];
            const lateHint = dmNameHints.get(guid.toLowerCase());
            const synthDm: ErConfigSummary = {
              solutionName: lateHint?.solutionName ?? '<late-referenced>',
              configurationName: lateHint?.name ?? `DataModel ${guid}`,
              componentType: 'DataModel',
              configurationGuid: guid,
              hasContent: true,
              version: typeof rev === 'number' ? String(rev) : undefined,
              versionNumbers,
            };
            const download = await client.downloadConfiguration(connection, synthDm, ingestSignal);
            return { guid, download };
          }),
        );
        for (const result of lateResults) {
          if (result.status === 'fulfilled') {
            loadDownload(result.value.download);
            ok += 1;
            alreadyLoadedGuids.add(result.value.guid.toLowerCase());
          } else {
            const reason = result.reason;
            if (reason instanceof FnoEmptyContentError) {
              // no own XML
            } else {
              console.warn('[fno-ui] late DataModel download failed', reason);
            }
          }
        }
      }
    }


    // ── Final pass: labels inherited from ancestor data models ──
    // Derived models/formats reference labels that are defined in a base
    // DataModel further up the `Base` chain. Those ancestors are deliberately
    // not loaded into the workspace, so fetch their XML quietly and merge only
    // the label table into the configurations that inherit from them.
    await resolveInheritedLabels(request, deps);
    // Labels harvested from any response during this batch (scouts,
    // ancestors, sibling label packs) become visible everywhere.
    workspace.refreshLabelPool();
  } catch (e) {
    if (ingestSignal.aborted) {
      console.info('[fno-ui] ingest cancelled');
    } else {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[fno-ui] ingest aborted', e);
      notify({ kind: 'error', message: t.fnoIngestAborted(message) });
    }
  } finally {
    progress.status('');
    progress.end();
    // The download log the user actually sees, in the dump: a row that says
    // "skipped — no id from F&O" is the connector reporting an API gap, while
    // a missing row would mean the report itself is broken. Recorded after
    // endFnoIngest so the statuses are final.
    recordFnoDebug('ingest-rows', progress.items().map(i => ({
      name: i.name,
      kind: i.kind,
      status: i.status,
      explicit: i.explicit,
      message: i.message,
    })));
    dumpFnoDebug('load selected');
  }
  return {
    loaded: ok,
    skippedEmpty,
    queued: finalToLoad.length,
    // Cancelled: whatever arrived is in the workspace, but this is no success.
    cancelled: ingestSignal.aborted,
  };
}
