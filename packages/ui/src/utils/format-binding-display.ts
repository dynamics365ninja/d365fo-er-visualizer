import type { ERFormatBinding, ERFormatElement } from '@er-visualizer/core';

export type FormatBindingCategory = 'data' | 'visibility' | 'formatting' | 'property';

export interface NormalizedFormatBinding extends ERFormatBinding {
  rawComponentId: string;
  rawElementName?: string;
  rawElementType?: string;
  bindingCategory: FormatBindingCategory;
  bindingCategoryLabel: string;
  bindingDisplayLabel: string;
  promotedFromChild: boolean;
}

export interface FormatBindingCategoryGroup {
  key: FormatBindingCategory;
  label: string;
  bindings: NormalizedFormatBinding[];
}

export interface NormalizedFormatBindingGroup {
  componentId: string;
  elementName: string;
  elementType: string;
  bindings: NormalizedFormatBinding[];
  dataBindings: NormalizedFormatBinding[];
  categories: FormatBindingCategoryGroup[];
}

interface IndexedFormatElement {
  id: string;
  normalizedId: string;
  name: string;
  elementType: string;
  parentId?: string;
  childIds: string[];
}

const DATA_BINDING_PROPS = new Set(['', 'value', 'data']);
const VALUE_ELEMENT_TYPES = new Set(['String', 'Numeric', 'DateTime', 'Base64']);

const categoryLabels: Record<FormatBindingCategory, string> = {
  data: 'Data',
  visibility: 'Visibility',
  formatting: 'Formatting',
  property: 'Other Properties',
};

export function normalizeGuid(id: string): string {
  return id.replace(/^\{/, '').replace(/\}.*$/, '').replace(/,.*$/, '').toLowerCase();
}

export function classifyFormatBindingCategory(binding: Pick<ERFormatBinding, 'propertyName'>): FormatBindingCategory {
  const propertyName = (binding.propertyName ?? '').trim().toLowerCase();

  if (DATA_BINDING_PROPS.has(propertyName)) {
    return 'data';
  }

  if (['enabled', 'visible', 'disabled', 'printable', 'active'].includes(propertyName)) {
    return 'visibility';
  }

  if (['format', 'encoding', 'transformation', 'locale', 'separator', 'decimalseparator', 'groupseparator', 'mask'].includes(propertyName)) {
    return 'formatting';
  }

  return 'property';
}

export function groupFormatBindingsByCategory(bindings: NormalizedFormatBinding[]): FormatBindingCategoryGroup[] {
  const grouped = new Map<FormatBindingCategory, NormalizedFormatBinding[]>();

  for (const binding of bindings) {
    const existing = grouped.get(binding.bindingCategory) ?? [];
    existing.push(binding);
    grouped.set(binding.bindingCategory, existing);
  }

  const order: FormatBindingCategory[] = ['data', 'visibility', 'formatting', 'property'];
  return order
    .filter(key => grouped.has(key))
    .map(key => ({ key, label: categoryLabels[key], bindings: grouped.get(key) ?? [] }));
}

export function buildFormatBindingPresentation(rootElement: ERFormatElement, rawBindings: ERFormatBinding[]) {
  const elementIndex = indexFormatElements(rootElement);
  const bindingMap = new Map<string, NormalizedFormatBinding[]>();

  for (const binding of rawBindings) {
    const rawInfo = elementIndex.get(normalizeGuid(binding.componentId));
    const displayOwner = getDisplayOwnerInfo(binding, rawInfo, elementIndex);
    const bindingCategory = classifyFormatBindingCategory(binding);
    const normalizedBinding: NormalizedFormatBinding = {
      ...binding,
      componentId: displayOwner?.id ?? binding.componentId,
      rawComponentId: binding.componentId,
      rawElementName: rawInfo?.name,
      rawElementType: rawInfo?.elementType,
      bindingCategory,
      bindingCategoryLabel: categoryLabels[bindingCategory],
      bindingDisplayLabel: bindingCategory === 'data' ? 'Value' : binding.propertyName ?? categoryLabels[bindingCategory],
      promotedFromChild: Boolean(rawInfo && displayOwner && rawInfo.normalizedId !== displayOwner.normalizedId),
    };

    const displayKey = displayOwner?.id ?? binding.componentId;
    const current = bindingMap.get(displayKey) ?? [];
    current.push(normalizedBinding);
    bindingMap.set(displayKey, current);
  }

  const groups = Array.from(bindingMap.entries()).map(([componentId, bindings]) => {
    const info = elementIndex.get(normalizeGuid(componentId));
    return {
      componentId,
      elementName: info?.name ?? componentId.substring(0, 8),
      elementType: info?.elementType ?? 'Unknown',
      bindings,
      dataBindings: bindings.filter(binding => binding.bindingCategory === 'data'),
      categories: groupFormatBindingsByCategory(bindings),
    } satisfies NormalizedFormatBindingGroup;
  });

  return { bindingMap, groups, elementIndex };
}

function indexFormatElements(rootElement: ERFormatElement): Map<string, IndexedFormatElement> {
  const index = new Map<string, IndexedFormatElement>();

  const visit = (element: ERFormatElement, parentId?: string) => {
    const normalizedId = normalizeGuid(element.id);
    index.set(normalizedId, {
      id: element.id,
      normalizedId,
      name: element.name,
      elementType: element.elementType,
      parentId,
      childIds: (element.children ?? []).map(child => child.id),
    });

    for (const child of element.children ?? []) {
      visit(child, normalizedId);
    }
  };

  visit(rootElement);
  return index;
}

function getDisplayOwnerInfo(
  binding: ERFormatBinding,
  rawInfo: IndexedFormatElement | undefined,
  elementIndex: Map<string, IndexedFormatElement>,
): IndexedFormatElement | undefined {
  if (!rawInfo) {
    return undefined;
  }

  if (classifyFormatBindingCategory(binding) !== 'data') {
    return rawInfo;
  }

  let current = rawInfo;
  while (current.parentId) {
    const parent = elementIndex.get(current.parentId);
    if (!parent) break;

    const isImplicitValueCarrier = VALUE_ELEMENT_TYPES.has(current.elementType) && current.name === current.elementType;
    const parentIsSemanticOwner = parent.elementType === 'XMLAttribute' || parent.elementType === 'XMLElement' || parent.childIds.length === 1;
    if (!isImplicitValueCarrier || !parentIsSemanticOwner) {
      break;
    }

    current = parent;
  }

  return current;
}