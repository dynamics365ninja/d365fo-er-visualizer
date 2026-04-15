import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useAppStore, resolveDeepExpression } from '../state/store';
import { formatEnumDisplayName } from '../utils/enum-display';

interface ClickablePathProps {
  /** The expression or path string, e.g. "model.CompanyInfo.Name" or "CompanyInfo.'name()'" */
  expression: string;
  /** Config index for context when resolving datasources */
  configIndex: number;
  /** What kind of references to resolve */
  mode?: 'binding-expr' | 'model-path' | 'auto';
  style?: React.CSSProperties;
}

/**
 * Renders an expression string with clickable segments.
 * Datasource names and model paths are resolved on hover.
 * If a reference resolves, it becomes clickable with a tooltip.
 */
export function ClickablePath({ expression, configIndex, mode = 'auto', style }: ClickablePathProps) {
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
        segments.push({ text: token, kind: 'literal' });
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
  resolveDatasource: (name: string, ci: number) => any;
  resolveBinding: (path: string, ci: number) => any;
  resolveModelPath: (modelDotPath: string) => any;
  findDatasourceNode: (name: string, ci: number, parentPath?: string) => string | null;
  navigateToTreeNode: (nodeId: string) => void;
}

function SmartSegment({ segment, configIndex, resolveDatasource, resolveBinding, resolveModelPath, findDatasourceNode, navigateToTreeNode }: SmartSegmentProps) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [resolved, setResolved] = useState<{ treeNodeId: string | null; type: string } | null>(null);
  const resolvedRef = useRef<{ treeNodeId: string | null; type: string } | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configurations = useAppStore(s => s.configurations);

  const canResolve = segment.kind === 'identifier' || segment.kind === 'model-path';

  const doResolve = useCallback(() => {
    if (segment.kind === 'identifier') {
      const referencePath = segment.fullPath ?? segment.lookupText ?? segment.text;
      const deepResult = resolveDeepExpression(referencePath, configurations, configIndex);
      const rootSegment = referencePath.split('.')[0] ?? referencePath;

      // First try direct datasource resolution (for format/mapping local DS)
      const dsResult = resolveDatasource(rootSegment, configIndex);
      const resolvedDatasource = deepResult?.nestedDs ?? deepResult?.rootDs ?? dsResult?.datasource;
      const datasourceConfigIndex = deepResult?.rootDsConfigIndex ?? dsResult?.configIndex ?? configIndex;

      if (resolvedDatasource) {
        const ds = resolvedDatasource;
        const info = ds.tableInfo ? `Table: ${ds.tableInfo.tableName}` :
          ds.enumInfo ? `Enum: ${formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo)}` :
          ds.classInfo ? `Class: ${ds.classInfo.className}` :
          ds.calculatedField ? `Calc: ${ds.calculatedField.expressionAsString?.substring(0, 50)}` :
          ds.userParamInfo ? `User Param: ${ds.userParamInfo.extendedDataTypeName ?? ds.name}` :
          `Type: ${ds.type}`;

        const treeNodeId = findDatasourceNode(ds.name, datasourceConfigIndex, ds.parentPath)
          ?? dsResult?.treeNodeId
          ?? null;

        const lines: string[] = [`📊 ${ds.name}`, info];
        if (deepResult?.nestedDs && deepResult.rootDs && deepResult.nestedDs !== deepResult.rootDs) {
          lines.push(`↳ Nested under: ${deepResult.rootDs.name}`);
        }
        if (deepResult) {
          const tables = deepResult.involvedDatasources.filter(d => d.tableName);
          const classes = deepResult.involvedDatasources.filter(d => d.className);
          const enums = deepResult.involvedDatasources.filter(d => d.enumName);
          if (tables.length > 0) lines.push(`🗃️ Tables: ${tables.map(t => t.tableName).join(', ')}`);
          if (classes.length > 0) lines.push(`⚙️ Classes: ${classes.map(c => c.className).join(', ')}`);
          if (enums.length > 0) lines.push(`🔤 Enums: ${enums.map(e => formatEnumDisplayName(e.enumName!, e)).join(', ')}`);
          if (deepResult.calculatedFieldChain.length > 0) lines.push(`🧮 ${deepResult.calculatedFieldChain.length} calc field(s) in chain`);
        }

        const r = { treeNodeId, type: 'datasource' };
        resolvedRef.current = r;
        setResolved(r);
        lines.push(treeNodeId ? 'Click to navigate →' : '');
        return lines.filter(Boolean).join('\n');
      }

      // Try model path resolution if this looks like a model reference
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
      // First try model mapping resolution to find actual datasource
      const mapResult = resolveModelPath(segment.fullPath);
      if (mapResult) {
        const lines: string[] = [];
        lines.push(`🔗 Model path: ${mapResult.modelPath}`);
        lines.push(`📋 Mapping expr: ${mapResult.binding.expressionAsString}`);
        if (mapResult.datasource) {
          const ds = mapResult.datasource;
          if (ds.tableInfo) lines.push(`🗃️ Table: ${ds.tableInfo.tableName}`);
          else if (ds.enumInfo) lines.push(`🔤 Enum: ${formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo)}`);
          else if (ds.classInfo) lines.push(`⚙️ Class: ${ds.classInfo.className}`);
          else if (ds.calculatedField) lines.push(`🧮 Calc: ${ds.calculatedField.expressionAsString?.substring(0, 60)}`);
          else lines.push(`📊 DS: ${ds.name} (${ds.type})`);
        }
        // Navigate to the binding node in the mapping config
        const navId = mapResult.datasourceTreeNodeId ?? mapResult.bindingTreeNodeId;
        const r = { treeNodeId: navId, type: 'model-mapping' };
        resolvedRef.current = r;
        setResolved(r);
        lines.push(navId ? 'Click to navigate →' : '');
        return lines.filter(Boolean).join('\n');
      }

      // Fallback: try resolveBinding directly
      const bindResult = resolveBinding(segment.fullPath, configIndex);
      if (bindResult) {
        const lines: string[] = [];
        lines.push(`🔗 Binding: ${bindResult.binding.path}`);
        lines.push(`Expr: ${bindResult.binding.expressionAsString?.substring(0, 60)}`);
        // Also resolve the datasource from the binding expression
        const dsName = bindResult.binding.expressionAsString?.split('.')[0]?.split('(')[0]?.replace(/['"]/g, '').trim();
        if (dsName) {
          const dsResult = resolveDatasource(dsName, bindResult.configIndex);
          if (dsResult?.datasource) {
            const ds = dsResult.datasource;
            if (ds.tableInfo) lines.push(`🗃️ Table: ${ds.tableInfo.tableName}`);
            else if (ds.enumInfo) lines.push(`🔤 Enum: ${formatEnumDisplayName(ds.enumInfo.enumName, ds.enumInfo)}`);
            else if (ds.classInfo) lines.push(`⚙️ Class: ${ds.classInfo.className}`);
            else if (ds.calculatedField) lines.push(`🧮 Calc: ${ds.calculatedField.expressionAsString?.substring(0, 60)}`);
          }
        }
        const r = { treeNodeId: bindResult.treeNodeId, type: 'binding' };
        resolvedRef.current = r;
        setResolved(r);
        lines.push(bindResult.treeNodeId ? 'Click to navigate →' : '');
        return lines.filter(Boolean).join('\n');
      }
      resolvedRef.current = null;
      setResolved(null);
    }
    return null;
  }, [segment, configIndex, configurations, findDatasourceNode, resolveDatasource, resolveBinding, resolveModelPath]);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (!canResolve) return;
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }

    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ x: rect.left, y: rect.bottom + 4 });

    const tip = doResolve();
    setTooltip(tip);
  }, [canResolve, doResolve]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    setTooltipPos(null);
    // Delay clearing resolved so click handler can still access it
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
        onMouseLeave={canResolve ? handleMouseLeave : undefined}
        onClick={isResolved ? handleClick : undefined}
      >
        {segment.text}
      </span>
      {tooltip && tooltipPos && (
        <div
          className="path-tooltip"
          style={{
            position: 'fixed',
            left: tooltipPos.x,
            top: tooltipPos.y,
            zIndex: 9999,
          }}
        >
          {tooltip.split('\n').map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </>
  );
}
