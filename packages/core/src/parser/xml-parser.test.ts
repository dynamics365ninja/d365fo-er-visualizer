import { describe, expect, it } from 'vitest';
import { parseERConfiguration } from './xml-parser.js';
import type { ERExpression } from '../types/expressions.js';

function buildSolutionEnvelope(contents: string, options?: { contentRefId?: string; contentRefIds?: string[] }) {
  const contentRefIds = options?.contentRefIds ?? [options?.contentRefId ?? '{CONTENT-REF}'];
  const refs = contentRefIds.map(contentRefId => `<Ref. ID.="${contentRefId}" />`).join('\n        ');

  return `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion DateTime="2026-04-14T12:00:00" Description="test" Number="1" PublicVersionNumber="1" VersionStatus="2">
  <Solution>
    <ERSolution ID.="{SOLUTION}" Name="Test solution" Description="Fixture">
      <Labels>
        <ERClassList>
          <Contents.>
            <ERLabel LabelId="Fixture" LabelValue="Fixture" LanguageId="en-us" />
          </Contents.>
        </ERClassList>
      </Labels>
      <Vendor>
        <ERVendor Name="Microsoft" Url="http://microsoft.com" />
      </Vendor>
      <Contents.>
        ${refs}
      </Contents.>
    </ERSolution>
  </Solution>
  <Contents.>
    ${contents}
  </Contents.>
</ERSolutionVersion>`;
}

function parseFirstBindingExpression(expressionXml: string): ERExpression {
  const xml = buildSolutionEnvelope(`
    <ERModelMappingVersion ID.="{MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Mapping>
        <ERModelMapping ID.="{MAP}" Name="Mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
          <Binding>
            <ERDataContainerBinding>
              <Contents.>
                <ERDataContainerPathBinding ExpressionAsString="fixture" Path="Root/Value">
                  <Expression>
                    ${expressionXml}
                  </Expression>
                </ERDataContainerPathBinding>
              </Contents.>
            </ERDataContainerBinding>
          </Binding>
        </ERModelMapping>
      </Mapping>
    </ERModelMappingVersion>
  `, { contentRefId: '{MAP}' });

  const config = parseERConfiguration(xml, 'binding.xml');
  if (config.content.kind !== 'ModelMapping') {
    throw new Error('Expected model mapping content');
  }

  const expression = config.content.version.mapping.bindings[0]?.expression;
  if (!expression) {
    throw new Error('Expected parsed binding expression');
  }

  return expression;
}

