/**
 * A small but complete ER workspace for tests: a data model with two roots, a
 * model mapping with a definition per root, an XML export format and a CSV
 * export format — parsed from XML, so the parser shapes are the real ones.
 */
import { parseERConfiguration, type ERConfiguration } from '@er-visualizer/core';

const MODEL_ID = '{A1000000-0000-4000-8000-000000000001}';
let guidCounter = 0;
const guid = () => `{F0000000-0000-4000-8000-${(++guidCounter).toString(16).toUpperCase().padStart(12, '0')}}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function envelope(name: string, ref: string, contents: string, labels = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ERSolutionVersion DateTime="2026-09-01T10:00:00" Description="" Number="1" PublicVersionNumber="1" VersionStatus="2">
  <Solution><ERSolution ID.="${ref}" Name="${esc(name)}">
    <Contents.><Ref. ID.="${ref}" /></Contents.>
    <Labels><ERClassList><Contents.>${labels}</Contents.></ERClassList></Labels>
    <Vendor><ERVendor Name="Test" Url="" /></Vendor>
  </ERSolution></Solution>
  <Contents.>${contents}</Contents.>
</ERSolutionVersion>`;
}

const T = { Str: 6, Real: 5, Date: 7, Enum: 9, Rec: 10, List: 11 };
type Item = [name: string, type: number, td?: string, label?: string];
const containers: Array<{ name: string; root?: boolean; isEnum?: boolean; items: Item[] }> = [
  { name: 'InvoiceCustomer', root: true, items: [['InvoiceBase', T.Rec, 'InvoiceBase_1']] },
  { name: 'InvoiceProject', root: true, items: [['InvoiceBase', T.Rec, 'InvoiceBase_1'], ['ProjectId', T.Str]] },
  { name: 'InvoiceBase_1', items: [
    ['InvoiceId', T.Str, undefined, 'GER_LABEL:InvoiceId'], ['InvoiceDate', T.Date], ['InvoiceAmount', T.Real],
    ['PaymentMethod', T.Enum, 'PaymentMethod'], ['Notes', T.Str],
    ['CompanyInfo', T.Rec, 'CompanyInfo_1'], ['Lines', T.List, 'InvoiceLine_1'], ['TaxSummary', T.List, 'TaxLine_1'],
  ] },
  { name: 'CompanyInfo_1', items: [['Name', T.Str], ['VATNum', T.Str]] },
  { name: 'InvoiceLine_1', items: [['ItemId', T.Str], ['Quantity', T.Real], ['LineAmount', T.Real]] },
  { name: 'TaxLine_1', items: [['TaxCode', T.Str], ['TaxAmount', T.Real]] },
  { name: 'PaymentMethod', isEnum: true, items: [['Cash', T.Enum], ['BankTransfer', T.Enum]] },
];

export const MODEL_XML = envelope('Invoice model', MODEL_ID, `
  <ERDataModelVersion ID.="${MODEL_ID},1" DateTime="" Description="" Number="1"><Model>
    <ERDataModel ID.="${MODEL_ID}" Name="Invoice model"><Contents.>
      ${containers.map(c => `<ERDataContainerDescriptor ID.="${c.name}" Name="${c.name}"${c.root ? ' IsRoot="1"' : ''}${c.isEnum ? ' IsEnum="1"' : ''}><Contents.>
        ${c.items.map(([n, ty, td, label]) => `<ERDataContainerDescriptorItem Name="${n}" Type="${ty}"${td ? ` TypeDescriptor="${td}"` : ''}${label ? ` Label="@&quot;${label}&quot;"` : ''} />`).join('')}
      </Contents.></ERDataContainerDescriptor>`).join('')}
    </Contents.></ERDataModel>
  </Model></ERDataModelVersion>`,
  '<ERLabel LabelId="GER_LABEL:InvoiceId" LabelValue="Invoice number" LanguageId="en-us" /><ERLabel LabelId="GER_LABEL:InvoiceId" LabelValue="Číslo faktury" LanguageId="cs" />');

const ds = (name: string, parentPath: string, source: string) => `<ERModelItemDefinition${parentPath ? ` ParentPath="${esc(parentPath)}"` : ''}><ValueDefinition><ERModelItemValueDefinition Name="${esc(name)}"><ValueSource>${source}</ValueSource></ERModelItemValueDefinition></ValueDefinition></ERModelItemDefinition>`;
const table = (name: string) => `<ERTableDataSourceHandler Table="${name}" />`;
const calc = (expr: string) => `<ERModelExpressionItem ExpressionAsString="${esc(expr)}" />`;
const bind = (path: string, expr: string) => `<ERDataContainerPathBinding Path="${esc(path)}" ExpressionAsString="${esc(expr)}" />`;

