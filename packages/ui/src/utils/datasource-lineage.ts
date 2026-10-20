/**
 * Where a value comes from: tracing an ER expression through the datasources
 * of one definition (a model mapping definition or a format mapping) down to
 * the D365FO tables, fields, enums, classes and user parameters it reads.
 *
 * Every source carries a role. `value` sources produce the value itself
 * (`CustInvoiceTrans.ItemId` for `@.ItemId` inside the lines list); `context`
 * sources only pick the records (the `WHERE` condition, the list a field is
 * read from). Impact analysis wants both, a field specification leads with the
 * value sources.
 */
import type { ERDatasource, ERGroupByDatasource } from '@er-visualizer/core';
import { dsPathToExpression, quotePathSegment } from './ds-path';
import { extractReferences, LIST_FUNCTIONS, LIST_PRESERVING_FUNCTIONS, parseFunctionCall } from './er-references';

export type SourceKind = 'table' | 'field' | 'enum' | 'class' | 'parameter' | 'datasource' | 'importFormat';
export type SourceRole = 'value' | 'context' | 'condition';

export interface SourceRef {
  kind: SourceKind;
  /** Table, `Table.Field`, enum, class, `Class.member()`, parameter, or the datasource path. */
  name: string;
  role: SourceRole;
  /** ER datasource type, for `datasource` sources. */
  dsType?: string;
  /** Formula of a calculated field / filter. */
  formula?: string;
  /** Extended data type of a user parameter. */
  edt?: string;
  /** Configuration that declares the datasource the source was reached through. */
  configIndex: number;
  /** Mapping definition label, when the source sits in a model mapping. */
  definition?: string;
}

/** The list a `@` reference reads its record from, and where that list is resolved. */
export interface CurrentRecord {
  expression: string;
  scope: TraceScope;
}

export interface TraceScope {
  /** Root datasources of the definition. */
  pool: readonly ERDatasource[];
  configIndex: number;
  definition?: string;
  current?: CurrentRecord | null;
  /** Called for every data model path the expression reads (format scope). */
  onModelPath?: (segments: string[], role: SourceRole) => void;
}

const MAX_DEPTH = 12;
const ROLE_RANK: Record<SourceRole, number> = { value: 3, condition: 2, context: 1 };

const sourceKey = (ref: SourceRef) => `${ref.kind}|${ref.name.toLowerCase()}|${ref.configIndex}|${ref.definition ?? ''}`;

/** Mapping sources are merged into the lineage of every element that reads them; their keys are worked out once. */
const mergedKeys = new WeakMap<SourceRef, string>();

function mergedKey(ref: SourceRef): string {
  let key = mergedKeys.get(ref);
  if (key === undefined) {
    key = sourceKey(ref);
    mergedKeys.set(ref, key);
  }
  return key;
}

/** Collects sources once per kind + name; a stronger role replaces a weaker one. */
export class SourceCollector {
  private byKey = new Map<string, SourceRef>();

  add(ref: SourceRef, role: SourceRole = ref.role, key = sourceKey(ref)): void {
    const existing = this.byKey.get(key);
    if (!existing) { this.byKey.set(key, role === ref.role ? ref : { ...ref, role }); return; }
    if (ROLE_RANK[role] > ROLE_RANK[existing.role]) this.byKey.set(key, { ...existing, role });
  }

  addAll(refs: readonly SourceRef[], role?: SourceRole): void {
    for (const ref of refs) this.add(ref, role && ROLE_RANK[role] < ROLE_RANK[ref.role] ? role : ref.role, mergedKey(ref));
  }

  get sources(): SourceRef[] {
    return Array.from(this.byKey.values());
  }
}

// ─── Datasource pool lookups ───

interface PoolIndex {
  parent: Map<ERDatasource, ERDatasource | null>;
  roots: readonly ERDatasource[];
  /** Roots by bare name, in pool order. */
  rootsByName: Map<string, ERDatasource[]>;
  /** Every declared datasource by bare name, the shallowest first. */
  byName: Map<string, ERDatasource[]>;
}

const poolIndexCache = new WeakMap<readonly ERDatasource[], PoolIndex>();

