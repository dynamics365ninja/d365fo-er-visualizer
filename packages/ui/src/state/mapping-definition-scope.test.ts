import { describe, expect, it } from 'vitest';
import { parseERConfiguration } from '@er-visualizer/core';
import { useAppStore } from './store';
import { getScopedMappingDefinitions, relatedMappingDefinitionLabels, selectMappingDefinition, toModelRootedPath } from './store';
import { buildExpressionTree } from '../components/DrillDownPanel';

/**
 * A model mapping solution ships one definition per DataContainerDescriptor
 * (TMSCommercialInvoice, InvoiceCustomer, SalesInvoice, …). The definitions
 * reuse the same datasource names — `ReportDataProvider` exists in each one but
 * points at a different DP class. A format binds to exactly one descriptor via
 * `ERModelDataSourceHandler/@DataContainerDescriptorName`, so every lookup made
 * on its behalf has to stay inside that definition instead of taking the first
 * name match in file order.
 */
function mappingVersion(id: string, descriptor: string, dpClass: string): string {
  return `
    <ERModelMappingVersion ID.="{${id}},1" DateTime="2026-04-14T12:00:00" Description="${descriptor}" Number="1">
      <Mapping>
        <ERModelMapping ID.="{${id}}" Name="${descriptor}" DataContainerDescriptor="${descriptor}" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
          <Binding>
            <ERDataContainerBinding>
              <Contents.>
                <ERDataContainerPathBinding ExpressionAsString="ReportDataProvider.getHeader.DocumentDate" Path="InvoiceBase/DocumentDate" />
              </Contents.>
            </ERDataContainerBinding>
          </Binding>
          <Datasource>
            <ERModelDefinition>
              <Contents.>
                <ERModelItemDefinition>
                  <ValueDefinition>
                    <ERModelItemValueDefinition Name="ReportDataProvider">
                      <ValueSource>
                        <ERClassDataSourceHandler ClassName="${dpClass}" />
                      </ValueSource>
                    </ERModelItemValueDefinition>
                  </ValueDefinition>
                </ERModelItemDefinition>
              </Contents.>
            </ERModelDefinition>
          </Datasource>
        </ERModelMapping>
      </Mapping>
    </ERModelMappingVersion>`;
}

const MAPPING_XML = `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion>
  <Solution>
    <ERSolution ID.="{SOL-MAP}" Name="Invoice model mapping" />
  </Solution>
  <Contents.>
    ${mappingVersion('TMS', 'TMSCommercialInvoice', 'TmsCommercialInvoiceDP')}
    ${mappingVersion('SALES', 'SalesInvoice', 'SalesInvoiceDP')}
  </Contents.>
</ERSolutionVersion>`;

const FORMAT_XML = `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion>
  <Solution>
    <ERSolution ID.="{SOL-FMT}" Name="Sales invoice (Excel)" />
  </Solution>
  <Contents.>
    <ERFormatVersion ID.="{FMT},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Format>
        <ERTextFormat ID.="{FMT}" Name="Sales invoice">
          <Root>
            <ERTextFormatFileComponent ID.="{ROOT}" Name="Root" />
          </Root>
        </ERTextFormat>
      </Format>
    </ERFormatVersion>
    <ERFormatMappingVersion ID.="{FMT-MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Mapping>
        <ERFormatMapping ID.="{FMT-MAP}" Format="{FMT}" FormatVersion="{FMT},1" Name="Sales invoice mapping">
          <Binding>
            <ERFormatBinding>
              <Contents.>
                <ERFormatComponentPropertyBinding Component="{ROOT}" ExpressionAsString="model.InvoiceBase.DocumentDate" SyntaxVersion="1" />
              </Contents.>
            </ERFormatBinding>
          </Binding>
          <Datasource>
            <ERModelDefinition>
              <Contents.>
                <ERModelItemDefinition>
                  <ValueDefinition>
                    <ERModelItemValueDefinition Name="model">
                      <ValueSource>
                        <ERModelDataSourceHandler DataContainerDescriptorName="SalesInvoice" ModelGuid="{MODEL}" RevisionNumber="2" />
                      </ValueSource>
                    </ERModelItemValueDefinition>
                  </ValueDefinition>
                </ERModelItemDefinition>
              </Contents.>
            </ERModelDefinition>
          </Datasource>
        </ERFormatMapping>
      </Mapping>
    </ERFormatMappingVersion>
  </Contents.>
</ERSolutionVersion>`;

function loadConfigurations(): any[] {
  const configurations = [
    parseERConfiguration(FORMAT_XML, 'format.xml'),
    parseERConfiguration(MAPPING_XML, 'mapping.xml'),
  ] as any[];
  useAppStore.setState({ configurations } as any);
  return configurations;
}

function flatten(node: any, out: any[] = []): any[] {
  out.push(node);
  for (const child of node.children ?? []) flatten(child, out);
  return out;
}

