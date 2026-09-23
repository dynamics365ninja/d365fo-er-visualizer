import { describe, expect, it } from 'vitest';
import { GUIDRegistry, formulaReferenceRoots } from './guid-registry.js';

describe('formulaReferenceRoots', () => {
  it('takes only the head of each dotted path and skips literals and numbers', () => {
    expect(formulaReferenceRoots('IF(a.b.c.d > 1.5, "file.xml", model.X)')).toEqual(['a', 'model']);
  });

  it('keeps quoted names whole, including spaces, non-ASCII letters and doubled quotes', () => {
    expect(formulaReferenceRoots(`'Sales invoice'.Amount + 'Účet''s'.Total + $Calc.Value`))
      .toEqual(['Sales invoice', "Účet's", '$Calc']);
  });

  it('ignores names without a following dot', () => {
    expect(formulaReferenceRoots('FORMAT("%1", x)')).toEqual([]);
  });
});

describe('GUIDRegistry', () => {
  it('keeps components that share a GUID and prefers the requested file', () => {
    const registry = new GUIDRegistry();
    const entry = { guid: '{E1}', kind: 'FormatElement' as const, componentKind: 'Format' as never };
    registry.register({ ...entry, name: 'Base element', configFilePath: 'base.xml' });
    registry.register({ ...entry, name: 'Derived element', configFilePath: 'derived.xml' });
    registry.register({ ...entry, name: 'Base element v2', configFilePath: 'base.xml' });

    expect(registry.lookupAll('{e1}').map(e => e.name)).toEqual(['Base element v2', 'Derived element']);
    expect(registry.lookup('{E1}', 'base.xml')?.name).toBe('Base element v2');
    expect(registry.lookup('{E1}', 'derived.xml')?.name).toBe('Derived element');
    expect(registry.lookup('{E1}')?.name).toBe('Derived element');
  });

  it('does not register the all-zero placeholder id', () => {
    const registry = new GUIDRegistry();
    registry.register({
      guid: '00000000-0000-0000-0000-000000000000',
      kind: 'FormatVersion',
      name: 'Bare download',
      configFilePath: 'a.xml',
      componentKind: 'Format' as never,
    });
    expect(registry.guidCount).toBe(0);
  });

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