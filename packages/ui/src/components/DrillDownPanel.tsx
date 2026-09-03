/**
 * DrillDownPanel — interactive drill-down from a format binding expression
 * all the way to the concrete data source (table / enum / class).
 *
 * Usage:
 *   <DrillDownPanel expression="model.Invoice.Lines.Amount" configIndex={0} />
 *
 * The panel maintains a "stack" of frames. Each frame shows one expression
 * resolved to its datasource. Clicking a formula or child datasource name
 * pushes a new frame. A breadcrumb bar lets you jump back to any prior frame.
 */
import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  Button,
} from '@fluentui/react-components';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CompassNorthwestRegular,
  TableRegular,
  TextCaseTitleRegular,
  SettingsRegular,
  CalculatorRegular,
  TextQuoteRegular,
  ArrowShuffleRegular,
  PinRegular,
  BranchForkRegular,
  ArrowExpandRegular,
  DismissRegular,
  CircleRegular,
  FlowRegular,
  AppsListDetailRegular,
  TagRegular,
  CodeRegular,
  PersonRegular,
  FolderRegular,
  ChevronRightRegular,
} from '@fluentui/react-icons';
import { useAppStore, resolveDeepExpression, selectMappingDefinition } from '../state/store';
import { locale, t } from '../i18n';
import { formatEnumDisplayName } from '../utils/enum-display';
import { resolveLabel, buildLabelPool, labelDisplayText } from '../utils/label-resolver';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Frame {
  label: string;           // breadcrumb label
  expression: string;      // expression being resolved
  configIndex: number;     // config index to resolve from
}

