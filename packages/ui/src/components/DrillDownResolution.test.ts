import { describe, expect, it } from 'vitest';
import { parseERConfiguration } from '@er-visualizer/core';
import { resolveDeepExpression, useAppStore } from '../state/store';
import { buildExpressionTree, buildWorkbenchParts } from './DrillDownPanel';

/**
 * Mirrors the shape that broke drill-down on the "Free text invoice (Excel)" report:
 * `Parameters.'$SourceJournal'` is a calculated field, so the fields addressed through
 * it (`.'$InvoiceDate'`) live on the datasource its formula points at, and the value of
 * `'$JournalRecId'` is a user parameter rather than anything stored in the configuration.
 */
function mappingItem(name: string, valueSource: string, parentPath?: string): string {
  return `
    <ERModelItemDefinition${parentPath ? ` ParentPath="${parentPath}"` : ''}>
      <ValueDefinition>
        <ERModelItemValueDefinition Name="${name}">
          <ValueSource>${valueSource}</ValueSource>
        </ERModelItemValueDefinition>
      </ValueDefinition>
    </ERModelItemDefinition>`;
}

const container = '<ERContainerDataSourceHandler />';
const calc = (expression: string) => `<ERModelExpressionItem ExpressionAsString="${expression}" />`;

const MAPPING_XML = `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion>
  <Solution>
    <ERSolution ID.="{SOL}" Name="Invoice model" />
  </Solution>
  <Contents.>
    <ERModelMappingVersion ID.="{MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Mapping>
        <ERModelMapping ID.="{MAP}" Name="Mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
          <Binding>
            <ERDataContainerBinding>
              <Contents.>
                <ERDataContainerPathBinding Path="InvoiceLines/InvoiceDate" ExpressionAsString="Tables.&apos;#SourceJournalTables&apos;.CustInvoiceJour.InvoiceDate" />
                <ERDataContainerPathBinding Path="InvoiceLines/RecId" ExpressionAsString="Tables.&apos;#SourceJournalTables&apos;.CustInvoiceJour.RecId" />
                <ERDataContainerPathBinding Path="InvoiceLines/JournalRecId" ExpressionAsString="&apos;$JournalRecId&apos;" />
              </Contents.>
            </ERDataContainerBinding>
          </Binding>
          <Datasource>
            <ERModelDefinition>
              <Contents.>
                ${mappingItem('Tables', container)}
                ${mappingItem('#SourceJournalTables', container, 'Tables')}
                ${mappingItem('CustInvoiceJour', '<ERTableDataSourceHandler Table="CustInvoiceJour" />', 'Tables/#SourceJournalTables')}
                ${mappingItem('$CustInvoiceJour', calc('FILTER(Tables.&apos;#SourceJournalTables&apos;.CustInvoiceJour, Tables.&apos;#SourceJournalTables&apos;.CustInvoiceJour.RecId = &apos;$JournalRecId&apos;)'), 'Tables/#SourceJournalTables')}
                ${mappingItem('$InvoiceDate', calc('Tables.&apos;#SourceJournalTables&apos;.&apos;$CustInvoiceJour&apos;.InvoiceDate'), 'Tables/#SourceJournalTables/$CustInvoiceJour')}
                ${mappingItem('$JournalRecId', '<ERUserParameterDataSourceHandler ExtendedDataTypeName="refrecid" />')}
                ${mappingItem('Parameters', container)}
                ${mappingItem('$SourceJournal', calc('FIRSTORNULL(Tables.&apos;#SourceJournalTables&apos;.&apos;$CustInvoiceJour&apos;)'), 'Parameters')}
              </Contents.>
            </ERModelDefinition>
          </Datasource>
        </ERModelMapping>
      </Mapping>
    </ERModelMappingVersion>
  </Contents.>
</ERSolutionVersion>`;

function loadConfigurations(): any[] {
  const config = parseERConfiguration(MAPPING_XML, 'mapping.xml');
  const configurations = [config] as any[];
  useAppStore.setState({ configurations } as any);
  return configurations;
}

function flatten(node: any, out: any[] = []): any[] {
  out.push(node);
  for (const child of node.children) flatten(child, out);
  return out;
}