function definition(id: string, name: string, descriptor: string, extra: string[] = []): string {
  return `<ERModelMapping ID.="${id}" Name="${name}" DataContainerDescriptor="${descriptor}" Model="${MODEL_ID}" ModelName="Invoice model" ModelVersion="${MODEL_ID},1">
    <Binding><ERDataContainerBinding><Contents.>
      ${[
        bind('InvoiceBase/InvoiceId', '$Invoice.InvoiceId'),
        bind('InvoiceBase/InvoiceDate', '$Invoice.InvoiceDate'),
        bind('InvoiceBase/InvoiceAmount', 'ROUND($Invoice.InvoiceAmount, 2)'),
        bind('InvoiceBase/PaymentMethod', 'CASE($Invoice.PaymMode, PaymMode.Cash, "Cash", "BankTransfer")'),
        bind('InvoiceBase/CompanyInfo/Name', '$Company.Name'),
        bind('InvoiceBase/CompanyInfo/VATNum', '$Company.VATNum'),
        bind('InvoiceBase/Lines', '$Lines'),
        bind('InvoiceBase/Lines/ItemId', '@.ItemId'),
        bind('InvoiceBase/Lines/Quantity', '@.Qty'),
        bind('InvoiceBase/Lines/LineAmount', 'ROUND(@.LineAmount, 2)'),
        bind('InvoiceBase/TaxSummary', 'TaxGrouped'),
        bind('InvoiceBase/TaxSummary/TaxCode', '@.groupBy.TaxCode'),
        bind('InvoiceBase/TaxSummary/TaxAmount', '@.aggregated.TaxAmount'),
        ...extra,
      ].join('')}
    </Contents.></ERDataContainerBinding></Binding>
    <Datasource><ERModelDefinition><Contents.>
      ${[
        ds('Parameters', '', '<ERUserParameterDataSourceHandler ExtendedDataTypeName="InvoiceId" />'),
        ds('CustInvoiceJour', '', table('CustInvoiceJour')),
        ds('$Invoice', '', calc('FIRSTORNULL(WHERE(CustInvoiceJour, CustInvoiceJour.InvoiceId = Parameters.InvoiceId))')),
        ds('CompanyInfo', '', table('CompanyInfo')),
        ds('$Company', '', calc('CompanyInfo.find()')),
        ds('CustInvoiceTrans', '', table('CustInvoiceTrans')),
        ds('$Lines', '', calc('ORDERBY(WHERE(CustInvoiceTrans, CustInvoiceTrans.InvoiceId = $Invoice.InvoiceId), CustInvoiceTrans.LineNum)')),
        ds('TaxTrans', '', table('TaxTrans')),
        ds('TaxGrouped', '', '<ERModelGroupByFunction ListToGroup="TaxTrans" />'),
        ds('TaxCode', 'TaxGrouped/groupBy', calc('@.TaxCode')),
        ds('TaxAmount', 'TaxGrouped/aggregated', calc('SUM(@.TaxAmount)')),
        ds('PaymMode', '', '<EREnumDataSourceHandler EnumName="CustPaymMode" />'),
      ].join('')}
    </Contents.></ERModelDefinition></Datasource>
  </ERModelMapping>`;
}

export const MAPPING_ID = '{B1000000-0000-4000-8000-000000000001}';
export const MAPPING_XML = envelope('Invoice model mapping', MAPPING_ID, `
  <ERModelMappingVersion ID.="${MAPPING_ID},1" DateTime="" Description="" Number="1"><Mapping>
    ${definition(MAPPING_ID, 'Customer invoice', 'InvoiceCustomer')}
    ${definition('{B1000000-0000-4000-8000-000000000002}', 'Project invoice', 'InvoiceProject', [bind('ProjectId', 'ProjInvoiceJour.ProjId')])}
  </Mapping></ERModelMappingVersion>`);

interface El { tag: string; attrs: Record<string, string>; children: El[]; bindings: Array<{ prop?: string; expr: string }>; id: string }
const el = (tag: string, attrs: Record<string, string>, children: El[] = [], bindings: Array<{ prop?: string; expr: string }> = []): El => ({ tag, attrs, children, bindings, id: guid() });
const render = (node: El): string => {
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return node.children.length
    ? `<${node.tag} ID.="${node.id}"${attrs}><Contents.>${node.children.map(render).join('')}</Contents.></${node.tag}>`
    : `<${node.tag} ID.="${node.id}"${attrs} />`;
};
const bindingsOf = (node: El): string[] => [
  ...node.bindings.map(b => b.prop
    ? `<ERFormatComponentPropertyBinding Component="${node.id}" PropertyName="${b.prop}" ExpressionAsString="${esc(b.expr)}" />`
    : `<ERFormatComponentBinding Component="${node.id}" ExpressionAsString="${esc(b.expr)}" />`),
  ...node.children.flatMap(bindingsOf),
];

