import { classifyFormatBindingCategory, type FormatBindingCategory } from './format-binding-display';
import type { TreeNode } from '../state/store';
import { t } from '../i18n';

/**
 * Words for the consultant view. ER identifiers (`XMLAttribute`, `Enabled`,
 * `Real`, a mapping's DataContainerDescriptor) mean something to whoever built
 * the configuration; a consultant reading it needs what they stand for. The
 * technical view keeps the raw identifiers — callers decide which one to show.
 */

/** A format element type (`XMLAttribute`, `ExcelCell`, …) in plain words. */
export function getConsultantFormatTypeLabel(type: string): string {
  return t.consultantFormatTypeLabels[type] ?? humanizeFormatTypeName(type);
}

/**
 * Last resort for an element type the labels don't cover: turn the raw ER
 * identifier into plain words instead of leaking `XMLSequenceElement`.
 */
function humanizeFormatTypeName(type: string): string {
  const words = String(type ?? '')
    .replace(/^(XML|Excel|Text|Word|PDF)/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!words) return t.consultantElementFallback;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/**
 * A format element's data type in plain words. `Void` marks a structural
 * component that carries no value, so it gets no label at all.
 */
export function getConsultantDataTypeLabel(dataType: string): string | undefined {
  if (dataType === 'Void') return undefined;
  return t.consultantDataTypeLabels[dataType] ?? dataType;
}

/** A data model field's type in plain words. */
export function getConsultantFieldTypeLabel(type: number): string | undefined {
  return t.consultantFieldTypeLabels[type];
}

export function getBindingCategoryLabel(category: FormatBindingCategory): string {
  return t.consultantBindingCategoryLabels[category];
}

interface BindingLike {
  bindingCategory?: FormatBindingCategory;
  propertyName?: string | null;
  expressionAsString?: string | null;
}

/**
 * What a format binding does, instead of the property it sets. A visibility
 * switch bound to a literal is simply on or off — `Enabled ← false` means the
 * element is never generated; anything else is a condition.
 */
export function getConsultantBindingLabel(binding: BindingLike): string {
  const category = binding.bindingCategory
    ?? classifyFormatBindingCategory({ propertyName: binding.propertyName ?? '' });
  if (category === 'property') {
    return t.consultantPropertyLabels[(binding.propertyName ?? '').trim()] ?? getBindingCategoryLabel(category);
  }
  if (category !== 'visibility') return getBindingCategoryLabel(category);

  const prop = (binding.propertyName ?? '').trim().toLowerCase();
  const expr = (binding.expressionAsString ?? '').trim().toLowerCase();
  // `Disabled` reads the other way round from Enabled / Visible / Printable.
  const offWhen = prop === 'disabled' ? 'true' : 'false';
  const onWhen = prop === 'disabled' ? 'false' : 'true';
  if (expr === offWhen) return t.consultantTurnedOff;
  if (expr === onWhen) return t.consultantTurnedOn;
  return t.consultantCondition;
}

/**
 * `xmlns`, `xmlns:xs` and `…:schemaLocation` attributes: XML plumbing every
 * XML format repeats, not content anyone maps data into.
 */
export function isXmlNamespaceDeclaration(element: { elementType?: string; name?: string } | null | undefined): boolean {
  if (element?.elementType !== 'XMLAttribute') return false;
  const name = (element.name ?? '').trim();
  return name === 'xmlns' || name.startsWith('xmlns:') || /:(schemaLocation|noNamespaceSchemaLocation)$/.test(name);
}

/**
 * The name a tree node shows. Node names are composed once, when the tree is
 * built, and carry technical suffixes (a mapping's `[DataContainerDescriptor]
 * (vN)`, a binding's `← expression`, a raw element type); the consultant view
 * rebuilds the name from the node's data instead.
 */
export function getNodeDisplayName(node: TreeNode, showTechnicalDetails: boolean): string {
  if (showTechnicalDetails) return node.name;
  const data = node.data;
  if (node.type === 'mapping' && typeof data?.name === 'string' && data.name) return data.name;
  if (node.type === 'formatBinding') {
    if (typeof data?.elementName === 'string' && data.elementName) return data.elementName;
    if (data?.bindingCategory) return getConsultantBindingLabel(data);
  }
  if (node.type === 'section' && typeof data?.count === 'number') {
    if (typeof data.bindingElementType === 'string') return `${getConsultantFormatTypeLabel(data.bindingElementType)} (${data.count})`;
    if (data.bindingCategory) return `${getBindingCategoryLabel(data.bindingCategory)} (${data.count})`;
  }
  return node.name;
}
