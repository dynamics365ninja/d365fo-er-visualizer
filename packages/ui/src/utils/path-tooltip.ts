import { locale, t } from '../i18n';
import { formatEnumDisplayName } from './enum-display';

/**
 * What the hover card over an expression says. Each name in a reference gets
 * its own answer: in `'$SalesInvoiceTmp_First'.InvoiceId` the first name is a
 * data source and the second a field on it — the card used to describe the
 * data source for both, which is exactly what a user hovering the field did
 * not ask about.
 */

export type PathSegmentKind = 'identifier' | 'model-path' | 'operator' | 'literal' | 'separator';

export interface PathSegment {
  text: string;
  kind: PathSegmentKind;
  /** The names of the whole reference this segment belongs to, unquoted. */
  chain?: string[];
  /** Position of this segment's name in `chain`. */
  chainIndex?: number;
}

const TOKENS = /("[^"]*"|'[^']*'|[.(),]|\s+|[^."'(),\s]+)/g;
const IDENTIFIER_TOKEN = /^[@$#A-Za-z_][\w$#@]*$/;
/** A model path shown as a whole (`InvoiceBase/CompanyInfo/Name`) is one token. */
const MODEL_PATH_TOKEN = /^[@$#A-Za-z_][\w$#@/\\]*$/;
const NUMBER_TOKEN = /^\d+$/;

/**
 * Split an expression into coloured segments and group the names that form one
 * reference. A reference is broken by whitespace, operators, commas and
 * parentheses; `NAME(` on its own is a function call, not a reference.
 */
export function parseExpressionSegments(expr: string, mode: 'binding-expr' | 'model-path' | 'auto'): PathSegment[] {
  if (!expr) return [{ text: '', kind: 'literal' }];

  const segments: PathSegment[] = [];
  const nameKind: PathSegmentKind = mode === 'model-path' ? 'model-path' : 'identifier';
  const nameToken = mode === 'model-path' ? MODEL_PATH_TOKEN : IDENTIFIER_TOKEN;
  let chain: string[] | null = null;
  let afterDot = false;

  const close = () => {
    chain = null;
    afterDot = false;
  };
  const addName = (text: string, name: string) => {
    let current: string[];
    if (chain && afterDot) {
      current = chain;
    } else {
      current = [];
      chain = current;
    }
    current.push(name);
    segments.push({ text, kind: nameKind, chain: current, chainIndex: current.length - 1 });
    afterDot = false;
  };

  for (const token of expr.match(TOKENS) ?? [expr]) {
    if (token === '.') {
      segments.push({ text: token, kind: 'separator' });
      afterDot = chain !== null;
      continue;
    }
    if (token === '(') {
      const last = segments[segments.length - 1];
      if (last?.chain && last.chain.length === 1 && !afterDot) {
        segments[segments.length - 1] = { text: last.text, kind: 'operator' };
      }
      segments.push({ text: token, kind: 'operator' });
      close();
      continue;
    }
    if (token === ')' || token === ',') {
      segments.push({ text: token, kind: 'operator' });
      close();
      continue;
    }
    if (/^\s+$/.test(token)) {
      segments.push({ text: token, kind: 'literal' });
      close();
      continue;
    }
    if (token.startsWith("'")) {
      addName(token, token.slice(1, -1));
      continue;
    }
    if (token.startsWith('"')) {
      segments.push({ text: token, kind: 'literal' });
      close();
      continue;
    }
    if (nameToken.test(token)) {
      addName(token, token);
      continue;
    }
    segments.push({ text: token, kind: NUMBER_TOKEN.test(token) ? 'literal' : 'operator' });
    close();
  }

  return segments;
}

export type PathTooltipKind = 'datasource' | 'field' | 'model-field';
export type PathTooltipRowIcon = 'table' | 'class' | 'enum' | 'calc' | 'link' | 'branch';

export interface PathTooltipRow {
  icon?: PathTooltipRowIcon;
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}

export interface PathTooltipData {
  kind: PathTooltipKind;
  /** What the hovered name is — "Data source · Table". */
  eyebrow: string;
  title: string;
  /** The whole reference, for the breadcrumb. */
  path: string[];
  activeIndex: number;
  rows: PathTooltipRow[];
  /** Where a click on the segment goes, and how the card announces it. */
  navigation: { treeNodeId: string; hint: string } | null;
}

export interface DeepResolutionLike {
  rootDs: any | null;
  rootDsConfigIndex: number | null;
  nestedDs: any | null;
  fieldPath: string[];
  involvedDatasources: any[];
  calculatedFieldChain: unknown[];
}

export interface ModelPathResolutionLike {
  modelPath: string;
  binding: { expressionAsString?: string };
  bindingTreeNodeId: string | null;
  datasource: any | null;
  datasourceTreeNodeId: string | null;
}

export interface PathTooltipResolvers {
  deep: (path: string) => DeepResolutionLike | null;
  datasource: (name: string) => { datasource: any; configIndex: number } | null;
  modelPath: (dottedPath: string) => ModelPathResolutionLike | null;
  datasourceNode: (datasource: any, configIndex: number) => string | null;
  /** How many mapping bindings sit below a model path — a record's fields carry them, not the record. */
  bindingsBelow?: (dottedPath: string) => number;
}

const cs = () => locale === 'cs';
const SIMPLE_NAME = /^[A-Za-z_$#@][\w$#@]*$/;
const quote = (name: string) => (SIMPLE_NAME.test(name) ? name : `'${name}'`);

export function buildPathTooltip(segment: PathSegment, resolvers: PathTooltipResolvers): PathTooltipData | null {
  const { chain, chainIndex } = segment;
  if (!chain || chainIndex == null) return null;
  const path = [...chain];

  if (segment.kind === 'model-path') {
    const names = chain.slice(0, chainIndex + 1).flatMap(name => name.split(/[\\/]/)).filter(Boolean);
    return modelFieldTip(names, path, chainIndex, resolvers);
  }

  const deep = resolvers.deep(chain.slice(0, chainIndex + 1).map(quote).join('.'));
  const fallback = deep?.rootDs ? null : resolvers.datasource(chain[0]);
  const root = deep?.rootDs ?? fallback?.datasource ?? null;
  if (!root) return null;

  // The format's `model` data source: what matters below it is the model
  // field and the mapping binding that fills it, not "data model" again.
  if (root.type === 'DataModel' && chainIndex > 0) {
    return modelFieldTip(chain.slice(1, chainIndex + 1), path, chainIndex, resolvers);
  }

  if (!deep?.rootDs) {
    return chainIndex === 0 ? datasourceTip(root, fallback!.configIndex, null, path, chainIndex, resolvers) : null;
  }

  const leaf = deep.nestedDs ?? deep.rootDs;
  const configIndex = deep.rootDsConfigIndex ?? fallback?.configIndex ?? 0;
  return deep.fieldPath.length === 0
    ? datasourceTip(leaf, configIndex, deep, path, chainIndex, resolvers)
    : fieldTip(leaf, configIndex, deep.fieldPath, path, chainIndex, resolvers);
}

function datasourceTip(
  ds: any,
  configIndex: number,
  deep: DeepResolutionLike | null,
  path: string[],
  activeIndex: number,
  resolvers: PathTooltipResolvers,
): PathTooltipData {
  const rows = describeDatasource(ds);

  if (deep?.nestedDs && deep.rootDs && deep.nestedDs !== deep.rootDs) {
    rows.push({ icon: 'branch', label: cs() ? 'Uvnitř' : 'Inside', value: deep.rootDs.name, mono: true });
  }
  if (deep) {
    const ownTable = ds.tableInfo?.tableName;
    const tables = unique(deep.involvedDatasources.map(d => d?.tableName)).filter(name => name !== ownTable);
    const classes = unique(deep.involvedDatasources.map(d => d?.className)).filter(name => name !== ds.classInfo?.className);
    if (tables.length > 0) rows.push({ icon: 'table', label: cs() ? 'Čte tabulky' : 'Reads tables', value: tables.join(', '), mono: true, muted: true });
    if (classes.length > 0) rows.push({ icon: 'class', label: cs() ? 'Volá třídy' : 'Calls classes', value: classes.join(', '), mono: true, muted: true });
    if (deep.calculatedFieldChain.length > 0) {
      rows.push({ icon: 'calc', label: cs() ? 'Přes vypočtená pole' : 'Via calculated fields', value: String(deep.calculatedFieldChain.length), muted: true });
    }
  }

  const treeNodeId = resolvers.datasourceNode(ds, configIndex);
  return {
    kind: 'datasource',
    eyebrow: [t.pathDatasource, datasourceTypeLabel(ds)].filter(Boolean).join(' · '),
    title: ds.name,
    path,
    activeIndex,
    rows,
    navigation: treeNodeId ? { treeNodeId, hint: cs() ? 'Kliknutím přejít na zdroj' : 'Click to open the data source' } : null,
  };
}

function fieldTip(
  ds: any,
  configIndex: number,
  fieldPath: string[],
  path: string[],
  activeIndex: number,
  resolvers: PathTooltipResolvers,
): PathTooltipData {
  const member = fieldPath.join('.');
  const rows: PathTooltipRow[] = [{ icon: rowIconFor(ds), label: cs() ? 'Zdroj' : 'Source', value: ds.name, mono: true }];
  if (ds.tableInfo) {
    rows.push({ icon: 'table', label: cs() ? 'Pole tabulky' : 'Table field', value: `${ds.tableInfo.tableName}.${member}`, mono: true });
  } else if (ds.classInfo) {
    rows.push({ icon: 'class', label: cs() ? 'Člen třídy' : 'Class member', value: `${ds.classInfo.className}.${member}`, mono: true });
  } else if (ds.enumInfo) {
    rows.push({ icon: 'enum', label: cs() ? 'Hodnota výčtu' : 'Enum value', value: `${formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo)}.${member}`, mono: true });
  } else if (ds.calculatedField) {
    rows.push({ icon: 'calc', label: t.expression, value: ds.calculatedField.expressionAsString ?? '', mono: true });
  } else if (datasourceTypeLabel(ds)) {
    rows.push({ label: t.propType, value: datasourceTypeLabel(ds), muted: true });
  }

  const treeNodeId = resolvers.datasourceNode(ds, configIndex);
  return {
    kind: 'field',
    eyebrow: cs() ? 'Pole datového zdroje' : 'Data source field',
    title: path[activeIndex],
    path,
    activeIndex,
    rows,
    navigation: treeNodeId ? { treeNodeId, hint: cs() ? 'Kliknutím přejít na zdroj' : 'Click to open the data source' } : null,
  };
}

/**
 * A data model field. Model mapping lookups fall back to shorter paths, so a
 * binding is only claimed for the field when its path ends in the field's own
 * name; a binding further up the tree is shown as the nearest one instead.
 */
function modelFieldTip(names: string[], path: string[], activeIndex: number, resolvers: PathTooltipResolvers): PathTooltipData {
  const dotted = ['model', ...names.map(quote)].join('.');
  const result = names.length > 0 ? resolvers.modelPath(dotted) : null;
  const bindingNames = result ? result.modelPath.split(/[\\/.]/).filter(Boolean) : [];
  const exact = result !== null
    && bindingNames.length > 0
    && bindingNames.length <= names.length
    && names.slice(-bindingNames.length).join('/').toLowerCase() === bindingNames.join('/').toLowerCase();

  const rows: PathTooltipRow[] = [];
  const bindingsBelow = exact ? 0 : (resolvers.bindingsBelow?.(dotted) ?? 0);
  if (result && exact) {
    rows.push({ icon: 'link', label: cs() ? 'Vazba v mapování' : 'Mapping binding', value: result.binding.expressionAsString ?? '', mono: true });
    if (result.datasource) {
      rows.push(...describeDatasource(result.datasource).map(row => (row.label === t.expression ? { ...row, label: t.pathCalcField } : row)));
    }
  } else if (bindingsBelow > 0) {
    // A record: nothing binds it as a whole, its fields are bound one by one.
    rows.push({
      icon: 'branch',
      label: cs() ? 'Záznam' : 'Record',
      value: cs() ? `Vazby mají jeho pole (${bindingsBelow})` : `Its fields carry the bindings (${bindingsBelow})`,
      muted: true,
    });
  } else if (result) {
    rows.push({
      icon: 'link',
      label: cs() ? 'Nejbližší vazba' : 'Nearest binding',
      value: `${bindingNames.join('.')} ← ${result.binding.expressionAsString ?? ''}`,
      mono: true,
      muted: true,
    });
  } else {
    rows.push({
      label: cs() ? 'Mapování' : 'Mapping',
      value: cs() ? 'Žádná vazba v načtených mapováních' : 'No binding in the loaded mappings',
      muted: true,
    });
  }

  const treeNodeId = exact ? (result!.bindingTreeNodeId ?? result!.datasourceTreeNodeId) : null;
  return {
    kind: 'model-field',
    eyebrow: cs() ? 'Pole datového modelu' : 'Data model field',
    title: names[names.length - 1] ?? path[activeIndex],
    path,
    activeIndex,
    rows,
    navigation: treeNodeId ? { treeNodeId, hint: cs() ? 'Kliknutím přejít na vazbu' : 'Click to open the binding' } : null,
  };
}

function describeDatasource(ds: any): PathTooltipRow[] {
  if (ds.tableInfo) return [{ icon: 'table', label: t.pathTable, value: ds.tableInfo.tableName, mono: true }];
  if (ds.enumInfo) return [{ icon: 'enum', label: t.pathEnum, value: formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo), mono: true }];
  if (ds.classInfo) return [{ icon: 'class', label: t.pathClass, value: ds.classInfo.className, mono: true }];
  if (ds.calculatedField) return [{ icon: 'calc', label: t.expression, value: ds.calculatedField.expressionAsString ?? '', mono: true }];
  if (ds.userParamInfo) return [{ label: t.propEdt, value: ds.userParamInfo.extendedDataTypeName ?? ds.name }];
  if (ds.modelInfo?.dataContainerDescriptorName) {
    return [{ label: cs() ? 'Kořen modelu' : 'Model root', value: ds.modelInfo.dataContainerDescriptorName, mono: true }];
  }
  return [];
}

function datasourceTypeLabel(ds: any): string {
  if (ds.tableInfo) return t.pathTable;
  if (ds.enumInfo) return t.pathEnum;
  if (ds.classInfo) return t.pathClass;
  if (ds.calculatedField) return t.pathCalcField;
  if (ds.type === 'DataModel') return cs() ? 'Datový model' : 'Data model';
  if (ds.type === 'UserParameter') return cs() ? 'Uživatelský parametr' : 'User parameter';
  return ds.type && ds.type !== 'Unknown' ? String(ds.type) : '';
}

function rowIconFor(ds: any): PathTooltipRowIcon | undefined {
  if (ds.tableInfo) return 'table';
  if (ds.classInfo) return 'class';
  if (ds.enumInfo) return 'enum';
  if (ds.calculatedField) return 'calc';
  return undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
