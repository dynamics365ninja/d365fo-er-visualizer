import { describe, expect, it } from 'vitest';
import { parseERConfiguration } from '@er-visualizer/core';
import { focusedTabId, lastActiveFormatIndex, openDesignerTabsForFormats, tabsInPane, useAppStore } from './store';

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

  it('moves a tab into a group of its own on the side', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-1', splitTabId: 'cfg-0', sideTabIds: ['cfg-0'], focusedPane: 'side' });
    expect(tabsInPane(useAppStore.getState(), 'main').map(tab => tab.id)).toEqual(['cfg-1']);
    expect(tabsInPane(useAppStore.getState(), 'side').map(tab => tab.id)).toEqual(['cfg-0']);
  });

  it('activates a tab in its own group, which takes focus', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    useAppStore.getState().setActiveTab('cfg-1');
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-1', splitTabId: 'cfg-0', focusedPane: 'main' });
    useAppStore.getState().setActiveTab('cfg-0');
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-1', splitTabId: 'cfg-0', focusedPane: 'side' });
    expect(focusedTabId(useAppStore.getState())).toBe('cfg-0');
  });

  it('opens new tabs in the focused group, each group keeping its own tabs', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');

    // Right group focused: the drill-down from format A joins it.
    useAppStore.getState().openDrillDownTab('model.Invoice.Date', 0, 'Date');
    const dd0 = 'drilldown:0:Date:model.Invoice.Date';
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-1', splitTabId: dd0, focusedPane: 'side' });
    expect(tabsInPane(useAppStore.getState(), 'side').map(tab => tab.id)).toEqual(['cfg-0', dd0]);

    // Left group focused: the drill-down from format B joins that one.
    useAppStore.getState().focusPane('main');
    useAppStore.getState().openDrillDownTab('model.Invoice.Date', 1, 'Date');
    const dd1 = 'drilldown:1:Date:model.Invoice.Date';
    expect(useAppStore.getState()).toMatchObject({ activeTabId: dd1, splitTabId: dd0 });
    expect(tabsInPane(useAppStore.getState(), 'main').map(tab => tab.id)).toEqual(['cfg-1', dd1]);
  });

  it('opens a drill-down beside the focused group, in the other one', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    // Focus is on the right, so "beside" is the left group.
    useAppStore.getState().openDrillDownTab('model.Invoice.Date', 0, 'Date', { side: true });
    expect(useAppStore.getState()).toMatchObject({
      activeTabId: 'drilldown:0:Date:model.Invoice.Date',
      splitTabId: 'cfg-0',
      sideTabIds: ['cfg-0'],
      focusedPane: 'main',
    });
  });

  it('never empties the main group by moving its last tab aside', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    useAppStore.getState().moveTabToPane('cfg-1', 'side');
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-1', sideTabIds: ['cfg-0'] });
  });

  it('closes a group once its last tab moves out or closes', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    useAppStore.getState().moveTabToPane('cfg-0', 'main');
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-0', splitTabId: null, sideTabIds: [], focusedPane: 'main' });

    useAppStore.getState().openTabToSide('cfg-0');
    useAppStore.getState().closeTab('cfg-0');
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-1', splitTabId: null, sideTabIds: [] });
  });

  it('hands the side group over when the main group runs out of tabs', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    useAppStore.getState().closeTab('cfg-1');
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-0', splitTabId: null, sideTabIds: [], focusedPane: 'main' });
  });

  it('shows the neighbour when the shown tab of a group closes', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    useAppStore.getState().openDrillDownTab('model.Invoice.Date', 0, 'Date');
    useAppStore.getState().closeTab('drilldown:0:Date:model.Invoice.Date');
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-1', splitTabId: 'cfg-0', sideTabIds: ['cfg-0'] });
  });

  it('closing a group keeps its tabs, in the other group', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    useAppStore.getState().closePane('main');
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-0', splitTabId: null, sideTabIds: [], focusedPane: 'main' });
    expect(useAppStore.getState().openTabs).toHaveLength(2);
  });

  it('keeps the groups apart when a configuration is removed', () => {
    loadTwoFormats();
    useAppStore.getState().openDrillDownTab('model.Invoice.Date', 1, 'Date');
    useAppStore.getState().moveTabToPane('drilldown:1:Date:model.Invoice.Date', 'side');
    useAppStore.getState().removeConfiguration(0);
    const state = useAppStore.getState();
    expect(state.openTabs.map(tab => tab.id)).toEqual(['cfg-0', 'drilldown:0:Date:model.Invoice.Date']);
    expect(state).toMatchObject({ activeTabId: 'cfg-0', splitTabId: 'drilldown:0:Date:model.Invoice.Date', sideTabIds: ['drilldown:0:Date:model.Invoice.Date'] });
  });

  it('shows a tab of the side group there when navigation activates it', () => {
    loadTwoFormats();
    useAppStore.getState().openTabToSide('cfg-0');
    useAppStore.getState().focusPane('main');
    // Back/Forward and explorer navigation set the active tab directly.
    useAppStore.setState({ activeTabId: 'cfg-0' });
    expect(useAppStore.getState()).toMatchObject({ activeTabId: 'cfg-1', splitTabId: 'cfg-0', focusedPane: 'side' });
  });

  it('reorders tabs in the strip', () => {
    loadTwoFormats();
    useAppStore.getState().reorderTab('cfg-1', 'cfg-0');
    expect(useAppStore.getState().openTabs.map(tab => tab.id)).toEqual(['cfg-1', 'cfg-0']);
    useAppStore.getState().reorderTab('cfg-1', null);
    expect(useAppStore.getState().openTabs.map(tab => tab.id)).toEqual(['cfg-0', 'cfg-1']);
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
