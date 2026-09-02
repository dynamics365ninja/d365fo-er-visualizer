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
import React, { useMemo, useState, useRef } from 'react';
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
  ArrowClockwiseRegular,
  ArrowLeftRegular,
  ArrowExpandRegular,
  DismissRegular,
  CircleRegular,
  FlowRegular,
  AppsListDetailRegular,
} from '@fluentui/react-icons';
import { useAppStore, resolveDeepExpression } from '../state/store';
import { locale, t } from '../i18n';
import { formatEnumDisplayName } from '../utils/enum-display';
import { resolveLabel, buildLabelPool, labelDisplayText } from '../utils/label-resolver';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Frame {
  label: string;           // breadcrumb label
  expression: string;      // expression being resolved
  configIndex: number;     // config index to resolve from
  mappingExpression?: string | null;
  mappingConfigIndex?: number | null;
  mappingConfigName?: string | null;
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
    table: 'Tabulka',
    enum: 'Výčet',
    class: 'Třída',
    calc: 'Výpočet',
    container: 'Kontejner',
    groupby: 'Seskupení',
    join: 'Spojení',
    object: 'Objekt',
    userparameter: 'Uživatelský parametr',
    importformat: 'Importní formát',
    unknown: 'Neznámé',
  };
  const en: Record<string, string> = {
    table: 'Table',
    enum: 'Enum',
    class: 'Class',
    calc: 'Calculation',
    container: 'Container',
    groupby: 'Group by',
    join: 'Join',
    object: 'Object',
    userparameter: 'User parameter',
    importformat: 'Import format',
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
  onPush: (f: Frame) => void;
  /**
   * Optional expression string representing the current drill frame. Tokens
   * whose click target would produce this exact expression are rendered
   * non-interactively (no hover, no click) to prevent pointless self-pushes
   * from the "Analyzuji výraz" hero — where the whole expression is a single
   * DS token that otherwise keeps appending identical breadcrumbs.
   */
  currentFrameExpression?: string;
}

