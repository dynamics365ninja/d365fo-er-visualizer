import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* The favicon is the one asset nothing in the pipeline parses: Vite copies it
   through, so a malformed file ships and the browser silently draws no icon at
   all. It shipped that way once already, because the comment naming the theme
   tokens carried their leading dashes and XML forbids a double hyphen inside a
   comment. `fast-xml-parser` accepts that file, so these are hand-rolled checks
   of the two ways this mark can go invisible: a document the XML parser
   rejects, and a stroke pointing at a gradient that is not there. */

const FAVICONS = {
  app: new URL('../favicon.svg', import.meta.url),
  site: new URL('../../site/public/favicon.svg', import.meta.url),
};

/** The bodies of every `<!-- ... -->` in the document. */
function commentBodies(svg: string): string[] {
  const bodies: string[] = [];
  for (let from = 0; ; ) {
    const start = svg.indexOf('<!--', from);
    if (start === -1) return bodies;
    const end = svg.indexOf('-->', start + 4);
    expect(end, 'unterminated XML comment').not.toBe(-1);
    bodies.push(svg.slice(start + 4, end));
    from = end + 3;
  }
}

describe('favicon.svg', () => {
  for (const [name, url] of Object.entries(FAVICONS)) {
    describe(name, () => {
      const svg = readFileSync(url, 'utf8');

      it('keeps every comment well-formed', () => {
        for (const body of commentBodies(svg)) {
          expect(body, 'XML forbids a double hyphen inside a comment').not.toContain('--');
          expect(body.endsWith('-'), 'XML forbids a comment body ending in a hyphen').toBe(false);
        }
      });

      it('paints with a gradient it actually defines', () => {
        const referenced = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
        expect(referenced.length).toBeGreaterThan(0);
        for (const id of referenced) {
          expect(svg).toContain(`id="${id}"`);
        }
      });
    });
  }

  it('ships the same mark to the app and the marketing site', () => {
    expect(readFileSync(FAVICONS.app, 'utf8')).toBe(readFileSync(FAVICONS.site, 'utf8'));
  });
});
