import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppsListDetailRegular,
  ArrowEnterRegular,
  CursorHoverRegular,
  DataPieRegular,
  DataBarVerticalFilled,
  LinkFilled,
  DocumentFilled,
  CheckmarkCircleRegular,
  ArrowSyncRegular,
} from '@fluentui/react-icons';
import { useAppStore, selectMappingDefinition, lastActiveFormatIndex, getMappingDefinitions, isSplitView, type DesignerPane, type OpenTab } from '../state/store';
import { draggedTabId, isTabDrag } from '../utils/tab-drag';
import { TabStrip } from './TabBar';
import { SPLIT_MAX, SPLIT_MIN, useIsNarrow, useSplitRatio } from '../utils/split-ratio';

/**
 * Below this width two groups side by side are too narrow to read; the strips
 * stack and only the focused group's tab is shown.
 */
const NARROW_SPLIT_WIDTH = 720;

/**
 * The draggable divider between the two groups. Arrow keys move it by 5 %,
 * a double-click puts it back in the middle.
 */
function SplitHandle({ ratio, onChange, container }: {
  ratio: number;
  onChange: (ratio: number) => void;
  container: HTMLElement | null;
}) {
  const [dragging, setDragging] = useState(false);
  const ratioAt = (clientX: number) => {
    const rect = container?.getBoundingClientRect();
    return rect && rect.width > 0 ? (clientX - rect.left) / rect.width : ratio;
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t.splitResize}
      aria-valuemin={Math.round(SPLIT_MIN * 100)}
      aria-valuemax={Math.round(SPLIT_MAX * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      title={t.splitResize}
      className={`designer-split-handle${dragging ? ' designer-split-handle--dragging' : ''}`}
      style={{ left: `${ratio * 100}%` }}
      onPointerDown={e => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={e => { if (dragging) onChange(ratioAt(e.clientX)); }}
      onPointerUp={e => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => onChange(0.5)}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onChange(ratio + (e.key === 'ArrowLeft' ? -0.05 : 0.05));
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          onChange(e.key === 'Home' ? SPLIT_MIN : SPLIT_MAX);
        }
      }}
    />
  );
}
import { ClickablePath } from './ClickablePath';
import { DrillDownBody, DrillDownTrigger } from './DrillDownPanel';
import { PropertyInspector } from './PropertyInspector';
import { t } from '../i18n';
import { getBindingCategoryLabel, getConsultantBindingLabel } from '../utils/consultant-labels';
import { buildFormatBindingPresentation, getFormatBindingCategoryLabel, getFormatBindingDisplayLabel, groupFormatBindingsByCategory } from '../utils/format-binding-display';
import { type ERConfiguration, type ERModelMappingContent, type ERFormatContent } from '@er-visualizer/core';
import { useCoarsePointer } from '../utils/responsive';
import { pruneTabViewState } from '../utils/tab-view-state';
import { ModelDesigner } from './designers/DataModelDesigner';
import { MappingDesigner } from './designers/ModelMappingDesigner';
import { FormatDesigner } from './designers/FormatDesigner';

export type { GroupedDatasourceListHandle } from './designers/DatasourceTree';

/**
 * The definition to render for a ModelMapping config: prefer the definition the
 * user actually selected in the explorer (the mapping node itself or any node
 * under it), then the one the last active format binds to, then the one any
 * loaded format binds to.
 */
function resolveActiveMappingDefinition(version: any, configs: any[], activeNode: any, formatIndex: number | null): any {
  if (activeNode?.type === 'mapping' && activeNode.data) return activeNode.data;
  const definitions: any[] = getMappingDefinitions(version);
  // Multi-definition tree ids look like "cfg-2-mapping-1-binding-5".
  const match = typeof activeNode?.id === 'string'
    ? activeNode.id.match(/^cfg-\d+-mapping-(\d+)(?:-|$)/)
    : null;
  if (match) {
    const definition = definitions[Number(match[1])];
    if (definition) return definition;
  }
  return selectMappingDefinition(version, configs, formatIndex);
}

