import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './store';

const FORMAT_XML = `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion>
  <Solution><ERSolution ID.="{SOL-A}" Name="Sales invoice" /></Solution>
  <Contents.>
    <ERFormatVersion ID.="{FMT-A},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Format>
        <ERTextFormat ID.="{FMT-A}" Name="Sales invoice">
          <Root><ERTextFormatFileComponent ID.="{ROOT-A}" Name="Root" /></Root>
        </ERTextFormat>
      </Format>
    </ERFormatVersion>
    <ERFormatMappingVersion ID.="{FMT-A-MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Mapping><ERFormatMapping ID.="{FMT-A-MAP}" Format="{FMT-A}" FormatVersion="{FMT-A},1" Name="Sales invoice mapping" /></Mapping>
    </ERFormatMappingVersion>
  </Contents.>
</ERSolutionVersion>`;

function lastToast() {
  const toasts = useAppStore.getState().toasts;
  return toasts[toasts.length - 1];
}

afterEach(() => {
  vi.useRealTimers();
  useAppStore.setState({ toasts: [], recentFiles: [], recentSessions: [] });
});

describe('undoable removals', () => {
  it('brings a file removed from history back, in its place', () => {
    const files = [
      { path: 'a.xml', name: 'a.xml', openedAt: 1 },
      { path: 'b.xml', name: 'b.xml', openedAt: 2 },
      { path: 'c.xml', name: 'c.xml', openedAt: 3 },
    ] as any[];
    useAppStore.setState({ recentFiles: files, cachedPaths: new Set(['b.xml']) });

    useAppStore.getState().removeRecentFile('b.xml');
    expect(useAppStore.getState().recentFiles.map(f => f.path)).toEqual(['a.xml', 'c.xml']);
    expect(lastToast().action?.label).toBeTruthy();

    lastToast().action!.onClick();
    expect(useAppStore.getState().recentFiles.map(f => f.path)).toEqual(['a.xml', 'b.xml', 'c.xml']);
    expect(useAppStore.getState().cachedPaths.has('b.xml')).toBe(true);
  });

  it('cannot undo once the cached copy is gone', () => {
    vi.useFakeTimers();
    useAppStore.setState({ recentFiles: [{ path: 'a.xml', name: 'a.xml', openedAt: 1 }] as any[], cachedPaths: new Set(['a.xml']) });
    useAppStore.getState().removeRecentFile('a.xml');
    const undo = lastToast().action!;
    vi.advanceTimersByTime(11_000);
    undo.onClick();
    expect(useAppStore.getState().recentFiles).toHaveLength(0);
  });

  it('undoes clearing the history', () => {
    const files = [{ path: 'a.xml', name: 'a.xml', openedAt: 1 }, { path: 'b.xml', name: 'b.xml', openedAt: 2 }] as any[];
    useAppStore.setState({ recentFiles: files });
    useAppStore.getState().clearRecentFiles();
    expect(useAppStore.getState().recentFiles).toHaveLength(0);
    lastToast().action!.onClick();
    expect(useAppStore.getState().recentFiles.map(f => f.path)).toEqual(['a.xml', 'b.xml']);
  });

  it('closes every configuration and says how many', () => {
    useAppStore.getState().removeAllConfigurations();
    useAppStore.getState().loadXmlFile(FORMAT_XML, 'a.xml');
    useAppStore.getState().closeAllConfigurationsWithUndo();
    expect(useAppStore.getState().configurations).toHaveLength(0);
    expect(lastToast().message).toMatch(/1/);
  });
});
