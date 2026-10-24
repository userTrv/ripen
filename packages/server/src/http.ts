import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { createApi, type ApiOptions } from './api.ts';
import { ServiceError, type Service } from './service.ts';

export interface HttpOptions extends ApiOptions {
  /** Origins allowed to call the client API from browsers. "*" allows any. */
  corsOrigins: string[];
  /** Directory with the built dashboard, served at /dashboard/. Omitted: no dashboard. */
  dashboardDir?: string;
}

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** The dashboard talks only to this server; styles live in Shadow DOM <style> elements. */
const DASHBOARD_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const MAX_BODY_BYTES = 64 * 1024;

/** Serves the Ripen API over `node:http`, adding CORS and a body size limit. */
export function createRipenServer(service: Service, options: HttpOptions): Server {
  const api = createApi(service, options);

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const isClientApi = url.pathname.startsWith('/v1/client/');
    if (isClientApi) applyCors(req, res, options.corsOrigins);
    if (req.method === 'OPTIONS') return send(res, isClientApi ? 204 : 404, null);
    if (options.dashboardDir && (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/'))) {
      return serveDashboard(req, res, url.pathname, options.dashboardDir);
    }

    let body = '';
    try {
      body = req.method === 'GET' ? '' : await readBody(req);
    } catch (error) {
      const e = error as ServiceError;
      return send(res, e.status, { error: e.code, message: e.message });
    }
    const response = await api({ method: req.method ?? 'GET', path: url.pathname, authorization: req.headers.authorization, body });
    send(res, response.status, response.body);
  });
}

function applyCors(req: IncomingMessage, res: ServerResponse, origins: string[]): void {
  const origin = req.headers.origin;
  if (!origin) return;
  if (origins.includes('*') || origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origins.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ServiceError(413, 'too_large', `body exceeds ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (body === null || status === 204) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function serveDashboard(req: IncomingMessage, res: ServerResponse, pathname: string, dir: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed', message: 'use GET' });
  if (pathname === '/dashboard') {
    res.statusCode = 308;
    res.setHeader('Location', '/dashboard/');
    res.end();
    return;
  }
  const root = resolve(dir);
  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice('/dashboard/'.length)) || 'index.html';
  } catch {
    return send(res, 400, { error: 'bad_request', message: 'malformed path' });
  }
  const file = resolve(root, relative);
  const type = STATIC_TYPES[extname(file)];
  if (!file.startsWith(root + sep) || !type) return send(res, 404, { error: 'not_found', message: 'no such file' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', DASHBOARD_CSP);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    send(res, 404, { error: 'not_found', message: 'no such file' });
  }
}
