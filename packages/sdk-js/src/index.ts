/**
 * Ripen JavaScript SDK. Works in browsers and Node.js 18+, has no dependencies.
 *
 *   const ripen = createRipen({ url: 'https://ripen.example.com', clientKey });
 *   await ripen.start();
 *   if (ripen.isEnabled('new-editor')) { ... }
 */

export interface Channel {
  id: string;
  name: string;
  description?: string;
  default?: boolean;
  contract?: { telemetry?: boolean; pulseEveryDays?: number };
}

export interface Session {
  subscriber: {
    id: string;
    channel: string;
    consent: boolean;
    demotion: { from: string; reason: string } | null;
  };
  channels: Channel[];
  features: Record<string, boolean>;
}

/** Minimal key-value storage, compatible with window.localStorage. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** What `report()` resolves to: the stored report, or a report kept to send once online. */
export type ReportResult = { id: number; queued?: false } | { id: null; queued: true };

export interface RipenOptions {
  /** Base URL of the Ripen server. */
  url: string;
  /** Client key of the project. It is public by design and only grants the client API. */
  clientKey: string;
  /** A stable id for this user or installation. Generated and stored if omitted. */
  subscriberId?: string;
  /** Where to keep the generated subscriber id. Defaults to localStorage when available. */
  storage?: KeyValueStorage;
  /** Version of the host app, attached to pulses, reports and errors. */
  appVersion?: string;
  /**
   * Keep pulses, reports and errors that fail for lack of network, and send them
   * on the next `start()`, when the browser comes back online, or on `flush()`.
   * Kept in `storage` (up to 50 for 7 days). Default: true.
   */
  offlineQueue?: boolean;
  fetch?: typeof fetch;
}

export class RipenError extends Error {
  override name = 'RipenError';
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Listener = (session: Session) => void;

const STORAGE_KEY = 'ripen.subscriberId';
const OUTBOX_KEY = 'ripen.outbox';
const OUTBOX_MAX = 50;
const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface OutboxItem {
  path: string;
  body: Record<string, unknown>;
  at: number;
}

/** A request that never reached the server: offline, DNS, refused connection. */
export class RipenNetworkError extends Error {
  override name = 'RipenNetworkError';
}

export class Ripen {
  private readonly url: string;
  private readonly options: RipenOptions;
  private readonly fetchFn: typeof fetch;
  private readonly listeners = new Set<Listener>();
  private current: Session | null = null;
  private removeErrorHandlers: (() => void) | null = null;
  private readonly storage: KeyValueStorage | null;
  /** Used when there is no storage, or it is blocked. */
  private memoryOutbox: OutboxItem[] = [];
  private flushing: Promise<void> | null = null;
  private watchingOnline = false;
  readonly subscriberId: string;

  constructor(options: RipenOptions) {
    this.options = options;
    this.url = options.url.replace(/\/+$/, '');
    const fetchFn = options.fetch ?? globalThis.fetch;
    if (!fetchFn) throw new Error('fetch is not available, pass options.fetch');
    this.fetchFn = fetchFn.bind(globalThis);
    this.storage = options.storage ?? defaultStorage();
    this.subscriberId = options.subscriberId ?? resolveSubscriberId(this.storage);
  }

  /** Loads the session: the subscriber's channel and which features are enabled. Then sends anything queued offline. */
  async start(): Promise<Session> {
    const session = this.setSession(await this.request<Session>('POST', '/v1/client/session', { subscriberId: this.subscriberId }));
    if (this.options.offlineQueue !== false) {
      this.watchOnline();
      void this.flush();
    }
    return session;
  }

  /** How many pulses, reports and errors wait to be sent. */
  get queued(): number {
    return this.readOutbox().length;
  }

