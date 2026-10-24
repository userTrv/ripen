/**
 * Storage used by the service. `Store` keeps data in SQLite (Node.js),
 * `MemoryStore` in memory (tests, the in-browser demo). Every event keeps the
 * channel the subscriber was in at that moment, so health is computed from
 * history rather than current state.
 */

export interface SubscriberRow {
  id: string;
  channel: string;
  consent: number;
  joined_at: number;
  last_seen_at: number;
  last_pulse_at: number | null;
  demoted_from: string | null;
  demoted_reason: string | null;
}

export interface FeatureRow {
  key: string;
  description: string;
  stage: string;
  stage_since: number;
  gate_json: string | null;
  created_at: number;
}

export interface HistoryRow {
  feature: string;
  from_stage: string;
  to_stage: string;
  action: string;
  actor: string | null;
  forced: number;
  checks_json: string | null;
  created_at: number;
}

export interface ReportView {
  id: number;
  channel: string;
  feature: string | null;
  message: string;
  app_version: string | null;
  created_at: number;
}

export interface RipenStore {
  /** Runs `fn` atomically: if it throws, nothing it wrote is kept. */
  transaction<T>(fn: () => T): T;

  getSubscriber(id: string): SubscriberRow | undefined;
  insertSubscriber(row: SubscriberRow): void;
  updateSubscriber(row: SubscriberRow): void;
  /** Records that a subscriber was active today in a channel (one record per day). */
  touchActivity(subscriberId: string, channel: string, at: number): void;
  countSubscribersByChannel(): Record<string, number>;

  listFeatures(): FeatureRow[];
  getFeature(key: string): FeatureRow | undefined;
  insertFeature(row: FeatureRow): void;
  updateFeature(row: FeatureRow): void;
  addHistory(row: HistoryRow): void;
  history(feature: string): HistoryRow[];

  addPulse(subscriberId: string, channel: string, feature: string | null, status: 'ok' | 'broken', appVersion: string | null, at: number): void;
  addReport(subscriberId: string, channel: string, feature: string | null, message: string, appVersion: string | null, contextJson: string | null, at: number): number;
  addError(subscriberId: string, channel: string, fingerprint: string, message: string | null, appVersion: string | null, at: number): void;

  /** Pulses about the feature or about the app in general, from the given channels since `since`. */
  countPulses(channels: string[], feature: string, since: number): { ok: number; broken: number };
  /**
   * Errors per active subscriber who consented to error collection, in the given
   * channels since `since`; null if no such subscriber was active. Subscribers
   * without consent never send errors, so counting them would skew the baseline.
   */
  errorRate(channels: string[], since: number): number | null;
  /** Latest reports about the feature or the app in general, newest first. */
  recentReports(channels: string[], feature: string, since: number, limit?: number): ReportView[];
}

export const DAY_MS = 24 * 60 * 60 * 1000;
