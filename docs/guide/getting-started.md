# Getting started

In about fifteen minutes: run a Ripen server, put a feature behind it, let a user choose a channel, and promote the feature once the early channel says it is healthy.

## 1. Run the server

With Docker:

```bash
# Two random secrets. The client key ships inside your app; the admin token stays private.
printf 'RIPEN_CLIENT_KEY=%s\nRIPEN_ADMIN_TOKEN=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > ripen.env

docker run -d --name ripen -p 127.0.0.1:4747:4747 -v ripen-data:/data --env-file ripen.env ghcr.io/usertrv/ripen:0.3.0
curl http://localhost:4747/healthz        # {"ok":true}
```

Or from source (Node.js 22.18+ and pnpm):

```bash
git clone https://github.com/userTrv/ripen && cd ripen
pnpm install --frozen-lockfile
pnpm build
export RIPEN_CLIENT_KEY="$(openssl rand -hex 24)" RIPEN_ADMIN_TOKEN="$(openssl rand -hex 24)"
pnpm dev:server
```

Without a config file the server uses three channels: `early`, `regular` (the default) and `calm`. See [Self-hosting](self-hosting.md) to change them.

## 2. Open the release console

Go to <http://localhost:4747/dashboard/> and sign in with the admin token. Create a feature called `new-editor`. It starts **off**: nobody has it.

The same from a terminal:

```bash
# The image includes the CLI; it reads the admin token from the container's environment.
alias ripen='docker exec -e RIPEN_URL=http://127.0.0.1:4747 ripen ripen'
ripen create new-editor --description "Rewritten editor"
```

In a clone of the repository the same tool is `node action/ripen.mjs` (the CLI bundled into one file) with `RIPEN_URL` and `RIPEN_ADMIN_TOKEN` set.

## 3. Check the feature in your app

```ts
import { createRipen } from '@ripen/sdk';

const ripen = createRipen({ url: 'http://localhost:4747', clientKey: RIPEN_CLIENT_KEY, appVersion: '1.4.0' });
await ripen.start();

if (ripen.isEnabled('new-editor')) {
  mountNewEditor();
} else {
  mountOldEditor();
}
```

Both editors ship in the same build. Ripen decides which one a person sees, so no store, TestFlight or beta build is involved.

Dart and Flutter: see [packages/sdk-dart](../../packages/sdk-dart/README.md).

## 4. Let people choose their channel

Put the ready-made component on your settings page:

```html
<ripen-channel-picker></ripen-channel-picker>
<ripen-feedback></ripen-feedback>

<script type="module">
  import { defineRipenElements } from '@ripen/elements';
  defineRipenElements();
  for (const el of document.querySelectorAll('ripen-channel-picker, ripen-feedback')) el.ripen = ripen;
</script>
```

The picker shows each channel and what it expects. Joining `early` asks for consent to send errors. The feedback component is the one-tap pulse: "Everything works" or "Something broke", with an optional written report.

## 5. Release to the early channel

```bash
ripen promote new-editor        # off → early
```

People in `early` now see the new editor; `regular` and `calm` do not. Call `ripen.captureUncaughtErrors()` in the app so errors from early subscribers who agreed are counted.

## 6. Promote on evidence

```bash
ripen health new-editor
```

```
new-editor: early → regular
pulses 31 ok / 1 broken, 3.2 days in channel
  ✓ 3.2 of 3 days in channel
  ✓ 32 of 20 pulses
  ✓ 3.13% broken pulses, limit 5%
  ✓ error rate ×0.9 compared to subscribers without the feature, limit ×1.5
```

When every check passes, `promote` moves the feature to `regular`, and later to `calm`, where everyone has it. If something goes wrong, `rollback new-editor --to off` turns it off for everyone at once.

To promote everything that is ready on a schedule, run `promote-ready` from CI: see [CI and automation](ci.md).

## Next

- [Concepts](concepts.md): channels, contract, pulses and the gate in detail.
- [Web SDK and components](web.md), [OpenFeature](openfeature.md), [Flutter](../../packages/sdk-dart/README.md).
- [Self-hosting](self-hosting.md): configuration, TLS, backups, security.
