import {
  OFF,
  assertCanJoin,
  checkContract,
  defaultChannel,
  evaluateGate,
  isEnabled,
  isValidStage,
  nextStage,
  parseGate,
  previousStage,
  splitByStage,
  type ChannelConfig,
  type GateResult,
  type GateRules,
  type RipenConfig,
  type StageHealth,
} from '@ripen/core';
import type { EventListener, RipenEvent, RipenEventType } from './events.ts';
import type { FeatureRow, ReportView, RipenStore, SubscriberRow } from './storage.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** An error the HTTP layer turns into a 4xx response. */
export class ServiceError extends Error {
  override name = 'ServiceError';
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface SessionView {
  subscriber: {
    id: string;
    channel: string;
    consent: boolean;
    /** Set when the subscriber was moved down for breaking the channel contract. */
    demotion: { from: string; reason: string } | null;
  };
  channels: ChannelConfig[];
  features: Record<string, boolean>;
}

export interface FeatureView {
  key: string;
  description: string;
  stage: string;
  stageSince: string;
  nextStage: string | null;
  gate: GateRules;
}

export interface HealthView {
  feature: FeatureView;
  health: StageHealth;
  gate: GateResult | null;
  recentReports: ReportView[];
}

export class Service {
  readonly config: RipenConfig;
  private readonly store: RipenStore;
  private readonly now: () => Date;
  private readonly listeners = new Set<EventListener>();
  /** Events of the transaction in progress; emitted once it commits. */
  private pending: RipenEvent[] = [];

  constructor(config: RipenConfig, store: RipenStore, now: () => Date = () => new Date()) {
    this.config = config;
    this.store = store;
    this.now = now;
  }

  /** Calls `listener` after every stored change worth telling others about. Returns an unsubscribe function. */
  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Client side: what the SDK calls

  session(subscriberId: string): SessionView {
    const row = this.tx(() => this.loadSubscriber(subscriberId));
    return this.sessionView(row);
  }

  chooseChannel(subscriberId: string, channelId: string, consent: boolean): SessionView {
    try {
      assertCanJoin(this.config, channelId, consent);
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'invalid_channel';
      throw new ServiceError(code === 'unknown_channel' ? 404 : 400, code, (error as Error).message);
    }
    const row = this.tx(() => {
      const current = this.loadSubscriber(subscriberId);
      const now = this.now().getTime();
      const next: SubscriberRow = {
        ...current,
        consent: consent ? 1 : 0,
        demoted_from: null,
        demoted_reason: null,
      };
      if (current.channel !== channelId) {
        next.channel = channelId;
        next.joined_at = now;
      }
      this.store.updateSubscriber(next);
      // Today's activity belongs to the channel the subscriber is in now.
      this.store.touchActivity(next.id, next.channel, now);
      return next;
    });
    return this.sessionView(row);
  }

  pulse(subscriberId: string, status: 'ok' | 'broken', feature: string | null, appVersion: string | null): void {
    this.tx(() => {
      const row = this.loadSubscriber(subscriberId);
      const now = this.now().getTime();
      this.store.addPulse(row.id, row.channel, feature, status, appVersion, now);
      this.store.updateSubscriber({ ...row, last_pulse_at: now });
    });
  }

  report(subscriberId: string, message: string, feature: string | null, appVersion: string | null, context: unknown): number {
    return this.tx(() => {
      const row = this.loadSubscriber(subscriberId);
      const contextJson = context === undefined ? null : JSON.stringify(context);
      const id = this.store.addReport(row.id, row.channel, feature, message, appVersion, contextJson, this.now().getTime());
      this.emit('report.created', { id, feature, channel: row.channel, message, appVersion });
      return id;
    });
  }

  error(subscriberId: string, fingerprint: string, message: string | null, appVersion: string | null, feature: string | null = null): void {
    this.tx(() => {
      const row = this.loadSubscriber(subscriberId);
      // Errors are part of the contract: only accepted from subscribers who agreed to it.
      if (!row.consent) return;
      this.store.addError(row.id, row.channel, feature, fingerprint, message, appVersion, this.now().getTime());
    });
  }

  // Admin side: dashboard, CLI and CI

  listFeatures(): FeatureView[] {
    return this.store.listFeatures().map((f) => this.featureView(f));
  }