describe('mapping definition scope', () => {
  it('parses one definition per sibling mapping version', () => {
    const configurations = loadConfigurations();
    expect(configurations[1].content.version.mappings.map((m: any) => m.dataContainerDescriptor))
      .toEqual(['TMSCommercialInvoice', 'SalesInvoice']);
  });

  it('resolves a shared datasource name inside the definition the format binds to', () => {
    loadConfigurations();
    const store = useAppStore.getState();

    const resolved = store.resolveDatasource('ReportDataProvider', 1);
    expect(resolved?.datasource?.classInfo?.className).toBe('SalesInvoiceDP');
  });

  it('orders the definitions of a mapping config with the bound descriptor first', () => {
    const configurations = loadConfigurations();
    expect(getScopedMappingDefinitions(configurations, 1).map((m: any) => m.dataContainerDescriptor))
      .toEqual(['SalesInvoice', 'TMSCommercialInvoice']);
  });

  it('does not pull a foreign definition into the drill-down of a format element', () => {
    const configurations = loadConfigurations();
    const store = useAppStore.getState();

    const tree = buildExpressionTree({
      expression: 'model.InvoiceBase.DocumentDate',
      configIndex: 0,
      configurations,
      resolveModelPath: store.resolveModelPath,
      resolveDatasource: store.resolveDatasource,
      findModelPathBindings: store.findModelPathBindings,
    });

    const sublabels = flatten(tree).map(n => n.sublabel ?? '').join('\n');
    expect(sublabels).toContain('SalesInvoiceDP');
    expect(sublabels).not.toContain('TmsCommercialInvoiceDP');
  });

  // Search and where-used group their hits per definition, so every node and
  // every reference has to carry the definition it came from.
  it('stamps every tree node under a mapping with its definition', () => {
    useAppStore.setState({ configurations: [], treeNodes: [] } as any);
    useAppStore.getState().loadXmlFile(MAPPING_XML, 'mapping.xml');

    const nodes = flatten(useAppStore.getState().treeNodes[0]);
    const bindings = nodes.filter(n => n.type === 'binding');
    expect(bindings.length).toBe(2);
    expect(bindings.map(n => n.mappingDefinition).sort())
      .toEqual(['SalesInvoice', 'TMSCommercialInvoice']);

    const datasources = nodes.filter(n => n.type === 'datasource');
    expect(datasources.map(n => n.mappingDefinition).sort())
      .toEqual(['SalesInvoice', 'TMSCommercialInvoice']);
  });

  it('names the definition a where-used hit was found in', () => {
    useAppStore.setState({ configurations: [], treeNodes: [] } as any);
    useAppStore.getState().loadXmlFile(MAPPING_XML, 'mapping.xml');

    const entries = useAppStore.getState().whereUsed('SalesInvoiceDP');
    const definitions = entries.flatMap(e => e.modelPaths.map(m => m.definition));
    expect(definitions.length).toBeGreaterThan(0);
    expect(new Set(definitions)).toEqual(new Set(['SalesInvoice']));
  });

  it('scopes the definitions related to the active format', () => {
    const configurations = loadConfigurations();
    // Index 0 is the format that binds to SalesInvoice.
    expect(relatedMappingDefinitionLabels(configurations, 0)).toEqual(new Set(['SalesInvoice']));
    // A mapping opened on its own imposes no definition scope.
    expect(relatedMappingDefinitionLabels(configurations, 1)).toBeNull();
  });

  it('stamps registry cross-refs with the definition they were indexed in', () => {
    useAppStore.setState({ configurations: [], treeNodes: [] } as any);
    useAppStore.getState().loadXmlFile(MAPPING_XML, 'mapping.xml');

    const hits = useAppStore.getState().registry.search('ReportDataProvider')
      .filter((r: any) => r.targetType === 'Formula');
    expect(hits.length).toBeGreaterThan(1);
    expect(new Set(hits.map((r: any) => r.sourceDefinition)))
      .toEqual(new Set(['SalesInvoice', 'TMSCommercialInvoice']));
  });

  // Two formats of one mapping: "every loaded format" names both descriptors,
  // so the drill-down of the second one used to resolve in the first one's
  // definition until the first format was closed.
  it('resolves a model path in the definition of the format the drill-down came from', () => {
    const configurations = [
      parseERConfiguration(FORMAT_XML, 'format.xml'),
      parseERConfiguration(MAPPING_XML, 'mapping.xml'),
      parseERConfiguration(
        FORMAT_XML.replace('DataContainerDescriptorName="SalesInvoice"', 'DataContainerDescriptorName="TMSCommercialInvoice"')
          .replace('Name="Sales invoice (Excel)"', 'Name="Commercial invoice (Excel)"'),
        'format-tms.xml',
      ),
    ] as any[];
    useAppStore.setState({ configurations } as any);
    const store = useAppStore.getState();

    for (const [configIndex, dpClass, definition] of [
      [0, 'SalesInvoiceDP', 'SalesInvoice'],
      [2, 'TmsCommercialInvoiceDP', 'TMSCommercialInvoice'],
    ] as const) {
      const tree = buildExpressionTree({
        expression: 'model.InvoiceBase.DocumentDate',
        configIndex,
        configurations,
        resolveModelPath: store.resolveModelPath,
        resolveDatasource: store.resolveDatasource,
        findModelPathBindings: store.findModelPathBindings,
      });
      const nodes = flatten(tree);
      expect(nodes.map(n => n.sublabel ?? '').join('\n')).toContain(dpClass);
      // The model-path row names the definition it was resolved in.
      expect(nodes.find(n => n.badge === 'model')?.definition).toBe(definition);
    }
  });

  it('opens a mapping on the definition of the format given as scope', () => {
    const configurations = [
      parseERConfiguration(FORMAT_XML, 'format.xml'),
      parseERConfiguration(MAPPING_XML, 'mapping.xml'),
      parseERConfiguration(
        FORMAT_XML.replace('DataContainerDescriptorName="SalesInvoice"', 'DataContainerDescriptorName="TMSCommercialInvoice"'),
        'format-tms.xml',
      ),
    ] as any[];
    const version = configurations[1].content.version;
    expect(selectMappingDefinition(version, configurations, 0).dataContainerDescriptor).toBe('SalesInvoice');
    expect(selectMappingDefinition(version, configurations, 2).dataContainerDescriptor).toBe('TMSCommercialInvoice');
  });

  it('reports a shared expression against the definition the format binds to', () => {
    useAppStore.setState({ configurations: [], treeNodes: [] } as any);
    useAppStore.getState().loadXmlFile(FORMAT_XML, 'format.xml');
    useAppStore.getState().loadXmlFile(MAPPING_XML, 'mapping.xml');

    // `getHeader` appears in every definition; only the bound one is relevant.
    const entries = useAppStore.getState().whereUsed('getHeader');
    const hits = entries.flatMap(e => e.modelPaths);
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map(m => m.definition))).toEqual(new Set(['SalesInvoice']));
  });

  // The format's model datasource can have any name — the PEPPOL formats call
  // it `Invoice` — and its bindings read `Invoice.InvoiceBase.…`.
  describe('with the model datasource renamed', () => {
    const RENAMED_FORMAT_XML = FORMAT_XML
      .replace('Name="model"', 'Name="Invoice"')
      .replace('ExpressionAsString="model.', 'ExpressionAsString="Invoice.');

    it('rewrites the model datasource root to model', () => {
      const configurations = [parseERConfiguration(RENAMED_FORMAT_XML, 'format.xml')] as any[];
      expect(toModelRootedPath('Invoice.InvoiceBase.DocumentDate', configurations, 0))
        .toEqual({ modelExpression: 'model.InvoiceBase.DocumentDate', root: 'Invoice' });
      expect(toModelRootedPath("'Invoice'.InvoiceBase", configurations, 0))
        .toEqual({ modelExpression: 'model.InvoiceBase', root: "'Invoice'" });
      expect(toModelRootedPath('model.InvoiceBase', configurations, 0)?.modelExpression).toBe('model.InvoiceBase');
      expect(toModelRootedPath('Other.InvoiceBase', configurations, 0)).toBeNull();
      expect(toModelRootedPath('Invoice', configurations, 0)).toBeNull();
    });

    it('lists the format binding in where-used', () => {
      useAppStore.setState({ configurations: [], treeNodes: [] } as any);
      useAppStore.getState().loadXmlFile(RENAMED_FORMAT_XML, 'format.xml');
      useAppStore.getState().loadXmlFile(MAPPING_XML, 'mapping.xml');

      const usages = useAppStore.getState().whereUsed('SalesInvoiceDP').flatMap(e => e.formatUsages);
      expect(usages.map(u => u.expression)).toContain('Invoice.InvoiceBase.DocumentDate');
    });

    it('drills the format binding down through the model mapping', () => {
      const configurations = [
        parseERConfiguration(RENAMED_FORMAT_XML, 'format.xml'),
        parseERConfiguration(MAPPING_XML, 'mapping.xml'),
      ] as any[];
      useAppStore.setState({ configurations } as any);
      const store = useAppStore.getState();

      const tree = buildExpressionTree({
        expression: 'Invoice.InvoiceBase.DocumentDate',
        configIndex: 0,
        configurations,
        resolveModelPath: store.resolveModelPath,
        resolveDatasource: store.resolveDatasource,
        findModelPathBindings: store.findModelPathBindings,
      });
      const nodes = flatten(tree);
      expect(nodes.find(n => n.badge === 'model')?.definition).toBe('SalesInvoice');
      expect(nodes.map(n => n.sublabel ?? '').join('\n')).toContain('SalesInvoiceDP');
    });
  });
});
