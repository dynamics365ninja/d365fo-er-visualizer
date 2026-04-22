import { describe, it, expect, vi } from 'vitest';
import {
  listSolutions,
  listComponents,
  downloadConfigXml,
  escapeODataString,
  decodeXmlPayload,
} from './odata';
import { FnoHttpError, FnoSourceUnsupportedError } from './types';
import type { FnoConnection, FnoTransport, ErConfigSummary } from './types';

const conn: FnoConnection = {
  id: 'test',
  displayName: 'Test',
  envUrl: 'https://org1.sandbox.operations.dynamics.com',
  tenantId: 'tenant',
  clientId: 'client',
  createdAt: 0,
};

function makeTransport(handlers: {
  json?: (url: string) => unknown;
  binary?: (url: string) => ArrayBuffer;
}): FnoTransport {
  return {
    async getJson<T>(url: string): Promise<T> {
      if (!handlers.json) throw new Error('unexpected getJson');
      return handlers.json(url) as T;
    },
    async getBinary(url: string): Promise<ArrayBuffer> {
      if (!handlers.binary) throw new Error('unexpected getBinary');
      return handlers.binary(url);
    },
  };
}

describe('escapeODataString', () => {
  it('doubles single quotes', () => {
    expect(escapeODataString("O'Reilly")).toBe("O''Reilly");
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

describe('listSolutions', () => {
  it('follows @odata.nextLink through multiple pages', async () => {
    const calls: string[] = [];
    const transport = makeTransport({
      json(url) {
        calls.push(url);
        if (calls.length === 1) {
          return {
            value: [{ SolutionName: 'A' }],
            '@odata.nextLink': 'https://next-page/1',
          };
        }
        return { value: [{ SolutionName: 'B' }] };
      },
    });
    const solutions = await listSolutions(transport, conn, 'tok');
    expect(solutions).toHaveLength(2);
    expect(solutions[0].solutionName).toBe('A');
    expect(calls[0]).toContain('/data/ERSolutionEntity');
    expect(calls[1]).toBe('https://next-page/1');
  });
});

describe('listComponents', () => {
  it('filters by solution name and maps rows', async () => {
    let capturedUrl = '';
    const transport = makeTransport({
      json(url) {
        capturedUrl = url;
        return {
          value: [
            {
              ConfigurationName: 'MyConf',
              ComponentType: 'Format',
              ConfigurationRevisionGuid: 'abc-def',
              ConfigurationVersion: '10',
            },
          ],
        };
      },
    });
    const rows = await listComponents(transport, conn, 'tok', "Tax'Report");
    // URLSearchParams encodes spaces as `+`
    expect(decodeURIComponent(capturedUrl).replace(/\+/g, ' '))
      .toContain("SolutionName eq 'Tax''Report'");
    expect(rows[0]).toMatchObject({
      solutionName: "Tax'Report",
      configurationName: 'MyConf',
      componentType: 'Format',
      revisionGuid: 'abc-def',
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

  it('tries revision endpoint first', async () => {
    const xml = '<Root/>';
    const transport = makeTransport({
      binary: vi.fn((url: string) => {
        expect(url).toContain("ERConfigurationRevisionEntity(guid'rev-1')/Content");
        return new TextEncoder().encode(xml).buffer as ArrayBuffer;
      }),
    });
    const result = await downloadConfigXml(transport, conn, 'tok', baseComponent);
    expect(result.xml).toBe(xml);
    expect(result.syntheticPath).toMatch(/^fno:\/\//);
  });

  it('falls back to component endpoint on 404', async () => {
    const calls: string[] = [];
    const transport = makeTransport({
      binary(url: string) {
        calls.push(url);
        if (url.includes('ERConfigurationRevisionEntity')) {
          throw new FnoHttpError('not found', 404, url);
        }
        return new TextEncoder().encode('<X/>').buffer as ArrayBuffer;
      },
    });
    const result = await downloadConfigXml(transport, conn, 'tok', baseComponent);
    expect(result.xml).toBe('<X/>');
    expect(calls).toHaveLength(2);
  });

  it('throws FnoSourceUnsupportedError when all endpoints fail', async () => {
    const transport = makeTransport({
      binary(url: string) {
        throw new FnoHttpError('nope', 404, url);
      },
    });
    await expect(downloadConfigXml(transport, conn, 'tok', baseComponent))
      .rejects.toBeInstanceOf(FnoSourceUnsupportedError);
  });

  it('propagates non-404 HTTP errors (e.g. 401) immediately', async () => {
    const transport = makeTransport({
      binary(url: string) {
        throw new FnoHttpError('auth', 401, url);
      },
    });
    await expect(downloadConfigXml(transport, conn, 'tok', baseComponent))
      .rejects.toBeInstanceOf(FnoHttpError);
  });

  it('throws when the component has no download GUIDs', async () => {
    const transport = makeTransport({});
    await expect(downloadConfigXml(transport, conn, 'tok', {
      ...baseComponent,
      revisionGuid: undefined,
      configurationGuid: undefined,
    })).rejects.toBeInstanceOf(FnoSourceUnsupportedError);
  });
});
