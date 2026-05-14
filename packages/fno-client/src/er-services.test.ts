import { describe, it, expect, vi } from 'vitest';
import {
  listSolutions,
  listComponents,
  downloadConfigXml,
  callErService,
  extractOperationNames,
  listServiceOperations,
  ER_SERVICES,
  ER_SERVICE_OPS,
  escapeServiceString,
  decodeXmlPayload,
  buildDownloadAttempts,
  findGuidInVersions,
  extractVersionFromXml,
  extractReferencedDataModelGuids,
  pickDisplayVersion,
} from './er-services';
import { FnoHttpError, FnoSourceUnsupportedError, FnoEmptyContentError } from './types';
import type { FnoConnection, FnoTransport, ErConfigSummary } from './types';

const conn: FnoConnection = {
  id: 'test',
  displayName: 'Test',
  envUrl: 'https://org1.sandbox.operations.dynamics.com',
  tenantId: 'tenant',
  clientId: 'client',
  createdAt: 0,
};

interface PostCall {
  url: string;
  body: unknown;
}

function makeTransport(handlers: {
  post?: (url: string, body: unknown) => unknown;
  getBinary?: (url: string) => ArrayBuffer;
}): { transport: FnoTransport; posts: PostCall[] } {
  const posts: PostCall[] = [];
  const transport: FnoTransport = {
    async getJson(): Promise<never> {
      throw new Error('unexpected getJson');
    },
    async getBinary(url: string): Promise<ArrayBuffer> {
      if (!handlers.getBinary) throw new Error('unexpected getBinary');
      return handlers.getBinary(url);
    },
    async postJson<T>(url: string, _token: string, body: unknown): Promise<T> {
      posts.push({ url, body });
      if (!handlers.post) throw new Error('unexpected postJson');
      return handlers.post(url, body) as T;
    },
  };
  return { transport, posts };
}

describe('escapeServiceString', () => {
  it('doubles single quotes', () => {
    expect(escapeServiceString("O'Reilly")).toBe("O''Reilly");
  });
});

describe('extractOperationNames', () => {
  it('parses <Operation><Name>…</Name></Operation> entries in document order', () => {
    const xml = `<?xml version="1.0"?>
      <Service>
        <Name>ERConfigurationListService</Name>
        <Operations>
          <Operation>
            <Name>doAlpha</Name>
            <Parameters/>
          </Operation>
          <Operation xmlns:x="urn:x">
            <Name>  doBeta  </Name>
          </Operation>
          <Operation>
            <Name>doGamma</Name>
          </Operation>
        </Operations>
      </Service>`;
    expect(extractOperationNames(xml)).toEqual(['doAlpha', 'doBeta', 'doGamma']);
  });

  it('returns an empty array for unrelated XML', () => {
    expect(extractOperationNames('<Service><Name>x</Name></Service>')).toEqual([]);
  });

  it('ignores Name tags that are not inside an <Operation>', () => {
    const xml = `<Service><Name>topLevel</Name><Operations></Operations></Service>`;
    expect(extractOperationNames(xml)).toEqual([]);
  });

  it('parses JSON { Operations: [{ Name: … }] } shape', () => {
    const json = JSON.stringify({
      Name: 'ERConfigurationListService',
      Operations: [{ Name: 'jsonOp1' }, { Name: 'jsonOp2' }],
    });
    expect(extractOperationNames(json)).toEqual(['jsonOp1', 'jsonOp2']);
  });

  it('parses bare JSON array of { Name } objects', () => {
    const json = JSON.stringify([{ Name: 'a' }, { Name: 'b' }]);
    expect(extractOperationNames(json)).toEqual(['a', 'b']);
  });

  it('parses JSON array of strings', () => {
    expect(extractOperationNames('["x","y"]')).toEqual(['x', 'y']);
  });

  it('returns [] for empty/garbage input', () => {
    expect(extractOperationNames('')).toEqual([]);
    expect(extractOperationNames('   ')).toEqual([]);
    expect(extractOperationNames('not xml, not json')).toEqual([]);
  });
});

describe('listServiceOperations', () => {
  it('GETs /api/services/<servicePath> and returns parsed operation names', async () => {
    let capturedUrl = '';
    const xml = '<Operations><Operation><Name>foo</Name></Operation><Operation><Name>bar</Name></Operation></Operations>';
    const { transport } = makeTransport({
      getBinary: (url) => {
        capturedUrl = url;
        return new TextEncoder().encode(xml).buffer as ArrayBuffer;
      },
    });
    const ops = await listServiceOperations(transport, conn, 'tok', ER_SERVICES.configurationList);
    expect(capturedUrl).toBe(`${conn.envUrl}/api/services/${ER_SERVICES.configurationList}`);
    expect(ops).toEqual(['foo', 'bar']);
  });
});

