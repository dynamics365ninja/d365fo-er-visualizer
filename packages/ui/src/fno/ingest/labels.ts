/**
 * Final pass of an ingest: labels inherited from ancestors that are not loaded.
 */

import { parseERConfigurations } from '@er-visualizer/core';
import type { ErConfigDownload, ErConfigSummary } from '@er-visualizer/fno-client';
import { t } from '../../i18n';
import { ZERO_GUID_LOWER } from './shared';
import type { FnoIngestDeps, FnoIngestRequest } from './types';

/**
 * Derived models/formats reference labels that are defined in a base
 * DataModel further up the `Base` chain. Those ancestors are deliberately
 * not loaded into the workspace, so fetch their XML quietly and merge only
 * the label table into the configurations that inherit from them.
 */
export async function resolveInheritedLabels(
  request: Pick<FnoIngestRequest, 'connection' | 'allDataModelsSeen' | 'signal'>,
  deps: Pick<FnoIngestDeps, 'client' | 'workspace' | 'progress'>,
): Promise<void> {
  const { connection, allDataModelsSeen, signal } = request;
  const { client, workspace, progress } = deps;
  const norm = (g: string | undefined) => (g ?? '').replace(/^\{|\}$/g, '').toLowerCase();
  const isGuid = (g: string) => g.length > 0 && g !== ZERO_GUID_LOWER;
  const loaded = workspace.configurations();
  const loadedIds = new Set(loaded.map(c => norm(c.solutionVersion?.solution?.id)).filter(isGuid));
  // Inheritors are tracked by file path: F&O downloads may carry no
  // solution GUID in their synthetic envelope, but every configuration
  // has a unique path in the workspace.
  type Inheritor = { filePath: string; kind: 'Format' | 'DataModel' | 'ModelMapping' };
  const inheritors = new Map<string, Inheritor[]>();
  const queue: string[] = [];
  for (const cfg of loaded) {
    const base = norm(cfg.solutionVersion?.solution?.baseSolutionId);
    if (!isGuid(base) || loadedIds.has(base)) continue;
    if (!inheritors.has(base)) { inheritors.set(base, []); queue.push(base); }
    inheritors.get(base)!.push({ filePath: cfg.filePath, kind: cfg.kind as Inheritor['kind'] });
  }
  if (queue.length === 0) return;
  progress.status(t.fnoStatusResolvingLabels);
  const visited = new Set<string>();
  const MAX_ANCESTORS = 8;
  const allVersions = [50, 40, 30, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
  while (queue.length > 0 && visited.size < MAX_ANCESTORS) {
    if (signal.aborted) return;
    const guid = queue.shift()!;
    if (visited.has(guid)) continue;
    visited.add(guid);
    const targets = inheritors.get(guid) ?? [];
    const listingMatch = Array.from(allDataModelsSeen.values()).find(
      m => norm(m.configurationGuid) === guid || norm(m.revisionGuid) === guid,
    );
    // The Base of a derived format is usually another format; the root
    // format's Base is the data model. Try the inheritor's own kind first.
    const kinds: Array<'Format' | 'DataModel'> = listingMatch
      ? ['DataModel']
      : targets.some(x => x.kind === 'Format') ? ['Format', 'DataModel'] : ['DataModel'];
    let download: ErConfigDownload | null = null;
    for (const kind of kinds) {
      const spec: ErConfigSummary = {
        solutionName: listingMatch?.solutionName ?? listingMatch?.configurationName ?? `${kind} ${guid}`,
        configurationName: listingMatch?.configurationName ?? `${kind} ${guid}`,
        componentType: kind,
        configurationGuid: guid,
        revisionGuid: kind === 'Format' ? guid : undefined,
        hasContent: true,
        versionNumbers: kind === 'DataModel' ? allVersions : undefined,
      };
      try {
        download = await client.downloadConfiguration(connection, spec, signal, { silent: true });
        break;
      } catch (err) {
        console.info('[fno-ui] inherited labels: ancestor not available as', kind, { guid, err });
      }
    }
    if (!download) continue;
    try {
      for (const parsed of parseERConfigurations(download.xml, download.syntheticPath)) {
        const solution = parsed.solutionVersion?.solution;
        const labels = solution?.labels ?? [];
        if (labels.length > 0) workspace.addInheritedLabels({ filePaths: targets.map(x => x.filePath) }, labels);
        // Keep climbing: whoever inherits from this one also inherits from its base.
        const nextBase = norm(solution?.baseSolutionId);
        if (isGuid(nextBase) && !loadedIds.has(nextBase) && !visited.has(nextBase)) {
          if (!inheritors.has(nextBase)) { inheritors.set(nextBase, []); queue.push(nextBase); }
          inheritors.get(nextBase)!.push(...targets);
        }
      }
    } catch (err) {
      console.info('[fno-ui] inherited labels: ancestor XML not parseable', { guid, err });
    }
  }
}
