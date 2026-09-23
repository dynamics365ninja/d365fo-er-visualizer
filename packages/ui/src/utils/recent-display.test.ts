import { describe, expect, it } from 'vitest';
import { describeRecent, formatRelativeTime, parseFnoPath, sessionHeadline } from './recent-display';

describe('recent configurations, as the workspace names them', () => {
  it('names an F&O download by its configuration, with the environment as origin', () => {
    const display = describeRecent({
      path: 'fno://contoso.operations.dynamics.com/Tax-declaration-model/VAT-Control-statement-XML-CZ@136.115.106.xml',
      name: 'VAT-Control-statement-XML-CZ@136.115.106.xml',
      solutionName: 'VAT Control statement XML (CZ)',
      version: '136.115.106',
      kind: 'Format',
      source: 'fno',
      openedAt: 1,
    });
    expect(display).toMatchObject({
      title: 'VAT Control statement XML (CZ)',
      version: '136.115.106',
      source: 'fno',
      origin: 'contoso.operations.dynamics.com',
    });
  });

  it('does not repeat a file name that is just the title again', () => {
    const display = describeRecent({ path: 'VAT Control statement XML (CZ).xml', name: 'VAT Control statement XML (CZ).xml', solutionName: 'VAT Control statement XML (CZ)', openedAt: 1 });
    expect(display.origin).toBeUndefined();
  });

  it('keeps a file name that differs from the configuration name', () => {
    const display = describeRecent({ path: 'export_2026-09.xml', name: 'export_2026-09.xml', solutionName: 'Sales invoice', openedAt: 1 });
    expect(display).toMatchObject({ title: 'Sales invoice', origin: 'export_2026-09.xml', source: 'file' });
  });

  it('names a bundled extract by the bundle it came from', () => {
    const display = describeRecent({ path: 'bundle.xml#datamodel:{A}', name: 'bundle.xml', solutionName: 'Invoice model', openedAt: 1 });
    expect(display).toMatchObject({ title: 'Invoice model', origin: 'bundle.xml', bundled: true });
  });

  it('fills an old session entry from the recent-files list', () => {
    const recent = [{ path: 'a.xml', name: 'a.xml', solutionName: 'Invoice model', version: '12', kind: 'DataModel' as const, openedAt: 1 }];
    expect(describeRecent({ path: 'a.xml', name: 'a.xml', openedAt: 1 }, recent)).toMatchObject({ title: 'Invoice model', version: '12', kind: 'DataModel' });
  });

  it('falls back to a readable name from an old F&O key', () => {
    expect(parseFnoPath('fno://host/Tax-model/Invoice-model@12.3.xml')).toEqual({ host: 'host', solution: 'Tax model', configuration: 'Invoice model', version: '12.3' });
    expect(describeRecent({ path: 'fno://host/Tax-model/Invoice-model@12.3.xml', name: 'Invoice-model@12.3.xml', openedAt: 1 }).title).toBe('Invoice model');
  });

  it('names a session after its format, then lists mapping and model', () => {
    const headline = sessionHeadline({
      id: 's', openedAt: 1, files: [
        { path: 'm.xml', name: 'm.xml', solutionName: 'Tax model', kind: 'DataModel', openedAt: 1 },
        { path: 'f.xml', name: 'f.xml', solutionName: 'VAT statement', kind: 'Format', openedAt: 1 },
        { path: 'mm.xml', name: 'mm.xml', solutionName: 'Tax model mapping', kind: 'ModelMapping', openedAt: 1 },
      ],
    });
    expect(headline.title).toBe('VAT statement');
    expect(headline.others).toBe(2);
    expect(headline.entries.map(e => e.display.kind)).toEqual(['Format', 'ModelMapping', 'DataModel']);
    expect(headline.sources).toEqual([{ source: 'file', origin: undefined }]);
  });

  it('says how long ago, in the UI language', () => {
    const now = Date.UTC(2026, 8, 23, 12);
    expect(formatRelativeTime(now - 30_000, 'en', now)).toBe('this minute');
    expect(formatRelativeTime(now - 3 * 3600_000, 'en', now)).toBe('3 hours ago');
    expect(formatRelativeTime(now - 26 * 3600_000, 'cs', now)).toBe('včera');
  });
});