  upsertFeature(key: string, description: string | undefined, gate: unknown): FeatureView {
    let rules: GateRules | null = null;
    if (gate !== undefined && gate !== null) {
      try {
        rules = parseGate(gate, 'gate', this.config.gate);
      } catch (error) {
        throw new ServiceError(400, 'invalid_gate', (error as Error).message);
      }
    }
    const row = this.tx(() => {
      const existing = this.store.getFeature(key);
      if (existing) {
        const next: FeatureRow = {
          ...existing,
          description: description ?? existing.description,
          gate_json: gate === undefined ? existing.gate_json : rules && JSON.stringify(rules),
        };
        this.store.updateFeature(next);
        return next;
      }
      const now = this.now().getTime();
      const created: FeatureRow = {
        key,
        description: description ?? '',
        stage: OFF,
        stage_since: now,
        gate_json: rules && JSON.stringify(rules),
        created_at: now,
      };
      this.store.insertFeature(created);
      return created;
    });
    return this.featureView(row);
  }

  health(key: string): HealthView {
    const feature = this.requireFeature(key);
    const health = this.measure(feature);
    const gate = nextStage(this.config, feature.stage) === null || feature.stage === OFF
      ? null
      : evaluateGate(this.rules(feature), health);
    const { with: withFeature } = splitByStage(this.config, feature.stage);
    return {
      feature: this.featureView(feature),
      health,
      gate,
      recentReports: this.store.recentReports(withFeature, key, feature.stage_since),
    };
  }

  /**
   * Moves a feature to the next channel. Leaving "off" needs no gate: the first
   * channel is where evidence is collected. Otherwise the gate must pass unless forced.
   */
  promote(key: string, actor: string | null, force: boolean): { feature: FeatureView; gate: GateResult | null } {
    return this.tx(() => {
      const feature = this.requireFeature(key);
      const target = nextStage(this.config, feature.stage);
      if (target === null) {
        throw new ServiceError(409, 'already_everywhere', `"${key}" is already enabled in every channel`);
      }
      const gate = feature.stage === OFF ? null : evaluateGate(this.rules(feature), this.measure(feature));
      if (gate && !gate.pass && !force) {
        throw new GateFailedError(key, gate);
      }
      return { feature: this.moveFeature(feature, target, 'promote', actor, force, gate), gate };
    });
  }

  /** Moves a feature back one channel, or straight to `to` (e.g. "off" as a kill switch). */
  rollback(key: string, to: string | undefined, actor: string | null): FeatureView {
    return this.tx(() => {
      const feature = this.requireFeature(key);
      const target = to ?? previousStage(this.config, feature.stage);
      if (target === null) {
        throw new ServiceError(409, 'already_off', `"${key}" is already off`);
      }
      const backwards = target === OFF || (isValidStage(this.config, target) && isEnabled(this.config, feature.stage, target) && target !== feature.stage);
      if (feature.stage === OFF || !backwards) {
        throw new ServiceError(400, 'invalid_target', `cannot roll "${key}" back from "${feature.stage}" to "${target}"`);
      }
      return this.moveFeature(feature, target, 'rollback', actor, false, null);
    });
  }

  history(key: string) {
    this.requireFeature(key);
    return this.store.history(key).map((h) => ({
      from: h.from_stage,
      to: h.to_stage,
      action: h.action,
      actor: h.actor,
      forced: h.forced === 1,
      checks: h.checks_json ? JSON.parse(h.checks_json) : null,
      at: new Date(h.created_at).toISOString(),
    }));
  }

  /** Deletes events older than `days` days. Returns how many were deleted. */
  purgeOlderThan(days: number): number {
    return this.store.purge(this.now().getTime() - days * DAY_MS);
  }

  channelStats(): { id: string; name: string; subscribers: number }[] {
    const counts = this.store.countSubscribersByChannel();
    return this.config.channels.map((c) => ({ id: c.id, name: c.name, subscribers: counts[c.id] ?? 0 }));
  }

  // Internals

