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
import type { ERDatasource } from '@er-visualizer/core';
import { dsPathToExpression } from './ds-path';
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

/** Collects sources once per kind + name; a stronger role replaces a weaker one. */
export class SourceCollector {
  private byKey = new Map<string, SourceRef>();

  add(ref: SourceRef): void {
    const key = `${ref.kind}|${ref.name.toLowerCase()}|${ref.configIndex}|${ref.definition ?? ''}`;
    const existing = this.byKey.get(key);
    if (!existing) { this.byKey.set(key, ref); return; }
    if (ROLE_RANK[ref.role] > ROLE_RANK[existing.role]) this.byKey.set(key, { ...existing, role: ref.role });
  }

  addAll(refs: readonly SourceRef[], role?: SourceRole): void {
    for (const ref of refs) this.add(role && ROLE_RANK[role] < ROLE_RANK[ref.role] ? { ...ref, role } : ref);
  }

  get sources(): SourceRef[] {
    return Array.from(this.byKey.values());
  }
}

// ─── Datasource pool lookups ───

interface PoolIndex {
  parent: Map<ERDatasource, ERDatasource | null>;
  roots: readonly ERDatasource[];
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
  const index = { parent, roots: pool };
  poolIndexCache.set(pool, index);
  return index;
}

const bare = (name: string) => name.trim().replace(/^[$#]/, '').toLowerCase();

function nameMatches(dsName: string, segment: string): boolean {
  if (dsName.toLowerCase() === segment.toLowerCase()) return true;
  return bare(dsName) === bare(segment) && (/^[$#]/.test(segment) || !/^[$#]/.test(dsName));
}

function findChild(ds: ERDatasource, segment: string): ERDatasource | undefined {
  const children = ds.children ?? [];
  return children.find(c => c.name.toLowerCase() === segment.toLowerCase())
    ?? children.find(c => nameMatches(c.name, segment));
}

function findRoot(pool: readonly ERDatasource[], segment: string): ERDatasource | undefined {
  const direct = pool.find(ds => ds.name.toLowerCase() === segment.toLowerCase())
    ?? pool.find(ds => nameMatches(ds.name, segment));
  if (direct) return direct;
  // A name the definition only declares below a container is still reachable
  // by name in older exports; take the first real datasource of that name.
  const stack = [...pool];
  while (stack.length) {
    const ds = stack.shift()!;
    if (!ds.implicit && nameMatches(ds.name, segment)) return ds;
    stack.push(...(ds.children ?? []));
  }
  return undefined;
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

/**
 * The record a field read on `expr` comes from: `ORDERBY(WHERE(T, …), …)` reads
 * records of `T`, `'$Lines'` reads whatever its formula reads, `@` reads the
 * current list. `null` when it cannot be told.
 */
export function recordOrigin(expr: string, scope: TraceScope, depth = 0): RecordOrigin | null {
  if (depth > MAX_DEPTH) return null;
  const call = parseFunctionCall(expr);
  if (call) {
    return LIST_PRESERVING_FUNCTIONS.has(call.name) && call.args[0]
      ? recordOrigin(call.args[0], scope, depth + 1)
      : null;
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
      scope.onModelPath?.(cutCalculated([...origin.segments, ...rest]), role);
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

  const childScope: TraceScope = { ...scope, current: currentForChild(ds, scope) };
  const visitKey = `${datasourcePath(ds).toLowerCase()}|${role}`;
  if (formula && !state.visited.has(visitKey)) {
    state.visited.add(visitKey);
    nested(state, () => traceInto(formula, childScope, role, state));
  }
  if (ds.groupByInfo?.listToGroup && !state.visited.has(visitKey + '|group')) {
    state.visited.add(visitKey + '|group');
    nested(state, () => traceInto(dsPathToExpression(ds.groupByInfo!.listToGroup), scope, role, state));
  }

  if (trailing.length > 0 && formula) {
    const origin = recordOrigin(formula, childScope);
    if (origin?.kind === 'table') addField(origin.table, trailing, scope, role, state);
    else if (origin?.kind === 'model') scope.onModelPath?.(cutCalculated([...origin.segments, ...trailing]), role);
    else if (origin?.kind === 'datasource' && origin.ds !== ds) {
      const walked = walkFrom(origin.ds, trailing);
      if (walked && walked.ds !== origin.ds) nested(state, () => traceDatasource(walked.ds, walked.trailing, withSink(origin.scope, scope), role, state));
    }
  }
}

/** Value sources first, then the most concrete kinds. */
export function sortSources(sources: readonly SourceRef[]): SourceRef[] {
  const kindRank: Record<SourceKind, number> = { field: 0, table: 1, enum: 2, class: 3, parameter: 4, importFormat: 5, datasource: 6 };
  return [...sources].sort((a, b) =>
    ROLE_RANK[b.role] - ROLE_RANK[a.role]
    || kindRank[a.kind] - kindRank[b.kind]
    || a.name.localeCompare(b.name));
}
