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
  ER_KNOWN_ROOT_SOLUTIONS,
  escapeODataString,
  decodeXmlPayload,
} from './odata';
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

describe('escapeODataString', () => {
  it('doubles single quotes', () => {
    expect(escapeODataString("O'Reilly")).toBe("O''Reilly");
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
  it('flattens the getFormatSolutionsSubHierarchy tree and keeps only DataModel nodes', async () => {
    const op = ER_SERVICE_OPS.listSolutions[0];
    const { transport, posts } = makeTransport({
      // Return data only for the empty-parent probe; known-root probes
      // see no descendants (they're not registered on this mock env).
      post: (_url, body) => {
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        if (parent === '') {
          // Mimics the real ac365lab-factory response shape:
          //   - Format nodes have FormatMappingGUID != zero-guid
          //   - Model nodes: zero GUID + name contains "model"
          //   - Mapping nodes: zero GUID + name contains "mapping"
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
    expect(posts[0].url).toContain(`/api/services/${ER_SERVICES.configurationList}/${op}`);
    const names = solutions.map(s => s.solutionName).sort();
    // Only the two DataModel nodes survive ("Root model", "Asl Tax declaration model").
    // The Format node and the ModelMapping node are dropped.
    expect(names).toEqual(['Asl Tax declaration model', 'Root model']);
    for (const s of solutions) {
      expect(s.componentType).toBe('DataModel');
    }
  });

  it('uses the highest VersionNumber from Versions[] as the display version', async () => {
    const op = ER_SERVICE_OPS.listSolutions[0];
    const { transport } = makeTransport({
      post: (_url, body) => {
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        if (parent === '') {
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
    expect(solutions[0].version).toBe('7');
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
        return parent === ''
          ? { [`${op}Result`]: [{ Name: 'Z model', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' }] }
          : [];
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    expect(solutions[0]).toMatchObject({ solutionName: 'Z model' });
    // First probe (empty parent) runs through all candidates until the
    // third wins (3 posts); each subsequent known-root probe runs only
    // the winning op (1 post per probe).
    expect(posts.filter(p => p.url.endsWith(`/${op}`))).toHaveLength(
      1 + ER_KNOWN_ROOT_SOLUTIONS.length,
    );
  });

  it('throws FnoHttpError listing all tried operations when every candidate 404s', async () => {
    const { transport, posts } = makeTransport({
      post: (url) => { throw new FnoHttpError('not found', 404, url); },
    });
    const promise = listSolutions(transport, conn, 'tok');
    await expect(promise).rejects.toBeInstanceOf(FnoHttpError);
    await expect(promise).rejects.toMatchObject({ status: 404 });
    await expect(promise).rejects.toThrow(/No matching operation/);
    await expect(promise).rejects.toThrow(new RegExp(ER_SERVICE_OPS.listSolutions[0]));
    // The first probe (empty parent) exhausts all candidates and throws;
    // subsequent probes never run.
    expect(posts.length).toBe(ER_SERVICE_OPS.listSolutions.length);
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

  it('propagates non-404 HTTP errors (e.g. 401) without trying other candidates', async () => {
    const { transport, posts } = makeTransport({
      post: (url) => { throw new FnoHttpError('auth', 401, url); },
    });
    await expect(listSolutions(transport, conn, 'tok')).rejects.toMatchObject({ status: 401 });
    expect(posts).toHaveLength(1);
  });

  it('accepts bare-array responses (no wrapper)', async () => {
    const { transport } = makeTransport({
      post: (_url, body) => {
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        return parent === '' ? [{ Name: 'Only model', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' }] : [];
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    expect(solutions).toEqual([{ solutionName: 'Only model', publisher: undefined, version: undefined, displayName: undefined, componentType: 'DataModel' }]);
  });

  it('accepts { value: [...] } responses', async () => {
    const { transport } = makeTransport({
      post: (_url, body) => {
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        return parent === '' ? { value: [{ Name: 'V model', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' }] } : [];
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    expect(solutions[0].solutionName).toBe('V model');
  });

  it('aggregates DataModel rows from multiple known-root probes and drops typed Format/ModelMapping rows', async () => {
    const op = ER_SERVICE_OPS.listSolutions[0];
    const { transport } = makeTransport({
      post: (_url, body) => {
        const parent = (body as { _parentSolutionName?: string } | undefined)?._parentSolutionName;
        if (parent === 'Microsoft') {
          return {
            [`${op}Result`]: [
              // Format nodes (non-zero GUID) dropped.
              { Name: 'MS.Format', FormatMappingGUID: '11111111-1111-1111-1111-111111111111' },
              // DataModel descendants kept (zero GUID + "model").
              { Name: 'MS tax model', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' },
              { Name: 'MS bank model', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' },
              // Mapping dropped.
              { Name: 'MS tax model mapping', FormatMappingGUID: '00000000-0000-0000-0000-000000000000' },
            ],
          };
        }
        return [];
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    const names = solutions.map(s => s.solutionName).sort();
    // The probe root "Microsoft" is also injected (as a DataModel) so
    // users can drill through it. The two model descendants join it.
    // "MS.Format" and "MS tax model mapping" are dropped.
    expect(names).toContain('MS bank model');
    expect(names).toContain('MS tax model');
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
