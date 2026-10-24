import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { run } from '@ripen/cli';
import { DEFAULT_CONFIG } from '@ripen/core';
import { createRipen } from '@ripen/sdk';
import { createRipenServer, Service, Store } from '@ripen/server';

const ADMIN_TOKEN = 'cli-test-admin-token';
const CLIENT_KEY = 'cli-test-client-key';
const DAY = 24 * 60 * 60 * 1000;

let clock = new Date('2026-10-24T10:00:00Z').getTime();
let store: Store;
let server: ReturnType<typeof createRipenServer>;
let env: Record<string, string>;

async function ripen(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, env, { out: (l) => out.push(l), err: (l) => err.push(l), fetch });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

before(async () => {
  store = new Store(':memory:');
  server = createRipenServer(new Service(DEFAULT_CONFIG, store, () => new Date(clock)), {
    clientKey: CLIENT_KEY,
    adminToken: ADMIN_TOKEN,
    corsOrigins: [],
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  env = { RIPEN_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, RIPEN_ADMIN_TOKEN: ADMIN_TOKEN, GITHUB_ACTOR: 'ci-bot' };
});

after(() => {
  server.close();
  store.close();
});

describe('ripen CLI', () => {
  it('prints help and rejects bad usage with exit code 2', async () => {
    assert.equal((await ripen('--help')).code, 0);
    assert.equal((await ripen()).code, 2);
    assert.match((await ripen('fly')).err, /unknown command "fly"/);
    assert.match((await ripen('promote')).err, /needs a feature key/);
    assert.equal((await ripen('features', '--nope')).code, 2);
  });

  it('requires the URL and token from the environment', async () => {
    const saved = env;
    env = { RIPEN_URL: saved.RIPEN_URL! };
    const result = await ripen('features');
    env = saved;
    assert.equal(result.code, 2);
    assert.match(result.err, /RIPEN_ADMIN_TOKEN/);
  });

  it('reports a wrong token as an error', async () => {
    const saved = env;
    env = { ...saved, RIPEN_ADMIN_TOKEN: 'wrong' };
    const result = await ripen('features');
    env = saved;
    assert.equal(result.code, 1);
    assert.match(result.err, /admin token/);
  });

  it('walks a feature through the channels with the gate', async () => {
    assert.equal((await ripen('create', 'dark-mode', '--description', 'Dark theme')).code, 0);
    assert.match((await ripen('features')).out, /dark-mode\s+off/);

    const first = await ripen('promote', 'dark-mode');
    assert.equal(first.code, 0);
    assert.match(first.out, /now in early/);

    const blocked = await ripen('promote', 'dark-mode');
    assert.equal(blocked.code, 1);
    assert.match(blocked.err, /did not pass the gate/);
    assert.match(blocked.err, /✗ 0 of 3 days in channel/);

    const health = await ripen('health', 'dark-mode');
    assert.equal(health.code, 1, 'health fails while the gate fails, so CI can wait on it');

    // Twenty early subscribers say it works, three days pass.
    for (let i = 0; i < 20; i++) {
      const sdk = createRipen({ url: env.RIPEN_URL!, clientKey: CLIENT_KEY, subscriberId: `e${i}` });
      await sdk.setChannel('early', { consent: true });
      await sdk.pulse('ok');
    }
    clock += 3 * DAY;

    assert.equal((await ripen('health', 'dark-mode')).code, 0);
    const second = await ripen('promote', 'dark-mode');
    assert.equal(second.code, 0);
    assert.match(second.out, /now in regular/);
    assert.match(second.out, /✓ 20 of 20 pulses/);

    const history = await ripen('history', 'dark-mode', '--json');
    const moves = JSON.parse(history.out);
    assert.deepEqual(moves.map((m: { to: string }) => m.to), ['early', 'regular']);
    assert.equal(moves[1].actor, 'ci-bot');
  });

  it('forces a promotion and rolls back to off', async () => {
    await ripen('create', 'risky');
    await ripen('promote', 'risky');
    const forced = await ripen('promote', 'risky', '--force', '--actor', 'kirill');
    assert.equal(forced.code, 0);
    assert.match(forced.out, /forced/);

    const off = await ripen('rollback', 'risky', '--to', 'off');
    assert.equal(off.code, 0);
    assert.match(off.out, /now off/);
  });

  it('lists channels with subscriber counts', async () => {
    const result = await ripen('channels', '--json');
    assert.equal(JSON.parse(result.out)[0].id, 'early');
  });
});
