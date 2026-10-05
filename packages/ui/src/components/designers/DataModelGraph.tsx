import React, { useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import { BoxRegular, HomeRegular, TextCaseTitleRegular } from '@fluentui/react-icons';
import { t } from '../../i18n';
import { fieldTypeLabel } from './shared';

const NODE_W = 280;
const NODE_H_HEAD = 30;
const NODE_H_FIELD = 20;
const NODE_PAD = 10;
const MAX_FIELDS = 14;
const H_GAP = 60;
const V_GAP = 80;

type ContainerKind = 'root' | 'enum' | 'record';

interface FieldRow {
  name: string;
  /** Target container name or field type, shown with technical details on. */
  detail: string;
  isReference: boolean;
}

type ModelNodeData = {
  name: string;
  kind: ContainerKind;
  fieldCount: number;
  fields: FieldRow[];
  showTechnicalDetails: boolean;
};

type ModelNode = Node<ModelNodeData, 'modelContainer'>;

function kindOf(container: any): ContainerKind {
  return container.isRoot ? 'root' : container.isEnum ? 'enum' : 'record';
}

/** Matches what the node draws: the header, at most MAX_FIELDS rows, and a "+N more" row. */
function nodeHeight(container: any): number {
  const rows = Math.min(container.items.length, MAX_FIELDS) + (container.items.length > MAX_FIELDS ? 1 : 0);
  return NODE_H_HEAD + rows * NODE_H_FIELD + NODE_PAD;
}

/** Hierarchical left-to-right layout: roots first, referenced records by depth, enums last. */
function layoutContainers(containers: any[]): Map<string, { x: number; y: number }> {
  const known = new Set(containers.map(c => c.id));
  const children = new Map<string, string[]>();
  for (const c of containers) {
    const targets = new Set<string>();
    for (const item of c.items) {
      if (item.typeDescriptor && known.has(item.typeDescriptor)) targets.add(item.typeDescriptor);
    }
    if (targets.size) children.set(c.id, [...targets]);
  }

  const level = new Map<string, number>();
  const queue: { id: string; lv: number }[] = containers.filter(c => c.isRoot).map(c => ({ id: c.id, lv: 0 }));
  for (let head = 0; head < queue.length; head++) {
    const { id, lv } = queue[head];
    if (level.has(id)) continue;
    level.set(id, lv);
    for (const child of children.get(id) ?? []) {
      if (!level.has(child)) queue.push({ id: child, lv: lv + 1 });
    }
  }

  let maxLevel = -1;
  for (const lv of level.values()) maxLevel = Math.max(maxLevel, lv);
  // Records no root reaches share one column after the reachable ones.
  const orphanLevel = maxLevel + 1;
  for (const c of containers) {
    if (!c.isEnum && !level.has(c.id)) level.set(c.id, orphanLevel);
  }
  const enumLevel = Math.max(...level.values(), 0) + 1;

  const colWidth = NODE_W + H_GAP;
  const nextY = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const c of containers) {
    const lv = c.isEnum ? enumLevel : level.get(c.id)!;
    const y = nextY.get(lv) ?? 0;
    positions.set(c.id, { x: lv * colWidth, y });
    nextY.set(lv, y + nodeHeight(c) + V_GAP);
  }
  return positions;
}

function buildGraph(containers: any[], showTechnicalDetails: boolean): { nodes: ModelNode[]; edges: Edge[] } {
  const names = new Map<string, string>(containers.map(c => [c.id, c.name]));
  const positions = layoutContainers(containers);
  const nodes: ModelNode[] = [];
  const edges: Edge[] = [];

  for (const container of containers) {
    nodes.push({
      id: container.id,
      type: 'modelContainer',
      position: positions.get(container.id) ?? { x: 0, y: 0 },
      // Dimensions up front: the minimap draws nodes before they are measured.
      width: NODE_W,
      height: nodeHeight(container),
      data: {
        name: container.name,
        kind: kindOf(container),
        fieldCount: container.items.length,
        fields: container.items.slice(0, MAX_FIELDS).map((f: any) => ({
          name: f.name,
          detail: f.typeDescriptor
            ? `→ ${names.get(f.typeDescriptor) ?? f.typeDescriptor.slice(1, 9)}`
            : fieldTypeLabel(f.type),
          isReference: Boolean(f.typeDescriptor),
        })),
        showTechnicalDetails,
      },
    });

    for (const item of container.items) {
      if (!item.typeDescriptor || !names.has(item.typeDescriptor)) continue;
      // Record lists stand out by weight and colour; an animated dash would
      // repaint the whole canvas every frame.
      const kindClass = item.type === 11 ? 'dm-edge--list' : item.type === 10 ? 'dm-edge--record' : '';
      edges.push({
        id: `${container.id}-${item.name}-${item.typeDescriptor}`,
        source: container.id,
        target: item.typeDescriptor,
        label: item.name,
        className: `dm-edge ${kindClass}`.trim(),
        type: 'smoothstep',
        focusable: false,
      });
    }
  }
  return { nodes, edges };
}

