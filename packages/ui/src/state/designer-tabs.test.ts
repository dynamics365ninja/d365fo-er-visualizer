import { describe, expect, it } from 'vitest';
import { parseERConfiguration } from '@er-visualizer/core';
import { lastActiveFormatIndex, openDesignerTabsForFormats, useAppStore } from './store';

const FORMAT_XML = (id: string, name: string) => `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion>
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

const emptyState = {
  openTabs: [] as any[],
  activeTabId: null,
  selectedNodeId: null,
  selectedNode: null,
};

function treeNodesFor(configurations: any[]): any[] {
  return configurations.map((config, index) => ({
    id: `cfg-${index}`,
    name: config.solutionVersion.solution.name,
    type: 'file',
    configIndex: index,
  }));
}

describe('auto-opening the designer for loaded formats', () => {
  it('opens a designer tab for every loaded format and activates the last one', () => {
    const configurations = [
      parseERConfiguration(FORMAT_XML('FMT-A', 'Sales invoice'), 'a.xml'),
      parseERConfiguration(FORMAT_XML('FMT-B', 'Credit note'), 'b.xml'),
    ] as any[];

    const next = openDesignerTabsForFormats(
      emptyState as any,
      configurations,
      configurations,
      treeNodesFor(configurations),
    );

    expect(next.openTabs.map(tab => tab.id)).toEqual(['cfg-0', 'cfg-1']);
    expect(next.openTabs.map(tab => tab.label)).toEqual(['Sales invoice', 'Credit note']);
    expect(next.activeTabId).toBe('cfg-1');
    expect(next.selectedNodeId).toBe('cfg-1');
    expect(next.selectedNode?.name).toBe('Credit note');
  });

  it('ignores non-format configurations', () => {
    const configurations = [parseERConfiguration(MODEL_XML, 'model.xml')] as any[];

    const next = openDesignerTabsForFormats(
      emptyState as any,
      configurations,
      configurations,
      treeNodesFor(configurations),
    );

    expect(next.openTabs).toHaveLength(0);
    expect(next.activeTabId).toBeNull();
  });

  it('reuses an already open tab instead of duplicating it', () => {
    const configurations = [parseERConfiguration(FORMAT_XML('FMT-A', 'Sales invoice'), 'a.xml')] as any[];
    const state = {
      openTabs: [{ id: 'cfg-0', label: 'Sales invoice', configIndex: 0 }],
      activeTabId: 'cfg-0',
      selectedNodeId: 'cfg-0-fmt-ds',
      selectedNode: null,
    };

    const next = openDesignerTabsForFormats(
      state as any,
      configurations,
      configurations,
      treeNodesFor(configurations),
    );

    expect(next.openTabs).toHaveLength(1);
    expect(next.activeTabId).toBe('cfg-0');
  });

  it('finds the config by path when a merge kept the already loaded object', () => {
    const loaded = [parseERConfiguration(FORMAT_XML('FMT-A', 'Sales invoice'), 'a.xml')] as any[];
    // Simulates mergeConfiguration keeping the previously loaded instance.
    const configurations = [parseERConfiguration(FORMAT_XML('FMT-A', 'Sales invoice'), 'a.xml')] as any[];

    const next = openDesignerTabsForFormats(
      emptyState as any,
      loaded,
      configurations,
      treeNodesFor(configurations),
    );

    expect(next.openTabs.map(tab => tab.id)).toEqual(['cfg-0']);
  });
});

describe('side-by-side tabs', () => {
  function loadTwoFormats() {
    useAppStore.getState().removeAllConfigurations();
    useAppStore.getState().loadXmlFile(FORMAT_XML('FMT-A', 'Sales invoice'), 'a.xml');
    useAppStore.getState().loadXmlFile(FORMAT_XML('FMT-B', 'Credit note'), 'b.xml');
  }

  it('shows a tab next to the active one', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    expect(useAppStore.getState().activeTabId).toBe('cfg-1');
    expect(useAppStore.getState().splitTabId).toBe('cfg-0');
  });

  it('swaps the panes when the tab on the side is activated', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    useAppStore.getState().setActiveTab('cfg-0');
    expect(useAppStore.getState().activeTabId).toBe('cfg-0');
    expect(useAppStore.getState().splitTabId).toBe('cfg-1');
  });

  it('opens a drill-down beside the active tab', () => {
    loadTwoFormats();
    useAppStore.getState().openDrillDownTab('model.Invoice.Date', 1, 'Date', { side: true });
    const state = useAppStore.getState();
    expect(state.activeTabId).toBe('cfg-1');
    expect(state.splitTabId).toBe('drilldown:1:Date:model.Invoice.Date');
    expect(state.openTabs.some(tab => tab.id === state.splitTabId)).toBe(true);
  });

  it('closes the side view with its tab', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    useAppStore.getState().closeTab('cfg-0');
    expect(useAppStore.getState().splitTabId).toBeNull();
    expect(useAppStore.getState().activeTabId).toBe('cfg-1');
  });

  it('remembers the format of the last active tab', () => {
    loadTwoFormats();
    useAppStore.getState().setActiveTab('cfg-0');
    expect(lastActiveFormatIndex(useAppStore.getState())).toBe(0);
    // A drill-down speaks for the format it was opened from.
    useAppStore.getState().openDrillDownTab('model.Invoice.Date', 1, 'Date');
    expect(lastActiveFormatIndex(useAppStore.getState())).toBe(1);
    useAppStore.getState().setActiveTab('cfg-0');
    expect(lastActiveFormatIndex(useAppStore.getState())).toBe(0);
    // Closing it hands over to the format of whatever tab comes forward.
    useAppStore.getState().removeConfiguration(0);
    expect(useAppStore.getState().lastActiveFormatPath).toBe('b.xml');
    expect(lastActiveFormatIndex(useAppStore.getState())).toBe(0);
  });
});
