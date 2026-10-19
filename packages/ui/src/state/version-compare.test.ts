import { afterEach, describe, expect, it } from 'vitest';
import { parseERConfiguration } from '@er-visualizer/core';
import { remapIdAfterConfigRemoval, useAppStore, type OpenTab } from './store';
import { mergeConfiguration } from './configuration-merge';
import { XML_FORMAT_XML } from '../utils/invoice-workspace.test-fixture';
import { otherCachedVersions } from '../components/VersionComparePicker';

/** The fixture format in another public version (the same solution GUID). */
function formatVersion(version: string): string {
  return XML_FORMAT_XML.replace('PublicVersionNumber="1"', `PublicVersionNumber="${version}"`);
}

const compareTabs = () => useAppStore.getState().openTabs.filter((tab): tab is Extract<OpenTab, { kind: 'compare' }> => tab.kind === 'compare');

afterEach(() => {
  useAppStore.getState().removeAllConfigurations();
  useAppStore.setState({ toasts: [], recentFiles: [], recentSessions: [], cachedPaths: new Set() });
});

describe('mergeConfiguration', () => {
  it('says where the newer version is when the candidate is older, and what a newer one replaced', () => {
    const v2 = parseERConfiguration(formatVersion('2'), 'v2.xml');
    const v1 = parseERConfiguration(formatVersion('1'), 'v1.xml');
    const v3 = parseERConfiguration(formatVersion('3'), 'v3.xml');
    expect(mergeConfiguration([v2], v1)).toEqual({ status: 'older', existingIndex: 0 });
    expect(mergeConfiguration([v2], v3)).toEqual({ status: 'merged', configs: [v3], replaced: v2 });
    // Re-loading the same version replaces it without anything to compare.
    expect(mergeConfiguration([v2], parseERConfiguration(formatVersion('2'), 'copy.xml'))).toMatchObject({ status: 'merged', replaced: undefined });
  });
});

describe('comparing versions', () => {
  it('keeps an older file out of the workspace by default, as before', () => {
    const store = useAppStore.getState();
    store.loadXmlFile(formatVersion('2'), 'v2.xml');
    expect(useAppStore.getState().loadXmlFile(formatVersion('1'), 'v1.xml')).toBe(false);
    expect(useAppStore.getState().configurations.map(c => c.filePath)).toEqual(['v2.xml']);
    expect(compareTabs()).toEqual([]);
  });

  it('opens an older file the user picked in a comparison with the loaded version', () => {
    useAppStore.getState().loadXmlFile(formatVersion('2'), 'v2.xml');
    const loaded = useAppStore.getState().loadXmlFile(formatVersion('1'), 'v1.xml', { olderVersion: 'compare' });

    const state = useAppStore.getState();
    expect(loaded).toBe(true);
    // The workspace still holds one version of the configuration.
    expect(state.configurations.map(c => c.filePath)).toEqual(['v2.xml']);
    const [tab] = compareTabs();
    expect(tab).toMatchObject({ configIndex: 0, label: 'Sales invoice XML · v1 ↔ v2' });
    expect(state.activeTabId).toBe(tab.id);
    expect(state.comparisonVersions[tab.otherKey].filePath).toBe('v1.xml');
    // The older file is remembered, so the picker offers it the next time.
    expect(state.recentFiles.some(r => r.path === 'v1.xml' && r.version === '1')).toBe(true);
  });

  it('compares a newer file with the version it replaced', () => {
    useAppStore.getState().loadXmlFile(formatVersion('1'), 'v1.xml');
    useAppStore.getState().loadXmlFile(formatVersion('2'), 'v2.xml', { olderVersion: 'compare' });

    const state = useAppStore.getState();
    expect(state.configurations.map(c => c.filePath)).toEqual(['v2.xml']);
    const [tab] = compareTabs();
    expect(tab.label).toBe('Sales invoice XML · v1 ↔ v2');
    expect(state.comparisonVersions[tab.otherKey].solutionVersion.publicVersionNumber).toBe('1');
  });

  it('lets the comparison version go with the last tab that shows it', () => {
    useAppStore.getState().loadXmlFile(formatVersion('2'), 'v2.xml');
    useAppStore.getState().loadXmlFile(formatVersion('1'), 'v1.xml', { olderVersion: 'compare' });
    const [tab] = compareTabs();
    useAppStore.getState().closeTab(tab.id);
    expect(useAppStore.getState().comparisonVersions).toEqual({});
  });

  it('closes the comparison with the configuration it compares', () => {
    useAppStore.getState().loadXmlFile(formatVersion('2'), 'v2.xml');
    useAppStore.getState().loadXmlFile(formatVersion('1'), 'v1.xml', { olderVersion: 'compare' });
    useAppStore.getState().removeConfiguration(0);
    expect(compareTabs()).toEqual([]);
    expect(useAppStore.getState().comparisonVersions).toEqual({});
  });

  it('refuses a file without a configuration of the same kind', () => {
    useAppStore.getState().loadXmlFile(formatVersion('2'), 'v2.xml');
    const ok =useAppStore.getState().compareWithXml(0, `<?xml version="1.0"?>
<ERSolutionVersion><Solution><ERSolution ID.="{M}" Name="Model" /></Solution><Contents.>
  <ERDataModelVersion ID.="{MODEL},1" DateTime="" Description="" Number="1"><Model><ERDataModel ID.="{MODEL}" Name="Model"><Contents.>
    <ERDataContainerDescriptor ID.="{ROOT}" Name="Root" IsRoot="1" />
  </Contents.></ERDataModel></Model></ERDataModelVersion>
</Contents.></ERSolutionVersion>`, 'model.xml');
    expect(ok).toBe(false);
    expect(compareTabs()).toEqual([]);
    expect(useAppStore.getState().toasts.at(-1)?.kind).toBe('warning');
  });

  it('shifts a comparison tab id past a closed configuration', () => {
    expect(remapIdAfterConfigRemoval('compare:3:a.xml|v1', 1)).toBe('compare:2:a.xml|v1');
    expect(remapIdAfterConfigRemoval('compare:1:a.xml|v1', 1)).toBeNull();
  });
});

describe('otherCachedVersions', () => {
  it('offers the cached versions of the same configuration, newest first', () => {
    const files = [
      { path: 'v1.xml', name: 'v1.xml', kind: 'Format', solutionId: 'abc', version: '1', openedAt: 1 },
      { path: 'v10.xml', name: 'v10.xml', kind: 'Format', solutionId: 'abc', version: '10', openedAt: 2 },
      { path: 'v2.xml', name: 'v2.xml', kind: 'Format', solutionId: 'abc', version: '2', openedAt: 3 },
      { path: 'other.xml', name: 'other.xml', kind: 'Format', solutionId: 'xyz', version: '5', openedAt: 4 },
      { path: 'mapping.xml', name: 'mapping.xml', kind: 'ModelMapping', solutionId: 'abc', version: '5', openedAt: 5 },
      { path: 'gone.xml', name: 'gone.xml', kind: 'Format', solutionId: 'abc', version: '7', openedAt: 6 },
    ] as const;
    const cached = new Set(['v1.xml', 'v10.xml', 'v2.xml', 'other.xml', 'mapping.xml']);
    const offered = otherCachedVersions(files.map(f => ({ ...f })), cached, { filePath: 'v2.xml', kind: 'Format', solutionId: '{ABC}' });
    expect(offered.map(f => f.path)).toEqual(['v10.xml', 'v1.xml']);
  });
});
