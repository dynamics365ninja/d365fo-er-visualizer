import { describe, it, expect } from 'vitest';
import { buildLabelPool, resolveLabel } from './label-resolver';

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

  it('matches ids that merely start with GER_LABEL_', () => {
    expect(resolveLabel('@"GER_LABEL_1"', labels('GER_LABEL_1'))?.enUs).toBe('Amount');
  });
});
