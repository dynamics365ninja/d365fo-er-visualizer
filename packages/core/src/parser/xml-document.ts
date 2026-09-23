// Raw XML layer: turns ER configuration XML into plain node objects and
// offers the small accessors every section parser reads them with.
import { XMLParser } from 'fast-xml-parser';

/** A raw element as `buildNode` produced it: `@_Attr` keys, child elements, `#text`. */
export type XmlNode = Record<string, any>;

// ─── XML Parser configuration ───

// fast-xml-parser's default object output groups same-named siblings under
// one key, which loses the order of mixed siblings: `Header, Lines, Footer`
// came back as `Header, Footer, Lines`, and `CONCATENATE("a", x, "b")` as
// `"a", "b", x`. The parser therefore runs in `preserveOrder` mode and
// `buildNode` folds its output into the familiar object shape, recording each
// node's children in document order for `orderedChildren`.
const xmlParserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false, // keep as strings
  parseTagValue: false, // text too: a base64 payload must never become a number
  // `trimValues` also trims attribute values, which turned the separator in
  // `CONCATENATE(a, " ", b)` into an empty string. `buildNode` trims text only.
  trimValues: false,
  processEntities: false, // decoded in buildNode to also cover numeric refs in one pass
  preserveOrder: true,
};

// Keys that must never be copied from parsed data to prevent prototype pollution.
const UNSAFE_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const arrayElements = new Set([
  'ERLabel',
  'ERPrerequisiteGroup',
  'ERPrerequisiteComponent',
  'ERDataContainerDescriptor',
  'ERDataContainerDescriptorItem',
  'ERDataContainerPathBinding',
  'ERModelItemDefinition',
  'ERPathToCache',
  'ERSelectedTableItem',
  'ERFormatComponentPropertyBinding',
  'ERDataContainerPathValidationBinding',
  'ERExpressionValidationCondition',
  'EREnumDefinition',
  'EREnumValueDefinition',
  'ERNamedTextTransformation',
]);

export function parseXmlDocument(xml: string): XmlNode {
  const ordered = new XMLParser(xmlParserOptions).parse(xml) as OrderedEntry[];
  return buildNode(ordered, undefined) as XmlNode;
}

// ─── Utility helpers ───

export function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

export function getAttr(node: XmlNode | undefined | null, name: string): string | undefined {
  return node?.[`@_${name}`] ?? undefined;
}

export function getContents(node: XmlNode | undefined | null): any {
  return node?.['Contents.'] ?? node?.['Contents'] ?? undefined;
}

export function getContentsArray(node: XmlNode | undefined | null, childName: string): any[] {
  const contents = getContents(node);
  if (!contents) return [];
  return asArray(contents[childName]);
}

/**
 * Decode XML entities (named + numeric) that fast-xml-parser leaves unresolved
 * when processEntities:false. Kept off by default to avoid double-decoding
 * constructs inside ER expressions (e.g. `&quot;` inside a raw formula string).
 */
function decodeXmlEntities(val: string): string {
  if (!val.includes('&')) return val;
  // One pass, so the `&` a decoded `&amp;` yields is never decoded again:
  // `&amp;lt;` is the literal text `&lt;`, not `<`.
  return val.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g, (match, hex, dec, named) => {
    if (named) return NAMED_ENTITIES[named];
    const codePoint = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    // An out-of-range reference stays as written instead of failing the file.
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
  });
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** One entry of fast-xml-parser's `preserveOrder` output: an element or a text run. */
type OrderedEntry = Record<string, unknown> & { ':@'?: Record<string, unknown> };

/** Children of each node `buildNode` produced, as `[elementName, child]` in document order. */
const CHILD_ORDER = new WeakMap<object, Array<[string, any]>>();

/**
 * Folds one element of the `preserveOrder` output into the shape the rest of
 * the parser reads: attributes as `@_Name` keys, children grouped by element
 * name (an array once a name repeats, or always for `arrayElements`), text as
 * `#text`, a text-only element as its string and an empty one as `''`.
 * Along the way it decodes XML entities and drops
 * __proto__/constructor/prototype keys to neutralise prototype-pollution
 * attempts via crafted element or attribute names.
 */
function buildNode(entries: OrderedEntry[], attributes: Record<string, unknown> | undefined): unknown {
  const node: Record<string, unknown> = Object.create(null);
  let hasAttributes = false;
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (UNSAFE_PROTO_KEYS.has(key.slice(2))) continue;
    node[key] = typeof value === 'string' ? decodeXmlEntities(value) : value;
    hasAttributes = true;
  }

  const order: Array<[string, any]> = [];
  let text = '';
  for (const entry of entries) {
    if ('#text' in entry) {
      text += String(entry['#text']).trim();
      continue;
    }
    const name = Object.keys(entry).find(key => key !== ':@');
    if (!name || UNSAFE_PROTO_KEYS.has(name) || name === '#__proto__') continue;
    const child = buildNode(entry[name] as OrderedEntry[], entry[':@']);
    const existing = node[name];
    if (existing === undefined) {
      node[name] = arrayElements.has(name) ? [child] : child;
    } else if (Array.isArray(existing)) {
      existing.push(child);
    } else {
      node[name] = [existing, child];
    }
    order.push([name, child]);
  }

  if (order.length === 0 && !hasAttributes) return decodeXmlEntities(text);
  if (text) node['#text'] = decodeXmlEntities(text);
  CHILD_ORDER.set(node, order);
  return node;
}

/**
 * The child elements of `node` as `[elementName, child]` pairs in document
 * order; attributes and text are left out. Nodes the parser did not produce
 * (synthesized envelopes) fall back to key order.
 */
export function orderedChildren(node: unknown): Array<[string, any]> {
  if (!node || typeof node !== 'object') return [];
  const recorded = CHILD_ORDER.get(node);
  if (recorded) return recorded;
  const children: Array<[string, any]> = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@_') || key === '#text') continue;
    for (const item of asArray(value)) children.push([key, item]);
  }
  return children;
}
