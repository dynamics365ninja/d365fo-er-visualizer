import { describe, it, expect } from 'vitest';
import { buildFnoPath } from './path-key';

describe('buildFnoPath', () => {
  it('produces a stable fno:// scheme with host + solution + config name', () => {
    expect(buildFnoPath({
      envUrl: 'https://org1.sandbox.operations.dynamics.com',
      solutionName: 'TaxReport',
      configurationName: 'Intrastat model mapping',
    })).toBe('fno://org1.sandbox.operations.dynamics.com/TaxReport/Intrastat-model-mapping.xml');
  });

  it('appends an @version suffix when version is provided', () => {
    expect(buildFnoPath({
      envUrl: 'https://org1.sandbox.operations.dynamics.com',
      solutionName: 'TaxReport',
      configurationName: 'Intrastat',
      version: '252',
    })).toBe('fno://org1.sandbox.operations.dynamics.com/TaxReport/Intrastat@252.xml');
  });

  it('slugifies whitespace, slashes, and strips disallowed ASCII characters', () => {
    // Persisted key — must never change for ASCII names.
    expect(buildFnoPath({
      envUrl: 'https://org1.sandbox.operations.dynamics.com',
      solutionName: 'Tax Report',
      configurationName: 'Format: output (CZ/SK)',
    })).toBe('fno://org1.sandbox.operations.dynamics.com/Tax-Report/Format-output-CZ-SK.xml');
  });

  it('keeps the readable slug but adds a stable hash when non-ASCII characters are dropped', () => {
    const key = buildFnoPath({
      envUrl: 'https://org1.sandbox.operations.dynamics.com',
      solutionName: 'Tax Report',
      configurationName: 'Formát: výstup (CZ/SK)',
    });
    expect(key).toMatch(/^fno:\/\/org1\.sandbox\.operations\.dynamics\.com\/Tax-Report\/Formt-vstup-CZ-SK~[0-9a-z]+\.xml$/);
    expect(buildFnoPath({
      envUrl: 'https://org1.sandbox.operations.dynamics.com',
      solutionName: 'Tax Report',
      configurationName: 'Formát: výstup (CZ/SK)',
    })).toBe(key);
  });

  it('does not collapse CJK names to one empty key', () => {
    const a = buildFnoPath({ envUrl: 'https://e.operations.dynamics.com', solutionName: '增值税', configurationName: '发票' });
    const b = buildFnoPath({ envUrl: 'https://e.operations.dynamics.com', solutionName: '增值税', configurationName: '收据' });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^fno:\/\/e\.operations\.dynamics\.com\/~[0-9a-z]+\/~[0-9a-z]+\.xml$/);
  });

  it('keeps Faktura and Fakturá apart', () => {
    const plain = buildFnoPath({ envUrl: 'https://e.operations.dynamics.com', solutionName: 'S', configurationName: 'Faktura' });
    const accented = buildFnoPath({ envUrl: 'https://e.operations.dynamics.com', solutionName: 'S', configurationName: 'Fakturá' });
    expect(plain).toBe('fno://e.operations.dynamics.com/S/Faktura.xml');
    expect(accented).not.toBe(plain);
  });

  it('does not let an @ in the name impersonate the version suffix', () => {
    const named = buildFnoPath({ envUrl: 'https://e.operations.dynamics.com', solutionName: 'S', configurationName: 'Foo@1' });
    const versioned = buildFnoPath({ envUrl: 'https://e.operations.dynamics.com', solutionName: 'S', configurationName: 'Foo', version: '1' });
    expect(versioned).toBe('fno://e.operations.dynamics.com/S/Foo@1.xml');
    expect(named).not.toBe(versioned);
    expect(named).not.toContain('@');
  });

  it('falls back to manual host extraction for malformed URLs', () => {
    expect(buildFnoPath({
      envUrl: 'https://bad-url-without-host/',
      solutionName: 'A',
      configurationName: 'B',
    })).toMatch(/^fno:\/\/bad-url-without-host\/A\/B\.xml$/);
  });
});
