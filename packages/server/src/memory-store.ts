import { DAY_MS, type FeatureRow, type HistoryRow, type ReportView, type RipenStore, type SubscriberRow } from './storage.ts';

interface Pulse {
  subscriberId: string;
  channel: string;
  feature: string | null;
  status: 'ok' | 'broken';
  appVersion: string | null;
  at: number;
}

interface Report extends ReportView {
  subscriberId: string;
  contextJson: string | null;
}

interface ErrorEvent {
  subscriberId: string;
  channel: string;
  feature: string | null;
  fingerprint: string;
  message: string | null;
  appVersion: string | null;
  at: number;
}

interface Data {
  subscribers: Map<string, SubscriberRow>;
  features: Map<string, FeatureRow>;
  /** "subscriberId|day" → channel */
  activity: Map<string, { subscriberId: string; channel: string; day: number }>;
  pulses: Pulse[];
  reports: Report[];
  errors: ErrorEvent[];
  history: HistoryRow[];
}

/**
 * Keeps everything in memory. For tests, the in-browser demo and trying Ripen
 * out; data is lost on restart. Works in any JavaScript runtime.
 */
export class MemoryStore implements RipenStore {
  private data: Data = {
    subscribers: new Map(),
    features: new Map(),
    activity: new Map(),
    pulses: [],
    reports: [],
    errors: [],
    history: [],
  };

  transaction<T>(fn: () => T): T {
    const snapshot = structuredClone(this.data);
    try {
      return fn();
    } catch (error) {
      this.data = snapshot;
      throw error;
    }
  }

  getSubscriber(id: string): SubscriberRow | undefined {
    const row = this.data.subscribers.get(id);
    return row && { ...row };
  }

  insertSubscriber(row: SubscriberRow): void {
    if (this.data.subscribers.has(row.id)) throw new Error(`subscriber ${row.id} exists`);
    this.data.subscribers.set(row.id, { ...row });
  }

  updateSubscriber(row: SubscriberRow): void {
    if (this.data.subscribers.has(row.id)) this.data.subscribers.set(row.id, { ...row });
  }

  touchActivity(subscriberId: string, channel: string, at: number): void {
    const day = Math.floor(at / DAY_MS);
    this.data.activity.set(`${subscriberId}|${day}`, { subscriberId, channel, day });
  }

  countSubscribersByChannel(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const s of this.data.subscribers.values()) counts[s.channel] = (counts[s.channel] ?? 0) + 1;
    return counts;
  }

  listFeatures(): FeatureRow[] {
    return [...this.data.features.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((f) => ({ ...f }));
  }

  getFeature(key: string): FeatureRow | undefined {
    const row = this.data.features.get(key);
    return row && { ...row };
  }

  insertFeature(row: FeatureRow): void {
    if (this.data.features.has(row.key)) throw new Error(`feature ${row.key} exists`);
    this.data.features.set(row.key, { ...row });
  }

  updateFeature(row: FeatureRow): void {
    if (this.data.features.has(row.key)) this.data.features.set(row.key, { ...row });
  }

  addHistory(row: HistoryRow): void {
    this.data.history.push({ ...row });
  }

  history(feature: string): HistoryRow[] {
    return this.data.history.filter((h) => h.feature === feature).map((h) => ({ ...h }));
  }

  addPulse(subscriberId: string, channel: string, feature: string | null, status: 'ok' | 'broken', appVersion: string | null, at: number): void {
    this.data.pulses.push({ subscriberId, channel, feature, status, appVersion, at });
  }

  addReport(subscriberId: string, channel: string, feature: string | null, message: string, appVersion: string | null, contextJson: string | null, at: number): number {
    const id = this.data.reports.length + 1;
    this.data.reports.push({ id, subscriberId, channel, feature, message, app_version: appVersion, contextJson, created_at: at });
    return id;
  }

  addError(subscriberId: string, channel: string, feature: string | null, fingerprint: string, message: string | null, appVersion: string | null, at: number): void {
    this.data.errors.push({ subscriberId, channel, feature, fingerprint, message, appVersion, at });
  }

  countPulses(channels: string[], feature: string, since: number): { ok: number; broken: number } {
    let ok = 0;
    let broken = 0;
    for (const p of this.data.pulses) {
      if (p.at < since || !channels.includes(p.channel) || (p.feature !== null && p.feature !== feature)) continue;
      if (p.status === 'ok') ok++;
      else broken++;
    }
    return { ok, broken };
  }

  errorRate(channels: string[], feature: string, since: number): number | null {
    if (channels.length === 0) return null;
    const sinceDay = Math.floor(since / DAY_MS);
    const active = new Set<string>();
    for (const a of this.data.activity.values()) {
      if (a.day >= sinceDay && channels.includes(a.channel) && this.data.subscribers.get(a.subscriberId)?.consent) active.add(a.subscriberId);
    }
    if (active.size === 0) return null;
    const errors = this.data.errors.filter((e) => e.at >= since && channels.includes(e.channel) && (e.feature === null || e.feature === feature)).length;
    return errors / active.size;
  }

  purge(before: number): number {
    const sizes = this.data.pulses.length + this.data.reports.length + this.data.errors.length;
    this.data.pulses = this.data.pulses.filter((p) => p.at >= before);
    this.data.reports = this.data.reports.filter((r) => r.created_at >= before);
    this.data.errors = this.data.errors.filter((e) => e.at >= before);
    const day = Math.floor(before / DAY_MS);
    for (const [key, a] of this.data.activity) if (a.day < day) this.data.activity.delete(key);
    return sizes - (this.data.pulses.length + this.data.reports.length + this.data.errors.length);
  }

  recentReports(channels: string[], feature: string, since: number, limit = 20): ReportView[] {
    return this.data.reports
      .filter((r) => r.created_at >= since && channels.includes(r.channel) && (r.feature === null || r.feature === feature))
      .reverse()
      .slice(0, limit)
      .map(({ id, channel, feature: f, message, app_version, created_at }) => ({ id, channel, feature: f, message, app_version, created_at }));
  }
}