  /** Runs `fn` in a store transaction and emits its events only if it commits. */
  private tx<T>(fn: () => T): T {
    const outer = this.pending;
    this.pending = [];
    let events: RipenEvent[];
    let result: T;
    try {
      result = this.store.transaction(fn);
      events = this.pending;
    } finally {
      this.pending = outer;
    }
    for (const event of events) {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error('ripen event listener failed:', error);
        }
      }
    }
    return result;
  }

  private emit<T extends RipenEventType>(type: T, data: Extract<RipenEvent, { type: T }>['data']): void {
    this.pending.push({ id: crypto.randomUUID(), type, at: this.now().toISOString(), data } as RipenEvent);
  }

  /** Loads or creates a subscriber, records activity and applies the channel contract. */
  private loadSubscriber(id: string): SubscriberRow {
    const now = this.now();
    const at = now.getTime();
    let row = this.store.getSubscriber(id);
    if (!row) {
      row = {
        id,
        channel: defaultChannel(this.config).id,
        consent: 0,
        joined_at: at,
        last_seen_at: at,
        last_pulse_at: null,
        demoted_from: null,
        demoted_reason: null,
      };
      this.store.insertSubscriber(row);
    } else {
      // A channel removed from the config sends its subscribers to the default one.
      if (!this.config.channels.some((c) => c.id === row!.channel)) {
        row = { ...row, channel: defaultChannel(this.config).id, joined_at: at };
      }
      const check = checkContract(
        this.config,
        { channel: row.channel, joinedAt: new Date(row.joined_at), lastPulseAt: row.last_pulse_at === null ? null : new Date(row.last_pulse_at) },
        now,
      );
      if (!check.ok) {
        this.emit('subscriber.demoted', { from: row.channel, to: check.demoteTo, reason: check.reason });
        row = { ...row, demoted_from: row.channel, demoted_reason: check.reason, channel: check.demoteTo, joined_at: at };
      }
      row = { ...row, last_seen_at: at };
      this.store.updateSubscriber(row);
    }
    this.store.touchActivity(row.id, row.channel, at);
    return row;
  }

  private sessionView(row: SubscriberRow): SessionView {
    const features: Record<string, boolean> = {};
    for (const f of this.store.listFeatures()) {
      features[f.key] = isEnabled(this.config, f.stage, row.channel);
    }
    return {
      subscriber: {
        id: row.id,
        channel: row.channel,
        consent: row.consent === 1,
        demotion: row.demoted_from && row.demoted_reason ? { from: row.demoted_from, reason: row.demoted_reason } : null,
      },
      channels: this.config.channels,
      features,
    };
  }

  private measure(feature: FeatureRow): StageHealth {
    const split = splitByStage(this.config, feature.stage);
    const since = feature.stage_since;
    const pulses = this.store.countPulses(split.with, feature.key, since);
    return {
      daysInStage: (this.now().getTime() - since) / DAY_MS,
      pulsesOk: pulses.ok,
      pulsesBroken: pulses.broken,
      errorRateWith: this.store.errorRate(split.with, feature.key, since),
      errorRateWithout: this.store.errorRate(split.without, feature.key, since),
    };
  }

  private moveFeature(feature: FeatureRow, target: string, action: string, actor: string | null, forced: boolean, gate: GateResult | null): FeatureView {
    const now = this.now().getTime();
    const next: FeatureRow = { ...feature, stage: target, stage_since: now };
    this.store.updateFeature(next);
    this.store.addHistory({
      feature: feature.key,
      from_stage: feature.stage,
      to_stage: target,
      action,
      actor,
      forced: forced ? 1 : 0,
      checks_json: gate && JSON.stringify(gate.checks),
      created_at: now,
    });
    if (action === 'promote') {
      this.emit('feature.promoted', { feature: feature.key, from: feature.stage, to: target, actor, forced, gate });
    } else {
      this.emit('feature.rolled_back', { feature: feature.key, from: feature.stage, to: target, actor });
    }
    return this.featureView(next);
  }

  private requireFeature(key: string): FeatureRow {
    const feature = this.store.getFeature(key);
    if (!feature) throw new ServiceError(404, 'unknown_feature', `unknown feature "${key}"`);
    return feature;
  }

  private rules(feature: FeatureRow): GateRules {
    return feature.gate_json ? (JSON.parse(feature.gate_json) as GateRules) : this.config.gate;
  }

  private featureView(f: FeatureRow): FeatureView {
    return {
      key: f.key,
      description: f.description,
      stage: f.stage,
      stageSince: new Date(f.stage_since).toISOString(),
      nextStage: nextStage(this.config, f.stage),
      gate: this.rules(f),
    };
  }
}

export class GateFailedError extends ServiceError {
  override name = 'GateFailedError';
  readonly gate: GateResult;

  constructor(key: string, gate: GateResult) {
    super(409, 'gate_failed', `"${key}" did not pass the gate`);
    this.gate = gate;
  }
}
