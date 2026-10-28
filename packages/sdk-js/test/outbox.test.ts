import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRipen, RipenError, RipenNetworkError, type KeyValueStorage } from '@ripen/sdk';

const SESSION = {
  subscriber: { id: 's1', channel: 'early', consent: true, demotion: null },
  channels: [{ id: 'early', name: 'Early' }],
  features: {},
};

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** A fake server that can be switched offline; records the paths it received. */
function fakeServer() {
  const state = { online: true, received: [] as string[], reject: new Set<string>(), fail: new Set<string>() };
  const fetch = (async (url: string, init: RequestInit) => {
    if (!state.online) throw new TypeError('fetch failed');
    const path = new URL(url).pathname;
    if (state.fail.has(path)) return new Response('{"error":"internal"}', { status: 500 });
    if (state.reject.has(path)) return new Response('{"error":"bad_request","message":"no"}', { status: 400 });
    state.received.push(`${path} ${JSON.parse(init.body as string).status ?? ''}`.trim());
    if (path === '/v1/client/session') return Response.json(SESSION);
    if (path === '/v1/client/reports') return Response.json({ id: 7 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  return { state, fetch };
}

describe('offline queue', () => {
  it('keeps events sent without network and sends them in order on the next start', async () => {
    const { state, fetch } = fakeServer();
    const storage = memoryStorage();
    const ripen = createRipen({ url: 'https://ripen.test', clientKey: 'k', subscriberId: 's1', storage, fetch });
    await ripen.start();

    state.online = false;
    await ripen.pulse('ok');
    assert.deepEqual(await ripen.report('it broke'), { id: null, queued: true });
    await ripen.pulse('broken');
    await ripen.captureError(new Error('boom'));
    assert.equal(ripen.queued, 4);
    await assert.rejects(ripen.start(), RipenNetworkError, 'loading the session still fails without network');

    // The app restarts: a new client finds the queue in storage.
    state.online = true;
    state.received = [];
    const again = createRipen({ url: 'https://ripen.test', clientKey: 'k', subscriberId: 's1', storage, fetch });
    await again.start();
    await again.flush();
    assert.deepEqual(state.received, [
      '/v1/client/session',
      '/v1/client/pulses ok',
      '/v1/client/reports',
      '/v1/client/pulses broken',
      '/v1/client/errors',
    ]);
    assert.equal(again.queued, 0);
    assert.deepEqual(await again.report('online now'), { id: 7 });
  });

  it('keeps the queue on server errors and drops what the server rejects', async () => {
    const { state, fetch } = fakeServer();
    const ripen = createRipen({ url: 'https://ripen.test', clientKey: 'k', subscriberId: 's1', storage: memoryStorage(), fetch });
    state.online = false;
    await ripen.pulse('ok');
    await ripen.report('later');
    state.online = true;

    state.fail.add('/v1/client/pulses');
    await ripen.flush();
    assert.equal(ripen.queued, 2, 'a 500 stops the flush and keeps everything');

    state.fail.clear();
    state.reject.add('/v1/client/pulses');
    await ripen.flush();
    assert.equal(ripen.queued, 0, 'the rejected pulse is dropped, the report is sent');
    assert.deepEqual(state.received, ['/v1/client/reports']);
  });

  it('is limited, forgets old items and can be turned off', async () => {
    const { state, fetch } = fakeServer();
    const storage = memoryStorage();
    const ripen = createRipen({ url: 'https://ripen.test', clientKey: 'k', subscriberId: 's1', storage, fetch });
    state.online = false;
    for (let i = 0; i < 60; i++) await ripen.pulse('ok');
    assert.equal(ripen.queued, 50);

    const old = JSON.parse(storage.data.get('ripen.outbox')!).map((item: { at: number }) => ({ ...item, at: item.at - 8 * 24 * 60 * 60 * 1000 }));
    storage.data.set('ripen.outbox', JSON.stringify(old));
    assert.equal(ripen.queued, 0, 'items older than seven days are dropped');

    storage.data.set('ripen.outbox', '{not json');
    assert.equal(ripen.queued, 50, 'a damaged value is ignored in favour of the copy in memory');

    const strict = createRipen({ url: 'https://ripen.test', clientKey: 'k', subscriberId: 's1', storage: memoryStorage(), fetch, offlineQueue: false });
    await assert.rejects(strict.pulse('ok'), RipenNetworkError);
    state.online = true;
    state.reject.add('/v1/client/pulses');
    await assert.rejects(ripen.pulse('ok'), RipenError, 'a rejection is never queued');
  });
});
