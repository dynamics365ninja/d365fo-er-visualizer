import { describe, it, expect } from 'vitest';
import {
  buildPathTooltip,
  parseExpressionSegments,
  type DeepResolutionLike,
  type ModelPathResolutionLike,
  type PathSegment,
  type PathTooltipResolvers,
} from './path-tooltip';

const names = (segments: PathSegment[]) =>
  segments.filter(segment => segment.chain).map(segment => `${segment.chain!.join('.')}#${segment.chainIndex}`);

describe('parseExpressionSegments', () => {
  it('groups the names of one reference and knows each one’s place in it', () => {
    const segments = parseExpressionSegments("'$SalesInvoiceTmp_First'.InvoiceId", 'binding-expr');
    expect(names(segments)).toEqual(['$SalesInvoiceTmp_First.InvoiceId#0', '$SalesInvoiceTmp_First.InvoiceId#1']);
  });

  it('does not take a function name for a reference', () => {
    const segments = parseExpressionSegments('FIRSTORNULL(ReportDataProvider.getSalesInvoiceTmp)', 'binding-expr');
    expect(segments[0]).toEqual({ text: 'FIRSTORNULL', kind: 'operator' });
    expect(names(segments)).toEqual(['ReportDataProvider.getSalesInvoiceTmp#0', 'ReportDataProvider.getSalesInvoiceTmp#1']);
  });

  it('keeps a method call on a path as part of the reference', () => {
    const segments = parseExpressionSegments('Tax.calc(1)', 'binding-expr');
    expect(names(segments)).toEqual(['Tax.calc#0', 'Tax.calc#1']);
  });

  it('breaks references at whitespace and operators, and leaves literals alone', () => {
    const segments = parseExpressionSegments('model.A > 0 AND model.B = "x.y"', 'binding-expr');
    expect(names(segments)).toEqual(['model.A#0', 'model.A#1', 'AND#0', 'model.B#0', 'model.B#1']);
    expect(segments.find(segment => segment.text === '>')?.kind).toBe('operator');
    expect(segments.find(segment => segment.text === '0')?.kind).toBe('literal');
    expect(segments.find(segment => segment.text === '"x.y"')?.kind).toBe('literal');
  });

  it('reads a slash-separated model path as one name', () => {
    const segments = parseExpressionSegments('InvoiceBase/CompanyInfo/Name', 'model-path');
    expect(segments).toEqual([{ text: 'InvoiceBase/CompanyInfo/Name', kind: 'model-path', chain: ['InvoiceBase/CompanyInfo/Name'], chainIndex: 0 }]);
  });
});

const calcDs = { name: '$Tmp_First', type: 'CalculatedField', calculatedField: { expressionAsString: 'FIRSTORNULL(RDP.getTmp)' } };
const tableDs = { name: 'Lines', type: 'Table', tableInfo: { tableName: 'CustInvoiceTrans' } };
const modelDs = { name: 'model', type: 'DataModel', modelInfo: { dataContainerDescriptorName: 'SalesInvoice' } };

const deep = (rootDs: any, fieldPath: string[] = [], extra: Partial<DeepResolutionLike> = {}): DeepResolutionLike => ({
  rootDs, rootDsConfigIndex: 1, nestedDs: null, fieldPath, involvedDatasources: [], calculatedFieldChain: [], ...extra,
});

function resolvers(
  deepResults: Record<string, DeepResolutionLike>,
  modelResults: Record<string, ModelPathResolutionLike> = {},
): PathTooltipResolvers {
  return {
    deep: path => deepResults[path] ?? null,
    datasource: () => null,
    modelPath: path => modelResults[path] ?? null,
    datasourceNode: ds => `node:${ds.name}`,
  };
}

const segmentAt = (expr: string, index: number, mode: 'binding-expr' | 'model-path' = 'binding-expr') =>
  parseExpressionSegments(expr, mode).filter(segment => segment.chain)[index];

