/**
 * Syntax highlighting for the XML output preview, as an HTML string for
 * `dangerouslySetInnerHTML`. Every piece of the source text goes through
 * {@link escapeHtml} exactly once and is wrapped exactly once, so neither the
 * preview's own markup nor anything in the XML can be mistaken for the other.
 */

const PUNCT_COLOR = 'var(--er-text-muted)';
const TAG_COLOR = 'var(--er-accent)';
const ATTR_COLOR = 'var(--er-warning)';
const VALUE_COLOR = 'var(--er-success)';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function span(style: string, text: string): string {
  return `<span style="${style}">${escapeHtml(text)}</span>`;
}

const OPENER = /^<[/?!]?/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const CLOSER = /^[/?]?>$/;
const WHITESPACE = /^\s+/;
/** Name, then optionally `=` and a quoted value — a bare name is still an attribute. */
const ATTRIBUTE = /^([^\s=/>?"']+)(?:(\s*=\s*)("[^"]*"|'[^']*')?)?/;

/** One tag, `<` to `>` inclusive, as highlighted HTML. */
export function highlightXmlTag(tag: string): string {
  // Comments hold free text, not names and attributes.
  if (tag.startsWith('<!--')) return span(`color:${PUNCT_COLOR}`, tag);

  let out = '';
  let rest = tag;
  const take = (length: number): string => {
    const piece = rest.slice(0, length);
    rest = rest.slice(length);
    return piece;
  };

  const opener = OPENER.exec(rest);
  if (opener) out += span(`color:${PUNCT_COLOR}`, take(opener[0].length));
  const name = NAME.exec(rest);
  if (name) out += span(`color:${TAG_COLOR};font-weight:600`, take(name[0].length));

  while (rest) {
    const closer = CLOSER.exec(rest);
    if (closer) { out += span(`color:${PUNCT_COLOR}`, take(closer[0].length)); break; }
    const space = WHITESPACE.exec(rest);
    if (space) { out += escapeHtml(take(space[0].length)); continue; }
    const attr = ATTRIBUTE.exec(rest);
    if (attr) {
      take(attr[0].length);
      out += span(`color:${ATTR_COLOR}`, attr[1]!);
      out += escapeHtml(attr[2] ?? '');
      if (attr[3] !== undefined) out += span(`color:${VALUE_COLOR}`, attr[3]);
      continue;
    }
    // Anything else — a stray quote or slash — stays plain.
    out += escapeHtml(take(1));
  }
  return out;
}

/** A whole XML document as highlighted HTML; text between tags is only escaped. */
export function renderXmlHighlightedMarkup(xml: string): string {
  const parts: string[] = [];
  const tagRegex = /<[^>]+>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xml)) !== null) {
    const textBefore = xml.slice(lastIndex, match.index);
    if (textBefore) parts.push(escapeHtml(textBefore));
    parts.push(highlightXmlTag(match[0]));
    lastIndex = match.index + match[0].length;
  }

  const tail = xml.slice(lastIndex);
  if (tail) parts.push(escapeHtml(tail));
  return parts.join('');
}
