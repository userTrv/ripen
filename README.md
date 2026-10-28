# Ripen

**Let people choose how early they get new features, and let features ripen through channels on real signals.**

Ripen is a self-hosted layer of stability channels for any app. Each person picks a channel on the scale "new features first ↔ fewer bugs". The early channel gives something back: automatic error reports, with consent, and a one-tap "everything works / something broke". A feature moves to the next channel only when the previous one shows it is healthy.

```
                 promote when the gate passes         promote when the gate passes
   off ───────▶  early  ─────────────────────────▶  regular  ─────────────────────────▶  calm
          (first channel, no gate)                  (the default)                   (everyone has it)
   ◀──────────── rollback, or straight to off as a kill switch ──────────────────────────────
```

- **People choose their channel.** Not a random rollout percentage picked by the vendor. Three channels by default, any number by configuration.
- **Early channels expect more.** Consent to error reports and a check-in every two weeks. Whoever stops is moved towards stable and told why; nobody is punished.
- **Promotion on evidence.** Time in the channel, number of check-ins, share of "broken" ones and the error rate compared to people without the feature. Like Fedora's Bodhi, for any app.
- **No platform in the way.** Channels work at the feature level inside one build: no TestFlight, store tracks or beta builds.
- **Self-hosted, no runtime dependencies.** One Node.js process and one SQLite file. Your users' data stays with you.

## Start

```bash
git clone https://github.com/userTrv/ripen && cd ripen
docker build -t ripen .
printf 'RIPEN_CLIENT_KEY=%s\nRIPEN_ADMIN_TOKEN=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > ripen.env
docker run -d --name ripen -p 127.0.0.1:4747:4747 -v ripen-data:/data --env-file ripen.env ripen
```

The release console is at <http://localhost:4747/dashboard/>. In the app:

```ts
import { createRipen } from '@ripen/sdk';

const ripen = createRipen({ url: 'https://ripen.example.com', clientKey });
await ripen.start();
if (ripen.isEnabled('new-editor')) mountNewEditor();
```

The [getting started guide](docs/guide/getting-started.md) walks through the whole loop: a feature, a channel picker, the first promotion.

## Documentation

| | |
|---|---|
| [Getting started](docs/guide/getting-started.md) | From zero to a promoted feature in fifteen minutes |
| [Concepts](docs/guide/concepts.md) | Channels, stages, the channel contract, the gate |
| [Web SDK and components](docs/guide/web.md) | `@ripen/sdk`, `<ripen-channel-picker>`, `<ripen-feedback>` |
| [Flutter and Dart](packages/sdk-dart/README.md) | The `ripen` Dart package |
| [OpenFeature](docs/guide/openfeature.md) | Ripen behind the OpenFeature web SDK |
| [CI and automation](docs/guide/ci.md) | CLI, GitHub Action, nightly promotion |
| [Integrations](docs/guide/integrations.md) | Webhooks, Prometheus and OpenTelemetry metrics |
| [Self-hosting](docs/guide/self-hosting.md) | Configuration, TLS, backups, security, privacy |
| [Specification](docs/spec.md) | The model and the HTTP API |
| [Threat model](docs/threat-model.md) | What Ripen protects, against whom, and what is left to you |
| [Architecture decisions](docs/adr) | Why it is built this way |

## Packages

| Package | What it is |
|---|---|
| [`@ripen/server`](packages/server) | HTTP server on `node:http` and `node:sqlite`, Docker image, console at `/dashboard/` |
| [`@ripen/sdk`](packages/sdk-js) | JavaScript SDK for browsers and Node.js |
| [`ripen` (Dart)](packages/sdk-dart) | Dart and Flutter SDK |
| [`@ripen/elements`](packages/elements) | `<ripen-channel-picker>` and `<ripen-feedback>` web components |
| [`@ripen/dashboard`](packages/dashboard) | Release console as a web component |
| [`@ripen/cli`](packages/cli) and [`action.yml`](action.yml) | `ripen` command and the GitHub Action |
| [`@ripen/openfeature`](packages/openfeature) | OpenFeature provider |
| [`@ripen/core`](packages/core) | Domain model: channels, contract, gate |
| [`apps/demo`](apps/demo) | In-browser demo: the real API with a simulated crowd |

The npm and pub packages are not published yet; use them from this repository.

## Development

Node.js 22.18+ and pnpm (pinned in `package.json`).

```bash
pnpm install --frozen-lockfile
pnpm check           # typecheck, tests, build, action bundle check
pnpm test:browser    # web components and console in headless Chromium
pnpm test:dart       # Dart SDK against a real server
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md). Changes: [CHANGELOG.md](CHANGELOG.md).

## Background

Ripen started from a simple annoyance: apps people have used for years keep getting new bugs as features ship faster. The research behind it, with an analysis of Chrome and Windows channels, TestFlight, feature flag services and crowdtesting, is in Russian in [docs/research](docs/research).

## License

[Apache-2.0](LICENSE)
