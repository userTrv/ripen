import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG } from '@ripen/core';
import { createRipenServer, Store } from '@ripen/server';
import {
  MemoryStore,
  Service,
  createWebhookSender,
  renderMetrics,
  signWebhook,
  verifyWebhook,
  type RipenEvent,
} from '@ripen/server/engine';

const DAY = 24 * 60 * 60 * 1000;

function setup() {
  let clock = Date.parse('2026-10-24T10:00:00Z');
  const service = new Service(DEFAULT_CONFIG, new MemoryStore(), () => new Date(clock));
  const events: RipenEvent[] = [];
  service.onEvent((e) => events.push(e));
  return { service, events, advance: (days: number) => (clock += days * DAY) };
}

describe('events', () => {
  it('reports promotions, rollbacks and reports after they are stored', () => {
    const { service, events } = setup();
    service.upsertFeature('f1', undefined, undefined);
    service.promote('f1', 'ci', false);
    assert.throws(() => service.promote('f1', 'ci', false), /did not pass the gate/);
    service.promote('f1', 'alice', true);
    service.rollback('f1', 'off', 'bob');
    const id = service.report('s1', 'broken button', 'f1', '1.2.0', undefined);

    assert.deepEqual(
      events.map((e) => [e.type, e.data]),
      [
        ['feature.promoted', { feature: 'f1', from: 'off', to: 'early', actor: 'ci', forced: false, gate: null }],
        ['feature.promoted', { feature: 'f1', from: 'early', to: 'regular', actor: 'alice', forced: true, gate: (events[1]!.data as any).gate }],
        ['feature.rolled_back', { feature: 'f1', from: 'regular', to: 'off', actor: 'bob' }],
        ['report.created', { id, feature: 'f1', channel: 'regular', message: 'broken button', appVersion: '1.2.0' }],
      ],
    );
    assert.equal((events[1]!.data as any).gate.pass, false, 'a forced promotion carries the failed gate');
    assert.equal(new Set(events.map((e) => e.id)).size, 4);
    assert.equal(events[0]!.at, '2026-10-24T10:00:00.000Z');
  });

  it('reports a demotion without the subscriber id', () => {
    const { service, events, advance } = setup();
    service.chooseChannel('s1', 'early', true);
    advance(15);
    service.session('s1');
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, 'subscriber.demoted');
    assert.deepEqual(Object.keys(events[0]!.data), ['from', 'to', 'reason']);
    assert.equal((events[0]!.data as any).to, 'regular');
  });

  it('keeps serving requests when a listener throws', () => {
    const { service } = setup();
    service.onEvent(() => {
      throw new Error('listener bug');
    });
    const original = console.error;
    console.error = () => {};
    try {
      service.upsertFeature('f1', undefined, undefined);
      assert.equal(service.promote('f1', null, false).feature.stage, 'early');
    } finally {
      console.error = original;
    }
  });

  it('unsubscribes', () => {
    const { service, events } = setup();
    const off = service.onEvent(() => assert.fail('unsubscribed listener called'));
    off();
    service.report('s1', 'hi', null, null, undefined);
    assert.equal(events.length, 1);
  });
});

describe('webhook signatures', () => {
  const now = Date.parse('2026-10-24T10:00:00Z');

  it('accepts its own signature and rejects tampering, other secrets and old requests', async () => {
    const header = await signWebhook('secret-0123456789', '{"a":1}', now);
    assert.match(header, /^t=\d+,v1=[0-9a-f]{64}$/);
    assert.equal(await verifyWebhook('secret-0123456789', header, '{"a":1}', { now }), true);
    assert.equal(await verifyWebhook('secret-0123456789', header, '{"a":2}', { now }), false);
    assert.equal(await verifyWebhook('another-secret-xyz', header, '{"a":1}', { now }), false);
    assert.equal(await verifyWebhook('secret-0123456789', header, '{"a":1}', { now: now + 301_000 }), false);
    assert.equal(await verifyWebhook('secret-0123456789', undefined, '{"a":1}', { now }), false);
    assert.equal(await verifyWebhook('secret-0123456789', 't=abc,v1=00', '{"a":1}', { now }), false);
  });
});

