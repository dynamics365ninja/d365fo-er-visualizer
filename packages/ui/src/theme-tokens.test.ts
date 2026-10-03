import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CSS cannot share one declaration list between `@media (prefers-color-scheme:
 * dark)` and `:root[data-theme='dark']`, so tokens.css writes the dark palette
 * twice. This keeps the two copies from drifting apart.
 */
const tokensCss = readFileSync(fileURLToPath(new URL('../../design-tokens/tokens.css', import.meta.url)), 'utf8');
/** The app's workbench palette repeats the same pattern over the shared tokens. */
const workbenchCss = readFileSync(fileURLToPath(new URL('./styles/app-tokens.css', import.meta.url)), 'utf8');

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) out.set(match[1], match[2].trim());
  return out;
}

function blockAfter(marker: string, css = tokensCss): string {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start + marker.length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unterminated block after ${marker}`);
}

describe('design tokens', () => {
  it('defines the same dark palette for the OS setting and the explicit switch', () => {
    const media = declarations(blockAfter(":root:not([data-theme='light']) {"));
    const explicit = declarations(blockAfter(":root[data-theme='dark'] {"));
    expect(media.size).toBeGreaterThan(20);
    expect(Object.fromEntries(explicit)).toEqual(Object.fromEntries(media));
  });

  it('gives the explicit dark switch every value of the OS dark palette in the app tokens', () => {
    const media = declarations(blockAfter(":root:not([data-theme='light']) {", workbenchCss));
    const explicit = declarations(blockAfter(":root[data-theme='dark'] {", workbenchCss));
    expect(media.size).toBeGreaterThan(20);
    // The explicit block also carries the dark aliases; the OS palette must be a subset of it.
    for (const [name, value] of media) expect([name, explicit.get(name)]).toEqual([name, value]);
  });
});
