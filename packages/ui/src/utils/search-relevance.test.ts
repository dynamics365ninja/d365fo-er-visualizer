import { describe, expect, it } from 'vitest';
import { rankByRelevance, searchRelevance } from './search-relevance';

const hit = (target: string, sourceComponent = '', sourceContext = '') => ({ target, sourceComponent, sourceContext });

describe('search relevance', () => {
  it('puts an exact name above longer names that contain it', () => {
    const ranked = rankByRelevance([
      hit('TaxTransOrigin'),
      hit('model.Invoice.TaxTrans'),
      hit('CustTaxTransView'),
    ], 'TaxTrans');
    expect(ranked.map(h => h.target)).toEqual(['model.Invoice.TaxTrans', 'TaxTransOrigin', 'CustTaxTransView']);
  });

  it('prefers a word start over a match in the middle of a word', () => {
    expect(searchRelevance(hit('CustInvoiceJour'), 'invoice')).toBeGreaterThan(searchRelevance(hit('Reinvoiced'), 'invoice'));
  });

  it('ranks a match only inside an expression last', () => {
    const ranked = rankByRelevance([hit('Header', '', "IF(ISEMPTY(TaxAuthority), '', '')"), hit('TaxAuthority')], 'TaxAuthority');
    expect(ranked[0].target).toBe('TaxAuthority');
  });

  it('keeps file order for equal scores', () => {
    const ranked = rankByRelevance([hit('A/Amount'), hit('B/Amount')], 'amount');
    expect(ranked.map(h => h.target)).toEqual(['A/Amount', 'B/Amount']);
  });

  it('ignores quotes and $ around a name', () => {
    expect(searchRelevance(hit("model.'$TaxPeriod'"), 'taxperiod')).toBe(100);
  });
});