describe('decodeXmlPayload', () => {
  it('decodes UTF-8 text and strips BOM', () => {
    const payload = new TextEncoder().encode('\uFEFF<Root/>');
    expect(decodeXmlPayload(payload.buffer as ArrayBuffer)).toBe('<Root/>');
  });

  it('unwraps JSON-wrapped base64 blob', () => {
    const xml = '<A/>';
    const b64 = typeof Buffer !== 'undefined'
      ? Buffer.from(xml, 'utf-8').toString('base64')
      : btoa(xml);
    const json = JSON.stringify({ value: b64 });
    const buf = new TextEncoder().encode(json);
    expect(decodeXmlPayload(buf.buffer as ArrayBuffer)).toBe(xml);
  });
});

describe('callErService', () => {
  it('POSTs to the correct /api/services URL with the given body', async () => {
    const { transport, posts } = makeTransport({
      post: () => ({ ok: true }),
    });
    const result = await callErService<{ ok: boolean }>(
      transport,
      conn,
      'tok',
      'ERConfigurationServices/ERConfigurationListService',
      'getSolutions',
      { Foo: 'bar' },
    );
    expect(result).toEqual({ ok: true });
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(
      'https://org1.sandbox.operations.dynamics.com/api/services/ERConfigurationServices/ERConfigurationListService/getSolutions',
    );
    expect(posts[0].body).toEqual({ Foo: 'bar' });
  });

  it('trims trailing slashes on envUrl', async () => {
    const connTrail: FnoConnection = { ...conn, envUrl: conn.envUrl + '///' };
    const { transport, posts } = makeTransport({ post: () => ({}) });
    await callErService(transport, connTrail, 'tok', 'G/S', 'op');
    expect(posts[0].url).toBe(`${conn.envUrl}/api/services/G/S/op`);
  });

  it('defaults body to {} when omitted', async () => {
    const { transport, posts } = makeTransport({ post: () => ({}) });
    await callErService(transport, conn, 'tok', 'G/S', 'op');
    expect(posts[0].body).toEqual({});
  });
});

