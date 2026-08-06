import React from 'react';
import { useAppStore } from '../state/store';
import { ClickablePath } from './ClickablePath';
import { ERDirection } from '@er-visualizer/core';
import { getEnumTypeLabel } from '../utils/enum-display';
import { resolveLabel } from '../utils/label-resolver';
import { t, locale } from '../i18n';
import {
  AppsListDetailRegular,
  CursorHoverRegular,
  DataBarVerticalFilled,
  LinkFilled,
  DocumentFilled,
  CheckmarkCircleRegular,
  ArrowSyncRegular,
} from '@fluentui/react-icons';

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

function getNodeHeaderIcon(node: any): React.ReactNode {
  const kind = node?.data?.kind ?? node?.data?.content?.kind;
  const nodeType = node?.type;

  if (kind === 'DataModel') return <DataBarVerticalFilled fontSize={14} />;
  if (kind === 'ModelMapping') return <LinkFilled fontSize={14} />;
  if (kind === 'Format') return <DocumentFilled fontSize={14} />;

  if (nodeType === 'mapping' || nodeType === 'binding' || nodeType === 'formatBinding') {
    return <LinkFilled fontSize={14} />;
  }

  if (nodeType === 'validation') {
    return <CheckmarkCircleRegular fontSize={14} />;
  }

  if (nodeType === 'transformation') {
    return <ArrowSyncRegular fontSize={14} />;
  }

  if (
    nodeType === 'datasource'
    || nodeType === 'field'
    || nodeType === 'container'
    || nodeType === 'enum'
    || nodeType === 'enumValue'
    || nodeType === 'model'
  ) {
    return <DataBarVerticalFilled fontSize={14} />;
  }

  return <DocumentFilled fontSize={14} />;
}

/** Node kind rendered as a coloured pill — the same three hues as everywhere else. */
function getNodeKindBadge(node: any): { label: string; tone: 'model' | 'mapping' | 'format' | 'neutral' } {
  const kind = node?.data?.kind ?? node?.data?.content?.kind;
  if (kind === 'DataModel') return { label: locale === 'cs' ? 'Datový model' : 'Data model', tone: 'model' };
  if (kind === 'ModelMapping') return { label: locale === 'cs' ? 'Mapování modelu' : 'Model mapping', tone: 'mapping' };
  if (kind === 'Format') return { label: locale === 'cs' ? 'Formát' : 'Format', tone: 'format' };

  const byType: Record<string, { label: string; tone: 'model' | 'mapping' | 'format' | 'neutral' }> = {
    container: { label: locale === 'cs' ? 'Kontejner' : 'Container', tone: 'model' },
    field: { label: locale === 'cs' ? 'Pole' : 'Field', tone: 'model' },
    enum: { label: locale === 'cs' ? 'Výčet' : 'Enumeration', tone: 'model' },
    enumValue: { label: locale === 'cs' ? 'Hodnota výčtu' : 'Enum value', tone: 'model' },
    datasource: { label: locale === 'cs' ? 'Datový zdroj' : 'Data source', tone: 'mapping' },
    binding: { label: locale === 'cs' ? 'Vazba' : 'Binding', tone: 'mapping' },
    mapping: { label: locale === 'cs' ? 'Mapování' : 'Mapping', tone: 'mapping' },
    validation: { label: locale === 'cs' ? 'Validace' : 'Validation', tone: 'mapping' },
    formatElement: { label: locale === 'cs' ? 'Prvek formátu' : 'Format element', tone: 'format' },
    formatBinding: { label: locale === 'cs' ? 'Vazba formátu' : 'Format binding', tone: 'format' },
    transformation: { label: locale === 'cs' ? 'Transformace' : 'Transformation', tone: 'format' },
  };
  return byType[node?.type] ?? { label: node?.type ?? '', tone: 'neutral' };
}

/**
 * The name to trace with "where used". For a table datasource the interesting
 * entity is the table itself, not the alias the mapping gave it.
 */
