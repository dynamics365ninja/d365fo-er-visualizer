/**
 * The explorer's sections (data models, model mappings, formats) as VS Code
 * lays out its views: in an order the user sets — by dragging a header or
 * moving it up and down — with the open ones on top and the collapsed ones
 * docked at the bottom. Both the order and what is collapsed are remembered.
 */

export type SectionKind = 'DataModel' | 'ModelMapping' | 'Format';

export const DEFAULT_SECTION_ORDER: readonly SectionKind[] = ['DataModel', 'ModelMapping', 'Format'];

export interface SectionLayout {
  order: SectionKind[];
  collapsed: SectionKind[];
}

const STORAGE_KEY = 'er-visualizer.explorer.sections.v1';

function isKind(value: unknown): value is SectionKind {
  return value === 'DataModel' || value === 'ModelMapping' || value === 'Format';
}

/** A stored layout made whole: unknown entries dropped, duplicates removed, missing kinds appended in the default order. */
export function sanitizeSectionLayout(value: unknown): SectionLayout {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof SectionLayout, unknown>>;
  const order = [...new Set((Array.isArray(raw.order) ? raw.order : []).filter(isKind))];
  for (const kind of DEFAULT_SECTION_ORDER) if (!order.includes(kind)) order.push(kind);
  const collapsed = [...new Set((Array.isArray(raw.collapsed) ? raw.collapsed : []).filter(isKind))];
  return { order, collapsed };
}

export function loadSectionLayout(): SectionLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return sanitizeSectionLayout(raw ? JSON.parse(raw) : undefined);
  } catch {
    return sanitizeSectionLayout(undefined);
  }
}

export function saveSectionLayout(layout: SectionLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage full or blocked: the layout lasts for this session only.
  }
}

/** The sections shown, in order: the open ones on top, the collapsed ones docked below them. */
export function arrangeSections<K extends SectionKind>(
  shown: readonly K[],
  isCollapsed: (kind: K) => boolean,
): { open: K[]; docked: K[] } {
  return {
    open: shown.filter(kind => !isCollapsed(kind)),
    docked: shown.filter(kind => isCollapsed(kind)),
  };
}

/** Put `kind` right before or after `target` in the order. */
export function dropSection(order: readonly SectionKind[], kind: SectionKind, target: SectionKind, place: 'before' | 'after'): SectionKind[] {
  if (kind === target) return [...order];
  const rest = order.filter(k => k !== kind);
  const at = rest.indexOf(target);
  if (at < 0) return [...order];
  rest.splice(place === 'before' ? at : at + 1, 0, kind);
  return rest;
}

/**
 * Move `kind` one place up (`-1`) or down (`+1`) among `neighbours` — the
 * sections it is shown with (the open ones, or the docked ones), so a move
 * always changes what is on screen. Unchanged at either end.
 */
export function moveSection(order: readonly SectionKind[], kind: SectionKind, delta: -1 | 1, neighbours: readonly SectionKind[]): SectionKind[] {
  const at = neighbours.indexOf(kind);
  const target = neighbours[at + delta];
  if (at < 0 || !target) return [...order];
  return dropSection(order, kind, target, delta < 0 ? 'before' : 'after');
}
