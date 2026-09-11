import type { ERFormatElement } from '@er-visualizer/core';
import { locale } from '../i18n';
import { normalizeGuid, type NormalizedFormatBinding, type NormalizedFormatBindingGroup } from './format-binding-display';

/**
 * What a format binding is for, as opposed to which ER property it sets. The
 * Bindings tab filters by this: a format typically carries as many column
 * captions as real values, and the few calculations and conditions — the part
 * worth reading — drowned among them when every row looked the same.
 */
export type BindingIntent = 'direct' | 'calculated' | 'condition' | 'text' | 'property';

export const BINDING_INTENT_ORDER: readonly BindingIntent[] = ['direct', 'calculated', 'condition', 'text', 'property'];

/** Static text is mostly captions, so the tab starts without it. */
export const DEFAULT_BINDING_INTENTS: readonly BindingIntent[] = ['direct', 'calculated', 'condition', 'property'];

const IDENTIFIER = String.raw`(?:[A-Za-z_$][\w$]*|'(?:[^']|'')*')`;
/** `model.Invoice.Lines`, `'$Tmp_lines'.'Name'`, `@.Amount` — a path and nothing else. */
const PATH_EXPRESSION = new RegExp(String.raw`^(?:@|${IDENTIFIER})(?:\.${IDENTIFIER})*$`);
const LABEL_EXPRESSION = /^@"[^"]*"$/;
const STRING_LITERAL = /^"(?:[^"]|"")*"$/;
const NUMBER_LITERAL = /^-?\d+(?:\.\d+)?$/;
const BOOLEAN_LITERAL = /^(?:true|false)$/i;

export function classifyBindingIntent(
  binding: Pick<NormalizedFormatBinding, 'bindingCategory'> & { expressionAsString?: string | null },
): BindingIntent {
  if (binding.bindingCategory === 'visibility') return 'condition';
  if (binding.bindingCategory !== 'data') return 'property';

  const expression = (binding.expressionAsString ?? '').trim();
  if (
    LABEL_EXPRESSION.test(expression)
    || STRING_LITERAL.test(expression)
    || NUMBER_LITERAL.test(expression)
    || BOOLEAN_LITERAL.test(expression)
  ) {
    return 'text';
  }
  if (!expression || PATH_EXPRESSION.test(expression)) return 'direct';
  return 'calculated';
}

const intentLabels: Record<'cs' | 'en', Record<BindingIntent, string>> = {
  cs: { direct: 'Přímé hodnoty', calculated: 'Výpočty', condition: 'Podmínky', text: 'Texty', property: 'Vlastnosti' },
  en: { direct: 'Direct values', calculated: 'Calculations', condition: 'Conditions', text: 'Texts', property: 'Properties' },
};

/** One binding of the kind — the badge on a data binding row. */
const intentItemLabels: Record<'cs' | 'en', Record<BindingIntent, string>> = {
  cs: { direct: 'Hodnota', calculated: 'Výpočet', condition: 'Podmínka', text: 'Text', property: 'Vlastnost' },
  en: { direct: 'Value', calculated: 'Calculation', condition: 'Condition', text: 'Text', property: 'Property' },
};

const intentHints: Record<'cs' | 'en', Record<BindingIntent, string>> = {
  cs: {
    direct: 'Hodnota převzatá beze změny z datového modelu nebo zdroje dat',
    calculated: 'Hodnota, kterou výraz počítá nebo upravuje — funkce, operátory',
    condition: 'Kdy se prvek generuje — Enabled, Visible a podobné',
    text: 'Pevný text nebo konstanta, typicky popisky sloupců (@GER_LABEL)',
    property: 'Nastavení prvku — název souboru, jazyk, formát, kódování',
  },
  en: {
    direct: 'Value taken unchanged from the data model or a data source',
    calculated: 'Value an expression computes or transforms — functions, operators',
    condition: 'When the element is generated — Enabled, Visible and the like',
    text: 'Fixed text or a constant, typically column captions (@GER_LABEL)',
    property: 'Element settings — file name, language, format, encoding',
  },
};

const lang = () => (locale === 'cs' ? 'cs' : 'en');

export function getBindingIntentLabel(intent: BindingIntent): string {
  return intentLabels[lang()][intent];
}

export function getBindingIntentItemLabel(intent: BindingIntent): string {
  return intentItemLabels[lang()][intent];
}

export function getBindingIntentHint(intent: BindingIntent): string {
  return intentHints[lang()][intent];
}

export function countBindingIntents(groups: readonly NormalizedFormatBindingGroup[]): Record<BindingIntent, number> {
  const counts: Record<BindingIntent, number> = { direct: 0, calculated: 0, condition: 0, text: 0, property: 0 };
  for (const group of groups) {
    for (const binding of group.bindings) counts[classifyBindingIntent(binding)] += 1;
  }
  return counts;
}

export interface FormatBindingEntry {
  group: NormalizedFormatBindingGroup;
  /** The group's bindings that passed the filter, in their original order. */
  bindings: NormalizedFormatBinding[];
}

export interface FormatBindingSection {
  /** Id of the parent element — stable across filtering, so it keys the collapse state. */
  key: string;
  /** Element names from below the root down to the parent; the root's name for its own children. */
  trail: string[];
  /** Bindings whose element is not in the format tree (a stale component reference). */
  unresolved: boolean;
  entries: FormatBindingEntry[];
}

export const UNRESOLVED_SECTION_KEY = '__unresolved__';

/**
 * Arrange binding groups the way the file is built: in document order, one
 * section per parent element, so a cell sits next to its neighbours in the same
 * range instead of among every other cell of the format sorted by name.
 *
 * A parent whose children are interleaved with deeper sections still gets a
 * single section, placed where its first bound child appears.
 */
export function buildFormatBindingSections(
  rootElement: ERFormatElement,
  groups: readonly NormalizedFormatBindingGroup[],
  includeBinding: (binding: NormalizedFormatBinding) => boolean = () => true,
): FormatBindingSection[] {
  const pending = new Map<string, NormalizedFormatBindingGroup>();
  for (const group of groups) pending.set(normalizeGuid(group.componentId), group);

  const sections = new Map<string, FormatBindingSection>();
  const addEntry = (key: string, trail: string[], unresolved: boolean, group: NormalizedFormatBindingGroup) => {
    const bindings = group.bindings.filter(includeBinding);
    if (bindings.length === 0) return;
    let section = sections.get(key);
    if (!section) {
      section = { key, trail, unresolved, entries: [] };
      sections.set(key, section);
    }
    section.entries.push({ group, bindings });
  };

  const visit = (element: ERFormatElement, ancestors: ERFormatElement[]) => {
    const id = normalizeGuid(element.id);
    const group = pending.get(id);
    if (group) {
      pending.delete(id);
      const parent = ancestors[ancestors.length - 1] ?? element;
      const trail = ancestors.length > 1 ? ancestors.slice(1).map(a => a.name) : [rootElement.name];
      addEntry(parent.id, trail, false, group);
    }
    const nextAncestors = [...ancestors, element];
    for (const child of element.children ?? []) visit(child, nextAncestors);
  };
  visit(rootElement, []);

  for (const group of pending.values()) addEntry(UNRESOLVED_SECTION_KEY, [], true, group);

  return Array.from(sections.values());
}
