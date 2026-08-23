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

  it('slugifies whitespace, slashes, and strips disallowed characters', () => {
    expect(buildFnoPath({
      envUrl: 'https://org1.sandbox.operations.dynamics.com',
      solutionName: 'Tax Report',
      configurationName: 'Formát: výstup (CZ/SK)',
    })).toBe('fno://org1.sandbox.operations.dynamics.com/Tax-Report/Formt-vstup-CZ-SK.xml');
  });

  it('falls back to manual host extraction for malformed URLs', () => {
    expect(buildFnoPath({
      envUrl: 'https://bad-url-without-host/',
      solutionName: 'A',
      configurationName: 'B',
    })).toMatch(/^fno:\/\/bad-url-without-host\/A\/B\.xml$/);
  });
});
