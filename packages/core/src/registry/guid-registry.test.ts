import { describe, expect, it } from 'vitest';
import { GUIDRegistry } from './guid-registry.js';

describe('GUIDRegistry', () => {
  it('matches findRefsTo by exact target instead of substring', () => {
    const registry = new GUIDRegistry();

    registry.addCrossRef({
      target: 'TaxTrans',
      targetType: 'Table',
      sourceConfigPath: 'mapping.xml',
      sourceComponent: 'TaxTransDs',
      sourceContext: 'Datasource uses TaxTrans',
    });

    registry.addCrossRef({
      target: 'TaxTransHeader',
      targetType: 'Table',
      sourceConfigPath: 'mapping.xml',
      sourceComponent: 'TaxTransHeaderDs',
      sourceContext: 'Datasource uses TaxTransHeader',
    });

    const matches = registry.findRefsTo('TaxTrans', 'Table');

    expect(matches).toHaveLength(1);
    expect(matches[0]?.target).toBe('TaxTrans');
  });

  it('keeps free-text search partial for discovery', () => {
    const registry = new GUIDRegistry();

    registry.addCrossRef({
      target: 'TaxTransHeader',
      targetType: 'Table',
      sourceConfigPath: 'mapping.xml',
      sourceComponent: 'TaxTransHeaderDs',
      sourceContext: 'Datasource uses TaxTransHeader',
    });

    const results = registry.search('taxtrans');

    expect(results).toHaveLength(1);
    expect(results[0]?.target).toBe('TaxTransHeader');
  });
});