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
import React, { useMemo, useState, useCallback, useLayoutEffect, useRef } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
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
  BoxRegular,
  LinkRegular,
  DataBarVerticalRegular,
  LocationRegular,
  TextQuoteRegular,
  ArrowShuffleRegular,
  DocumentTextRegular,
  WarningRegular,
  PinRegular,
  TagRegular,
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
import { formatEnumDisplayName, getEnumTypeLabel, getEnumSourceKind } from '../utils/enum-display';
import { resolveLabel } from '../utils/label-resolver';

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

function DsTypeIcon({ ds }: { ds: any }) {
  const common = { fontSize: 14 } as const;
  if (ds.tableInfo)       return <TableRegular {...common} />;
  if (ds.enumInfo) {
    const kind = getEnumSourceKind(ds.enumInfo);
    if (kind === 'DataModel') return <DocumentTextRegular {...common} />;
    if (kind === 'Format')    return <TagRegular {...common} />;
    return <TextCaseTitleRegular {...common} />;
  }
  if (ds.classInfo)       return <SettingsRegular {...common} />;
  if (ds.calculatedField) return <CalculatorRegular {...common} />;
  if (ds.type === 'Container') return <BoxRegular {...common} />;
  if (ds.type === 'Join')      return <LinkRegular {...common} />;
  if (ds.type === 'GroupBy')   return <DataBarVerticalRegular {...common} />;
  return <PinRegular {...common} />;
}

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

function stripModel(expr: string): string {
  let e = expr;
  if (e.toLowerCase().startsWith('model.'))  e = e.slice(6);
  if (e.toLowerCase().startsWith('model\\')) e = e.slice(6);
  return e;
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
  'GETENUMVALUEBYNAME','GUIDVALUE','NUMSEQVALUE','BASE64STRINGTOCONTAINER',
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

function formatSegmentForExpression(segment: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(segment)) return segment;
  return `'${segment.replace(/'/g, "\\'")}'`;
}

function formatSegmentForDisplay(segment: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(segment)) return segment;
  return `'${segment}'`;
}

const ER_KEYWORDS = new Set(['true', 'false', 'null', 'empty', 'asc', 'desc']);

