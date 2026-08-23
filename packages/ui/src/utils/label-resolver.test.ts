import { describe, it, expect } from 'vitest';
import { buildLabelPool, labelDisplayText, looksLikeLabelRef, normalizeLabelRef, resolveLabel } from './label-resolver';

const config = (labels: Array<{ labelId: string; languageId: string; labelValue: string }>) => ({
  solutionVersion: { solution: { labels } },
});

describe('buildLabelPool', () => {
  it('falls back to the data model when the format carries no label texts', () => {
    const configurations = [
      config([]), // format
      config([{ labelId: 'GER_Amount', languageId: 'en-US', labelValue: 'Amount' }]), // data model
    ];

    const pool = buildLabelPool(configurations, 0);
    expect(resolveLabel('@"GER_Amount"', pool)?.enUs).toBe('Amount');
  });

  it('prefers the configuration own translation over other loaded files', () => {
    const configurations = [
      config([{ labelId: 'GER_Amount', languageId: 'en-US', labelValue: 'Own amount' }]),
      config([{ labelId: 'GER_Amount', languageId: 'en-US', labelValue: 'Model amount' }]),
    ];

    const pool = buildLabelPool(configurations, 0);
    expect(resolveLabel('GER_Amount', pool)?.enUs).toBe('Own amount');
  });

  it('returns the same pool instance for repeated lookups', () => {
    const configurations = [config([]), config([])];
    expect(buildLabelPool(configurations, 0)).toBe(buildLabelPool(configurations, 0));
  });
});

describe('resolveLabel GER_LABEL references', () => {
  const labels = (labelId: string) => [{ labelId, languageId: 'en-US', labelValue: 'Amount' }];

  it('matches a table that stores the id with the GER_LABEL prefix', () => {
    expect(resolveLabel('@"GER_LABEL:Foo"', labels('GER_LABEL:Foo'))?.enUs).toBe('Amount');
  });

  it('matches a table that stores the id without the GER_LABEL prefix', () => {
    expect(resolveLabel('@"GER_LABEL:Foo"', labels('Foo'))?.enUs).toBe('Amount');
  });

  it('matches a prefix-less reference against a prefixed table id', () => {
    expect(resolveLabel('@"Foo"', labels('GER_LABEL:Foo'))?.enUs).toBe('Amount');
  });

  it('matches the unquoted reference form', () => {
    expect(resolveLabel('@GER_LABEL:Foo', labels('Foo'))?.enUs).toBe('Amount');
  });

  it('matches ids case-insensitively', () => {
    expect(resolveLabel('@"GER_LABEL:foo"', labels('Foo'))?.enUs).toBe('Amount');
  });

  it('matches ids that merely start with GER_LABEL_', () => {
    expect(resolveLabel('@"GER_LABEL_1"', labels('GER_LABEL_1'))?.enUs).toBe('Amount');
  });

  it('normalises the id consistently whether or not it resolved', () => {
    expect(resolveLabel('@"GER_LABEL:Foo"', labels('GER_LABEL:Foo'))?.id).toBe('Foo');
    expect(resolveLabel('@"GER_LABEL:Foo"', [])?.id).toBe('Foo');
  });

  it('prefers the user locale and keeps en-us as secondary', () => {
    const table = [
      { labelId: 'Foo', languageId: 'en-US', labelValue: 'Amount' },
      { labelId: 'Foo', languageId: 'cs', labelValue: 'Částka' },
    ];
    const resolved = resolveLabel('@GER_LABEL:Foo', table, 'cs-cz');
    expect(resolved?.localized).toBe('Částka');
    expect(resolved?.enUs).toBe('Amount');
    expect(labelDisplayText('@GER_LABEL:Foo', table, 'cs-cz')).toBe('Částka');
  });

  it('falls back to any available translation when en-us is missing', () => {
    const table = [{ labelId: 'Foo', languageId: 'de', labelValue: 'Betrag' }];
    expect(labelDisplayText('@GER_LABEL:Foo', table, 'cs-cz')).toBe('Betrag');
  });
});

describe('label reference helpers', () => {
  it('normalises all reference shapes to the same core id', () => {
    for (const ref of ['@"GER_LABEL:Foo"', '@GER_LABEL:Foo', 'GER_LABEL:Foo', '@"Foo"', '@Foo', 'Foo']) {
      expect(normalizeLabelRef(ref).core).toBe('Foo');
    }
  });

  it('detects label references versus literal text', () => {
    expect(looksLikeLabelRef('@GER_LABEL:Foo')).toBe(true);
    expect(looksLikeLabelRef('@"Foo"')).toBe(true);
    expect(looksLikeLabelRef('Plain text')).toBe(false);
    expect(looksLikeLabelRef('')).toBe(false);
  });
});

describe('harvested label pool', () => {
  it('falls back to labels harvested from other F&O responses, own table wins', async () => {
    const { buildLabelPool, registerHarvestedLabels, labelDisplayText } = await import('./label-resolver.js');
    const cfg = { solutionVersion: { solution: { labels: [{ labelId: 'Own', labelValue: 'Vlastní', languageId: 'en-US' }] } } };
    expect(registerHarvestedLabels([
      { labelId: 'GER_LABEL:Fax', labelValue: 'Fax', languageId: 'en-US' },
      { labelId: 'Own', labelValue: 'Z jiné odpovědi', languageId: 'en-US' },
    ])).toBe(2);
    // duplicate registration is a no-op
    expect(registerHarvestedLabels([{ labelId: 'GER_LABEL:Fax', labelValue: 'Fax', languageId: 'en-US' }])).toBe(0);
    const pool = buildLabelPool([cfg], 0);
    expect(labelDisplayText('@"GER_LABEL:Fax"', pool, 'en-us')).toBe('Fax');
    expect(labelDisplayText('@Own', pool, 'en-us')).toBe('Vlastní');
  });
});
