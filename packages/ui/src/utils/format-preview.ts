/**
 * The file a format would write, laid out from its lineage: XML with values
 * inline, text records with their delimiters, line ends and fixed widths.
 * Every value knows the element it comes from, so the preview can explain
 * itself; repeating sections are written out for a few sample records and
 * conditional ones say when they appear.
 */
import type { ERDataContainerDescriptor, ERFormatElement } from '@er-visualizer/core';
import { containerLookup } from './datasource-tree';
import type { ElementFill, FormatLineage } from './format-lineage';
import { normalizeGuid } from './format-binding-display';
import { layoutFixed, sampleValue } from './sample-values';

export type PreviewValueMode = 'sample' | 'source' | 'expression' | 'name';

export interface PreviewOptions {
  mode: PreviewValueMode;
  /** How many sample records a repeating section is written out for. */
  iterations: number;
  /** Leave out elements that are not bound at all. */
  hideUnbound: boolean;
}

export type SegmentRole = 'markup' | 'tag' | 'attr' | 'value' | 'constant' | 'unbound' | 'delimiter' | 'padding' | 'text';

export interface PreviewSegment {
  text: string;
  role: SegmentRole;
  elementId?: string;
}

export type PreviewNoteKind = 'repeat' | 'condition' | 'optional';

export interface PreviewLine {
  key: string;
  /** Indentation level (XML). */
  indent: number;
  segments: PreviewSegment[];
  /** An annotation line, not part of the file. */
  note?: { kind: PreviewNoteKind; text: string; elementId: string; iterations?: number };
  /** Repeating / conditional sections this line sits in, outermost first. */
  bands: Array<{ elementId: string; kind: PreviewNoteKind }>;
}

export interface PreviewDocument {
  kind: 'xml' | 'text' | 'other';
  lines: PreviewLine[];
  /** Fixed-width text: the preview draws a column ruler. */
  fixedWidth: boolean;
  /** Longest line of the file, in characters. */
  width: number;
}

export interface PreviewWords {
  repeats: (source: string, iterations: number) => string;
  condition: (expression: string) => string;
  optional: string;
}

const VALUE_TYPES = new Set(['String', 'Numeric', 'DateTime', 'Base64']);

interface BuildContext {
  lineage: FormatLineage;
  options: PreviewOptions;
  words: PreviewWords;
  sample: (fill: ElementFill, iteration: number) => string;
  lines: PreviewLine[];
  seq: number;
}

/**
 * Sample values for the elements of one format: the enum a field reads and
 * its model field decide the value; one model field reads the same everywhere
 * in the document, and only values read off the current record change from
 * record to record.
 */
export function createSampler(lineage: FormatLineage): (fill: ElementFill, iteration: number) => string {
  const enumCache = new Map<string, string[] | undefined>();
  const model = lineage.context.dataModel?.model;
  const lookup = model ? containerLookup(model) : null;
  const enumValuesOf = (fill: ElementFill): string[] | undefined => {
    const link = fill.modelLinks.find(l => l.role === 'value');
    const td = link?.field?.type === 9 ? link.field.typeDescriptor : undefined;
    if (!td || !lookup) return undefined;
    if (!enumCache.has(td)) {
      const container: ERDataContainerDescriptor | undefined = lookup(td);
      enumCache.set(td, container?.isEnum ? container.items.map(item => item.name) : undefined);
    }
    return enumCache.get(td);
  };
  return (fill, iteration) => {
    if (fill.fill === 'constant' && fill.constant != null) return fill.constant.replace(/^@"(.*)"$/, '$1');
    const link = fill.modelLinks.find(l => l.role === 'value');
    const perRecord = Boolean(fill.binding?.includes('@'));
    return sampleValue({
      names: [link?.field?.name ?? '', link?.segments[link.segments.length - 1] ?? '', fill.displayName],
      context: [...(link?.segments.slice(0, -1) ?? []), ...fill.path.slice(-3, -1)],
      dataType: fill.dataType,
      modelType: link?.field?.type,
      enumValues: enumValuesOf(fill),
      constraints: fill.constraints,
      seed: link?.path ?? fill.binding ?? fill.id,
      iteration: perRecord ? iteration : 0,
    });
  };
}

function fillOf(ctx: BuildContext, element: ERFormatElement): ElementFill | undefined {
  return ctx.lineage.byId.get(normalizeGuid(element.id));
}

/** The text a value shows in the current mode, and how it is styled. */
function valueSegment(ctx: BuildContext, fill: ElementFill | undefined, iteration: number): PreviewSegment {
  const elementId = fill?.id;
  if (!fill) return { text: '', role: 'unbound', elementId };
  if (fill.fill === 'constant' && fill.constant != null) {
    return { text: fill.constant.replace(/^@"(.*)"$/, '$1'), role: 'constant', elementId };
  }
  if (!fill.binding) {
    return { text: ctx.options.mode === 'sample' ? '' : '∅', role: 'unbound', elementId };
  }
  switch (ctx.options.mode) {
    case 'expression':
      return { text: `{${fill.binding}}`, role: 'value', elementId };
    case 'name':
      return { text: `{${fill.displayName}}`, role: 'value', elementId };
    case 'source': {
      const field = fill.sources.find(src => src.role === 'value' && src.kind === 'field');
      const model = fill.modelLinks.find(link => link.role === 'value');
      const label = field?.name ?? (model ? `model.${model.path.replace(/\//g, '.')}` : fill.binding);
      return { text: `{${label}}`, role: 'value', elementId };
    }
    default: {
      const text = ctx.sample(fill, iteration);
      return { text, role: 'value', elementId };
    }
  }
}

