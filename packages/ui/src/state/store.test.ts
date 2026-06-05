import { afterEach, describe, expect, it } from 'vitest';
import type { ERConfiguration } from '@er-visualizer/core';
import { ERComponentKind } from '@er-visualizer/core';
import type { RecentFile, RecentSession } from './store.js';
import { deriveRecentSessionsAfterConfigChange, useAppStore } from './store.js';
import { useFnoSession } from './fno-session.js';

function makeConfig(filePath: string, kind: ERComponentKind = ERComponentKind.Format): ERConfiguration {
  return {
    filePath,
    kind,
    solutionVersion: {
      dateTime: '',
      description: '',
      number: 1,
      publicVersionNumber: '1',
      versionStatus: 1,
      solution: {
        id: filePath,
        name: filePath,
        labels: [],
        vendor: { name: '', url: '' },
        contentRefId: '',
      },
    },
    content: { kind } as ERConfiguration['content'],
  };
}

function makeRecentFile(path: string, openedAt: number): RecentFile {
  return {
    path,
    name: path.split('/').pop() ?? path,
    kind: ERComponentKind.Format,
    openedAt,
  };
}

function makeSession(paths: string[], openedAt: number): RecentSession {
  return {
    id: [...paths].sort().join('\u0001'),
    openedAt,
    files: paths.map((path, index) => makeRecentFile(path, openedAt + index)),
  };
}

afterEach(() => {
  useAppStore.setState({
    configurations: [],
    recentFiles: [],
    recentSessions: [],
  });
  useFnoSession.getState().resetAll();
});

describe('deriveRecentSessionsAfterConfigChange', () => {
  it('replaces the active session with the remaining open configurations', () => {
    const previousConfigs = [makeConfig('/tmp/a.xml'), makeConfig('/tmp/b.xml')];
    const nextConfigs = [makeConfig('/tmp/b.xml')];
    const recentSessions = [
      makeSession(['/tmp/a.xml', '/tmp/b.xml'], 100),
      makeSession(['/tmp/older.xml'], 50),
    ];
    const recentFiles = [
      makeRecentFile('/tmp/a.xml', 10),
      makeRecentFile('/tmp/b.xml', 20),
      makeRecentFile('/tmp/older.xml', 30),
    ];

    const next = deriveRecentSessionsAfterConfigChange(
      previousConfigs,
      nextConfigs,
      recentSessions,
      recentFiles,
    );

    expect(next.map(session => session.id)).toEqual([
      '/tmp/b.xml',
      '/tmp/older.xml',
    ]);
    expect(next[0]?.files.map(file => file.path)).toEqual(['/tmp/b.xml']);
    expect(next.some(session => session.id === '/tmp/a.xml\u0001/tmp/b.xml')).toBe(false);
  });

  it('removes the active session when all configurations are closed', () => {
    const previousConfigs = [makeConfig('/tmp/a.xml'), makeConfig('/tmp/b.xml')];
    const recentSessions = [
      makeSession(['/tmp/a.xml', '/tmp/b.xml'], 100),
      makeSession(['/tmp/older.xml'], 50),
    ];
    const recentFiles = [
      makeRecentFile('/tmp/a.xml', 10),
      makeRecentFile('/tmp/b.xml', 20),
      makeRecentFile('/tmp/older.xml', 30),
    ];

    const next = deriveRecentSessionsAfterConfigChange(
      previousConfigs,
      [],
      recentSessions,
      recentFiles,
    );

    expect(next.map(session => session.id)).toEqual(['/tmp/older.xml']);
  });

  it('clears the F&O selection when all configurations are closed', () => {
    useAppStore.setState({
      configurations: [makeConfig('/tmp/a.xml'), makeConfig('/tmp/b.xml')],
      recentFiles: [],
      recentSessions: [],
    });
    useFnoSession.setState({
      selected: new Map([
        ['fmt', { configurationName: 'Format A' } as never],
        ['mm', { configurationName: 'Mapping B' } as never],
      ]),
    });

    useAppStore.getState().removeAllConfigurations();

    expect(useFnoSession.getState().selected.size).toBe(0);
  });
});