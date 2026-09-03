import { describe, expect, it } from 'vitest';
import { parseERConfiguration } from '@er-visualizer/core';
import { useAppStore } from './store';
import { getScopedMappingDefinitions } from './store';
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
});
