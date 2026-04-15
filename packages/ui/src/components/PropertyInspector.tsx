import React from 'react';
import { useAppStore } from '../state/store';
import { ClickablePath } from './ClickablePath';
import type { ERFieldType } from '@er-visualizer/core';
import { getEnumTypeLabel } from '../utils/enum-display';
import { t } from '../i18n';

const fieldTypeNames: Record<number, string> = {
  1: 'Boolean', 3: 'Int64', 4: 'Integer', 5: 'Real',
  6: 'String', 7: 'Date', 9: 'Enum', 10: 'Container',
  11: 'RecordList', 13: 'Binary',
};

export function PropertyInspector() {
  const node = useAppStore(s => s.selectedNode);
  const registry = useAppStore(s => s.registry);
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
      <div className="property-type">
        {t.propType}: {node.type}
      </div>

      {node.type === 'file' && data && <FileProps data={data} />}
      {node.type === 'container' && data && <ContainerProps data={data} />}
      {node.type === 'field' && data && <FieldProps data={data} />}
      {node.type === 'datasource' && data && <DatasourceProps data={data} configIndex={configIndex} />}
      {node.type === 'binding' && data && <BindingProps data={data} configIndex={configIndex} />}
      {node.type === 'validation' && data && <ValidationProps data={data} configIndex={configIndex} />}
      {node.type === 'formatElement' && data && <FormatElementProps data={data} />}
      {node.type === 'formatBinding' && data && <FormatBindingProps data={data} configIndex={configIndex} />}
      {node.type === 'mapping' && data && <MappingProps data={data} />}
      {node.type === 'enum' && data && <EnumProps data={data} />}
      {node.type === 'transformation' && data && <TransformationProps data={data} configIndex={configIndex} />}

      {/* Cross-references for elements with GUIDs */}
      {data?.id && typeof data.id === 'string' && data.id.startsWith('{') && (
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

function FileProps({ data }: { data: any }) {
  const config = data;
  const sol = config.solutionVersion?.solution;
  if (!sol) return null;

  return (
    <PropGrid items={[
      ['Name', sol.name],
      ['GUID', sol.id, 'guid'],
      ['Description', sol.description ?? '–'],
      ['Version', config.solutionVersion.publicVersionNumber],
      ['Status', config.solutionVersion.versionStatus === 2 ? 'Completed' : String(config.solutionVersion.versionStatus)],
      ['Base', sol.baseName ?? '–'],
      ['Base GUID', sol.baseSolutionId ?? '–', 'guid'],
      ['Vendor', sol.vendor?.name ?? '–'],
      ['Kind', config.kind],
      ['Labels', `${sol.labels?.length ?? 0} entries`],
    ]} />
  );
}

function ContainerProps({ data }: { data: any }) {
  return (
    <PropGrid items={[
      ['ID', data.id, 'guid'],
      ['Name', data.name],
      ['Label', data.label ?? '–'],
      ['Description', data.description ?? '–'],
      ['Is Root', data.isRoot ? 'Yes' : 'No'],
      ['Is Enum', data.isEnum ? 'Yes' : 'No'],
      ['Fields', `${data.items?.length ?? 0}`],
    ]} />
  );
}

function FieldProps({ data }: { data: any }) {
  return (
    <PropGrid items={[
      ['Name', data.name],
      ['Type', fieldTypeNames[data.type] ?? `Unknown (${data.type})`],
      ['Type Descriptor', data.typeDescriptor ?? '–'],
      ['Host', data.isTypeDescriptorHost ? 'Yes' : 'No'],
      ['Label', data.label ?? '–'],
      ['Description', data.description ?? '–'],
    ]} />
  );
}

function DatasourceProps({ data, configIndex }: { data: any; configIndex: number }) {
  const items: [string, React.ReactNode, string?][] = [
    ['Name', data.name],
    ['Type', data.type],
    ['Parent Path', data.parentPath ?? '–'],
    ['Label', data.label ?? '–'],
  ];

  if (data.tableInfo) {
    items.push(
      ['Table', data.tableInfo.tableName],
      ['Cross-Company', data.tableInfo.isCrossCompany ? 'Yes' : 'No'],
      ['Selected Fields', data.tableInfo.selectedFields?.join(', ') || '–'],
    );
  }
  if (data.enumInfo) {
    items.push(
      ['Enum Name', data.enumInfo.enumName],
      ['Enum Type', getEnumTypeLabel(data.enumInfo)],
    );
    if (data.enumInfo.sourceKind === 'DataModel') {
      items.push(['Model GUID', data.enumInfo.modelGuid ?? '–', 'guid']);
    }
  }
  if (data.classInfo) {
    items.push(['Class Name', data.classInfo.className]);
  }
  if (data.userParamInfo) {
    items.push(
      ['EDT', data.userParamInfo.extendedDataTypeName ?? '–'],
      ['Visibility Expr', data.userParamInfo.expressionAsString
        ? <ClickablePath expression={data.userParamInfo.expressionAsString} configIndex={configIndex} />
        : '–'],
    );
  }
  if (data.calculatedField) {
    items.push(['Expression', <ClickablePath expression={data.calculatedField.expressionAsString} configIndex={configIndex} />]);
  }
  if (data.groupByInfo) {
    items.push(['List to Group', data.groupByInfo.listToGroup]);
  }

  return <PropGrid items={items} />;
}

function BindingProps({ data, configIndex }: { data: any; configIndex: number }) {
  return (
    <PropGrid items={[
      ['Model Path', <ClickablePath expression={data.path} configIndex={configIndex} mode="model-path" />],
      ['Expression', <ClickablePath expression={data.expressionAsString} configIndex={configIndex} mode="binding-expr" />],
      ['Syntax Version', data.syntaxVersion ?? '–'],
    ]} />
  );
}

function ValidationProps({ data, configIndex }: { data: any; configIndex: number }) {
  return (
    <div>
      <PropGrid items={[['Path', <ClickablePath expression={data.path} configIndex={configIndex} mode="model-path" />]]} />
      {data.conditions?.map((c: any, i: number) => (
        <div key={i} className="property-card">
          <div className="property-card-title">Rule {i + 1}</div>
          <PropGrid items={[
            ['GUID', c.id, 'guid'],
            ['Condition', <ClickablePath expression={c.conditionExpressionAsString} configIndex={configIndex} />],
            ['Message', <ClickablePath expression={c.messageExpressionAsString} configIndex={configIndex} />],
          ]} />
        </div>
      ))}
    </div>
  );
}

function FormatElementProps({ data }: { data: any }) {
  const items: [string, React.ReactNode, string?][] = [
    ['GUID', data.id, 'guid'],
    ['Name', data.name],
    ['Element Type', data.elementType],
  ];
  if (data.encoding) items.push(['Encoding', data.encoding]);
  if (data.maximalLength) items.push(['Max Length', String(data.maximalLength)]);
  if (data.value) items.push(['Value', data.value]);
  if (data.transformation) items.push(['Transformation', data.transformation, 'guid']);
  if (data.excludedFromDataSource) items.push(['Excluded from DS', 'Yes']);
  items.push(['Children', `${data.children?.length ?? 0}`]);

  return <PropGrid items={items} />;
}

function FormatBindingProps({ data, configIndex }: { data: any; configIndex: number }) {
  return (
    <PropGrid items={[
      ['Component GUID', data.componentId, 'guid'],
      ['Expression', <ClickablePath expression={data.expressionAsString} configIndex={configIndex} mode="binding-expr" />],
      ['Property', data.propertyName ?? 'Value (default)'],
      ['Syntax Version', data.syntaxVersion ?? '–'],
    ]} />
  );
}

function MappingProps({ data }: { data: any }) {
  return (
    <PropGrid items={[
      ['GUID', data.id, 'guid'],
      ['Name', data.name],
      ['Model', data.modelName ?? '–'],
      ['Model GUID', data.modelId ?? '–', 'guid'],
      ['Model Version', data.modelVersion ?? '–'],
      ['Root Container', data.dataContainerDescriptor ?? '–'],
      ['Datasources', `${data.datasources?.length ?? 0}`],
      ['Bindings', `${data.bindings?.length ?? 0}`],
      ['Validations', `${data.validations?.length ?? 0}`],
    ]} />
  );
}

function EnumProps({ data }: { data: any }) {
  return (
    <PropGrid items={[
      ['GUID', data.id, 'guid'],
      ['Name', data.name],
      ['Values', `${data.values?.length ?? 0}`],
    ]} />
  );
}

function TransformationProps({ data, configIndex }: { data: any; configIndex: number }) {
  return (
    <PropGrid items={[
      ['GUID', data.id, 'guid'],
      ['Name', data.name],
      ['Expression', <ClickablePath expression={data.expressionAsString} configIndex={configIndex} />],
    ]} />
  );
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
