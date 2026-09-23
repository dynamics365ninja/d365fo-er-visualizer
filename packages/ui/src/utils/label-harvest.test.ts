import { describe, expect, it } from 'vitest';
import { buildLabelPool, clearHarvestedLabels, labelDisplayText, registerHarvestedLabels } from './label-resolver';

describe('clearHarvestedLabels', () => {
  it('empties the harvested pool so another environment starts clean', () => {
    const configurations = [{ solutionVersion: { solution: { labels: [] } } }];
    registerHarvestedLabels([{ labelId: 'GER_LABEL:Fax', labelValue: 'Fax', languageId: 'en-US' }]);
    expect(labelDisplayText('@GER_LABEL:Fax', buildLabelPool(configurations, 0), 'en-us')).toBe('Fax');

    clearHarvestedLabels();

    expect(buildLabelPool(configurations, 0)).toEqual([]);
    // The dedupe set is reset too, so the label can be harvested again.
    expect(registerHarvestedLabels([{ labelId: 'GER_LABEL:Fax', labelValue: 'Fax', languageId: 'en-US' }])).toBe(1);
  });
});