function escapeXml(text: string, attribute = false): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return attribute ? escaped.replace(/"/g, '&quot;') : escaped;
}

function pushLine(ctx: BuildContext, indent: number, segments: PreviewSegment[], bands: PreviewLine['bands']): void {
  ctx.lines.push({ key: `l${ctx.seq++}`, indent, segments, bands });
}

function pushNote(ctx: BuildContext, indent: number, note: NonNullable<PreviewLine['note']>, bands: PreviewLine['bands']): void {
  ctx.lines.push({ key: `n${ctx.seq++}`, indent, segments: [], note, bands });
}

/** Notes before an element, and the bands its lines sit in. */
function enter(ctx: BuildContext, fill: ElementFill | undefined, indent: number, bands: PreviewLine['bands'], iteration: number): PreviewLine['bands'] {
  if (!fill) return bands;
  let next = bands;
  if (fill.repeating && iteration === 0) {
    pushNote(ctx, indent, { kind: 'repeat', text: ctx.words.repeats(fill.binding ?? fill.displayName, ctx.options.iterations), elementId: fill.id, iterations: ctx.options.iterations }, bands);
  }
  if (fill.repeating) next = [...next, { elementId: fill.id, kind: 'repeat' }];
  if (fill.conditions.length > 0) {
    if (iteration === 0) pushNote(ctx, indent, { kind: 'condition', text: ctx.words.condition(fill.conditions.join(' AND ')), elementId: fill.id }, next);
    next = [...next, { elementId: fill.id, kind: 'condition' }];
  } else if (fill.optional) {
    if (iteration === 0) pushNote(ctx, indent, { kind: 'optional', text: ctx.words.optional, elementId: fill.id }, next);
    next = [...next, { elementId: fill.id, kind: 'optional' }];
  }
  return next;
}

/** Nothing in the subtree carries a value — an empty shell the user asked to hide. */
function isEmptyShell(ctx: BuildContext, element: ERFormatElement): boolean {
  const fill = fillOf(ctx, element);
  if (fill?.binding) return false;
  return element.children.every(child => isEmptyShell(ctx, child));
}

// ─── XML ───

function emitXml(ctx: BuildContext, element: ERFormatElement, indent: number, bands: PreviewLine['bands'], iteration: number): void {
  const fill = fillOf(ctx, element);
  if (ctx.options.hideUnbound && isEmptyShell(ctx, element)) return;
  const repeats = fill?.repeating ? Math.max(1, ctx.options.iterations) : 1;

  for (let rep = 0; rep < repeats; rep++) {
    const iter = iteration * repeats + rep;
    switch (element.elementType) {
      case 'File': {
        const inner = enter(ctx, fill, indent, bands, rep);
        if (indent === 0 && rep === 0) {
          pushLine(ctx, 0, [{ text: `<?xml version="1.0" encoding="${fill?.constraints.encoding ?? 'UTF-8'}"?>`, role: 'markup', elementId: element.id }], inner);
        }
        for (const child of element.children) emitXml(ctx, child, indent, inner, iter);
        break;
      }
      case 'XMLSequence': {
        const inner = enter(ctx, fill, indent, bands, rep);
        for (const child of element.children) emitXml(ctx, child, indent, inner, iter);
        break;
      }
      case 'XMLElement': {
        const inner = enter(ctx, fill, indent, bands, rep);
        const attributes = element.children.filter(child => child.elementType === 'XMLAttribute');
        const content = element.children.filter(child => child.elementType !== 'XMLAttribute' && child.id !== fill?.carrierId);
        const open: PreviewSegment[] = [{ text: '<', role: 'markup' }, { text: element.name, role: 'tag', elementId: element.id }];
        for (const attribute of attributes) {
          const attrFill = fillOf(ctx, attribute);
          if (ctx.options.hideUnbound && !attrFill?.binding) continue;
          const value = valueSegment(ctx, attrFill, iter);
          open.push(
            { text: ' ', role: 'markup' },
            { text: attribute.name, role: 'attr', elementId: attribute.id },
            { text: '="', role: 'markup' },
            { ...value, text: escapeXml(value.text, true) },
            { text: '"', role: 'markup' },
          );
        }
        const hasValue = Boolean(fill?.carrierId) || (content.length === 0 && Boolean(fill?.binding));
        if (content.length === 0) {
          if (hasValue || fill?.isField) {
            const value = valueSegment(ctx, fill, iter);
            pushLine(ctx, indent, [...open, { text: '>', role: 'markup' }, { ...value, text: escapeXml(value.text) }, { text: '</', role: 'markup' }, { text: element.name, role: 'tag', elementId: element.id }, { text: '>', role: 'markup' }], inner);
          } else {
            pushLine(ctx, indent, [...open, { text: '/>', role: 'markup' }], inner);
          }
          break;
        }
        pushLine(ctx, indent, [...open, { text: '>', role: 'markup' }], inner);
        if (hasValue) {
          const value = valueSegment(ctx, fill, iter);
          pushLine(ctx, indent + 1, [{ ...value, text: escapeXml(value.text) }], inner);
        }
        for (const child of content) emitXml(ctx, child, indent + 1, inner, iter);
        pushLine(ctx, indent, [{ text: '</', role: 'markup' }, { text: element.name, role: 'tag', elementId: element.id }, { text: '>', role: 'markup' }], inner);
        break;
      }
      case 'XMLAttribute':
        break;
      default: {
        if (VALUE_TYPES.has(element.elementType)) {
          const value = valueSegment(ctx, fill, iter);
          pushLine(ctx, indent, [{ ...value, text: escapeXml(value.text) }], enter(ctx, fill, indent, bands, rep));
        } else {
          const inner = enter(ctx, fill, indent, bands, rep);
          for (const child of element.children) emitXml(ctx, child, indent, inner, iter);
        }
      }
    }
  }
}

