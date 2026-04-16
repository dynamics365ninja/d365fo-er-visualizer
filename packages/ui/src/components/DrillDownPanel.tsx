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

function dsTypeIcon(ds: any): string {
  if (ds.tableInfo)       return '🗃️';
  if (ds.enumInfo)        return getEnumSourceKind(ds.enumInfo) === 'DataModel' ? '📋' : getEnumSourceKind(ds.enumInfo) === 'Format' ? '🏷️' : '🔤';
  if (ds.classInfo)       return '⚙️';
  if (ds.calculatedField) return '🧮';
  if (ds.type === 'Container') return '📦';
  if (ds.type === 'Join')      return '🔗';
  if (ds.type === 'GroupBy')   return '📊';
  return '📌';
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
        📋 {t.drillNoModelMapping}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Case B: model.* + ModelMapping loaded but path not found
  // ─────────────────────────────────────────────────────────────────────────
  if (isModel && hasModelMapping && !modelResult) {
    return (
      <div className="dd-hint dd-hint-warn">
        {cleanModelExpr !== expr && (
          <div className="dd-unres-expr dd-gap-bottom">
            <span className="dd-unres-text">{expr}</span>
          </div>
        )}
        <div className="dd-gap-bottom">⚠️ {t.drillPathNotFound(stripModel(cleanModelExpr))}</div>
        {mappingPaths?.map((mp, i) => (
          <div key={i} className="dd-debug-block">
            <div className="dd-debug-title">
              {mp.configName} — {mp.total} bindings{mp.total > 15 ? ` (${t.drillMore(mp.total - 15)})` : ''}:
            </div>
            {mp.paths.map((p, j) => (
              <div key={j} className="dd-debug-path"
                onClick={() => onPush({ label: p, expression: 'model.' + p.replace(/\\/g, '.'), configIndex: ci })}
              >
                {p}
              </div>
            ))}
          </div>
        ))}
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
      return <div className="dd-hint dd-hint-muted">{t.drillUnbound}</div>;
    }

    const kind = classifyExpr(expr);
    if (kind === 'current-record') {
      return (
        <div className="dd-hint dd-hint-info">
          <div className="dd-unres-expr">
            <span className="dd-unres-label">@.</span>
            <span className="dd-unres-text">{expr.slice(expr.indexOf('.') + 1)}</span>
          </div>
          <div className="dd-gap-top">📍 {t.drillCurrentRecord}</div>
        </div>
      );
    }
    if (kind === 'constant') {
      return (
        <div className="dd-hint dd-hint-info">
          <div className="dd-unres-expr"><span className="dd-unres-text">{expr}</span></div>
          <div className="dd-gap-top">💬 {t.drillConstant}</div>
        </div>
      );
    }
    // er-function, compound — render with interactive tokenised expression
    if (kind === 'er-function' || kind === 'compound') {
      return (
        <div className="dd-hint dd-hint-info">
          <div className="dd-hint-expr-label">🔀 {t.drillInteractiveExpr}</div>
          <ExpressionView expr={expr} configIndex={ci} onPush={onPush} />
        </div>
      );
    }
    // Unknown — unresolvable plain name
    return (
      <div className="dd-hint dd-hint-warn">
        <div className="dd-unres-expr"><span className="dd-unres-text">{expr}</span></div>
        <div className="dd-gap-top">⚠️ {t.drillDsNotFound(firstSegment(expr) || expr)}</div>
      </div>
    );
  }

  return (
    <div className="dd-frame-body">
      {/* ── Step 1: model path → mapping expression (interactive) ── */}
      {mappingExpr && (
        <div className="dd-step">
          <div className="dd-step-label">{t.drillLabelMapping}
            {mappingConfig && <span className="dd-step-config">{mappingConfig}</span>}
          </div>
          <ExpressionView expr={mappingExpr} configIndex={mappingCi} onPush={onPush} />
        </div>
      )}

      {/* ── Step 2: datasource card ── */}
      {resolvedDs && (
        <DatasourceCard
          ds={resolvedDs}
          configIndex={effectiveCi}
          configurations={configurations}
          onPush={onPush}
        />
      )}

      {/* ── Step 3: deep deps ── */}
      {deepResult && (deepResult.involvedDatasources.length > 0 || deepResult.calculatedFieldChain.length > 0) && (
        <DepChain deepResult={deepResult} onPush={onPush} fromCi={effectiveCi} />
      )}
    </div>
  );
}

// ─── Datasource Card ─────────────────────────────────────────────────────────

