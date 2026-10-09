import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { parseERConfigurations, type ERConfiguration } from '@er-visualizer/core';
import type { ErConfigDownload, ErConfigSummary, FnoConnection } from '@er-visualizer/fno-client';
import { FnoEmptyContentError } from '@er-visualizer/fno-client';
import type { FnoIngestItem } from '../../state/store';
import { t } from '../../i18n';
import { componentKey } from './shared';
import { planIngest } from './plan';
import { runFnoIngest } from './run-ingest';
import type { FnoIngestDeps, FnoIngestNotice, FnoIngestQueuedItem, FnoIngestRequest } from './types';

const conn: FnoConnection = { id: 'p1', displayName: 'Test', envUrl: 'https://test.dynamics.com', createdAt: 0 };

function summary(
  componentType: ErConfigSummary['componentType'],
  name: string,
  extra: Partial<ErConfigSummary> = {},
): ErConfigSummary {
  return { solutionName: 'Invoice model', configurationName: name, componentType, hasContent: true, ...extra };
}

function download(component: ErConfigSummary, extra: Partial<ErConfigDownload> = {}): ErConfigDownload {
  return {
    xml: `<ERSolutionVersion Name="${component.configurationName}"/>`,
    syntheticPath: `fno://${component.componentType}/${component.configurationName}.xml`,
    source: component,
    ...extra,
  };
}

type Responder = (component: ErConfigSummary, call: { silent: boolean }) => Promise<ErConfigDownload>;

/**
 * Fake F&O session. Like the real one it refuses to start a request once the
 * signal is aborted; every call is logged in the order it was made.
 */
function fakeClient(respond: Responder, listings: Record<string, ErConfigSummary[]> = {}) {
  const downloads: Array<{ component: ErConfigSummary; silent: boolean }> = [];
  const listed: string[] = [];
  const client: FnoIngestDeps['client'] = {
    async listComponents(_conn, solutionName, opts) {
      opts?.signal?.throwIfAborted();
      listed.push(solutionName);
      return listings[solutionName] ?? [];
    },
    async downloadConfiguration(_conn, component, signal, opts) {
      signal?.throwIfAborted();
      const silent = opts?.silent ?? false;
      downloads.push({ component, silent });
      return respond(component, { silent });
    },
  };
  return { client, downloads, listed };
}

/** Everything the ingest wrote to the app, captured for assertions. */
function fakeDeps(client: FnoIngestDeps['client']) {
  const loaded: string[] = [];
  const statuses: string[] = [];
  const notices: FnoIngestNotice[] = [];
  const begun: FnoIngestQueuedItem[][] = [];
  const updates: Array<Partial<FnoIngestItem>> = [];
  const removed: string[] = [];
  let ended = 0;
  const deps: FnoIngestDeps = {
    client,
    workspace: {
      configurations: () => [],
      loadXml: (_xml, filePath) => { loaded.push(filePath); },
      addInheritedLabels: vi.fn(),
      refreshLabelPool: vi.fn(),
    },
    progress: {
      begin: items => { begun.push(items); },
      status: text => { statuses.push(text); },
      updateItem: item => { updates.push(item); },
      removeItem: key => { removed.push(key); },
      items: () => [],
      end: () => { ended += 1; },
    },
    notify: notice => { notices.push(notice); },
  };
  return { deps, loaded, statuses, notices, begun, updates, removed, ended: () => ended };
}

/** `fakeDeps` whose workspace parses what it is given, as the app's store does. */
function parsingDeps(client: FnoIngestDeps['client']) {
  const fake = fakeDeps(client);
  const configs: ERConfiguration[] = [];
  fake.deps.workspace.configurations = () => configs;
  fake.deps.workspace.loadXml = (xml, filePath) => {
    fake.loaded.push(filePath);
    configs.push(...parseERConfigurations(xml, filePath));
  };
  return fake;
}

function request(selected: ErConfigSummary[], extra: Partial<FnoIngestRequest> = {}): FnoIngestRequest {
  return {
    connection: conn,
    selected: new Map(selected.map(c => [componentKey(c), c])),
    allDataModelsSeen: new Map(),
    solutions: [],
    rootComponentCache: new Map(),
    signal: new AbortController().signal,
    ...extra,
  };
}

