import type { DragEvent } from 'react';

/**
 * Drag payload of a designer tab — from the tab strip or a pane header — so
 * the panes and the tab strip accept it and nothing else (files dropped to be
 * loaded keep going to the app).
 */
export const TAB_DRAG_TYPE = 'application/x-er-designer-tab';

export function startTabDrag(e: DragEvent, tabId: string): void {
  e.dataTransfer.setData(TAB_DRAG_TYPE, tabId);
  e.dataTransfer.effectAllowed = 'move';
}

export function isTabDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(TAB_DRAG_TYPE);
}

export function draggedTabId(e: DragEvent): string | null {
  return e.dataTransfer.getData(TAB_DRAG_TYPE) || null;
}