describe('buildPathTooltip', () => {
  const expr = "'$Tmp_First'.InvoiceId";
  const r = resolvers({
    $Tmp_First: deep(calcDs),
    '$Tmp_First.InvoiceId': deep(calcDs, ['InvoiceId']),
    Lines: deep(tableDs),
    'Lines.ItemId': deep(tableDs, ['ItemId']),
  });

  it('describes the data source when its own name is hovered', () => {
    const tip = buildPathTooltip(segmentAt(expr, 0), r)!;
    expect(tip.kind).toBe('datasource');
    expect(tip.title).toBe('$Tmp_First');
    expect(tip.rows[0].value).toBe('FIRSTORNULL(RDP.getTmp)');
    expect(tip.navigation?.treeNodeId).toBe('node:$Tmp_First');
  });

  it('describes the field, not the data source, when the field is hovered', () => {
    const tip = buildPathTooltip(segmentAt(expr, 1), r)!;
    expect(tip.kind).toBe('field');
    expect(tip.title).toBe('InvoiceId');
    expect(tip.path).toEqual(['$Tmp_First', 'InvoiceId']);
    expect(tip.activeIndex).toBe(1);
    expect(tip.rows.map(row => row.value)).toEqual(['$Tmp_First', 'FIRSTORNULL(RDP.getTmp)']);
  });

  it('names the table field behind a table data source', () => {
    const tip = buildPathTooltip(segmentAt('Lines.ItemId', 1), r)!;
    expect(tip.rows.map(row => row.value)).toContain('CustInvoiceTrans.ItemId');
  });

  describe('model fields in a format', () => {
    const format = resolvers(
      {
        model: deep(modelDs),
        'model.InvoiceBase': deep(modelDs, ['InvoiceBase']),
        'model.InvoiceBase.Id': deep(modelDs, ['InvoiceBase', 'Id']),
        'model.InvoiceBase.Gone': deep(modelDs, ['InvoiceBase', 'Gone']),
      },
      {
        'model.InvoiceBase.Id': {
          modelPath: 'InvoiceBase/Id',
          binding: { expressionAsString: "'$Header'.InvoiceId" },
          bindingTreeNodeId: 'binding:Id',
          datasource: calcDs,
          datasourceTreeNodeId: 'node:$Header',
        },
        'model.InvoiceBase.Gone': {
          modelPath: 'InvoiceBase',
          binding: { expressionAsString: "'$Header'" },
          bindingTreeNodeId: 'binding:InvoiceBase',
          datasource: null,
          datasourceTreeNodeId: null,
        },
      },
    );

    it('shows the mapping binding that fills the hovered field', () => {
      const tip = buildPathTooltip(segmentAt('model.InvoiceBase.Id', 2), format)!;
      expect(tip.kind).toBe('model-field');
      expect(tip.title).toBe('Id');
      expect(tip.rows[0].value).toBe("'$Header'.InvoiceId");
      expect(tip.navigation?.treeNodeId).toBe('binding:Id');
    });

    it('does not pass a parent’s binding off as the field’s own', () => {
      const tip = buildPathTooltip(segmentAt('model.InvoiceBase.Gone', 2), format)!;
      expect(tip.rows[0]).toMatchObject({ muted: true, value: "InvoiceBase ← '$Header'" });
      expect(tip.navigation).toBeNull();
    });

    it('says so when no loaded mapping binds the field', () => {
      const tip = buildPathTooltip(segmentAt('model.InvoiceBase', 1), format)!;
      expect(tip.kind).toBe('model-field');
      expect(tip.rows).toHaveLength(1);
      expect(tip.rows[0].muted).toBe(true);
      expect(tip.navigation).toBeNull();
    });

    it('describes a record by the bindings on its fields instead of a missing binding', () => {
      const withRecords: PathTooltipResolvers = { ...format, bindingsBelow: path => (path === 'model.InvoiceBase' ? 3 : 0) };
      const tip = buildPathTooltip(segmentAt('model.InvoiceBase', 1), withRecords)!;
      expect(tip.rows).toHaveLength(1);
      expect(tip.rows[0]).toMatchObject({ muted: true });
      expect(tip.rows[0].value).toContain('3');
      expect(tip.navigation).toBeNull();
    });

    it('still describes the model data source itself', () => {
      const tip = buildPathTooltip(segmentAt('model.InvoiceBase.Id', 0), format)!;
      expect(tip.kind).toBe('datasource');
      expect(tip.rows[0].value).toBe('SalesInvoice');
    });
  });

  it('resolves a slash-separated model path through the mapping', () => {
    const r2 = resolvers({}, {
      'model.InvoiceBase.CompanyInfo.Name': {
        modelPath: 'InvoiceBase/CompanyInfo/Name',
        binding: { expressionAsString: "'$Company'.Name" },
        bindingTreeNodeId: 'binding:Name',
        datasource: null,
        datasourceTreeNodeId: null,
      },
    });
    const tip = buildPathTooltip(segmentAt('InvoiceBase/CompanyInfo/Name', 0, 'model-path'), r2)!;
    expect(tip.title).toBe('Name');
    expect(tip.rows[0].value).toBe("'$Company'.Name");
  });

  it('gives no card for a name nothing resolves', () => {
    expect(buildPathTooltip(segmentAt('Unknown.Thing', 1), resolvers({}))).toBeNull();
  });
});
