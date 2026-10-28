import { DEFAULT_CONFIG, isEnabled } from '@ripen/core';
import { MemoryStore, Service, createApi, type ApiHandler, type FeatureView } from '@ripen/server/engine';

/**
 * A Ripen server running in the page, plus a crowd of simulated subscribers.
 * Everything goes through the real service and API; only people are fake.
 */

export const CLIENT_KEY = 'demo-client-key';
export const ADMIN_TOKEN = 'demo-admin-token';
const DAY = 24 * 60 * 60 * 1000;

export interface DemoFeature {
  key: string;
  title: string;
  description: string;
  /** Chance that a subscriber who has the feature finds it broken on a given day. */
  bugRate: number;
  initialStage: string;
  reports: string[];
}

export const FEATURES: DemoFeature[] = [
  {
    key: 'smart-search',
    title: 'Search inside notes',
    description: 'Finds words in note bodies, not only titles.',
    bugRate: 0.01,
    initialStage: 'regular',
    reports: ['Search misses notes with emoji in the title'],
  },
  {
    key: 'focus-editor',
    title: 'Focus mode',
    description: 'A distraction-free editor with a dark canvas.',
    bugRate: 0.015,
    initialStage: 'early',
    reports: ['Cursor jumps to the end after switching focus mode off'],
  },
  {
    key: 'voice-notes',
    title: 'Voice notes',
    description: 'Record a note and get a transcript.',
    bugRate: 0.3,
    initialStage: 'early',
    reports: [
      'Recording stops after 30 seconds',
      'Transcript is empty when the phone is in silent mode',
      'App freezes when I tap stop twice',
      'Voice note plays back without sound on Bluetooth headphones',
    ],
  },
  {
    key: 'pinned-notes',
    title: 'Pinned notes',
    description: 'Keep important notes at the top of the list.',
    bugRate: 0.01,
    initialStage: 'off',
    reports: ['Pinned note disappears after sync'],
  },
];

interface CrowdMember {
  id: string;
  channel: string;
  consent: boolean;
}

export interface LogEntry {
  day: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

export class Demo {
  clock: number;
  readonly startedAt: number;
  readonly api: ApiHandler;
  readonly log: LogEntry[] = [];
  private readonly service: Service;
  private readonly crowd: CrowdMember[] = [];
  private readonly random: () => number;

  constructor(seed = 7) {
    this.random = mulberry32(seed);
    this.startedAt = Date.parse('2026-10-20T09:00:00Z');
    this.clock = this.startedAt;
    this.service = new Service(DEFAULT_CONFIG, new MemoryStore(), () => new Date(this.clock));
    this.api = createApi(this.service, { clientKey: CLIENT_KEY, adminToken: ADMIN_TOKEN });

    for (const f of FEATURES) {
      this.service.upsertFeature(f.key, f.description, { minPulses: 20, minDaysInChannel: 3 });
      const order = ['off', ...DEFAULT_CONFIG.channels.map((c) => c.id)];
      for (let i = 0; i < order.indexOf(f.initialStage); i++) this.service.promote(f.key, 'seed', true);
    }

    // 160 people: a few early adopters, most on the default channel, some who want calm.
    const plan: [string, number, number][] = [['early', 24, 1], ['regular', 112, 0.3], ['calm', 24, 0.25]];
    for (const [channel, count, consentShare] of plan) {
      for (let i = 0; i < count; i++) {
        const member = { id: `${channel}-${i + 1}`, channel, consent: this.random() < consentShare };
        this.service.chooseChannel(member.id, channel, member.consent);
        this.crowd.push(member);
      }
    }
  }

  get day(): number {
    return Math.floor((this.clock - this.startedAt) / DAY);
  }

  /** Lets one simulated day pass: people open the app, send pulses, errors and reports. */
  nextDay(): void {
    this.clock += DAY;
    const features = this.service.listFeatures();
    let broken = 0;
    let reports = 0;

    for (const member of this.crowd) {
      if (this.random() > 0.85) continue; // not everyone opens the app every day
      const session = this.service.session(member.id);
      member.channel = session.subscriber.channel;
      const enabled = features.filter((f) => isEnabled(DEFAULT_CONFIG, f.stage, member.channel));

      for (const view of enabled) {
        const feature = FEATURES.find((f) => f.key === view.key)!;
        const bug = this.random() < feature.bugRate;
        // Early subscribers keep their contract; later channels pulse now and then.
        const pulseChance = member.channel === 'early' ? 0.55 : 0.06;
        if (this.random() < pulseChance) {
          this.service.pulse(member.id, bug ? 'broken' : 'ok', view.key, '2.4.0');
          if (bug) broken++;
          if (bug && this.random() < 0.35) {
            this.service.report(member.id, pick(feature.reports, this.random), view.key, '2.4.0', undefined);
            reports++;
          }
        }
        if (bug && member.consent && this.random() < 0.6) {
          this.service.error(member.id, `${view.key}-crash`, `${feature.title} crashed`, '2.4.0', view.key);
        }
      }
      // Background errors that have nothing to do with any feature.
      if (member.consent && this.random() < 0.02) this.service.error(member.id, 'network-timeout', 'Request timed out', '2.4.0');
    }

    this.add(`Day ${this.day}: ${broken} broken pulses, ${reports} new reports`, broken > 6 ? 'bad' : 'info');
  }

  add(text: string, tone: LogEntry['tone'] = 'info'): void {
    this.log.unshift({ day: this.day, text, tone });
    this.log.length = Math.min(this.log.length, 12);
  }

  features(): FeatureView[] {
    return this.service.listFeatures();
  }
}

/** Small seeded generator, so the demo opens in the same state every time. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}
