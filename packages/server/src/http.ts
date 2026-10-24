import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createApi, type ApiOptions } from './api.ts';
import { ServiceError, type Service } from './service.ts';

export interface HttpOptions extends ApiOptions {
  /** Origins allowed to call the client API from browsers. "*" allows any. */
  corsOrigins: string[];
}

const MAX_BODY_BYTES = 64 * 1024;

/** Serves the Ripen API over `node:http`, adding CORS and a body size limit. */
export function createRipenServer(service: Service, options: HttpOptions): Server {
  const api = createApi(service, options);

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const isClientApi = url.pathname.startsWith('/v1/client/');
    if (isClientApi) applyCors(req, res, options.corsOrigins);
    if (req.method === 'OPTIONS') return send(res, isClientApi ? 204 : 404, null);

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

