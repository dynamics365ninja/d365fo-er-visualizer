import { describe, expect, it } from 'vitest';
import { ERComponentKind, type ERConfiguration, type ERDatasource } from '@er-visualizer/core';
import { collectEnumValueUses, definedEnumValues, mergeEnumValues } from './enum-values';

const enumDs = (name: string, parentPath: string | undefined, enumName: string, sourceKind: 'Ax' | 'DataModel' | 'Format'): ERDatasource => ({
  name,
  parentPath,
  type: sourceKind === 'Ax' ? 'Enum' : sourceKind === 'DataModel' ? 'ModelEnum' : 'FormatEnum',
  children: [],
  enumInfo: { enumName, isModelEnum: sourceKind === 'DataModel', sourceKind },
});

const datasources: ERDatasource[] = [
  enumDs('$ReportFieldEnum', undefined, 'ReportField', 'DataModel'),
  { name: 'Enums', type: 'Container', children: [enumDs('NoYes', 'Enums', 'NoYes', 'Ax')] },
];

const configurations = [
  {
    kind: ERComponentKind.DataModel,
    content: {
      kind: ERComponentKind.DataModel,
      version: { model: { id: '{M}', name: 'Tax', containers: [
        { id: 'ReportField', name: 'ReportField', isEnum: true, items: [{ name: 'Monthly', type: 0, label: '@GER:M' }, { name: 'Quarterly', type: 0 }] },
      ] } },
    },
  },
  {
    kind: ERComponentKind.Format,
    content: {
      kind: ERComponentKind.Format,
      formatVersion: { format: { enumDefinitions: [{ id: '1', name: 'Direction', values: [{ id: 'a', name: 'In' }, { id: 'b', name: 'Out' }] }] } },
    },
  },
] as unknown as ERConfiguration[];

describe('enum values', () => {
  it('reads a data model or format enum from the loaded configurations, never an AX enum', () => {
    expect(definedEnumValues({ enumName: '{ReportField}', isModelEnum: true, sourceKind: 'DataModel' }, configurations))
      .toEqual([{ name: 'Monthly', label: '@GER:M' }, { name: 'Quarterly', label: undefined }]);
    expect(definedEnumValues({ enumName: 'direction', isModelEnum: false, sourceKind: 'Format' }, configurations))
      .toEqual([{ name: 'In' }, { name: 'Out' }]);
    expect(definedEnumValues({ enumName: 'NoYes', isModelEnum: false, sourceKind: 'Ax' }, configurations)).toBeNull();
    expect(definedEnumValues({ enumName: 'Missing', isModelEnum: true, sourceKind: 'DataModel' }, configurations)).toBeNull();
  });

  it('counts the values expressions name through the enum\'s path', () => {
    const uses = collectEnumValueUses(datasources, [
      ['$ReportFieldEnum', 'Quarterly'],
      ['ReportFieldEnum', 'quarterly'],
      ['Enums', 'NoYes', 'Yes'],
      ['Enums', 'NoYes'],
      ['model', 'Monthly'],
    ]);
    expect([...uses.keys()]).toEqual(['reportfieldenum', 'enums/noyes']);
    expect(uses.get('reportfieldenum')?.get('quarterly')).toEqual({ name: 'Quarterly', uses: 2 });
    expect(uses.get('enums/noyes')?.get('yes')).toEqual({ name: 'Yes', uses: 1 });
  });

  it('keeps every declared value and adds the ones used but not declared', () => {
    const used = new Map([['quarterly', { name: 'Quarterly', uses: 3 }], ['weekly', { name: 'Weekly', uses: 1 }]]);
    expect(mergeEnumValues([{ name: 'Monthly' }, { name: 'Quarterly' }], used)).toEqual({
      complete: true,
      values: [{ name: 'Monthly', uses: 0 }, { name: 'Quarterly', uses: 3 }, { name: 'Weekly', uses: 1 }],
    });
    expect(mergeEnumValues(null, used)).toEqual({
      complete: false,
      values: [{ name: 'Quarterly', uses: 3 }, { name: 'Weekly', uses: 1 }],
    });
    expect(mergeEnumValues(null, undefined)).toEqual({ complete: false, values: [] });
  });
});