describe('listSolutions', () => {
  // The real listSolutions probes a list of known seed model names.
  // Tests return data for 'Tax declaration model' (a known seed) and
  // empty arrays for everything else to simulate a single-root env.
  const SEED = 'Tax declaration model';

  it('flattens the getFormatSolutionsSubHierarchy tree and keeps only DataModel nodes', async () => {
    const op = ER_SERVICE_OPS.listSolutions[0];
    const { transport, posts } = makeTransport({
      post: (_url, body) => {
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        if (parent === SEED) {
          return {
            [`${op}Result`]: [
              {
                Name: 'Root model',
                FormatMappingGUID: '00000000-0000-0000-0000-000000000000',
                Versions: [{ Status: 0, VersionNumber: 5 }],
                DerivedSolutions: [
                  {
                    Name: 'VAT declaration XML (CZ)',
                    FormatMappingGUID: '3fda8435-873e-4599-83a1-12c15f5a39cb',
                    Versions: [{ Status: 0, VersionNumber: 116 }],
                    DerivedSolutions: [],
                  },
                  {
                    Name: 'Asl Tax declaration model',
                    FormatMappingGUID: '00000000-0000-0000-0000-000000000000',
                    DerivedSolutions: [],
                  },
                ],
              },
              {
                Name: 'Tax declaration model mapping',
                FormatMappingGUID: '00000000-0000-0000-0000-000000000000',
                DerivedSolutions: [],
              },
            ],
          };
        }
        return [];
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    // At least one POST must target the correct service.
    expect(posts.some(p => p.url.includes(`/api/services/${ER_SERVICES.configurationList}/${op}`))).toBe(true);
    const names = solutions.map(s => s.solutionName).sort();
    // DataModel nodes survive; Format and ModelMapping are dropped.
    // The seed itself ('Tax declaration model') is added as a root.
    expect(names).toContain('Asl Tax declaration model');
    expect(names).toContain('Root model');
    expect(names).toContain(SEED);
    expect(names).not.toContain('VAT declaration XML (CZ)');
    expect(names).not.toContain('Tax declaration model mapping');
    for (const s of solutions) {
      expect(s.componentType).toBe('DataModel');
    }
  });

  it('uses the highest VersionNumber from Versions[] as the display version', async () => {
    const op = ER_SERVICE_OPS.listSolutions[0];
    const { transport } = makeTransport({
      post: (_url, body) => {
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        if (parent === SEED) {
          return {
            [`${op}Result`]: [
              {
                Name: 'Some model',
                FormatMappingGUID: '00000000-0000-0000-0000-000000000000',
                Versions: [
                  { Status: 2, VersionNumber: 3 },
                  { Status: 0, VersionNumber: 7 },
                  { Status: 2, VersionNumber: 5 },
                ],
                DerivedSolutions: [],
              },
            ],
          };
        }
        return [];
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    const someModel = solutions.find(s => s.solutionName === 'Some model');
    expect(someModel?.version).toBe('7');
  });

  it('falls through 404 to the next candidate operation name', async () => {
    const op = ER_SERVICE_OPS.listSolutions[2]; // third in list
    const { transport, posts } = makeTransport({
      post: (url, body) => {
        const op2 = url.split('/').pop() ?? '';
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        if (op2 !== op) {
          throw new FnoHttpError('not found', 404, url);
        }
        return parent === SEED
          ? { [`${op}Result`]: [{ Name: 'Z model', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' }] }
          : [];
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    expect(solutions.find(s => s.solutionName === 'Z model')).toBeTruthy();
    // At least one POST reached the winning operation for SEED.
    const seedHits = posts.filter(p =>
      p.url.endsWith(`/${op}`) &&
      (p.body as any)?._parentSolutionName === SEED,
    );
    expect(seedHits.length).toBeGreaterThanOrEqual(1);
  });

  it('throws FnoHttpError listing all tried operations when every candidate 404s', async () => {
    const { transport } = makeTransport({
      post: (url) => { throw new FnoHttpError('not found', 404, url); },
    });
    const promise = listSolutions(transport, conn, 'tok');
    await expect(promise).rejects.toBeInstanceOf(FnoHttpError);
    await expect(promise).rejects.toMatchObject({ status: 404 });
    await expect(promise).rejects.toThrow(/No matching operation/);
    await expect(promise).rejects.toThrow(new RegExp(ER_SERVICE_OPS.listSolutions[0]));
  });

  it('on total fallback failure, enumerates real operations from /api/services and includes them in the error', async () => {
    const xml = '<Operations><Operation><Name>realListOp</Name></Operation><Operation><Name>realOtherOp</Name></Operation></Operations>';
    const { transport } = makeTransport({
      post: (url) => { throw new FnoHttpError('not found', 404, url); },
      getBinary: (url) => {
        expect(url).toBe(`${conn.envUrl}/api/services/${ER_SERVICES.configurationList}`);
        return new TextEncoder().encode(xml).buffer as ArrayBuffer;
      },
    });
    await expect(listSolutions(transport, conn, 'tok'))
      .rejects.toThrow(/Available operations.*realListOp.*realOtherOp/);
  });

  it('swallows discovery errors and still produces a useful error message', async () => {
    const { transport } = makeTransport({
      post: (url) => { throw new FnoHttpError('not found', 404, url); },
      getBinary: () => { throw new FnoHttpError('auth', 403, 'x'); },
    });
    await expect(listSolutions(transport, conn, 'tok'))
      .rejects.toThrow(/No matching operation/);
  });

  it('includes discovery error status in message when GET /api/services/... fails', async () => {
    const { transport } = makeTransport({
      post: (url) => { throw new FnoHttpError('not found', 404, url); },
      getBinary: () => { throw new FnoHttpError('forbidden', 403, 'x'); },
    });
    await expect(listSolutions(transport, conn, 'tok'))
      .rejects.toThrow(/Discovery GET.*returned 403/);
  });

  it('reports when discovery succeeds but returns no operation names', async () => {
    const { transport } = makeTransport({
      post: (url) => { throw new FnoHttpError('not found', 404, url); },
      getBinary: () => new TextEncoder().encode('<Service><Name>x</Name></Service>').buffer as ArrayBuffer,
    });
    await expect(listSolutions(transport, conn, 'tok'))
      .rejects.toThrow(/no <Operation><Name>/);
  });

  it('propagates non-404 HTTP errors (e.g. 401) immediately', async () => {
    const { transport } = makeTransport({
      post: (url) => { throw new FnoHttpError('auth', 401, url); },
    });
    await expect(listSolutions(transport, conn, 'tok')).rejects.toMatchObject({ status: 401 });
  });

  it('accepts bare-array responses (no wrapper)', async () => {
    const { transport } = makeTransport({
      post: (_url, body) => {
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        return parent === SEED ? [{ Name: 'Only model', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' }] : [];
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    expect(solutions.find(s => s.solutionName === 'Only model')).toBeTruthy();
  });

  it('accepts { value: [...] } responses', async () => {
    const { transport } = makeTransport({
      post: (_url, body) => {
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        return parent === SEED ? { value: [{ Name: 'V model', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' }] } : [];
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    expect(solutions.find(s => s.solutionName === 'V model')).toBeTruthy();
  });

  it('discovers DataModel rows from recursive DerivedSolutions', async () => {
    const op = ER_SERVICE_OPS.listSolutions[0];
    const { transport } = makeTransport({
      post: (_url, body) => {
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        if (parent === SEED) {
          // The API returns the full recursive tree in DerivedSolutions.
          return {
            [`${op}Result`]: [
              {
                Name: 'Microsoft',
                Base: '',
                FormatMappingGUID: '00000000-0000-0000-0000-000000000000',
                DerivedSolutions: [
                  { Name: 'MS.Format', Base: 'Microsoft', FormatMappingGUID: '11111111-1111-1111-1111-111111111111' },
                  { Name: 'MS tax model', Base: 'Microsoft', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' },
                  { Name: 'MS bank model', Base: 'Microsoft', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' },
                  { Name: 'MS tax model mapping', Base: 'Microsoft', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' },
                ],
              },
            ],
          };
        }
        return [];
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    const names = solutions.map(s => s.solutionName).sort();
    expect(names).toContain('MS bank model');
    expect(names).toContain('MS tax model');
    expect(names).toContain('Microsoft');
    expect(names).not.toContain('MS.Format');
    expect(names).not.toContain('MS tax model mapping');
  });
});

describe('listComponents', () => {
  it('sends _parentSolutionName parameter and maps result rows', async () => {
    const op = ER_SERVICE_OPS.listComponents[0];
    const { transport, posts } = makeTransport({
      post: () => ({
        [`${op}Result`]: [
          {
            ConfigurationName: 'MyConf',
            ComponentType: 'Format',
            ConfigurationRevisionGuid: 'abc-def',
            ConfigurationVersion: '10',
          },
          {
            Name: 'OtherConf',
            Type: 'DataModel',
            Guid: 'cfg-2',
          },
        ],
      }),
    });
    const rows = await listComponents(transport, conn, 'tok', "Tax'Report");
    const body = posts[0].body as Record<string, unknown>;
    expect(body._parentSolutionName).toBe("Tax'Report");
    expect(posts[0].url).toContain(`/${op}`);

    expect(rows[0]).toMatchObject({
      solutionName: "Tax'Report",
      configurationName: 'MyConf',
      componentType: 'Format',
      revisionGuid: 'abc-def',
      version: '10',
      hasContent: true,
    });
    expect(rows[1]).toMatchObject({
      solutionName: "Tax'Report",
      configurationName: 'OtherConf',
      componentType: 'DataModel',
      configurationGuid: 'cfg-2',
      hasContent: true,
    });
  });
});

describe('downloadConfigXml', () => {
  const baseComponent: ErConfigSummary = {
    solutionName: 'S',
    configurationName: 'C',
    componentType: 'Format',
    revisionGuid: 'rev-1',
    configurationGuid: 'cfg-1',
    hasContent: true,
  };

  it('dispatches Format components to GetEffectiveFormatMappingByID with _formatMappingID body', async () => {
    const op = 'GetEffectiveFormatMappingByID';
    const xml = '<Root/>';
    const postSpy = vi.fn(() => ({ [`${op}Result`]: xml }));
    const { transport, posts } = makeTransport({ post: postSpy });
    const result = await downloadConfigXml(transport, conn, 'tok', baseComponent);
    // The extractor wraps bare payloads in `<ErFnoBundle Name="...">`
    // so the downstream parser has a fallback for the tab label.
    expect(result.xml).toContain(xml);
    expect(result.xml).toMatch(/<ErFnoBundle Name="C">/);
    expect(result.syntheticPath).toMatch(/^fno:\/\//);
    expect(posts[0].url).toContain(`/${ER_SERVICES.configurationStorage}/${op}`);
    const body = posts[0].body as Record<string, unknown>;
    expect(body._formatMappingGuid).toBe('cfg-1');
  });

  it('dispatches ModelMapping components to GetModelMappingByID', async () => {
    const op = 'GetModelMappingByID';
    const xml = '<Mapping/>';
    const { transport, posts } = makeTransport({
      post: () => ({ [`${op}Result`]: xml }),
    });
    const result = await downloadConfigXml(transport, conn, 'tok', {
      ...baseComponent,
      componentType: 'ModelMapping',
    });
    expect(result.xml).toContain(xml);
    expect(posts[0].url).toContain(`/${op}`);
    expect((posts[0].body as Record<string, unknown>)._mappingGuid).toBe('cfg-1');
  });

  it('dispatches DataModel components to GetDataModelByIDAndRevision with _dataModelGuid + _revisionNumber', async () => {
    const op = 'GetDataModelByIDAndRevision';
    const xml = '<Model/>';
    const { transport, posts } = makeTransport({
      post: () => ({ [`${op}Result`]: xml }),
    });
    const result = await downloadConfigXml(transport, conn, 'tok', {
      ...baseComponent,
      componentType: 'DataModel',
      version: '42',
    });
    expect(result.xml).toContain(xml);
    expect(posts[0].url).toContain(`/${op}`);
    const body = posts[0].body as Record<string, unknown>;
    expect(body._dataModelGuid).toBe('cfg-1');
    expect(body._revisionNumber).toBe('42');
  });

  it('extracts referenced DataModel GUIDs from Model="{…}" attributes inside downloaded XML', async () => {
    // F&O `getFormatSolutionsSubHierarchy` returns DataModel rows with
    // only the zero-GUID placeholder, so the *only* reliable way to
    // discover the real DataModel id is to harvest cross-references
    // from the downloaded Format / ModelMapping XML.
    const op = 'GetEffectiveFormatMappingByID';
    const modelGuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const xml =
      `<ERFormatMapping ID.="{FMAP}" Name="X" Format="{F}" FormatVersion="{F},1" ` +
      `Model="{${modelGuid}}" ModelVersion="{${modelGuid}},42" />`;
    const { transport } = makeTransport({ post: () => ({ [`${op}Result`]: xml }) });
    const download = await downloadConfigXml(transport, conn, 'tok', baseComponent);
    expect(download.referencedDataModelGuids).toEqual([modelGuid]);
    expect(download.referencedDataModelRevisions?.[modelGuid]).toBe(42);
  });

  it('ignores zero-GUID Model references', async () => {
    const op = 'GetEffectiveFormatMappingByID';
    const zero = '00000000-0000-0000-0000-000000000000';
    const xml = `<ERFormatMapping ID.="{X}" Model="{${zero}}" ModelVersion="{${zero}},1" />`;
    const { transport } = makeTransport({ post: () => ({ [`${op}Result`]: xml }) });
    const download = await downloadConfigXml(transport, conn, 'tok', baseComponent);
    expect(download.referencedDataModelGuids).toBeUndefined();
  });

  it('extracts DataModel GUID + revision from ModelGuid/RevisionNumber sibling attributes (F&O 2026-04 shape)', async () => {
    // F&O ac365lab-factory (2026-04) carries the DataModel reference
    // as two separate attributes on the same element:
    //   <ERPathExpression ... ModelGuid="{…}" RevisionNumber="120" />
    // The harvest must pair them so UI second-pass can pass the real
    // revision to GetDataModelByIDAndRevision instead of probing.
    const op = 'GetEffectiveFormatMappingByID';
    const modelGuid = '7cde3f27-29b9-41e5-9ca7-b82e7dab08b6';
    const xml =
      `<ERFormatMapping ID.="{FMAP}" Name="X" Format="{F}" FormatVersion="{F},1">` +
      `<ValueSource><ERPathExpression ModelName="TaxDeclarationModel" ` +
      `ModelGuid="{${modelGuid}}" RevisionNumber="120" /></ValueSource>` +
      `</ERFormatMapping>`;
    const { transport } = makeTransport({ post: () => ({ [`${op}Result`]: xml }) });
    const download = await downloadConfigXml(transport, conn, 'tok', baseComponent);
    expect(download.referencedDataModelGuids).toEqual([modelGuid]);
    expect(download.referencedDataModelRevisions?.[modelGuid]).toBe(120);
  });

  it('decodes base64-encoded XML results', async () => {
    const op = 'GetEffectiveFormatMappingByID';
    const xml = '<Root/>';
    const b64 = Buffer.from(xml, 'utf-8').toString('base64');
    const { transport } = makeTransport({
      post: () => ({ [`${op}Result`]: b64 }),
    });
    const result = await downloadConfigXml(transport, conn, 'tok', baseComponent);
    expect(result.xml).toContain(xml);
  });

  it('extracts XML from nested object fields', async () => {
    const op = 'GetEffectiveFormatMappingByID';
    const xml = '<Root/>';
    const { transport } = makeTransport({
      post: () => ({ [`${op}Result`]: { Xml: xml } }),
    });
    const result = await downloadConfigXml(transport, conn, 'tok', baseComponent);
    expect(result.xml).toContain(xml);
  });

  it('falls through 400 on wrong GUID (configurationGuid) to revisionGuid variant', async () => {
    // First attempt uses configurationGuid (cfg-1); on 400 we fall
    // through to the revisionGuid (rev-1) variant.
    const op = 'GetEffectiveFormatMappingByID';
    const { transport, posts } = makeTransport({
      post: (url, body) => {
        const b = body as Record<string, unknown>;
        if (b._formatMappingGuid === 'cfg-1') {
          throw new FnoHttpError('bad request', 400, url, 'GUID not found');
        }
        return { [`${op}Result`]: '<ok/>' };
      },
    });
    const result = await downloadConfigXml(transport, conn, 'tok', baseComponent);
    expect(result.xml).toContain('<ok/>');
    expect(posts.length).toBeGreaterThanOrEqual(2);
    expect((posts[1].body as Record<string, unknown>)._formatMappingGuid).toBe('rev-1');
  });

  it('throws FnoSourceUnsupportedError when every attempt returns 404/400', async () => {
    const { transport } = makeTransport({
      post: (url) => { throw new FnoHttpError('not found', 404, url); },
    });
    await expect(downloadConfigXml(transport, conn, 'tok', baseComponent))
      .rejects.toBeInstanceOf(FnoSourceUnsupportedError);
  });

  it('propagates non-400/404 HTTP errors (e.g. 401) unchanged', async () => {
    const { transport } = makeTransport({
      post: (url) => { throw new FnoHttpError('auth', 401, url); },
    });
    await expect(downloadConfigXml(transport, conn, 'tok', baseComponent))
      .rejects.toBeInstanceOf(FnoHttpError);
  });

  it('throws when the component has no download GUIDs', async () => {
    const { transport } = makeTransport({});
    await expect(downloadConfigXml(transport, conn, 'tok', {
      ...baseComponent,
      revisionGuid: undefined,
      configurationGuid: undefined,
    })).rejects.toBeInstanceOf(FnoSourceUnsupportedError);
  });

  it('throws FnoEmptyContentError when every attempt returns 200 with an empty body', async () => {
    const op = 'GetEffectiveFormatMappingByID';
    const { transport } = makeTransport({
      post: () => ({ [`${op}Result`]: null }),
    });
    await expect(downloadConfigXml(transport, conn, 'tok', baseComponent))
      .rejects.toBeInstanceOf(FnoEmptyContentError);
  });
});

describe('findGuidInVersions', () => {
  it('returns GUID from the highest completed version (not the first in array)', () => {
    const row = {
      Versions: [
        { VersionNumber: 1, Status: 2, RevisionGuid: '{aaaaaaaa-1111-1111-1111-111111111111}' },
        { VersionNumber: 2, Status: 2, RevisionGuid: '{bbbbbbbb-2222-2222-2222-222222222222}' },
        { VersionNumber: 3, Status: 2, RevisionGuid: '{cccccccc-3333-3333-3333-333333333333}' },
      ],
    } as any;
    const result = findGuidInVersions(row);
    expect(result).toBe('cccccccc-3333-3333-3333-333333333333');
  });

  it('prefers completed (Status=2) over draft (Status=1) even if draft has higher version', () => {
    const row = {
      Versions: [
        { VersionNumber: 1, Status: 2, RevisionGuid: '{aaaaaaaa-1111-1111-1111-111111111111}' },
        { VersionNumber: 2, Status: 2, RevisionGuid: '{bbbbbbbb-2222-2222-2222-222222222222}' },
        { VersionNumber: 3, Status: 1, RevisionGuid: '{cccccccc-3333-3333-3333-333333333333}' },
      ],
    } as any;
    const result = findGuidInVersions(row);
    expect(result).toBe('bbbbbbbb-2222-2222-2222-222222222222');
  });

  it('returns undefined when Versions is missing', () => {
    expect(findGuidInVersions({} as any)).toBeUndefined();
  });

  it('returns undefined when all GUIDs are zero-guid', () => {
    const row = {
      Versions: [
        { VersionNumber: 1, Status: 2, RevisionGuid: '{00000000-0000-0000-0000-000000000000}' },
      ],
    } as any;
    expect(findGuidInVersions(row)).toBeUndefined();
  });

  it('handles versions in already-descending order correctly', () => {
    const row = {
      Versions: [
        { VersionNumber: 3, Status: 2, RevisionGuid: '{cccccccc-3333-3333-3333-333333333333}' },
        { VersionNumber: 2, Status: 2, RevisionGuid: '{bbbbbbbb-2222-2222-2222-222222222222}' },
        { VersionNumber: 1, Status: 2, RevisionGuid: '{aaaaaaaa-1111-1111-1111-111111111111}' },
      ],
    } as any;
    const result = findGuidInVersions(row);
    expect(result).toBe('cccccccc-3333-3333-3333-333333333333');
  });

  it('strips braces and ,revision suffix from GUID values', () => {
    const row = {
      Versions: [
        { VersionNumber: 5, Status: 2, SomeField: '{dddddddd-4444-4444-4444-444444444444},7' },
      ],
    } as any;
    const result = findGuidInVersions(row);
    expect(result).toBe('dddddddd-4444-4444-4444-444444444444');
  });
});

describe('buildDownloadAttempts', () => {
  describe('DataModel — version probing', () => {
    it('probes versionNumbers in descending order when provided', () => {
      const component: ErConfigSummary = {
        componentType: 'DataModel',
        configurationGuid: 'aaaaaaaa-0000-0000-0000-000000000001',
        revisionGuid: undefined,
        solutionName: 'TestDM',
        configurationName: 'TestDM',
        versionNumbers: [30, 20, 10],
        hasContent: true,
      };
      const attempts = buildDownloadAttempts(component);
      const dmAttempts = attempts.filter(a => a.operation === 'GetDataModelByIDAndRevision');
      const revisions = dmAttempts.map(a => a.body._revisionNumber);
      // versionNumbers order preserved (descending), then 0 appended
      expect(revisions).toEqual([30, 20, 10, 0]);
    });

    it('probes high→low fallback range when versionNumbers is missing', () => {
      const component: ErConfigSummary = {
        componentType: 'DataModel',
        configurationGuid: 'aaaaaaaa-0000-0000-0000-000000000001',
        revisionGuid: undefined,
        solutionName: 'TestDM',
        configurationName: 'TestDM',
        hasContent: true,
      };
      const attempts = buildDownloadAttempts(component);
      const dmAttempts = attempts.filter(a => a.operation === 'GetDataModelByIDAndRevision');
      const revisions = dmAttempts.map(a => a.body._revisionNumber);
      // Should start from 50 and go down, ending with 0
      expect(revisions[0]).toBe(50);
      expect(revisions[revisions.length - 1]).toBe(0);
      // Verify descending order (except for last 0)
      for (let i = 0; i < revisions.length - 2; i++) {
        expect(revisions[i]).toBeGreaterThan(revisions[i + 1] as number);
      }
    });

    it('inserts displayRev (version) at the beginning if not in versionNumbers', () => {
      const component: ErConfigSummary = {
        componentType: 'DataModel',
        configurationGuid: 'aaaaaaaa-0000-0000-0000-000000000001',
        revisionGuid: undefined,
        solutionName: 'TestDM',
        configurationName: 'TestDM',
        versionNumbers: [10, 5],
        version: '8',
        hasContent: true,
      };
      const attempts = buildDownloadAttempts(component);
      const dmAttempts = attempts.filter(a => a.operation === 'GetDataModelByIDAndRevision');
      const revisions = dmAttempts.map(a => a.body._revisionNumber);
      // displayRev '8' should be first
      expect(revisions[0]).toBe('8');
    });
  });

  describe('ModelMapping — GUID-based lookup', () => {
    it('uses configurationGuid as _mappingGuid in direct lookup attempts', () => {
      const component: ErConfigSummary = {
        componentType: 'ModelMapping',
        configurationGuid: 'bbbbbbbb-0000-0000-0000-000000000002',
        revisionGuid: 'cccccccc-0000-0000-0000-000000000003',
        solutionName: 'TestMapping',
        configurationName: 'TestMapping',
        parentDataModelGuid: 'dddddddd-0000-0000-0000-000000000004',
        descriptorNameCandidates: ['Container1'],
        hasContent: true,
      };
      const attempts = buildDownloadAttempts(component);
      const directAttempts = attempts.filter(
        a => a.operation === 'GetModelMappingByID' && a.body._mappingGuid !== '00000000-0000-0000-0000-000000000000',
      );
      // Both cfgId and revId should be tried as _mappingGuid
      const mappingGuids = directAttempts.map(a => a.body._mappingGuid);
      expect(mappingGuids).toContain('bbbbbbbb-0000-0000-0000-000000000002');
      expect(mappingGuids).toContain('cccccccc-0000-0000-0000-000000000003');
    });

    it('includes fallback attempts via parentDataModelGuid + descriptor', () => {
      const component: ErConfigSummary = {
        componentType: 'ModelMapping',
        configurationGuid: 'bbbbbbbb-0000-0000-0000-000000000002',
        revisionGuid: undefined,
        solutionName: 'TestMapping',
        configurationName: 'TestMapping',
        parentDataModelGuid: 'dddddddd-0000-0000-0000-000000000004',
        descriptorNameCandidates: ['MyContainer'],
        hasContent: true,
      };
      const attempts = buildDownloadAttempts(component);
      const fallbacks = attempts.filter(
        a => a.operation === 'GetModelMappingByID' && a.body._mappingGuid === '00000000-0000-0000-0000-000000000000',
      );
      expect(fallbacks.length).toBeGreaterThan(0);
      const dmGuids = fallbacks.map(a => a.body._dataModelGuid);
      expect(dmGuids).toContain('dddddddd-0000-0000-0000-000000000004');
      const descriptors = fallbacks.map(a => a.body._dataContainerDescriptorName);
      expect(descriptors).toContain('MyContainer');
      expect(descriptors).toContain(''); // empty string fallback always included
    });
  });
});

describe('extractVersionFromXml', () => {
  it('extracts Number from ERSolutionVersion root element', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion DateTime="2025-06-11T07:22:47" Description="test" Number="9" VersionStatus="1">
  <Contents.><ERModelMappingVersion ID.="{1B092C31}" Number="9"/></Contents.>
</ERSolutionVersion>`;
    expect(extractVersionFromXml(xml)).toBe('9');
  });

  it('extracts Number from ERModelMappingVersion element', () => {
    const xml = `<ERModelMappingVersion ID.="{1B092C31-09F2-4CA1-BC3C-E64687C5247C},9" DateTime="2025-06-11" Number="9">`;
    expect(extractVersionFromXml(xml)).toBe('9');
  });

  it('extracts Number from ERFormatVersion element', () => {
    const xml = `<ERFormatVersion ID.="{327440E7-F2AE-46B8-9081-C5152A452A67},39" Number="39">`;
    expect(extractVersionFromXml(xml)).toBe('39');
  });

  it('extracts Number from ERDataModelVersion element', () => {
    const xml = `<ERDataModelVersion ID.="{92AA4172-C84A-4D71-8BFD-1BDBB20A8244},6" Number="6">`;
    expect(extractVersionFromXml(xml)).toBe('6');
  });

  it('returns undefined for XML without version elements', () => {
    expect(extractVersionFromXml('<root><child/></root>')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractVersionFromXml('')).toBeUndefined();
  });

  it('picks the first match (outer ERSolutionVersion) over inner version', () => {
    const xml = `<ERSolutionVersion Number="344" VersionStatus="2">
  <Contents.><ERModelMappingVersion Number="307"/></Contents.>
</ERSolutionVersion>`;
    expect(extractVersionFromXml(xml)).toBe('344');
  });

  it('extracts version from ErFnoBundle wrapper (custom-service payload)', () => {
    const xml = `<ErFnoBundle Name="ACA 1095B PDF Printout" Version="4"><ERTextFormat ID.="{381F3A5D}" Name="ACA 1095B PDF Printout"/></ErFnoBundle>`;
    expect(extractVersionFromXml(xml)).toBe('4');
  });

  it('prefers ER*Version Number over ErFnoBundle Version when both present', () => {
    // Unlikely in practice but the standard element should win
    const xml = `<ErFnoBundle Version="99"><ERSolutionVersion Number="9" VersionStatus="2"/></ErFnoBundle>`;
    expect(extractVersionFromXml(xml)).toBe('9');
  });
});

describe('extractReferencedDataModelGuids – baseOnlyGuids', () => {
  const MODEL_GUID = '11111111-aaaa-aaaa-aaaa-111111111111';
  const BASE_GUID  = '22222222-bbbb-bbbb-bbbb-222222222222';

  it('places Model= GUID in guids but NOT in baseOnlyGuids', () => {
    const xml = `<ERFormatMappingVersion ModelGuid="{${MODEL_GUID}}" RevisionNumber="5"/>`;
    const { guids, baseOnlyGuids } = extractReferencedDataModelGuids(xml);
    expect(guids).toContain(MODEL_GUID);
    expect(baseOnlyGuids.has(MODEL_GUID)).toBe(false);
  });

  it('places Base= GUID in both guids and baseOnlyGuids when no Model= exists', () => {
    const xml = `<ERSolutionVersion Base="{${BASE_GUID}},136" Name="Derived Format">`;
    const { guids, baseOnlyGuids } = extractReferencedDataModelGuids(xml);
    expect(guids).toContain(BASE_GUID);
    expect(baseOnlyGuids.has(BASE_GUID)).toBe(true);
  });

  it('Base= GUID is baseOnly when own Model= GUID is also present', () => {
    const xml = `
<ERSolutionVersion Base="{${BASE_GUID}},136">
  <ERFormatMappingVersion ModelGuid="{${MODEL_GUID}}" RevisionNumber="9"/>
</ERSolutionVersion>`;
    const { guids, baseOnlyGuids } = extractReferencedDataModelGuids(xml);
    expect(guids).toContain(MODEL_GUID);
    expect(guids).toContain(BASE_GUID);
    expect(baseOnlyGuids.has(MODEL_GUID)).toBe(false);
    expect(baseOnlyGuids.has(BASE_GUID)).toBe(true);
  });

  it('baseOnlyGuids is empty when only Model= GUIDs are present', () => {
    const xml = `<ERFormatMappingVersion ModelGuid="{${MODEL_GUID}}" RevisionNumber="3"/>`;
    const { baseOnlyGuids } = extractReferencedDataModelGuids(xml);
    expect(baseOnlyGuids.size).toBe(0);
  });

  it('Base=-only GUID placed in baseOnlyGuids (import format: no Model=)', () => {
    const xml = `<ERSolutionVersion Base="{${BASE_GUID}},50" Name="Import Format"/>`;
    const { baseOnlyGuids } = extractReferencedDataModelGuids(xml);
    expect(baseOnlyGuids.has(BASE_GUID)).toBe(true);
  });

  it('zero GUID in Base= is ignored', () => {
    const xml = `<ERSolutionVersion Base="{00000000-0000-0000-0000-000000000000},1"/>`;
    const { guids, baseOnlyGuids } = extractReferencedDataModelGuids(xml);
    expect(guids).toHaveLength(0);
    expect(baseOnlyGuids.size).toBe(0);
  });
});

describe('pickDisplayVersion', () => {
  it('returns highest completed (Status=2) version number directly', () => {
    const versions = [
      { VersionNumber: 9, Status: 1 }, // draft
      { VersionNumber: 8, Status: 2 }, // completed
    ];
    expect(pickDisplayVersion(versions)).toBe('8');
  });

  it('returns completed over draft even when draft has higher number', () => {
    const versions = [
      { VersionNumber: 344, Status: 2 }, // completed = highest
      { VersionNumber: 345, Status: 1 }, // draft
    ];
    expect(pickDisplayVersion(versions)).toBe('344');
  });

  it('handles Status=3 (Shared) as completed', () => {
    const versions = [{ VersionNumber: 12, Status: 3 }];
    expect(pickDisplayVersion(versions)).toBe('12');
  });

  it('uses VersionStatus field when Status is absent', () => {
    const versions = [
      { VersionNumber: 7, VersionStatus: 2 },
      { VersionNumber: 8, VersionStatus: 1 },
    ];
    expect(pickDisplayVersion(versions)).toBe('7');
  });

  it('falls back to max-1 when no completed version is visible', () => {
    const versions = [
      { VersionNumber: 5, Status: 1 }, // only draft
    ];
    expect(pickDisplayVersion(versions)).toBe('4');
  });

  it('returns undefined when only version is draft v1 (never completed)', () => {
    expect(pickDisplayVersion([{ VersionNumber: 1, Status: 1 }])).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(pickDisplayVersion([])).toBeUndefined();
  });

  it('returns undefined when called with undefined', () => {
    expect(pickDisplayVersion(undefined)).toBeUndefined();
  });
});
