/**
 * Assembles the in-browser demo into apps/demo/site:
 *   page.html   the page body (as published to claude.ai Artifacts)
 *   index.html  the same page as a full document, for any static host
 *   lib/        compiled packages, loaded through the import map
 * Requires `pnpm build` first.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const site = join(root, 'apps/demo/site');

const libs: Record<string, string> = {
  core: 'packages/core/dist',
  server: 'packages/server/dist',
  sdk: 'packages/sdk-js/dist',
  elements: 'packages/elements/dist',
  demo: 'apps/demo/dist',
};

rmSync(site, { recursive: true, force: true });
for (const [name, dir] of Object.entries(libs)) {
  const from = join(root, dir);
  if (!existsSync(from)) throw new Error(`${dir} is missing, run pnpm build first`);
  mkdirSync(join(site, 'lib', name), { recursive: true });
  // Only JavaScript is needed in the browser; the Node-only server files are never imported.
  cpSync(from, join(site, 'lib', name), {
    recursive: true,
    filter: (src) => !src.endsWith('.d.ts') && !src.endsWith('.map') && !/server[\\/]dist[\\/](http|main|store|index)\.js$/.test(src),
  });
}

const page = readFileSync(join(root, 'apps/demo/page.html'), 'utf8');
writeFileSync(join(site, 'page.html'), page);
writeFileSync(
  join(site, 'index.html'),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${page}\n</html>\n`,
);
console.log(`demo assembled in ${site}`);