function whereUsedQueryFor(node: any): string | null {
  const data = node?.data;
  const candidate =
    data?.tableInfo?.tableName ??
    data?.enumInfo?.enumName ??
    data?.classInfo?.className ??
    node?.name;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

export function PropertyInspector({ nodeOverride }: { nodeOverride?: any } = {}) {
  const selectedNode = useAppStore(s => s.selectedNode);
  const registry = useAppStore(s => s.registry);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const configurations = useAppStore(s => s.configurations);
  const triggerWhereUsed = useAppStore(s => s.triggerWhereUsed);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const node = nodeOverride ?? selectedNode;
  const configIndex = node?.configIndex ?? 0;

  if (!node) {
    return (
      <div className="property-empty property-empty-card">
        <div className="property-empty-icon-stack" aria-hidden>
          <AppsListDetailRegular fontSize={26} />
          <CursorHoverRegular fontSize={13} style={{ position: 'absolute', right: 4, bottom: 0 }} />
        </div>
        <div className="property-empty-title">{t.noSelection}</div>
        <div className="property-empty-hint">{t.selectElementHint}</div>
        <div className="property-empty-tips">
          <div className="property-empty-tip">
            <span className="property-empty-tip-key">Ctrl+F</span>
            <span className="property-empty-tip-label">{t.search}</span>
          </div>
          <div className="property-empty-tip">
            <span className="property-empty-tip-key">Ctrl+B</span>
            <span className="property-empty-tip-label">{t.explorer}</span>
          </div>
          <div className="property-empty-tip">
            <span className="property-empty-tip-key">Ctrl+K</span>
            <span className="property-empty-tip-label">{t.commandPalette}</span>
          </div>
        </div>
      </div>
    );
  }

  const data = node.data;
  const badge = getNodeKindBadge(node);
  const ownerConfig = configurations[configIndex];
  const ownerName = ownerConfig?.solutionVersion?.solution?.name;
  const whereUsedQuery = whereUsedQueryFor(node);

  return (
    <div className="property-inspector">
      <header className="prop-head">
        <div className="prop-head__meta">
          <span className={`prop-head__kind prop-head__kind--${badge.tone}`}>
            {getNodeHeaderIcon(node)}
            {badge.label}
          </span>
          {showTechnicalDetails && <span className="prop-head__type">{node.type}</span>}
        </div>
        <h2 className="prop-head__name" title={node.name}>{node.name}</h2>
        {ownerName && node.type !== 'file' && (
          <p className="prop-head__owner" title={ownerName}>{ownerName}</p>
        )}
        <div className="prop-head__actions">
          {whereUsedQuery && (
            <button
              type="button"
              className="prop-head__action"
              onClick={() => triggerWhereUsed(whereUsedQuery)}
              title={`${t.whereUsed}: ${whereUsedQuery}`}
            >
              <LinkFilled fontSize={13} />
              {t.whereUsed}
            </button>
          )}
          <button
            type="button"
            className="prop-head__action"
            onClick={() => navigateToTreeNode(node.id)}
            title={t.propRevealInExplorer}
          >
            <AppsListDetailRegular fontSize={13} />
            {t.propRevealInExplorer}
          </button>
        </div>
      </header>

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
    [t.propDescription, sol.description ?? '–'],
    [t.propVersion, config.solutionVersion.publicVersionNumber],
    [t.propVendor, sol.vendor?.name || '–'],
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
    [t.propLabel, <LabelValue labelRef={data.label} configIndex={configIndex} />],
    [t.propDescription, <LabelValue labelRef={data.description} configIndex={configIndex} />],
    [t.propFields, `${data.items?.length ?? 0}`],
  ];

  if (showTechnicalDetails) {
    items.unshift(['ID', data.id, 'guid']);
    items.splice(3, 0, [t.propIsRoot, data.isRoot ? t.propYes : t.propNo], [t.propIsEnum, data.isEnum ? t.propYes : t.propNo]);
  }

  return <PropGrid items={items} />;
}

function FieldProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    [t.propLabel, <LabelValue labelRef={data.label} configIndex={configIndex} />],
    [t.propDescription, <LabelValue labelRef={data.description} configIndex={configIndex} />],
  ];

  if (showTechnicalDetails) {
    items.splice(0, 0,
      [t.propType, fieldTypeNames[data.type] ?? `Unknown (${data.type})`],
      [t.propTypeDescriptor, data.typeDescriptor ?? '–'],
      [t.propHost, data.isTypeDescriptorHost ? t.propYes : t.propNo],
    );
  }

  return <PropGrid items={items} />;
}

function DatasourceProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [
    [t.propLabel, <LabelValue labelRef={data.label} configIndex={configIndex} />],
  ];

  if (showTechnicalDetails) {
    items.splice(0, 0, [t.propType, data.type], [t.propParentPath, data.parentPath ?? '–']);
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
    [t.propChildren, `${data.children?.length ?? 0}`],
  ];
  if (showTechnicalDetails) {
    items.unshift(['GUID', data.id, 'guid']);
    items.splice(1, 0, [t.propType, data.elementType]);
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
    [t.propValues, `${data.values?.length ?? 0}`],
  ];
  if (showTechnicalDetails) items.unshift(['GUID', data.id, 'guid']);
  return <PropGrid items={items} />;
}

function TransformationProps({ data, configIndex, showTechnicalDetails }: { data: any; configIndex: number; showTechnicalDetails: boolean }) {
  const items: [string, React.ReactNode, string?][] = [];
  if (showTechnicalDetails) {
    items.push(['Expression', <ClickablePath expression={data.expressionAsString} configIndex={configIndex} />]);
  }
  if (showTechnicalDetails) items.unshift(['GUID', data.id, 'guid']);
  return <PropGrid items={items} />;
}

