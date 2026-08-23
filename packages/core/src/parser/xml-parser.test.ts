import { describe, expect, it } from 'vitest';
import { parseERConfiguration, parseERConfigurations } from './xml-parser.js';
import { getFormatElementDataType, getFormatElementExcelRange } from '../format/element-info.js';
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
  it('propagates F&O ErFnoBundle Name hint and ERTextFormat @_Name onto solution envelope', () => {
    // The UI renders tab labels / designer headers from
    // `solutionVersion.solution.name`. When F&O returns only the bare
    // content (no envelope), we synthesise one — and without a name
    // the tab comes out blank. The parser must surface either the
    // ErFnoBundle's `Name=` hint (injected by fno-client) or the
    // bare content root's own `Name` attribute.
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ErFnoBundle Name="Invoice format">
  <ERTextFormat ID.="{FORMAT}" Name="Invoice format">
    <Root>
      <ERTextFormatFileComponent ID.="{ROOT}" Name="Root" />
    </Root>
  </ERTextFormat>
  <ERFormatMapping ID.="{FORMAT-MAP}" Format="{FORMAT}" FormatVersion="{FORMAT},1" Name="Invoice format" />
</ErFnoBundle>`;
    const config = parseERConfiguration(xml, 'fno-bundle-name.xml');
    expect(config.solutionVersion.solution.name).toBe('Invoice format');
  });

  it('preserves real ERFormatMapping bindings when bundled alongside bare ERTextFormat (F&O GetEffectiveFormatMappingByID shape)', () => {
    // Regression: F&O's GetEffectiveFormatMappingByID returns the
    // format grammar and the format mapping as two separate XML
    // fragments inside the same response, which fno-client bundles
    // into `<ErFnoBundle>`. An earlier `wrapBareContent` inserted an
    // empty-stub ERFormatMappingVersion upon seeing ERTextFormat
    // *before* checking for the real ERFormatMapping fragment,
    // shadowing the real one and dropping every binding.
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ErFnoBundle>
  <ERTextFormat ID.="{FORMAT}" Name="Invoice format">
    <Root>
      <ERTextFormatFileComponent ID.="{ROOT}" Name="Root" />
    </Root>
  </ERTextFormat>
  <ERFormatMapping ID.="{FORMAT-MAP}" Format="{FORMAT}" FormatVersion="{FORMAT},1" Name="Invoice format mapping">
    <Binding>
      <ERFormatBinding>
        <Contents.>
          <ERFormatComponentBinding Component="{ROOT}" ExpressionAsString="invoiceId">
            <Expression>
              <ERPathExpression Path="model.invoiceId" />
            </Expression>
          </ERFormatComponentBinding>
        </Contents.>
      </ERFormatBinding>
    </Binding>
  </ERFormatMapping>
</ErFnoBundle>`;

    const config = parseERConfiguration(xml, 'fno-bundle-format.xml');
    if (config.content.kind !== 'Format') {
      throw new Error('Expected format content');
    }
    const bindings = config.content.formatMappingVersion.formatMapping.bindings;
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings[0]?.componentId).toBe('{ROOT}');
    expect(bindings[0]?.expressionAsString).toBe('invoiceId');
  });

  it('exposes the root container descriptor a format binds to (ERModelDataSourceHandler)', () => {
    // `model.*` expressions only resolve against the ModelMapping of the
    // descriptor named here — F&O serves a different mapping per descriptor.
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ErFnoBundle>
  <ERTextFormat ID.="{FORMAT}" Name="Sales invoice">
    <Root>
      <ERTextFormatFileComponent ID.="{ROOT}" Name="Root" />
    </Root>
  </ERTextFormat>
  <ERFormatMapping ID.="{FORMAT-MAP}" Format="{FORMAT}" FormatVersion="{FORMAT},1" Name="Sales invoice mapping">
    <Datasource>
      <ERModelDefinition>
        <Contents.>
          <ERModelItemDefinition>
            <ValueDefinition>
              <ERModelItemValueDefinition Name="model">
                <ValueSource>
                  <ERModelDataSourceHandler DataContainerDescriptorName="SalesInvoice" ModelGuid="{MODEL}" RevisionNumber="224" />
                </ValueSource>
              </ERModelItemValueDefinition>
            </ValueDefinition>
          </ERModelItemDefinition>
        </Contents.>
      </ERModelDefinition>
    </Datasource>
  </ERFormatMapping>
</ErFnoBundle>`;

    const config = parseERConfiguration(xml, 'format-model-descriptor.xml');
    if (config.content.kind !== 'Format') {
      throw new Error('Expected format content');
    }
    const modelDs = config.content.formatMappingVersion.formatMapping.datasources.find(
      d => d.name === 'model',
    );
    expect(modelDs?.type).toBe('DataModel');
    expect(modelDs?.modelInfo?.dataContainerDescriptorName).toBe('SalesInvoice');
    expect(modelDs?.modelInfo?.modelGuid).toBe('{MODEL}');
  });

  it('parses bare ERDataModel root (F&O GetDataModelByIDAndRevision shape)', () => {
    // F&O's GetDataModelByIDAndRevision returns the DataModel content
    // under a bare `<ERDataModel>` root (no surrounding
    // `<ERSolutionVersion>` / `<ERDataModelVersion>` envelope, and not
    // wrapped in `<ERModelDefinition>` either). `wrapBareContent` must
    // map it onto `Model.ERDataModel` so `parseDataModelVersion`
    // finds it.
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ErFnoBundle Name="TaxDeclarationModel">
  <ERDataModel ID.="{MODEL}" Name="TaxDeclarationModel">
    <Contents.>
      <ERDataContainerDescriptor ID.="{CONT}" Name="Reports" IsRoot="1">
        <Contents.>
          <ERDataContainerDescriptorItem Name="Amount" Type="6" />
        </Contents.>
      </ERDataContainerDescriptor>
    </Contents.>
  </ERDataModel>
</ErFnoBundle>`;
    const config = parseERConfiguration(xml, 'bare-datamodel.xml');
    expect(config.content.kind).toBe('DataModel');
    if (config.content.kind !== 'DataModel') return;
    expect(config.content.version.model.name).toBe('TaxDeclarationModel');
    expect(config.content.version.model.containers.length).toBe(1);
    expect(config.content.version.model.containers[0]?.name).toBe('Reports');
  });

  it('collects labels from every ERClassList language pack and container-level Label refs', () => {
    // F&O exports the label dictionary as one <ERClassList> per language,
    // so `Labels` arrives as an array. Reading only the first node dropped
    // every translation and left raw @GER_LABEL: ids on screen.
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion DateTime="2026-04-14T12:00:00" Description="test" Number="1" PublicVersionNumber="1" VersionStatus="2">
  <Solution>
    <ERSolution ID.="{SOLUTION}" Name="Test solution">
      <Labels>
        <ERClassList>
          <Contents.>
            <ERLabel LabelId="GER_LABEL:Amount" LabelValue="Amount" LanguageId="en-us" />
          </Contents.>
        </ERClassList>
        <ERClassList>
          <Contents.>
            <ERLabel LabelId="GER_LABEL:Amount" LabelValue="Částka" LanguageId="cs" />
          </Contents.>
        </ERClassList>
      </Labels>
      <Vendor><ERVendor Name="Microsoft" Url="http://microsoft.com" /></Vendor>
      <Contents.><Ref. ID.="{MODEL}" /></Contents.>
    </ERSolution>
  </Solution>
  <Contents.>
    <ERDataModelVersion ID.="{MODEL},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
      <Model>
        <ERDataModel ID.="{MODEL}" Name="Model">
          <Contents.>
            <ERDataContainerDescriptor ID.="{CONT}" Name="Reports" IsRoot="1" Label="@&quot;GER_LABEL:Amount&quot;" Description="@&quot;GER_LABEL:Amount&quot;">
              <Contents.>
                <ERDataContainerDescriptorItem Name="Amount" Type="6" Label="@&quot;GER_LABEL:Amount&quot;" />
              </Contents.>
            </ERDataContainerDescriptor>
          </Contents.>
        </ERDataModel>
      </Model>
    </ERDataModelVersion>
  </Contents.>
</ERSolutionVersion>`;
    const config = parseERConfiguration(xml, 'labels.xml');
    expect(config.solutionVersion.solution.labels.map(l => l.languageId)).toEqual(['en-us', 'cs']);
    if (config.content.kind !== 'DataModel') throw new Error('Expected data model');
    const container = config.content.version.model.containers[0];
    expect(container?.label).toBe('@"GER_LABEL:Amount"');
    expect(container?.description).toBe('@"GER_LABEL:Amount"');
    expect(container?.items[0]?.label).toBe('@"GER_LABEL:Amount"');
  });

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

  it('nests datasources under a "#"-prefixed intermediate parent', () => {
    const xml = buildSolutionEnvelope(`
      <ERModelMappingVersion ID.="{MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERModelMapping ID.="{MAP}" Name="Mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1">
            <Datasource>
              <ERModelDefinition>
                <Contents.>
                  <ERModelItemDefinition>
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="Tables">
                        <ValueSource>
                          <ERContainerDataSourceHandler />
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                  <ERModelItemDefinition ParentPath="Tables">
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="#SourceJournalTables">
                        <ValueSource>
                          <ERContainerDataSourceHandler />
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                  <ERModelItemDefinition ParentPath="Tables/#SourceJournalTables">
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="$CustInvoiceJour">
                        <ValueSource>
                          <ERModelExpressionItem ExpressionAsString="FILTER(Tables.CustInvoiceJour)" />
                        </ValueSource>
                      </ERModelItemValueDefinition>
                    </ValueDefinition>
                  </ERModelItemDefinition>
                  <ERModelItemDefinition ParentPath="Tables/#SourceJournalTables/$CustInvoiceJour">
                    <ValueDefinition>
                      <ERModelItemValueDefinition Name="$InvoiceDate">
                        <ValueSource>
                          <ERModelExpressionItem ExpressionAsString="Tables.'#SourceJournalTables'.'$CustInvoiceJour'.InvoiceDate" />
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

    const datasources = config.content.version.mapping.datasources;
    expect(datasources.map(ds => ds.name)).toEqual(['Tables']);

    const sourceJournalTables = datasources[0]?.children[0];
    expect(sourceJournalTables?.name).toBe('#SourceJournalTables');

    const custInvoiceJour = sourceJournalTables?.children[0];
    expect(custInvoiceJour?.name).toBe('$CustInvoiceJour');
    expect(custInvoiceJour?.children.map(child => child.name)).toEqual(['$InvoiceDate']);
  });

  it('decodes numeric Unicode entities beyond the BMP', () => {    const xml = buildSolutionEnvelope(`
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
          <ERTextFormat ID.="{FORMAT}" Name="ABR MT940 format" DataImportSupport="1">
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

  it('parses PDF converter formats and labels Excel components by their range name', () => {
    const xml = buildSolutionEnvelope(`
      <ERFormatVersion ID.="{FORMAT},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Format>
          <ERTextFormat ID.="{FORMAT}" Name="Order (PDF)">
            <Root>
              <ERTextFormatPDFConverterComponent ID.="{PDF}">
                <Contents.>
                  <ERTextFormatExcelFileComponent ID.="{XLSX}">
                    <Contents.>
                      <ERTextFormatExcelSheet ID.="{SHEET}" ExcelSheetName="Sheet1">
                        <Contents.>
                          <ERTextFormatExcelRange ID.="{RANGE}" ExcelRange="Header">
                            <Contents.>
                              <ERTextFormatExcelCell ID.="{CELL}" ExcelRange="Header_CompanyName_Value" />
                            </Contents.>
                          </ERTextFormatExcelRange>
                        </Contents.>
                      </ERTextFormatExcelSheet>
                    </Contents.>
                  </ERTextFormatExcelFileComponent>
                </Contents.>
              </ERTextFormatPDFConverterComponent>
            </Root>
          </ERTextFormat>
        </Format>
      </ERFormatVersion>
      <ERFormatMappingVersion ID.="{FORMAT-MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERFormatMapping ID.="{FORMAT-MAP}" Format="{FORMAT}" FormatVersion="{FORMAT},1" Name="Order (PDF)" />
        </Mapping>
      </ERFormatMappingVersion>
    `, { contentRefIds: ['{FORMAT}', '{FORMAT-MAP}'] });

    const config = parseERConfiguration(xml, 'pdf-format.xml');
    if (config.content.kind !== 'Format') {
      throw new Error('Expected format content');
    }

    const root = config.content.formatVersion.format.rootElement;
    expect(root.elementType).toBe('PDFFile');

    const file = root.children[0];
    expect(file?.elementType).toBe('ExcelFile');

    const sheet = file?.children[0];
    expect(sheet?.elementType).toBe('ExcelSheet');
    expect(sheet?.name).toBe('Sheet1');

    const range = sheet?.children[0];
    expect(range?.elementType).toBe('ExcelRange');
    expect(range?.name).toBe('Header');

    const cell = range?.children[0];
    expect(cell?.elementType).toBe('ExcelCell');
    expect(cell?.name).toBe('Header_CompanyName_Value');

    // Every Excel component must expose its range/sheet name and a data type;
    // the designer shows both as properties.
    expect(getFormatElementExcelRange(sheet!)).toBe('Sheet1');
    expect(getFormatElementExcelRange(range!)).toBe('Header');
    expect(getFormatElementExcelRange(cell!)).toBe('Header_CompanyName_Value');
    expect(getFormatElementDataType(range!)).toBe('Void');
    expect(getFormatElementDataType(cell!)).toBe('String');
  });

  it('recognizes import formats from DataImportSupport="1"', () => {
    const xml = buildSolutionEnvelope(`
      <ERFormatVersion ID.="{FORMAT},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Format>
          <ERTextFormat ID.="{FORMAT}" Name="Bank statement import MT940" DataImportSupport="1">
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

  it('treats formats without DataImportSupport="1" as export even if the name looks import-like', () => {
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

    const config = parseERConfiguration(xml, 'bank-statement-export.xml');
    if (config.content.kind !== 'Format') {
      throw new Error('Expected format content');
    }

    expect(config.content.direction).toBe('Export');
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

describe('parseERConfigurations', () => {
  it('splits a bundle carrying both a data model and a model mapping into two configurations', () => {
    const xml = buildSolutionEnvelope(`
      <ERDataModelVersion ID.="{MODEL},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Model>
          <ERDataModel ID.="{MODEL}" Name="Model">
            <Contents.>
              <ERDataContainerDescriptor ID.="{ROOT}" Name="Root" IsRoot="1">
                <Contents.>
                  <ERDataContainerDescriptorItem Name="Value" Type="6" />
                </Contents.>
              </ERDataContainerDescriptor>
            </Contents.>
          </ERDataModel>
        </Model>
      </ERDataModelVersion>
      <ERModelMappingVersion ID.="{MAP},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Mapping>
          <ERModelMapping ID.="{MAP}" Name="Mapping" DataContainerDescriptor="Root" Model="{MODEL}" ModelName="Model" ModelVersion="{MODEL},1" />
        </Mapping>
      </ERModelMappingVersion>
    `, { contentRefIds: ['{MODEL}', '{MAP}'] });

    const configs = parseERConfigurations(xml, 'model-and-mapping.xml');

    expect(configs.map(c => c.kind)).toEqual(['DataModel', 'ModelMapping']);
    expect(configs[0]?.filePath).toBe('model-and-mapping.xml#datamodel:{MODEL}');
    expect(configs[1]?.filePath).toBe('model-and-mapping.xml');
  });

  it('returns a single configuration for bundles without an embedded data model', () => {
    const xml = buildSolutionEnvelope(`
      <ERDataModelVersion ID.="{MODEL},1" DateTime="2026-04-14T12:00:00" Description="Fixture" Number="1">
        <Model>
          <ERDataModel ID.="{MODEL}" Name="Model">
            <Contents.>
              <ERDataContainerDescriptor ID.="{ROOT}" Name="Root" IsRoot="1" />
            </Contents.>
          </ERDataModel>
        </Model>
      </ERDataModelVersion>
    `, { contentRefId: '{MODEL}' });

    const configs = parseERConfigurations(xml, 'model.xml');

    expect(configs).toHaveLength(1);
    expect(configs[0]?.kind).toBe('DataModel');
    expect(configs[0]?.filePath).toBe('model.xml');
  });
});
