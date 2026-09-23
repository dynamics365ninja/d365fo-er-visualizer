import { describe, it, expect } from 'vitest';
import { highlightXmlTag, renderXmlHighlightedMarkup } from './xml-highlight';

/** The text a browser would show for the highlighted HTML. */
function visibleText(html: string): string {
  return html
    .replace(/<span style="[^"]*">/g, '')
    .replace(/<\/span>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

describe('highlightXmlTag', () => {
  it('wraps the tag name, attribute name and value once each', () => {
    expect(highlightXmlTag('<Row id="1">')).toBe(
      '<span style="color:var(--text-secondary)">&lt;</span>' +
      '<span style="color:var(--accent);font-weight:600">Row</span> ' +
      '<span style="color:var(--surface-warning-fg)">id</span>=' +
      '<span style="color:var(--surface-success-fg)">&quot;1&quot;</span>' +
      '<span style="color:var(--text-secondary)">&gt;</span>',
    );
  });

  // These names collide with the preview's own markup (`<span style="color:…">`);
  // the old replace-based highlighter rewrote the injected markup instead of the name.
  it.each(['span', 'style', 'color', 'var', 'text'])('keeps an element named %s intact', name => {
    const tag = `<${name} ${name}="${name}">`;
    const html = highlightXmlTag(tag);
    expect(visibleText(html)).toBe(tag);
    expect(html).toContain(`<span style="color:var(--accent);font-weight:600">${name}</span>`);
  });

  it('handles closing, self-closing and declaration tags', () => {
    for (const tag of ['</Doc>', '<Empty/>', '<Empty a=\'x\' />', '<?xml version="1.0"?>', '<!-- a < b -->', '<!DOCTYPE x>']) {
      expect(visibleText(highlightXmlTag(tag))).toBe(tag);
    }
  });

  it('keeps attribute values that contain entities', () => {
    const tag = '<a title="x &amp; y">';
    const html = highlightXmlTag(tag);
    expect(visibleText(html)).toBe(tag);
    expect(html).toContain('<span style="color:var(--surface-success-fg)">&quot;x &amp;amp; y&quot;</span>');
  });

  it('never emits markup from the source', () => {
    const html = highlightXmlTag('<a onload="<script>alert(1)</script>">');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/<(?!\/?span)/);
  });
});

describe('renderXmlHighlightedMarkup', () => {
  it('round-trips a document through the visible text', () => {
    const xml = '<?xml version="1.0"?>\n<span color="red">a &amp; <b>b</b></span>';
    expect(visibleText(renderXmlHighlightedMarkup(xml))).toBe(xml);
  });

  it('escapes text between tags', () => {
    expect(renderXmlHighlightedMarkup('x > y')).toBe('x &gt; y');
  });
});