const KIND_ICON: Record<ContainerKind, React.ReactNode> = {
  root: <HomeRegular fontSize={14} />,
  enum: <TextCaseTitleRegular fontSize={14} />,
  record: <BoxRegular fontSize={14} />,
};

const ModelContainerNode = React.memo(function ModelContainerNode({ data, selected }: NodeProps<ModelNode>) {
  const { name, kind, fieldCount, fields, showTechnicalDetails } = data;
  return (
    <div className={`dm-node dm-node--${kind}${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="dm-node__handle" />
      <div className="dm-node__head">
        <span className="dm-node__icon" aria-hidden>{KIND_ICON[kind]}</span>
        <span className="dm-node__name">{name}</span>
        {kind === 'root' && <span className="dm-node__badge dm-node__badge--root">{t.modelRootBadge}</span>}
        {kind === 'enum' && <span className="dm-node__badge dm-node__badge--enum">{t.modelEnumBadge}</span>}
        <span className="dm-node__count">{t.statsFields(fieldCount)}</span>
      </div>
      <div className="dm-node__fields">
        {fields.map((f, i) => (
          <div key={i} className="dm-node__field">
            <span className="dm-node__field-name">{f.name}</span>
            {showTechnicalDetails && (
              <span className={`dm-node__field-type${f.isReference ? ' is-reference' : ''}`}>{f.detail}</span>
            )}
          </div>
        ))}
        {fieldCount > MAX_FIELDS && <div className="dm-node__more">{t.moreFields(fieldCount - MAX_FIELDS)}</div>}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} className="dm-node__handle" />
    </div>
  );
});

const NODE_TYPES = { modelContainer: ModelContainerNode };

const MINIMAP_COLOR: Record<ContainerKind, string> = {
  root: 'var(--er-model)',
  enum: 'var(--er-format)',
  record: 'var(--er-mapping)',
};

const minimapColor = (node: Node) => MINIMAP_COLOR[(node.data as ModelNodeData).kind] ?? 'var(--er-border-strong)';

function withSelection(nodes: ModelNode[], selectedId: string | null): ModelNode[] {
  // Untouched nodes keep their identity, so only the two that change re-render.
  return nodes.map(n => {
    const selected = n.id === selectedId;
    return Boolean(n.selected) === selected ? n : { ...n, selected };
  });
}

export function DataModelGraph({ containers, selectedId, showTechnicalDetails }: {
  containers: any[];
  /** Container to highlight, following navigation in the explorer. */
  selectedId: string | null;
  showTechnicalDetails: boolean;
}) {
  const graph = useMemo(() => buildGraph(containers, showTechnicalDetails), [containers, showTechnicalDetails]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ModelNode>(withSelection(graph.nodes, selectedId));

  // A rebuilt model resets the layout; the latest selection is applied on top.
  const selectedRef = React.useRef(selectedId);
  selectedRef.current = selectedId;
  useEffect(() => {
    setNodes(withSelection(graph.nodes, selectedRef.current));
  }, [graph, setNodes]);

  useEffect(() => {
    setNodes(current => withSelection(current, selectedId));
  }, [selectedId, setNodes]);

  return (
    <ReactFlow
      className="dm-graph"
      nodes={nodes}
      edges={graph.edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      fitView
      minZoom={0.1}
      nodesConnectable={false}
      nodesDraggable
      edgesFocusable={false}
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
    >
      <Background color="var(--er-border)" gap={20} variant={'dots' as any} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        className="er-minimap"
        maskColor="color-mix(in srgb, var(--er-bg-soft) 72%, transparent)"
        /* Full-strength kind hues: the soft surface tints used before were
           within a shade of the minimap background, so it read as empty. */
        nodeColor={minimapColor}
      />
    </ReactFlow>
  );
}
