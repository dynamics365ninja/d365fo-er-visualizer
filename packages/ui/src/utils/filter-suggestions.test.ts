import { describe, it, expect } from 'vitest';
import {
  countTerms,
  suggestionsFromCounts,
  rankSuggestions,
  splitHighlight,
  type FilterSuggestion,
} from './filter-suggestions';

function pool(entries: Array<[string, string, number]>): FilterSuggestion[] {
  return entries.map(([value, group, count]) => ({ value, group, count }));
}

describe('countTerms', () => {
  it('tallies repeats and keeps the first spelling', () => {
    const counts = countTerms(['TaxCodes', 'taxcodes', 'TaxCodes']);
    expect([...counts.entries()]).toEqual([['TaxCodes', 3]]);
  });

  it('drops blanks and one-character terms', () => {
    expect([...countTerms(['', '  ', 'a', undefined, 'ok']).keys()]).toEqual(['ok']);
  });
});

describe('rankSuggestions', () => {
  const suggestions = pool([
    ['TaxTransactions', 'Bindings', 25],
    ['TaxTransactionsDetails', 'Bindings', 64],
    ['ReverseTaxCodes', 'Bindings', 3],
    ['TaxTable', 'Data sources', 3],
  ]);

  it('returns nothing for an empty query', () => {
    expect(rankSuggestions(suggestions, '   ')).toEqual([]);
  });

  it('puts prefix matches ahead of mid-word ones', () => {
    const bindings = rankSuggestions(suggestions, 'Tax')
      .filter(s => s.group === 'Bindings')
      .map(s => s.value);
    expect(bindings[bindings.length - 1]).toBe('ReverseTaxCodes');
  });

  it('breaks ties on count, then on the shorter term', () => {
    const ranked = rankSuggestions(pool([
      ['Alpha', 'G', 1],
      ['Alphabet', 'G', 9],
      ['Alphas', 'G', 9],
    ]), 'Alph').map(s => s.value);
    expect(ranked).toEqual(['Alphas', 'Alphabet', 'Alpha']);
  });

  it('keeps groups in the order the pool introduces them', () => {
    const ranked = rankSuggestions(suggestions, 'Tax');
    expect(ranked[ranked.length - 1].group).toBe('Data sources');
  });

  it('drops a term the query already spells out', () => {
    expect(rankSuggestions(suggestions, 'taxtable').map(s => s.value)).not.toContain('TaxTable');
  });

  it('honours the per-group and total caps', () => {
    const many = pool(Array.from({ length: 20 }, (_, i) => [`Item${i}`, i < 10 ? 'A' : 'B', 1] as [string, string, number]));
    const ranked = rankSuggestions(many, 'Item', { perGroup: 2, total: 3 });
    expect(ranked).toHaveLength(3);
    expect(ranked.filter(s => s.group === 'A')).toHaveLength(2);
  });

  it('scores a hit after a separator like a name start', () => {
    const ranked = rankSuggestions(pool([
      ['xxCompany', 'G', 1],
      ['Sales/Company', 'G', 1],
    ]), 'Company').map(s => s.value);
    expect(ranked[0]).toBe('Sales/Company');
  });
});

describe('suggestionsFromCounts', () => {
  it('carries the group and view onto every row', () => {
    const rows = suggestionsFromCounts(countTerms(['One', 'One', 'Two']), 'Bindings', 'bindings');
    expect(rows).toEqual([
      { value: 'One', group: 'Bindings', count: 2, view: 'bindings' },
      { value: 'Two', group: 'Bindings', count: 1, view: 'bindings' },
    ]);
  });
});

describe('splitHighlight', () => {
  it('splits around the match, case-insensitively', () => {
    expect(splitHighlight('TaxTransactions', 'trans')).toEqual(['Tax', 'Trans', 'actions']);
  });

  it('leaves the value whole when nothing matches', () => {
    expect(splitHighlight('TaxCodes', 'zzz')).toEqual(['TaxCodes', '', '']);
  });
});