function formatXml(name: string, id: string, root: El, extraDs = ''): string {
  return envelope(name, id, `
  <ERFormatVersion ID.="${id},1" DateTime="" Description="" Number="1"><Format>
    <ERTextFormat ID.="${id}" Name="${esc(name)}"><Root>${render(root)}</Root></ERTextFormat>
  </Format></ERFormatVersion>
  <ERFormatMappingVersion ID.="${id.replace('C', 'D')},1" DateTime="" Description="" Number="1"><Mapping>
    <ERFormatMapping ID.="${id.replace('C', 'D')}" Format="${id}" FormatVersion="${id},1" Name="${esc(name)}">
      <Binding><ERFormatBinding><Contents.>${bindingsOf(root).join('')}</Contents.></ERFormatBinding></Binding>
      <Datasource><ERModelDefinition><Contents.>
        ${ds('model', '', `<ERModelDataSourceHandler ModelGuid="${MODEL_ID}" RevisionNumber="1" DataContainerDescriptorName="InvoiceCustomer" />`)}
        ${extraDs}
      </Contents.></ERModelDefinition></Datasource>
    </ERFormatMapping>
  </Mapping></ERFormatMappingVersion>`);
}

const S = (name: string, maxLen?: number, expr?: string, attrs: Record<string, string> = {}) =>
  el('ERTextFormatString', { Name: name, ...(maxLen ? { MaximalLength: String(maxLen) } : {}), ...attrs }, [], expr ? [{ expr }] : []);
const N = (name: string, expr?: string, attrs: Record<string, string> = {}) => el('ERTextFormatNumeric', { Name: name, ...attrs }, [], expr ? [{ expr }] : []);
const X = (name: string, children: El[], bindings: Array<{ prop?: string; expr: string }> = [], attrs: Record<string, string> = {}) =>
  el('ERTextFormatXMLElement', { Name: name, ...attrs }, children, bindings);

export const XML_FORMAT_ID = '{C1000000-0000-4000-8000-000000000001}';
export const XML_FORMAT_XML = formatXml('Sales invoice XML', XML_FORMAT_ID,
  el('ERTextFormatFileComponent', { Name: 'Invoice', Encoding: 'UTF-8' }, [
    X('Invoice', [
      el('ERTextFormatXMLAttribute', { Name: 'version' }, [S('String', 5, '"1.0"')]),
      X('InvoiceNumber', [S('String', 20, 'model.InvoiceBase.InvoiceId', { MinimalLength: '1' })]),
      X('Note', [S('String', 250, 'model.InvoiceBase.Notes')], [{ prop: 'Enabled', expr: 'model.InvoiceBase.Notes <> ""' }], { Multiplicity: '10' }),
      X('SellerName', [S('String', 100, 'model.InvoiceBase.CompanyInfo.Name')]),
      X('BIC', [S('String', 11)]),
      X('Lines', [
        X('Line', [
          X('ItemId', [S('String', 20, '@.ItemId')]),
          X('Quantity', [N('Numeric', '@.Quantity', { NumberFormat: '0.###' })]),
          X('Total', [N('Numeric', '@.Quantity * @.LineAmount')]),
        ], [{ expr: 'model.InvoiceBase.Lines' }]),
      ]),
      X('TaxTotal', [X('TaxAmount', [N('Numeric', '@.TaxAmount')])], [{ expr: 'model.InvoiceBase.TaxSummary' }]),
      X('Gross', [N('Numeric', '$Gross')]),
    ]),
  ], [{ prop: 'FileName', expr: 'CONCATENATE("INV_", model.InvoiceBase.InvoiceId)' }]),
  ds('$Gross', '', calc('model.InvoiceBase.InvoiceAmount * 1.21')));

const Seq = (name: string, children: El[], bindings: Array<{ prop?: string; expr: string }> = [], attrs: Record<string, string> = {}) =>
  el('ERTextFormatSequence', { Name: name, ...attrs }, children, bindings);

export const CSV_FORMAT_ID = '{C2000000-0000-4000-8000-000000000001}';
export const CSV_FORMAT_XML = formatXml('Invoice lines CSV', CSV_FORMAT_ID,
  el('ERTextFormatFileComponent', { Name: 'Lines', Encoding: 'UTF-8' }, [
    Seq('Header', [S('C1', 20, '"InvoiceId"'), S('C2', 20, '"ItemId"')], [], { Delimiter: ';', SpecialCharacters: 'CRLF' }),
    Seq('Line', [S('InvoiceId', 20, 'model.InvoiceBase.InvoiceId'), S('ItemId', 20, '@.ItemId')], [{ expr: 'model.InvoiceBase.Lines' }], { Delimiter: ';', SpecialCharacters: 'CRLF' }),
  ]));

/** Model, mapping, XML format, CSV format — in that order. */
export function invoiceWorkspace(): ERConfiguration[] {
  return [
    parseERConfiguration(MODEL_XML, 'model.xml'),
    parseERConfiguration(MAPPING_XML, 'mapping.xml'),
    parseERConfiguration(XML_FORMAT_XML, 'invoice-xml.xml'),
    parseERConfiguration(CSV_FORMAT_XML, 'invoice-csv.xml'),
  ];
}
