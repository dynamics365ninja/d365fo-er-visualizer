import { afterEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the IndexedDB content cache.
const cache = new Map<string, string>();
vi.mock('../utils/content-cache', () => ({
  saveFileContent: async (path: string, content: string) => { cache.set(path, content); },
  readFileContent: async (path: string) => cache.get(path) ?? null,
  deleteFileContent: async (path: string) => { cache.delete(path); },
  clearAllFileContent: async () => { cache.clear(); },
  listCachedPaths: async () => [...cache.keys()],
}));

const { useAppStore } = await import('./store');

/** One export carrying a data model together with its model mapping. */
const BUNDLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion DateTime="2026-04-14T12:00:00" Description="test" Number="1" PublicVersionNumber="1" VersionStatus="2">
  <Solution>
    <ERSolution ID.="{SOLUTION}" Name="Test solution" Description="Fixture">
      <Vendor>
        <ERVendor Name="Microsoft" Url="http://microsoft.com" />
      </Vendor>
      <Contents.>
        <Ref. ID.="{MODEL}" />
        <Ref. ID.="{MAP}" />
      </Contents.>
    </ERSolution>
  </Solution>
  <Contents.>
    <ERDataModelVersion ID.="{MODEL},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Model>
        <ERDataModel ID.="{MODEL}" Name="Model">
          <Contents.>
            <ERDataContainerDescriptor ID.="{ROOT}" Name="Root" IsRoot="1">
              <Contents.>
                <ERDataContainerDescriptorItem Name="Value" Type="6" />
              </Contents.>
            </ERDataContainerDescriptor>
          </Contents.>
        </ERDataModel>
      </Model>
    </ERDataModelVersion>
    <ERModelMappingVersion ID.="{MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Mapping>
        <ERModelMapping ID.="{MAP}" Name="Mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1" />
      </Mapping>
    </ERModelMappingVersion>
  </Contents.>
</ERSolutionVersion>`;

afterEach(() => {
  cache.clear();
  useAppStore.setState({ configurations: [], recentFiles: [], recentSessions: [], toasts: [] });
});

describe('loadRecentSession', () => {
  it('restores a bundled data model from the bundle it was cached with', async () => {
    useAppStore.getState().loadXmlFile(BUNDLE_XML, 'model-and-mapping.xml');
    const [session] = useAppStore.getState().recentSessions;
    expect(session.files.map(f => f.path)).toEqual([
      'model-and-mapping.xml#datamodel:{MODEL}',
      'model-and-mapping.xml',
    ]);

    useAppStore.setState({ configurations: [], toasts: [] });
    const loaded = await useAppStore.getState().loadRecentSession(session.id, { replace: true });

    const state = useAppStore.getState();
    expect(loaded).toBe(true);
    expect(state.toasts.filter(t => t.kind === 'warning')).toEqual([]);
    expect(state.configurations.map(c => c.filePath)).toEqual([
      'model-and-mapping.xml#datamodel:{MODEL}',
      'model-and-mapping.xml',
    ]);
  });
});