export function getDrillDownEffectiveResolutionInput({
  selectedExpression,
  selectedIsModel,
  frameConfigIndex,
  modelBindingExpression,
  modelBindingConfigIndex,
}: {
  selectedExpression: string;
  selectedIsModel: boolean;
  frameConfigIndex: number;
  modelBindingExpression?: string | null;
  modelBindingConfigIndex?: number | null;
}): { effectiveExpr: string; effectiveCi: number } {
  if (selectedIsModel) {
    return {
      effectiveExpr: modelBindingExpression ?? selectedExpression,
      effectiveCi: modelBindingConfigIndex ?? frameConfigIndex,
    };
  }

  return {
    effectiveExpr: selectedExpression,
    effectiveCi: frameConfigIndex,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dsTypeBadge(ds: any): string {
  if (ds.tableInfo)       return 'table';
  if (ds.enumInfo)        return 'enum';
  if (ds.classInfo)       return 'class';
  if (ds.calculatedField) return 'calc';
  return ds.type?.toLowerCase() ?? 'unknown';
}

function localizeBadgeLabel(badge: string): string {
  const cs: Record<string, string> = {
    table: 'AX tabulka',
    enum: 'AX výčet',
    class: 'AX třída',
    calc: 'Vypočtené pole',
    container: 'Složka',
    groupby: 'Seskupení',
    join: 'Spojení',
    object: 'AX objekt',
    userparameter: 'Parametr uživatele',
    param: 'Parametr uživatele',
    importformat: 'Importní formát',
    leaf: 'AX tabulka',
    unknown: 'Neznámé',
  };
  const en: Record<string, string> = {
    table: 'AX table',
    enum: 'AX enum',
    class: 'AX class',
    calc: 'Calculated field',
    container: 'Folder',
    groupby: 'Group by',
    join: 'Join',
    object: 'AX object',
    userparameter: 'User parameter',
    param: 'User parameter',
    importformat: 'Import format',
    leaf: 'AX table',
    unknown: 'Unknown',
  };
  const dict = locale === 'cs' ? cs : en;
  return dict[badge] ?? badge;
}

function localizeDatasourceType(ds: any): string {
  if (ds.tableInfo) return localizeBadgeLabel('table');
  if (ds.enumInfo) return localizeBadgeLabel('enum');
  if (ds.classInfo) return localizeBadgeLabel('class');
  if (ds.calculatedField) return localizeBadgeLabel('calc');
  return localizeBadgeLabel(String(ds.type ?? 'unknown').toLowerCase());
}

function firstSegment(expr: string): string {
  return expr.split(/[.(]/)[0].replace(/['"]/g, '').trim();
}

/** ER built-in function names — not datasource identifiers */
const ER_FUNCTIONS = new Set([
  'IF','AND','OR','NOT','CASE',
  'FILTER','WHERE','ORDERBY','REVERSE','FIRST','FIRSTORNULL','LAST','COUNT',
  'ALLITEMS','ALLITEMSQUERY','LISTTOFIRST','ENUMERATE','LISTJOIN','SPLIT','EMPTYLIST',
  'SUMIF','SUM','MIN','MAX','AVG','COUNTIF','COUNTIFS',
  'ABS','ROUND','ROUNDUP','ROUNDDOWN','INT','INTVALUE','INT64VALUE','NUMBERVALUE',
  'FORMAT','TEXT','TRIM','UPPER','LOWER','LEFT','RIGHT','MID','LEN','FIND','REPLACE','CONCATENATE','STRINGJOIN',
  'DATETIMEFORMAT','DATEFORMAT','ADDDAYS','DATETIMEVALUE','DATEVALUE','TODAY','NOW','SESSIONNOW','SESSIONTODAY',
  'NULLDATE','NULLDATETIME','DAYOFYEAR',
  'VALUEIN','VALUEINLARGE','CONVERTCURRENCY','ROUNDAMOUNT',
  'GETENUMVALUEBYNAME','GUIDVALUE','NUMSEQVALUE','BASE64STRINGTOCONTAINER','NOACCESSTEXT',
  'NULLCONTAINER','ISEMPTY','ISNULL',
]);

/**
 * Classify a raw ER expression to give a better hint when it can't be resolved.
 */
function classifyExpr(expr: string): 'empty' | 'current-record' | 'er-function' | 'compound' | 'constant' | 'unknown' {
  if (!expr || !expr.trim()) return 'empty';
  if (expr.startsWith('@.') || expr === '@') return 'current-record';
  const root = firstSegment(expr).toUpperCase();
  if (ER_FUNCTIONS.has(root)) return 'er-function';
  // Compound: contains comparison/boolean operators outside quotes
  if (/\s*(<>|>=|<=|!=|>|<|=)\s*/.test(expr) || /\b(AND|OR|NOT)\b/i.test(expr)) return 'compound';
  // Pure string/number constant
  if (/^['"]/.test(expr) || /^\d/.test(expr)) return 'constant';
  return 'unknown';
}

/**
 * Extract a clean model path from a potentially compound expression.
 * "model.X.Y.Z <> """ → "model.X.Y.Z"
 * "model.'Tax declaration header'.TechnicalInfo.Periodicity = ..." → the clean model path
 */
function extractModelPath(expr: string): string {
  const lo = expr.toLowerCase();
  if (!lo.startsWith('model.') && !lo.startsWith('model\\')) return expr;

  let i = 6; // skip 'model.' or 'model\'
  let result = expr.slice(0, 6);

  while (i < expr.length) {
    const ch = expr[i];

    // Single-quoted segment: 'Tax declaration header'
    if (ch === "'") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== "'") j++;
      result += expr.slice(i, j + 1);
      i = j + 1;
      // Continue if followed immediately by a path separator then another segment
      if (i < expr.length && (expr[i] === '.' || expr[i] === '\\')) {
        const next = i + 1 < expr.length ? expr[i + 1] : '';
        if (next && /[A-Za-z0-9_$']/.test(next)) { result += expr[i]; i++; continue; }
      }
      break;
    }

    // Plain unquoted identifier
    if (/[A-Za-z0-9_$]/.test(ch)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_$]/.test(expr[j])) j++;
      result += expr.slice(i, j);
      i = j;
      if (i < expr.length && (expr[i] === '.' || expr[i] === '\\')) {
        const next = i + 1 < expr.length ? expr[i + 1] : '';
        if (next && /[A-Za-z0-9_$']/.test(next)) { result += expr[i]; i++; continue; }
      }
      break;
    }

    // Space, operator, end of path
    break;
  }

  return result.replace(/[.\\]+$/, '');
}

/**
 * Extract ALL model paths from a compound expression.
 * "model.X.Y <> model.A.B" → ["model.X.Y", "model.A.B"]
 */
// ─── ER Expression Tokenizer ─────────────────────────────────────────────────
// Splits any ER expression into renderable + clickable tokens.
// DS reference tokens (kind='ds') carry their path segments so clicking them
// navigates into that datasource / calculated field.

interface ERToken {
  kind: 'func' | 'ds' | 'op' | 'str' | 'num' | 'paren' | 'sep' | 'ws' | 'label' | 'other';
  raw: string;            // exact text in expression
  segments?: string[];    // for 'ds': unquoted path segments (['001_System','$TaxJuristictionUIP'])
}

type UniqueDsToken = {
  expression: string;
  segments: string[];
  raw: string;
};

type DrillValidationRule = {
  id?: string;
  conditionExpressionAsString?: string;
  messageExpressionAsString?: string;
  actionLabel?: string;
};

type DrillValidationContext = {
  path: string;
  rules: DrillValidationRule[];
};

function formatSegmentForExpression(segment: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(segment)) return segment;
  return `'${segment.replace(/'/g, "\\'")}'`;
}

function formatSegmentForDisplay(segment: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(segment)) return segment;
  return `'${segment}'`;
}

const ER_KEYWORDS = new Set(['true', 'false', 'null', 'empty', 'asc', 'desc']);

export function tokenizeERExpr(expr: string): ERToken[] {
  const tokens: ERToken[] = [];
  let i = 0;
  const n = expr.length;

  while (i < n) {
    const ch = expr[i];

    // ── Whitespace ──────────────────────────────────────────────────────────
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      let j = i + 1;
      while (j < n && (expr[j] === ' ' || expr[j] === '\t' || expr[j] === '\r' || expr[j] === '\n')) j++;
      tokens.push({ kind: 'ws', raw: expr.slice(i, j) });
      i = j; continue;
    }

    // ── String literal (double-quoted) ───────────────────────────────────────
    if (ch === '"') {
      let j = i + 1;
      while (j < n && expr[j] !== '"') j++;
      tokens.push({ kind: 'str', raw: expr.slice(i, j + 1) });
      i = j + 1; continue;
    }

    // ── Multi-char operators ─────────────────────────────────────────────────
    if (i + 1 < n) {
      const two = ch + expr[i + 1];
      if (two === '<>' || two === '>=' || two === '<=') {
        tokens.push({ kind: 'op', raw: two }); i += 2; continue;
      }
    }

    // ── Single-char operators & text-concatenation ───────────────────────────
    if ('=><+-*/&%'.includes(ch)) {
      tokens.push({ kind: 'op', raw: ch }); i++; continue;
    }
    if (ch === '(') { tokens.push({ kind: 'paren', raw: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'paren', raw: ')' }); i++; continue; }
    if (ch === ',') { tokens.push({ kind: 'sep',   raw: ',' }); i++; continue; }

    // ── Number ───────────────────────────────────────────────────────────────
    if (ch >= '0' && ch <= '9') {
      let j = i + 1;
      while (j < n && ((expr[j] >= '0' && expr[j] <= '9') || expr[j] === '.')) j++;
      tokens.push({ kind: 'num', raw: expr.slice(i, j) }); i = j; continue;
    }

    // ── @ label reference (@"GER_LABEL:...") or current-record ref (@.field / @) ──
    if (ch === '@') {
      let j = i + 1;
      if (j < n && expr[j] === '"') {
        // Label reference: @"GER_LABEL:Foo" or @"SomeLabel"
        j++; // skip opening "
        let inner = '';
        while (j < n && expr[j] !== '"') inner += expr[j++];
        if (j < n) j++; // skip closing "
        tokens.push({ kind: 'label', raw: `@"${inner}"` });
        i = j; continue;
      }
      // Unquoted label reference: @GER_LABEL:Foo, @SYS12345, @Foo_Bar.
      // ER exports write both the quoted and the bare form; without this
      // branch the bare form fell through to the identifier tokenizer and
      // "GER_LABEL" rendered as a clickable datasource.
      if (j < n && /[A-Za-z_]/.test(expr[j])) {
        let k = j;
        while (k < n && /[A-Za-z0-9_]/.test(expr[k])) k++;
        if (k < n && expr[k] === ':' && k + 1 < n && /[A-Za-z0-9_]/.test(expr[k + 1])) {
          k++;
          while (k < n && /[A-Za-z0-9_.\-]/.test(expr[k])) k++;
        }
        tokens.push({ kind: 'label', raw: expr.slice(i, k) });
        i = k; continue;
      }
      let raw = '@';
      if (j < n && expr[j] === '.') {
        raw += '.'; j++;
        while (j < n && /[A-Za-z0-9_$]/.test(expr[j])) raw += expr[j++];
      }
      tokens.push({ kind: 'other', raw }); i = j; continue;
    }

    // ── Quoted path: 'seg1'.'seg2'… ─────────────────────────────────────────
    if (ch === "'") {
      const segments: string[] = [];
      let raw = '';
      let j = i;
      while (j < n && expr[j] === "'") {
        j++;                        // skip opening '
        let seg = '';
        while (j < n && expr[j] !== "'") seg += expr[j++];
        if (j < n) j++;             // skip closing '
        raw += "'" + seg + "'";
        segments.push(seg);
        // Continue if followed by . then another quote
        if (j < n && expr[j] === '.' && j + 1 < n && expr[j + 1] === "'") {
          raw += '.'; j++;
        } else { break; }
      }
      tokens.push({ kind: segments.length > 0 ? 'ds' : 'other', raw, segments });
      i = j; continue;
    }

    // ── Plain identifier: function name / keyword / DS name ──────────────────
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(expr[j])) j++;
      const name = expr.slice(i, j);
      const upper = name.toUpperCase();

      if (ER_FUNCTIONS.has(upper)) {
        tokens.push({ kind: 'func', raw: name }); i = j; continue;
      }
      if (ER_KEYWORDS.has(name.toLowerCase())) {
        tokens.push({ kind: 'other', raw: name }); i = j; continue;
      }

      // DS reference — extend with dotted sub-paths
      const segments: string[] = [name];
      let raw = name;
      let k = j;
      while (k < n && expr[k] === '.') {
        if (k + 1 < n && expr[k + 1] === "'") {
          // .'$quoted'
          let m = k + 2; let seg = '';
          while (m < n && expr[m] !== "'") seg += expr[m++];
          if (m < n) m++;
          raw += ".'" + seg + "'";
          segments.push(seg); k = m;
        } else if (k + 1 < n && /[A-Za-z0-9_$]/.test(expr[k + 1])) {
          // .plain
          let m = k + 1;
          while (m < n && /[A-Za-z0-9_$]/.test(expr[m])) m++;
          const nextName = expr.slice(k + 1, m);
          if (ER_FUNCTIONS.has(nextName.toUpperCase())) break;
          raw += '.' + nextName; segments.push(nextName); k = m;
        } else { break; }
      }
      tokens.push({ kind: 'ds', raw, segments }); i = k; continue;
    }

    // ── Anything else ─────────────────────────────────────────────────────────
    tokens.push({ kind: 'other', raw: ch }); i++;
  }
  return tokens;
}

/**
 * Whether the workbench should render the "Expression" card for a selection.
 * Bare paths are already spelled out by the breadcrumb, but label references
 * need it — that card is the only place `ExpressionView` translates them.
 */
export function shouldShowFullExpression(expr: string): boolean {
  const kind = classifyExpr(expr);
  if (kind === 'er-function' || kind === 'compound' || expr.includes('(')) return true;
  return tokenizeERExpr(expr).some(tok => tok.kind === 'label');
}

function uniqueDsTokens(tokens: ERToken[]): UniqueDsToken[] {
  const unique = new Map<string, UniqueDsToken>();

  for (const tok of tokens) {
    if (tok.kind !== 'ds' || !Array.isArray(tok.segments) || tok.segments.length === 0) continue;
    const expression = tok.segments.map(formatSegmentForExpression).join('.');
    if (unique.has(expression)) continue;
    unique.set(expression, {
      expression,
      segments: tok.segments,
      raw: tok.raw,
    });
  }

  return Array.from(unique.values());
}

function dedupeTreeChildren(nodes: TreeExprNode[]): TreeExprNode[] {
  const unique = new Map<string, TreeExprNode>();

  for (const node of nodes) {
    const dedupedChildren = dedupeTreeChildren(node.children ?? []);
    const normalizedNode: TreeExprNode = {
      ...node,
      children: dedupedChildren,
    };

    const signature = [
      normalizedNode.kind,
      normalizedNode.badge,
      normalizedNode.label,
      normalizedNode.sublabel ?? '',
      normalizedNode.leafType ?? '',
      String(normalizedNode.configIndex ?? ''),
    ].join('|');

    if (!unique.has(signature)) {
      unique.set(signature, normalizedNode);
    }
  }

  return Array.from(unique.values());
}

function getValidationActionLabel(rule: any): string | undefined {
  const candidates = [
    rule?.action,
    rule?.actionType,
    rule?.errorLevel,
    rule?.severity,
    rule?.reaction,
    rule?.behavior,
  ];

  const text = candidates.find(value => typeof value === 'string' && value.trim().length > 0);
  if (text) return text.trim();

  if (rule?.stopProcessing === true) return locale === 'cs' ? 'Zastavit' : 'Stop';
  if (rule?.isWarning === true) return locale === 'cs' ? 'Varování' : 'Warning';

  return undefined;
}

function getDrillValidationContext(
  configurations: any[],
  configIndex: number,
  elementName?: string,
): DrillValidationContext | null {
  if (!elementName) return null;

  const config = configurations[configIndex];
  if (!config) return null;

  const mappings: any[] = [];
  if (config.content?.kind === 'ModelMapping') {
    const version = config.content.version;
    mappings.push(...(version?.mappings?.length ? version.mappings : [version?.mapping].filter(Boolean)));
  }
  if (config.content?.kind === 'Format') {
    for (const version of config.content.embeddedModelMappingVersions ?? []) {
      if (version?.mappings?.length) mappings.push(...version.mappings);
      else if (version?.mapping) mappings.push(version.mapping);
    }
  }

  for (const mapping of mappings) {
    const validation = (mapping.validations ?? []).find((v: any) => v.path === elementName);
    if (!validation) continue;

    const rules: DrillValidationRule[] = (validation.conditions ?? []).map((rule: any) => ({
      id: rule?.id,
      conditionExpressionAsString: rule?.conditionExpressionAsString,
      messageExpressionAsString: rule?.messageExpressionAsString,
      actionLabel: getValidationActionLabel(rule),
    }));

    return { path: validation.path, rules };
  }

  return null;
}

// ─── ER expression pretty-printer ────────────────────────────────────────────
// Reformats a raw ER expression string with newlines and indentation so that
// nested function calls read vertically. Short expressions (< 80 chars) are
// returned unchanged to keep simple bindings on a single line.

function prettifyERExpr(expr: string, indentWidth = 2): string {
  if (expr.length < 80) return expr;

  let out = '';
  let depth = 0;
  let i = 0;
  const n = expr.length;
  const pad = (d: number) => ' '.repeat(d * indentWidth);

  while (i < n) {
    const ch = expr[i];

    // Double-quoted string literal — copy verbatim
    if (ch === '"') {
      let j = i + 1;
      while (j < n && expr[j] !== '"') j++;
      out += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // Single-quoted path segment — copy verbatim
    if (ch === "'") {
      let j = i + 1;
      while (j < n && expr[j] !== "'") j++;
      out += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (ch === '(') {
      depth++;
      out += '(\n' + pad(depth);
      i++;
      while (i < n && (expr[i] === ' ' || expr[i] === '\t' || expr[i] === '\n' || expr[i] === '\r')) i++;
      continue;
    }

    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      out += '\n' + pad(depth) + ')';
      i++;
      continue;
    }

    if (ch === ',') {
      out += ',\n' + pad(depth);
      i++;
      while (i < n && (expr[i] === ' ' || expr[i] === '\t' || expr[i] === '\n' || expr[i] === '\r')) i++;
      continue;
    }

    // Collapse existing whitespace to a single space
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      const last = out[out.length - 1];
      if (out.length > 0 && last !== '\n' && last !== ' ') out += ' ';
      i++;
      while (i < n && (expr[i] === ' ' || expr[i] === '\t' || expr[i] === '\n' || expr[i] === '\r')) i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

// ─── ExpressionView — interactive tokenised expression renderer ───────────────
// Renders an ER expression with syntax colouring. DS-reference tokens are
// clickable: clicking them pushes a new drill-down frame for that datasource.

interface ExpressionViewProps {
  expr: string;
  configIndex: number;
  /**
   * Opens the clicked part of a path. Every part is a valid prefix expression
   * on its own, so the caller can resolve exactly what that hop returns —
   * `model.Invoice.Address` answers a different question than `model.Invoice`.
   */
  onSegment?: (label: string, prefixExpression: string, configIndex: number) => void;
  /** Normalised name of the part currently opened, so it can be marked. */
  activeSegment?: string | null;
}

function ExpressionView({ expr, configIndex, onSegment, activeSegment }: ExpressionViewProps) {
  const tokens = useMemo(() => tokenizeERExpr(prettifyERExpr(expr)), [expr]);
  const configurations = useAppStore(s => s.configurations);
  const labels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);

  return (
    <div className="er-expr">
      {tokens.map((tok, idx) => {
        if (tok.kind === 'label') {
          const resolved = resolveLabel(tok.raw, labels);
          const displayText = resolved?.localized ?? resolved?.enUs ?? resolved?.id;
          return (
            <span key={idx} className="er-token-str" title={tok.raw} style={(resolved?.localized || resolved?.enUs) ? { fontStyle: 'italic' } : undefined}>
              {displayText ?? tok.raw}
            </span>
          );
        }
        if (tok.kind === 'ds' && tok.segments && tok.segments.length > 0) {
          const segments = tok.segments;
          return (
            <span key={idx} className="er-token-ds-path" title={tok.raw}>
              {segments.map((segment, segmentIdx) => {
                const label = formatSegmentForDisplay(segment);
                const normalized = normalizeExpr(label);
                // `model` on its own is just the root keyword — it resolves to
                // nothing, so it stays inert. Every real hop is clickable.
                const isModelRoot = segmentIdx === 0 && normalized === 'model';
                const clickable = Boolean(onSegment) && !isModelRoot;
                const isSelf = clickable && activeSegment === normalized;
                const prefix = segments.slice(0, segmentIdx + 1).map(formatSegmentForExpression).join('.');
                return (
                  <React.Fragment key={`${idx}-${segmentIdx}`}>
                    {segmentIdx > 0 && <span className="er-token-ds-dot">.</span>}
                    <span
                      className={`er-token-ds-segment${isSelf ? ' er-token-ds-segment--self' : ''}${clickable ? '' : ' er-token-ds-segment--static'}`}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      title={clickable ? t.lineageOpenSegment(prefix) : undefined}
                      onClick={clickable ? () => onSegment!(label, prefix, configIndex) : undefined}
                      onKeyDown={clickable
                        ? event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onSegment!(label, prefix, configIndex);
                            }
                          }
                        : undefined}
                    >
                      {label}
                    </span>
                  </React.Fragment>
                );
              })}
            </span>
          );
        }
        const cls: Record<string, string> = {
          func: 'er-token-func', op: 'er-token-op', str: 'er-token-str',
          num: 'er-token-num', paren: 'er-token-paren', sep: 'er-token-sep',
        };
        const c = cls[tok.kind];
        return c
          ? <span key={idx} className={c}>{tok.raw}</span>
          : <span key={idx}>{tok.raw}</span>;
      })}
    </div>
  );
}

// ─── Frame content ────────────────────────────────────────────────────────────

interface FrameViewProps {
  frame: Frame;
  onPush: (newFrame: Frame) => void;
  configurations: any[];
}

/** One row of the workbench's left-hand "Expression parts" list. */
interface WorkbenchPart {
  id: string;
  expression: string;
  label: string;
  detail?: string;
  depth: number;
  badge: TreeExprNode['badge'];
  configIndex: number;
}

/** A concrete D365FO source (table, enum, class, parameter, calculation) used by an expression. */
interface UsedSource {
  key: string;
  name: string;
  detail?: string;
  badge: string;
  expression?: string;
  configIndex: number;
}

const USED_SOURCE_ORDER: Record<string, number> = {
  table: 0, enum: 1, class: 2, param: 3, groupby: 4, calc: 5, leaf: 6,
};

/**
 * Single-column drill-down detail: what data the expression reads, how the
 * value is filled in, and the source it ends at. The expression itself lives
 * in the panel header, so this view no longer repeats it.
 */
/** Icon that identifies the kind of D365FO artefact a badge stands for. */
function BadgeIcon({ badge, size = 14 }: { badge: string; size?: number }) {
  switch (badge) {
    case 'table':
    case 'leaf':
      return <TableRegular fontSize={size} aria-hidden />;
    case 'enum':
      return <TagRegular fontSize={size} aria-hidden />;
    case 'class':
      return <CodeRegular fontSize={size} aria-hidden />;
    case 'calc':
      return <CalculatorRegular fontSize={size} aria-hidden />;
    case 'param':
      return <PersonRegular fontSize={size} aria-hidden />;
    case 'groupby':
      return <ArrowShuffleRegular fontSize={size} aria-hidden />;
    case 'model':
    case 'mapping':
      return <BranchForkRegular fontSize={size} aria-hidden />;
    case 'root':
      return <CompassNorthwestRegular fontSize={size} aria-hidden />;
    default:
      return <FolderRegular fontSize={size} aria-hidden />;
  }
}

const normalizeExpr = (value: string) => value.replace(/\s+/g, '').toLowerCase();

// ─── Value path (data lineage) ───────────────────────────────────────────────
// Instead of navigating a stack of frames, the whole resolution chain of an
// expression is laid out at once as an indented outline:
//   expression → model path → mapping formula → datasource → formula → AX table
// Nothing is pushed, replaced or appended, so there is no navigation state that
// can drift out of sync with what is on screen.

/** How deep the outline expands before the user has to open a branch. */
const LINEAGE_AUTO_EXPAND_DEPTH = 3;

/** What this hop of the chain represents, in the consultant's words. */
function lineageStageLabel(node: TreeExprNode): string {
  if (node.kind === 'mapping') return t.lineageStageMapping;
  if (node.kind === 'calcfield') return t.lineageStageFormula;
  if (node.badge === 'model') return t.lineageStageModelPath;
  if (node.badge === 'param') return t.lineageStageUserParam;
  if (node.badge === 'groupby') return t.lineageStageGroupBy;
  if (node.kind === 'leaf') return t.lineageStageEntity;
  if (node.kind === 'ref') return t.lineageStageUnresolved;
  return t.lineageStageSource;
}

/** Nodes whose sublabel is an ER expression rather than a plain name. */
function isFormulaNode(node: TreeExprNode): boolean {
  return node.kind === 'mapping' || node.kind === 'calcfield';
}

/** Stable identity of a source across the outline, the chips and the expression. */
function lineageSourceKey(badge: string, name: string): string {
  return `${badge === 'userparameter' ? 'param' : badge}::${normalizeExpr(name)}`;
}

function countLineageDescendants(node: TreeExprNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countLineageDescendants(child), 0);
}

interface LineageIndexEntry {
  /** Row key used both for the DOM ref and for the highlight. */
  key: string;
  /** Node ids that must be open for the row to be on screen. */
  ancestors: string[];
}

/**
 * Everything the outline needs to reveal a row on demand: which rows exist,
 * how to open them, and which plain names in an expression lead to them.
 */
function buildLineageIndex(root: TreeExprNode): {
  defaultOpen: Set<string>;
  byKey: Map<string, LineageIndexEntry>;
  byName: Map<string, LineageIndexEntry>;
} {
  const defaultOpen = new Set<string>();
  const byKey = new Map<string, LineageIndexEntry>();
  const byName = new Map<string, LineageIndexEntry>();

  const walk = (node: TreeExprNode, depth: number, ancestors: string[]): void => {
    if (depth < LINEAGE_AUTO_EXPAND_DEPTH) defaultOpen.add(node.id);

    const entry: LineageIndexEntry = { key: lineageSourceKey(node.badge, node.label), ancestors };
    // The shallowest occurrence wins — that is the one the user should land on.
    if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
    for (const name of [node.label, isFormulaNode(node) ? undefined : node.sublabel]) {
      const normalized = normalizeExpr(String(name ?? ''));
      if (normalized && !byName.has(normalized)) byName.set(normalized, entry);
    }

    const childAncestors = [...ancestors, node.id];
    node.children.forEach(child => walk(child, depth + 1, childAncestors));
  };

  root.children.forEach(child => walk(child, 1, []));
  return { defaultOpen, byKey, byName };
}

function LineageRow({ node, depth, highlightKey, openIds, onToggle, registerRef, onSegment, activeSegment }: {
  node: TreeExprNode;
  depth: number;
  highlightKey: string | null;
  openIds: Set<string>;
  onToggle: (id: string) => void;
  registerRef: (key: string, el: HTMLDivElement | null) => void;
  onSegment: (label: string, prefixExpression: string, configIndex: number) => void;
  activeSegment: string | null;
}) {
  const hasChildren = node.children.length > 0;
  const formula = isFormulaNode(node) ? node.sublabel : undefined;
  const expandable = hasChildren || Boolean(formula);
  const open = openIds.has(node.id);
  const sourceKey = lineageSourceKey(node.badge, node.label);
  const isHighlighted = highlightKey === sourceKey;
  // A mapping row's own name ("Mapping") only repeats its stage label, so the
  // binding expression takes that slot instead — that is the useful part.
  const showName = node.kind !== 'mapping';

  return (
    <li className="lin-node">
      <div
        ref={el => registerRef(sourceKey, el)}
        className={`lin-row${isHighlighted ? ' is-highlight' : ''}`}
      >
        {expandable ? (
          <button
            type="button"
            className={`lin-row__toggle${open ? ' is-open' : ''}`}
            onClick={() => onToggle(node.id)}
            aria-expanded={open}
            aria-label={open ? t.lineageCollapse : t.lineageExpand}
            title={open ? t.lineageCollapse : t.lineageExpand}
          >
            <ChevronRightRegular fontSize={12} />
          </button>
        ) : (
          <span className="lin-row__toggle lin-row__toggle--leaf" aria-hidden>
            <CircleRegular fontSize={7} />
          </span>
        )}
        <span className="lin-row__icon" aria-hidden><BadgeIcon badge={node.badge} /></span>
        <span className="lin-row__stage">{lineageStageLabel(node)}</span>
        {showName && <span className="lin-row__name" title={node.label}>{node.label}</span>}
        {node.sublabel && !formula && (
          <code className="lin-row__detail" title={node.sublabel}>{node.sublabel}</code>
        )}
        {formula && !open && (
          <code className="lin-row__detail" title={formula}>{formula}</code>
        )}
        {expandable && !open && (
          <span className="lin-row__more">+{countLineageDescendants(node) + (formula ? 1 : 0)}</span>
        )}
      </div>

      {open && (formula || hasChildren) && (
        <div className="lin-branch">
          {formula && (
            <div className="lin-formula">
              <span className="lin-formula__label">{t.lineageFormulaLabel}</span>
              <ExpressionView
                expr={formula}
                configIndex={node.configIndex ?? 0}
                onSegment={onSegment}
                activeSegment={activeSegment}
              />
            </div>
          )}
          {hasChildren && (
            <ul className="lin-children">
              {node.children.map(child => (
                <LineageRow
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  highlightKey={highlightKey}
                  openIds={openIds}
                  onToggle={onToggle}
                  registerRef={registerRef}
                  onSegment={onSegment}
                  activeSegment={activeSegment}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The whole drill-down body: what data the expression uses, and the complete
 * path each value travels to get there.
 */
function DrillDownLineageView({ expression, configIndex, configurations, elementName }: {
  expression: string;
  configIndex: number;
  configurations: any[];
  elementName?: string;
}) {
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);
  const findModelPathBindings = useAppStore(s => s.findModelPathBindings);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [peek, setPeek] = useState<{ label: string; expression: string; configIndex: number } | null>(null);
  const [pendingScrollKey, setPendingScrollKey] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const registerRef = React.useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  }, []);

  const tree = useMemo(() => buildExpressionTree({
    expression,
    configIndex,
    configurations,
    resolveModelPath,
    resolveDatasource,
    findModelPathBindings,
    includeUnresolvedRefs: showUnresolved,
  }), [expression, configIndex, configurations, resolveModelPath, resolveDatasource, findModelPathBindings, showUnresolved]);

  const usedSources = useMemo(() => collectUsedSources({
    expression,
    configIndex,
    configurations,
    resolveModelPath,
    resolveDatasource,
  }), [expression, configIndex, configurations, resolveModelPath, resolveDatasource]);

  const index = useMemo(() => buildLineageIndex(tree), [tree]);
  const [openIds, setOpenIds] = useState<Set<string>>(index.defaultOpen);

  // A different expression means a different outline, so the open branches reset.
  useEffect(() => { setOpenIds(index.defaultOpen); setPeek(null); }, [index]);

  const toggle = React.useCallback((id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * Reveal a row: open every branch above it first, then scroll once React has
   * actually rendered it. Scrolling straight away would miss collapsed rows.
   */
  const reveal = (entry: LineageIndexEntry | undefined) => {
    if (!entry) return;
    setPeek(null);
    setOpenIds(prev => {
      const next = new Set(prev);
      entry.ancestors.forEach(id => next.add(id));
      return next;
    });
    setHighlightKey(entry.key);
    setPendingScrollKey(entry.key);
  };

  useEffect(() => {
    if (!pendingScrollKey) return;
    const row = rowRefs.current.get(pendingScrollKey);
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setPendingScrollKey(null);
  }, [pendingScrollKey, openIds]);

  /**
   * Clicking a part of a path re-scopes the whole breakdown below the
   * expression to that part — the question "what is behind this hop?" is
   * answered in place, not in a second panel competing for attention.
   */
  const handleSegment = React.useCallback((label: string, prefixExpression: string, segmentConfigIndex: number) => {
    setHighlightKey(null);
    setPeek({ label, expression: prefixExpression, configIndex: segmentConfigIndex });
  }, []);

  // A scope only makes sense for the expression it was taken from.
  useEffect(() => { setPeek(null); }, [expression, configIndex]);

  /** What the clicked part of a path resolves to, on its own. */
  const peekTree = useMemo(() => (peek
    ? buildExpressionTree({
        expression: peek.expression,
        configIndex: peek.configIndex,
        configurations,
        resolveModelPath,
        resolveDatasource,
        findModelPathBindings,
        includeUnresolvedRefs: true,
      })
    : null
  ), [peek, configurations, resolveModelPath, resolveDatasource, findModelPathBindings]);

  const peekIndex = useMemo(() => (peekTree ? buildLineageIndex(peekTree) : null), [peekTree]);
  const [peekOpenIds, setPeekOpenIds] = useState<Set<string>>(new Set());
  useEffect(() => { setPeekOpenIds(peekIndex?.defaultOpen ?? new Set()); }, [peekIndex]);
  const togglePeek = React.useCallback((id: string) => {
    setPeekOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const noopRef = React.useCallback(() => {}, []);

  const activeSegment = useMemo(() => (peek ? normalizeExpr(peek.label) : null), [peek]);

  // One set of props drives the outline, whether it shows the whole expression
  // or just the part the user drilled into.
  const shownTree = peekTree ?? tree;
  const shownOpenIds = peek ? peekOpenIds : openIds;
  const shownToggle = peek ? togglePeek : toggle;
  const shownRegisterRef = peek ? noopRef : registerRef;
  const shownHighlight = peek ? null : highlightKey;

  return (
    <div className="lin">
      {/* The headline question — which D365FO data does this element read? */}
      <section className="lin-summary">
        <header className="lin-summary__head">
          <span className="lin-summary__title">{t.drillUsedDataTitle}</span>
          <span className="lin-summary__count">{usedSources.length}</span>
        </header>
        <p className="lin-summary__hint">{t.drillUsedDataHint}</p>
        {usedSources.length > 0 ? (
          <ul className="lin-chips">
            {usedSources.map(src => {
              const key = lineageSourceKey(src.badge, src.name);
              return (
                <li key={src.key}>
                  <button
                    type="button"
                    className={`lin-chip${highlightKey === key ? ' is-active' : ''}`}
                    onClick={() => reveal(index.byKey.get(key) ?? index.byName.get(normalizeExpr(src.name)))}
                    title={t.lineageShowInPath(src.name)}
                  >
                    <BadgeIcon badge={src.badge} size={13} />
                    <span className="lin-chip__name">{src.name}</span>
                    <span className="lin-chip__type">{localizeBadgeLabel(src.badge)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="lin-summary__empty">{t.drillUsedDataEmpty}</p>
        )}
      </section>

      {/* The full chain, expanded — no navigation, nothing to lose track of. */}
      <section className="lin-path">
        <header className="lin-path__head">
          <span className="lin-summary__title">{t.lineageTitle}</span>
          {showTechnicalDetails && (
            <button
              type="button"
              className={`lin-path__toggle${showUnresolved ? ' is-active' : ''}`}
              onClick={() => setShowUnresolved(v => !v)}
              aria-pressed={showUnresolved}
            >
              {locale === 'cs' ? 'Nevyřešené' : 'Unresolved'}
            </button>
          )}
        </header>
        <p className="lin-summary__hint">{t.lineageHint}</p>

        <ul className="lin-tree">
          <li className="lin-node">
            <div className="lin-row lin-row--origin">
              <span className="lin-row__toggle lin-row__toggle--leaf" aria-hidden>
                <CircleRegular fontSize={7} />
              </span>
              <span className="lin-row__icon" aria-hidden><CompassNorthwestRegular fontSize={14} /></span>
              <span className="lin-row__stage">{t.lineageStageOrigin}</span>
              <span className="lin-row__name">{elementName ?? t.drillFocusExpression}</span>
            </div>
            <div className="lin-branch">
              <div className="lin-formula">
                <span className="lin-formula__label">{t.drillAnalyzing}</span>
                <ExpressionView
                  expr={expression}
                  configIndex={configIndex}
                  onSegment={handleSegment}
                  activeSegment={activeSegment}
                />
              </div>

              {/* The breakdown below is scoped to the part the user clicked. */}
              {peek && (
                <div className="lin-scope">
                  <span className="lin-scope__label">{t.lineagePeekTitle}</span>
                  <code className="lin-scope__expr" title={peek.expression}>{peek.expression}</code>
                  <button
                    type="button"
                    className="lin-scope__reset"
                    onClick={() => setPeek(null)}
                    title={t.lineagePeekClose}
                  >
                    <DismissRegular fontSize={11} />
                    <span>{t.lineagePeekClose}</span>
                  </button>
                </div>
              )}

              {shownTree.children.length > 0 ? (
                <ul className="lin-children">
                  {shownTree.children.map(child => (
                    <LineageRow
                      key={child.id}
                      node={child}
                      depth={1}
                      highlightKey={shownHighlight}
                      openIds={shownOpenIds}
                      onToggle={shownToggle}
                      registerRef={shownRegisterRef}
                      onSegment={handleSegment}
                      activeSegment={activeSegment}
                    />
                  ))}
                </ul>
              ) : (
                <p className="lin-summary__empty">{t.lineagePeekEmpty}</p>
              )}
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}

/** Delay before a single click opens the dialog — long enough to detect a double-click. */
const DRILL_TRIGGER_CLICK_DELAY_MS = 250;

/**
 * Clickable expression wrapper — single-click opens the drill-down analysis
 * in a Fluent Dialog popup, double-click (or Ctrl/Cmd+click, Shift+Enter)
 * opens it as its own tab.
 *
 * Usage:
 *   <DrillDownTrigger expression="model.Invoice.Amount" configIndex={0} elementName="Amount">
 *     model.Invoice.Amount
 *   </DrillDownTrigger>
 */
export function DrillDownTrigger({ expression, configIndex, elementName, className, children }: {
  expression: string;
  configIndex: number;
  elementName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const trimmedExpr = expression?.trim() ?? '';
  const openDrillDownTab = useAppStore(s => s.openDrillDownTab);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogViewMode, setDialogViewMode] = useState<'workbench' | 'tree'>('workbench');
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);

  React.useEffect(() => {
    if (!isDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDialogOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDialogOpen]);

  if (!trimmedExpr) {
    return <span className={className}>{children}</span>;
  }

  const openAsTab = () => openDrillDownTab(trimmedExpr, configIndex, elementName);

  // A modal opened on the first click would swallow the second one, so the
  // single-click open is deferred briefly and cancelled by a double-click.
  const cancelPendingOpen = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  };

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        className={`dd-trigger-expr ${className ?? ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey) {
            cancelPendingOpen();
            openAsTab();
            return;
          }
          if (e.detail > 1) return; // second click of a double-click
          cancelPendingOpen();
          clickTimerRef.current = setTimeout(() => {
            clickTimerRef.current = null;
            setIsDialogOpen(true);
          }, DRILL_TRIGGER_CLICK_DELAY_MS);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          cancelPendingOpen();
          setIsDialogOpen(false);
          openAsTab();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (e.shiftKey || e.ctrlKey || e.metaKey) openAsTab();
            else setIsDialogOpen(true);
          }
        }}
        title={`${t.drillClickToToggle} · ${t.drillOpenAsTab}`}
      >
        {children}
      </span>
      <Dialog open={isDialogOpen} onOpenChange={(_, d) => setIsDialogOpen(d.open)} modalType="modal">
        <DialogSurface
          className="dd-dialog-surface"
          style={dialogViewMode === 'tree'
            // The tree needs room to pan/zoom; the detail view reads better narrow.
            ? { width: '96vw', maxWidth: '96vw', height: '92vh', maxHeight: '92vh' }
            : { width: 'min(1080px, 94vw)', maxWidth: 'min(1080px, 94vw)', height: 'min(760px, 88vh)', maxHeight: 'min(760px, 88vh)' }}
        >
          <DialogBody className="dd-dialog-body">
            <DialogTitle
              className="dd-dialog-titlebar"
              action={
                <Button
                  className="dd-dialog-close"
                  appearance="subtle"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t.dismiss}
                  onClick={() => setIsDialogOpen(false)}
                />
              }
            >
              <span className="dd-dialog-title">
                <CompassNorthwestRegular fontSize={16} />
                {elementName && <span className="dd-dialog-title__name">{elementName}</span>}
              </span>
            </DialogTitle>
            <DialogContent className="dd-dialog-content">
              <DrillDownBody
                expression={trimmedExpr}
                configIndex={configIndex}
                elementName={elementName}
                variant="dialog"
                onViewModeChange={setDialogViewMode}
              />
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}

// ─── Expression Tree Visualizer ──────────────────────────────────────────────
// Builds and renders a top-down ReactFlow tree of the full expression breakdown:
//   root expression → model binding → datasource → calc field refs → leaf entities

interface TreeExprNode {
  id: string;
  kind: 'root' | 'ref' | 'mapping' | 'datasource' | 'calcfield' | 'leaf';
  label: string;
  sublabel?: string;           // table name, enum name, class name, formula snippet
  badge: 'root' | 'model' | 'mapping' | 'table' | 'enum' | 'class' | 'calc' | 'ds' | 'leaf' | 'param' | 'groupby';
  expression?: string;
  configIndex?: number;
  children: TreeExprNode[];
  leafType?: 'table' | 'enum' | 'class';
}

type TreeLabelMode = 'compact' | 'full';

/**
 * Calculated fields chain deeply — `$InvoiceDate` → `$CustInvoiceJour` → `CustInvoiceJour`
 * is already three hops for a single field — so the walk keeps going until it hits
 * concrete entities. `MAX_TREE_NODES` is what actually stops a runaway expansion.
 */
const MAX_CALC_DEPTH = 12;
const MAX_TREE_DEPTH = 16;
const MAX_TREE_NODES = 600;

interface TreeBuildContext {
  configurations: any[];
  resolveModelPath: (p: string) => any;
  resolveDatasource: (n: string, ci: number) => any;
  /** Bindings under a container path — used when the container has none itself. */
  findModelPathBindings?: (p: string) => Array<{
    path: string;
    relativePath: string;
    expressionAsString: string;
    configIndex: number;
  }>;
  includeUnresolvedRefs: boolean;
  /** Remaining node budget, decremented as nodes are produced. */
  budget: number;
}

function buildTreeNode(
  ctx: TreeBuildContext,
  id: string,
  expression: string,
  configIndex: number,
  visited: Set<string>,
  depth = 0,
): TreeExprNode | null {
  const visitKey = `${configIndex}::${expression}`;
  if (visited.has(visitKey) || depth > MAX_TREE_DEPTH || ctx.budget <= 0) return null;
  visited.add(visitKey);
  ctx.budget -= 1;

  const isModel = expression.toLowerCase().startsWith('model.') || expression.toLowerCase().startsWith('model\\');

  // ── Model path → resolve via ModelMapping ──────────────────────────────
  if (isModel) {
    const cleanPath = extractModelPath(expression);
    const modelResult = ctx.resolveModelPath(cleanPath);
    if (!modelResult) {
      // A container usually carries no binding of its own — what fills it is
      // only visible through the bindings of the fields inside it.
      const scoped = buildContainerChildren(ctx, id, cleanPath, configIndex, visited, depth);
      return {
        id, kind: 'ref', label: cleanPath.split(/[.\\]/).pop() ?? cleanPath,
        sublabel: cleanPath, badge: 'model', expression, configIndex,
        children: scoped,
      };
    }
    const bindingExpr: string = modelResult.binding?.expressionAsString ?? '';
    const bindingCi: number = modelResult.bindingConfigIndex ?? configIndex;

    const mappingNode: TreeExprNode = {
      id: `${id}-m`,
      kind: 'mapping',
      label: locale === 'cs' ? 'Mapování' : 'Mapping',
      sublabel: bindingExpr,
      badge: 'mapping',
      expression: bindingExpr,
      configIndex: bindingCi,
      children: [],
    };

    // Resolve the binding expression's datasources
    if (bindingExpr) {
      const dsTokens = uniqueDsTokens(tokenizeERExpr(bindingExpr));
      dsTokens.forEach((tok, ti) => {
        const child = buildTreeNode(
          ctx, `${id}-m-ds${ti}`, tok.expression, bindingCi,
          new Set(visited), depth + 1,
        );
        if (child) mappingNode.children.push(child);
      });
      mappingNode.children = dedupeTreeChildren(mappingNode.children);
    }

    return {
      id, kind: 'ref',
      label: cleanPath.split(/[.\\]/).pop() ?? cleanPath,
      sublabel: cleanPath,
      badge: 'model',
      expression, configIndex,
      children: [mappingNode],
    };
  }

  // ── Direct DS reference ────────────────────────────────────────────────
  const deep = resolveDeepExpression(expression, ctx.configurations, configIndex);
  const resolvedDs = (deep?.nestedDs ?? deep?.rootDs) ?? null;

  if (!resolvedDs) {
    // Try simple root-name lookup
    const rootName = firstSegment(expression);
    const direct = rootName ? ctx.resolveDatasource(rootName, configIndex) : null;
    if (!direct?.datasource) {
      if (!ctx.includeUnresolvedRefs) {
        // Filter out unresolved singleton identifiers (often constants/functions),
        // keep only path-like expressions so the tree doesn't fill with noise.
        const isPathLike = /[.\\]/.test(expression) || /'[^']+'/.test(expression);
        if (!isPathLike) return null;
      }

      return {
        id, kind: 'ref', label: expression.split(/[.(]/)[0] || expression,
        sublabel: ctx.includeUnresolvedRefs ? expression : undefined,
        badge: 'ds', expression, configIndex, children: [],
      };
    }
    return buildDsNode(ctx, id, direct.datasource, configIndex, expression, visited, depth);
  }

  const dsNode = buildDsNode(
    ctx, id, resolvedDs, deep?.rootDsConfigIndex ?? configIndex,
    expression, visited, depth, deep?.fieldPath ?? [],
  );
  appendPathPrefixNodes(ctx, dsNode, id, deep?.pathSegments ?? [], configIndex, resolvedDs, visited, depth);
  return dsNode;
}

/** A datasource whose own definition explains where its value comes from. */
function hasOwnDefinition(ds: any): boolean {
  return Boolean(ds?.calculatedField?.expressionAsString || ds?.userParamInfo || ds?.groupByInfo);
}

/** How many distinct sources a container may contribute before the list is cut. */
const MAX_CONTAINER_SOURCES = 8;

/**
 * What fills a model container that has no binding of its own. ER binds most
 * containers implicitly: only the fields inside them carry expressions, so the
 * container's data sources have to be read off its descendants.
 */
function buildContainerChildren(
  ctx: TreeBuildContext,
  id: string,
  cleanPath: string,
  configIndex: number,
  visited: Set<string>,
  depth: number,
): TreeExprNode[] {
  const scoped = ctx.findModelPathBindings?.(cleanPath) ?? [];
  if (scoped.length === 0) return [];

  // One row per distinct source — a container with 40 fields off one table
  // should read as "this table", not as 40 repetitions of it.
  const byRoot = new Map<string, { expression: string; configIndex: number }>();
  for (const binding of scoped) {
    for (const tok of uniqueDsTokens(tokenizeERExpr(binding.expressionAsString))) {
      const root = tok.segments[0]?.toLowerCase();
      if (!root || byRoot.has(root)) continue;
      byRoot.set(root, { expression: tok.expression, configIndex: binding.configIndex });
      if (byRoot.size >= MAX_CONTAINER_SOURCES) break;
    }
    if (byRoot.size >= MAX_CONTAINER_SOURCES) break;
  }

  const children: TreeExprNode[] = [];
  let i = 0;
  for (const entry of byRoot.values()) {
    const child = buildTreeNode(
      ctx, `${id}-c${i++}`, entry.expression, entry.configIndex,
      new Set(visited), depth + 1,
    );
    if (child) children.push(child);
  }
  return dedupeTreeChildren(children);
}

/**
 * A path like `Parameters.'$SourceJournal'.'$InvoiceDate'` runs through intermediate
 * calculated fields, and each one decides which record the next hop reads from.
 * Only the leaf used to be expanded, so `$SourceJournal` never appeared in the tree.
 */
function appendPathPrefixNodes(
  ctx: TreeBuildContext,
  parent: TreeExprNode,
  id: string,
  segments: string[],
  configIndex: number,
  leafDs: any,
  visited: Set<string>,
  depth: number,
): void {
  if (segments.length < 2) return;

  let added = false;
  for (let i = 1; i < segments.length; i++) {
    const prefix = segments.slice(0, i).map(formatSegmentForExpression).join('.');
    const prefixDeep = resolveDeepExpression(prefix, ctx.configurations, configIndex);
    const prefixDs = prefixDeep?.nestedDs ?? prefixDeep?.rootDs;
    if (!prefixDs || prefixDs === leafDs || !hasOwnDefinition(prefixDs)) continue;

    const child = buildTreeNode(
      ctx, `${id}-path${i}`, prefix, prefixDeep?.rootDsConfigIndex ?? configIndex,
      new Set(visited), depth + 1,
    );
    if (child) { parent.children.push(child); added = true; }
  }

  if (added) parent.children = dedupeTreeChildren(parent.children);
}

function buildDsNode(
  ctx: TreeBuildContext,
  id: string,
  ds: any,
  configIndex: number,
  expression: string,
  visited: Set<string>,
  depth: number,
  fieldPath: string[] = [],
): TreeExprNode {
  const sameLabel = (a?: string, b?: string): boolean => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  // Trailing segments are fields on the entity, not datasources — without them a
  // binding such as `model.InvoiceLines.ItemId` only ever showed the table.
  const fieldSuffix = fieldPath.length > 0 ? fieldPath.join('.') : '';
  const qualify = (entity: string): string => (fieldSuffix ? `${entity}.${fieldSuffix}` : entity);

  const dsNode: TreeExprNode = {
    id: `${id}-ds`,
    kind: 'datasource',
    label: ds.name,
    badge: 'ds',
    expression,
    configIndex,
    children: [],
  };

  /** Expand every datasource an expression references as children of `parent`. */
  const expandExpression = (parent: TreeExprNode, expr: string, keyPrefix: string, ci: number): void => {
    uniqueDsTokens(tokenizeERExpr(expr)).forEach((tok, ti) => {
      const child = buildTreeNode(
        ctx, `${id}-${keyPrefix}${ti}`, tok.expression, ci,
        new Set(visited), depth + 1,
      );
      if (child) parent.children.push(child);
    });
    parent.children = dedupeTreeChildren(parent.children);
  };

  if (ds.tableInfo) {
    const tableName = qualify(ds.tableInfo.tableName);
    dsNode.badge = 'table';
    dsNode.sublabel = !sameLabel(tableName, ds.name) ? tableName : undefined;
    dsNode.leafType = 'table';
    if (!sameLabel(tableName, ds.name)) {
      dsNode.children.push({
        id: `${id}-ds-table`,
        kind: 'leaf', label: tableName, badge: 'table', leafType: 'table', children: [],
      });
    }
  } else if (ds.enumInfo) {
    const enumDisplay = qualify(formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo));
    dsNode.badge = 'enum';
    dsNode.sublabel = !sameLabel(enumDisplay, ds.name) ? enumDisplay : undefined;
    dsNode.leafType = 'enum';
    if (!sameLabel(enumDisplay, ds.name)) {
      dsNode.children.push({
        id: `${id}-ds-enum`,
        kind: 'leaf', label: enumDisplay, badge: 'enum', leafType: 'enum', children: [],
      });
    }
  } else if (ds.classInfo) {
    const className = qualify(ds.classInfo.className);
    dsNode.badge = 'class';
    dsNode.sublabel = !sameLabel(className, ds.name) ? className : undefined;
    dsNode.leafType = 'class';
    if (!sameLabel(className, ds.name)) {
      dsNode.children.push({
        id: `${id}-ds-class`,
        kind: 'leaf', label: className, badge: 'class', leafType: 'class', children: [],
      });
    }
  } else if (ds.userParamInfo) {
    // A user parameter has no formula — its data type and "who fills it in" are the
    // whole answer. Without this the node rendered as a bare name with no explanation.
    const edt = ds.userParamInfo.extendedDataTypeName;
    const valueExpr = ds.userParamInfo.expressionAsString?.trim();
    dsNode.badge = 'param';
    dsNode.sublabel = valueExpr
      ? valueExpr
      : [edt, locale === 'cs' ? 'zadává uživatel při spuštění' : 'entered by the user at run time']
          .filter(Boolean).join(' — ');
    if (valueExpr) expandExpression(dsNode, valueExpr, 'ds-param-ref', configIndex);
  } else if (ds.groupByInfo) {
    const listToGroup = String(ds.groupByInfo.listToGroup ?? '').trim();
    dsNode.badge = 'groupby';
    dsNode.sublabel = listToGroup || undefined;
    if (listToGroup) expandExpression(dsNode, listToGroup.replace(/\//g, '.'), 'ds-grp-ref', configIndex);
  } else if (ds.calculatedField?.expressionAsString && depth < MAX_CALC_DEPTH) {
    const calcExpr: string = ds.calculatedField.expressionAsString;
    dsNode.badge = 'calc';
    dsNode.kind = 'calcfield';
    dsNode.sublabel = calcExpr;
    expandExpression(dsNode, calcExpr, 'ds-calc-ref', configIndex);
  }

  return dsNode;
}

/**
 * Every concrete D365FO source (table, enum, class, user parameter, calculated
 * field) an expression ends up reading — including the field on the entity.
 * Walks the full resolution tree: model path → mapping formula → datasource →
 * nested calculated fields → entity. Exported for tests.
 */
export function collectUsedSources(options: {
  expression: string;
  configIndex: number;
  configurations: any[];
  resolveModelPath: (p: string) => any;
  resolveDatasource: (n: string, ci: number) => any;
}): UsedSource[] {
  const { expression, configIndex, configurations, resolveModelPath, resolveDatasource } = options;

  const out = new Map<string, UsedSource>();
  const add = (src: UsedSource) => {
    const badge = src.badge === 'userparameter' ? 'param' : src.badge;
    const key = `${badge}::${src.name}::${src.detail ?? ''}`;
    if (!out.has(key)) out.set(key, { ...src, badge, key });
  };

  const collectFromExpression = (expr: string, ci: number): void => {
    const tree = buildExpressionTree({
      expression: expr,
      configIndex: ci,
      configurations,
      resolveModelPath,
      resolveDatasource,
    });
    const walk = (node: TreeExprNode): void => {
      if ((node.kind === 'datasource' || node.kind === 'calcfield' || node.kind === 'leaf')
          && node.badge !== 'ds' && node.badge !== 'mapping' && node.badge !== 'model') {
        add({
          key: '',
          name: node.label,
          detail: node.sublabel,
          badge: node.badge,
          expression: node.expression,
          configIndex: node.configIndex ?? ci,
        });
      }
      node.children.forEach(walk);
    };
    tree.children.forEach(walk);
  };

  // 1. Everything reachable from the expression itself (model paths included —
  //    buildExpressionTree walks through their mapping formulas).
  collectFromExpression(expression, configIndex);

  // 2. Container-level model path without a formula of its own — list the
  //    sources used by the mapping bindings *under* that path.
  const selectedModelPath = extractModelPath(expression);
  if (out.size === 0) {
    const splitPathSegments = (path: string): string[] => {
      const segments: string[] = [];
      let current = '';
      let quote: string | null = null;
      for (const ch of path) {
        if (quote) {
          if (ch === quote) quote = null;
          else current += ch;
          continue;
        }
        if (ch === "'" || ch === '"') { quote = ch; continue; }
        if (ch === '.' || ch === '/' || ch === '\\') {
          if (current.trim()) segments.push(current.trim().toLowerCase());
          current = '';
          continue;
        }
        current += ch;
      }
      if (current.trim()) segments.push(current.trim().toLowerCase());
      return segments;
    };

    const selectedSegments = splitPathSegments(selectedModelPath)
      .filter(seg => seg !== 'model' && seg !== 'data');
    const matchesSelectedPath = (bindingPath: unknown): boolean => {
      if (selectedSegments.length === 0) return true;
      const bindingSegments = splitPathSegments(String(bindingPath ?? ''))
        .filter(seg => seg !== 'data');
      // Allow wrapper roots (e.g. "Invoice.") on either side by trying
      // shifted starts, mirroring resolveModelPath.
      for (let start = 0; start < selectedSegments.length; start++) {
        const candidate = selectedSegments.slice(start);
        if (candidate.length <= bindingSegments.length
            && candidate.every((seg, i) => bindingSegments[i] === seg)) {
          return true;
        }
      }
      return false;
    };

    configurations.forEach((config: any, ci: number) => {
      const versions: any[] = config.content.kind === 'ModelMapping'
        ? [config.content.version]
        : config.content.kind === 'Format'
          ? (config.content.embeddedModelMappingVersions ?? [])
          : [];
      for (const version of versions) {
        const definition = selectMappingDefinition(version, configurations);
        const bindings = ((definition?.bindings ?? []) as any[])
          .filter(binding => matchesSelectedPath(binding?.path));
        for (const binding of bindings.slice(0, 80)) {
          const bindingExpression = String(binding?.expressionAsString ?? '').trim();
          if (bindingExpression) collectFromExpression(bindingExpression, ci);
        }
      }
    });
  }

  return Array.from(out.values()).sort((left, right) => (
    (USED_SOURCE_ORDER[left.badge] ?? 9) - (USED_SOURCE_ORDER[right.badge] ?? 9)
    || left.name.localeCompare(right.name)
  ));
}

/**
 * Full breakdown of one expression: model path → mapping formula → datasource →
 * nested calculated fields → concrete table / enum / class. Exported for tests.
 */
export function buildExpressionTree(options: {
  expression: string;
  configIndex: number;
  configurations: any[];
  resolveModelPath: (p: string) => any;
  resolveDatasource: (n: string, ci: number) => any;
  findModelPathBindings?: TreeBuildContext['findModelPathBindings'];
  includeUnresolvedRefs?: boolean;
}): TreeExprNode {
  const {
    expression, configIndex, configurations,
    resolveModelPath, resolveDatasource, findModelPathBindings, includeUnresolvedRefs = false,
  } = options;

  const dsTokens = uniqueDsTokens(tokenizeERExpr(expression));
  let rootChildren: TreeExprNode[] = [];

  if (dsTokens.length === 0) {
    // No DS refs found – show single "unresolved" leaf
    rootChildren.push({
      id: 'unresolved', kind: 'ref',
      label: locale === 'cs' ? 'Žádná datová reference' : 'No data reference',
      badge: 'ds', children: [],
    });
  } else {
    const ctx: TreeBuildContext = {
      configurations,
      resolveModelPath,
      resolveDatasource,
      findModelPathBindings,
      includeUnresolvedRefs,
      budget: MAX_TREE_NODES,
    };
    dsTokens.forEach((tok, ti) => {
      const child = buildTreeNode(ctx, `ref${ti}`, tok.expression, configIndex, new Set(), 0);
      if (child) rootChildren.push(child);
    });
    rootChildren = dedupeTreeChildren(rootChildren);
  }

  return {
    id: 'root',
    kind: 'root',
    label: expression,
    badge: 'root',
    expression,
    configIndex,
    children: rootChildren,
  };
}

/**
 * Rows for the workbench's left column: the path prefixes of the expression
 * followed by everything each leaf resolves to — mapping formula, nested
 * calculated fields, user parameters, and the entity they end at. Listing only
 * the prefixes hid every formula behind the first hop. Exported for tests.
 */
export function buildWorkbenchParts(options: {
  expression: string;
  label: string;
  configIndex: number;
  configurations: any[];
  resolveModelPath: (p: string) => any;
  resolveDatasource: (n: string, ci: number) => any;
}): WorkbenchPart[] {
  const { expression, label, configIndex, configurations, resolveModelPath, resolveDatasource } = options;

  const root = buildExpressionTree({ expression, configIndex, configurations, resolveModelPath, resolveDatasource });
  // Index the whole tree, not just its top row: the prefixes of a path resolve to
  // nodes nested under the leaf, and without them those rows carried no formula.
  const resolutionByExpression = new Map<string, TreeExprNode>();
  const indexNode = (node: TreeExprNode): void => {
    if (node.expression && !resolutionByExpression.has(node.expression)) {
      resolutionByExpression.set(node.expression, node);
    }
    for (const child of node.children) indexNode(child);
  };
  for (const child of root.children) indexNode(child);

  const parts: WorkbenchPart[] = [{ id: 'root', expression, label, depth: 0, badge: 'root', configIndex }];
  const seen = new Set<string>([expression]);

  const walk = (node: TreeExprNode, depth: number): void => {
    let childDepth = depth;
    if (node.expression) {
      childDepth = depth + 1;
      if (seen.has(node.expression)) {
        for (const child of node.children) walk(child, childDepth);
        return;
      }
      seen.add(node.expression);
      parts.push({
        id: node.id,
        expression: node.expression,
        label: node.label,
        detail: node.sublabel,
        depth,
        badge: node.badge,
        configIndex: node.configIndex ?? configIndex,
      });
    }
    for (const child of node.children) walk(child, childDepth);
  };

  for (const tok of tokenizeERExpr(expression)) {
    if (tok.kind !== 'ds' || !tok.segments || tok.segments.length === 0) continue;

    for (let i = 0; i < tok.segments.length; i++) {
      const prefix = tok.segments.slice(0, i + 1).map(formatSegmentForExpression).join('.');
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      const resolution = resolutionByExpression.get(prefix);
      parts.push({
        id: `part:${prefix}`,
        expression: prefix,
        label: formatSegmentForDisplay(tok.segments[i]),
        detail: resolution?.sublabel,
        depth: i + 1,
        badge: resolution?.badge ?? 'ds',
        configIndex: resolution?.configIndex ?? configIndex,
      });
    }

    const leaf = resolutionByExpression.get(tok.segments.map(formatSegmentForExpression).join('.'));
    if (leaf) {
      for (const child of leaf.children) walk(child, tok.segments.length + 1);
    }
  }

  return parts;
}

// ── Layout: assign x/y to each node (top-down, centered subtrees) ──────────

const TREE_NODE_W_COMPACT_MIN = 220;
const TREE_NODE_W_COMPACT_MAX = 420;
const TREE_NODE_W_FULL_MIN = 280;
const TREE_NODE_W_FULL_MAX = 620;
const TREE_H_GAP = 26; // horizontal gap between sibling subtrees
const AUTO_COMPACT_NODE_THRESHOLD = 34;

interface LayoutNode { id: string; x: number; y: number; subtreeW: number; h: number }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function maxLineLength(text: string | undefined): number {
  if (!text) return 0;
  return text
    .split(/\r?\n/)
    .reduce((max, line) => Math.max(max, line.length), 0);
}

function estimateTreeNodeWidth(node: TreeExprNode, labelMode: TreeLabelMode): number {
  const compact = labelMode === 'compact';
  const labelMax = maxLineLength(node.label);
  const subMax = maxLineLength(node.sublabel);
  const contentChars = clamp(Math.max(labelMax, subMax), compact ? 18 : 24, compact ? 56 : 84);
  const charPx = compact ? 7.1 : 7.6;
  const horizontalPadding = compact ? 30 : 34;
  const estimated = Math.ceil(contentChars * charPx + horizontalPadding);
  if (compact) {
    return clamp(estimated, TREE_NODE_W_COMPACT_MIN, TREE_NODE_W_COMPACT_MAX);
  }
  return clamp(estimated, TREE_NODE_W_FULL_MIN, TREE_NODE_W_FULL_MAX);
}

function getTreeVerticalGap(labelMode: TreeLabelMode): number {
  return labelMode === 'full' ? 132 : 122;
}

function estimateWrappedLines(text: string, charsPerLine: number): number {
  if (!text) return 0;
  const lines = text
    .split(/\r?\n/)
    .map(line => Math.max(1, Math.ceil(line.length / Math.max(8, charsPerLine))));
  return lines.reduce((sum, value) => sum + value, 0);
}

function estimateTreeNodeHeight(node: TreeExprNode, labelMode: TreeLabelMode, width: number): number {
  const compact = labelMode === 'compact';
  const labelCharsPerLine = compact ? Math.floor((width - 24) / 8.2) : Math.floor((width - 24) / 7);
  const subCharsPerLine = compact ? Math.floor((width - 24) / 7.6) : Math.floor((width - 24) / 6.4);
  const labelLines = estimateWrappedLines(node.label, labelCharsPerLine);
  const rawSubLines = node.sublabel ? estimateWrappedLines(node.sublabel, subCharsPerLine) : 0;
  // Compact mode keeps cards tighter while still reserving enough vertical space.
  const subLines = compact ? Math.min(2, rawSubLines) : rawSubLines;
  const hasActions = node.badge !== 'root';

  const head = compact ? 26 : 28;
  const labelBlock = Math.max(1, labelLines) * (compact ? 15 : 16);
  const subBlock = subLines > 0 ? (subLines * (compact ? 13 : 14) + 4) : 0;
  const actionsBlock = hasActions ? (compact ? 36 : 38) : 0;
  const padding = compact ? 20 : 24;

  const estimated = head + labelBlock + subBlock + actionsBlock + padding;
  return compact
    ? Math.max(node.badge === 'root' ? 88 : 112, estimated)
    : estimated;
}

/** Returns the total horizontal span this subtree occupies (used for centering parents). */
function subtreeWidth(node: TreeExprNode, labelMode: TreeLabelMode, nodeWidths: Map<string, number>): number {
  const width = nodeWidths.get(node.id) ?? estimateTreeNodeWidth(node, labelMode);
  if (node.children.length === 0) return width;
  const childrenTotal = node.children.reduce((sum, child) => sum + subtreeWidth(child, labelMode, nodeWidths), 0);
  const gaps = (node.children.length - 1) * TREE_H_GAP;
  return Math.max(width, childrenTotal + gaps);
}

/**
 * Top-down tree layout.
 * @param node  Current tree node
 * @param xLeft Left edge of the horizontal range allocated to this subtree
 * @param y     Top edge for this level
 */
function layoutTree(node: TreeExprNode, labelMode: TreeLabelMode, nodeWidths: Map<string, number>, xLeft = 0, y = 0): LayoutNode[] {
  const width = nodeWidths.get(node.id) ?? estimateTreeNodeWidth(node, labelMode);
  const myH = estimateTreeNodeHeight(node, labelMode, width);
  const sw = subtreeWidth(node, labelMode, nodeWidths);
  const myX = xLeft + (sw - width) / 2;
  const result: LayoutNode[] = [{ id: node.id, x: myX, y, subtreeW: sw, h: myH }];

  if (node.children.length === 0) return result;

  const childSubtreeWidths = node.children.map(child => subtreeWidth(child, labelMode, nodeWidths));
  const childrenSpan = childSubtreeWidths.reduce((sum, value) => sum + value, 0)
    + Math.max(0, node.children.length - 1) * TREE_H_GAP;
  // Keep child group centered under the parent subtree.
  let childX = xLeft + (sw - childrenSpan) / 2;
  const childY = y + myH + getTreeVerticalGap(labelMode);

  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i];
    const childW = childSubtreeWidths[i];
    result.push(...layoutTree(child, labelMode, nodeWidths, childX, childY));
    childX += childW + TREE_H_GAP;
  }

  return result;
}

function flattenTree(node: TreeExprNode, result: TreeExprNode[] = []): TreeExprNode[] {
  result.push(node);
  for (const child of node.children) flattenTree(child, result);
  return result;
}

function collectEdges(node: TreeExprNode, edges: Array<{ source: string; target: string }> = []): Array<{ source: string; target: string }> {
  for (const child of node.children) {
    edges.push({ source: node.id, target: child.id });
    collectEdges(child, edges);
  }
  return edges;
}

// ── ReactFlow custom node ────────────────────────────────────────────────────

const BADGE_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  root:    { bg: 'var(--brand-1)', fg: '#fff', border: 'var(--brand-1)' },
  model:   { bg: 'var(--surface-info-bg)', fg: 'var(--surface-info-fg)', border: 'var(--surface-info-border)' },
  mapping: { bg: 'var(--surface-warning-bg)', fg: 'var(--surface-warning-fg)', border: 'var(--surface-warning-border)' },
  ds:      { bg: 'var(--bg-secondary)', fg: 'var(--text-primary)', border: 'var(--border-color)' },
  table:   { bg: 'var(--surface-success-bg)', fg: 'var(--surface-success-fg)', border: 'var(--surface-success-border)' },
  enum:    { bg: 'var(--surface-warning-bg)', fg: 'var(--surface-warning-fg)', border: 'var(--surface-warning-border)' },
  class:   { bg: 'color-mix(in srgb,var(--accent)15%,transparent)', fg: 'var(--accent)', border: 'color-mix(in srgb,var(--accent)40%,transparent)' },
  calc:    { bg: 'var(--bg-tertiary)', fg: 'var(--text-secondary)', border: 'var(--border-color)' },
  param:   { bg: 'var(--surface-info-bg)', fg: 'var(--surface-info-fg)', border: 'var(--surface-info-border)' },
  groupby: { bg: 'var(--bg-tertiary)', fg: 'var(--text-secondary)', border: 'var(--border-color)' },
  leaf:    { bg: 'var(--surface-success-bg)', fg: 'var(--surface-success-fg)', border: 'var(--surface-success-border)' },
};

function badgeIcon(badge: string): React.ReactNode {
  const s = { fontSize: 14 } as const;
  if (badge === 'root' || badge === 'model') return <CompassNorthwestRegular {...s} />;
  if (badge === 'mapping') return <BranchForkRegular {...s} />;
  if (badge === 'table') return <TableRegular {...s} />;
  if (badge === 'enum') return <TextCaseTitleRegular {...s} />;
  if (badge === 'class') return <SettingsRegular {...s} />;
  if (badge === 'calc') return <CalculatorRegular {...s} />;
  if (badge === 'param') return <TextQuoteRegular {...s} />;
  if (badge === 'groupby') return <ArrowShuffleRegular {...s} />;
  if (badge === 'ds') return <PinRegular {...s} />;
  return <CircleRegular {...s} />;
}

function badgeLabel(badge: string): string {
  const cs: Record<string, string> = { root: 'Výraz', model: 'Model', mapping: 'Mapování', table: 'AX tabulka', enum: 'AX výčet', class: 'AX třída', calc: 'Vypočtené pole', param: 'Parametr uživatele', groupby: 'Seskupení', ds: 'Pole', leaf: 'AX tabulka' };
  const en: Record<string, string> = { root: 'Expression', model: 'Model', mapping: 'Mapping', table: 'AX table', enum: 'AX enum', class: 'AX class', calc: 'Calculated field', param: 'User parameter', groupby: 'Group by', ds: 'Field', leaf: 'AX table' };
  return (locale === 'cs' ? cs : en)[badge] ?? badge;
}

function TreeFlowNode({ data }: { data: {
  node: TreeExprNode;
  onSelect?: (n: TreeExprNode) => void;
  onDrill?: (n: TreeExprNode) => void;
  onCopy?: (n: TreeExprNode) => void;
  onOpenExplorer?: (n: TreeExprNode) => void;
  isSelected?: boolean;
  isInPath?: boolean;
  canOpenExplorer?: boolean;
  labelMode: TreeLabelMode;
} }) {
  const { node, onSelect, onDrill, onCopy, onOpenExplorer, isSelected, isInPath, canOpenExplorer, labelMode } = data;
  const colors = BADGE_COLORS[node.badge] ?? BADGE_COLORS.ds;
  const isLeaf = node.kind === 'leaf';
  const isRoot = node.badge === 'root';
  const canDrill = Boolean(!isLeaf && node.expression && onDrill);
  const canCopy = Boolean(node.expression && onCopy);

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
      <div
        className={`ddt-node ddt-node--${node.badge} ddt-node--${labelMode}${canDrill ? ' ddt-node--clickable' : ''}${isSelected ? ' ddt-node--selected' : ''}${!isSelected && isInPath ? ' ddt-node--path' : ''}`}
        style={{ '--ddt-bg': colors.bg, '--ddt-fg': colors.fg, '--ddt-border': colors.border } as React.CSSProperties}
        onClick={() => onSelect?.(node)}
        title={node.expression ?? node.label}
      >
        <div className="ddt-node__head">
          <span className="ddt-node__icon">{badgeIcon(node.badge)}</span>
          <span className="ddt-node__badge">{badgeLabel(node.badge)}</span>
          {(isRoot || isLeaf) && <span className="ddt-node__pin" />}
        </div>
        <div className="ddt-node__label" title={node.label}>{node.label}</div>
        {node.sublabel && (
          <div className="ddt-node__sub" title={node.sublabel}>{node.sublabel}</div>
        )}
        {!isRoot && (
          <div className="ddt-node__actions" onClick={(event) => event.stopPropagation()}>
            {canDrill && (
              <button type="button" className="ddt-node__action" onClick={() => onDrill?.(node)}>
                {t.drillZoomIn}
              </button>
            )}
            {canCopy && (
              <button type="button" className="ddt-node__action" onClick={() => onCopy?.(node)}>
                {locale === 'cs' ? 'Kopírovat' : 'Copy'}
              </button>
            )}
            {canOpenExplorer && (
              <button type="button" className="ddt-node__action" onClick={() => onOpenExplorer?.(node)}>
                {locale === 'cs' ? 'Explorer' : 'Explorer'}
              </button>
            )}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </>
  );
}

const TREE_NODE_TYPES = { treeNode: TreeFlowNode };

function DrillDownTreeView({ expression, configIndex, configurations, onDrill, includeUnresolvedRefs = false, labelMode = 'full' }: {
  expression: string;
  configIndex: number;
  configurations: any[];
  /** Optional: the tree is an alternative rendering of the same value path, not a navigator. */
  onDrill?: (expr: string, ci: number) => void;
  includeUnresolvedRefs?: boolean;
  labelMode?: TreeLabelMode;
}) {
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const pushToast = useAppStore(s => s.pushToast);
  const flowRef = React.useRef<any>(null);
  const [selectedNodeId, setSelectedNodeId] = useState('root');

  // Build tree data structure
  const rootNode = useMemo<TreeExprNode>(
    () => buildExpressionTree({
      expression, configIndex, configurations,
      resolveModelPath, resolveDatasource, includeUnresolvedRefs,
    }),
    [expression, configIndex, configurations, includeUnresolvedRefs, resolveModelPath, resolveDatasource],
  );

  React.useEffect(() => {
    setSelectedNodeId('root');
  }, [expression, configIndex]);

  const allEdges = useMemo(() => collectEdges(rootNode), [rootNode]);
  const treeNodeCount = useMemo(() => flattenTree(rootNode, []).length, [rootNode]);
  const effectiveLabelMode: TreeLabelMode = labelMode === 'full' && treeNodeCount > AUTO_COMPACT_NODE_THRESHOLD
    ? 'compact'
    : labelMode;

  const parentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const edge of allEdges) {
      map.set(edge.target, edge.source);
    }
    return map;
  }, [allEdges]);

  const highlightedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    let current: string | undefined = selectedNodeId;
    while (current) {
      ids.add(current);
      current = parentById.get(current);
    }
    return ids;
  }, [parentById, selectedNodeId]);

  const highlightedEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    let current: string | undefined = selectedNodeId;
    while (current) {
      const parent = parentById.get(current);
      if (!parent) break;
      ids.add(`${parent}->${current}`);
      current = parent;
    }
    return ids;
  }, [parentById, selectedNodeId]);

  const nodeWidths = useMemo(() => {
    const widthMap = new Map<string, number>();
    const allNodes = flattenTree(rootNode, []);
    for (const node of allNodes) {
      widthMap.set(node.id, estimateTreeNodeWidth(node, effectiveLabelMode));
    }
    return widthMap;
  }, [rootNode, effectiveLabelMode]);

  // Convert tree → ReactFlow nodes + edges
  const { rfNodes, rfEdges } = useMemo(() => {
    const positions = layoutTree(rootNode, effectiveLabelMode, nodeWidths);
    const posMap = new Map(positions.map(p => [p.id, p]));
    const allNodes = flattenTree(rootNode);

    const rfNodes: Node[] = allNodes.map(n => {
      const pos = posMap.get(n.id) ?? { x: 0, y: 0 };
      const nodeConfigIndex = n.configIndex ?? configIndex;
      const datasourceNodeId = findDatasourceNode(n.label, nodeConfigIndex);
      const isSelected = selectedNodeId === n.id;
      const isInPath = highlightedNodeIds.has(n.id);
      return {
        id: n.id,
        type: 'treeNode',
        position: { x: pos.x, y: pos.y },
        className: isSelected
          ? 'ddt-node-wrap--selected'
          : (isInPath ? 'ddt-node-wrap--path' : 'ddt-node-wrap--dim'),
        data: {
          node: n,
          isSelected,
          isInPath,
          canOpenExplorer: Boolean(datasourceNodeId),
          labelMode: effectiveLabelMode,
          onSelect: (treeNode: TreeExprNode) => {
            setSelectedNodeId(treeNode.id);
          },
          onDrill: onDrill
            ? (treeNode: TreeExprNode) => {
                if (treeNode.expression) onDrill(treeNode.expression, treeNode.configIndex ?? configIndex);
              }
            : undefined,
          onCopy: async (treeNode: TreeExprNode) => {
            const value = treeNode.expression;
            if (!value) return;
            try {
              await navigator.clipboard.writeText(value);
              pushToast({
                kind: 'success',
                message: locale === 'cs' ? `Zkopírováno: ${value}` : `Copied: ${value}`,
              });
            } catch {
              pushToast({
                kind: 'warning',
                message: locale === 'cs'
                  ? 'Kopírování se nepodařilo (schránka není dostupná).'
                  : 'Copy failed (clipboard is not available).',
              });
            }
          },
          onOpenExplorer: (treeNode: TreeExprNode) => {
            const cfg = treeNode.configIndex ?? configIndex;
            const id = findDatasourceNode(treeNode.label, cfg);
            if (id) navigateToTreeNode(id);
          },
        },
        style: { width: nodeWidths.get(n.id) ?? estimateTreeNodeWidth(n, effectiveLabelMode), height: 'auto' },
      };
    });

    const rfEdges: Edge[] = allEdges.map((e, i) => ({
      id: `e${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      style: highlightedEdgeIds.has(`${e.source}->${e.target}`)
        ? { stroke: 'var(--accent)', strokeWidth: 2.2, opacity: 0.95 }
        : { stroke: 'var(--border-color)', strokeWidth: 1.3, strokeDasharray: '4,3', opacity: 0.45 },
      markerEnd: {
        type: 'arrowclosed' as any,
        color: highlightedEdgeIds.has(`${e.source}->${e.target}`) ? 'var(--accent)' : 'var(--border-color)',
        width: highlightedEdgeIds.has(`${e.source}->${e.target}`) ? 12 : 10,
        height: highlightedEdgeIds.has(`${e.source}->${e.target}`) ? 12 : 10,
      },
      animated: false,
    }));


    return { rfNodes, rfEdges };
  }, [allEdges, configIndex, effectiveLabelMode, findDatasourceNode, highlightedEdgeIds, highlightedNodeIds, navigateToTreeNode, nodeWidths, onDrill, pushToast, rootNode, selectedNodeId]);

  React.useLayoutEffect(() => {
    if (!flowRef.current) return;
    requestAnimationFrame(() => {
      flowRef.current?.fitView({ padding: 0.2, duration: 220 });
    });
  }, [expression, configIndex, effectiveLabelMode, rfNodes.length, rfEdges.length]);

  return (
    <div className="ddt-canvas">
      {effectiveLabelMode !== labelMode && (
        <div className="ddt-auto-compact-hint">
          {locale === 'cs'
            ? `Auto: kompaktní režim (${treeNodeCount} uzlů)`
            : `Auto: compact mode (${treeNodeCount} nodes)`}
        </div>
      )}
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={TREE_NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onInit={(instance) => {
          flowRef.current = instance;
          instance.fitView({ padding: 0.2 });
        }}
        nodesConnectable={false}
        nodesDraggable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border-color)" gap={20} variant={'dots' as any} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/**
 * Legacy trigger-button variant. Kept for any existing call-sites that want a
 * discrete "Show analysis" button. Prefer `DrillDownTrigger` — wrap the formula
 * text itself so the entire expression becomes the clickable target.
 */
export function DrillDownPanel({ expression, configIndex, elementName }: {
  expression: string;
  configIndex: number;
  elementName?: string;
}) {
  if (!expression?.trim()) return null;
  return (
    <DrillDownTrigger
      expression={expression}
      configIndex={configIndex}
      elementName={elementName}
      className="dd-collapsible__trigger dd-collapsible__trigger--legacy"
    >
      <CompassNorthwestRegular fontSize={14} aria-hidden />
      <span className="dd-collapsible__label">{t.drillCollapsibleLabel}</span>
    </DrillDownTrigger>
  );
}

export function DrillDownBody({ expression, configIndex, elementName, variant = 'inline', onPopOut, onViewModeChange }: {
  expression: string;
  configIndex: number;
  elementName?: string;
  variant?: 'inline' | 'tab' | 'dialog';
  onPopOut?: () => void;
  /** Lets the host (e.g. the dialog) resize itself for the roomier tree view. */
  onViewModeChange?: (mode: 'workbench' | 'tree') => void;
}) {
  const configurations = useAppStore(s => s.configurations);
  const trimmedExpr = expression?.trim() ?? '';
  const DRILLDOWN_VIEW_MODE_KEY = 'er-visualizer.drilldown.viewMode';
  const DRILLDOWN_UNRESOLVED_KEY = 'er-visualizer.drilldown.showUnresolvedRefs';
  const DRILLDOWN_LABEL_MODE_KEY = 'er-visualizer.drilldown.treeLabelMode';

  const [viewMode, setViewMode] = useState<'workbench' | 'tree'>(() => {
    if (typeof window === 'undefined') return 'workbench';
    const persisted = window.localStorage.getItem(DRILLDOWN_VIEW_MODE_KEY);
    return persisted === 'tree' ? 'tree' : 'workbench';
  });
  const [showUnresolvedRefs, setShowUnresolvedRefs] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(DRILLDOWN_UNRESOLVED_KEY) === '1';
  });
  const [treeLabelMode, setTreeLabelMode] = useState<TreeLabelMode>(() => {
    if (typeof window === 'undefined') return 'full';
    const persisted = window.localStorage.getItem(DRILLDOWN_LABEL_MODE_KEY);
    return persisted === 'compact' ? 'compact' : 'full';
  });

  React.useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(DRILLDOWN_VIEW_MODE_KEY, viewMode);
    onViewModeChange?.(viewMode);
  }, [viewMode, onViewModeChange]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DRILLDOWN_UNRESOLVED_KEY, showUnresolvedRefs ? '1' : '0');
  }, [showUnresolvedRefs]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DRILLDOWN_LABEL_MODE_KEY, treeLabelMode);
  }, [treeLabelMode]);

  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);

  const validationContext = useMemo(
    () => getDrillValidationContext(configurations, configIndex, elementName ?? firstSegment(trimmedExpr)),
    [configurations, configIndex, elementName, trimmedExpr],
  );

  if (!trimmedExpr) {
    return (
      <div className="dd-panel dd-panel--empty">
        <div className="dd-empty-state">
          <span className="dd-empty-state__icon" aria-hidden><CompassNorthwestRegular fontSize={22} /></span>
          <div className="dd-empty-state__body">
            <div className="dd-empty-state__title">{t.drillDown}</div>
            <div className="dd-empty-state__text">{t.drillHintEmpty}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`dd-panel ${variant === 'tab' ? 'dd-panel--tab' : ''} ${variant === 'dialog' ? 'dd-panel--dialog' : ''} ${viewMode === 'tree' ? 'dd-panel--tree' : ''}`}>
      <header className="dd-hero">
        <div className="dd-hero__top">
          <span className="dd-hero__badge">
            <span className="dd-hero__badge-icon" aria-hidden><CompassNorthwestRegular fontSize={13} /></span>
            {t.drillDown}
          </span>
          {elementName && <span className="dd-hero__meta">{elementName}</span>}
          <div className="dd-hero__actions">
            {onPopOut && (
              <button
                type="button"
                className="dd-hero__btn dd-hero__btn--ghost"
                onClick={onPopOut}
                title={t.drillPopOut}
                aria-label={t.drillPopOut}
              ><ArrowExpandRegular fontSize={13} /> {t.drillPopOut}</button>
            )}
          </div>

          {/* View-mode tab switcher — pinned to the right */}
          <div className="dd-view-toggle" role="tablist" aria-label={locale === 'cs' ? 'Pohled' : 'View'}>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'workbench'}
              className={`dd-view-toggle__btn${viewMode === 'workbench' ? ' is-active' : ''}`}
              onClick={() => setViewMode('workbench')}
              title={locale === 'cs' ? 'Přehledný detail výrazu' : 'Expression detail'}
            >
              <AppsListDetailRegular fontSize={14} />
              <span className="dd-view-toggle__label">{locale === 'cs' ? 'Detail' : 'Detail'}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'tree'}
              className={`dd-view-toggle__btn${viewMode === 'tree' ? ' is-active' : ''}`}
              onClick={() => setViewMode('tree')}
              title={locale === 'cs' ? 'Stromová vizualizace' : 'Tree view'}
            >
              <FlowRegular fontSize={14} />
              <span className="dd-view-toggle__label">{locale === 'cs' ? 'Strom' : 'Tree'}</span>
            </button>
          </div>
          {viewMode === 'tree' && showTechnicalDetails && (
            <>
              <div
                className="dd-tree-label-toggle"
                role="tablist"
                aria-label={locale === 'cs' ? 'Režim popisků uzlů' : 'Node label mode'}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={treeLabelMode === 'compact'}
                  className={`dd-tree-label-toggle__btn${treeLabelMode === 'compact' ? ' is-active' : ''}`}
                  onClick={() => setTreeLabelMode('compact')}
                  title={locale === 'cs' ? 'Kompaktní režim popisků' : 'Compact label mode'}
                >
                  {locale === 'cs' ? 'Kompaktní' : 'Compact'}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={treeLabelMode === 'full'}
                  className={`dd-tree-label-toggle__btn${treeLabelMode === 'full' ? ' is-active' : ''}`}
                  onClick={() => setTreeLabelMode('full')}
                  title={locale === 'cs' ? 'Plný režim popisků' : 'Full label mode'}
                >
                  {locale === 'cs' ? 'Plný' : 'Full'}
                </button>
              </div>
              <button
                type="button"
                className={`dd-tree-debug-toggle${showUnresolvedRefs ? ' is-active' : ''}`}
                onClick={() => setShowUnresolvedRefs(v => !v)}
                aria-pressed={showUnresolvedRefs}
                title={locale === 'cs' ? 'Zobrazit nevyřešené reference' : 'Show unresolved references'}
              >
                {locale === 'cs' ? 'Nevyřešené' : 'Unresolved'}
              </button>
            </>
          )}
        </div>

        {validationContext && validationContext.rules.length > 0 && (
          <section className="dd-validation-summary" aria-label={locale === 'cs' ? 'Detaily validace' : 'Validation details'}>
            <div className="dd-validation-summary__head">
              <span className="dd-validation-summary__title">
                {locale === 'cs' ? 'Detaily validace' : 'Validation details'}
              </span>
              <span className="dd-validation-summary__meta">
                {validationContext.path} • {validationContext.rules.length} {locale === 'cs' ? 'pravidel' : 'rules'}
              </span>
            </div>
            <div className="dd-validation-summary__list">
              {validationContext.rules.map((rule, index) => (
                <div key={rule.id ?? `${validationContext.path}-${index}`} className="dd-validation-summary__rule">
                  <div className="dd-validation-summary__rule-head">
                    <span className="dd-validation-summary__rule-index">#{index + 1}</span>
                    {rule.actionLabel && (
                      <span className="dd-validation-summary__rule-action">{rule.actionLabel}</span>
                    )}
                  </div>
                  {rule.conditionExpressionAsString && (
                    <div className="dd-validation-summary__expr-row">
                      <span className="dd-validation-summary__expr-label">{locale === 'cs' ? 'Podmínka' : 'Condition'}</span>
                      <ExpressionView expr={rule.conditionExpressionAsString} configIndex={configIndex} />
                    </div>
                  )}
                  {rule.messageExpressionAsString && (
                    <div className="dd-validation-summary__expr-row">
                      <span className="dd-validation-summary__expr-label">{locale === 'cs' ? 'Zpráva' : 'Message'}</span>
                      <ExpressionView expr={rule.messageExpressionAsString} configIndex={configIndex} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </header>

      {viewMode === 'tree' ? (
        <DrillDownTreeView
          expression={trimmedExpr}
          configIndex={configIndex}
          configurations={configurations}
          includeUnresolvedRefs={showUnresolvedRefs}
          labelMode={treeLabelMode}
        />
      ) : (
        <div className="dd-frame-content">
          <DrillDownLineageView
            expression={trimmedExpr}
            configIndex={configIndex}
            configurations={configurations}
            elementName={elementName}
          />
        </div>
      )}
    </div>
  );
}
