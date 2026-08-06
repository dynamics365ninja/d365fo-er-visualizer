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

  it('registers nameless content nodes under the element they belong to', () => {
    const registry = new GUIDRegistry();

    // An XML attribute whose value lives in an unnamed <ERTextFormatString/>.
    // The parser gives that child its element type as a name, so without the
    // parent fallback a binding targeting it would be labelled "String".
    registry.indexConfiguration({
      filePath: 'format.xml',
      kind: 'Format',
      solutionVersion: {
        solution: { id: '{sol}', name: 'VAT control statement', labels: [] },
        number: 1,
        publicVersionNumber: '1',
        versionStatus: 2,
      },
      content: {
        kind: 'Format',
        formatVersion: {
          format: {
            id: '{fmt}',
            name: 'VAT control statement',
            rootElement: {
              id: '{root}',
              name: 'File',
              elementType: 'File',
              attributes: {},
              children: [
                {
                  id: '{attr}',
                  name: 'c_jed_vyzvy',
                  elementType: 'XMLAttribute',
                  attributes: {},
                  children: [
                    { id: '{value}', name: 'String', elementType: 'String', attributes: {}, children: [] },
                  ],
                },
              ],
            },
            enumDefinitions: [],
            transformations: [],
          },
        },
        formatMappingVersion: { formatMapping: { bindings: [], datasources: [] } },
        embeddedModelMappingVersions: [],
      },
    } as never);

    expect(registry.lookup('{attr}')?.name).toBe('c_jed_vyzvy');
    expect(registry.lookup('{value}')?.name).toBe('c_jed_vyzvy');
  });
});