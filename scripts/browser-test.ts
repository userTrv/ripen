/**
 * Browser tests without a test framework: headless Chromium opens a page that
 * drives the UI and posts its result back. Requires `pnpm build` first.
 *
 *   1. Web components (packages/elements/test/browser/test.html) against a real server.
 *   2. The dashboard, served by the Ripen server itself at /dashboard/.
 *
 * Browser path: RIPEN_CHROMIUM, or Playwright's preinstalled headless shell.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { DEFAULT_CONFIG } from '@ripen/core';
import { createRipenServer, Service, Store } from '@ripen/server';

interface Outcome {
  ok: boolean;
  steps: string[];
  error?: string;
}

const root = resolve(import.meta.dirname, '..');
const TIMEOUT_MS = 20_000;
const chromium =
  process.env['RIPEN_CHROMIUM'] ??
  '/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
if (!existsSync(chromium)) {
  console.error(`Chromium not found at ${chromium}. Set RIPEN_CHROMIUM.`);
  process.exit(1);
}

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript' };
const servers: Server[] = [];
const stores: Store[] = [];

/** A tiny server for static files and for the page's result. */
let resolveResult: (outcome: Outcome) => void = () => {};
const site = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/__result' && req.method === 'GET' && url.searchParams.has('r')) {
    res.end('ok');
    resolveResult(JSON.parse(url.searchParams.get('r')!));
    return;
  }
  if (url.pathname === '/__result' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.end();
      resolveResult(JSON.parse(body));
    });
    return;
  }
  const mounts: Record<string, string> = {
    '/sdk/': join(root, 'packages/sdk-js/dist'),
    '/elements/': join(root, 'packages/elements/dist'),
    '/elements-test/': join(root, 'packages/elements/test/browser'),
  };
  for (const [prefix, dir] of Object.entries(mounts)) {
    const file = normalize(join(dir, url.pathname.slice(prefix.length)));
    if (url.pathname.startsWith(prefix) && file.startsWith(dir) && existsSync(file)) {
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      res.end(readFileSync(file));
      return;
    }
  }
  res.statusCode = 404;
  res.end();
});
await listen(site);
const siteUrl = address(site);

async function runPage(name: string, url: string): Promise<Outcome> {
  const result = new Promise<Outcome>((r) => (resolveResult = r));
  const browser = spawn(chromium, ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', url], { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  browser.stderr.on('data', (chunk) => (log += chunk));
  const timer = setTimeout(() => resolveResult({ ok: false, steps: [], error: `no result after ${TIMEOUT_MS} ms\n${log}` }), TIMEOUT_MS);
  const outcome = await result;
  clearTimeout(timer);
  browser.kill();
  console.log(`# ${name}`);
  for (const step of outcome.steps) console.log(`ok - ${step}`);
  if (outcome.error) console.log(`not ok - ${outcome.error}`);
  return outcome;
}

function serverChecks(checks: [boolean, string][]): boolean {
  let pass = true;
  for (const [ok, message] of checks) {
    console.log(`${ok ? 'ok' : 'not ok'} - ${message}`);
    pass &&= ok;
  }
  return pass;
}

let failed = false;

// 1. Web components
{
  const store = new Store(':memory:');
  stores.push(store);
  const api = createRipenServer(new Service(DEFAULT_CONFIG, store), { clientKey: 'browser-test-client-key', adminToken: 'browser-test-admin-token', corsOrigins: ['*'] });
  await listen(api);
  const page = `${siteUrl}/elements-test/test.html?api=${encodeURIComponent(address(api))}&key=browser-test-client-key&report=${encodeURIComponent(`${siteUrl}/__result`)}`;
  const outcome = await runPage('web components', page);
  const db = store.db;
  failed ||= !outcome.ok || !serverChecks([
    [(db.prepare("SELECT channel FROM subscribers WHERE id = 'browser-1'").get() as { channel: string } | undefined)?.channel === 'early', 'server: subscriber is in early'],
    [(db.prepare("SELECT COUNT(*) AS n FROM pulses WHERE status = 'ok' AND feature IS NULL AND app_version = '1.2.3'").get() as { n: number }).n === 1, 'server: one general ok pulse'],
    [(db.prepare("SELECT COUNT(*) AS n FROM pulses WHERE status = 'broken' AND feature = 'search-v2'").get() as { n: number }).n === 1, 'server: one broken pulse about search-v2'],
    [(db.prepare("SELECT message FROM reports WHERE feature = 'search-v2'").get() as { message: string } | undefined)?.message === 'Quoted phrases return <b>nothing</b>', 'server: report stored verbatim'],
  ]);
}

// 2. Dashboard, served by the Ripen server with the test page added to its directory
{
  const dir = mkdtempSync(join(tmpdir(), 'ripen-dashboard-'));
  cpSync(join(root, 'packages/dashboard/dist'), dir, { recursive: true });
  cpSync(join(root, 'packages/dashboard/test/browser'), dir, { recursive: true });
  const store = new Store(':memory:');
  stores.push(store);
  const service = new Service(DEFAULT_CONFIG, store);
  const adminToken = 'dashboard-test-admin-token';
  // A feature that fails its gate because an early subscriber found it broken.
  service.upsertFeature('search-v2', 'Search v2', undefined);
  service.promote('search-v2', 'seed', false);
  service.chooseChannel('early-1', 'early', true);
  service.chooseChannel('regular-1', 'regular', false);
  service.pulse('early-1', 'broken', 'search-v2', '3.0.0');
  service.report('early-1', 'Login button does nothing', 'search-v2', '3.0.0', undefined);

  const ripen = createRipenServer(service, { clientKey: 'dashboard-test-client-key', adminToken, corsOrigins: [], dashboardDir: dir });
  await listen(ripen);
  const base = address(ripen);

  // Static serving rules, checked before the page runs.
  const redirect = await fetch(`${base}/dashboard`, { redirect: 'manual' });
  const index = await fetch(`${base}/dashboard/`);
  const traversal = await fetch(`${base}/dashboard/..%2F..%2Fetc%2Fpasswd`);
  const staticOk = serverChecks([
    [redirect.status === 308 && redirect.headers.get('location') === '/dashboard/', 'server: /dashboard redirects to /dashboard/'],
    [index.status === 200 && (await index.text()).includes('<ripen-dashboard'), 'server: serves the dashboard page'],
    [(index.headers.get('content-security-policy') ?? '').includes("default-src 'self'"), 'server: dashboard has a strict CSP'],
    [traversal.status === 404, 'server: path traversal is refused'],
  ]);

  const outcome = await runPage('dashboard', `${base}/dashboard/dashboard.html?token=${adminToken}&report=${encodeURIComponent(`${siteUrl}/__result`)}`);
  const history = service.history('search-v2');
  failed ||= !staticOk || !outcome.ok || !serverChecks([
    [service.health('dark-mode').feature.stage === 'early', 'server: dark-mode was created and promoted'],
    [history.some((h) => h.forced && h.actor === 'browser-test'), 'server: forced promotion recorded with the actor'],
    [service.health('search-v2').feature.stage === 'off', 'server: search-v2 was turned off'],
  ]);
  rmSync(dir, { recursive: true, force: true });
}

for (const server of [site, ...servers]) server.close();
for (const store of stores) store.close();
console.log(failed ? '\nbrowser tests FAILED' : '\nbrowser tests passed');
process.exit(failed ? 1 : 0);

function listen(server: Server): Promise<void> {
  if (server !== site) servers.push(server);
  return new Promise((r) => server.listen(0, '127.0.0.1', r));
}

function address(server: Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