function tokenizeERExpr(expr: string): ERToken[] {
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
  const labels = useAppStore(s => s.configurations[configIndex]?.solutionVersion?.solution?.labels);

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

interface ExpressionPathTreeProps {
  expr: string;
  configIndex: number;
  onPush: (f: Frame) => void;
  currentFrameExpression?: string;
  showHeader?: boolean;
}

function ExpressionPathTree({ expr, configIndex, onPush, currentFrameExpression, showHeader = true }: ExpressionPathTreeProps) {
  const configurations = useAppStore(s => s.configurations);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);

  const branches = useMemo(() => {
    const dsTokens = tokenizeERExpr(expr)
      .filter((tok): tok is ERToken & { kind: 'ds'; segments: string[] } => tok.kind === 'ds' && Array.isArray(tok.segments) && tok.segments.length > 0);

    return dsTokens.map((tok, tokenIdx) => {
      const nodes = tok.segments.map((segment, segmentIdx) => {
        const expression = tok.segments
          .slice(0, segmentIdx + 1)
          .map(formatSegmentForExpression)
          .join('.');

        const deep = resolveDeepExpression(expression, configurations, configIndex);
        const resolvedDs = (deep?.nestedDs ?? deep?.rootDs)
          ?? resolveDatasource(firstSegment(expression), configIndex)?.datasource
          ?? null;

        const target = resolvedDs?.tableInfo?.tableName
          ?? (resolvedDs?.enumInfo ? formatEnumDisplayName(resolvedDs.enumInfo.enumName, resolvedDs.enumInfo) : undefined)
          ?? resolvedDs?.classInfo?.className
          ?? resolvedDs?.name
          ?? null;

        return {
          segment,
          expression,
          badge: resolvedDs ? dsTypeBadge(resolvedDs) : 'unknown',
          target,
        };
      });

      return {
        key: `${tokenIdx}-${tok.raw}`,
        source: tok.raw,
        nodes,
      };
    });
  }, [expr, configurations, configIndex, resolveDatasource]);

  return (
    <aside className="dd-path-tree" aria-label={locale === 'cs' ? 'Rozpad výrazu' : 'Expression decomposition'}>
      {showHeader && (
        <div className="dd-path-tree__head">
          {locale === 'cs' ? 'Rozpad výrazu' : 'Expression decomposition'}
        </div>
      )}
      {branches.length === 0 && (
        <div className="dd-path-tree__empty">
          {locale === 'cs'
            ? 'Ve výrazu nebyla rozpoznána datová cesta.'
            : 'No datasource path was detected in this expression.'}
        </div>
      )}
      {branches.map((branch, branchIdx) => (
        <div key={branch.key} className="dd-path-tree__branch">
          <div className="dd-path-tree__source-head">
            <div className="dd-path-tree__source-label">
              {locale === 'cs' ? `Datová cesta ${branchIdx + 1}` : `Data path ${branchIdx + 1}`}
            </div>
            <div className="dd-path-tree__source-count">
              {branch.nodes.length} {locale === 'cs' ? 'kroků' : 'steps'}
            </div>
          </div>
          <div className="dd-path-tree__source" title={branch.source}>
            {branch.source}
          </div>
          <ol className="dd-path-tree__list">
            {branch.nodes.map((node, nodeIdx) => {
              const isCurrent = currentFrameExpression === node.expression;
              return (
                <li key={`${branch.key}-${nodeIdx}`} className="dd-path-tree__item">
                  <button
                    type="button"
                    className={`dd-path-tree__node${isCurrent ? ' is-active' : ''}`}
                    onClick={() => !isCurrent && onPush({ label: node.segment, expression: node.expression, configIndex })}
                    disabled={isCurrent}
                    title={node.expression}
                  >
                    <span className="dd-path-tree__node-index">{nodeIdx + 1}</span>
                    <span className="dd-path-tree__node-name">{formatSegmentForDisplay(node.segment)}</span>
                    <span className={`badge badge-${node.badge} dd-path-tree__node-badge`}>{localizeBadgeLabel(node.badge)}</span>
                  </button>
                  {node.target && <div className="dd-path-tree__target">{node.target}</div>}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </aside>
  );
}

// ─── Frame content ────────────────────────────────────────────────────────────

interface FrameViewProps {
  frame: Frame;
  onPush: (newFrame: Frame) => void;
  configurations: any[];
}

interface WizardFrameViewProps {
  frame: Frame;
  onPush: (newFrame: Frame) => void;
  configurations: any[];
}

function WizardFrameView({ frame, onPush, configurations }: WizardFrameViewProps) {
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedExpr, setSelectedExpr] = useState(frame.expression);

  React.useEffect(() => {
    setStep(1);
    setSelectedExpr(frame.expression);
  }, [frame.expression, frame.configIndex]);

  const options = useMemo(() => {
    const unique = new Map<string, { expression: string; label: string }>();
    const tokens = tokenizeERExpr(frame.expression);
    for (const tok of tokens) {
      if (tok.kind !== 'ds' || !tok.segments || tok.segments.length === 0) continue;
      for (let i = 0; i < tok.segments.length; i++) {
        const expression = tok.segments.slice(0, i + 1).map(formatSegmentForExpression).join('.');
        const label = formatSegmentForDisplay(tok.segments[i]);
        if (!unique.has(expression)) unique.set(expression, { expression, label });
      }
    }
    if (!unique.has(frame.expression)) {
      unique.set(frame.expression, { expression: frame.expression, label: frame.label });
    }
    return Array.from(unique.values());
  }, [frame.expression, frame.label]);

  const selected = useMemo(
    () => options.find(o => o.expression === selectedExpr) ?? { expression: frame.expression, label: frame.label },
    [options, selectedExpr, frame.expression, frame.label],
  );

  const isModel = selected.expression.toLowerCase().startsWith('model.') || selected.expression.toLowerCase().startsWith('model\\');
  const cleanModelExpr = isModel ? extractModelPath(selected.expression) : selected.expression;
  const modelResult = isModel ? resolveModelPath(cleanModelExpr) : null;
  const effectiveExpr = modelResult?.binding?.expressionAsString ?? selected.expression;
  const effectiveCi = modelResult?.bindingConfigIndex ?? frame.configIndex;
  const deepResult = resolveDeepExpression(effectiveExpr, configurations, effectiveCi);
  const directResult = !isModel ? resolveDatasource(firstSegment(selected.expression), frame.configIndex) : null;
  const resolvedDs = (deepResult?.nestedDs ?? deepResult?.rootDs) ?? modelResult?.datasource ?? directResult?.datasource ?? null;
  const sourceNameNorm = String(resolvedDs?.name ?? '').trim().toLowerCase();
  const tableName = resolvedDs?.tableInfo?.tableName ?? null;
  const enumName = resolvedDs?.enumInfo
    ? formatEnumDisplayName(resolvedDs.enumInfo.enumName, resolvedDs.enumInfo)
    : null;
  const className = resolvedDs?.classInfo?.className ?? null;
  const showTableRow = Boolean(tableName && String(tableName).trim().toLowerCase() !== sourceNameNorm);
  const showEnumRow = Boolean(enumName && String(enumName).trim().toLowerCase() !== sourceNameNorm);
  const showClassRow = Boolean(className && String(className).trim().toLowerCase() !== sourceNameNorm);
  const calcFormula = resolvedDs?.calculatedField?.expressionAsString ?? null;
  const requestedPathNorm = stripModel(cleanModelExpr).replace(/[\\/]/g, '.').toLowerCase();
  const resolvedPathNorm = String(modelResult?.modelPath ?? '').replace(/[\\/]/g, '.').toLowerCase();
  const usedModelPathFallback = Boolean(isModel && modelResult && requestedPathNorm && resolvedPathNorm && requestedPathNorm !== resolvedPathNorm);

  const deps = useMemo(() => {
    const tables = deepResult?.involvedDatasources.filter((d: any) => d.tableName) ?? [];
    const enums = deepResult?.involvedDatasources.filter((d: any) => d.enumName) ?? [];
    const classes = deepResult?.involvedDatasources.filter((d: any) => d.className) ?? [];
    const calcs = deepResult?.calculatedFieldChain ?? [];
    return { tables, enums, classes, calcs };
  }, [deepResult]);

  const nextStep = () => {
    if (step === 1) return setStep(2);
    if (step === 2) return setStep(calcFormula ? 3 : 4);
    if (step === 3) return setStep(4);
  };

  const prevStep = () => {
    if (step === 4) return setStep(calcFormula ? 3 : 2);
    if (step === 3) return setStep(2);
    if (step === 2) return setStep(1);
  };

  return (
    <div className="dd-wizard">
      <div className="dd-wizard__steps" role="tablist" aria-label={locale === 'cs' ? 'Kroky průvodce' : 'Wizard steps'}>
        {[1, 2, 3, 4].map((s) => (
          <button
            key={s}
            type="button"
            className={`dd-wizard__step${step === s ? ' is-active' : ''}`}
            onClick={() => {
              if (s === 3 && !calcFormula) return;
              setStep(s as 1 | 2 | 3 | 4);
            }}
            disabled={s === 3 && !calcFormula}
            role="tab"
            aria-selected={step === s}
          >
            <span className="dd-wizard__step-num">{s}</span>
            <span>
              {s === 1 && (locale === 'cs' ? 'Vyber část' : 'Pick segment')}
              {s === 2 && (locale === 'cs' ? 'Najdi zdroj' : 'Find source')}
              {s === 3 && (locale === 'cs' ? 'Rozpad výpočtu' : 'Calculation breakdown')}
              {s === 4 && (locale === 'cs' ? 'Vlivy hodnoty' : 'Value influences')}
            </span>
          </button>
        ))}
      </div>

      <div className="dd-wizard__page">
        {step === 1 && (
          <div className="dd-wizard__block">
            <div className="dd-wizard__title">{locale === 'cs' ? 'Klikni na část výrazu, kterou chceš vysvětlit.' : 'Click the expression part you want to explain.'}</div>
            <div className="dd-wizard__options">
              {options.map((o) => (
                <button
                  key={o.expression}
                  type="button"
                  className={`dd-wizard__option${selected.expression === o.expression ? ' is-active' : ''}`}
                  onClick={() => {
                    setSelectedExpr(o.expression);
                    setStep(2);
                  }}
                  title={o.expression}
                >
                  <span className="dd-wizard__option-label">{o.label}</span>
                  <span className="dd-wizard__option-expr">{o.expression}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="dd-wizard__block">
            <div className="dd-wizard__title">{locale === 'cs' ? 'Zdroj vybrané části' : 'Source of the selected part'}</div>
            {usedModelPathFallback && (
              <div className="dd-wizard__note">
                {locale === 'cs'
                  ? `Část ${stripModel(cleanModelExpr)} není mapovaná přímo, použita byla nejbližší cesta ${modelResult?.modelPath}.`
                  : `The segment ${stripModel(cleanModelExpr)} is not mapped directly. The nearest mapped path ${modelResult?.modelPath} was used.`}
              </div>
            )}
            {!resolvedDs && <div className="dd-wizard__empty">{locale === 'cs' ? 'Zdroj se nepodařilo dohledat.' : 'Source could not be resolved.'}</div>}
            {resolvedDs && (
              <div className="dd-wizard__card">
                <div className="dd-wizard__row"><strong>{locale === 'cs' ? 'Část výrazu:' : 'Expression part:'}</strong> {selected.label}</div>
                <div className="dd-wizard__row"><strong>{locale === 'cs' ? 'Typ:' : 'Type:'}</strong> {localizeDatasourceType(resolvedDs)}</div>
                <div className="dd-wizard__row"><strong>{locale === 'cs' ? 'Název zdroje:' : 'Source name:'}</strong> {resolvedDs.name}</div>
                {showTableRow && <div className="dd-wizard__row"><strong>{locale === 'cs' ? 'Tabulka:' : 'Table:'}</strong> {tableName}</div>}
                {showEnumRow && <div className="dd-wizard__row"><strong>{locale === 'cs' ? 'Výčet:' : 'Enum:'}</strong> {enumName}</div>}
                {showClassRow && <div className="dd-wizard__row"><strong>{locale === 'cs' ? 'Třída:' : 'Class:'}</strong> {className}</div>}
                <button
                  type="button"
                  className="dd-wizard__jump"
                  onClick={() => onPush({ label: selected.label, expression: selected.expression, configIndex: frame.configIndex })}
                >
                  {locale === 'cs' ? 'Otevřít detail této části' : 'Open detailed view for this part'}
                </button>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="dd-wizard__block">
            <div className="dd-wizard__title">{locale === 'cs' ? 'Jak se hodnota počítá' : 'How the value is calculated'}</div>
            {!calcFormula && <div className="dd-wizard__empty">{locale === 'cs' ? 'Vybraná část není výpočet.' : 'The selected part is not a calculation.'}</div>}
            {calcFormula && <ExpressionView expr={calcFormula} configIndex={effectiveCi} onPush={onPush} />}
          </div>
        )}

        {step === 4 && (
          <div className="dd-wizard__block">
            <div className="dd-wizard__title">{locale === 'cs' ? 'Co ještě tuto hodnotu ovlivňuje' : 'What else influences this value'}</div>
            <div className="dd-wizard__deps">
              {deps.calcs.length > 0 && <div className="dd-wizard__dep-item">{locale === 'cs' ? 'Výpočty' : 'Calculations'}: {deps.calcs.length}</div>}
              {deps.tables.length > 0 && <div className="dd-wizard__dep-item">{locale === 'cs' ? 'Tabulky' : 'Tables'}: {deps.tables.length}</div>}
              {deps.enums.length > 0 && <div className="dd-wizard__dep-item">{locale === 'cs' ? 'Enumy' : 'Enums'}: {deps.enums.length}</div>}
              {deps.classes.length > 0 && <div className="dd-wizard__dep-item">{locale === 'cs' ? 'Třídy' : 'Classes'}: {deps.classes.length}</div>}
              {deps.calcs.length === 0 && deps.tables.length === 0 && deps.enums.length === 0 && deps.classes.length === 0 && (
                <div className="dd-wizard__empty">{locale === 'cs' ? 'Další vlivy nebyly nalezeny.' : 'No additional influences were found.'}</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="dd-wizard__nav">
        <button type="button" className="dd-hero__btn dd-hero__btn--ghost" onClick={prevStep} disabled={step === 1}>{t.back}</button>
        <button type="button" className="dd-hero__btn" onClick={nextStep} disabled={step === 4}>{locale === 'cs' ? 'Další krok' : 'Next step'}</button>
      </div>
    </div>
  );
}

function FrameView({ frame, onPush, configurations }: FrameViewProps) {
  const resolveModelPath  = useAppStore(s => s.resolveModelPath);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);

  const expr    = frame.expression;
  const ci      = frame.configIndex;
  const isModel = expr.toLowerCase().startsWith('model.') || expr.toLowerCase().startsWith('model\\');

  const hasModelMapping = useMemo(
    () => configurations.some(c => c.content.kind === 'ModelMapping' || (c.content.kind === 'Format' && c.content.embeddedModelMappingVersions.length > 0)),
    [configurations]
  );

  // Extract clean path for model resolution (strips operators like "<> """)
  const cleanModelExpr = isModel ? extractModelPath(expr) : expr;

  // ── Resolve model reference ──────────────────────────────────────────────
  const modelResult = useMemo(
    () => (isModel ? resolveModelPath(cleanModelExpr) : null),
    [isModel, cleanModelExpr, resolveModelPath]
  );

  // ── Resolve direct datasource reference ─────────────────────────────────
  const dsName       = firstSegment(expr);
  const directResult = useMemo(
    () => (!isModel && dsName ? resolveDatasource(dsName, ci) : null),
    [isModel, dsName, ci, resolveDatasource]
  );

  // ── Deep resolution of final expression ─────────────────────────────────
  const effectiveExpr = modelResult?.binding?.expressionAsString ?? expr;
  const effectiveCi   = modelResult?.bindingConfigIndex           ?? ci;
  const deepResult    = useMemo(
    () => resolveDeepExpression(effectiveExpr, configurations, effectiveCi),
    [effectiveExpr, effectiveCi, configurations]
  );

  // ── Collect all mapping paths in loaded ModelMappings (for diagnostics) ──
  const mappingPaths = useMemo(() => {
    if (!isModel || !hasModelMapping) return null;
    const out: { configName: string; paths: string[]; total: number }[] = [];
    for (const cfg of configurations) {
      if (cfg.content.kind === 'ModelMapping') {
        const bindings = cfg.content.version.mapping.bindings as any[];
        out.push({
          configName: cfg.solutionVersion.solution.name,
          total: bindings.length,
          paths: bindings.slice(0, 15).map((b: any) => b.path),
        });
      }
      if (cfg.content.kind === 'Format') {
        for (const version of cfg.content.embeddedModelMappingVersions) {
          out.push({
            configName: `${cfg.solutionVersion.solution.name} • ${version.mapping.name}`,
            total: version.mapping.bindings.length,
            paths: version.mapping.bindings.slice(0, 15).map((b: any) => b.path),
          });
        }
      }
    }
    return out;
  }, [isModel, hasModelMapping, configurations]);

  // ─────────────────────────────────────────────────────────────────────────
  // Case A: model.* but no ModelMapping loaded
  // ─────────────────────────────────────────────────────────────────────────
  if (isModel && !hasModelMapping) {
    return (
      <div className="dd-hint dd-hint-info">
        <span className="dd-hint__icon" aria-hidden><DocumentTextRegular fontSize={16} /></span>
        <div className="dd-hint__body">
          <div className="dd-hint__text">{t.drillNoModelMapping}</div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case B: model.* + ModelMapping loaded but path not found
  // ─────────────────────────────────────────────────────────────────────────
  if (isModel && hasModelMapping && !modelResult) {
    return (
      <div className="dd-hint dd-hint-warn">
        <span className="dd-hint__icon" aria-hidden><WarningRegular fontSize={16} /></span>
        <div className="dd-hint__body">
          {cleanModelExpr !== expr && (
            <div className="dd-unres-expr dd-gap-bottom">
              <span className="dd-unres-text">{expr}</span>
            </div>
          )}
          <div className="dd-hint__text dd-gap-bottom">{t.drillPathNotFound(stripModel(cleanModelExpr))}</div>
          {mappingPaths && mappingPaths.length > 0 && (
            <div className="dd-hint__suggest">
              <div className="dd-hint__suggest-title">{t.drillActualPaths}</div>
              {mappingPaths.map((mp, i) => (
                <div key={i} className="dd-debug-block">
                  <div className="dd-debug-title">
                    {mp.configName} — {mp.total}{mp.total > 15 ? ` (${t.drillMore(mp.total - 15)})` : ''}:
                  </div>
                  {mp.paths.map((p, j) => (
                    <button
                      key={j}
                      type="button"
                      className="dd-debug-path"
                      onClick={() => onPush({ label: p, expression: 'model.' + p.replace(/\\/g, '.'), configIndex: ci })}
                      title={`${t.drillDown}: ${p}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case C: resolved (model → mapping, or direct DS)
  // ─────────────────────────────────────────────────────────────────────────
  // Prefer the leaf DS (deepest resolved node) so that clicking e.g.
  // '001_System'.'$TaxJuristictionUIP' shows the calculated field directly.
  const resolvedDs    = (deepResult?.nestedDs ?? deepResult?.rootDs)
                     ?? modelResult?.datasource
                     ?? directResult?.datasource
                     ?? null;
  const mappingExpr   = modelResult?.binding?.expressionAsString ?? null;
  const mappingCi     = modelResult?.bindingConfigIndex ?? ci;
  const mappingConfig = modelResult ? configurations[mappingCi]?.solutionVersion?.solution?.name : null;

  const mappingRootName = mappingExpr ? firstSegment(mappingExpr) : '';
  const mappingRootResult = mappingRootName ? resolveDatasource(mappingRootName, mappingCi) : null;
  const deepRoot = deepResult?.rootDs ?? null;
  const mappingRoot = mappingRootResult?.datasource ?? null;
  const deepRootKey = deepRoot ? `${deepRoot.parentPath ?? ''}/${deepRoot.name}` : null;
  const mappingRootKey = mappingRoot ? `${mappingRoot.parentPath ?? ''}/${mappingRoot.name}` : null;
  const hasMappingMismatch = Boolean(
    mappingExpr
    && mappingRoot
    && deepRoot
    && mappingRootKey !== deepRootKey,
  );
  const hasUnresolvedMappingChain = Boolean(mappingExpr && !deepRoot);
  const requestedPathNorm = stripModel(cleanModelExpr).replace(/[\\/]/g, '.').toLowerCase();
  const resolvedPathNorm = String(modelResult?.modelPath ?? '').replace(/[\\/]/g, '.').toLowerCase();
  const usedModelPathFallback = Boolean(isModel && modelResult && requestedPathNorm && resolvedPathNorm && requestedPathNorm !== resolvedPathNorm);
  const normalizeExpr = (value: string) => value.replace(/\s+/g, '').toLowerCase();
  const showMappingStep = Boolean(
    mappingExpr
    && normalizeExpr(mappingExpr) !== normalizeExpr(expr),
  );

  if (!resolvedDs && !mappingExpr) {
    // Expression is genuinely empty — no binding assigned
    if (!expr.trim()) {
      return (
        <div className="dd-hint dd-hint-muted">
          <span className="dd-hint__icon" aria-hidden><CircleRegular fontSize={16} /></span>
          <div className="dd-hint__body">
            <div className="dd-hint__text">{t.drillUnbound}</div>
          </div>
        </div>
      );
    }

    const kind = classifyExpr(expr);
    if (kind === 'current-record') {
      return (
        <div className="dd-hint dd-hint-info">
          <span className="dd-hint__icon" aria-hidden><LocationRegular fontSize={16} /></span>
          <div className="dd-hint__body">
            <div className="dd-hint__title">{t.drillLabelExpression}</div>
            <div className="dd-unres-expr">
              <span className="dd-unres-label">@.</span>
              <span className="dd-unres-text">{expr.slice(expr.indexOf('.') + 1)}</span>
            </div>
            <div className="dd-hint__text">{t.drillCurrentRecord}</div>
          </div>
        </div>
      );
    }
    if (kind === 'constant') {
      return (
        <div className="dd-hint dd-hint-info">
          <span className="dd-hint__icon" aria-hidden><TextQuoteRegular fontSize={16} /></span>
          <div className="dd-hint__body">
            <div className="dd-unres-expr"><span className="dd-unres-text">{expr}</span></div>
            <div className="dd-hint__text">{t.drillConstant}</div>
          </div>
        </div>
      );
    }
    // er-function, compound — render with interactive tokenised expression
    if (kind === 'er-function' || kind === 'compound') {
      return (
        <div className="dd-hint dd-hint-info">
          <span className="dd-hint__icon" aria-hidden><ArrowShuffleRegular fontSize={16} /></span>
          <div className="dd-hint__body">
            <ExpressionView expr={expr} configIndex={ci} onPush={onPush} />
          </div>
        </div>
      );
    }
    // Unknown — unresolvable plain name
    return (
      <div className="dd-hint dd-hint-warn">
        <span className="dd-hint__icon" aria-hidden><WarningRegular fontSize={16} /></span>
        <div className="dd-hint__body">
          <div className="dd-unres-expr"><span className="dd-unres-text">{expr}</span></div>
          <div className="dd-hint__text">{t.drillDsNotFound(firstSegment(expr) || expr)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dd-frame-body">
      {usedModelPathFallback && (
        <div className="dd-hint dd-hint-info dd-layout-full">
          <span className="dd-hint__icon" aria-hidden><BranchForkRegular fontSize={16} /></span>
          <div className="dd-hint__body">
            <div className="dd-hint__title">{locale === 'cs' ? 'Nepřímé mapování uzlu' : 'Indirect node mapping'}</div>
            <div className="dd-hint__text">
              {locale === 'cs'
                ? `Uzlu ${stripModel(cleanModelExpr)} nebyl nalezen přímý binding. Použit byl nejbližší mapovaný potomek ${modelResult?.modelPath}.`
                : `No direct binding was found for ${stripModel(cleanModelExpr)}. The nearest mapped descendant ${modelResult?.modelPath} was used.`}
            </div>
          </div>
        </div>
      )}

      <div className="dd-results-head dd-layout-full">
        <div className="dd-results-head__title">
          {locale === 'cs' ? 'Výsledek rozkladu mapování' : 'Mapping decomposition result'}
        </div>
        <div className="dd-results-head__meta">
          {locale === 'cs' ? 'Klikni na krok pro detailní rozpad.' : 'Click any step to continue drilling down.'}
        </div>
      </div>

      {(hasMappingMismatch || hasUnresolvedMappingChain) && (
        <div className="dd-hint dd-hint-warn dd-layout-full">
          <span className="dd-hint__icon" aria-hidden><WarningRegular fontSize={16} /></span>
          <div className="dd-hint__body">
            <div className="dd-hint__title">
              {locale === 'cs' ? 'Kontrola mapování' : 'Mapping check'}
            </div>
            <div className="dd-hint__text">
              {hasMappingMismatch
                ? (locale === 'cs'
                  ? 'Výraz z mapování ukazuje na jiný kořenový zdroj, než který byl rozpoznán při drill-down analýze.'
                  : 'The mapping expression points to a different root datasource than the one resolved by drill-down analysis.')
                : (locale === 'cs'
                  ? 'Výraz z mapování nebyl přeložen na konkrétní řetězec datových zdrojů. Zkontrolujte, že názvy segmentů v mapování existují.'
                  : 'The mapping expression could not be resolved into a concrete datasource chain. Verify that mapping segment names exist.')} 
            </div>
            {mappingExpr && <ExpressionView expr={mappingExpr} configIndex={mappingCi} onPush={onPush} />}
          </div>
        </div>
      )}

      {/* ── Step 1: model path → mapping expression (interactive) ── */}
      {showMappingStep && mappingExpr && (
        <section className="dd-step dd-step--mapping dd-layout-left">
          <header className="dd-step__head">
            <span className="dd-step__num" aria-hidden>1</span>
            <span className="dd-step__icon" aria-hidden><BranchForkRegular fontSize={14} /></span>
            <span className="dd-step__title">{t.drillStepMappingTitle}</span>
            {mappingConfig && <span className="dd-step__config" title={mappingConfig}>{mappingConfig}</span>}
          </header>
          <div className="dd-step__body">
            <ExpressionView expr={mappingExpr} configIndex={mappingCi} onPush={onPush} />
          </div>
        </section>
      )}

      {/* ── Step 2: datasource card ── */}
      {resolvedDs && (
        <DatasourceCard
          ds={resolvedDs}
          configIndex={effectiveCi}
          onPush={onPush}
          stepNumber={showMappingStep ? 2 : 1}
        />
      )}

      {/* ── Step 3: deep deps ── */}
      {deepResult && (deepResult.involvedDatasources.length > 0 || deepResult.calculatedFieldChain.length > 0) && (
        <DepChain
          deepResult={deepResult}
          onPush={onPush}
          fromCi={effectiveCi}
          stepNumber={(showMappingStep ? 2 : 1) + (resolvedDs ? 1 : 0)}
        />
      )}
    </div>
  );
}

// Keep legacy views reachable for future re-use and migration.
const keepLegacyDrillDownViews = [ExpressionPathTree, WizardFrameView, FrameView, DatasourceCard];
void keepLegacyDrillDownViews;

function DrillDownRebuiltView({ frame, onPush, configurations }: FrameViewProps) {
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);

  const [selectedExpr, setSelectedExpr] = useState(frame.expression);
  const treeItemRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  React.useEffect(() => {
    setSelectedExpr(frame.expression);
  }, [frame.expression, frame.configIndex]);

  const treeNodes = useMemo(() => {
    const unique = new Map<string, { expression: string; label: string; depth: number }>();
    unique.set(frame.expression, { expression: frame.expression, label: frame.label, depth: 0 });

    const tokens = tokenizeERExpr(frame.expression);
    for (const tok of tokens) {
      if (tok.kind !== 'ds' || !tok.segments || tok.segments.length === 0) continue;
      for (let i = 0; i < tok.segments.length; i++) {
        const expression = tok.segments.slice(0, i + 1).map(formatSegmentForExpression).join('.');
        if (unique.has(expression)) continue;
        unique.set(expression, {
          expression,
          label: formatSegmentForDisplay(tok.segments[i]),
          depth: i + 1,
        });
      }
    }

    return Array.from(unique.values());
  }, [frame.expression, frame.label]);

  const selected = useMemo(
    () => treeNodes.find(n => n.expression === selectedExpr) ?? treeNodes[0],
    [treeNodes, selectedExpr],
  );

  React.useEffect(() => {
    const active = selected ? treeItemRefs.current[selected.expression] : null;
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  if (!selected) {
    return null;
  }

  const selectedIsModel = selected.expression.toLowerCase().startsWith('model.') || selected.expression.toLowerCase().startsWith('model\\');
  const cleanSelectedExpr = selectedIsModel ? extractModelPath(selected.expression) : selected.expression;

  const modelResult = selectedIsModel ? resolveModelPath(cleanSelectedExpr) : null;
  const mappingExpr = modelResult?.binding?.expressionAsString ?? frame.mappingExpression ?? null;
  const mappingCi = modelResult?.bindingConfigIndex ?? frame.mappingConfigIndex ?? frame.configIndex;
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
    selectedIsModel,
    frameConfigIndex: frame.configIndex,
    modelBindingExpression: modelResult?.binding?.expressionAsString,
    modelBindingConfigIndex: modelResult?.bindingConfigIndex,
  });
  const deepResult = resolveDeepExpression(effectiveExpr, configurations, effectiveCi);
  const directResult = !selectedIsModel ? resolveDatasource(firstSegment(selected.expression), frame.configIndex) : null;
  const resolvedDs = (deepResult?.nestedDs ?? deepResult?.rootDs)
    ?? modelResult?.datasource
    ?? directResult?.datasource
    ?? null;
  const resolvedDsConfigIndex = deepResult?.rootDsConfigIndex
    ?? modelResult?.datasourceConfigIndex
    ?? directResult?.configIndex
    ?? effectiveCi;

  const normalizeExpr = (value: string) => value.replace(/\s+/g, '').toLowerCase();
  const showMappingExpression = Boolean(mappingExpr && normalizeExpr(mappingExpr) !== normalizeExpr(selected.expression));

  const targetName = resolvedDs?.tableInfo?.tableName
    ?? (resolvedDs?.enumInfo ? formatEnumDisplayName(resolvedDs.enumInfo.enumName, resolvedDs.enumInfo) : null)
    ?? resolvedDs?.classInfo?.className
    ?? null;
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

  return (
    <div className="dd-workbench">
      <div className="dd-workbench__split">
        <aside className="dd-workbench__tree" aria-label={locale === 'cs' ? 'Strom výrazu' : 'Expression tree'}>
          <div className="dd-workbench__panel-head">{locale === 'cs' ? 'Části výrazu' : 'Expression parts'}</div>
          <div className="dd-workbench__tree-list">
            {treeNodes.map(node => (
              <button
                key={node.expression}
                type="button"
                className={`dd-workbench__tree-item${selected.expression === node.expression ? ' is-active' : ''}`}
                data-depth={node.depth}
                onClick={() => setSelectedExpr(node.expression)}
                ref={(el) => {
                  treeItemRefs.current[node.expression] = el;
                }}
                style={{
                  paddingLeft: `${12 + node.depth * 18}px`,
                  ['--dd-tree-depth' as string]: node.depth,
                }}
                title={node.expression}
              >
                <span className="dd-workbench__tree-label">{node.label}</span>
                <span className="dd-workbench__tree-expr">{node.expression}</span>
              </button>
            ))}
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
                    onClick={() => setSelectedExpr(segment.expression)}
                    title={segment.expression}
                  >
                    {segment.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>

          {(showMappingExpression && mappingExpr || resolvedDs) && (
            <div className="dd-workbench__detail-grid">
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
                    <div className="dd-workbench__summary-row"><span>{locale === 'cs' ? 'Typ' : 'Type'}</span><strong>{localizeDatasourceType(resolvedDs)}</strong></div>
                    {targetIsDistinct && targetName && <div className="dd-workbench__summary-row"><span>{locale === 'cs' ? 'Cíl' : 'Target'}</span><strong>{targetName}</strong></div>}
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

// ─── Datasource Card ─────────────────────────────────────────────────────────

function DatasourceCard({ ds, configIndex, onPush, stepNumber }: {
  ds: any;
  configIndex: number;
  onPush: (f: Frame) => void;
  stepNumber?: number;
}) {
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const badge = dsTypeBadge(ds);
  const datasourceNodeId = findDatasourceNode(ds.name, configIndex, ds.parentPath);

  const concreteTarget =
    ds.tableInfo?.tableName  ? { kind: 'table',  name: ds.tableInfo.tableName }  :
    ds.enumInfo?.enumName    ? { kind: 'enum',   name: formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo) }    :
    ds.classInfo?.className  ? { kind: 'class',  name: ds.classInfo.className }  :
    null;

  return (
    <section className="dd-step dd-ds-card dd-layout-left">
      <header className="dd-step__head">
        {stepNumber !== undefined && <span className="dd-step__num" aria-hidden>{stepNumber}</span>}
        <span className="dd-step__icon" aria-hidden><DsTypeIcon ds={ds} /></span>
        <span className="dd-step__title">{t.drillStepDatasourceTitle}</span>
        <span className={`badge badge-${badge} dd-step__type`}>{localizeDatasourceType(ds)}</span>
      </header>

      <div className="dd-ds-card__identity">
        <span className="dd-ds-card__name-label">{t.propName}</span>
        <span className="dd-ds-card__name">{ds.name}</span>
        {datasourceNodeId && (
          <button
            className="dd-action-btn"
            onClick={() => navigateToTreeNode(datasourceNodeId)}
            title={t.openInExplorerAction}
          >
            {t.drillOpenExplorerFull}
          </button>
        )}
      </div>

      {/* Concrete target */}
      {concreteTarget && (
        <div className="dd-ds-target">
          <span className="dd-ds-target__label">{
            concreteTarget.kind === 'table' ? t.drillLabelTable :
            concreteTarget.kind === 'enum'  ? t.drillLabelEnum  :
            t.drillLabelClass
          }</span>
          <span className="dd-ds-target__arrow" aria-hidden>→</span>
          <span className={`dd-target-name badge badge-${concreteTarget.kind}`}>
            {concreteTarget.name}
          </span>
          {ds.tableInfo?.isCrossCompany && (
            <span className="dd-tag">{locale === 'cs' ? 'napříč společnostmi' : 'cross-company'}</span>
          )}
          {ds.enumInfo && (
            <span className="dd-tag">{getEnumTypeLabel(ds.enumInfo)}</span>
          )}
        </div>
      )}

      {/* Calculated field — show formula with interactive drill-down tokens */}
      {ds.calculatedField?.expressionAsString && (
        <div className="dd-ds-formula">
          <div className="dd-ds-formula__label">
            <CalculatorRegular fontSize={13} aria-hidden /> {t.drillStepFormulaTitle}
          </div>
          <ExpressionView
            expr={ds.calculatedField.expressionAsString}
            configIndex={configIndex}
            onPush={onPush}
          />
        </div>
      )}

      {/* Children / nested datasources */}
      {ds.children?.length > 0 && (
        <DsChildren children={ds.children} configIndex={configIndex} onPush={onPush} />
      )}
    </section>
  );
}

function DsChildren({ children, configIndex, onPush }: {
  children: any[];
  configIndex: number;
  onPush: (f: Frame) => void;
}) {
  const [open, setOpen] = useState(false);
  if (children.length === 0) return null;
  return (
    <div className="dd-ds-children">
      <button
        type="button"
        className="dd-ds-children__toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={`tree-chevron ${open ? 'open' : ''}`} />
        <BoxRegular fontSize={14} aria-hidden />
        <span>{t.drillStepChildrenTitle}</span>
        <span className="dd-ds-children__count">{children.length}</span>
      </button>
      {open && (
        <div className="dd-ds-children__list">
          {children.map((child: any, i: number) => (
            <button
              key={i}
              type="button"
              className="dd-ds-child dd-clickable"
              onClick={() => onPush({ label: child.name, expression: child.name, configIndex })}
              title={`${t.drillDown}: ${child.name}`}
            >
              <span className="dd-ds-icon"><DsTypeIcon ds={child} /></span>
              <span className={`badge badge-${dsTypeBadge(child)}`}>{localizeDatasourceType(child)}</span>
              <span className="dd-ds-name">{child.name}</span>
              {child.tableInfo && <span className="dd-ds-target-inline">→ {child.tableInfo.tableName}</span>}
              {child.enumInfo  && <span className="dd-ds-target-inline">→ {formatEnumDisplayName(child.enumInfo.enumName, child.enumInfo)}</span>}
              {child.classInfo && <span className="dd-ds-target-inline">→ {child.classInfo.className}</span>}
              <span className="dd-push-icon" aria-hidden>›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dependency chain from deep resolution ───────────────────────────────────

function DepChain({ deepResult, onPush, fromCi, stepNumber }: {
  deepResult: any;
  onPush: (f: Frame) => void;
  fromCi: number;
  stepNumber?: number;
}) {
  const tables = deepResult.involvedDatasources.filter((d: any) => d.tableName);
  const enums = deepResult.involvedDatasources.filter((d: any) => d.enumName);
  const classes = deepResult.involvedDatasources.filter((d: any) => d.className);
  const calcs = deepResult.calculatedFieldChain as { name: string; formula: string }[];
  const primaryDsName = deepResult.nestedDs?.name ?? deepResult.rootDs?.name ?? '';

  type InfluenceCard = {
    key: string;
    kind: 'calc' | 'table' | 'enum' | 'class';
    name: string;
    detail: string;
    expression: string;
    direct: boolean;
    priority: 'high' | 'medium' | 'low';
    count: number;
  };

  const rawCards = [
    ...calcs.map((cf, idx) => ({
      key: `calc-${cf.name}-${idx}`,
      kind: 'calc' as const,
      name: cf.name,
      detail: cf.formula,
      expression: cf.formula,
      direct: idx === 0,
      priority: idx === 0 ? 'high' as const : 'low' as const,
      count: 1,
    })),
    ...tables.map((d: any, idx: number) => ({
      key: `table-${d.name}-${idx}`,
      kind: 'table' as const,
      name: d.name,
      detail: d.tableName,
      expression: d.name,
      direct: d.name === primaryDsName,
      priority: d.name === primaryDsName ? 'medium' as const : 'low' as const,
      count: 1,
    })),
    ...enums.map((d: any, idx: number) => ({
      key: `enum-${d.name}-${idx}`,
      kind: 'enum' as const,
      name: d.name,
      detail: formatEnumDisplayName(d.enumName, d),
      expression: d.name,
      direct: d.name === primaryDsName,
      priority: d.name === primaryDsName ? 'medium' as const : 'low' as const,
      count: 1,
    })),
    ...classes.map((d: any, idx: number) => ({
      key: `class-${d.name}-${idx}`,
      kind: 'class' as const,
      name: d.name,
      detail: d.className,
      expression: d.name,
      direct: d.name === primaryDsName,
      priority: d.name === primaryDsName ? 'medium' as const : 'low' as const,
      count: 1,
    })),
  ];

  const dedupMap = new Map<string, InfluenceCard>();
  for (const item of rawCards) {
    const key = `${item.direct ? 'd' : 'i'}|${item.kind}|${item.name}|${item.detail}|${item.expression}`;
    const existing = dedupMap.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    dedupMap.set(key, { ...item, key });
  }

  const priorityRank: Record<InfluenceCard['priority'], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const cards = Array.from(dedupMap.values()).sort((a, b) => {
    const byPriority = priorityRank[a.priority] - priorityRank[b.priority];
    if (byPriority !== 0) return byPriority;
    return a.name.localeCompare(b.name);
  });

  const directCards = cards.filter(c => c.direct);
  const indirectCards = cards.filter(c => !c.direct);

  const sectionTitle = (direct: boolean) => {
    if (direct) return locale === 'cs' ? 'Přímé vlivy' : 'Direct influences';
    return locale === 'cs' ? 'Nepřímé vlivy' : 'Indirect influences';
  };

  const sectionHint = (direct: boolean) => {
    if (direct) return locale === 'cs' ? 'Vstupují do právě zobrazené formule přímo.' : 'Used directly in the current formula.';
    return locale === 'cs' ? 'Jsou navázané přes další výpočty nebo reference.' : 'Used transitively through other calculations or references.';
  };

  const kindBadge = (kind: InfluenceCard['kind']) => {
    if (kind === 'calc') return t.drillLabelCalcField;
    if (kind === 'table') return t.drillLabelTable;
    if (kind === 'enum') return t.drillLabelEnum;
    return t.drillLabelClass;
  };

  const priorityLabel = (priority: InfluenceCard['priority']) => {
    if (priority === 'high') return locale === 'cs' ? 'vysoká priorita' : 'high priority';
    if (priority === 'medium') return locale === 'cs' ? 'střední priorita' : 'medium priority';
    return locale === 'cs' ? 'nízká priorita' : 'low priority';
  };

  const renderCards = (items: InfluenceCard[]) => {
    if (items.length === 0) {
      return (
        <div className="dd-influence-empty">
          {locale === 'cs' ? 'Žádné položky.' : 'No items.'}
        </div>
      );
    }
    return (
      <div className="dd-influence-list">
        {items.map(item => (
          <button
            key={item.key}
            type="button"
            className={`dd-influence-card dd-influence-card--${item.kind} dd-influence-card--${item.priority}`}
            onClick={() => onPush({ label: item.name, expression: item.expression, configIndex: fromCi })}
            title={`${t.drillDown}: ${item.name}`}
          >
            <span className={`badge badge-${item.kind}`}>{kindBadge(item.kind)}</span>
            <span className="dd-influence-card__name">{item.name}</span>
            {item.count > 1 && <span className="dd-influence-card__count">x{item.count}</span>}
            <span className={`dd-influence-card__priority dd-influence-card__priority--${item.priority}`}>{priorityLabel(item.priority)}</span>
            <span className="dd-influence-card__detail">{item.detail}</span>
            <span className="dd-push-icon" aria-hidden>›</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <section className="dd-step dd-dep-chain dd-layout-right">
      <header className="dd-step__head">
        {stepNumber !== undefined && <span className="dd-step__num" aria-hidden>{stepNumber}</span>}
        <span className="dd-step__icon" aria-hidden><LinkRegular fontSize={14} /></span>
        <span className="dd-step__title">{t.drillStepDepsTitle}</span>
      </header>
      <div className="dd-step__body">
        <div className="dd-influence-section">
          <div className="dd-influence-section__head">
            <span className="dd-influence-section__title">{sectionTitle(true)}</span>
            <span className="dd-influence-section__count">{directCards.length}</span>
          </div>
          <div className="dd-influence-section__hint">{sectionHint(true)}</div>
          {renderCards(directCards)}
        </div>

        <div className="dd-influence-section">
          <div className="dd-influence-section__head">
            <span className="dd-influence-section__title">{sectionTitle(false)}</span>
            <span className="dd-influence-section__count">{indirectCards.length}</span>
          </div>
          <div className="dd-influence-section__hint">{sectionHint(false)}</div>
          {renderCards(indirectCards)}
        </div>
      </div>
    </section>
  );
}

// ─── Main DrillDownPanel ──────────────────────────────────────────────────────

/**
 * Clickable expression wrapper — single-click opens the drill-down analysis
 * in a Fluent Dialog popup, double-click opens it as its own tab.
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

  if (!trimmedExpr) {
    return <span className={className}>{children}</span>;
  }

  const openAsTab = () => openDrillDownTab(trimmedExpr, configIndex, elementName);

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        className={`dd-trigger-expr ${className ?? ''}`}
        onClick={(e) => { e.stopPropagation(); setIsDialogOpen(true); }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDialogOpen(false);
          openAsTab();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsDialogOpen(true);
          }
        }}
        title={t.drillClickToToggle}
      >
        {children}
      </span>
      <Dialog open={isDialogOpen} onOpenChange={(_, d) => setIsDialogOpen(d.open)} modalType="modal">
        <DialogSurface className="dd-dialog-surface">
          <DialogBody>
            <DialogTitle
              action={
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<DismissRegular />}
                  aria-label={t.back}
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
            <DialogActions>
              <Button appearance="primary" onClick={() => setIsDialogOpen(false)}>
                {t.back}
              </Button>
            </DialogActions>
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
  badge: 'root' | 'model' | 'mapping' | 'table' | 'enum' | 'class' | 'calc' | 'ds' | 'leaf';
  expression?: string;
  configIndex?: number;
  children: TreeExprNode[];
  leafType?: 'table' | 'enum' | 'class';
}

const MAX_CALC_DEPTH = 3;

function buildTreeNode(
  id: string,
  expression: string,
  configIndex: number,
  configurations: any[],
  resolveModelPath: (p: string) => any,
  resolveDatasource: (n: string, ci: number) => any,
  visited: Set<string>,
  depth = 0,
): TreeExprNode | null {
  const visitKey = `${configIndex}::${expression}`;
  if (visited.has(visitKey) || depth > 6) return null;
  visited.add(visitKey);

  const isModel = expression.toLowerCase().startsWith('model.') || expression.toLowerCase().startsWith('model\\');

  // ── Model path → resolve via ModelMapping ──────────────────────────────
  if (isModel) {
    const cleanPath = extractModelPath(expression);
    const modelResult = resolveModelPath(cleanPath);
    if (!modelResult) {
      return {
        id, kind: 'ref', label: cleanPath.split(/[.\\]/).pop() ?? cleanPath,
        sublabel: cleanPath, badge: 'model', expression, configIndex, children: [],
      };
    }
    const bindingExpr: string = modelResult.binding?.expressionAsString ?? '';
    const bindingCi: number = modelResult.bindingConfigIndex ?? configIndex;
    const mappingLabel = bindingExpr.length > 50 ? bindingExpr.slice(0, 47) + '…' : bindingExpr;

    const mappingNode: TreeExprNode = {
      id: `${id}-m`,
      kind: 'mapping',
      label: locale === 'cs' ? 'Mapování' : 'Mapping',
      sublabel: mappingLabel,
      badge: 'mapping',
      expression: bindingExpr,
      configIndex: bindingCi,
      children: [],
    };

    // Resolve the binding expression's datasources
    if (bindingExpr) {
      const tokens = tokenizeERExpr(bindingExpr);
      const dsTokens = tokens.filter(
        (tok): tok is ERToken & { kind: 'ds'; segments: string[] } =>
          tok.kind === 'ds' && Array.isArray(tok.segments) && tok.segments.length > 0,
      );
      dsTokens.forEach((tok, ti) => {
        const fullExpr = tok.segments.map(formatSegmentForExpression).join('.');
        const child = buildTreeNode(
          `${id}-m-ds${ti}`, fullExpr, bindingCi,
          configurations, resolveModelPath, resolveDatasource,
          new Set(visited), depth + 1,
        );
        if (child) mappingNode.children.push(child);
      });
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
  const deep = resolveDeepExpression(expression, configurations, configIndex);
  const resolvedDs = (deep?.nestedDs ?? deep?.rootDs) ?? null;

  if (!resolvedDs) {
    // Try simple root-name lookup
    const rootName = firstSegment(expression);
    const direct = rootName ? resolveDatasource(rootName, configIndex) : null;
    if (!direct?.datasource) {
      return {
        id, kind: 'ref', label: expression.split(/[.(]/)[0] || expression,
        badge: 'ds', expression, configIndex, children: [],
      };
    }
    return buildDsNode(id, direct.datasource, configIndex, expression, configurations, resolveModelPath, resolveDatasource, visited, depth);
  }

  return buildDsNode(id, resolvedDs, deep?.rootDsConfigIndex ?? configIndex, expression, configurations, resolveModelPath, resolveDatasource, visited, depth);
}

function buildDsNode(
  id: string,
  ds: any,
  configIndex: number,
  expression: string,
  configurations: any[],
  resolveModelPath: (p: string) => any,
  resolveDatasource: (n: string, ci: number) => any,
  visited: Set<string>,
  depth: number,
): TreeExprNode {
  const dsNode: TreeExprNode = {
    id: `${id}-ds`,
    kind: 'datasource',
    label: ds.name,
    badge: 'ds',
    expression,
    configIndex,
    children: [],
  };

  if (ds.tableInfo) {
    dsNode.badge = 'table';
    dsNode.sublabel = ds.tableInfo.tableName !== ds.name ? ds.tableInfo.tableName : undefined;
    dsNode.leafType = 'table';
    dsNode.children.push({
      id: `${id}-ds-table`,
      kind: 'leaf', label: ds.tableInfo.tableName, badge: 'table', leafType: 'table', children: [],
    });
  } else if (ds.enumInfo) {
    const enumDisplay = formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo);
    dsNode.badge = 'enum';
    dsNode.sublabel = enumDisplay !== ds.name ? enumDisplay : undefined;
    dsNode.leafType = 'enum';
    dsNode.children.push({
      id: `${id}-ds-enum`,
      kind: 'leaf', label: enumDisplay, badge: 'enum', leafType: 'enum', children: [],
    });
  } else if (ds.classInfo) {
    dsNode.badge = 'class';
    dsNode.sublabel = ds.classInfo.className !== ds.name ? ds.classInfo.className : undefined;
    dsNode.leafType = 'class';
    dsNode.children.push({
      id: `${id}-ds-class`,
      kind: 'leaf', label: ds.classInfo.className, badge: 'class', leafType: 'class', children: [],
    });
  } else if (ds.calculatedField?.expressionAsString && depth < MAX_CALC_DEPTH) {
    const calcExpr: string = ds.calculatedField.expressionAsString;
    const calcNode: TreeExprNode = {
      id: `${id}-ds-calc`,
      kind: 'calcfield',
      label: ds.name,
      sublabel: calcExpr.length > 45 ? calcExpr.slice(0, 42) + '…' : calcExpr,
      badge: 'calc',
      expression: calcExpr,
      configIndex,
      children: [],
    };

    // Recursively expand the formula's references
    const calcTokens = tokenizeERExpr(calcExpr).filter(
      (tok): tok is ERToken & { kind: 'ds'; segments: string[] } =>
        tok.kind === 'ds' && Array.isArray(tok.segments) && tok.segments.length > 0,
    );
    calcTokens.forEach((tok, ti) => {
      const refExpr = tok.segments.map(formatSegmentForExpression).join('.');
      const child = buildTreeNode(
        `${id}-ds-calc-ref${ti}`, refExpr, configIndex,
        configurations, resolveModelPath, resolveDatasource,
        new Set(visited), depth + 1,
      );
      if (child) calcNode.children.push(child);
    });

    dsNode.badge = 'calc';
    dsNode.kind = 'calcfield';
    dsNode.sublabel = calcNode.sublabel;
    dsNode.children.push(...calcNode.children);
  }

  return dsNode;
}

// ── Layout: assign x/y to each node (top-down, centred subtrees) ────────────

const TREE_NODE_W = 220;
const TREE_NODE_H = 68;
const TREE_H_GAP = 36;
const TREE_V_GAP = 56;

interface LayoutNode { id: string; x: number; y: number; w: number }

function layoutTree(node: TreeExprNode, y = 0, xOffset = 0): LayoutNode[] {
  if (node.children.length === 0) {
    return [{ id: node.id, x: xOffset, y, w: TREE_NODE_W }];
  }

  // Recursively lay out children
  let childLayouts: LayoutNode[][] = [];
  let cursor = 0;
  for (const child of node.children) {
    const sub = layoutTree(child, y + TREE_NODE_H + TREE_V_GAP, xOffset + cursor);
    childLayouts.push(sub);
    const subWidth = Math.max(...sub.map(n => n.x + n.w)) - Math.min(...sub.map(n => n.x));
    cursor += subWidth + TREE_H_GAP;
  }

  const allChildren = childLayouts.flat();
  // Centre parent over children
  const leftmost = Math.min(...allChildren.filter(n => node.children.some(c => c.id === n.id)).map(n => n.x));
  const rightmost = Math.max(...allChildren.filter(n => node.children.some(c => c.id === n.id)).map(n => n.x + n.w));
  const cx = (leftmost + rightmost) / 2 - TREE_NODE_W / 2;

  return [{ id: node.id, x: cx, y, w: TREE_NODE_W }, ...allChildren];
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
  if (badge === 'ds') return <PinRegular {...s} />;
  return <CircleRegular {...s} />;
}

function badgeLabel(badge: string): string {
  const cs: Record<string, string> = { root: 'Výraz', model: 'Model', mapping: 'Mapování', table: 'Tabulka', enum: 'Výčet', class: 'Třída', calc: 'Výpočet', ds: 'DS', leaf: 'Entita' };
  const en: Record<string, string> = { root: 'Expression', model: 'Model', mapping: 'Mapping', table: 'Table', enum: 'Enum', class: 'Class', calc: 'Calculation', ds: 'DS', leaf: 'Entity' };
  return (locale === 'cs' ? cs : en)[badge] ?? badge;
}

function TreeFlowNode({ data }: { data: { node: TreeExprNode; onDrill?: (n: TreeExprNode) => void } }) {
  const { node, onDrill } = data;
  const colors = BADGE_COLORS[node.badge] ?? BADGE_COLORS.ds;
  const isLeaf = node.kind === 'leaf';
  const isRoot = node.badge === 'root';
  const canDrill = Boolean(!isLeaf && node.expression && onDrill);

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} />
      <div
        className={`ddt-node ddt-node--${node.badge}${canDrill ? ' ddt-node--clickable' : ''}`}
        style={{ '--ddt-bg': colors.bg, '--ddt-fg': colors.fg, '--ddt-border': colors.border } as React.CSSProperties}
        onClick={canDrill ? () => onDrill!(node) : undefined}
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
        {canDrill && !isRoot && (
          <div className="ddt-node__drill-hint">
            {locale === 'cs' ? 'Rozbalit →' : 'Drill into →'}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />
    </>
  );
}

const TREE_NODE_TYPES = { treeNode: TreeFlowNode };

function DrillDownTreeView({ expression, configIndex, configurations, onDrill }: {
  expression: string;
  configIndex: number;
  configurations: any[];
  onDrill: (expr: string, ci: number) => void;
}) {
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const resolveDatasource = useAppStore(s => s.resolveDatasource);

  // Build tree data structure
  const rootNode = useMemo<TreeExprNode>(() => {
    const tokens = tokenizeERExpr(expression);
    const dsTokens = tokens.filter(
      (tok): tok is ERToken & { kind: 'ds'; segments: string[] } =>
        tok.kind === 'ds' && Array.isArray(tok.segments) && tok.segments.length > 0,
    );

    const rootChildren: TreeExprNode[] = [];

    if (dsTokens.length === 0) {
      // No DS refs found – show single "unresolved" leaf
      rootChildren.push({
        id: 'unresolved', kind: 'ref',
        label: locale === 'cs' ? 'Žádná datová reference' : 'No data reference',
        badge: 'ds', children: [],
      });
    } else {
      dsTokens.forEach((tok, ti) => {
        const fullExpr = tok.segments.map(formatSegmentForExpression).join('.');
        const child = buildTreeNode(
          `ref${ti}`, fullExpr, configIndex,
          configurations, resolveModelPath, resolveDatasource,
          new Set(), 0,
        );
        if (child) rootChildren.push(child);
      });
    }

    const exprLabel = expression.length > 40 ? expression.slice(0, 37) + '…' : expression;
    return {
      id: 'root',
      kind: 'root',
      label: exprLabel,
      badge: 'root',
      expression,
      configIndex,
      children: rootChildren,
    };
  }, [expression, configIndex, configurations, resolveModelPath, resolveDatasource]);

  // Convert tree → ReactFlow nodes + edges
  const { rfNodes, rfEdges } = useMemo(() => {
    const positions = layoutTree(rootNode);
    const posMap = new Map(positions.map(p => [p.id, p]));
    const allNodes = flattenTree(rootNode);
    const allEdges = collectEdges(rootNode);

    const rfNodes: Node[] = allNodes.map(n => {
      const pos = posMap.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id,
        type: 'treeNode',
        position: { x: pos.x, y: pos.y },
        data: {
          node: n,
          onDrill: (treeNode: TreeExprNode) => {
            if (treeNode.expression) onDrill(treeNode.expression, treeNode.configIndex ?? configIndex);
          },
        },
        style: { width: TREE_NODE_W, height: 'auto' },
      };
    });

    const rfEdges: Edge[] = allEdges.map((e, i) => ({
      id: `e${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      style: { stroke: 'var(--accent)', strokeWidth: 1.5, strokeDasharray: '4,3', opacity: 0.65 },
      markerEnd: { type: 'arrowclosed' as any, color: 'var(--accent)', width: 12, height: 12 },
      animated: false,
    }));

    return { rfNodes, rfEdges };
  }, [rootNode, configIndex, onDrill]);

  return (
    <div className="ddt-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={TREE_NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
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

  const [viewMode, setViewMode] = useState<'workbench' | 'tree'>('workbench');

  const initialFrame = (): Frame => ({
    label: elementName ?? (trimmedExpr.split(/[.(]/)[0] || '?'),
    expression: trimmedExpr,
    configIndex,
  });

  const [stack, setStack] = useState<Frame[]>([initialFrame()]);

  const currentFrame = stack[stack.length - 1];

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
            {/* View mode toggle */}
            <div className="dd-view-toggle" role="group" aria-label={locale === 'cs' ? 'Režim zobrazení' : 'View mode'}>
              <button
                type="button"
                className={`dd-view-toggle__btn${viewMode === 'workbench' ? ' is-active' : ''}`}
                onClick={() => setViewMode('workbench')}
                title={locale === 'cs' ? 'Pracovní plocha' : 'Workbench'}
              ><AppsListDetailRegular fontSize={14} /></button>
              <button
                type="button"
                className={`dd-view-toggle__btn${viewMode === 'tree' ? ' is-active' : ''}`}
                onClick={() => setViewMode('tree')}
                title={locale === 'cs' ? 'Stromová vizualizace' : 'Tree visualization'}
              ><FlowRegular fontSize={14} /></button>
            </div>
            {!atRoot && (
              <button
                type="button"
                className="dd-hero__btn dd-hero__btn--ghost"
                onClick={restart}
                title={t.drillRestart}
              ><ArrowClockwiseRegular fontSize={13} /> {t.drillRestart}</button>
            )}
            {!atRoot && (
              <button
                type="button"
                className="dd-hero__btn"
                onClick={() => setStack(s => s.slice(0, -1))}
                title={t.back}
              ><ArrowLeftRegular fontSize={13} /> {t.back}</button>
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
        </div>

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
      </header>

      {viewMode === 'tree' ? (
        <DrillDownTreeView
          expression={currentFrame.expression}
          configIndex={currentFrame.configIndex}
          configurations={configurations}
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