function indexPool(pool: readonly ERDatasource[]): PoolIndex {
  const cached = poolIndexCache.get(pool);
  if (cached) return cached;
  const parent = new Map<ERDatasource, ERDatasource | null>();
  const visit = (ds: ERDatasource, up: ERDatasource | null) => {
    parent.set(ds, up);
    for (const child of ds.children ?? []) visit(child, ds);
  };
  for (const ds of pool) visit(ds, null);
  const add = (map: Map<string, ERDatasource[]>, ds: ERDatasource) => {
    const key = bare(ds.name);
    const list = map.get(key);
    if (list) list.push(ds); else map.set(key, [ds]);
  };
  const rootsByName = new Map<string, ERDatasource[]>();
  for (const ds of pool) add(rootsByName, ds);
  const byName = new Map<string, ERDatasource[]>();
  const queue = [...pool];
  for (let i = 0; i < queue.length; i++) {
    if (!queue[i].implicit) add(byName, queue[i]);
    queue.push(...(queue[i].children ?? []));
  }
  const index = { parent, roots: pool, rootsByName, byName };
  poolIndexCache.set(pool, index);
  return index;
}

const bare = (name: string) => name.trim().replace(/^[$#]/, '').toLowerCase();

function nameMatches(dsName: string, segment: string): boolean {
  if (dsName.toLowerCase() === segment.toLowerCase()) return true;
  return bare(dsName) === bare(segment) && (/^[$#]/.test(segment) || !/^[$#]/.test(dsName));
}

const childIndexCache = new WeakMap<ERDatasource, Map<string, ERDatasource[]>>();

/** Children by bare name, in declaration order — containers hold hundreds of them. */
function childIndex(ds: ERDatasource): Map<string, ERDatasource[]> {
  let index = childIndexCache.get(ds);
  if (!index) {
    index = new Map();
    for (const child of ds.children ?? []) {
      const key = bare(child.name);
      const list = index.get(key);
      if (list) list.push(child); else index.set(key, [child]);
    }
    childIndexCache.set(ds, index);
  }
  return index;
}

function findChild(ds: ERDatasource, segment: string): ERDatasource | undefined {
  const children = childIndex(ds).get(bare(segment)) ?? [];
  return children.find(c => c.name.toLowerCase() === segment.toLowerCase())
    ?? children.find(c => nameMatches(c.name, segment));
}

function findRoot(pool: readonly ERDatasource[], segment: string): ERDatasource | undefined {
  const { rootsByName, byName } = indexPool(pool);
  const roots = rootsByName.get(bare(segment)) ?? [];
  const direct = roots.find(ds => ds.name.toLowerCase() === segment.toLowerCase())
    ?? roots.find(ds => nameMatches(ds.name, segment));
  if (direct) return direct;
  // A name the definition only declares below a container is still reachable
  // by name in older exports; take the first real datasource of that name.
  return byName.get(bare(segment))?.find(ds => nameMatches(ds.name, segment));
}

/** Path of a datasource as the definition spells it, `Parent/$Child`. */
export function datasourcePath(ds: ERDatasource): string {
  return ds.parentPath ? `${ds.parentPath}/${ds.name}` : ds.name;
}

export interface WalkResult {
  ds: ERDatasource;
  /** Segments after the last real datasource: fields of its record. */
  trailing: string[];
}

/** Follow `segments` through the datasource tree as far as datasources go. */
export function walkDatasources(pool: readonly ERDatasource[], segments: readonly string[]): WalkResult | null {
  if (segments.length === 0) return null;
  const root = findRoot(pool, segments[0]);
  if (!root) return null;
  let current = root;
  let last = root;
  let consumed = 1;
  for (let i = 1; i < segments.length; i++) {
    const child = findChild(current, segments[i]);
    if (!child) break;
    current = child;
    if (!child.implicit) {
      last = child;
      consumed = i + 1;
    }
  }
  return { ds: last, trailing: segments.slice(consumed) };
}

/** The datasource a nested calculated field's `@` refers to. */
function currentForChild(ds: ERDatasource, scope: TraceScope): CurrentRecord | null {
  const { parent } = indexPool(scope.pool);
  let up = parent.get(ds) ?? null;
  while (up && up.implicit) up = parent.get(up) ?? null;
  if (!up) return scope.current ?? null;
  if (up.type === 'GroupBy' && up.groupByInfo?.listToGroup) {
    return { expression: dsPathToExpression(up.groupByInfo.listToGroup), scope };
  }
  return { expression: dsPathToExpression(datasourcePath(up)), scope };
}

// ─── Record origin ───

export type RecordOrigin =
  | { kind: 'table'; table: string; ds: ERDatasource }
  | { kind: 'datasource'; ds: ERDatasource; scope: TraceScope }
  | { kind: 'model'; segments: string[] };

/** Leading method calls a table datasource answers with one of its own records. */
const RECORD_METHODS = /^(find|findrecid|findbyrecid|exist)\(\)$/i;

/** Positions of the results an `IF` or `CASE` picks from (a `CASE`'s default included). */
function resultIndexes(call: { name: string; args: string[] }): number[] {
  switch (call.name) {
    case 'IF': return [1, 2];
    case 'CASE': return call.args.map((_, i) => i).filter(i => i > 0 && (i % 2 === 0 || i === call.args.length - 1));
    default: return [];
  }
}

/** Arguments whose records a call hands on: every list a `LISTJOIN` joins, the results of an `IF` / `CASE`. */
function recordArguments(call: { name: string; args: string[] }): string[] {
  if (call.name === 'LISTJOIN') return call.args;
  return resultIndexes(call).map(i => call.args[i]).filter(Boolean);
}

/**
 * The record a field read on `expr` comes from: `ORDERBY(WHERE(T, …), …)` reads
 * records of `T`, `'$Lines'` reads whatever its formula reads, `@` reads the
 * current list. `null` when it cannot be told.
 */
export function recordOrigin(expr: string, scope: TraceScope, depth = 0): RecordOrigin | null {
  if (depth > MAX_DEPTH) return null;
  const call = parseFunctionCall(expr);
  if (call) {
    if (LIST_PRESERVING_FUNCTIONS.has(call.name) && call.args[0]) return recordOrigin(call.args[0], scope, depth + 1);
    for (const arg of recordArguments(call)) {
      const origin = recordOrigin(arg, scope, depth + 1);
      if (origin) return origin;
    }
    return null;
  }
  const trimmed = expr.trim();
  const refs = extractReferences(trimmed);
  if (refs.length !== 1 || refs[0].start !== 0 || refs[0].end !== trimmed.length) return null;
  const ref = refs[0];
  if (ref.current) {
    if (!scope.current) return null;
    const origin = recordOrigin(scope.current.expression, scope.current.scope, depth + 1);
    const rest = ref.segments.slice(1);
    if (rest.length === 0 || !origin) return origin;
    if (origin.kind === 'model') return { kind: 'model', segments: [...origin.segments, ...rest] };
    return null;
  }
  const walked = walkDatasources(scope.pool, ref.segments);
  if (!walked) return null;
  const { ds, trailing } = walked;
  if (ds.type === 'DataModel') return { kind: 'model', segments: cutCalculated(trailing) };
  if (ds.tableInfo && trailing.every(segment => RECORD_METHODS.test(segment))) {
    return { kind: 'table', table: ds.tableInfo.tableName, ds };
  }
  if (trailing.length > 0) return null;
  const formula = ds.calculatedField?.expressionAsString;
  if (formula) {
    return recordOrigin(formula, { ...scope, current: currentForChild(ds, scope) }, depth + 1)
      ?? { kind: 'datasource', ds, scope };
  }
  return { kind: 'datasource', ds, scope };
}

/** Whether `expr` evaluates to a list of records. */
export function isListExpression(expr: string, scope: TraceScope, isModelList?: (segments: string[]) => boolean | undefined, depth = 0): boolean | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const call = parseFunctionCall(expr);
  if (call) return LIST_FUNCTIONS.has(call.name) ? true : (call.name === 'FIRSTORNULL' || call.name === 'FIRST' ? false : undefined);
  const trimmed = expr.trim();
  const refs = extractReferences(trimmed);
  if (refs.length !== 1 || refs[0].start !== 0 || refs[0].end !== trimmed.length) return undefined;
  const ref = refs[0];
  if (ref.current) {
    if (!scope.current) return undefined;
    const origin = recordOrigin(scope.current.expression, scope.current.scope);
    if (origin?.kind === 'model') return isModelList?.([...origin.segments, ...ref.segments.slice(1)]);
    return undefined;
  }
  const walked = walkDatasources(scope.pool, ref.segments);
  if (!walked) return undefined;
  const { ds, trailing } = walked;
  if (ds.type === 'DataModel') return isModelList?.(cutCalculated(trailing));
  if (trailing.length > 0) return undefined;
  if (ds.type === 'Table' || ds.type === 'GroupBy') return true;
  const formula = ds.calculatedField?.expressionAsString;
  if (formula) return isListExpression(formula, { ...scope, current: currentForChild(ds, scope) }, isModelList, depth + 1);
  return undefined;
}

/** Model path segments stop where a calculated field the format hangs under the model starts. */
function cutCalculated(segments: readonly string[]): string[] {
  const at = segments.findIndex(segment => /^[$#]/.test(segment) || segment.endsWith('()'));
  return at >= 0 ? segments.slice(0, at) : [...segments];
}

// ─── Tracing ───

interface TraceState {
  out: SourceCollector;
  depth: number;
  /** datasource + role pairs whose formula was already followed. */
  visited: Set<string>;
}

/** All sources `expr` reads, resolved in `scope`. */
export function traceExpression(expr: string, scope: TraceScope, role: SourceRole = 'value', out = new SourceCollector()): SourceCollector {
  traceInto(expr, scope, role, { out, depth: 0, visited: new Set() });
  return out;
}

function traceInto(expr: string, scope: TraceScope, role: SourceRole, state: TraceState): void {
  if (!expr || state.depth > MAX_DEPTH) return;
  const call = parseFunctionCall(expr);
  if (call && LIST_PRESERVING_FUNCTIONS.has(call.name)) {
    call.args.forEach((arg, i) => traceInto(arg, scope, i === 0 ? role : weaker(role, 'context'), state));
    return;
  }
  // The test of an IF / CASE only picks the result; when a result reads data
  // of its own, that data is the value.
  const results = call ? resultIndexes(call) : [];
  if (call && results.some(i => extractReferences(call.args[i] ?? '').length > 0)) {
    call.args.forEach((arg, i) => traceInto(arg, scope, results.includes(i) ? role : weaker(role, 'context'), state));
    return;
  }
  for (const ref of extractReferences(expr)) traceReference(ref.segments, ref.current, scope, role, state);
}

function weaker(a: SourceRole, b: SourceRole): SourceRole {
  return ROLE_RANK[a] <= ROLE_RANK[b] ? a : b;
}

function traceReference(segments: string[], current: boolean, scope: TraceScope, role: SourceRole, state: TraceState): void {
  if (current) {
    const record = scope.current;
    if (!record) return;
    const rest = segments.slice(1);
    // The list resolves where it was declared, but what it reads is reported
    // to the expression being traced; the list itself only provides the record.
    const recordScope = withSink(record.scope, scope);
    const key = `@|${record.expression}|${state.depth}`;
    if (!state.visited.has(key)) {
      state.visited.add(key);
      nested(state, () => traceInto(record.expression, recordScope, weaker(role, 'context'), state));
    }
    if (rest.length === 0) return;
    const origin = recordOrigin(record.expression, record.scope);
    if (!origin) return;
    if (origin.kind === 'model') {
      readModelField([...origin.segments, ...rest], recordScope, role, state);
      return;
    }
    if (origin.kind === 'table') {
      addField(origin.table, rest, recordScope, role, state);
      return;
    }
    const walked = walkFrom(origin.ds, rest);
    if (walked) nested(state, () => traceDatasource(walked.ds, walked.trailing, withSink(origin.scope, scope), role, state));
    return;
  }

  const walked = walkDatasources(scope.pool, segments);
  if (!walked) {
    if (segments[0]?.toLowerCase() === 'model') scope.onModelPath?.(cutCalculated(segments.slice(1)), role);
    return;
  }
  traceDatasource(walked.ds, walked.trailing, scope, role, state);
}

/**
 * A field read on a data model record. A calculated field the format hangs
 * under the model (`model/Lines/$Total`) is traced through its formula; a
 * field of the model itself is reported.
 */
function readModelField(segments: string[], scope: TraceScope, role: SourceRole, state: TraceState): void {
  const root = segments.some(segment => /^[$#]/.test(segment)) ? scope.pool.find(ds => ds.type === 'DataModel') : undefined;
  const walked = root ? walkFrom(root, segments) : null;
  if (walked && walked.ds !== root) {
    nested(state, () => traceDatasource(walked.ds, walked.trailing, scope, role, state));
    return;
  }
  scope.onModelPath?.(cutCalculated(segments), role);
}

/** `scope`, reporting the model paths it meets to `sink`'s callback. */
function withSink(scope: TraceScope, sink: TraceScope): TraceScope {
  return scope.onModelPath === sink.onModelPath ? scope : { ...scope, onModelPath: sink.onModelPath };
}

/** Walk `segments` below `ds` (a group-by's `aggregated.Amount`). */
function walkFrom(ds: ERDatasource, segments: readonly string[]): WalkResult | null {
  let current = ds;
  let last = ds;
  let consumed = 0;
  for (let i = 0; i < segments.length; i++) {
    const child = findChild(current, segments[i]);
    if (!child) break;
    current = child;
    if (!child.implicit) { last = child; consumed = i + 1; }
  }
  return { ds: last, trailing: segments.slice(consumed) };
}

function nested(state: TraceState, fn: () => void): void {
  state.depth++;
  try { fn(); } finally { state.depth--; }
}

function addField(table: string, trailing: readonly string[], scope: TraceScope, role: SourceRole, state: TraceState): void {
  const fieldPath = trailing.filter(segment => !RECORD_METHODS.test(segment));
  state.out.add({ kind: 'table', name: table, role, configIndex: scope.configIndex, definition: scope.definition });
  if (fieldPath.length > 0) {
    state.out.add({ kind: 'field', name: `${table}.${fieldPath.join('.')}`, role, configIndex: scope.configIndex, definition: scope.definition });
  }
}

function traceDatasource(ds: ERDatasource, trailing: string[], scope: TraceScope, role: SourceRole, state: TraceState): void {
  const base = { role, configIndex: scope.configIndex, definition: scope.definition };
  if (ds.type === 'DataModel') {
    scope.onModelPath?.(cutCalculated(trailing), role);
    return;
  }
  const formula = ds.calculatedField?.expressionAsString;
  state.out.add({ ...base, kind: 'datasource', name: datasourcePath(ds), dsType: ds.type, formula });

  if (ds.tableInfo) {
    addField(ds.tableInfo.tableName, trailing, scope, role, state);
    return;
  }
  if (ds.enumInfo) {
    state.out.add({ ...base, kind: 'enum', name: ds.enumInfo.enumName || ds.name });
    return;
  }
  if (ds.classInfo) {
    state.out.add({ ...base, kind: 'class', name: ds.classInfo.className });
    if (trailing.length > 0) state.out.add({ ...base, kind: 'field', name: `${ds.classInfo.className}.${trailing.join('.')}` });
    return;
  }
  if (ds.userParamInfo) {
    state.out.add({ ...base, kind: 'parameter', name: ds.name, edt: ds.userParamInfo.extendedDataTypeName });
    if (ds.userParamInfo.expressionAsString) nested(state, () => traceInto(ds.userParamInfo!.expressionAsString!, scope, role, state));
    return;
  }
  if (ds.importFormatInfo) {
    state.out.add({ ...base, kind: 'importFormat', name: ds.importFormatInfo.formatGuid });
    return;
  }

  const path = datasourcePath(ds).toLowerCase();
  const once = (key: string, fn: () => void) => {
    if (state.visited.has(key)) return;
    state.visited.add(key);
    nested(state, fn);
  };

  if (ds.joinInfo) {
    // A joined record reads its fields off the record of the list it names.
    const joined = ds.joinInfo.lists.find(list => trailing.length > 0 && bare(list.name) === bare(trailing[0]));
    for (const list of joined ? [joined] : ds.joinInfo.lists) {
      const expression = dsPathToExpression(joined ? [list.path, ...trailing.slice(1)].join('/') : list.path);
      once(`${path}|${role}|${expression.toLowerCase()}`, () => traceInto(expression, scope, role, state));
    }
    return;
  }

  const member = ds.groupByInfo ? groupMember(ds.groupByInfo, trailing) : null;
  if (member) {
    // `grouped.X` / `aggregated.Y` is read off the records being grouped;
    // the grouped list only provides them.
    const listRole = weaker(role, 'context');
    once(`${path}|${listRole}|group`, () => traceInto(dsPathToExpression(ds.groupByInfo!.listToGroup), scope, listRole, state));
    nested(state, () => traceInto(dsPathToExpression(member), scope, role, state));
    return;
  }

  const childScope: TraceScope = { ...scope, current: currentForChild(ds, scope) };
  // A field read on the record a formula yields: the formula only picks the
  // record, the field is read on the lists the record comes from.
  const reads = trailing.length > 0 && formula ? fieldReads(formula, trailing, childScope) : [];
  const formulaRole = reads.length > 0 ? weaker(role, 'context') : role;
  if (formula) once(`${path}|${formulaRole}`, () => traceInto(formula, childScope, formulaRole, state));
  if (ds.groupByInfo?.listToGroup) {
    once(`${path}|${formulaRole}|group`, () => traceInto(dsPathToExpression(ds.groupByInfo!.listToGroup), scope, formulaRole, state));
  }
  for (const read of reads) once(`${path}|${role}|${read.toLowerCase()}`, () => traceInto(read, childScope, role, state));
}

/**
 * `trailing` read on the record `expr` yields, as reads on the lists that
 * record comes from: `WHERE(T, …)` → `T.Field`, `LISTJOIN(A, B)` → `A.Field`
 * and `B.Field`. A list may declare the field itself (`$A/Values/$TaxBase`),
 * so the read goes to each list, not past it to the table or model below.
 */
function fieldReads(expr: string, trailing: readonly string[], scope: TraceScope, depth = 0): string[] {
  if (depth > MAX_DEPTH) return [];
  const call = parseFunctionCall(expr);
  if (call) {
    const lists = LIST_PRESERVING_FUNCTIONS.has(call.name) ? call.args.slice(0, 1) : recordArguments(call);
    return lists.flatMap(list => fieldReads(list, trailing, scope, depth + 1));
  }
  const trimmed = expr.trim();
  const refs = extractReferences(trimmed);
  if (refs.length !== 1 || refs[0].start !== 0 || refs[0].end !== trimmed.length) return [];
  const resolves = refs[0].current ? Boolean(scope.current) : walkDatasources(scope.pool, refs[0].segments) !== null || refs[0].segments[0]?.toLowerCase() === 'model';
  return resolves ? [`${trimmed}.${trailing.map(quotePathSegment).join('.')}`] : [];
}

const GROUP_SECTIONS: Record<string, 'groupedFields' | 'aggregations'> = {
  grouped: 'groupedFields', groupby: 'groupedFields', groupbyfields: 'groupedFields', groupedfields: 'groupedFields', groupfields: 'groupedFields',
  aggregated: 'aggregations', aggregation: 'aggregations', aggregations: 'aggregations',
};

/** Datasource path of the field a group-by's `grouped.X` / `aggregated.Y` reads, with what follows it. */
function groupMember(info: ERGroupByDatasource, trailing: readonly string[]): string | null {
  const section = trailing.length >= 2 ? GROUP_SECTIONS[bare(trailing[0])] : undefined;
  if (!section) return null;
  const member = info[section].find(entry => entry.path && bare(entry.name) === bare(trailing[1]));
  return member ? [member.path, ...trailing.slice(2)].join('/') : null;
}

/** Value sources first, then the most concrete kinds. */
export function sortSources(sources: readonly SourceRef[]): SourceRef[] {
  const kindRank: Record<SourceKind, number> = { field: 0, table: 1, enum: 2, class: 3, parameter: 4, importFormat: 5, datasource: 6 };
  return [...sources].sort((a, b) =>
    ROLE_RANK[b.role] - ROLE_RANK[a.role]
    || kindRank[a.kind] - kindRank[b.kind]
    || a.name.localeCompare(b.name));
}
