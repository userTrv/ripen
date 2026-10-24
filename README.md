# Ripen

**Let users choose how early they get new features, and let features ripen through channels on real signals.**

Ripen is a self-hosted layer of stability channels for any app. Users pick a channel on the scale "new features first ↔ fewer bugs". Early channels give feedback in return: automatic error reports with consent and a one-tap "everything works / something broke" pulse. A feature moves to the next channel only when the previous one shows it is healthy.

- **Channels chosen by users**, not random rollout percentages. Three by default (`early`, `regular`, `calm`), any number by config.
- **A channel contract.** Early channels expect more. Whoever stops keeping it is moved towards stable, not punished.
- **Promotion gates.** Time in channel, pulses, broken ratio and error rate compared to users without the feature. Like Fedora's Bodhi, for any app.
- **No platform dependency.** Channels work at the feature level inside one build: no TestFlight, store tracks or beta programs needed.
- **Self-hosted, zero runtime dependencies.** One Node.js process and one SQLite file. Your users' data stays with you.

Repository: [github.com/userTrv/ripen](https://github.com/userTrv/ripen). Status: early development, v0.1. The model and the HTTP API are described in the [specification](docs/spec.md).

## Quick start

```bash
pnpm install
export RIPEN_CLIENT_KEY="$(openssl rand -hex 24)"   # ships inside your app
export RIPEN_ADMIN_TOKEN="$(openssl rand -hex 24)"  # keep secret: CI and dashboard
pnpm dev:server                                     # http://127.0.0.1:4747
```

Without `ripen.config.json` the server uses the default three channels. Settings: `RIPEN_CONFIG`, `RIPEN_DB`, `RIPEN_CORS_ORIGINS`, `HOST`, `PORT`.

### With Docker

```bash
docker build -t ripen .
docker run -d --name ripen -p 4747:4747 -v ripen-data:/data --env-file ripen.env ripen
docker exec -e RIPEN_URL=http://127.0.0.1:4747 ripen ripen features    # the CLI is in the image
```

`ripen.env` holds `RIPEN_CLIENT_KEY` and `RIPEN_ADMIN_TOKEN`; keep it out of git. Data and an optional `ripen.config.json` live in the `/data` volume. The image runs as a non-root user and contains only Ripen's compiled code on top of `node:22.23.3-alpine`, pinned by digest.

### In the app

```ts
import { createRipen } from '@ripen/sdk';

const ripen = createRipen({ url: 'https://ripen.example.com', clientKey, appVersion: '2.4.0' });
await ripen.start();

if (ripen.isEnabled('new-editor')) showNewEditor();

// The user opts into the early channel from your settings screen:
await ripen.setChannel('early', { consent: true });
ripen.captureUncaughtErrors();

// Or use the ready-made web components (any framework, Shadow DOM, themable):
import { defineRipenElements, RU } from '@ripen/elements';
defineRipenElements();
const picker = document.querySelector('ripen-channel-picker');   // <ripen-channel-picker>
picker.ripen = ripen;
picker.texts = RU;                                                // English by default
document.querySelector('ripen-feedback').ripen = ripen;          // <ripen-feedback feature="search-v2">

// After an update, ask once:
await ripen.pulse('ok');
await ripen.report('Search returns nothing for quoted phrases', { feature: 'search-v2' });
```

### With OpenFeature

```ts
import { OpenFeature } from '@openfeature/web-sdk';
import { RipenProvider } from '@ripen/openfeature';

await OpenFeature.setProviderAndWait(new RipenProvider(ripen));
const client = OpenFeature.getClient();
client.getBooleanValue('new-editor', false);
client.track('ripen.broken', { feature: 'new-editor' });   // a pulse about one feature
```

### In CI or by hand

```bash
export RIPEN_URL=https://ripen.example.com
export RIPEN_ADMIN_TOKEN=...            # from your CI secrets, never as an argument

ripen create new-editor --description "Rewritten editor"
ripen promote new-editor                # off → early
ripen health new-editor                 # metrics and gate checks; exit 1 while the gate fails
ripen promote new-editor                # early → regular, only if the gate passes
ripen rollback new-editor --to off      # kill switch
ripen history new-editor --json
```

A nightly CI job can promote everything that is ready: `ripen promote <key>` exits 1 and prints the failed checks when a feature is not ready, so the job can loop over keys and ignore those. Every command also has `--json` output. The same operations are available over the [admin HTTP API](docs/spec.md#admin-api).

## Packages

| Package | What it is |
|---|---|
| [`@ripen/core`](packages/core) | Domain model: channels, contract, gates. Pure TypeScript, no I/O |
| [`@ripen/server`](packages/server) | HTTP server on `node:http` and `node:sqlite` |
| [`@ripen/sdk`](packages/sdk-js) | JavaScript SDK for browsers and Node.js |
| [`@ripen/cli`](packages/cli) | `ripen` command for CI and terminals |
| [`@ripen/server/engine`](packages/server/src/engine.ts) | The service, the API as a function and in-memory storage, without Node.js: browsers, edge runtimes |
| [`@ripen/openfeature`](packages/openfeature) | OpenFeature provider: read Ripen features through the OpenFeature web SDK, send pulses with `client.track('ripen.ok')` |
| [`@ripen/elements`](packages/elements) | Web components: `<ripen-channel-picker>` with the consent step, `<ripen-feedback>` with pulse and report form |

## Development

Requires Node.js 22.18+ and pnpm (the version is pinned in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm test          # node:test, runs TypeScript directly
pnpm test:browser  # web components in headless Chromium against a real server
pnpm typecheck
pnpm build
```

Design decisions are recorded in [docs/adr](docs/adr). The background research (in Russian) is in [docs/product-options.md](docs/product-options.md) and [docs/direction.md](docs/direction.md).

## Roadmap

- [x] Spec, ADRs, core model, server, JavaScript SDK
- [x] Web components: channel picker, pulse and report form
- [x] OpenFeature provider, to work alongside existing flag systems
- [x] CLI for promotion in CI
- [ ] GitHub Action
- [ ] Dashboard (Angular)
- [x] In-browser demo (`pnpm demo`, then serve `apps/demo/site`)
- [x] Docker image
- [ ] Flutter SDK, adapters for desktop updaters

## License

[Apache-2.0](LICENSE)
