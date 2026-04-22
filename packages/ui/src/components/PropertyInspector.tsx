import React from 'react';
import { useAppStore } from '../state/store';
import { ClickablePath } from './ClickablePath';
import { ERDirection, type ERFieldType } from '@er-visualizer/core';
import { getEnumTypeLabel } from '../utils/enum-display';
import { resolveLabel } from '../utils/label-resolver';
import { t } from '../i18n';

function getFormatDirectionLabel(direction: ERDirection | undefined): string {
  if (direction === ERDirection.Import) return t.formatDirectionImport;
  if (direction === ERDirection.Export) return t.formatDirectionExport;
  return t.formatDirectionUnknown;
}

function LabelValue({ labelRef, configIndex }: { labelRef: string | null | undefined; configIndex: number }) {
  const configurations = useAppStore(s => s.configurations);
  if (!labelRef) return <>–</>;

  const labels = configurations[configIndex]?.solutionVersion?.solution?.labels;
  const resolved = resolveLabel(labelRef, labels);
  if (!resolved) return <>–</>;

  const hasTranslations = Boolean(resolved.enUs || resolved.localized);

  return (
    <div className="label-value">
      <span className="label-value__id" title={resolved.raw}>{resolved.raw}</span>
      {hasTranslations && (
        <div className="label-value__translations">
          {resolved.enUs && (
            <div className="label-value__translation">
              <span className="label-value__lang">en-us</span>
              <span className="label-value__text">{resolved.enUs}</span>
            </div>
          )}
          {resolved.localized && (
            <div className="label-value__translation">
              <span className="label-value__lang">{resolved.localizedLang}</span>
              <span className="label-value__text">{resolved.localized}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const fieldTypeNames: Record<number, string> = {
  1: 'Boolean', 3: 'Int64', 4: 'Integer', 5: 'Real',
  6: 'String', 7: 'Date', 9: 'Enum', 10: 'Container',
  11: 'RecordList', 13: 'Binary',
};

export function PropertyInspector({ nodeOverride }: { nodeOverride?: any } = {}) {
  const selectedNode = useAppStore(s => s.selectedNode);
  const registry = useAppStore(s => s.registry);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const node = nodeOverride ?? selectedNode;
  const configIndex = node?.configIndex ?? 0;

  if (!node) {
    return (
      <div className="property-empty property-empty-card">
        <div className="property-empty-title">{t.noSelection}</div>
        <div>{t.selectElementHint}</div>
      </div>
    );
  }

  const data = node.data;

  return (
    <div className="property-inspector">
      <div className="property-title">
        {node.icon} {node.name}
      </div>
      {showTechnicalDetails && (
        <div className="property-type">
          {t.propType}: {node.type}
        </div>
      )}

      {node.type === 'file' && data && <FileProps data={data} showTechnicalDetails={showTechnicalDetails} />}
      {node.type === 'container' && data && <ContainerProps data={data} configIndex={configIndex} showTechnicalDetails={showTechnicalDetails} />}
      {node.type === 'field' && data && <FieldProps data={data} configIndex={configIndex} showTechnicalDetails={showTechnicalDetails} />}
      {node.type === 'datasource' && data && <DatasourceProps data={data} configIndex={configIndex} showTechnicalDetails={showTechnicalDetails} />}
      {node.type === 'binding' && data && <BindingProps data={data} configIndex={configIndex} showTechnicalDetails={showTechnicalDetails} />}
      {node.type === 'validation' && data && <ValidationProps data={data} configIndex={configIndex} showTechnicalDetails={showTechnicalDetails} />}
      {node.type === 'formatElement' && data && <FormatElementProps data={data} showTechnicalDetails={showTechnicalDetails} />}
      {node.type === 'formatBinding' && data && <FormatBindingProps data={data} configIndex={configIndex} showTechnicalDetails={showTechnicalDetails} />}
      {node.type === 'mapping' && data && <MappingProps data={data} showTechnicalDetails={showTechnicalDetails} />}
      {node.type === 'enum' && data && <EnumProps data={data} showTechnicalDetails={showTechnicalDetails} />}
      {node.type === 'transformation' && data && <TransformationProps data={data} configIndex={configIndex} showTechnicalDetails={showTechnicalDetails} />}

      {/* Cross-references for elements with GUIDs */}
      {showTechnicalDetails && data?.id && typeof data.id === 'string' && data.id.startsWith('{') && (
        <CrossRefsSection guid={data.id} registry={registry} />
      )}
    </div>
  );
}

function PropGrid({ items }: { items: [string, React.ReactNode, string?][] }) {
  return (
    <div className="prop-grid">
      {items.map(([label, value, className], i) => (
        <React.Fragment key={i}>
          <div className="prop-label">{label}</div>
          <div className={`prop-value ${className ?? ''}`}>{value}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

function FileProps({ data, showTechnicalDetails }: { data: any; showTechnicalDetails: boolean }) {
  const config = data;
  const sol = config.solutionVersion?.solution;
  if (!sol) return null;

  const items: [string, React.ReactNode, string?][] = [
    ['Name', sol.name],
    ['Description', sol.description ?? '–'],
    ['Version', config.solutionVersion.publicVersionNumber],
    ['Vendor', sol.vendor?.name ?? '–'],
  ];

  if (config.content?.kind === 'Format') {
    items.splice(3, 0, [t.propDirection, getFormatDirectionLabel(config.content.direction)]);
  }

  if (showTechnicalDetails) {
    items.splice(1, 0, ['GUID', sol.id, 'guid']);
    items.push(
      ['Status', config.solutionVersion.versionStatus === 2 ? 'Completed' : String(config.solutionVersion.versionStatus)],
      ['Base', sol.baseName ?? '–'],
      ['Base GUID', sol.baseSolutionId ?? '–', 'guid'],
      ['Kind', config.kind],
      ['Labels', `${sol.labels?.length ?? 0} entries`],
    );
  }

  return <PropGrid items={items} />;
}

function ContainerProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Name', data.name],
    ['Label', <LabelValue labelRef={data.label} configIndex={configIndex} />],
    ['Description', <LabelValue labelRef={data.description} configIndex={configIndex} />],
    ['Fields', `${data.items?.length ?? 0}`],
  ];

  if (showTechnicalDetails) {
    items.unshift(['ID', data.id, 'guid']);
    items.splice(4, 0, ['Is Root', data.isRoot ? 'Yes' : 'No'], ['Is Enum', data.isEnum ? 'Yes' : 'No']);
  }

  return <PropGrid items={items} />;
}

function FieldProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Name', data.name],
    ['Label', <LabelValue labelRef={data.label} configIndex={configIndex} />],
    ['Description', <LabelValue labelRef={data.description} configIndex={configIndex} />],
  ];

  if (showTechnicalDetails) {
    items.splice(1, 0,
      ['Type', fieldTypeNames[data.type] ?? `Unknown (${data.type})`],
      ['Type Descriptor', data.typeDescriptor ?? '–'],
      ['Host', data.isTypeDescriptorHost ? 'Yes' : 'No'],
    );
  }

  return <PropGrid items={items} />;
}

function DatasourceProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Name', data.name],
    ['Label', <LabelValue labelRef={data.label} configIndex={configIndex} />],
  ];

  if (showTechnicalDetails) {
    items.splice(1, 0, ['Type', data.type], ['Parent Path', data.parentPath ?? '–']);
  }

  if (data.tableInfo) {
    items.push(
      ['Table', data.tableInfo.tableName],
    );
    if (showTechnicalDetails) {
      items.push(
        ['Cross-Company', data.tableInfo.isCrossCompany ? 'Yes' : 'No'],
        ['Selected Fields', data.tableInfo.selectedFields?.join(', ') || '–'],
      );
    }
  }
  if (data.enumInfo) {
    items.push(['Enum Name', data.enumInfo.enumName]);
    if (showTechnicalDetails) {
      items.push(['Enum Type', getEnumTypeLabel(data.enumInfo)]);
    }
    if (showTechnicalDetails && data.enumInfo.sourceKind === 'DataModel') {
      items.push(['Model GUID', data.enumInfo.modelGuid ?? '–', 'guid']);
    }
  }
  if (showTechnicalDetails && data.importFormatInfo) {
    items.push(['Import Format GUID', data.importFormatInfo.formatGuid || '–', 'guid']);
  }
  if (data.classInfo) {
    items.push(['Class Name', data.classInfo.className]);
  }
  if (data.userParamInfo) {
    if (showTechnicalDetails) {
      items.push(
        ['EDT', data.userParamInfo.extendedDataTypeName ?? '–'],
        ['Visibility Expr', data.userParamInfo.expressionAsString
          ? <ClickablePath expression={data.userParamInfo.expressionAsString} configIndex={configIndex} />
          : '–'],
      );
    }
  }
  if (data.calculatedField) {
    if (showTechnicalDetails) {
      items.push(['Expression', <ClickablePath expression={data.calculatedField.expressionAsString} configIndex={configIndex} />]);
    }
  }
  if (showTechnicalDetails && data.groupByInfo) {
    items.push(['List to Group', data.groupByInfo.listToGroup || '–']);
  }

  return <PropGrid items={items} />;
}

function BindingProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Model Path', <ClickablePath expression={data.path} configIndex={configIndex} mode="model-path" />],
    ['Expression', <ClickablePath expression={data.expressionAsString} configIndex={configIndex} mode="binding-expr" />],
  ];
  if (showTechnicalDetails) items.push(['Syntax Version', data.syntaxVersion ?? '–']);
  return <PropGrid items={items} />;
}

function ValidationProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  return (
    <div>
      <PropGrid items={[['Path', <ClickablePath expression={data.path} configIndex={configIndex} mode="model-path" />]]} />
      {data.conditions?.map((c: any, i: number) => (
        <div key={i} className="property-card">
          <div className="property-card-title">Rule {i + 1}</div>
          <PropGrid items={[
            ...(showTechnicalDetails ? [['GUID', c.id, 'guid'] as [string, React.ReactNode, string?]] : []),
            ['Condition', <ClickablePath expression={c.conditionExpressionAsString} configIndex={configIndex} />],
            ['Message', <ClickablePath expression={c.messageExpressionAsString} configIndex={configIndex} />],
          ]} />
        </div>
      ))}
    </div>
  );
}

function FormatElementProps({ data, showTechnicalDetails }: { data: any; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Name', data.name],
    ['Children', `${data.children?.length ?? 0}`],
  ];
  if (showTechnicalDetails) {
    items.unshift(['GUID', data.id, 'guid']);
    items.splice(2, 0, ['Element Type', data.elementType]);
  }
  if (showTechnicalDetails && data.encoding) items.push(['Encoding', data.encoding]);
  if (showTechnicalDetails && data.maximalLength) items.push(['Max Length', String(data.maximalLength)]);
  if (data.value) items.push(['Value', data.value]);
  if (data.transformation) items.push(['Transformation', data.transformation, 'guid']);
  if (showTechnicalDetails && data.excludedFromDataSource) items.push(['Excluded from DS', 'Yes']);

  return <PropGrid items={items} />;
}

function FormatBindingProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Expression', <ClickablePath expression={data.expressionAsString} configIndex={configIndex} mode="binding-expr" />],
    ['Property', data.propertyName ?? 'Value (default)'],
  ];
  if (showTechnicalDetails) {
    items.unshift(['Component GUID', data.componentId, 'guid']);
    items.push(['Syntax Version', data.syntaxVersion ?? '–']);
  }
  return <PropGrid items={items} />;
}

