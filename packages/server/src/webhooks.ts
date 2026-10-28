import type { RipenEvent, RipenEventType } from './events.ts';

/**
 * Sends events to one URL as signed JSON POSTs. Deliveries go one at a time in
 * order, with retries; they live in memory, so events queued when the process
 * stops are lost. Uses only `fetch` and Web Crypto, so it runs anywhere.
 */
export interface WebhookOptions {
  url: string;
  /** Shared secret for the `Ripen-Signature` header. */
  secret: string;
  /** Event types to send; every type when omitted. */
  types?: readonly RipenEventType[];
  /** Waits before each retry, in milliseconds. Default: 1 s, 10 s, 60 s. */
  retryDelays?: readonly number[];
  /** Time limit for one attempt. Default: 10 s. */
  timeoutMs?: number;
  /** Events waiting beyond this are dropped, oldest first. Default: 1000. */
  maxQueue?: number;
  /** Called when an event is given up on: retries exhausted, rejected or dropped. */
  onFailure?: (event: RipenEvent, reason: string) => void;
  fetch?: typeof fetch;
  /** Current time in milliseconds, for tests. */
  now?: () => number;
}

export interface WebhookSender {
  /** Queues an event; never throws. */
  send(event: RipenEvent): void;
  /** Resolves when the queue is empty. */
  idle(): Promise<void>;
}

export const SIGNATURE_HEADER = 'Ripen-Signature';

export function createWebhookSender(options: WebhookOptions): WebhookSender {
  const doFetch = options.fetch ?? fetch;
  const delays = options.retryDelays ?? [1000, 10_000, 60_000];
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxQueue = options.maxQueue ?? 1000;
  const now = options.now ?? Date.now;
  const fail = options.onFailure ?? (() => {});
  const queue: RipenEvent[] = [];
  let running: Promise<void> | null = null;

  async function deliver(event: RipenEvent): Promise<void> {
    const body = JSON.stringify(event);
    for (let attempt = 0; ; attempt++) {
      let reason: string;
      let retry = true;
      try {
        const response = await doFetch(options.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'ripen-webhook',
            'Ripen-Event': event.type,
            'Ripen-Delivery': event.id,
            [SIGNATURE_HEADER]: await signWebhook(options.secret, body, now()),
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
        if (response.ok) return;
        reason = `HTTP ${response.status}`;
        // A receiver that rejects the event will reject it again; only overload and timeouts are retried.
        retry = response.status >= 500 || response.status === 408 || response.status === 429;
      } catch (error) {
        reason = (error as Error).name === 'TimeoutError' ? `no response in ${timeoutMs} ms` : (error as Error).message;
      }
      if (!retry || attempt >= delays.length) {
        fail(event, reason);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }

  async function drain(): Promise<void> {
    while (queue.length > 0) await deliver(queue.shift()!);
    running = null;
  }

  return {
    send(event) {
      if (options.types && !options.types.includes(event.type)) return;
      queue.push(event);
      if (queue.length > maxQueue) fail(queue.shift()!, 'queue full');
      running ??= drain();
    },
    async idle() {
      while (running) await running;
    },
  };
}

/** The `Ripen-Signature` value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export async function signWebhook(secret: string, body: string, nowMs: number = Date.now()): Promise<string> {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;
}

/**
 * Checks a webhook on the receiving side: the signature must match the raw
 * body and be at most `toleranceSeconds` old, so a captured request cannot be replayed later.
 */
export async function verifyWebhook(
  secret: string,
  header: string | null | undefined,
  body: string,
  options: { toleranceSeconds?: number; now?: number } = {},
): Promise<boolean> {
  const parts = new Map((header ?? '').split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1');
  if (!Number.isInteger(t) || !v1) return false;
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - t) > (options.toleranceSeconds ?? 300)) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  return Array.from(signature, (b) => b.toString(16).padStart(2, '0')).join('');
}
