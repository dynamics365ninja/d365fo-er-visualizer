import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useAppStore, resolveDeepExpression } from '../state/store';
import { formatEnumDisplayName } from '../utils/enum-display';
import { PathTooltipCard, type PathTooltipData, type PathTooltipRow } from './PathTooltipCard';

interface ClickablePathProps {
  /** The expression or path string, e.g. "model.CompanyInfo.Name" or "CompanyInfo.'name()'" */
  expression: string;
  /** Config index for context when resolving datasources */
  configIndex: number;
  /** What kind of references to resolve */
  mode?: 'binding-expr' | 'model-path' | 'auto';
  style?: React.CSSProperties;
  interactive?: boolean;
}

/**
 * Renders an expression string with clickable segments.
 * Datasource names and model paths are resolved on hover.
 * If a reference resolves, it becomes clickable with a tooltip.
 */
export function ClickablePath({ expression, configIndex, mode = 'auto', style, interactive = true }: ClickablePathProps) {
  const resolveDatasource = useAppStore(s => s.resolveDatasource);
  const resolveBinding = useAppStore(s => s.resolveBinding);
  const resolveModelPath = useAppStore(s => s.resolveModelPath);
  const findDatasourceNode = useAppStore(s => s.findDatasourceNode);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);

  // Parse into segments for coloring, but resolve lazily on hover
  const segments = useMemo(() => parseSegments(expression, mode), [expression, mode]);

  return (
    <span style={{ fontFamily: 'monospace', fontSize: 11, ...style }}>
      {segments.map((seg, i) => (
        <SmartSegment
          key={i}
          segment={seg}
          configIndex={configIndex}
          interactive={interactive}
          resolveDatasource={resolveDatasource}
          resolveBinding={resolveBinding}
          resolveModelPath={resolveModelPath}
          findDatasourceNode={findDatasourceNode}
          navigateToTreeNode={navigateToTreeNode}
        />
      ))}
    </span>
  );
}

interface Segment {
  text: string;
  kind: 'identifier' | 'model-path' | 'operator' | 'literal' | 'separator';
  fullPath?: string;
  lookupText?: string;
  isFirstIdent?: boolean; // first identifier in an expression — likely a datasource name
}

function looksLikeDatasourceReference(value: string | undefined): boolean {
  if (!value) return false;
  return /^[$#A-Za-z_]/.test(value);
}

function parseSegments(expr: string, mode: string): Segment[] {
  if (!expr) return [{ text: '', kind: 'literal' }];

  const segments: Segment[] = [];
  // Tokenize: split on dots, commas, parens, quoted strings
  const tokens = expr.match(/("[^"]*"|'[^']*'|[.(),]|\s+|[^."'(),\s]+)/g) ?? [expr];

  let pathParts: string[] = [];
  let isFirstIdent = true;

  const previousMeaningfulToken = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      if (!/^\s+$/.test(tokens[i])) return tokens[i];
    }
    return undefined;
  };

  const nextMeaningfulToken = (index: number) => {
    for (let i = index + 1; i < tokens.length; i++) {
      if (!/^\s+$/.test(tokens[i])) return tokens[i];
    }
    return undefined;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '.') {
      segments.push({ text: '.', kind: 'separator' });
      continue;
    }
    if (token === '(' || token === ')' || token === ',') {
      segments.push({ text: token, kind: 'operator' });
      // After a paren/comma, next identifier is a new context
      isFirstIdent = true;
      pathParts = [];
      continue;
    }
    if (/^\s+$/.test(token)) {
      segments.push({ text: token, kind: 'literal' });
      continue;
    }
    if (token.startsWith('"') || token.startsWith("'")) {
      const lookupText = token.slice(1, -1);
      const prev = previousMeaningfulToken(index);
      const next = nextMeaningfulToken(index);
      const isPathSegment = Boolean(lookupText) && (prev === '.' || next === '.');

      if (isPathSegment) {
        pathParts.push(lookupText);
        const fullPath = pathParts.join('.');
        segments.push({
          text: token,
          kind: mode === 'model-path' ? 'model-path' : 'identifier',
          lookupText,
          fullPath,
          isFirstIdent,
        });
        isFirstIdent = false;
      } else {
        segments.push({
          text: token,
          kind: 'literal',
          lookupText: looksLikeDatasourceReference(lookupText) ? lookupText : undefined,
          fullPath: looksLikeDatasourceReference(lookupText) ? lookupText : undefined,
          isFirstIdent,
        });
        pathParts = [];
        isFirstIdent = true;
      }
      continue;
    }

    // It's an identifier
    pathParts.push(token);
    const fullPath = pathParts.join('.');

    if (mode === 'model-path') {
      segments.push({ text: token, kind: 'model-path', lookupText: token, fullPath });
    } else {
      // For binding-expr or auto: first ident is likely datasource, rest are field paths
      segments.push({
        text: token,
        kind: 'identifier',
        lookupText: token,
        fullPath,
        isFirstIdent,
      });
    }

    isFirstIdent = false;
  }

  return segments;
}

