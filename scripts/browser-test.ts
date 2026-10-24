/**
 * Runs packages/elements/test/browser/test.html in headless Chromium against a
 * real Ripen server, without any test framework. Requires `pnpm build` first.
 *
 * Browser path: RIPEN_CHROMIUM, or Playwright's preinstalled headless shell.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { DEFAULT_CONFIG } from '@ripen/core';
import { createRipenServer, Service, Store } from '@ripen/server';

const root = resolve(import.meta.dirname, '..');
const CLIENT_KEY = 'browser-test-client-key';
const TIMEOUT_MS = 20_000;

const chromium =
  process.env['RIPEN_CHROMIUM'] ??
  '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
if (!existsSync(chromium)) {
  console.error(`Chromium not found at ${chromium}. Set RIPEN_CHROMIUM.`);
  process.exit(1);
}

const mounts: Record<string, string> = {
  '/sdk/': join(root, 'packages/sdk-js/dist'),
  '/elements/': join(root, 'packages/elements/dist'),
};
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json' };

// API server
const store = new Store(':memory:');
const api = createRipenServer(new Service(DEFAULT_CONFIG, store), {
  clientKey: CLIENT_KEY,
  adminToken: 'browser-test-admin-token',
  corsOrigins: ['*'],
});
await listen(api);

// Static server that also receives the result from the page
let resolveResult: (value: { ok: boolean; steps: string[]; error?: string }) => void;
const result = new Promise<{ ok: boolean; steps: string[]; error?: string }>((r) => (resolveResult = r));

const site = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/__result' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.end();
      resolveResult(JSON.parse(body));
    });
    return;
  }
  let file: string | null = null;
  if (url.pathname === '/test.html') file = join(root, 'packages/elements/test/browser/test.html');
  for (const [prefix, dir] of Object.entries(mounts)) {
    if (url.pathname.startsWith(prefix)) {
      const candidate = normalize(join(dir, url.pathname.slice(prefix.length)));
      if (candidate.startsWith(dir)) file = candidate;
    }
  }
  if (!file || !existsSync(file)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await listen(site);

const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
const pageUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/test.html?api=${encodeURIComponent(apiUrl)}&key=${CLIENT_KEY}`;

const browser = spawn(chromium, ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', pageUrl], { stdio: ['ignore', 'ignore', 'pipe'] });
let browserLog = '';
browser.stderr.on('data', (chunk) => (browserLog += chunk));

const timer = setTimeout(() => resolveResult({ ok: false, steps: [], error: `no result after ${TIMEOUT_MS} ms\n${browserLog}` }), TIMEOUT_MS);
const outcome = await result;
clearTimeout(timer);
browser.kill();

// What the page did must be visible on the server.
const db = store.db;
const serverChecks: [boolean, string][] = [
  [(db.prepare("SELECT channel, consent FROM subscribers WHERE id = 'browser-1'").get() as { channel: string; consent: number } | undefined)?.channel === 'early', 'server: subscriber is in early'],
  [(db.prepare("SELECT COUNT(*) AS n FROM pulses WHERE status = 'ok' AND feature IS NULL AND app_version = '1.2.3'").get() as { n: number }).n === 1, 'server: one general ok pulse'],
  [(db.prepare("SELECT COUNT(*) AS n FROM pulses WHERE status = 'broken' AND feature = 'search-v2'").get() as { n: number }).n === 1, 'server: one broken pulse about search-v2'],
  [(db.prepare("SELECT message FROM reports WHERE feature = 'search-v2'").get() as { message: string } | undefined)?.message === 'Quoted phrases return <b>nothing</b>', 'server: report stored verbatim'],
];

api.close();
site.close();
store.close();

for (const step of outcome.steps) console.log(`ok - ${step}`);
let failed = !outcome.ok;
if (outcome.error) console.log(`not ok - ${outcome.error}`);
if (outcome.ok) {
  for (const [pass, message] of serverChecks) {
    console.log(`${pass ? 'ok' : 'not ok'} - ${message}`);
    if (!pass) failed = true;
  }
}
console.log(failed ? '\nbrowser test FAILED' : '\nbrowser test passed');
process.exit(failed ? 1 : 0);

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((r) => server.listen(0, '127.0.0.1', r));
}
