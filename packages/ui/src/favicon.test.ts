import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* The icons are the one set of assets nothing in the pipeline parses: Vite
   copies them through, so a malformed or misnamed file ships and the browser
   silently draws nothing at all. It shipped that way once already, because the
   comment naming the theme tokens in favicon.svg carried their leading dashes
   and XML forbids a double hyphen inside a comment. `fast-xml-parser` accepts
   that document, so these are hand-rolled checks of the ways this mark goes
   invisible: a comment XML rejects, a stroke pointing at a gradient that is not
   defined, a <link> whose file is not there, and a size the file contradicts. */

const uiRoot = new URL('../', import.meta.url);
const siteRoot = new URL('../../site/', import.meta.url);

const SVGS = {
  app: new URL('favicon.svg', uiRoot),
  site: new URL('public/favicon.svg', siteRoot),
};

/** Icons both packages serve. The app keeps favicon.svg at its Vite root; the
    rest sit in public/, which is why the two sides are listed separately. */
const SHARED = [
  ['favicon.svg', 'favicon.svg', 'public/favicon.svg'],
  ['favicon-16.png', 'public/favicon-16.png', 'public/favicon-16.png'],
  ['favicon-32.png', 'public/favicon-32.png', 'public/favicon-32.png'],
  ['apple-touch-icon.png', 'public/apple-touch-icon.png', 'public/apple-touch-icon.png'],
  ['icon-192.png', 'public/icon-192.png', 'public/icon-192.png'],
  ['icon-512.png', 'public/icon-512.png', 'public/icon-512.png'],
] as const;

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

/** Width and height out of a PNG's IHDR, which is always its first chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('latin1'), 'PNG signature').toBe('\x89PNG\r\n\x1a\n');
  expect(bytes.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('favicon.svg', () => {
  for (const [name, url] of Object.entries(SVGS)) {
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
});

describe('icon assets', () => {
  it.each(SHARED)('ships the same %s to the app and the marketing site', (_name, ui, site) => {
    expect(readFileSync(new URL(ui, uiRoot))).toEqual(readFileSync(new URL(site, siteRoot)));
  });
});

describe('index.html icons', () => {
  const html = readFileSync(new URL('index.html', uiRoot), 'utf8');
  const links = [...html.matchAll(/<link\b[^>]*\brel="([^"]*icon[^"]*)"[^>]*>/g)].map((m) => m[0]);

  it('declares the SVG mark and a raster fallback for the engines without one', () => {
    expect(links.some((l) => l.includes('image/svg+xml'))).toBe(true);
    expect(links.filter((l) => l.includes('rel="alternate icon"')).length).toBeGreaterThan(0);
  });

  it.each(['/favicon-32.png', '/favicon-16.png'])('serves %s from public/', (href) => {
    expect(html).toContain(`href="${href}"`);
    // `href` is root-relative; Vite rewrites it with the base and serves it out
    // of public/, so that is where the file has to be.
    expect(() => readFileSync(new URL(`public${href}`, uiRoot))).not.toThrow();
  });

  it('points every icon link at a file that exists, at the size it claims', () => {
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = /href="([^"]+)"/.exec(link)?.[1];
      expect(href, `no href in ${link}`).toBeDefined();
      // Public assets are declared root-relative, the Vite-bundled ones as ./.
      const file = href!.startsWith('/')
        ? new URL(`public${href}`, uiRoot)
        : new URL(href!.replace(/^\.\//, ''), uiRoot);
      const bytes = readFileSync(file);

      const sizes = /sizes="(\d+)x(\d+)"/.exec(link);
      if (sizes && href!.endsWith('.png')) {
        expect(pngSize(bytes), `${href} does not match its sizes attribute`).toEqual({
          width: Number(sizes[1]),
          height: Number(sizes[2]),
        });
      }
    }
  });
});