interface SmartSegmentProps {
  segment: Segment;
  configIndex: number;
  interactive: boolean;
  resolveDatasource: (name: string, ci: number) => any;
  resolveBinding: (path: string, ci: number) => any;
  resolveModelPath: (modelDotPath: string) => any;
  findDatasourceNode: (name: string, ci: number, parentPath?: string) => string | null;
  navigateToTreeNode: (nodeId: string) => void;
}

function SmartSegment({ segment, configIndex, interactive, resolveDatasource, resolveBinding, resolveModelPath, findDatasourceNode, navigateToTreeNode }: SmartSegmentProps) {
  const [tooltip, setTooltip] = useState<PathTooltipData | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [resolved, setResolved] = useState<{ treeNodeId: string | null; type: string } | null>(null);
  const resolvedRef = useRef<{ treeNodeId: string | null; type: string } | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configurations = useAppStore(s => s.configurations);

  const canResolve = interactive && (segment.kind === 'identifier'
    || segment.kind === 'model-path'
    || (segment.kind === 'literal' && !!segment.lookupText));

  const doResolve = useCallback((): PathTooltipData | null => {
    if (segment.kind === 'identifier' || (segment.kind === 'literal' && segment.lookupText)) {
      const referencePath = segment.fullPath ?? segment.lookupText ?? segment.text;
      const deepResult = resolveDeepExpression(referencePath, configurations, configIndex);
      const rootSegment = referencePath.split('.')[0] ?? referencePath;

      const dsResult = resolveDatasource(rootSegment, configIndex);
      const resolvedDatasource = deepResult?.nestedDs ?? deepResult?.rootDs ?? dsResult?.datasource;
      const datasourceConfigIndex = deepResult?.rootDsConfigIndex ?? dsResult?.configIndex ?? configIndex;

      if (resolvedDatasource) {
        const ds = resolvedDatasource;
        const rows: PathTooltipRow[] = [];

        if (ds.tableInfo) {
          rows.push({ icon: 'table', label: 'Table', value: ds.tableInfo.tableName, mono: true });
        } else if (ds.enumInfo) {
          rows.push({ icon: 'enum', label: 'Enum', value: formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo), mono: true });
        } else if (ds.classInfo) {
          rows.push({ icon: 'class', label: 'Class', value: ds.classInfo.className, mono: true });
        } else if (ds.calculatedField) {
          rows.push({ icon: 'calc', label: 'Expr', value: ds.calculatedField.expressionAsString ?? '', mono: true });
        } else if (ds.userParamInfo) {
          rows.push({ label: 'Param', value: ds.userParamInfo.extendedDataTypeName ?? ds.name });
        } else {
          rows.push({ label: 'Type', value: String(ds.type), muted: true });
        }

        if (deepResult?.nestedDs && deepResult.rootDs && deepResult.nestedDs !== deepResult.rootDs) {
          rows.push({ icon: 'branch', label: 'Nested in', value: deepResult.rootDs.name, mono: true });
        }
        if (deepResult) {
          const tables = deepResult.involvedDatasources.filter(d => d.tableName);
          const classes = deepResult.involvedDatasources.filter(d => d.className);
          const enums = deepResult.involvedDatasources.filter(d => d.enumName);
          if (tables.length > 1) rows.push({ icon: 'table', value: tables.map(t => t.tableName).join(', '), mono: true, muted: true });
          if (classes.length > 1) rows.push({ icon: 'class', value: classes.map(c => c.className).join(', '), mono: true, muted: true });
          if (enums.length > 1) rows.push({ icon: 'enum', value: enums.map(e => formatEnumDisplayName(e.enumName!, e)).join(', '), mono: true, muted: true });
          if (deepResult.calculatedFieldChain.length > 0) {
            rows.push({ icon: 'calc', value: `${deepResult.calculatedFieldChain.length} calc field(s) in chain`, muted: true });
          }
        }

        const treeNodeId = findDatasourceNode(ds.name, datasourceConfigIndex, ds.parentPath)
          ?? dsResult?.treeNodeId
          ?? null;

        const r = { treeNodeId, type: 'datasource' };
        resolvedRef.current = r;
        setResolved(r);

        return {
          kind: 'datasource',
          title: ds.name,
          subtitle: 'Data source',
          rows,
          canNavigate: !!treeNodeId,
        };
      }

      if (segment.text === 'model') {
        resolvedRef.current = null;
        setResolved(null);
        return null;
      }

      resolvedRef.current = null;
      setResolved(null);
      return null;
    }

    if (segment.kind === 'model-path' && segment.fullPath) {
      const mapResult = resolveModelPath(segment.fullPath);
      if (mapResult) {
        const rows: PathTooltipRow[] = [];
        rows.push({ label: 'Expr', value: mapResult.binding.expressionAsString ?? '', mono: true });
        if (mapResult.datasource) {
          const ds = mapResult.datasource;
          if (ds.tableInfo) rows.push({ icon: 'table', label: 'Table', value: ds.tableInfo.tableName, mono: true });
          else if (ds.enumInfo) rows.push({ icon: 'enum', label: 'Enum', value: formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo), mono: true });
          else if (ds.classInfo) rows.push({ icon: 'class', label: 'Class', value: ds.classInfo.className, mono: true });
          else if (ds.calculatedField) rows.push({ icon: 'calc', label: 'Calc', value: ds.calculatedField.expressionAsString ?? '', mono: true });
          else rows.push({ label: 'DS', value: `${ds.name} (${ds.type})` });
        }
        const navId = mapResult.bindingTreeNodeId ?? mapResult.datasourceTreeNodeId;
        const r = { treeNodeId: navId, type: 'model-mapping' };
        resolvedRef.current = r;
        setResolved(r);
        return {
          kind: 'model-mapping',
          title: mapResult.modelPath,
          subtitle: 'Model mapping',
          rows,
          canNavigate: !!navId,
        };
      }

      const bindResult = resolveBinding(segment.fullPath, configIndex);
      if (bindResult) {
        const rows: PathTooltipRow[] = [];
        rows.push({ label: 'Expr', value: bindResult.binding.expressionAsString ?? '', mono: true });
        const dsName = bindResult.binding.expressionAsString?.split('.')[0]?.split('(')[0]?.replace(/['"]/g, '').trim();
        if (dsName) {
          const dsResult = resolveDatasource(dsName, bindResult.configIndex);
          if (dsResult?.datasource) {
            const ds = dsResult.datasource;
            if (ds.tableInfo) rows.push({ icon: 'table', label: 'Table', value: ds.tableInfo.tableName, mono: true });
            else if (ds.enumInfo) rows.push({ icon: 'enum', label: 'Enum', value: formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo), mono: true });
            else if (ds.classInfo) rows.push({ icon: 'class', label: 'Class', value: ds.classInfo.className, mono: true });
            else if (ds.calculatedField) rows.push({ icon: 'calc', label: 'Calc', value: ds.calculatedField.expressionAsString ?? '', mono: true });
          }
        }
        const r = { treeNodeId: bindResult.treeNodeId, type: 'binding' };
        resolvedRef.current = r;
        setResolved(r);
        return {
          kind: 'binding',
          title: bindResult.binding.path,
          subtitle: 'Binding',
          rows,
          canNavigate: !!bindResult.treeNodeId,
        };
      }
      resolvedRef.current = null;
      setResolved(null);
    }
    return null;
  }, [segment, configIndex, configurations, findDatasourceNode, resolveDatasource, resolveBinding, resolveModelPath]);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (!canResolve) return;
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setMousePos({ x: e.clientX, y: e.clientY });
    const tip = doResolve();
    setTooltip(tip);
  }, [canResolve, doResolve]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!canResolve || !tooltip) return;
    setMousePos({ x: e.clientX, y: e.clientY });
  }, [canResolve, tooltip]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    setMousePos(null);
    leaveTimer.current = setTimeout(() => {
      resolvedRef.current = null;
      setResolved(null);
    }, 300);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Stop propagation to prevent parent row from handling the click
    e.stopPropagation();

    // Use ref for immediate access (survives mouseLeave race)
    const r = resolvedRef.current;
    if (r?.treeNodeId) {
      navigateToTreeNode(r.treeNodeId);
      return;
    }
    // If ref is empty, try resolving now as a fallback
    if (canResolve) {
      doResolve();
      const freshR = resolvedRef.current;
      if (freshR?.treeNodeId) {
        navigateToTreeNode(freshR.treeNodeId);
      }
    }
  }, [navigateToTreeNode, canResolve, doResolve]);

  const colorMap: Record<string, string> = {
    identifier: 'var(--syn-identifier)',
    'model-path': 'var(--syn-path)',
    operator: 'var(--syn-operator)',
    literal: 'var(--syn-literal)',
    separator: 'var(--syn-separator)',
  };

  const isResolved = resolved?.treeNodeId != null;

  return (
    <>
      <span
        className={isResolved ? 'clickable-path-segment' : undefined}
        style={{
          color: isResolved ? 'var(--syn-resolved)' : (colorMap[segment.kind] ?? 'var(--text-secondary)'),
          cursor: isResolved ? 'pointer' : undefined,
          textDecoration: isResolved ? 'underline' : undefined,
          textDecorationStyle: isResolved ? 'dotted' as const : undefined,
          textUnderlineOffset: '3px',
        }}
        onMouseEnter={canResolve ? handleMouseEnter : undefined}
        onMouseMove={canResolve ? handleMouseMove : undefined}
        onMouseLeave={canResolve ? handleMouseLeave : undefined}
        onClick={isResolved ? handleClick : undefined}
      >
        {segment.text}
      </span>
      {tooltip && mousePos && (
        <PathTooltipCard data={tooltip} mouse={mousePos} />
      )}
    </>
  );
}