const empty = (c: ErConfigSummary) => Promise.reject(new FnoEmptyContentError(`no XML for ${c.configurationName}`));

// The pipeline logs every phase; keep the test output readable.
beforeEach(() => {
  for (const level of ['info', 'debug', 'warn', 'error', 'table'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('planIngest', () => {
  it('adds the DataModel a selected format lives under, found by name', () => {
    const model = summary('DataModel', 'Invoice model', { configurationGuid: 'dm-guid' });
    const format = summary('Format', 'Sales invoice');
    const plan = planIngest(request([format], {
      allDataModelsSeen: new Map([[componentKey(model), model]]),
    }));
    expect([...plan.values()].map(c => c.configurationName)).toEqual(['Sales invoice', 'Invoice model']);
  });

  it('synthesises the model from the listing Base id when it was never browsed', () => {
    const format = summary('Format', 'Import format', {
      referencedModelGuid: 'base-guid',
      parentConfigName: 'Statement model (derived)',
      ownerDataModelName: 'Statement model (derived)',
    });
    const plan = [...planIngest(request([format])).values()];
    // Named after the model the format sits under, not the listing root.
    expect(plan[1]).toMatchObject({
      componentType: 'DataModel',
      configurationGuid: 'base-guid',
      configurationName: 'Statement model (derived)',
    });
  });

  it('does not take a derived format\'s Base for a model id', () => {
    // `Base` of a format derived from another format is that base FORMAT; asked
    // for as a model it came back empty after a dozen revisions and left an
    // empty "model" row in the download log.
    const format = summary('Format', 'Bank format (Contoso)', {
      referencedModelGuid: 'base-format-guid',
      parentConfigName: 'Bank format',
      ownerDataModelName: 'Invoice model',
    });
    expect([...planIngest(request([format])).values()].map(c => c.componentType)).toEqual(['Format']);
  });

  it('plans nothing for an empty selection', () => {
    expect(planIngest(request([])).size).toBe(0);
  });
});

describe('runFnoIngest', () => {
  it('downloads the data model first, then mappings, then formats', async () => {
    const model = summary('DataModel', 'Invoice model', { configurationGuid: 'dm-guid' });
    const mapping = summary('ModelMapping', 'Invoice model mapping', { configurationGuid: 'mm-guid' });
    const format = summary('Format', 'Sales invoice');
    const selected = [format, mapping];
    const { client, downloads } = fakeClient(c =>
      [model, mapping, format].includes(c) ? Promise.resolve(download(c)) : empty(c));
    const { deps, loaded, begun } = fakeDeps(client);

    const result = await runFnoIngest(request(selected, {
      allDataModelsSeen: new Map([[componentKey(model), model]]),
    }), deps);

    expect(downloads.slice(0, 3).map(d => d.component.configurationName))
      .toEqual(['Invoice model', 'Invoice model mapping', 'Sales invoice']);
    expect(loaded).toHaveLength(3);
    // The auto-included model is queued as a dependency, not as the user's pick.
    expect(begun[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Invoice model', explicit: false }),
      expect.objectContaining({ name: 'Sales invoice', explicit: true }),
    ]));
    expect(result).toMatchObject({ loaded: 3, skippedEmpty: 0, queued: 3, cancelled: false });
  });

  it('follows a model referenced from inside the format XML, named after the listing row', async () => {
    const format = summary('Format', 'Sales invoice', { ownerDataModelName: 'Invoice model' });
    const { client, downloads } = fakeClient(c => {
      if (c === format) return Promise.resolve(download(c, { referencedDataModelGuids: ['ref-guid'] }));
      if (c.componentType === 'DataModel' && c.configurationGuid === 'ref-guid') return Promise.resolve(download(c));
      return empty(c);
    });
    const { deps, loaded } = fakeDeps(client);

    const result = await runFnoIngest(request([format]), deps);

    const names = downloads.map(d => `${d.component.componentType}:${d.component.configurationName}`);
    expect(names.indexOf('DataModel:Invoice model')).toBeGreaterThan(names.indexOf('Format:Sales invoice'));
    expect(loaded).toHaveLength(2);
    expect(result.loaded).toBe(2);
  });

  it('reports each phase and releases the progress dialog at the end', async () => {
    const model = summary('DataModel', 'Invoice model', { configurationGuid: 'dm-guid' });
    const format = summary('Format', 'Sales invoice');
    const { client } = fakeClient(c => (c === model || c === format ? Promise.resolve(download(c)) : empty(c)));
    const { deps, statuses, ended } = fakeDeps(client);

    await runFnoIngest(request([format], {
      allDataModelsSeen: new Map([[componentKey(model), model]]),
    }), deps);

    expect(statuses[0]).toBe(t.fnoStatusPreparing);
    expect(statuses).toContain(t.fnoStatusDownloadingDM(1));
    expect(statuses).toContain(t.fnoStatusDownloadingFM(1));
    expect(statuses[statuses.length - 1]).toBe('');
    expect(ended()).toBe(1);
  });

  it('keeps going past a failed item and reports it', async () => {
    const formats = ['A', 'B', 'C'].map(n => summary('Format', `Format ${n}`));
    const { client } = fakeClient(c => (c === formats[1]
      ? Promise.reject(new Error('HTTP 500'))
      : formats.includes(c) ? Promise.resolve(download(c)) : empty(c)));
    const { deps, loaded, notices } = fakeDeps(client);

    const result = await runFnoIngest(request(formats), deps);

    expect(loaded).toEqual(['fno://Format/Format A.xml', 'fno://Format/Format C.xml']);
    expect(notices).toContainEqual({ kind: 'error', message: t.fnoDownloadFailed('Format B', 'HTTP 500') });
    // A partial failure is no cancellation: the caller still reports success
    // for what arrived, and keeps the failed item selected (loaded < queued).
    expect(result).toMatchObject({ loaded: 2, skippedEmpty: 0, queued: 3, cancelled: false });
  });

  it('counts a selected item without own XML as skipped, not failed', async () => {
    const formats = [summary('Format', 'Format A'), summary('Format', 'Derived B')];
    const { client } = fakeClient(c => (c === formats[0] ? Promise.resolve(download(c)) : empty(c)));
    const { deps, notices } = fakeDeps(client);

    const result = await runFnoIngest(request(formats), deps);

    expect(notices).toContainEqual({ kind: 'info', message: t.fnoSkippedDerived('Derived B') });
    expect(notices.some(n => n.kind === 'error')).toBe(false);
    expect(result).toMatchObject({ loaded: 1, skippedEmpty: 1, queued: 2 });
  });

  it('stops downloading once cancelled and reports no success', async () => {
    const formats = ['A', 'B', 'C', 'D'].map(n => summary('Format', `Format ${n}`));
    const abort = new AbortController();
    let completedAfterAbort = 0;
    const { client, downloads } = fakeClient(async c => {
      // The user disconnects while the first batch (A, B) is in flight.
      await Promise.resolve();
      if (c === formats[0]) abort.abort();
      else if (abort.signal.aborted) completedAfterAbort += 1;
      return download(c);
    });
    const { deps, loaded, notices, statuses, ended } = fakeDeps(client);

    const result = await runFnoIngest(request(formats, { signal: abort.signal }), deps);

    // A and B were already on the wire; nothing started after the abort.
    expect(downloads.map(d => d.component.configurationName)).toEqual(['Format A', 'Format B']);
    expect(loaded).toHaveLength(2);
    expect(completedAfterAbort).toBe(1); // B, requested before the abort
    expect(result.cancelled).toBe(true);
    expect(notices.some(n => n.kind === 'success')).toBe(false);
    expect(notices.some(n => n.message === t.fnoIngestAborted(String(abort.signal.reason)))).toBe(false);
    // The items the abort refused (C, D) are not reported as failed downloads.
    expect(notices.filter(n => n.kind === 'error')).toEqual([]);
    // The progress dialog is still released.
    expect(statuses[statuses.length - 1]).toBe('');
    expect(ended()).toBe(1);
  });

  it('fetches nothing when the selection is empty', async () => {
    const { client, downloads, listed } = fakeClient(empty);
    const { deps, begun } = fakeDeps(client);

    const result = await runFnoIngest(request([]), deps);

    expect(downloads).toHaveLength(0);
    expect(listed).toHaveLength(0);
    expect(begun).toHaveLength(0);
    expect(result).toEqual({ loaded: 0, skippedEmpty: 0, queued: 0, cancelled: false, warnings: [] });
  });
});

describe('runFnoIngest — an import format', () => {
  const MODEL = '94A18CF9-13A5-40D7-8185-AF474661D4D0';
  const FORMAT = 'DBE9510B-02ED-4930-9F7B-0E8AF5726C78';
  const OWN_MAPPING = 'A4A06A3C-9FA8-423F-9FA0-47D02EB9005B';
  const OTHER_FORMAT = '11111111-2222-4333-8444-555555555555';

  const formatToModel = (mappingId: string, formatGuid: string, name: string) =>
    `<ERModelMapping Model="{${MODEL}}" DataContainerDescriptor="Document" ID.="{${mappingId}}" ModelName="Statement model" Name="${name}">` +
    '<Datasource><ERModelDefinition><Contents.><ERModelItemDefinition><ValueDefinition><ERModelItemValueDefinition Name="format"><ValueSource>' +
    `<ERImportFormatDatasource FormatGUID="{${formatGuid}}" />` +
    '</ValueSource></ERModelItemValueDefinition></ValueDefinition></ERModelItemDefinition></Contents.></ERModelDefinition></Datasource>' +
    '</ERModelMapping>';
  /** What fno-client hands over: the format with its own mapping spliced in. */
  const formatBundle =
    '<ErFnoBundle Name="Statement format" Version="24">' +
    `<ERTextFormat ID.="{${FORMAT}}" DataImportSupport="1" Name="Statement format"><Root /></ERTextFormat>` +
    `<ERFormatMapping ID.="{59AA8316-9563-400E-AAAD-99DDD3E03F4C}" Format="{${FORMAT}}" Name="Statement format" />` +
    formatToModel(OWN_MAPPING, FORMAT, 'Statement format mapping') +
    '</ErFnoBundle>';
  const modelBundle =
    '<ErFnoBundle Name="Statement model" Version="4">' +
    `<ERDataModel ID.="{${MODEL}}" Name="Statement model"><Contents.>` +
    '<ERDataContainerDescriptor ID.="{CONT}" Name="Document" IsRoot="1" />' +
    '</Contents.></ERDataModel></ErFnoBundle>';
  const mappingBundle = (definition: string) =>
    '<ErFnoBundle Name="Mapping to destination"><ERModelMappingVersion ID.="{MAPV},1" Number="1"><Mapping>' +
    definition +
    '</Mapping></ERModelMappingVersion></ErFnoBundle>';

  const format = summary('Format', 'Statement format', {
    solutionName: 'Statement model',
    configurationGuid: 'fm-guid',
    ownerDataModelName: 'Statement model',
    parentConfigName: 'Statement model',
  });
  // The model and its destination mapping: F&O lists both without an id.
  const listing: Record<string, ErConfigSummary[]> = {
    'Statement model': [
      summary('DataModel', 'Statement model', { solutionName: 'Statement model', hasContent: false }),
      summary('ModelMapping', 'Mapping to destination', {
        solutionName: 'Statement model',
        hasContent: false,
        ownerDataModelName: 'Statement model',
        parentConfigName: 'Statement model',
      }),
    ],
  };

  /** F&O as it answers for this load; `mapping` is what a lookup by model returns. */
  const respond = (mapping: string | null) => (c: ErConfigSummary) => {
    if (c.componentType === 'Format' && c.configurationName === format.configurationName) {
      return Promise.resolve(download(c, { xml: formatBundle, referencedDataModelGuids: [MODEL.toLowerCase()] }));
    }
    if (c.componentType === 'DataModel' && c.configurationGuid?.toLowerCase() === MODEL.toLowerCase()) {
      return Promise.resolve(download(c, { xml: modelBundle }));
    }
    if (c.componentType === 'ModelMapping' && mapping) return Promise.resolve(download(c, { xml: mapping }));
    return empty(c);
  };

  it('keeps a mapping that parses another format out of the workspace', async () => {
    // The reported case: the lookup by model answered with another bank
    // format's mapping, which then sat in the workspace as if it were ours.
    const { client, downloads } = fakeClient(
      respond(mappingBundle(formatToModel('B0000000-0000-4000-8000-000000000001', OTHER_FORMAT, 'Other format mapping'))),
      listing,
    );
    const { deps, loaded, updates } = parsingDeps(client);

    const result = await runFnoIngest(request([format]), deps);

    const probe = downloads.find(d => d.component.componentType === 'ModelMapping')?.component;
    expect(probe).toBeDefined();
    expect(loaded).not.toContain(download(probe!).syntheticPath);
    expect(loaded).toHaveLength(2); // the format and its model
    expect(updates).toContainEqual(expect.objectContaining({
      key: componentKey(probe!),
      status: 'skipped',
      message: t.fnoIngestOtherFormatMapping,
    }));
    expect(result.warnings).toEqual([t.fnoImportMappingNotFound(['Statement model'])]);
  });

  it('does not load the format\'s own mapping a second time', async () => {
    const { client, downloads } = fakeClient(
      respond(mappingBundle(formatToModel(OWN_MAPPING, FORMAT, 'Statement format mapping'))),
      listing,
    );
    const { deps, loaded, removed } = parsingDeps(client);

    const result = await runFnoIngest(request([format]), deps);

    const probe = downloads.find(d => d.component.componentType === 'ModelMapping')?.component;
    expect(loaded).toHaveLength(2);
    // The probe's row would announce a configuration the workspace does not have.
    expect(removed).toEqual([componentKey(probe!)]);
    expect(result.warnings).toEqual([]);
  });

  it('loads a destination mapping', async () => {
    const destination = mappingBundle(
      `<ERModelMapping ID.="{D0000000-0000-4000-8000-000000000001}" Name="Mapping to destination" DataContainerDescriptor="Document" Model="{${MODEL}}">` +
      '<Datasource><ERModelDefinition><Contents. /></ERModelDefinition></Datasource></ERModelMapping>',
    );
    const { client } = fakeClient(respond(destination), listing);
    const { deps, loaded } = parsingDeps(client);

    const result = await runFnoIngest(request([format]), deps);

    expect(loaded).toHaveLength(3);
    expect(result.warnings).toEqual([]);
  });

  it('guesses no mapping once the user picked the related ones', async () => {
    // The user answered "Also load related configurations?": a mapping found by
    // a lookup on top of that pick is one they did not ask for.
    const { client, downloads } = fakeClient(respond(mappingBundle('<ERModelMapping ID.="{X}" />')), listing);
    const { deps, loaded } = parsingDeps(client);

    const result = await runFnoIngest(request([{ ...format, relatedChosen: true }]), deps);

    expect(downloads.some(d => d.component.componentType === 'ModelMapping')).toBe(false);
    expect(loaded).toHaveLength(2); // the format, and the model its own mapping names
    expect(result.warnings).toEqual([]);
  });

  it('scouts only the mappings of the format\'s own model, and none once the user picked', async () => {
    const own = summary('ModelMapping', 'Statement destination', {
      solutionName: 'Statement model', configurationGuid: 'own-mm', ownerDataModelName: 'Statement model',
    });
    const foreign = summary('ModelMapping', 'Derived model destination', {
      solutionName: 'Statement model', configurationGuid: 'derived-mm', ownerDataModelName: 'Statement model (derived)',
    });
    const rootComponentCache = new Map([['Statement model', [own, foreign]]]);
    const scouted = async (selectedFormat: ErConfigSummary) => {
      const { client, downloads } = fakeClient(respond(null), listing);
      await runFnoIngest(request([selectedFormat], { rootComponentCache }), fakeDeps(client).deps);
      return downloads.filter(d => d.component === own || d.component === foreign).map(d => d.component.configurationName);
    };

    expect(await scouted(format)).toEqual(['Statement destination']);
    expect(await scouted({ ...format, relatedChosen: true })).toEqual([]);
  });
});
