import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG } from '@ripen/core';
import { Store } from '@ripen/server';
import { createApi, MemoryStore, Service, type RipenStore } from '@ripen/server/engine';

const DAY = 24 * 60 * 60 * 1000;

/** The same scenario must give the same answers on every storage. */
for (const [name, makeStore] of [
  ['SQLite', () => new Store(':memory:')],
  ['memory', () => new MemoryStore()],
] as [string, () => RipenStore][]) {
  describe(`${name} storage through the API`, () => {
    let clock = new Date('2026-10-24T10:00:00Z').getTime();
    const api = createApi(new Service(DEFAULT_CONFIG, makeStore(), () => new Date(clock)), { clientKey: 'c', adminToken: 'a' });
    const call = async (method: string, path: string, token: string, body?: unknown) =>
      api({ method, path, authorization: `Bearer ${token}`, body: body === undefined ? '' : JSON.stringify(body) });

    it('runs a feature from off to calm on evidence', async () => {
      assert.equal((await call('PUT', '/v1/admin/features/f1', 'a', { gate: { minPulses: 4, minDaysInChannel: 1 } })).status, 200);
      assert.equal((await call('POST', '/v1/admin/features/f1/promote', 'a')).status, 200);

      for (const id of ['e1', 'e2']) {
        await call('PUT', `/v1/client/subscribers/${id}/channel`, 'c', { channel: 'early', consent: true });
      }
      for (const id of ['r1', 'r2']) await call('POST', '/v1/client/session', 'c', { subscriberId: id });

      const early = await call('POST', '/v1/client/session', 'c', { subscriberId: 'e1' });
      const regular = await call('POST', '/v1/client/session', 'c', { subscriberId: 'r1' });
      assert.equal((early.body as any).features.f1, true);
      assert.equal((regular.body as any).features.f1, false);

      clock += DAY;
      for (const id of ['e1', 'e2', 'e1', 'e2']) await call('POST', '/v1/client/pulses', 'c', { subscriberId: id, status: 'ok' });
      // Pulses about another feature do not count.
      await call('POST', '/v1/client/pulses', 'c', { subscriberId: 'e1', status: 'broken', feature: 'other' });
      await call('POST', '/v1/client/errors', 'c', { subscriberId: 'e1', fingerprint: 'x' });
      await call('POST', '/v1/client/errors', 'c', { subscriberId: 'r1', fingerprint: 'x' }); // no consent: dropped

      const health = (await call('GET', '/v1/admin/features/f1/health', 'a')).body as any;
      assert.deepEqual(
        { ok: health.health.pulsesOk, broken: health.health.pulsesBroken, with: health.health.errorRateWith, without: health.health.errorRateWithout },
        { ok: 4, broken: 0, with: 0.5, without: null },
      );
      assert.equal(health.gate.pass, true, 'no consenting subscribers without the feature: no baseline');

      // A consenting subscriber without the feature and without errors gives a baseline of zero.
      await call('PUT', '/v1/client/subscribers/r2/channel', 'c', { channel: 'regular', consent: true });
      const withBaseline = (await call('GET', '/v1/admin/features/f1/health', 'a')).body as any;
      assert.equal(withBaseline.health.errorRateWithout, 0);
      assert.equal(withBaseline.gate.pass, false, 'errors only with the feature');

      const forced = await call('POST', '/v1/admin/features/f1/promote', 'a', { force: true });
      assert.equal((forced.body as any).feature.stage, 'regular');
      assert.equal((await call('POST', '/v1/admin/features/f1/promote', 'a', { force: true })).status, 200);
      assert.equal((await call('POST', '/v1/admin/features/f1/promote', 'a', { force: true })).status, 409);

      const history = (await call('GET', '/v1/admin/features/f1/history', 'a')).body as any[];
      assert.deepEqual(history.map((h) => h.to), ['early', 'regular', 'calm']);
    });

    it('keeps reports newest first and counts channels', async () => {
      await call('POST', '/v1/client/reports', 'c', { subscriberId: 'e1', message: 'first', feature: 'f1' });
      await call('POST', '/v1/client/reports', 'c', { subscriberId: 'e2', message: 'second' });
      const health = (await call('GET', '/v1/admin/features/f1/health', 'a')).body as any;
      assert.deepEqual(health.recentReports.map((r: any) => r.message), ['second', 'first']);
      const channels = (await call('GET', '/v1/admin/channels', 'a')).body as any[];
      assert.deepEqual(channels.map((c) => c.subscribers), [2, 2, 0]);
    });

    it('drops everything written in a failed transaction', () => {
      const store = makeStore();
      const row = { key: 'tx', description: '', stage: 'off', stage_since: 0, gate_json: null, created_at: 0 };
      assert.throws(() =>
        store.transaction(() => {
          store.insertFeature(row);
          throw new Error('boom');
        }),
      );
      assert.equal(store.getFeature('tx'), undefined);
      store.transaction(() => store.insertFeature(row));
      assert.equal(store.getFeature('tx')?.key, 'tx');
    });
  });
}
