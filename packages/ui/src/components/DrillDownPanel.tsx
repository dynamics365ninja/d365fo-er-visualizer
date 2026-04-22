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
import React, { useMemo, useState } from 'react';
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
  ChevronRightRegular,
  ChevronDownRegular,
  OpenRegular,
  ArrowExpandRegular,
  DismissRegular,
  CircleRegular,
} from '@fluentui/react-icons';
import { useAppStore, resolveDeepExpression } from '../state/store';
import { t } from '../i18n';
import { formatEnumDisplayName, getEnumTypeLabel, getEnumSourceKind } from '../utils/enum-display';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Frame {
  label: string;           // breadcrumb label
  expression: string;      // expression being resolved
  configIndex: number;     // config index to resolve from
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
  kind: 'func' | 'ds' | 'op' | 'str' | 'num' | 'paren' | 'sep' | 'ws' | 'other';
  raw: string;            // exact text in expression
  segments?: string[];    // for 'ds': unquoted path segments (['001_System','$TaxJuristictionUIP'])
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

    // ── @ current-record reference (@.field or just @) ──────────────────────
    if (ch === '@') {
      let raw = '@';
      let j = i + 1;
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

// ─── ExpressionView — interactive tokenised expression renderer ───────────────
// Renders an ER expression with syntax colouring. DS-reference tokens are
// clickable: clicking them pushes a new drill-down frame for that datasource.

interface ExpressionViewProps {
  expr: string;
  configIndex: number;
  onPush: (f: Frame) => void;
}

function ExpressionView({ expr, configIndex, onPush }: ExpressionViewProps) {
  const tokens = useMemo(() => tokenizeERExpr(expr), [expr]);
  return (
    <div className="er-expr">
      {tokens.map((tok, idx) => {
        if (tok.kind === 'ds' && tok.segments && tok.segments.length > 0) {
          // Build a canonical expression form that parseDottedPath can handle:
          // quote segments that contain non-identifier characters (e.g. name())
          const expression = tok.segments
            .map(s => /[()\s.]/.test(s) ? `'${s}'` : s)
            .join('.');
          const label = tok.raw.replace(/'/g, '');
          return (
            <span key={idx} className="er-token-ds"
              title={`→ ${expression}`}
              onClick={() => onPush({ label, expression, configIndex })}
            >{tok.raw}</span>
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
            <div className="dd-hint__title">{t.drillInteractiveExpr}</div>
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
      {/* ── Step 1: model path → mapping expression (interactive) ── */}
      {mappingExpr && (
        <section className="dd-step">
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
          configurations={configurations}
          onPush={onPush}
          stepNumber={mappingExpr ? 2 : 1}
        />
      )}

      {/* ── Step 3: deep deps ── */}
      {deepResult && (deepResult.involvedDatasources.length > 0 || deepResult.calculatedFieldChain.length > 0) && (
        <DepChain
          deepResult={deepResult}
          onPush={onPush}
          fromCi={effectiveCi}
          stepNumber={(mappingExpr ? 2 : 1) + (resolvedDs ? 1 : 0)}
        />
      )}
    </div>
  );
}

// ─── Datasource Card ─────────────────────────────────────────────────────────

function DatasourceCard({ ds, configIndex, configurations, onPush, stepNumber }: {
  ds: any;
  configIndex: number;
  configurations: any[];
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
    <section className="dd-step dd-ds-card">
      <header className="dd-step__head">
        {stepNumber !== undefined && <span className="dd-step__num" aria-hidden>{stepNumber}</span>}
        <span className="dd-step__icon" aria-hidden><DsTypeIcon ds={ds} /></span>
        <span className="dd-step__title">{t.drillStepDatasourceTitle}</span>
        <span className={`badge badge-${badge} dd-step__type`}>{ds.type}</span>
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
            <span className="dd-tag">cross-company</span>
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
              <span className={`badge badge-${dsTypeBadge(child)}`}>{child.type}</span>
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
  const tables  = deepResult.involvedDatasources.filter((d: any) => d.tableName);
  const enums   = deepResult.involvedDatasources.filter((d: any) => d.enumName);
  const classes = deepResult.involvedDatasources.filter((d: any) => d.className);
  const calcs   = deepResult.calculatedFieldChain as { name: string; formula: string }[];

  return (
    <section className="dd-step dd-dep-chain">
      <header className="dd-step__head">
        {stepNumber !== undefined && <span className="dd-step__num" aria-hidden>{stepNumber}</span>}
        <span className="dd-step__icon" aria-hidden><LinkRegular fontSize={14} /></span>
        <span className="dd-step__title">{t.drillStepDepsTitle}</span>
      </header>
      <div className="dd-step__body">
      {calcs.length > 0 && (
        <div className="dd-dep-section">
          <div className="dd-dep-section-title"><CalculatorRegular fontSize={13} aria-hidden /> {t.drillLabelCalcField} <span className="dd-dep-section-count">{calcs.length}</span></div>
          {calcs.map((cf, i) => (
            <button
              key={i}
              type="button"
              className="dd-dep-item dd-clickable"
              onClick={() => onPush({ label: cf.name, expression: cf.formula, configIndex: fromCi })}
              title={`${t.drillDown}: ${cf.name}`}
            >
              <span className="dd-dep-name">{cf.name}</span>
              <span className="dd-dep-formula">{cf.formula}</span>
              <span className="dd-push-icon" aria-hidden>›</span>
            </button>
          ))}
        </div>
      )}
      {tables.length > 0 && (
        <div className="dd-dep-section">
          <div className="dd-dep-section-title"><TableRegular fontSize={13} aria-hidden /> {t.drillLabelTable} <span className="dd-dep-section-count">{tables.length}</span></div>
          {tables.map((d: any, i: number) => (
            <div key={i} className="dd-dep-item">
              <span className="badge badge-table">{d.type}</span>
              <span className="dd-dep-name">{d.name}</span>
              <span className="dd-dep-target">→ <strong>{d.tableName}</strong></span>
            </div>
          ))}
        </div>
      )}
      {enums.length > 0 && (
        <div className="dd-dep-section">
          <div className="dd-dep-section-title"><TextCaseTitleRegular fontSize={13} aria-hidden /> {t.drillLabelEnum} <span className="dd-dep-section-count">{enums.length}</span></div>
          {enums.map((d: any, i: number) => (
            <div key={i} className="dd-dep-item">
              <span className="badge badge-enum">{d.type}</span>
              <span className="dd-dep-name">{d.name}</span>
              <span className="dd-dep-target">→ <strong>{formatEnumDisplayName(d.enumName, d)}</strong></span>
            </div>
          ))}
        </div>
      )}
      {classes.length > 0 && (
        <div className="dd-dep-section">
          <div className="dd-dep-section-title"><SettingsRegular fontSize={13} aria-hidden /> {t.drillLabelClass} <span className="dd-dep-section-count">{classes.length}</span></div>
          {classes.map((d: any, i: number) => (
            <div key={i} className="dd-dep-item">
              <span className="badge badge-class">{d.type}</span>
              <span className="dd-dep-name">{d.name}</span>
              <span className="dd-dep-target">→ <strong>{d.className}</strong></span>
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}

// ─── Main DrillDownPanel ──────────────────────────────────────────────────────

/**
 * Inline drill-down panel used in binding rows. By default the panel is
 * collapsed and shows only a compact trigger. Single-click on the trigger
 * expands the drill-down inline; double-click opens it as its own tab.
 * A "pop out" button on the expanded panel opens the analysis inside a
 * Fluent dialog for a larger, distraction-free view.
 */
export function DrillDownPanel({ expression, configIndex, elementName, defaultExpanded = false }: {
  expression: string;
  configIndex: number;
  elementName?: string;
  defaultExpanded?: boolean;
}) {
  const trimmedExpr = expression?.trim() ?? '';
  const openDrillDownTab = useAppStore(s => s.openDrillDownTab);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  if (!trimmedExpr) return null;

  const openAsTab = () => openDrillDownTab(trimmedExpr, configIndex, elementName);

  return (
    <>
      <div className={`dd-collapsible ${expanded ? 'is-open' : ''}`}>
        <button
          type="button"
          className="dd-collapsible__trigger"
          onClick={() => setExpanded(e => !e)}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openAsTab();
          }}
          aria-expanded={expanded}
          title={t.drillClickToToggle}
        >
          <span className="dd-collapsible__chevron" aria-hidden>
            {expanded ? <ChevronDownRegular fontSize={14} /> : <ChevronRightRegular fontSize={14} />}
          </span>
          <CompassNorthwestRegular fontSize={14} aria-hidden />
          <span className="dd-collapsible__label">{t.drillDown}</span>
          <span className="dd-collapsible__hint">{t.drillDblClickToOpenTab}</span>
        </button>
        {expanded && (
          <DrillDownBody
            expression={trimmedExpr}
            configIndex={configIndex}
            elementName={elementName}
            onPopOut={() => setIsDialogOpen(true)}
            onOpenTab={openAsTab}
          />
        )}
      </div>
      <Dialog open={isDialogOpen} onOpenChange={(_, d) => setIsDialogOpen(d.open)} modalType="non-modal">
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
                {t.drillDown}
                {elementName && <span className="dd-dialog-title__name">· {elementName}</span>}
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

export function DrillDownBody({ expression, configIndex, elementName, variant = 'inline', onPopOut, onOpenTab }: {
  expression: string;
  configIndex: number;
  elementName?: string;
  variant?: 'inline' | 'tab' | 'dialog';
  onPopOut?: () => void;
  onOpenTab?: () => void;
}) {
  const configurations = useAppStore(s => s.configurations);
  const trimmedExpr = expression?.trim() ?? '';

  const initialFrame = (): Frame => ({
    label: elementName ?? (trimmedExpr.split(/[.(]/)[0] || '?'),
    expression: trimmedExpr,
    configIndex,
  });

  const [stack, setStack] = useState<Frame[]>([initialFrame()]);

  const currentFrame = stack[stack.length - 1];

  const push = (frame: Frame) => setStack(s => [...s, frame]);
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
            {onOpenTab && (
              <button
                type="button"
                className="dd-hero__btn dd-hero__btn--ghost"
                onClick={onOpenTab}
                title={t.drillOpenInTab}
                aria-label={t.drillOpenInTab}
              ><OpenRegular fontSize={13} /> {t.drillOpenInTab}</button>
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

        <nav className="dd-hero__crumbs" aria-label="breadcrumb">
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

        <div className="dd-hero__expr-wrap">
          <div className="dd-hero__expr-label">{t.drillAnalyzing}</div>
          <ExpressionView
            expr={currentFrame.expression}
            configIndex={currentFrame.configIndex}
            onPush={push}
          />
        </div>

        <div className="dd-hero__legend">
          <span className="dd-hero__legend-item">
            <span className="dd-legend-swatch dd-legend-swatch--ds">abc</span>
            {t.drillLegendClickable}
          </span>
          <span className="dd-hero__legend-item">
            <span className="dd-legend-swatch dd-legend-swatch--func">IF</span>
            {t.drillLegendFunction}
          </span>
          <span className="dd-hero__legend-item">
            <span className="dd-legend-swatch dd-legend-swatch--str">"x"</span>
            {t.drillLegendLiteral}
          </span>
        </div>
      </header>

      <div className="dd-frame-content">
        <FrameView
          frame={currentFrame}
          onPush={push}
          configurations={configurations}
        />
      </div>
    </div>
  );
}
