import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ErrorCode, OpenFeature, ProviderEvents } from '@openfeature/web-sdk';
import { DEFAULT_CONFIG } from '@ripen/core';
import { RipenProvider } from '@ripen/openfeature';
import { createRipen } from '@ripen/sdk';
import { createApi, MemoryStore, Service } from '@ripen/server/engine';

const service = new Service(DEFAULT_CONFIG, new MemoryStore());
const api = createApi(service, { clientKey: 'client', adminToken: 'admin' });

/** Routes the SDK's fetch calls to the in-process API. */
const fetchToApi: typeof fetch = async (input, init) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const response = await api({
    method: init?.method ?? 'GET',
    path: new URL(String(input)).pathname,
    authorization: headers['Authorization'],
    body: typeof init?.body === 'string' ? init.body : '',
  });
  return new Response(response.body === null ? null : JSON.stringify(response.body), { status: response.status });
};

const ripen = createRipen({ url: 'https://ripen.test', clientKey: 'client', subscriberId: 'of-1', fetch: fetchToApi });

before(async () => {
  service.upsertFeature('new-editor', 'Rewritten editor', undefined);
  service.upsertFeature('search-v2', undefined, undefined);
  service.promote('new-editor', 'test', false); // off → early
  await ripen.start();
  await ripen.setChannel('early', { consent: true });
  await OpenFeature.setProviderAndWait(new RipenProvider(ripen));
});

after(async () => {
  await OpenFeature.close();
});

describe('RipenProvider', () => {
  it('resolves features enabled for the subscriber channel', () => {
    const client = OpenFeature.getClient();
    const details = client.getBooleanDetails('new-editor', false);
    assert.equal(details.value, true);
    assert.equal(details.variant, 'on');
    assert.equal(details.reason, 'TARGETING_MATCH');
    assert.deepEqual(details.flagMetadata, { channel: 'early' });
    assert.equal(client.getBooleanValue('search-v2', true), false);
  });

  it('falls back to the default for unknown features and other types', () => {
    const client = OpenFeature.getClient();
    const missing = client.getBooleanDetails('nope', true);
    assert.equal(missing.value, true);
    assert.equal(missing.errorCode, ErrorCode.FLAG_NOT_FOUND);
    const typed = client.getStringDetails('new-editor', 'x');
    assert.equal(typed.value, 'x');
    assert.equal(typed.errorCode, ErrorCode.TYPE_MISMATCH);
  });

  it('emits ConfigurationChanged when the session changes', async () => {
    const client = OpenFeature.getClient();
    const changed = new Promise<void>((resolve) => client.addHandler(ProviderEvents.ConfigurationChanged, () => resolve()));
    await ripen.setChannel('calm');
    await changed;
    assert.equal(client.getBooleanValue('new-editor', true), false, 'calm does not have the feature yet');
  });

  it('turns tracking events into pulses', async () => {
    const client = OpenFeature.getClient();
    client.track('ripen.broken', { feature: 'new-editor' });
    client.track('ripen.ok');
    client.track('checkout-completed'); // unrelated events are ignored
    await new Promise((resolve) => setTimeout(resolve, 20));
    const health = service.health('new-editor').health;
    assert.equal(health.pulsesBroken + health.pulsesOk, 0, 'calm pulses do not count: calm does not have the feature');

    await ripen.setChannel('early', { consent: true });
    client.track('ripen.broken', { feature: 'new-editor' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(service.health('new-editor').health.pulsesBroken, 1);
  });
});
