/** Typed client for the admin API. Works with any fetch, including an in-page one. */

export interface ChannelStat {
  id: string;
  name: string;
  subscribers: number;
}

export interface GateCheck {
  id: string;
  pass: boolean;
  message: string;
}

export interface Feature {
  key: string;
  description: string;
  stage: string;
  stageSince: string;
  nextStage: string | null;
}

export interface Health {
  feature: Feature;
  health: { daysInStage: number; pulsesOk: number; pulsesBroken: number; errorRateWith: number | null; errorRateWithout: number | null };
  gate: { pass: boolean; checks: GateCheck[] } | null;
  recentReports: { id: number; channel: string; message: string; app_version: string | null; created_at: number }[];
}

export interface HistoryEntry {
  from: string;
  to: string;
  action: string;
  actor: string | null;
  forced: boolean;
  at: string;
}

export class AdminError extends Error {
  readonly status: number;
  readonly code: string;
  readonly checks: GateCheck[];

  constructor(status: number, code: string, message: string, checks: GateCheck[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.checks = checks;
  }
}

export class AdminClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;

  constructor(base: string, token: string, fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.base = base.replace(/\/+$/, '');
    this.token = token;
    this.fetchFn = fetchFn;
  }

  channels(): Promise<ChannelStat[]> {
    return this.call('GET', '/v1/admin/channels');
  }

  features(): Promise<Feature[]> {
    return this.call('GET', '/v1/admin/features');
  }

  health(key: string): Promise<Health> {
    return this.call('GET', `/v1/admin/features/${encodeURIComponent(key)}/health`);
  }

  history(key: string): Promise<HistoryEntry[]> {
    return this.call('GET', `/v1/admin/features/${encodeURIComponent(key)}/history`);
  }

  create(key: string, description: string): Promise<Feature> {
    return this.call('PUT', `/v1/admin/features/${encodeURIComponent(key)}`, description ? { description } : {});
  }

  promote(key: string, force: boolean, actor: string): Promise<{ feature: Feature }> {
    return this.call('POST', `/v1/admin/features/${encodeURIComponent(key)}/promote`, { force, actor });
  }

  rollback(key: string, actor: string, to?: string): Promise<Feature> {
    return this.call('POST', `/v1/admin/features/${encodeURIComponent(key)}/rollback`, to ? { to, actor } : { actor });
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchFn(this.base + path, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new AdminError(response.status, data?.error ?? 'http_error', data?.message ?? `HTTP ${response.status}`, data?.gate?.checks ?? []);
    }
    return data as T;
  }
}