// ─── Text ───

interface TextState {
  current: PreviewSegment[];
  bands: PreviewLine['bands'];
}

function flush(ctx: BuildContext, state: TextState): void {
  if (state.current.length === 0) return;
  pushLine(ctx, 0, state.current, state.bands);
  state.current = [];
}

function textValue(ctx: BuildContext, element: ERFormatElement, iteration: number): PreviewSegment[] {
  const fill = fillOf(ctx, element);
  const value = valueSegment(ctx, fill, iteration);
  if (!fill) return [value];
  const { text, padding, padLeft } = layoutFixed(value.text, fill.constraints);
  const segments: PreviewSegment[] = [];
  if (padding && padLeft) segments.push({ text: padding, role: 'padding', elementId: value.elementId });
  segments.push({ ...value, text });
  if (padding && !padLeft) segments.push({ text: padding, role: 'padding', elementId: value.elementId });
  return segments;
}

/** `bands` with `fill`'s own section added, without writing its notes again. */
function withSection(bands: PreviewLine['bands'], fill: ElementFill | undefined): PreviewLine['bands'] {
  if (!fill) return bands;
  const kind: PreviewNoteKind | null = fill.repeating ? 'repeat' : fill.conditions.length > 0 ? 'condition' : fill.optional ? 'optional' : null;
  return kind ? [...bands, { elementId: fill.id, kind }] : bands;
}

function emitText(ctx: BuildContext, element: ERFormatElement, state: TextState, bands: PreviewLine['bands'], iteration: number): void {
  const fill = fillOf(ctx, element);
  if (ctx.options.hideUnbound && isEmptyShell(ctx, element)) return;

  if (VALUE_TYPES.has(element.elementType)) {
    if (state.current.length === 0) state.bands = bands;
    state.current.push(...textValue(ctx, element, iteration));
    return;
  }

  const repeats = fill?.repeating ? Math.max(1, ctx.options.iterations) : 1;
  const delimiter = fill?.constraints.delimiter;
  const lineEnd = Boolean(fill?.constraints.lineEnd) || element.elementType === 'TextLine';
  for (let rep = 0; rep < repeats; rep++) {
    const iter = iteration * repeats + rep;
    // Notes go between lines only; inside a line the section just colours it.
    const inner = state.current.length === 0 ? enter(ctx, fill, 0, bands, rep) : withSection(bands, fill);
    if (state.current.length === 0) state.bands = inner;
    let first = true;
    for (const child of element.children) {
      const inline = VALUE_TYPES.has(child.elementType);
      if (inline && delimiter && !first) state.current.push({ text: delimiter, role: 'delimiter' });
      emitText(ctx, child, state, inner, iter);
      if (inline) first = false;
    }
    if (lineEnd) flush(ctx, state);
  }
}

// ─── Entry ───

export function buildPreviewDocument(
  lineage: FormatLineage,
  root: ERFormatElement,
  kind: 'xml' | 'text' | 'other',
  options: PreviewOptions,
  words: PreviewWords,
): PreviewDocument {
  const ctx: BuildContext = { lineage, options, words, sample: createSampler(lineage), lines: [], seq: 0 };
  if (kind === 'xml') emitXml(ctx, root, 0, [], 0);
  else {
    const state: TextState = { current: [], bands: [] };
    emitText(ctx, root, state, [], 0);
    flush(ctx, state);
  }

  const fixedWidth = kind === 'text' && lineage.elements.some(fill => fill.constraints.padding || (fill.constraints.minLength && fill.constraints.minLength === fill.constraints.maxLength));
  const width = ctx.lines.reduce((max, line) => Math.max(max, line.segments.reduce((n, seg) => n + seg.text.length, 0)), 0);
  return { kind, lines: ctx.lines, fixedWidth, width };
}