describe('parseERConfiguration', () => {
  it('rejects incomplete format XML before parsing content', () => {
    const xml = buildSolutionEnvelope(`
      <ERFormatVersion ID.="{FORMAT},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Format>
          <ERTextFormat ID.="{FORMAT}" Name="Format only">
            <Root>
              <ERTextFormatFileComponent ID.="{ROOT}" Name="Root" />
            </Root>
          </ERTextFormat>
        </Format>
      </ERFormatVersion>
    `, { contentRefId: '{FORMAT}' });

    expect(() => parseERConfiguration(xml, 'format.xml')).toThrow(
      'Incomplete ER format XML: both ERFormatVersion and ERFormatMappingVersion are required',
    );
  });

  it('builds datasource hierarchy even when children appear before parents', () => {
    const xml = buildSolutionEnvelope(`
      <ERModelMappingVersion ID.="{MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERModelMapping ID.="{MAP}" Name="Mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
            <Datasource>
              <ERModelDefinition>
                <Contents.>
                  <ERModelItemDefinition ParentPath="#ReportFields">
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="Child">
                        <ValueSource>
                          <ERContainerDataSourceHandler />
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                  <ERModelItemDefinition>
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="ReportFields">
                        <ValueSource>
                          <ERContainerDataSourceHandler />
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                </Contents.>
              </ERModelDefinition>
            </Datasource>
          </ERModelMapping>
        </Mapping>
      </ERModelMappingVersion>
    `, { contentRefId: '{MAP}' });

    const config = parseERConfiguration(xml, 'mapping.xml');
    if (config.content.kind !== 'ModelMapping') {
      throw new Error('Expected model mapping content');
    }

    expect(config.content.version.mapping.datasources).toHaveLength(1);
    expect(config.content.version.mapping.datasources[0]?.name).toBe('ReportFields');
    expect(config.content.version.mapping.datasources[0]?.children.map(child => child.name)).toEqual([
      'Child',
    ]);
  });

  it('decodes numeric Unicode entities beyond the BMP', () => {
    const xml = buildSolutionEnvelope(`
      <ERDataModelVersion ID.="{MODEL},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Model>
          <ERDataModel ID.="{MODEL}" Name="Model">
            <Contents.>
              <ERDataContainerDescriptor ID.="{ROOT}" Name="Root" IsRoot="1">
                <Contents.>
                  <ERDataContainerDescriptorItem Name="Rocket" Type="6" Description="Smile &#x1F680;" />
                </Contents.>
              </ERDataContainerDescriptor>
            </Contents.>
          </ERDataModel>
        </Model>
      </ERDataModelVersion>
    `, { contentRefId: '{MODEL}' });

    const config = parseERConfiguration(xml, 'model.xml');
    if (config.content.kind !== 'DataModel') {
      throw new Error('Expected data model content');
    }

    expect(config.content.version.model.containers[0]?.items[0]?.description).toBe('Smile 🚀');
  });

  it('selects the referenced model mapping version when multiple versions exist', () => {
    const xml = buildSolutionEnvelope(`
      <ERModelMappingVersion ID.="{MAP-OLD},1" DateTime="2026-04-14T12:00:00" Description="Old" Number="1">
        <Mapping>
          <ERModelMapping ID.="{MAP-OLD}" Name="Old mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
            <Binding>
              <ERDataContainerBinding>
                <Contents.>
                  <ERDataContainerPathBinding ExpressionAsString="\"old\"" Path="Root/Value">
                    <Expression>
                      <ERExpressionStringConstant Value="old" />
                    </Expression>
                  </ERDataContainerPathBinding>
                </Contents.>
              </ERDataContainerBinding>
            </Binding>
          </ERModelMapping>
        </Mapping>
      </ERModelMappingVersion>
      <ERModelMappingVersion ID.="{MAP-NEW},2" DateTime="2026-04-14T12:05:00" Description="New" Number="2">
        <Mapping>
          <ERModelMapping ID.="{MAP-NEW}" Name="New mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
            <Binding>
              <ERDataContainerBinding>
                <Contents.>
                  <ERDataContainerPathBinding ExpressionAsString="\"new\"" Path="Root/Value">
                    <Expression>
                      <ERExpressionStringConstant Value="new" />
                    </Expression>
                  </ERDataContainerPathBinding>
                </Contents.>
              </ERDataContainerBinding>
            </Binding>
          </ERModelMapping>
        </Mapping>
      </ERModelMappingVersion>
    `, { contentRefId: '{MAP-OLD}' });

    const config = parseERConfiguration(xml, 'multi-mapping.xml');
    if (config.content.kind !== 'ModelMapping') {
      throw new Error('Expected model mapping content');
    }

    expect(config.content.version.id).toBe('{MAP-OLD}');
    expect(config.content.version.mapping.name).toBe('Old mapping');
  });

  it('treats bundles with model mapping plus format refs as format configurations', () => {
    const xml = buildSolutionEnvelope(`
      <ERModelMappingVersion ID.="{FORMAT-MAP-DS},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERModelMapping ID.="{FORMAT-MAP-DS}" Name="Datasource mapping" DataContainerDescriptor="Document" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
            <Datasource>
              <ERModelDefinition>
                <Contents.>
                  <ERModelItemDefinition>
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="format">
                        <ValueSource>
                          <ERImportFormatDatasource FormatGUID="{FORMAT}" />
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                </Contents.>
              </ERModelDefinition>
            </Datasource>
          </ERModelMapping>
        </Mapping>
      </ERModelMappingVersion>
      <ERFormatVersion ID.="{FORMAT},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Format>
          <ERTextFormat ID.="{FORMAT}" Name="ABR MT940 format">
            <Root>
              <ERTextFormatFileComponent ID.="{ROOT}" Name="Root" />
            </Root>
          </ERTextFormat>
        </Format>
      </ERFormatVersion>
      <ERFormatMappingVersion ID.="{FORMAT-MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERFormatMapping ID.="{FORMAT-MAP}" Format="{FORMAT}" FormatVersion="{FORMAT},1" Name="ABR MT940 format" />
        </Mapping>
      </ERFormatMappingVersion>
    `, { contentRefIds: ['{FORMAT-MAP-DS}', '{FORMAT}', '{FORMAT-MAP}'] });

    const config = parseERConfiguration(xml, 'format-bundle.xml');

    expect(config.kind).toBe('Format');
    if (config.content.kind !== 'Format') {
      throw new Error('Expected format content');
    }

    expect(config.content.formatVersion.id).toBe('{FORMAT}');
    expect(config.content.formatVersion.format.name).toBe('ABR MT940 format');
    expect(config.content.formatMappingVersion.id).toBe('{FORMAT-MAP}');
    expect(config.content.embeddedModelMappingVersions).toHaveLength(1);
    expect(config.content.embeddedModelMappingVersions[0]?.id).toBe('{FORMAT-MAP-DS}');
    expect(config.content.direction).toBe('Import');
    expect(config.content.embeddedModelMappingVersions[0]?.mapping.datasources[0]).toMatchObject({
      type: 'ImportFormat',
      importFormatInfo: { formatGuid: '{FORMAT}' },
    });
  });

  it('parses non-file root format components such as folders and text sequences', () => {
    const xml = buildSolutionEnvelope(`
      <ERFormatVersion ID.="{FORMAT},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Format>
          <ERTextFormat ID.="{FORMAT}" Name="Folder format">
            <Root>
              <ERTextFormatFolderComponent ID.="{FOLDER}" Name="Reports">
                <Contents.>
                  <ERTextFormatFileComponent ID.="{FILE}" Name="Report.xml">
                    <Contents.>
                      <ERTextFormatSequence ID.="{SEQ}" Name="Body">
                        <Contents.>
                          <ERTextFormatDate ID.="{DATE}" Name="CreatedOn" />
                        </Contents.>
                      </ERTextFormatSequence>
                    </Contents.>
                  </ERTextFormatFileComponent>
                </Contents.>
              </ERTextFormatFolderComponent>
            </Root>
          </ERTextFormat>
        </Format>
      </ERFormatVersion>
      <ERFormatMappingVersion ID.="{FORMAT-MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERFormatMapping ID.="{FORMAT-MAP}" Format="{FORMAT}" FormatVersion="{FORMAT},1" Name="Folder format mapping" />
        </Mapping>
      </ERFormatMappingVersion>
    `, { contentRefIds: ['{FORMAT}', '{FORMAT-MAP}'] });

    const config = parseERConfiguration(xml, 'folder-format.xml');
    if (config.content.kind !== 'Format') {
      throw new Error('Expected format content');
    }

    expect(config.content.formatVersion.format.rootElement.name).toBe('Reports');
    expect(config.content.formatVersion.format.rootElement.elementType).toBe('File');
    expect(config.content.formatVersion.format.rootElement.children[0]?.elementType).toBe('File');
    expect(config.content.formatVersion.format.rootElement.children[0]?.children[0]?.elementType).toBe('TextSequence');
    expect(config.content.formatVersion.format.rootElement.children[0]?.children[0]?.children[0]?.elementType).toBe('DateTime');
    expect(config.content.direction).toBe('Export');
  });

  it('recognizes import formats from format naming heuristics even without embedded mappings', () => {
    const xml = buildSolutionEnvelope(`
      <ERFormatVersion ID.="{FORMAT},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Format>
          <ERTextFormat ID.="{FORMAT}" Name="Bank statement import MT940">
            <Root>
              <ERTextFormatFileComponent ID.="{ROOT}" Name="BankStatementImport" />
            </Root>
          </ERTextFormat>
        </Format>
      </ERFormatVersion>
      <ERFormatMappingVersion ID.="{FORMAT-MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERFormatMapping ID.="{FORMAT-MAP}" Format="{FORMAT}" FormatVersion="{FORMAT},1" Name="Bank statement import MT940" />
        </Mapping>
      </ERFormatMappingVersion>
    `, { contentRefIds: ['{FORMAT}', '{FORMAT-MAP}'] });

    const config = parseERConfiguration(xml, 'bank-statement-import.xml');
    if (config.content.kind !== 'Format') {
      throw new Error('Expected format content');
    }

    expect(config.content.direction).toBe('Import');
  });

  it('enriches group by datasource metadata from grouped and aggregated child nodes', () => {
    const xml = buildSolutionEnvelope(`
      <ERModelMappingVersion ID.="{MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERModelMapping ID.="{MAP}" Name="Mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
            <Datasource>
              <ERModelDefinition>
                <Contents.>
                  <ERModelItemDefinition>
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="TaxTransViewBoxed">
                        <ValueSource>
                          <ERModelGroupByFunction ListToGroup="$TaxTransactions" />
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                  <ERModelItemDefinition ParentPath="#TaxTransViewBoxed">
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="groupbyfields">
                        <ValueSource>
                          <ERContainerDataSourceHandler />
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                  <ERModelItemDefinition ParentPath="#TaxTransViewBoxed/$groupbyfields">
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="TaxCode">
                        <ValueSource>
                          <ERContainerDataSourceHandler />
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                  <ERModelItemDefinition ParentPath="#TaxTransViewBoxed">
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="aggregated">
                        <ValueSource>
                          <ERContainerDataSourceHandler />
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                  <ERModelItemDefinition ParentPath="#TaxTransViewBoxed/$aggregated">
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="TaxBaseAmountNormalized">
                        <ValueSource>
                          <ERModelExpressionItem ExpressionAsString="SUM($TaxTransactions.TaxBaseAmount)">
                            <Expression>
                              <ERExpressionNumericSum />
                            </Expression>
                          </ERModelExpressionItem>
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                </Contents.>
              </ERModelDefinition>
            </Datasource>
          </ERModelMapping>
        </Mapping>
      </ERModelMappingVersion>
    `, { contentRefId: '{MAP}' });

    const config = parseERConfiguration(xml, 'groupby.xml');
    if (config.content.kind !== 'ModelMapping') {
      throw new Error('Expected model mapping content');
    }

    const datasource = config.content.version.mapping.datasources[0];
    expect(datasource?.groupByInfo?.listToGroup).toBe('$TaxTransactions');
    expect(datasource?.groupByInfo?.groupedFields).toEqual([
      { name: 'TaxCode', path: 'TaxTransViewBoxed/groupbyfields/TaxCode' },
    ]);
    expect(datasource?.groupByInfo?.aggregations).toEqual([
      { name: 'TaxBaseAmountNormalized', path: 'TaxTransViewBoxed/aggregated/TaxBaseAmountNormalized', function: 'SUM' },
    ]);
  });

  it('parses group by metadata declared inline inside ERModelGroupByFunction', () => {
    const xml = buildSolutionEnvelope(`
      <ERModelMappingVersion ID.="{MAP},1" DateTime="2026-04-16T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERModelMapping ID.="{MAP}" Name="Mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
            <Datasource>
              <ERModelDefinition>
                <Contents.>
                  <ERModelItemDefinition ParentPath="#Annex">
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="$TaxTransDetailsDirectFilterJoinGroupSales">
                        <ValueSource>
                          <ERModelGroupByFunction ExecutionTarget="2" ListToGroup="#Annex/$TaxTransDetailsDirectFilterJoinSales">
                            <Aggregations>
                              <ERModelGroupByAggregations>
                                <Contents.>
                                  <ERModelGroupByAggregation FieldPath="#Annex/$TaxTransDetailsDirectFilterJoinSales/$TaxTransDetailsSales/TaxBaseAmountCur" SelectionField="1" />
                                  <ERModelGroupByAggregation FieldPath="#Annex/$TaxTransDetailsDirectFilterJoinSales/$EnterpriseNumView_Counterparty/RegistrationNumber" Name="EnterpriseNumber" SelectionField="3" />
                                </Contents.>
                              </ERModelGroupByAggregations>
                            </Aggregations>
                            <GroupedFields>
                              <ERModelGroupByFieldReferences>
                                <Contents.>
                                  <ERModelGroupByFieldReference FieldPath="#Annex/$TaxTransDetailsDirectFilterJoinSales/$TaxTransDetailsSales/InvoiceDate" />
                                  <ERModelGroupByFieldReference FieldPath="#Annex/$TaxTransDetailsDirectFilterJoinSales/$TaxTransDetailsSales/TaxCode" />
                                </Contents.>
                              </ERModelGroupByFieldReferences>
                            </GroupedFields>
                          </ERModelGroupByFunction>
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                </Contents.>
              </ERModelDefinition>
            </Datasource>
          </ERModelMapping>
        </Mapping>
      </ERModelMappingVersion>
    `, { contentRefId: '{MAP}' });

    const config = parseERConfiguration(xml, 'groupby-inline.xml');
    if (config.content.kind !== 'ModelMapping') {
      throw new Error('Expected model mapping content');
    }

    const datasource = config.content.version.mapping.datasources[0];
    expect(datasource?.groupByInfo?.listToGroup).toBe('#Annex/$TaxTransDetailsDirectFilterJoinSales');
    expect(datasource?.groupByInfo?.groupedFields).toEqual([
      { name: 'InvoiceDate', path: '#Annex/$TaxTransDetailsDirectFilterJoinSales/$TaxTransDetailsSales/InvoiceDate' },
      { name: 'TaxCode', path: '#Annex/$TaxTransDetailsDirectFilterJoinSales/$TaxTransDetailsSales/TaxCode' },
    ]);
    expect(datasource?.groupByInfo?.aggregations).toEqual([
      { name: 'TaxBaseAmountCur', path: '#Annex/$TaxTransDetailsDirectFilterJoinSales/$TaxTransDetailsSales/TaxBaseAmountCur', function: 'SUM' },
      { name: 'EnterpriseNumber', path: '#Annex/$TaxTransDetailsDirectFilterJoinSales/$EnterpriseNumView_Counterparty/RegistrationNumber', function: 'MAX' },
    ]);
  });

  it('maps all inline group by SelectionField values to aggregation labels', () => {
    const xml = buildSolutionEnvelope(`
      <ERModelMappingVersion ID.="{MAP},1" DateTime="2026-04-16T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERModelMapping ID.="{MAP}" Name="Mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
            <Datasource>
              <ERModelDefinition>
                <Contents.>
                  <ERModelItemDefinition>
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="$AllAggregations">
                        <ValueSource>
                          <ERModelGroupByFunction ExecutionTarget="2" ListToGroup="#Root/$Source">
                            <Aggregations>
                              <ERModelGroupByAggregations>
                                <Contents.>
                                  <ERModelGroupByAggregation FieldPath="#Root/$Source/AvgField" />
                                  <ERModelGroupByAggregation FieldPath="#Root/$Source/SumField" SelectionField="1" />
                                  <ERModelGroupByAggregation FieldPath="#Root/$Source/MinField" SelectionField="2" />
                                  <ERModelGroupByAggregation FieldPath="#Root/$Source/MaxField" SelectionField="3" />
                                  <ERModelGroupByAggregation FieldPath="#Root/$Source/CountField" SelectionField="4" />
                                </Contents.>
                              </ERModelGroupByAggregations>
                            </Aggregations>
                            <GroupedFields>
                              <ERModelGroupByFieldReferences />
                            </GroupedFields>
                          </ERModelGroupByFunction>
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                </Contents.>
              </ERModelDefinition>
            </Datasource>
          </ERModelMapping>
        </Mapping>
      </ERModelMappingVersion>
    `, { contentRefId: '{MAP}' });

    const config = parseERConfiguration(xml, 'groupby-inline-selection-fields.xml');
    if (config.content.kind !== 'ModelMapping') {
      throw new Error('Expected model mapping content');
    }

    const datasource = config.content.version.mapping.datasources[0];
    expect(datasource?.groupByInfo?.aggregations).toEqual([
      { name: 'AvgField', path: '#Root/$Source/AvgField', function: 'AVG' },
      { name: 'SumField', path: '#Root/$Source/SumField', function: 'SUM' },
      { name: 'MinField', path: '#Root/$Source/MinField', function: 'MIN' },
      { name: 'MaxField', path: '#Root/$Source/MaxField', function: 'MAX' },
      { name: 'CountField', path: '#Root/$Source/CountField', function: 'COUNT' },
    ]);
  });

  it('parses format enum datasources as a separate datasource kind', () => {
    const xml = buildSolutionEnvelope(`
      <ERFormatVersion ID.="{FORMAT},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Format>
          <ERTextFormat ID.="{FORMAT}" Name="Format with enum datasource">
            <EnumList>
              <EREnumDefinitionList>
                <Contents.>
                  <EREnumDefinition ID.="{FMT-ENUM}" Name="PaymentStatus" />
                </Contents.>
              </EREnumDefinitionList>
            </EnumList>
            <Root>
              <ERTextFormatFileComponent ID.="{ROOT}" Name="Root" />
            </Root>
          </ERTextFormat>
        </Format>
      </ERFormatVersion>
      <ERFormatMappingVersion ID.="{FORMAT-MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERFormatMapping ID.="{FORMAT-MAP}" Format="{FORMAT}" FormatVersion="{FORMAT},1" Name="Format with enum datasource">
            <Datasource>
              <ERModelDefinition>
                <Contents.>
                  <ERModelItemDefinition>
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="PaymentStatusDs">
                        <ValueSource>
                          <ERFormatEnumDataSourceHandler FormatEnumName="PaymentStatus" />
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
    `, { contentRefIds: ['{FORMAT}', '{FORMAT-MAP}'] });

    const config = parseERConfiguration(xml, 'format-enum.xml');
    if (config.content.kind !== 'Format') {
      throw new Error('Expected format content');
    }

    const datasource = config.content.formatMappingVersion.formatMapping.datasources[0];
    expect(datasource?.type).toBe('FormatEnum');
    expect(datasource?.enumInfo).toMatchObject({
      enumName: 'PaymentStatus',
      sourceKind: 'Format',
      isModelEnum: false,
    });
  });

  it('resolves format enum datasource GUID references to enum names', () => {
    const xml = buildSolutionEnvelope(`
      <ERFormatVersion ID.="{FORMAT},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Format>
          <ERTextFormat ID.="{FORMAT}" Name="Format with enum datasource">
            <EnumList>
              <EREnumDefinitionList>
                <Contents.>
                  <EREnumDefinition ID.="{FMT-ENUM}" Name="PaymentStatus" />
                </Contents.>
              </EREnumDefinitionList>
            </EnumList>
            <Root>
              <ERTextFormatFileComponent ID.="{ROOT}" Name="Root" />
            </Root>
          </ERTextFormat>
        </Format>
      </ERFormatVersion>
      <ERFormatMappingVersion ID.="{FORMAT-MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERFormatMapping ID.="{FORMAT-MAP}" Format="{FORMAT}" FormatVersion="{FORMAT},1" Name="Format with enum datasource">
            <Datasource>
              <ERModelDefinition>
                <Contents.>
                  <ERModelItemDefinition>
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="PaymentStatusDs">
                        <ValueSource>
                          <ERFormatEnumDataSourceHandler Name="{FMT-ENUM}" FormatEnum="{FMT-ENUM}" />
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
    `, { contentRefIds: ['{FORMAT}', '{FORMAT-MAP}'] });

    const config = parseERConfiguration(xml, 'format-enum-guid.xml');
    if (config.content.kind !== 'Format') {
      throw new Error('Expected format content');
    }

    const datasource = config.content.formatMappingVersion.formatMapping.datasources[0];
    expect(datasource?.type).toBe('FormatEnum');
    expect(datasource?.enumInfo).toMatchObject({
      enumName: 'PaymentStatus',
      sourceKind: 'Format',
      isModelEnum: false,
    });
  });

  it('parses generic calls with nested arguments from contents', () => {
    const expression = parseFirstBindingExpression(`
      <ERExpressionGenericCall ItemPath="WithholdingTax/$RegNumIssuerCode">
        <Contents.>
          <ERExpressionGenericCall ItemPath="WithholdingTax/$DirPartyLocationRecId">
            <Contents.>
              <ERExpressionInt64ItemValue ItemPath="WithholdingTax/$WHTTransDetailsJoined/RegNumView_Counterparty/DirPartyTableRecId" />
            </Contents.>
          </ERExpressionGenericCall>
          <ERExpressionStringItemValue ItemPath="WithholdingTax/$WHTTransDetailsJoined/RegNumView_Counterparty/RegistrationNumber" />
        </Contents.>
      </ERExpressionGenericCall>
    `);

    expect(expression).toMatchObject({ kind: 'Call', functionName: 'WithholdingTax/$RegNumIssuerCode' });
    if (expression.kind !== 'Call') {
      throw new Error('Expected Call expression');
    }

    expect(expression.arguments).toHaveLength(2);
    expect(expression.arguments[0]).toMatchObject({ kind: 'Call', functionName: 'WithholdingTax/$DirPartyLocationRecId' });
    expect(expression.arguments[1]).toMatchObject({ kind: 'ItemValue', itemPath: 'WithholdingTax/$WHTTransDetailsJoined/RegNumView_Counterparty/RegistrationNumber' });
  });

  it('parses case expressions with explicit default value', () => {
    const expression = parseFirstBindingExpression(`
      <ERExpressionGenericCase>
        <Contents.>
          <ERExpressionEnumItemValue ItemPath="001_System/$TaxJuristictionUIP" />
          <ERExpressionEnumItemValue ItemPath="TaxJurisdictionEnum/NL" />
          <ERExpressionStringItemValue ItemPath="$TaxEvatParameters/ContactId" />
          <ERExpressionStringConstant Value="fallback" />
        </Contents.>
      </ERExpressionGenericCase>
    `);

    expect(expression).toMatchObject({ kind: 'Case' });
    if (expression.kind !== 'Case') {
      throw new Error('Expected Case expression');
    }

    expect(expression.cases).toHaveLength(1);
    expect(expression.cases[0]?.when).toMatchObject({ kind: 'ItemValue', itemPath: 'TaxJurisdictionEnum/NL' });
    expect(expression.cases[0]?.then).toMatchObject({ kind: 'ItemValue', itemPath: '$TaxEvatParameters/ContactId' });
    expect(expression.defaultValue).toMatchObject({ kind: 'Constant', value: 'fallback' });
  });

  it('parses list where expressions with condition argument', () => {
    const expression = parseFirstBindingExpression(`
      <ERExpressionListWhere>
        <Condition>
          <ERExpressionEnumEquals>
            <FirstExpression>
              <ERExpressionEnumItemValue ItemPath="model/TaxTransactionsDetails/$ReportFieldClassifier" />
            </FirstExpression>
            <SecondExpression>
              <ERExpressionEnumItemValue ItemPath="$ReportFieldEnum/EUPurchaseGoodsVATPayableStandard" />
            </SecondExpression>
          </ERExpressionEnumEquals>
        </Condition>
        <List>
          <ERExpressionListItemValue ItemPath="model/TaxTransactionsDetails" />
        </List>
      </ERExpressionListWhere>
    `);

    expect(expression).toMatchObject({ kind: 'ListOp', operator: 'Where' });
    if (expression.kind !== 'ListOp') {
      throw new Error('Expected ListOp expression');
    }

    expect(expression.operand).toMatchObject({ kind: 'ItemValue', itemPath: 'model/TaxTransactionsDetails' });
    expect(expression.arguments?.[0]).toMatchObject({ kind: 'Comparison', operator: 'Equals' });
  });

  it('parses logical OR and arithmetic divide/negate operations', () => {
    const orExpression = parseFirstBindingExpression(`
      <ERExpressionOr>
        <Contents.>
          <ERExpressionBooleanItemValue ItemPath="$IsTaxJurisdictionDefault" />
          <ERExpressionBooleanConstant Value="1" />
        </Contents.>
      </ERExpressionOr>
    `);
    expect(orExpression).toMatchObject({ kind: 'BinaryOp', operator: 'Or' });

    const divideExpression = parseFirstBindingExpression(`
      <ERExpressionNumericDivide>
        <Dividend>
          <ERExpressionRealItemValue ItemPath="$TaxTransViewBoxed/aggregated/TaxBaseAmountNormalized" />
        </Dividend>
        <Divisor>
          <ERExpressionIntConstant Value="100" />
        </Divisor>
      </ERExpressionNumericDivide>
    `);
    expect(divideExpression).toMatchObject({ kind: 'BinaryOp', operator: 'Divide' });

    const negateExpression = parseFirstBindingExpression(`
      <ERExpressionNumericUnarySubtract>
        <Expression>
          <ERExpressionIntConstant Value="1" />
        </Expression>
      </ERExpressionNumericUnarySubtract>
    `);
    expect(negateExpression).toMatchObject({ kind: 'UnaryOp', operator: 'Negate' });
  });
});