describe('webhook sender', () => {
  const event = (n: number): RipenEvent => ({
    id: `e${n}`,
    type: 'report.created',
    at: '2026-10-24T10:00:00.000Z',
    data: { id: n, feature: null, channel: 'early', message: 'm', appVersion: null },
  });

  function fakeFetch(statuses: number[]) {
    const calls: { headers: Record<string, string>; body: string }[] = [];
    const fn = (async (_url: string, init: RequestInit) => {
      calls.push({ headers: init.headers as Record<string, string>, body: init.body as string });
      return new Response(null, { status: statuses.shift() ?? 200 });
    }) as unknown as typeof fetch;
    return { fn, calls };
  }

  it('retries server errors, gives up on rejections and keeps the order', async () => {
    const { fn, calls } = fakeFetch([503, 200, 400, 500, 500, 500]);
    const failures: string[] = [];
    const sender = createWebhookSender({
      url: 'https://hooks.example.com/ripen',
      secret: 'secret-0123456789',
      fetch: fn,
      retryDelays: [0, 0],
      onFailure: (e, reason) => failures.push(`${e.id}: ${reason}`),
    });
    sender.send(event(1));
    sender.send(event(2));
    sender.send(event(3));
    await sender.idle();
    assert.deepEqual(calls.map((c) => JSON.parse(c.body).id), ['e1', 'e1', 'e2', 'e3', 'e3', 'e3']);
    assert.deepEqual(failures, ['e2: HTTP 400', 'e3: HTTP 500']);
    assert.equal(calls[0]!.headers['Ripen-Event'], 'report.created');
    assert.equal(calls[0]!.headers['Ripen-Delivery'], 'e1');
  });

  it('sends only the chosen types and drops the oldest when the queue is full', async () => {
    const { fn, calls } = fakeFetch([]);
    const failures: string[] = [];
    const sender = createWebhookSender({
      url: 'https://hooks.example.com/ripen',
      secret: 'secret-0123456789',
      fetch: fn,
      types: ['report.created'],
      maxQueue: 1,
      onFailure: (e, reason) => failures.push(`${e.id}: ${reason}`),
    });
    sender.send({ id: 'p', type: 'feature.rolled_back', at: '', data: { feature: 'f', from: 'early', to: 'off', actor: null } });
    sender.send(event(1)); // in flight
    sender.send(event(2)); // waiting
    sender.send(event(3)); // pushes out e2
    await sender.idle();
    assert.deepEqual(calls.map((c) => JSON.parse(c.body).id), ['e1', 'e3']);
    assert.deepEqual(failures, ['e2: queue full']);
  });

  it('delivers a signed event a receiver can verify', async () => {
    const received: Promise<boolean> = new Promise((resolve) => {
      const receiver = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          res.end();
          receiver.close();
          resolve(await verifyWebhook('secret-0123456789', req.headers['ripen-signature'] as string, body));
        });
      });
      receiver.listen(0, '127.0.0.1', () => {
        const { service } = setup();
        const sender = createWebhookSender({ url: `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`, secret: 'secret-0123456789' });
        service.onEvent((e) => sender.send(e));
        service.report('s1', 'hello', null, null, undefined);
      });
    });
    assert.equal(await received, true);
  });
});

describe('metrics', () => {
  it('describes channels and features in the Prometheus format', () => {
    const { service } = setup();
    service.chooseChannel('e1', 'early', true);
    service.session('r1');
    service.upsertFeature('new-editor', undefined, undefined);
    service.upsertFeature('dark"mode', undefined, undefined);
    service.promote('new-editor', null, false);
    service.pulse('e1', 'ok', null, null);
    service.pulse('e1', 'broken', 'new-editor', null);

    const text = renderMetrics(service);
    assert.match(text, /^# TYPE ripen_channel_subscribers gauge$/m);
    assert.match(text, /^ripen_channel_subscribers\{channel="early"\} 1$/m);
    assert.match(text, /^ripen_channel_subscribers\{channel="calm"\} 0$/m);
    assert.match(text, /^ripen_feature_stage\{feature="new-editor",stage="early"\} 1$/m);
    assert.match(text, /^ripen_feature_stage\{feature="dark\\"mode",stage="off"\} 0$/m);
    assert.match(text, /^ripen_feature_pulses\{feature="new-editor",status="broken"\} 1$/m);
    assert.match(text, /^ripen_feature_error_rate\{feature="new-editor",group="with"\} 0$/m);
    assert.match(text, /^ripen_feature_gate_pass\{feature="new-editor"\} 0$/m);
    assert.doesNotMatch(text, /ripen_feature_gate_pass\{feature="dark/, 'no gate at off');
    assert.doesNotMatch(text, /feature="new-editor",group="without"/, 'no consenting subscribers without the feature');
  });

  it('serves /metrics as text to the admin token only', async () => {
    const store = new Store(':memory:');
    const server = createRipenServer(new Service(DEFAULT_CONFIG, store), {
      clientKey: 'client-key-for-tests',
      adminToken: 'admin-token-for-tests',
      corsOrigins: [],
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/metrics`;
    try {
      assert.equal((await fetch(url, { headers: { Authorization: 'Bearer client-key-for-tests' } })).status, 401);
      const response = await fetch(url, { headers: { Authorization: 'Bearer admin-token-for-tests' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/plain; version=0.0.4; charset=utf-8');
      assert.match(await response.text(), /ripen_channel_subscribers\{channel="regular"\} 0/);
    } finally {
      server.close();
      store.close();
    }
  });
});
