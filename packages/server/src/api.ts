import { isRecord } from '@ripen/core';
import { GateFailedError, ServiceError, type Service } from './service.ts';

/**
 * The Ripen HTTP API as a plain function: request in, response out. It has no
 * Node.js imports, so the same code serves `node:http` and the in-browser demo.
 */

export interface ApiOptions {
  /** Key embedded in apps. Public by nature, it only grants the client API. */
  clientKey: string;
  /** Secret for the dashboard, CLI and CI. */
  adminToken: string;
}

export interface ApiRequest {
  method: string;
  /** Path without query string, e.g. "/v1/client/session". */
  path: string;
  /** Value of the Authorization header, if any. */
  authorization: string | undefined;
  /** Raw request body; empty for none. */
  body: string;
}

export interface ApiResponse {
  status: number;
  /** JSON-serializable body, or null for an empty response. */
  body: unknown;
}

export type ApiHandler = (request: ApiRequest) => Promise<ApiResponse>;

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const FEATURE_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;

type Handler = (ctx: Context) => unknown;

interface Route {
  method: string;
  pattern: RegExp;
  scope: 'public' | 'client' | 'admin';
  handler: Handler;
}

interface Context {
  params: string[];
  body: Record<string, unknown>;
}

export function createApi(service: Service, options: ApiOptions): ApiHandler {
  const routes = buildRoutes(service);

  return async (request) => {
    const match = findRoute(routes, request.method, request.path);
    if (!match) return { status: 404, body: { error: 'not_found', message: 'no such endpoint' } };

    const { route, params } = match;
    if (route.scope === 'client' && !authorized(request.authorization, options.clientKey)) {
      return { status: 401, body: { error: 'unauthorized', message: 'missing or wrong client key' } };
    }
    if (route.scope === 'admin' && !authorized(request.authorization, options.adminToken)) {
      return { status: 401, body: { error: 'unauthorized', message: 'missing or wrong admin token' } };
    }

    try {
      const body = request.method === 'GET' ? {} : parseJson(request.body);
      const result = await route.handler({ params, body });
      return result === undefined ? { status: 204, body: null } : { status: 200, body: result };
    } catch (error) {
      if (error instanceof GateFailedError) {
        return { status: error.status, body: { error: error.code, message: error.message, gate: error.gate } };
      }
      if (error instanceof ServiceError) {
        return { status: error.status, body: { error: error.code, message: error.message } };
      }
      console.error(error);
      return { status: 500, body: { error: 'internal', message: 'internal server error' } };
    }
  };
}

function buildRoutes(service: Service): Route[] {
  const route = (method: string, path: string, scope: Route['scope'], handler: Handler): Route => ({
    method,
    // ":param" segments capture one path segment.
    pattern: new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`),
    scope,
    handler,
  });

  return [
    route('GET', '/healthz', 'public', () => ({ ok: true })),

    route('POST', '/v1/client/session', 'client', ({ body }) => service.session(id(body, 'subscriberId'))),
    route('PUT', '/v1/client/subscribers/:id/channel', 'client', ({ params, body }) =>
      service.chooseChannel(pathId(params[0]), str(body, 'channel', 64), body['consent'] === true),
    ),
    route('POST', '/v1/client/pulses', 'client', ({ body }) => {
      const status = body['status'];
      if (status !== 'ok' && status !== 'broken') throw badRequest('status must be "ok" or "broken"');
      service.pulse(id(body, 'subscriberId'), status, featureKey(body), optStr(body, 'appVersion', 64));
    }),
    route('POST', '/v1/client/reports', 'client', ({ body }) => {
      const context = body['context'];
      if (context !== undefined && !isRecord(context)) throw badRequest('context must be an object');
      const reportId = service.report(id(body, 'subscriberId'), str(body, 'message', 4000), featureKey(body), optStr(body, 'appVersion', 64), context);
      return { id: reportId };
    }),
    route('POST', '/v1/client/errors', 'client', ({ body }) => {
      service.error(id(body, 'subscriberId'), str(body, 'fingerprint', 128), optStr(body, 'message', 1000), optStr(body, 'appVersion', 64));
    }),

    route('GET', '/v1/admin/channels', 'admin', () => service.channelStats()),
    route('GET', '/v1/admin/features', 'admin', () => service.listFeatures()),
    route('PUT', '/v1/admin/features/:key', 'admin', ({ params, body }) =>
      service.upsertFeature(pathKey(params[0]), optStr(body, 'description', 500) ?? undefined, body['gate']),
    ),
    route('GET', '/v1/admin/features/:key/health', 'admin', ({ params }) => service.health(pathKey(params[0]))),
    route('GET', '/v1/admin/features/:key/history', 'admin', ({ params }) => service.history(pathKey(params[0]))),
    route('POST', '/v1/admin/features/:key/promote', 'admin', ({ params, body }) =>
      service.promote(pathKey(params[0]), optStr(body, 'actor', 128), body['force'] === true),
    ),
    route('POST', '/v1/admin/features/:key/rollback', 'admin', ({ params, body }) =>
      service.rollback(pathKey(params[0]), optStr(body, 'to', 64) ?? undefined, optStr(body, 'actor', 128)),
    ),
  ];
}

function findRoute(routes: Route[], method: string, path: string): { route: Route; params: string[] } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.pattern.exec(path);
    if (m) return { route, params: m.slice(1).map((p) => decodeURIComponent(p)) };
  }
  return null;
}

/** Compares in constant time for equal lengths, so the token cannot be guessed byte by byte. */
function authorized(header: string | undefined, secret: string): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (token.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

function parseJson(raw: string): Record<string, unknown> {
  if (raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest('body must be valid JSON');
  }
  if (!isRecord(parsed)) throw badRequest('body must be a JSON object');
  return parsed;
}

function badRequest(message: string): ServiceError {
  return new ServiceError(400, 'bad_request', message);
}

function str(body: Record<string, unknown>, key: string, max: number): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw badRequest(`${key} must be a non-empty string up to ${max} characters`);
  }
  return value;
}

function optStr(body: Record<string, unknown>, key: string, max: number): string | null {
  return body[key] === undefined || body[key] === null ? null : str(body, key, max);
}

function id(body: Record<string, unknown>, key: string): string {
  const value = str(body, key, 128);
  if (!ID.test(value)) throw badRequest(`${key} must match ${ID}`);
  return value;
}

function featureKey(body: Record<string, unknown>): string | null {
  const value = optStr(body, 'feature', 128);
  if (value !== null && !FEATURE_KEY.test(value)) throw badRequest(`feature must match ${FEATURE_KEY}`);
  return value;
}

function pathId(value: string | undefined): string {
  if (!value || !ID.test(value)) throw badRequest(`subscriber id must match ${ID}`);
  return value;
}

function pathKey(value: string | undefined): string {
  if (!value || !FEATURE_KEY.test(value)) throw badRequest(`feature key must match ${FEATURE_KEY}`);
  return value;
}