function MappingProps({ data, showTechnicalDetails }: { data: any; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Name', data.name],
    ['Model', data.modelName ?? '–'],
    ['Datasources', `${data.datasources?.length ?? 0}`],
    ['Bindings', `${data.bindings?.length ?? 0}`],
    ['Validations', `${data.validations?.length ?? 0}`],
  ];
  if (showTechnicalDetails) {
    items.unshift(['GUID', data.id, 'guid']);
    items.splice(3, 0, ['Model GUID', data.modelId ?? '–', 'guid'], ['Model Version', data.modelVersion ?? '–'], ['Root Container', data.dataContainerDescriptor ?? '–']);
  }
  return <PropGrid items={items} />;
}

function EnumProps({ data, showTechnicalDetails }: { data: any; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Name', data.name],
    ['Values', `${data.values?.length ?? 0}`],
  ];
  if (showTechnicalDetails) items.unshift(['GUID', data.id, 'guid']);
  return <PropGrid items={items} />;
}

function TransformationProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Name', data.name],
  ];
  if (showTechnicalDetails) {
    items.push(['Expression', <ClickablePath expression={data.expressionAsString} configIndex={configIndex} />]);
  }
  if (showTechnicalDetails) items.unshift(['GUID', data.id, 'guid']);
  return <PropGrid items={items} />;
}

function CrossRefsSection({ guid, registry }: { guid: string; registry: any }) {
  const refs = registry.findRefsTo(guid);
  if (refs.length === 0) return null;

  return (
    <div className="property-section">
      <div className="property-section-title">
        CROSS-REFERENCES ({refs.length})
      </div>
      {refs.slice(0, 20).map((r: any, i: number) => (
        <div key={i} className="property-ref-item">
          <span className={`badge badge-${r.targetType.toLowerCase()} property-ref-badge`}>{r.targetType}</span>
          {r.sourceContext}
        </div>
      ))}
    </div>
  );
}