function ExpressionView({ expr, configIndex, onPush, currentFrameExpression }: ExpressionViewProps) {
  const tokens = useMemo(() => tokenizeERExpr(prettifyERExpr(expr)), [expr]);
  const configurations = useAppStore(s => s.configurations);
  const labels = useMemo(() => buildLabelPool(configurations, configIndex), [configurations, configIndex]);

  const buildSegmentExpression = (segments: string[], upto: number): string => (
    segments
      .slice(0, upto)
      .map(formatSegmentForExpression)
      .join('.')
  );

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
          const label = tok.raw.replace(/'/g, '');
          return (
            <span key={idx} className="er-token-ds-path" title={tok.raw}>
              {tok.segments.map((segment, segmentIdx) => {
                const expression = buildSegmentExpression(tok.segments!, segmentIdx + 1);
                const isSelf = currentFrameExpression !== undefined && expression === currentFrameExpression;
                return (
                  <React.Fragment key={`${idx}-${segmentIdx}`}>
                    {segmentIdx > 0 && <span className="er-token-ds-dot">.</span>}
                    <span
                      className={`er-token-ds-segment${isSelf ? ' er-token-ds-segment--self' : ''}`}
                      title={isSelf ? undefined : `→ ${expression}`}
                      onClick={isSelf ? undefined : () => onPush({ label, expression, configIndex })}
                    >
                      {formatSegmentForDisplay(segment)}
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

// Workbench-style frame view: expression parts on the left, details on the right.
function DrillDownRebuiltView({ frame, onPush, configurations }: FrameViewProps) {
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);

  const [selectedId, setSelectedId] = useState('root');
  const treeItemRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const treeListRef = React.useRef<HTMLDivElement | null>(null);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(420);

  const TREE_ITEM_ESTIMATED_HEIGHT = 50;
  const TREE_OVERSCAN = 8;

  React.useEffect(() => {
    setSelectedId('root');
  }, [frame.expression, frame.configIndex]);

  /**
   * The whole resolution chain, not just the segments of the expression text:
   * model path → mapping formula → datasource → nested calculated fields → entity.
   * Listing only the text segments hid every formula behind the first hop.
   */
  const treeNodes = useMemo(
    () => buildWorkbenchParts({
      expression: frame.expression,
      label: frame.label,
      configIndex: frame.configIndex,
      configurations,
      resolveModelPath,
      resolveDatasource,
    }),
    [configurations, frame.configIndex, frame.expression, frame.label, resolveDatasource, resolveModelPath],
  );

  const selected = useMemo(
    () => treeNodes.find(n => n.id === selectedId) ?? treeNodes[0],
    [treeNodes, selectedId],
  );

  const selectByExpression = React.useCallback((expression: string) => {
    const match = treeNodes.find(n => n.expression === expression);
    if (match) setSelectedId(match.id);
  }, [treeNodes]);

  React.useEffect(() => {
    const active = selected ? treeItemRefs.current[selected.id] : null;
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  React.useLayoutEffect(() => {
    const el = treeListRef.current;
    if (!el) return;

    const update = () => setListViewportHeight(el.clientHeight);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  if (!selected) {
    return null;
  }

  const selectedIsModel = selected.expression.toLowerCase().startsWith('model.') || selected.expression.toLowerCase().startsWith('model\\');
  const cleanSelectedExpr = selectedIsModel ? extractModelPath(selected.expression) : selected.expression;

  // Some format bindings are rendered without explicit "model." prefix (e.g. Invoice.InvoiceBase...).
  // Keep model-path resolution enabled for these so intermediate sub-expressions still resolve.
  const modelResult = resolveModelPath(cleanSelectedExpr);
  const shouldUseModelBinding = selectedIsModel || Boolean(modelResult);
  const mappingExpr = modelResult?.binding?.expressionAsString ?? frame.mappingExpression ?? null;
  const mappingCi = modelResult?.bindingConfigIndex ?? frame.mappingConfigIndex ?? selected.configIndex;
  const mappingConfig = modelResult
    ? configurations[mappingCi]?.solutionVersion?.solution?.name
    : (frame.mappingConfigName ?? (mappingExpr ? configurations[mappingCi]?.solutionVersion?.solution?.name : null));

  const buildContextualFrame = React.useCallback((nextFrame: Frame): Frame => ({
    ...nextFrame,
    mappingExpression: mappingExpr,
    mappingConfigIndex: mappingExpr ? mappingCi : null,
    mappingConfigName: mappingExpr ? mappingConfig : null,
  }), [mappingCi, mappingConfig, mappingExpr]);

  const pushWithContext = React.useCallback((nextFrame: Frame) => {
    onPush(buildContextualFrame(nextFrame));
  }, [buildContextualFrame, onPush]);

  const selectedIndex = Math.max(0, treeNodes.findIndex(n => n.id === selected.id));

  const ensureTreeIndexVisible = React.useCallback((index: number) => {
    const listEl = treeListRef.current;
    if (!listEl) return;

    const itemTop = index * TREE_ITEM_ESTIMATED_HEIGHT;
    const itemBottom = itemTop + TREE_ITEM_ESTIMATED_HEIGHT;
    const viewTop = listEl.scrollTop;
    const viewBottom = viewTop + listEl.clientHeight;

    if (itemTop < viewTop) {
      listEl.scrollTop = itemTop;
      return;
    }
    if (itemBottom > viewBottom) {
      listEl.scrollTop = itemBottom - listEl.clientHeight;
    }
  }, []);

  const onTreeListKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (treeNodes.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = Math.min(treeNodes.length - 1, selectedIndex + 1);
      setSelectedId(treeNodes[nextIndex].id);
      ensureTreeIndexVisible(nextIndex);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = Math.max(0, selectedIndex - 1);
      setSelectedId(treeNodes[nextIndex].id);
      ensureTreeIndexVisible(nextIndex);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setSelectedId(treeNodes[0].id);
      ensureTreeIndexVisible(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const lastIndex = treeNodes.length - 1;
      setSelectedId(treeNodes[lastIndex].id);
      ensureTreeIndexVisible(lastIndex);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      pushWithContext({
        label: selected.label,
        expression: selected.expression,
        configIndex: selected.configIndex,
      });
    }
  }, [ensureTreeIndexVisible, pushWithContext, selected.configIndex, selected.expression, selected.label, selectedIndex, treeNodes]);

  const pushMappingToDatasource = React.useCallback((nextFrame: Frame) => {
    const deep = resolveDeepExpression(nextFrame.expression, configurations, nextFrame.configIndex);
    const resolvedDs = (deep?.nestedDs ?? deep?.rootDs)
      ?? resolveDatasource(firstSegment(nextFrame.expression), nextFrame.configIndex)?.datasource
      ?? null;

    if (!resolvedDs) {
      pushWithContext(nextFrame);
      return;
    }

    const resolvedExpression = deep?.pathSegments?.length
      ? deep.pathSegments.map(formatSegmentForExpression).join('.')
      : nextFrame.expression;

    pushWithContext({
      ...nextFrame,
      label: resolvedDs.name ?? nextFrame.label,
      expression: resolvedExpression,
      configIndex: deep?.rootDsConfigIndex ?? nextFrame.configIndex,
    });
  }, [configurations, pushWithContext, resolveDatasource]);

  // Resolve datasource details from the currently selected expression.
  // Mapping expression is shown as context, but must not override selection.
  const { effectiveExpr, effectiveCi } = getDrillDownEffectiveResolutionInput({
    selectedExpression: selected.expression,
    selectedIsModel: shouldUseModelBinding,
    frameConfigIndex: selected.configIndex,
    modelBindingExpression: modelResult?.binding?.expressionAsString,
    modelBindingConfigIndex: modelResult?.bindingConfigIndex,
  });
  const deepResult = resolveDeepExpression(effectiveExpr, configurations, effectiveCi);
  // Resolve the *whole* selected path, not just its first segment: for
  // "Parameters.'$ReferenceNumber'" the first segment is only the container,
  // which is why such expressions reported "Data source: Container" and never
  // showed the user parameter behind them.
  const directResult = !shouldUseModelBinding ? resolveDatasource(selected.expression, selected.configIndex) : null;
  const resolvedDs = (deepResult?.nestedDs ?? deepResult?.rootDs)
    ?? modelResult?.datasource
    ?? directResult?.datasource
    ?? null;
  const resolvedDsConfigIndex = deepResult?.rootDsConfigIndex
    ?? modelResult?.datasourceConfigIndex
    ?? directResult?.configIndex
    ?? effectiveCi;
  const labelPool = buildLabelPool(configurations, resolvedDsConfigIndex);

  const normalizeExpr = (value: string) => value.replace(/\s+/g, '').toLowerCase();
  const showMappingExpression = Boolean(mappingExpr && normalizeExpr(mappingExpr) !== normalizeExpr(selected.expression));

  // The trailing segments of the path are fields on the entity, not datasources,
  // so without them the panel showed the table but never which column it reads.
  const resolvedFieldPath = deepResult?.fieldPath?.join('.') ?? '';
  const resolvedEntityName = resolvedDs?.tableInfo?.tableName
    ?? (resolvedDs?.enumInfo ? formatEnumDisplayName(resolvedDs.enumInfo.enumName, resolvedDs.enumInfo) : null)
    ?? resolvedDs?.classInfo?.className
    ?? null;
  const targetName = resolvedEntityName && resolvedFieldPath
    ? `${resolvedEntityName}.${resolvedFieldPath}`
    : resolvedEntityName;
  const targetIsDistinct = Boolean(
    targetName
    && (!resolvedDs?.name || normalizeExpr(String(targetName)) !== normalizeExpr(String(resolvedDs.name)))
  );

  const selectedPathSegments = useMemo(() => {
    const firstDsToken = tokenizeERExpr(selected.expression).find(
      (tok): tok is ERToken & { kind: 'ds'; segments: string[] } => tok.kind === 'ds' && Array.isArray(tok.segments) && tok.segments.length > 0,
    );
    if (firstDsToken) {
      return firstDsToken.segments.map((segment, idx) => ({
        label: formatSegmentForDisplay(segment),
        expression: firstDsToken.segments.slice(0, idx + 1).map(formatSegmentForExpression).join('.'),
      }));
    }
    return [{ label: selected.label, expression: selected.expression }];
  }, [selected.expression, selected.label]);

  /**
   * A selection that is more than a bare path — a function call, comparison,
   * boolean expression or label reference. The left column truncates it to one
   * line and the breadcrumb only covers paths, so without this the full text of
   * the very expression being drilled was nowhere on screen.
   */
  const showFullExpression = shouldShowFullExpression(selected.expression);

  /**
   * Model references used by a *compound* expression (the root `IF(...)`, a
   * function call, a comparison …). Such an expression is not itself a model
   * path, so `resolveModelPath` finds nothing for it and the panel used to show
   * no mapping at all — even though every path inside it is mapped. List them
   * so the mapping formulas are one click away from the root, which is where
   * the drill-down opens.
   */
  const referencedModelBindings = useMemo(() => {
    // Only for compound selections: a resolvable path renders its own card.
    if (modelResult) return [];

    const seen = new Set<string>();
    const out: Array<{
      expression: string;
      label: string;
      mappingExpression: string;
      mappingConfigIndex: number;
      mappingConfigName: string | null;
    }> = [];

    for (const tok of tokenizeERExpr(selected.expression)) {
      if (tok.kind !== 'ds' || !tok.segments || tok.segments.length === 0) continue;
      // Longest form first: the leaf is what carries the binding.
      for (let len = tok.segments.length; len >= 1; len--) {
        const segs = tok.segments.slice(0, len);
        const expression = segs.map(formatSegmentForExpression).join('.');
        if (seen.has(expression)) break;
        const resolved = resolveModelPath(expression);
        if (!resolved?.binding?.expressionAsString) continue;
        seen.add(expression);
        out.push({
          expression,
          label: segs.map(formatSegmentForDisplay).join('.'),
          mappingExpression: resolved.binding.expressionAsString,
          mappingConfigIndex: resolved.bindingConfigIndex,
          mappingConfigName:
            configurations[resolved.bindingConfigIndex]?.solutionVersion?.solution?.name ?? null,
        });
        break;
      }
    }
    return out;
  }, [modelResult, selected.expression, resolveModelPath, configurations]);

  const datasourceDefinitionEntries = useMemo(() => {
    if (!resolvedDs) return [] as Array<{ key: string; label: string; expression: string; kind: 'calc' | 'user-param' | 'groupby' }>;

    const entries: Array<{ key: string; label: string; expression: string; kind: 'calc' | 'user-param' | 'groupby' }> = [];

    const calcExpr = resolvedDs?.calculatedField?.expressionAsString?.trim();
    if (calcExpr) {
      entries.push({
        key: 'calc-formula',
        label: t.drillStepFormulaTitle,
        expression: calcExpr,
        kind: 'calc',
      });
    }

    const userParamExpr = resolvedDs?.userParamInfo?.expressionAsString?.trim();
    if (userParamExpr) {
      entries.push({
        key: 'user-param-expression',
        label: t.drillStepUserParameterTitle,
        expression: userParamExpr,
        kind: 'user-param',
      });
    }

    const groupByListExpr = resolvedDs?.groupByInfo?.listToGroup?.trim();
    if (groupByListExpr) {
      entries.push({
        key: 'groupby-list',
        label: t.drillStepGroupedListTitle,
        expression: groupByListExpr,
        kind: 'groupby',
      });
    }

    if (Array.isArray(resolvedDs?.groupByInfo?.aggregations)) {
      for (const agg of resolvedDs.groupByInfo.aggregations) {
        const aggExpr = String(agg?.path ?? '').trim();
        if (!aggExpr) continue;
        const aggName = String(agg?.name ?? '').trim() || t.propValue;
        entries.push({
          key: `groupby-agg-${agg?.name ?? aggExpr}`,
          label: t.drillStepAggregationTitle(aggName),
          expression: aggExpr,
          kind: 'groupby',
        });
      }
    }

    return entries;
  }, [locale, resolvedDs]);

  const virtualWindow = useMemo(() => {
    const visibleCount = Math.ceil(Math.max(1, listViewportHeight) / TREE_ITEM_ESTIMATED_HEIGHT);
    const start = Math.max(0, Math.floor(listScrollTop / TREE_ITEM_ESTIMATED_HEIGHT) - TREE_OVERSCAN);
    const end = Math.min(treeNodes.length, start + visibleCount + TREE_OVERSCAN * 2);
    const items = treeNodes.slice(start, end);
    return {
      start,
      end,
      items,
      topSpacer: start * TREE_ITEM_ESTIMATED_HEIGHT,
      bottomSpacer: (treeNodes.length - end) * TREE_ITEM_ESTIMATED_HEIGHT,
    };
  }, [listScrollTop, listViewportHeight, treeNodes]);

  return (
    <div className="dd-workbench">
      <div className="dd-workbench__split">
        <aside className="dd-workbench__tree" aria-label={locale === 'cs' ? 'Strom výrazu' : 'Expression tree'}>
          <div className="dd-workbench__panel-head">{locale === 'cs' ? 'Části výrazu' : 'Expression parts'}</div>
          <div
            className="dd-workbench__tree-list"
            ref={treeListRef}
            tabIndex={0}
            onScroll={(event) => setListScrollTop(event.currentTarget.scrollTop)}
            onKeyDown={onTreeListKeyDown}
          >
            {virtualWindow.topSpacer > 0 && (
              <div className="dd-workbench__tree-spacer" style={{ height: `${virtualWindow.topSpacer}px` }} aria-hidden />
            )}
            {virtualWindow.items.map(node => (
              <button
                key={node.id}
                type="button"
                className={`dd-workbench__tree-item${selected.id === node.id ? ' is-active' : ''}`}
                data-depth={node.depth}
                onClick={() => setSelectedId(node.id)}
                ref={(el) => {
                  treeItemRefs.current[node.id] = el;
                }}
                style={{
                  paddingLeft: `${12 + node.depth * 18}px`,
                  ['--dd-tree-depth' as string]: node.depth,
                }}
                title={node.detail ? `${node.expression}\n\n${node.detail}` : node.expression}
              >
                <span className="dd-workbench__tree-label">
                  <span className={`badge badge-${node.badge}`}>{badgeLabel(node.badge)}</span>
                  {node.label}
                </span>
                <span className="dd-workbench__tree-expr">{node.detail ?? node.expression}</span>
              </button>
            ))}
            {virtualWindow.bottomSpacer > 0 && (
              <div className="dd-workbench__tree-spacer" style={{ height: `${virtualWindow.bottomSpacer}px` }} aria-hidden />
            )}
          </div>
        </aside>

        <section className="dd-workbench__detail">
          <div className="dd-workbench__panel-head">{locale === 'cs' ? 'Naplnění vybrané části' : 'Selected part resolution'}</div>

          <div className="dd-workbench__detail-block">
            <div className="dd-workbench__detail-label">{locale === 'cs' ? 'Aktuální větev' : 'Current branch'}</div>
            <div className="dd-workbench__breadcrumb">
              {selectedPathSegments.map((segment, idx) => (
                <React.Fragment key={`${segment.expression}-${idx}`}>
                  {idx > 0 && <span className="dd-workbench__breadcrumb-sep" aria-hidden>›</span>}
                  <button
                    type="button"
                    className={`dd-workbench__breadcrumb-segment${selected.expression === segment.expression ? ' is-active' : ''}`}
                    onClick={() => selectByExpression(segment.expression)}
                    title={segment.expression}
                  >
                    {segment.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>

          {(showMappingExpression && mappingExpr || resolvedDs || referencedModelBindings.length > 0 || showFullExpression) && (
            <div className="dd-workbench__detail-grid">
              {showFullExpression && (
                <div className="dd-workbench__detail-card">
                  <div className="dd-workbench__detail-card-head">
                    <span>{locale === 'cs' ? 'Výraz' : 'Expression'}</span>
                    <span className="dd-workbench__card-meta">{selected.label}</span>
                  </div>
                  <ExpressionView
                    expr={selected.expression}
                    configIndex={selected.configIndex}
                    onPush={pushWithContext}
                    currentFrameExpression={selected.expression}
                  />
                </div>
              )}

              {referencedModelBindings.length > 0 && (
                <div className="dd-workbench__detail-card">
                  <div className="dd-workbench__detail-card-head">
                    <span>{locale === 'cs' ? 'Mapování použitých cest' : 'Mapping of referenced paths'}</span>
                    <span className="dd-workbench__card-meta">{referencedModelBindings.length}</span>
                  </div>
                  {referencedModelBindings.map(ref => (
                    <div key={ref.expression} className="dd-ds-formula">
                      <div className="dd-ds-formula__label">
                        <button
                          type="button"
                          className="dd-workbench__ref-path"
                          onClick={() => selectByExpression(ref.expression)}
                          title={locale === 'cs' ? 'Vybrat tuto část výrazu' : 'Select this expression part'}
                        >
                          {ref.label}
                        </button>
                        {ref.mappingConfigName && (
                          <span className="dd-workbench__card-meta">{ref.mappingConfigName}</span>
                        )}
                      </div>
                      <ExpressionView
                        expr={ref.mappingExpression}
                        configIndex={ref.mappingConfigIndex}
                        onPush={pushWithContext}
                        currentFrameExpression={selected.expression}
                      />
                    </div>
                  ))}
                </div>
              )}

              {showMappingExpression && mappingExpr && (
                <div className="dd-workbench__detail-card">
                  <div className="dd-workbench__detail-card-head">
                    <span>{locale === 'cs' ? 'Mapování' : 'Mapping'}</span>
                    {mappingConfig && <span className="dd-workbench__card-meta">{mappingConfig}</span>}
                  </div>
                  <ExpressionView expr={mappingExpr} configIndex={mappingCi} onPush={pushMappingToDatasource} currentFrameExpression={selected.expression} />
                </div>
              )}

              {resolvedDs && (
                <div className="dd-workbench__detail-card">
                  <div className="dd-workbench__detail-card-head">
                    <span>{locale === 'cs' ? 'Datový zdroj' : 'Data source'}</span>
                    <span className={`badge badge-${dsTypeBadge(resolvedDs)}`}>{localizeDatasourceType(resolvedDs)}</span>
                  </div>
                  <div className="dd-workbench__summary">
                    <div className="dd-workbench__summary-row"><span>{t.propName}</span><strong>{resolvedDs.name}</strong></div>
                    {targetIsDistinct && targetName && <div className="dd-workbench__summary-row"><span>{locale === 'cs' ? 'Cíl' : 'Target'}</span><strong>{targetName}</strong></div>}
                    {typeof resolvedDs.label === 'string' && resolvedDs.label && (
                      <div className="dd-workbench__summary-row">
                        <span>{t.propLabel}</span>
                        <strong title={resolvedDs.label}>{labelDisplayText(resolvedDs.label, labelPool) ?? resolvedDs.label}</strong>
                      </div>
                    )}
                    {/* A user parameter has no formula behind it — its data type and
                        label are the whole answer to "where does this come from". */}
                    {resolvedDs.userParamInfo?.extendedDataTypeName && (
                      <div className="dd-workbench__summary-row"><span>{t.propEdt}</span><strong>{resolvedDs.userParamInfo.extendedDataTypeName}</strong></div>
                    )}
                    {resolvedDs.type === 'UserParameter' && (
                      <div className="dd-workbench__summary-note">
                        {locale === 'cs'
                          ? 'Hodnotu zadává uživatel při spuštění reportu — nepochází z modelu ani z tabulky.'
                          : 'Filled in by the user when the report runs — it comes from neither the model nor a table.'}
                      </div>
                    )}
                  </div>
                  {datasourceDefinitionEntries.map((entry) => (
                    <div key={entry.key} className="dd-ds-formula">
                      <div className="dd-ds-formula__label">
                        {entry.kind === 'calc' && <CalculatorRegular fontSize={13} aria-hidden />}
                        {entry.kind === 'user-param' && <TextQuoteRegular fontSize={13} aria-hidden />}
                        {entry.kind === 'groupby' && <ArrowShuffleRegular fontSize={13} aria-hidden />}
                        {entry.label}
                      </div>
                      <ExpressionView
                        expr={entry.expression}
                        configIndex={resolvedDsConfigIndex}
                        onPush={pushWithContext}
                        currentFrameExpression={selected.expression}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
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
          style={{
            width: 'min(99vw, 99dvw)',
            maxWidth: 'min(99vw, 99dvw)',
            height: 'min(99vh, 99dvh)',
            maxHeight: 'min(99vh, 99dvh)',
          }}
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
      return {
        id, kind: 'ref', label: cleanPath.split(/[.\\]/).pop() ?? cleanPath,
        sublabel: cleanPath, badge: 'model', expression, configIndex, children: [],
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
 * Full breakdown of one expression: model path → mapping formula → datasource →
 * nested calculated fields → concrete table / enum / class. Exported for tests.
 */
export function buildExpressionTree(options: {
  expression: string;
  configIndex: number;
  configurations: any[];
  resolveModelPath: (p: string) => any;
  resolveDatasource: (n: string, ci: number) => any;
  includeUnresolvedRefs?: boolean;
}): TreeExprNode {
  const {
    expression, configIndex, configurations,
    resolveModelPath, resolveDatasource, includeUnresolvedRefs = false,
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
  const cs: Record<string, string> = { root: 'Výraz', model: 'Model', mapping: 'Mapování', table: 'Tabulka', enum: 'Výčet', class: 'Třída', calc: 'Výpočet', param: 'Parametr', groupby: 'Seskupení', ds: 'DS', leaf: 'Entita' };
  const en: Record<string, string> = { root: 'Expression', model: 'Model', mapping: 'Mapping', table: 'Table', enum: 'Enum', class: 'Class', calc: 'Calculation', param: 'Parameter', groupby: 'Group by', ds: 'DS', leaf: 'Entity' };
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
                {t.drillDown}
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
  onDrill: (expr: string, ci: number) => void;
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
          onDrill: (treeNode: TreeExprNode) => {
            if (treeNode.expression) onDrill(treeNode.expression, treeNode.configIndex ?? configIndex);
          },
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

export function DrillDownBody({ expression, configIndex, elementName, variant = 'inline', onPopOut }: {
  expression: string;
  configIndex: number;
  elementName?: string;
  variant?: 'inline' | 'tab' | 'dialog';
  onPopOut?: () => void;
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
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DRILLDOWN_VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DRILLDOWN_UNRESOLVED_KEY, showUnresolvedRefs ? '1' : '0');
  }, [showUnresolvedRefs]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DRILLDOWN_LABEL_MODE_KEY, treeLabelMode);
  }, [treeLabelMode]);

  const initialFrame = (): Frame => ({
    label: elementName ?? (trimmedExpr.split(/[.(]/)[0] || '?'),
    expression: trimmedExpr,
    configIndex,
  });

  const [stack, setStack] = useState<Frame[]>([initialFrame()]);

  const currentFrame = stack[stack.length - 1];

  const validationContext = useMemo(
    () => getDrillValidationContext(configurations, currentFrame.configIndex, currentFrame.label),
    [configurations, currentFrame.configIndex, currentFrame.label],
  );

  const push = (frame: Frame) => setStack(s => {
    // Skip pushing a frame that is identical to the current top. This happens
    // when the user clicks the "Analyzuji výraz" expression in the hero — the
    // whole expression is itself a DS token, so a click would just keep
    // appending the same breadcrumb.
    const top = s[s.length - 1];
    if (top
      && top.expression === frame.expression
      && top.configIndex === frame.configIndex
      && top.label === frame.label) {
      return s;
    }
    return [...s, {
      ...top,
      ...frame,
      mappingExpression: frame.mappingExpression ?? top?.mappingExpression ?? null,
      mappingConfigIndex: frame.mappingConfigIndex ?? top?.mappingConfigIndex ?? null,
      mappingConfigName: frame.mappingConfigName ?? top?.mappingConfigName ?? null,
    }];
  });
  const jumpTo = (index: number) => setStack(s => s.slice(0, index + 1));
  const restart = () => setStack([initialFrame()]);

  React.useEffect(() => {
    setStack([initialFrame()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedExpr, configIndex, elementName]);

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

  const atRoot = stack.length === 1;

  return (
    <div className={`dd-panel ${variant === 'tab' ? 'dd-panel--tab' : ''} ${variant === 'dialog' ? 'dd-panel--dialog' : ''}`}>
      <header className="dd-hero">
        <div className="dd-hero__top">
          <span className="dd-hero__badge">
            <span className="dd-hero__badge-icon" aria-hidden><CompassNorthwestRegular fontSize={13} /></span>
            {t.drillDown}
          </span>
          <span className="dd-hero__meta">{t.drillSteps(stack.length)}</span>
          <div className="dd-hero__actions">
            {!atRoot && (
              <button
                type="button"
                className="dd-hero__btn"
                onClick={() => setStack(s => s.slice(0, -1))}
                title={t.back}
              ><ArrowLeftRegular fontSize={13} /> {t.back}</button>
            )}
            {!atRoot && (
              <button
                type="button"
                className="dd-hero__btn dd-hero__btn--ghost"
                onClick={restart}
                title={t.drillRestart}
              ><ArrowClockwiseRegular fontSize={13} /> {t.drillRestart}</button>
            )}
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
              title={locale === 'cs' ? 'Pracovní plocha' : 'Workbench'}
            >
              <AppsListDetailRegular fontSize={14} />
              <span className="dd-view-toggle__label">{locale === 'cs' ? 'Plocha' : 'Workbench'}</span>
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
          {viewMode === 'tree' && (
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

        {stack.length > 1 && (
          <nav className="dd-hero__crumbs" aria-label={locale === 'cs' ? 'Drobečková navigace' : 'Breadcrumb'}>
            {stack.map((f, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="dd-hero__crumb-sep" aria-hidden>›</span>}
                <button
                  type="button"
                  className={`dd-hero__crumb${i === stack.length - 1 ? ' is-active' : ''}`}
                  onClick={() => i < stack.length - 1 && jumpTo(i)}
                  disabled={i === stack.length - 1}
                  title={f.expression}
                >
                  {f.label}
                </button>
              </React.Fragment>
            ))}
          </nav>
        )}

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
                      <ExpressionView expr={rule.conditionExpressionAsString} configIndex={currentFrame.configIndex} onPush={push} currentFrameExpression={currentFrame.expression} />
                    </div>
                  )}
                  {rule.messageExpressionAsString && (
                    <div className="dd-validation-summary__expr-row">
                      <span className="dd-validation-summary__expr-label">{locale === 'cs' ? 'Zpráva' : 'Message'}</span>
                      <ExpressionView expr={rule.messageExpressionAsString} configIndex={currentFrame.configIndex} onPush={push} currentFrameExpression={currentFrame.expression} />
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
          expression={currentFrame.expression}
          configIndex={currentFrame.configIndex}
          configurations={configurations}
          includeUnresolvedRefs={showUnresolvedRefs}
          labelMode={treeLabelMode}
          onDrill={(expr, ci) => push({
            label: expr.split(/[.(]/)[0] || expr,
            expression: expr,
            configIndex: ci,
          })}
        />
      ) : (
        <div className="dd-frame-content">
          <DrillDownRebuiltView
            frame={currentFrame}
            onPush={push}
            configurations={configurations}
          />
        </div>
      )}
    </div>
  );
}
