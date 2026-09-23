import { afterEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the IndexedDB content cache; `saveSucceeds` lets a
// test play a quota / private-mode failure.
const cache = new Map<string, string>();
let saveSucceeds = true;
vi.mock('../utils/content-cache', () => ({
  saveFileContent: async (path: string, content: string) => {
    if (!saveSucceeds) return false;
    cache.set(path, content);
    return true;
  },
  readFileContent: async (path: string) => cache.get(path) ?? null,
  deleteFileContent: async (path: string) => { cache.delete(path); },
  clearAllFileContent: async () => { cache.clear(); },
  listCachedPaths: async () => [...cache.keys()],
}));

const {
  useAppStore,
  compareConfigVersions,
  parseDottedPath,
  remapIdAfterConfigRemoval,
  sanitizeRecentFiles,
  sanitizeRecentSessions,
} = await import('./store');

const FORMAT_XML = (id: string, name: string, version = '1') => `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion PublicVersionNumber="${version}">
  <Solution>
    <ERSolution ID.="{SOL-${id}}" Name="${name}" />
  </Solution>
  <Contents.>
    <ERFormatVersion ID.="{${id}},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Format>
        <ERTextFormat ID.="{${id}}" Name="${name}">
          <Root>
            <ERTextFormatFileComponent ID.="{ROOT-${id}}" Name="Root" />
          </Root>
        </ERTextFormat>
      </Format>
    </ERFormatVersion>
    <ERFormatMappingVersion ID.="{${id}-MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Mapping>
        <ERFormatMapping ID.="{${id}-MAP}" Format="{${id}}" FormatVersion="{${id}},1" Name="${name} mapping" />
      </Mapping>
    </ERFormatMappingVersion>
  </Contents.>
</ERSolutionVersion>`;

const MODEL_XML = `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion>
  <Solution>
    <ERSolution ID.="{SOL-MODEL}" Name="Invoice model" />
  </Solution>
  <Contents.>
    <ERDataModelVersion ID.="{MODEL},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Model>
        <ERDataModel ID.="{MODEL}" Name="Invoice model">
          <Contents.>
            <ERDataContainerDescriptor ID.="{ROOT}" Name="Root" IsRoot="1" />
          </Contents.>
        </ERDataModel>
      </Model>
    </ERDataModelVersion>
  </Contents.>
</ERSolutionVersion>`;

function loadThreeFormats(): void {
  const { loadXmlFile } = useAppStore.getState();
  loadXmlFile(FORMAT_XML('A', 'Format A'), 'a.xml');
  loadXmlFile(FORMAT_XML('B', 'Format B'), 'b.xml');
  loadXmlFile(FORMAT_XML('C', 'Format C'), 'c.xml');
}

afterEach(() => {
  cache.clear();
  saveSucceeds = true;
  useAppStore.getState().removeAllConfigurations();
  useAppStore.setState({
    recentFiles: [],
    recentSessions: [],
    cachedPaths: new Set(),
    toasts: [],
    whereUsedTrigger: null,
    searchQuery: '',
    searchResults: [],
  });
});

describe('remapIdAfterConfigRemoval', () => {
  it('shifts tree node and drill-down ids past the removed configuration', () => {
    expect(remapIdAfterConfigRemoval('cfg-2-fmt-structure', 0)).toBe('cfg-1-fmt-structure');
    expect(remapIdAfterConfigRemoval('cfg-12', 1)).toBe('cfg-11');
    expect(remapIdAfterConfigRemoval('drilldown:2:el:X.Y', 0)).toBe('drilldown:1:el:X.Y');
    expect(remapIdAfterConfigRemoval('cfg-0', 1)).toBe('cfg-0');
  });

  it('drops ids of the removed configuration and leaves other shapes alone', () => {
    expect(remapIdAfterConfigRemoval('cfg-1-enum-0', 1)).toBeNull();
    expect(remapIdAfterConfigRemoval('drilldown:1::A.B', 1)).toBeNull();
    expect(remapIdAfterConfigRemoval('something-else', 0)).toBe('something-else');
    expect(remapIdAfterConfigRemoval(null, 0)).toBeNull();
  });
});

describe('removeConfiguration', () => {
  it('keeps an active drill-down tab active under its shifted id and remaps history', () => {
    loadThreeFormats();
    useAppStore.getState().openDrillDownTab('X.Y', 2, 'el');
    useAppStore.setState({
      navigationHistory: [
        { activeTabId: 'cfg-0', selectedNodeId: 'cfg-0' },
        { activeTabId: 'cfg-1', selectedNodeId: null },
        { activeTabId: 'drilldown:2:el:X.Y', selectedNodeId: 'cfg-2' },
      ],
      navigationForward: [{ activeTabId: 'drilldown:2:el:X.Y', selectedNodeId: null }],
    });

    useAppStore.getState().removeConfiguration(0);

    const state = useAppStore.getState();
    expect(state.activeTabId).toBe('drilldown:1:el:X.Y');
    expect(state.openTabs.map(tab => tab.id)).toEqual(['cfg-0', 'cfg-1', 'drilldown:1:el:X.Y']);
    // The snapshot on the removed config is gone; the rest shifted.
    expect(state.navigationHistory).toEqual([
      { activeTabId: 'cfg-0', selectedNodeId: null },
      { activeTabId: 'drilldown:1:el:X.Y', selectedNodeId: 'cfg-1' },
    ]);
    expect(state.navigationForward).toEqual([{ activeTabId: 'drilldown:1:el:X.Y', selectedNodeId: null }]);
    expect(state.canNavigateForward).toBe(true);
  });
});

describe('back / forward', () => {
  it('prunes a closed tab from history so Forward does not land on it', () => {
    loadThreeFormats();
    useAppStore.getState().selectNode(null);
    useAppStore.setState({ activeTabId: 'cfg-0', navigationHistory: [], navigationForward: [] });
    const store = useAppStore.getState();
    store.setActiveTab('cfg-1');
    store.setActiveTab('cfg-2');
    useAppStore.getState().navigateBack();
    expect(useAppStore.getState().activeTabId).toBe('cfg-1');
    expect(useAppStore.getState().canNavigateForward).toBe(true);

    useAppStore.getState().closeTab('cfg-2');
    expect(useAppStore.getState().canNavigateForward).toBe(false);

    useAppStore.getState().navigateForward();
    const state = useAppStore.getState();
    expect(state.activeTabId).toBe('cfg-1');
    expect(state.openTabs.some(tab => tab.id === state.activeTabId)).toBe(true);
  });

  it('skips forward entries whose tab and node are both gone', () => {
    loadThreeFormats();
    useAppStore.getState().selectNode(null);
    useAppStore.setState({
      activeTabId: 'cfg-0',
      navigationHistory: [],
      navigationForward: [
        { activeTabId: 'cfg-1', selectedNodeId: null },
        { activeTabId: 'vanished', selectedNodeId: 'cfg-9' },
      ],
    });

    useAppStore.getState().navigateForward();

    const state = useAppStore.getState();
    expect(state.activeTabId).toBe('cfg-1');
    expect(state.navigationForward).toEqual([]);
    expect(state.canNavigateForward).toBe(false);
  });
});

describe('loadXmlFile', () => {
  it('refreshes the selected node against the rebuilt tree for every kind', () => {
    useAppStore.getState().loadXmlFile(MODEL_XML, 'model.xml');
    useAppStore.getState().selectNode('cfg-0');
    const before = useAppStore.getState().selectedNode;
    expect(before).not.toBeNull();

    useAppStore.getState().loadXmlFile(MODEL_XML, 'model.xml');

    const state = useAppStore.getState();
    expect(state.selectedNodeId).toBe('cfg-0');
    expect(state.selectedNode).not.toBe(before);
    expect(state.selectedNode).toBe(state.treeNodes[0]);
  });

  it('clears a selection whose node no longer exists', () => {
    useAppStore.getState().loadXmlFile(MODEL_XML, 'model.xml');
    useAppStore.setState({ selectedNodeId: 'cfg-0-gone', selectedNode: { id: 'cfg-0-gone', name: 'x', icon: '', type: 'field' } });

    useAppStore.getState().loadXmlFile(MODEL_XML, 'model.xml');

    expect(useAppStore.getState().selectedNodeId).toBeNull();
    expect(useAppStore.getState().selectedNode).toBeNull();
  });

  it('refuses an older version of an open configuration and says so', () => {
    const { loadXmlFile } = useAppStore.getState();
    expect(loadXmlFile(FORMAT_XML('A', 'Format A', '68.13'), 'new.xml')).toBe(true);
    expect(loadXmlFile(FORMAT_XML('A', 'Format A', '68.12'), 'old.xml')).toBe(false);

    const state = useAppStore.getState();
    expect(state.configurations.map(c => c.filePath)).toEqual(['new.xml']);
    expect(state.toasts.some(toast => toast.kind === 'info' && toast.message.includes('old.xml'))).toBe(true);
  });

  it('replaces an open configuration with a newer multi-part version', () => {
    const { loadXmlFile } = useAppStore.getState();
    loadXmlFile(FORMAT_XML('A', 'Format A', '68.12'), 'old.xml');
    expect(loadXmlFile(FORMAT_XML('A', 'Format A', '68.13'), 'new.xml')).toBe(true);
    expect(useAppStore.getState().configurations.map(c => c.filePath)).toEqual(['new.xml']);
  });

  it('marks a file reopenable only once its content was cached', async () => {
    saveSucceeds = false;
    useAppStore.getState().loadXmlFile(MODEL_XML, 'uncached.xml');
    await Promise.resolve();
    await Promise.resolve();
    expect(useAppStore.getState().cachedPaths.has('uncached.xml')).toBe(false);

    saveSucceeds = true;
    useAppStore.getState().loadXmlFile(FORMAT_XML('A', 'Format A'), 'cached.xml');
    await vi.waitFor(() => expect(useAppStore.getState().cachedPaths.has('cached.xml')).toBe(true));
  });
});

describe('compareConfigVersions', () => {
  it('compares every version segment numerically', () => {
    expect(compareConfigVersions('68.12', '68.13')).toBeLessThan(0);
    expect(compareConfigVersions('68.13', '68.12')).toBeGreaterThan(0);
    expect(compareConfigVersions('1.68.1234', '1.68.999')).toBeGreaterThan(0);
    expect(compareConfigVersions('68', '68.0')).toBe(0);
    expect(compareConfigVersions('', '1')).toBeLessThan(0);
    expect(compareConfigVersions(undefined, null)).toBe(0);
  });
});

describe('persisted recent lists', () => {
  it('turns a non-array value into an empty list', () => {
    expect(sanitizeRecentFiles(null)).toEqual([]);
    expect(sanitizeRecentFiles({ path: 'a.xml' })).toEqual([]);
    expect(sanitizeRecentSessions('nope')).toEqual([]);
  });

  it('drops malformed entries and fields of the wrong type', () => {
    expect(sanitizeRecentFiles([
      null,
      { path: 42 },
      { path: 'dir/a.xml', openedAt: 5, kind: 'Bogus', source: 'fno', version: 3 },
    ])).toEqual([{ path: 'dir/a.xml', name: 'a.xml', openedAt: 5, source: 'fno' }]);

    expect(sanitizeRecentSessions([
      { id: 's1', openedAt: 1, files: 'broken' },
      { id: 's2', openedAt: 2, files: [{ path: 'b.xml', name: 'b.xml', openedAt: 2, kind: 'Format' }] },
    ])).toEqual([
      { id: 's2', openedAt: 2, files: [{ path: 'b.xml', name: 'b.xml', openedAt: 2, kind: 'Format' }] },
    ]);
  });
});

describe('where-used trigger', () => {
  it('is consumed once so a remounted panel does not replay it', () => {
    useAppStore.getState().triggerWhereUsed('TaxTrans');
    const trigger = useAppStore.getState().whereUsedTrigger!;
    expect(trigger.consumed).toBe(false);

    useAppStore.getState().consumeWhereUsedTrigger(trigger.version);
    expect(useAppStore.getState().whereUsedTrigger?.consumed).toBe(true);

    // A newer trigger is not consumed by acknowledging the old version.
    useAppStore.getState().triggerWhereUsed('CustTable');
    useAppStore.getState().consumeWhereUsedTrigger(trigger.version);
    expect(useAppStore.getState().whereUsedTrigger).toMatchObject({ query: 'CustTable', consumed: false });
  });
});

describe('executeSearch', () => {
  it('does not run a single-character query', () => {
    useAppStore.getState().loadXmlFile(MODEL_XML, 'model.xml');
    useAppStore.getState().setSearchQuery('R');
    useAppStore.getState().executeSearch();
    expect(useAppStore.getState().searchResults).toEqual([]);
  });
});

describe('parseDottedPath', () => {
  it('reads a doubled quote inside a quoted name as one literal quote', () => {
    expect(parseDottedPath("Customer.'Customer''s name'.Value")).toEqual(['Customer', "Customer's name", 'Value']);
    expect(parseDottedPath("model.'$Field'")).toEqual(['model', '$Field']);
  });
});