function getNodeHeaderIcon(node: any): React.ReactNode {
  const kind = node?.data?.kind ?? node?.data?.content?.kind;
  const nodeType = node?.type;

  if (kind === 'DataModel') return <DataBarVerticalFilled fontSize={14} />;
  if (kind === 'ModelMapping') return <LinkFilled fontSize={14} />;
  if (kind === 'Format') return <DocumentFilled fontSize={14} />;

  if (nodeType === 'mapping' || nodeType === 'binding' || nodeType === 'formatBinding') {
    return <LinkFilled fontSize={14} />;
  }

  if (nodeType === 'validation') {
    return <CheckmarkCircleRegular fontSize={14} />;
  }

  if (nodeType === 'transformation') {
    return <ArrowSyncRegular fontSize={14} />;
  }

  if (
    nodeType === 'datasource'
    || nodeType === 'field'
    || nodeType === 'container'
    || nodeType === 'enum'
    || nodeType === 'enumValue'
    || nodeType === 'model'
  ) {
    return <DataBarVerticalFilled fontSize={14} />;
  }

  return <DocumentFilled fontSize={14} />;
}

export function DesignerView() {
  const activeTabId = useAppStore(s => s.activeTabId);
  const splitTabId = useAppStore(s => s.splitTabId);
  const tabs = useAppStore(s => s.openTabs);
  const configs = useAppStore(s => s.configurations);
  const treeNodes = useAppStore(s => s.treeNodes);
  const selectedNode = useAppStore(s => s.selectedNode);
  const formatIndex = useAppStore(lastActiveFormatIndex);
  const focusedPane = useAppStore(s => s.focusedPane);
  const focusPane = useAppStore(s => s.focusPane);
  const moveTabToPane = useAppStore(s => s.moveTabToPane);
  const draggingTabId = useAppStore(s => s.draggingTabId);
  const setDraggingTab = useAppStore(s => s.setDraggingTab);
  const splitView = useAppStore(isSplitView);
  const [dropZone, setDropZone] = useState<DesignerPane | null>(null);
  const [splitRatio, setSplitRatio] = useSplitRatio();
  // Callback ref: the grid mounts only once a tab is open.
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const narrow = useIsNarrow(gridEl, NARROW_SPLIT_WIDTH);
  const coarse = useCoarsePointer();
  const openHint = coarse ? t.openInExplorerTouch : t.openInExplorer;

  useEffect(() => { pruneTabViewState(tabs.map(tb => tb.id)); }, [tabs]);

  // A drag that ends anywhere — dropped outside, cancelled with Esc — takes
  // the drop zones down with it.
  useEffect(() => {
    if (!draggingTabId) {
      setDropZone(null);
      return;
    }
    const end = () => setDraggingTab(null);
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  }, [draggingTabId, setDraggingTab]);

  /* What each tab was focused on while it was on screen. A tab in the
     background keeps that focus instead of following the selection around —
     its designer would otherwise re-run its "reveal this node" effects for
     selections made in some other tab. */
  const focusByTab = useRef(new Map<string, any>());

  if (!activeTabId) {
    return (
      <div className="designer-empty-state">
        <div className="designer-empty-card" role="region" aria-live="polite">
          <div className="designer-empty-card__header">
            <div className="designer-empty-card__icon" aria-hidden>
              <DataPieRegular fontSize={20} />
            </div>
            <div className="designer-empty-card__titles">
              <div className="designer-empty-card__eyebrow">{t.designerWorkspaceEyebrow}</div>
              <h2 className="designer-empty-card__title">{t.noSelection}</h2>
            </div>
          </div>

          <p className="designer-empty-card__text">{t.selectElementHint}</p>

          <div className="designer-empty-card__steps" aria-label={openHint}>
            <div className="designer-empty-step">
              <span className="designer-empty-step__icon" aria-hidden><AppsListDetailRegular fontSize={14} /></span>
              <span className="designer-empty-step__text">{t.explorer}</span>
            </div>
            <span className="designer-empty-step__arrow" aria-hidden><ArrowEnterRegular fontSize={12} /></span>
            <div className="designer-empty-step">
              <span className="designer-empty-step__icon" aria-hidden><CursorHoverRegular fontSize={14} /></span>
              <span className="designer-empty-step__text">{openHint}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const split = splitView && tabs.some(tab => tab.id === splitTabId);
  const dropZones: DesignerPane[] = ['main', 'side'];
  const groups: DesignerPane[] = split ? ['main', 'side'] : ['main'];

  /* Every open tab stays mounted; only the one shown in each group is
     visible. Switching tabs used to unmount the designer, so a filter, the
     scroll position or an opened branch were gone on the way back. Each group
     has its own tab strip above its column, as in an IDE. */
  return (
    <div
      ref={setGridEl}
      className={`designer-tabs${split ? ' designer-tabs--split' : ''}${split && narrow ? ' designer-tabs--narrow' : ''}`}
      data-focused-pane={split ? focusedPane : undefined}
      style={split && !narrow
        ? { gridTemplateColumns: `minmax(0, ${splitRatio}fr) minmax(0, ${1 - splitRatio}fr)` }
        : undefined}
    >
      {split && !narrow && (
        <SplitHandle ratio={splitRatio} onChange={setSplitRatio} container={gridEl} />
      )}
      {groups.map(pane => (
        <div
          key={`strip-${pane}`}
          className={`designer-group-strip designer-group-strip--${pane}${split && focusedPane === pane ? ' designer-group-strip--focused' : ''}`}
          onPointerDownCapture={split ? () => focusPane(pane) : undefined}
        >
          <TabStrip pane={pane} />
        </div>
      ))}
      {tabs.map(tab => {
        const slot = tab.id === activeTabId ? 'main' : (split && tab.id === splitTabId ? 'side' : 'hidden');
        const live = slot !== 'hidden';
        // Stacked (narrow) split: only the focused group's tab is on screen.
        const onScreen = live && !(split && narrow && slot !== focusedPane);
        const focused = split && slot === focusedPane;
        const tabNode = findTreeNodeById(treeNodes, tab.id);
        if (live) {
          focusByTab.current.set(tab.id, selectedNode?.configIndex === tab.configIndex ? selectedNode : tabNode);
        }
        const focusNode = focusByTab.current.get(tab.id) ?? tabNode;
        return (
          <section
            key={tab.id}
            className={`designer-tab-pane designer-tab-pane--${slot}${focused ? ' designer-tab-pane--focused' : ''}`}
            aria-hidden={onScreen ? undefined : true}
            inert={onScreen ? undefined : true}
            // Whatever is picked next — an explorer node, a search hit, a
            // drill-down — opens in the group the user last worked in.
            onPointerDownCapture={split && live ? () => focusPane(slot as DesignerPane) : undefined}
            onFocusCapture={split && live ? () => focusPane(slot as DesignerPane) : undefined}
          >
            <div className="designer-tab-pane__body">
              <TabContent
                tab={tab}
                config={configs[tab.configIndex]}
                configs={configs}
                tabNode={tabNode}
                focusNode={focusNode}
                formatIndex={formatIndex}
              />
            </div>
          </section>
        );
      })}
      {draggingTabId && (
        <div
          className="designer-drop-zones"
          // The halves line up with the groups, whatever their ratio.
          style={split && !narrow
            ? { gridTemplateColumns: `minmax(0, ${splitRatio}fr) minmax(0, ${1 - splitRatio}fr)` }
            : undefined}
        >
          {dropZones.map(zone => (
            <div
              key={zone}
              className={`designer-drop-zone${dropZone === zone ? ' designer-drop-zone--over' : ''}`}
              onDragOver={e => {
                if (!isTabDrag(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropZone !== zone) setDropZone(zone);
              }}
              onDragLeave={() => setDropZone(current => (current === zone ? null : current))}
              onDrop={e => {
                const id = draggedTabId(e);
                if (!id) return;
                e.preventDefault();
                moveTabToPane(id, zone);
                setDraggingTab(null);
              }}
            >
              <span className="designer-drop-zone__label">
                {split
                  ? (zone === 'main' ? t.splitMoveLeft : t.splitMoveRight)
                  : (zone === 'main' ? t.splitOpenLeft : t.splitOpenRight)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One tab's designer. Memoised so the tabs in the background do not re-render
 * with every selection change in the one on screen — their props only change
 * when their own configuration does.
 */
const TabContent = React.memo(function TabContent({ tab, config, configs, tabNode, focusNode, formatIndex }: {
  tab: OpenTab;
  config: ERConfiguration | undefined;
  configs: ERConfiguration[];
  tabNode: any;
  focusNode: any;
  formatIndex: number | null;
}) {
  if (!config) return null;

  // Drill-down tabs carry their own expression/element — render the drill-down body directly
  if (tab.kind === 'drillDown') {
    return (
      <div className="drilldown-tab-host">
        <DrillDownBody
          expression={tab.expression}
          configIndex={tab.configIndex}
          elementName={tab.elementName}
          variant="tab"
        />
      </div>
    );
  }

  if (tabNode && tabNode.type !== 'file') {
    return <FocusedNodeTab node={tabNode} />;
  }

  if (config.kind === 'DataModel') return <ModelDesigner config={config} focusNode={focusNode} />;
  if (config.kind === 'ModelMapping') return <MappingDesigner tabId={tab.id} mapping={resolveActiveMappingDefinition((config.content as ERModelMappingContent).version, configs, focusNode, formatIndex)} configIndex={tab.configIndex} focusNode={focusNode} />;
  if (config.kind === 'Format') return <FormatDesigner tabId={tab.id} config={config} configIndex={tab.configIndex} focusNode={focusNode} />;

  return <div style={{ padding: 16 }}>{t.designerUnsupportedView(config.kind)}</div>;
});

function FocusedNodeTab({ node }: { node: any }) {
  const configs = useAppStore(s => s.configurations);
  const selectedNode = useAppStore(s => s.selectedNode);
  const formatIndex = useAppStore(lastActiveFormatIndex);
  const focusNode = selectedNode?.configIndex === node.configIndex ? selectedNode : node;
  const config = node.configIndex != null ? configs[node.configIndex] : null;

  if (!config || node.configIndex == null) {
    return (
      <div className="focused-node-tab">
        <div className="focused-node-tab-header">
          <span className="focused-node-tab-icon">{getNodeHeaderIcon(node)}</span>
          <span className="focused-node-tab-title">{node.name}</span>
        </div>
        <div className="focused-node-tab-body">
          <PropertyInspector nodeOverride={node} />
        </div>
      </div>
    );
  }

  if (node.type === 'mapping' && node.configIndex != null) {
    return <MappingDesigner mapping={node.data} configIndex={node.configIndex} focusNode={focusNode} />;
  }

  // After collapsing the redundant inner wrapper, the configuration
  // root itself (`type: 'file'`) is the entry point for the designer.
  // Dispatch on `config.kind` so clicking the configuration row in
  // the explorer opens the same view as before.
  if (node.type === 'file' && config.kind === 'DataModel') {
    return <ModelDesigner config={config} focusNode={focusNode} />;
  }
  if (node.type === 'file' && config.kind === 'ModelMapping' && node.configIndex != null) {
    const mappingContent = config.content as { version?: { mapping?: unknown } };
    const mapping = mappingContent.version ? resolveActiveMappingDefinition(mappingContent.version, configs, focusNode, formatIndex) : undefined;
    if (mapping) {
      return <MappingDesigner mapping={mapping} configIndex={node.configIndex} focusNode={focusNode} />;
    }
  }
  if (node.type === 'file' && config.kind === 'Format') {
    return <FormatDesigner config={config} configIndex={node.configIndex} focusNode={focusNode} />;
  }

  if (node.type === 'formatElement' && config.kind === 'Format') {
    return <FormatElementFocusTab node={node} configIndex={node.configIndex} />;
  }

  return (
    <div className="focused-node-tab">
      <div className="focused-node-tab-header">
        <span className="focused-node-tab-icon">{getNodeHeaderIcon(node)}</span>
        <span className="focused-node-tab-title">{node.name}</span>
      </div>
      <div className="focused-node-tab-body">
        <PropertyInspector nodeOverride={node} />
      </div>
    </div>
  );
}

function FormatElementFocusTab({ node, configIndex }: { node: any; configIndex: number }) {
  const configs = useAppStore(s => s.configurations);
  const showTechnicalDetails = useAppStore(s => s.showTechnicalDetails);
  const navigateToTreeNode = useAppStore(s => s.navigateToTreeNode);

  const { bindings, categories } = useMemo(() => {
    const cfg = configs[configIndex];
    if (!cfg || cfg.content.kind !== 'Format') return { bindings: [] as any[], categories: [] as any[] };
    const fc = cfg.content as ERFormatContent;
    const presentation = buildFormatBindingPresentation(fc.formatVersion.format.rootElement, fc.formatMappingVersion.formatMapping.bindings);
    const b = presentation.bindingMap.get(node.data.id) ?? [];
    return { bindings: b, categories: groupFormatBindingsByCategory(b) };
  }, [configs, configIndex, node.data.id]);

  const childTreeNodes = (node.children ?? []).filter((c: any) => c.type === 'formatElement');

  return (
    <div className="focused-node-tab">
      <div className="focused-node-tab-body">
        {bindings.length === 0 && childTreeNodes.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 12 }}>
            {t.bindings}: 0
          </div>
        )}

        {bindings.length > 0 && (
          <div className="property-section">
            <div className="property-section-title">{t.bindings} ({bindings.length})</div>
            {categories.map(category => (
              <div key={category.key}>
                {categories.length > 1 && (
                  <div className="fmt-detail-subsection-title">
                    {showTechnicalDetails ? getFormatBindingCategoryLabel(category.key) : getBindingCategoryLabel(category.key)} ({category.bindings.length})
                  </div>
                )}
                {category.bindings.map((b: any, i: number) => (
                  <div key={`${category.key}-${i}`} className="fmt-detail-binding">
                    <span className={`badge ${category.key === 'data' ? 'badge-success' : 'badge-prop'}`} style={{ marginRight: 6 }}>
                      {showTechnicalDetails ? getFormatBindingDisplayLabel(b) : getConsultantBindingLabel(b)}
                    </span>
                    {showTechnicalDetails && b.promotedFromChild && b.rawElementType && (
                      <span className="fmt-binding-origin">{t.bindingVia} {b.rawElementType}</span>
                    )}
                    <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 11 }}>
                      <DrillDownTrigger
                        expression={b.expressionAsString}
                        configIndex={configIndex}
                        elementName={node.data.name}
                      >
                        <ClickablePath expression={b.expressionAsString} configIndex={configIndex} mode="binding-expr" interactive={false} />
                      </DrillDownTrigger>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {childTreeNodes.length > 0 && (
          <div className="property-section">
            <div className="property-section-title">{t.propChildren} ({childTreeNodes.length})</div>
            {childTreeNodes.map((child: any) => (
              <div
                key={child.id}
                className="fmt-detail-child"
                onClick={() => navigateToTreeNode(child.id)}
              >
                <span style={{ marginRight: 6 }}>{child.icon}</span>
                <span>{child.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function findTreeNodeById(nodes: any[], id: string): any | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findTreeNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}
