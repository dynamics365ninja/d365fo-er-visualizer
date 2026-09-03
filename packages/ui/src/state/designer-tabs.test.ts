import { describe, expect, it } from 'vitest';
import { parseERConfiguration } from '@er-visualizer/core';
import { openDesignerTabsForFormats } from './store';

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