describe('drill-down through nested calculated fields', () => {
  it('resolves a field addressed through a calculated field to its own formula', () => {
    const configurations = loadConfigurations();
    const result = resolveDeepExpression("Parameters.'$SourceJournal'.'$InvoiceDate'", configurations, 0);

    expect(result?.nestedDs?.name).toBe('$InvoiceDate');
    expect(result?.formula).toBe("Tables.'#SourceJournalTables'.'$CustInvoiceJour'.InvoiceDate");
    expect(result?.involvedDatasources.map(ds => ds.tableName)).toContain('CustInvoiceJour');
  });

  it('expands every nested formula down to the concrete table', () => {
    const configurations = loadConfigurations();
    const store = useAppStore.getState();

    const tree = buildExpressionTree({
      expression: "Parameters.'$SourceJournal'.'$InvoiceDate'",
      configIndex: 0,
      configurations,
      resolveModelPath: store.resolveModelPath,
      resolveDatasource: store.resolveDatasource,
    });

    const nodes = flatten(tree);
    expect(nodes.map(n => n.label)).toEqual(
      expect.arrayContaining(['$InvoiceDate', '$CustInvoiceJour', 'CustInvoiceJour', '$JournalRecId']),
    );
    // The nested calculated field must carry its own formula, not just a name.
    expect(nodes.find(n => n.label === '$CustInvoiceJour')?.sublabel).toContain('FILTER(');
  });

  it('shows a user parameter as run-time input instead of a bare name', () => {
    const configurations = loadConfigurations();
    const store = useAppStore.getState();

    const tree = buildExpressionTree({
      expression: "'$JournalRecId'",
      configIndex: 0,
      configurations,
      resolveModelPath: store.resolveModelPath,
      resolveDatasource: store.resolveDatasource,
    });

    const paramNode = flatten(tree).find(n => n.label === '$JournalRecId');
    expect(paramNode?.badge).toBe('param');
    expect(paramNode?.sublabel).toContain('refrecid');
  });

  it('lists both the path prefixes and the nested formulas in the workbench', () => {
    const configurations = loadConfigurations();
    const store = useAppStore.getState();

    const parts = buildWorkbenchParts({
      expression: "Parameters.'$SourceJournal'.'$InvoiceDate'",
      label: '$InvoiceDate',
      configIndex: 0,
      configurations,
      resolveModelPath: store.resolveModelPath,
      resolveDatasource: store.resolveDatasource,
    });

    // Breadcrumb still walks the path…
    expect(parts.map(p => p.expression)).toEqual(
      expect.arrayContaining(['Parameters', "Parameters.'$SourceJournal'"]),
    );
    // …and every nested formula is now a row of its own.
    expect(parts.map(p => p.label)).toEqual(
      expect.arrayContaining(['$CustInvoiceJour', 'CustInvoiceJour', '$JournalRecId']),
    );
    expect(parts.find(p => p.label === '$CustInvoiceJour')?.detail).toContain('FILTER(');
  });

  it('reports the field addressed on a table datasource', () => {
    const configurations = loadConfigurations();
    const expression = "Tables.'#SourceJournalTables'.CustInvoiceJour.InvoiceDate";
    const result = resolveDeepExpression(expression, configurations, 0);

    expect(result?.nestedDs?.name).toBe('CustInvoiceJour');
    expect(result?.fieldPath).toEqual(['InvoiceDate']);

    const store = useAppStore.getState();
    const tree = buildExpressionTree({
      expression,
      configIndex: 0,
      configurations,
      resolveModelPath: store.resolveModelPath,
      resolveDatasource: store.resolveDatasource,
    });

    // The row has to name the column, not just the table it hangs off.
    expect(flatten(tree).map(n => n.sublabel)).toContain('CustInvoiceJour.InvoiceDate');
  });

  it('breaks down every calculated field along the path, not just the leaf', () => {
    const configurations = loadConfigurations();
    const store = useAppStore.getState();

    const tree = buildExpressionTree({
      expression: "Parameters.'$SourceJournal'.'$InvoiceDate'",
      configIndex: 0,
      configurations,
      resolveModelPath: store.resolveModelPath,
      resolveDatasource: store.resolveDatasource,
    });

    const sourceJournal = flatten(tree).find(n => n.label === '$SourceJournal');
    expect(sourceJournal?.badge).toBe('calc');
    expect(sourceJournal?.sublabel).toContain('FIRSTORNULL(');
  });
});

/**
 * ER binds containers implicitly: `model.InvoiceLines` carries no expression of
 * its own, only the fields inside it do. Clicking that part of a path used to
 * show nothing at all — it now has to report the sources of its descendants.
 */
describe('drill-down into a model container without a binding of its own', () => {
  it('collects the data sources of the fields inside the container', () => {
    const configurations = loadConfigurations();
    const store = useAppStore.getState();

    expect(store.resolveModelPath('InvoiceLines')).toBeNull();
    expect(store.findModelPathBindings('model.InvoiceLines').map(b => b.relativePath))
      .toEqual(expect.arrayContaining(['InvoiceDate', 'RecId', 'JournalRecId']));

    const tree = buildExpressionTree({
      expression: 'model.InvoiceLines',
      configIndex: 0,
      configurations,
      resolveModelPath: store.resolveModelPath,
      resolveDatasource: store.resolveDatasource,
      findModelPathBindings: store.findModelPathBindings,
    });

    const labels = flatten(tree).map(n => n.label);
    expect(labels).toEqual(expect.arrayContaining(['CustInvoiceJour', '$JournalRecId']));
  });

  it('keeps a leaf of that container resolving to its own binding', () => {
    const configurations = loadConfigurations();
    const store = useAppStore.getState();

    const tree = buildExpressionTree({
      expression: 'model.InvoiceLines.InvoiceDate',
      configIndex: 0,
      configurations,
      resolveModelPath: store.resolveModelPath,
      resolveDatasource: store.resolveDatasource,
      findModelPathBindings: store.findModelPathBindings,
    });

    expect(flatten(tree).map(n => n.sublabel)).toContain('CustInvoiceJour.InvoiceDate');
  });
});
