import { useCallback, useState } from 'react';
import { findRelatedRecentFiles, useAppStore, type RecentFile } from '../state/store';
import { DependencyPromptDialog, type DependencyPromptRequest } from './DependencyPromptDialog';

/** Data models first so mappings and formats link to them on arrival. */
const loadOrder = (kind: string | undefined) => (kind === 'DataModel' ? 0 : kind === 'ModelMapping' ? 1 : 2);

/**
 * Loading a cached configuration together with its related ones. `load(entry)`
 * asks "load the data model and its mapping too?" when cached-but-not-loaded
 * configurations of the same data model exist, and loads the entry alone when
 * there are none. Render `dialog` once next to the triggering UI.
 *
 * `onLoaded` runs after a load that opened (or found already open) at least
 * one configuration — not when the user cancels the prompt.
 */
export function useRelatedRecentLoad(onLoaded?: () => void) {
  const recentFiles = useAppStore(s => s.recentFiles);
  const configurations = useAppStore(s => s.configurations);
  const cachedPaths = useAppStore(s => s.cachedPaths);
  const loadCachedFile = useAppStore(s => s.loadCachedFile);
  const [prompt, setPrompt] = useState<(DependencyPromptRequest & { subject: RecentFile }) | null>(null);

  const loadMany = useCallback(async (entries: RecentFile[]) => {
    const sorted = [...entries].sort((a, b) => loadOrder(a.kind) - loadOrder(b.kind));
    let any = false;
    for (const e of sorted) {
      if (await loadCachedFile(e.path, e.solutionName ?? e.name)) any = true;
    }
    if (any) onLoaded?.();
    return any;
  }, [loadCachedFile, onLoaded]);

  const load = useCallback((entry: RecentFile) => {
    const related = findRelatedRecentFiles(entry, recentFiles, configurations, cachedPaths);
    const candidates = [
      ...(related.dataModel ? [related.dataModel] : []),
      ...related.mappings,
      ...related.formats,
    ];
    if (candidates.length === 0 || entry.kind === undefined) {
      void loadMany([entry]);
      return;
    }
    setPrompt({
      subject: entry,
      subjectName: entry.solutionName ?? entry.name,
      subjectKind: entry.kind,
      candidates: candidates.map(c => ({
        key: c.path,
        kind: c.kind ?? 'Format',
        name: c.solutionName ?? c.name,
        meta: c.version ? `v${c.version}` : undefined,
      })),
    });
  }, [recentFiles, configurations, cachedPaths, loadMany]);

  const dialog = (
    <DependencyPromptDialog
      request={prompt}
      onConfirm={keys => {
        const subject = prompt!.subject;
        const picked = recentFiles.filter(r => keys.includes(r.path));
        setPrompt(null);
        void loadMany([subject, ...picked]);
      }}
      onOnlySubject={() => {
        const subject = prompt!.subject;
        setPrompt(null);
        void loadMany([subject]);
      }}
      onCancel={() => setPrompt(null)}
    />
  );

  return { load, loadMany, dialog };
}
