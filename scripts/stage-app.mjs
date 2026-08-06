#!/usr/bin/env node
/**
 * Copies the built Vite SPA into the marketing site's public directory so it
 * is served at /app by the same deployment.
 *
 * Run after `pnpm --filter @er-visualizer/ui build` and before `next build`.
 * The UI build must have been produced with APP_BASE=/app/ — otherwise its
 * assets resolve relative to the document and break on the /app URL.
 */
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repoRoot, 'packages/ui/dist');
const target = path.join(repoRoot, 'packages/site/public/app');

async function main() {
  try {
    const stats = await stat(source);
    if (!stats.isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(
      `stage-app: ${path.relative(repoRoot, source)} not found.\n` +
        'Build the UI first:  APP_BASE=/app/ pnpm --filter @er-visualizer/ui build'
    );
    process.exit(1);
  }

  const indexHtml = await readFile(path.join(source, 'index.html'), 'utf8');
  if (!indexHtml.includes('/app/assets/')) {
    console.error(
      'stage-app: the UI build does not reference /app/assets — it was built without APP_BASE=/app/.\n' +
        'Rebuild with:  APP_BASE=/app/ pnpm --filter @er-visualizer/ui build'
    );
    process.exit(1);
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });

  console.log(`stage-app: ${path.relative(repoRoot, source)} → ${path.relative(repoRoot, target)}`);
}

await main();