function DatasourceCard({ ds, configIndex, configurations, onPush }: {
  ds: any;
  configIndex: number;
  configurations: any[];
  onPush: (f: Frame) => void;
}) {
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const icon  = dsTypeIcon(ds);
  const badge = dsTypeBadge(ds);
  const datasourceNodeId = findDatasourceNode(ds.name, configIndex, ds.parentPath);

  const concreteTarget =
    ds.tableInfo?.tableName  ? { kind: 'table',  name: ds.tableInfo.tableName }  :
    ds.enumInfo?.enumName    ? { kind: 'enum',   name: formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo) }    :
    ds.classInfo?.className  ? { kind: 'class',  name: ds.classInfo.className }  :
    null;

  return (
    <div className="dd-ds-card">
      <div className="dd-ds-card-header">
        <span className="dd-ds-icon">{icon}</span>
        <span className={`badge badge-${badge}`}>{ds.type}</span>
        <span className="dd-ds-name">{ds.name}</span>
        {datasourceNodeId && (
          <button
            className="dd-action-btn"
            onClick={() => navigateToTreeNode(datasourceNodeId)}
            title={t.openInExplorerAction}
          >
            {t.openInExplorerAction}
          </button>
        )}
      </div>

      {/* Concrete target */}
      {concreteTarget && (
        <div className="dd-ds-target">
          <span className="dd-step-label">{
            concreteTarget.kind === 'table' ? t.drillLabelTable :
            concreteTarget.kind === 'enum'  ? t.drillLabelEnum  :
            t.drillLabelClass
          }</span>
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
          <div className="dd-step-label">{t.drillLabelFormula}</div>
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
    </div>
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
      <div className="dd-ds-children-toggle" onClick={() => setOpen(o => !o)}>
        <span className={`tree-chevron ${open ? 'open' : ''}`} /> {t.drillLabelChildren} ({children.length})
      </div>
      {open && children.map((child: any, i: number) => (
        <div key={i} className="dd-ds-child dd-clickable"
          onClick={() => onPush({ label: child.name, expression: child.name, configIndex })}
        >
          <span className="dd-ds-icon">{dsTypeIcon(child)}</span>
          <span className={`badge badge-${dsTypeBadge(child)}`}>{child.type}</span>
          <span className="dd-ds-name">{child.name}</span>
          {child.tableInfo && <span className="dd-ds-target-inline">→ {child.tableInfo.tableName}</span>}
          {child.enumInfo  && <span className="dd-ds-target-inline">→ {formatEnumDisplayName(child.enumInfo.enumName, child.enumInfo)}</span>}
          {child.classInfo && <span className="dd-ds-target-inline">→ {child.classInfo.className}</span>}
          {child.calculatedField && <span className="dd-push-icon">→</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Dependency chain from deep resolution ───────────────────────────────────

function DepChain({ deepResult, onPush, fromCi }: {
  deepResult: any;
  onPush: (f: Frame) => void;
  fromCi: number;
}) {
  const tables  = deepResult.involvedDatasources.filter((d: any) => d.tableName);
  const enums   = deepResult.involvedDatasources.filter((d: any) => d.enumName);
  const classes = deepResult.involvedDatasources.filter((d: any) => d.className);
  const calcs   = deepResult.calculatedFieldChain as { name: string; formula: string }[];

  return (
    <div className="dd-dep-chain">
      {calcs.length > 0 && (
        <div className="dd-dep-section">
          <div className="dd-dep-section-title">🧮 {t.drillLabelCalcField} ({calcs.length})</div>
          {calcs.map((cf, i) => (
            <div key={i} className="dd-dep-item dd-clickable"
              onClick={() => onPush({ label: cf.name, expression: cf.formula, configIndex: fromCi })}
            >
              <span className="dd-dep-name">{cf.name}</span>
              <span className="dd-dep-formula">{cf.formula}</span>
              <span className="dd-push-icon">→</span>
            </div>
          ))}
        </div>
      )}
      {tables.length > 0 && (
        <div className="dd-dep-section">
          <div className="dd-dep-section-title">🗃️ {t.drillLabelTable} ({tables.length})</div>
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
          <div className="dd-dep-section-title">🔤 {t.drillLabelEnum} ({enums.length})</div>
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
          <div className="dd-dep-section-title">⚙️ {t.drillLabelClass} ({classes.length})</div>
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
  );
}

// ─── Main DrillDownPanel ──────────────────────────────────────────────────────

export function DrillDownPanel({ expression, configIndex, elementName }: {
  expression: string;
  configIndex: number;
  elementName?: string;
}) {
  const configurations = useAppStore(s => s.configurations);

  // Don't render anything for genuinely empty expressions — the parent handles that message
  const trimmedExpr = expression?.trim() ?? '';

  const [stack, setStack] = useState<Frame[]>([{
    label: elementName ?? (trimmedExpr.split(/[.(]/)[0] || '?'),
    expression: trimmedExpr,
    configIndex,
  }]);

  const currentFrame = stack[stack.length - 1];

  const push = (frame: Frame) => setStack(s => [...s, frame]);
  const jumpTo = (index: number) => setStack(s => s.slice(0, index + 1));

  // Reset when expression changes
  React.useEffect(() => {
    setStack([{
      label: elementName ?? (trimmedExpr.split(/[.(]/)[0] || '?'),
      expression: trimmedExpr,
      configIndex,
    }]);
  }, [trimmedExpr, configIndex, elementName]);

  if (!trimmedExpr) return null;

  return (
    <div className="dd-panel">
      {/* Breadcrumb */}
      {stack.length > 1 && (
        <div className="dd-breadcrumb">
          {stack.map((f, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="dd-breadcrumb-sep">›</span>}
              <span
                className={`dd-breadcrumb-item${i === stack.length - 1 ? ' active' : ''}`}
                onClick={() => i < stack.length - 1 && jumpTo(i)}
              >
                {f.label}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Current frame title */}
      <div className="dd-frame-title">
        <span className="dd-frame-title-label">{t.drillDown}</span>
        <span className="dd-frame-meta">{t.drillSteps(stack.length)}</span>
        <span className="dd-frame-title-expr">{currentFrame.expression}</span>
        {stack.length > 1 && (
          <button className="dd-back-btn" onClick={() => setStack(s => s.slice(0, -1))}>
            ← {t.back}
          </button>
        )}
      </div>

      {/* Frame content */}
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
