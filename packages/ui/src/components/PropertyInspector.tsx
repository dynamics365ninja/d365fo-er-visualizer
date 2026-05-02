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
      {node.type === 'mapping' && data && <MappingProps data={data} showTechnicalDetails={showTechnicalDetails} configIndex={configIndex} />}
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
    [t.propName, sol.name],
    [t.propDescription, sol.description ?? '–'],
    [t.propVersion, config.solutionVersion.publicVersionNumber],
    [t.propVendor, sol.vendor?.name ?? '–'],
  ];

  if (config.content?.kind === 'Format') {
    items.splice(3, 0, [t.propDirection, getFormatDirectionLabel(config.content.direction)]);
  }

  if (showTechnicalDetails) {
    items.splice(1, 0, ['GUID', sol.id, 'guid']);
    items.push(
      [t.propStatus, config.solutionVersion.versionStatus === 2 ? t.propCompleted : String(config.solutionVersion.versionStatus)],
      [t.propBase, sol.baseName ?? '–'],
      [t.propBaseGuid, sol.baseSolutionId ?? '–', 'guid'],
      [t.propKind, config.kind],
      [t.propLabel + 's', t.propLabelsCount(sol.labels?.length ?? 0)],
    );
  }

  return <PropGrid items={items} />;
}

function ContainerProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    [t.propName, data.name],
    [t.propLabel, <LabelValue labelRef={data.label} configIndex={configIndex} />],
    [t.propDescription, <LabelValue labelRef={data.description} configIndex={configIndex} />],
    [t.propFields, `${data.items?.length ?? 0}`],
  ];

  if (showTechnicalDetails) {
    items.unshift(['ID', data.id, 'guid']);
    items.splice(4, 0, [t.propIsRoot, data.isRoot ? t.propYes : t.propNo], [t.propIsEnum, data.isEnum ? t.propYes : t.propNo]);
  }

  return <PropGrid items={items} />;
}

function FieldProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    [t.propName, data.name],
    [t.propLabel, <LabelValue labelRef={data.label} configIndex={configIndex} />],
    [t.propDescription, <LabelValue labelRef={data.description} configIndex={configIndex} />],
  ];

  if (showTechnicalDetails) {
    items.splice(1, 0,
      [t.propType, fieldTypeNames[data.type] ?? `Unknown (${data.type})`],
      [t.propTypeDescriptor, data.typeDescriptor ?? '–'],
      [t.propHost, data.isTypeDescriptorHost ? t.propYes : t.propNo],
    );
  }

  return <PropGrid items={items} />;
}

function DatasourceProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    [t.propName, data.name],
    [t.propLabel, <LabelValue labelRef={data.label} configIndex={configIndex} />],
  ];

  if (showTechnicalDetails) {
    items.splice(1, 0, [t.propType, data.type], [t.propParentPath, data.parentPath ?? '–']);
  }

  if (data.tableInfo) {
    items.push(
      [t.propTable, data.tableInfo.tableName],
    );
    if (showTechnicalDetails) {
      items.push(
        [t.propCrossCompany, data.tableInfo.isCrossCompany ? t.propYes : t.propNo],
        [t.propSelectedFields, data.tableInfo.selectedFields?.join(', ') || '–'],
      );
    }
  }
  if (data.enumInfo) {
    items.push([t.propEnumName, data.enumInfo.enumName]);
    if (showTechnicalDetails) {
      items.push([t.propEnumType, getEnumTypeLabel(data.enumInfo)]);
    }
    if (showTechnicalDetails && data.enumInfo.sourceKind === 'DataModel') {
      items.push([t.propModelGuid, data.enumInfo.modelGuid ?? '–', 'guid']);
    }
  }
  if (showTechnicalDetails && data.importFormatInfo) {
    items.push([t.propImportFormatGuid, data.importFormatInfo.formatGuid || '–', 'guid']);
  }
  if (data.classInfo) {
    items.push([t.propClassName, data.classInfo.className]);
  }
  if (data.userParamInfo) {
    if (showTechnicalDetails) {
      items.push(
        [t.propEdt, data.userParamInfo.extendedDataTypeName ?? '–'],
        [t.propVisibilityExpr, data.userParamInfo.expressionAsString
          ? <ClickablePath expression={data.userParamInfo.expressionAsString} configIndex={configIndex} />
          : '–'],
      );
    }
  }
  if (data.calculatedField) {
    if (showTechnicalDetails) {
      items.push([t.expression, <ClickablePath expression={data.calculatedField.expressionAsString} configIndex={configIndex} />]);
    }
  }
  if (showTechnicalDetails && data.groupByInfo) {
    items.push([t.propListToGroup, data.groupByInfo.listToGroup || '–']);
  }

  return <PropGrid items={items} />;
}

function BindingProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    [t.propModelPath, <ClickablePath expression={data.path} configIndex={configIndex} mode="model-path" />],
    [t.expression, <ClickablePath expression={data.expressionAsString} configIndex={configIndex} mode="binding-expr" />],
  ];
  if (showTechnicalDetails) items.push([t.propSyntaxVersion, data.syntaxVersion ?? '–']);
  return <PropGrid items={items} />;
}

function ValidationProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  return (
    <div>
      <PropGrid items={[['Path', <ClickablePath expression={data.path} configIndex={configIndex} mode="model-path" />]]} />
      {data.conditions?.map((c: any, i: number) => (
        <div key={i} className="property-card">
          <div className="property-card-title">{t.propRule(i + 1)}</div>
          <PropGrid items={[
            ...(showTechnicalDetails ? [['GUID', c.id, 'guid'] as [string, React.ReactNode, string?]] : []),
            [t.propCondition, <ClickablePath expression={c.conditionExpressionAsString} configIndex={configIndex} />],
            [t.propMessage, <ClickablePath expression={c.messageExpressionAsString} configIndex={configIndex} />],
          ]} />
        </div>
      ))}
    </div>
  );
}

function FormatElementProps({ data, showTechnicalDetails }: { data: any; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    [t.propName, data.name],
    [t.propChildren, `${data.children?.length ?? 0}`],
  ];
  if (showTechnicalDetails) {
    items.unshift(['GUID', data.id, 'guid']);
    items.splice(2, 0, [t.propType, data.elementType]);
  }
  if (showTechnicalDetails && data.encoding) items.push([t.propEncoding, data.encoding]);
  if (showTechnicalDetails && data.maximalLength) items.push([t.propMaxLen, String(data.maximalLength)]);
  if (data.value) items.push([t.propValue, data.value]);
  if (data.transformation) items.push([t.propTransform, data.transformation, 'guid']);
  if (showTechnicalDetails && data.excludedFromDataSource) items.push([t.propExcluded, t.propYes]);

  return <PropGrid items={items} />;
}

function FormatBindingProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    [t.expression, <ClickablePath expression={data.expressionAsString} configIndex={configIndex} mode="binding-expr" />],
    [t.propProperty, data.propertyName ?? t.propValueDefault],
  ];
  if (showTechnicalDetails) {
    items.unshift([t.propComponentGuid, data.componentId, 'guid']);
    items.push([t.propSyntaxVersion, data.syntaxVersion ?? '–']);
  }
  return <PropGrid items={items} />;
}

function MappingProps({ data, showTechnicalDetails, configIndex }: { data: any; showTechnicalDetails: boolean; configIndex: number }) {
  const configurations = useAppStore(s => s.configurations);
  // Resolve the model's public version from loaded configurations.
  // `data.modelId` is the DataModel GUID; find a loaded DataModel config whose
  // ERDataModelVersion ID starts with that GUID.
  const modelPublicVersion = React.useMemo(() => {
    if (!data.modelId) return undefined;
    const needle = data.modelId.replace(/[{}]/g, '').toLowerCase();
    for (const cfg of configurations) {
      if (cfg.content.kind !== 'DataModel') continue;
      const dmId = (cfg.content as any).version?.id ?? '';
      if (dmId.replace(/[{}]/g, '').toLowerCase().startsWith(needle)) {
        return cfg.solutionVersion.publicVersionNumber || undefined;
      }
    }
    return undefined;
  }, [configurations, data.modelId]);

  // Resolve the mapping's own version number from the parent configuration.
  const mappingVersionNumber = React.useMemo(() => {
    const cfg = configurations[configIndex];
    if (!cfg) return undefined;
    if (cfg.content.kind === 'ModelMapping') {
      const ver = (cfg.content as any).version;
      return ver?.number != null ? String(ver.number) : undefined;
    }
    // Embedded mapping inside a Format — try to match by mapping id
    if (cfg.content.kind === 'Format') {
      const fc = cfg.content as any;
      for (const emv of fc.embeddedModelMappingVersions ?? []) {
        if (emv.mapping?.id === data.id || emv.mapping?.name === data.name) {
          return emv.number != null ? String(emv.number) : undefined;
        }
      }
    }
    return undefined;
  }, [configurations, configIndex, data.id, data.name]);

  // Extract the numeric revision from modelVersion ("{GUID},N" → "N")
  const modelVersionNumber = data.modelVersion
    ? data.modelVersion.replace(/^.*,/, '')
    : undefined;

  const displayModelVersion = modelPublicVersion ?? modelVersionNumber ?? '–';
  const displayMappingVersion = configurations[configIndex]?.solutionVersion?.publicVersionNumber
    || mappingVersionNumber
    || '–';

  const items: [string, React.ReactNode, string?][] = [
    [t.propName, data.name],
    [t.propMappingVersion, displayMappingVersion],
    [t.propModel, data.modelName ?? '–'],
    [t.propModelVersion, displayModelVersion],
    [t.propDatasources, `${data.datasources?.length ?? 0}`],
    [t.propBindings, `${data.bindings?.length ?? 0}`],
    [t.propValidations, `${data.validations?.length ?? 0}`],
  ];
  if (showTechnicalDetails) {
    items.unshift(['GUID', data.id, 'guid']);
    items.splice(5, 0, [t.propModelGuid, data.modelId ?? '–', 'guid'], [t.propModelVersionRaw, data.modelVersion ?? '–'], [t.propRootContainer, data.dataContainerDescriptor ?? '–']);
    if (mappingVersionNumber) {
      items.splice(3, 0, [t.propMappingRevision, mappingVersionNumber]);
    }
  }
  return <PropGrid items={items} />;
}

function EnumProps({ data, showTechnicalDetails }: { data: any; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    [t.propName, data.name],
    [t.propValues, `${data.values?.length ?? 0}`],
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