  /**
   * Sends what was queued offline, oldest first. Stops at the first network
   * failure; drops items the server rejects, since they would be rejected again.
   */
  flush(): Promise<void> {
    this.flushing ??= (async () => {
      try {
        for (;;) {
          const [item] = this.readOutbox();
          if (!item) return;
          try {
            await this.request('POST', item.path, item.body);
          } catch (error) {
            if (error instanceof RipenNetworkError || (error instanceof RipenError && error.status >= 500)) return;
          }
          this.writeOutbox(this.readOutbox().filter((i) => i.at !== item.at || i.path !== item.path));
        }
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  get session(): Session | null {
    return this.current;
  }

  get channel(): Channel | null {
    const id = this.current?.subscriber.channel;
    return this.current?.channels.find((c) => c.id === id) ?? null;
  }

  get channels(): Channel[] {
    return this.current?.channels ?? [];
  }

  /** Whether a feature is enabled for this subscriber. Unknown features fall back to `fallback`. */
  isEnabled(feature: string, fallback = false): boolean {
    return this.current?.features[feature] ?? fallback;
  }

  /**
   * Switches the subscriber to another channel. Channels with telemetry in their
   * contract require `consent: true`, which the app must get from the user explicitly.
   */
  async setChannel(channelId: string, { consent = false }: { consent?: boolean } = {}): Promise<Session> {
    const path = `/v1/client/subscribers/${encodeURIComponent(this.subscriberId)}/channel`;
    return this.setSession(await this.request<Session>('PUT', path, { channel: channelId, consent }));
  }

  /** One-tap signal: everything works, or something is broken. Optionally about one feature. */
  async pulse(status: 'ok' | 'broken', { feature }: { feature?: string } = {}): Promise<void> {
    await this.send('/v1/client/pulses', { subscriberId: this.subscriberId, status, feature, appVersion: this.options.appVersion });
  }

  /** A written report. `context` is any JSON object the app wants to attach; avoid personal data. */
  async report(message: string, { feature, context }: { feature?: string; context?: Record<string, unknown> } = {}): Promise<ReportResult> {
    return this.send<{ id: number }>('/v1/client/reports', {
      subscriberId: this.subscriberId,
      message,
      feature,
      context,
      appVersion: this.options.appVersion,
    });
  }

  /**
   * Sends an error. The server ignores it unless the subscriber consented to telemetry.
   * Pass `feature` when the error comes from a known feature, so it does not hold back others.
   */
  async captureError(error: unknown, { feature }: { feature?: string } = {}): Promise<void> {
    if (!this.current?.subscriber.consent) return;
    const { message, fingerprint } = describeError(error);
    await this.send('/v1/client/errors', {
      subscriberId: this.subscriberId,
      fingerprint,
      message,
      feature,
      appVersion: this.options.appVersion,
    });
  }

  /**
   * Reports uncaught errors in the browser while the subscriber has consent.
   * Returns a function that removes the handlers.
   */
  captureUncaughtErrors(): () => void {
    this.removeErrorHandlers?.();
    const target = globalThis as unknown as Partial<Pick<Window, 'addEventListener' | 'removeEventListener'>>;
    if (typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') return () => {};
    const onError = (event: Event) => void this.captureError((event as ErrorEvent).error ?? (event as ErrorEvent).message).catch(() => {});
    const onRejection = (event: Event) => void this.captureError((event as PromiseRejectionEvent).reason).catch(() => {});
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    const remove = () => {
      target.removeEventListener!('error', onError);
      target.removeEventListener!('unhandledrejection', onRejection);
    };
    this.removeErrorHandlers = remove;
    return remove;
  }

  /** Called whenever the session changes. Returns an unsubscribe function. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setSession(session: Session): Session {
    this.current = session;
    for (const listener of this.listeners) listener(session);
    return session;
  }

  /** Posts an event; without network, queues it instead of failing (unless the queue is off). */
  private async send<T>(path: string, body: Record<string, unknown>): Promise<T | { id: null; queued: true }> {
    try {
      return await this.request<T>('POST', path, body);
    } catch (error) {
      if (!(error instanceof RipenNetworkError) || this.options.offlineQueue === false) throw error;
      const outbox = this.readOutbox();
      // Distinct timestamps keep items apart when removing them after sending.
      const at = Math.max(Date.now(), (outbox.at(-1)?.at ?? 0) + 1);
      this.writeOutbox([...outbox, { path, body, at }].slice(-OUTBOX_MAX));
      this.watchOnline();
      return { id: null, queued: true };
    }
  }

  private readOutbox(): OutboxItem[] {
    let items = this.memoryOutbox;
    try {
      const raw = this.storage?.getItem(OUTBOX_KEY);
      if (raw) items = JSON.parse(raw) as OutboxItem[];
    } catch {
      // Blocked storage or a damaged value: use the in-memory copy.
    }
    const fresh = Date.now() - OUTBOX_MAX_AGE_MS;
    return Array.isArray(items) ? items.filter((i) => i && typeof i.path === 'string' && i.at >= fresh) : [];
  }

  private writeOutbox(items: OutboxItem[]): void {
    this.memoryOutbox = items;
    try {
      this.storage?.setItem(OUTBOX_KEY, JSON.stringify(items));
    } catch {
      // Kept in memory only.
    }
  }

  /** In browsers, sends the queue when the connection comes back. */
  private watchOnline(): void {
    if (this.watchingOnline) return;
    const target = globalThis as unknown as Partial<Pick<Window, 'addEventListener'>>;
    if (typeof target.addEventListener !== 'function') return;
    this.watchingOnline = true;
    target.addEventListener('online', () => void this.flush());
  }

  private async request<T>(method: string, path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(this.url + path, {
        method,
        headers: { Authorization: `Bearer ${this.options.clientKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new RipenNetworkError((error as Error).message);
    }
    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    if (!response.ok) {
      throw new RipenError(response.status, data?.error ?? 'http_error', data?.message ?? `HTTP ${response.status}`);
    }
    return data as T;
  }
}

export function createRipen(options: RipenOptions): Ripen {
  return new Ripen(options);
}

function resolveSubscriberId(storage: KeyValueStorage | null): string {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // Storage can be blocked (private mode, cookies disabled): fall through to a session-only id.
  }
  const id = globalThis.crypto.randomUUID();
  try {
    storage?.setItem(STORAGE_KEY, id);
  } catch {
    // Same as above.
  }
  return id;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return (globalThis as { localStorage?: KeyValueStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** Groups identical errors: the same type, message and first stack frame give the same fingerprint. */
export function describeError(error: unknown): { message: string; fingerprint: string } {
  const err = error instanceof Error ? error : null;
  const message = (err ? `${err.name}: ${err.message}` : String(error)).slice(0, 1000);
  const frame = err?.stack?.split('\n').find((line) => /^\s+at\s|@/.test(line))?.trim() ?? '';
  return { message, fingerprint: hash(`${err?.name ?? 'value'}|${err?.message ?? message}|${frame}`) };
}

function hash(input: string): string {
  // FNV-1a, 32 bit: stable and small, collisions only merge similar errors.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
