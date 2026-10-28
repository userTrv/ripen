# Contributing to Ripen

Thanks for taking the time. Issues, questions and pull requests are welcome.

## Before you start

- For a bug, open an issue with steps to reproduce, or a pull request with a failing test.
- For a new feature or a change in behaviour, open an issue first, so we can agree on the approach before you spend time on code. Significant decisions are recorded as [ADRs](docs/adr).

## Set up

Node.js 22.18+ and pnpm (the exact version is pinned in `package.json`; `corepack enable` picks it up).

```bash
pnpm install --frozen-lockfile
pnpm check            # typecheck, unit tests, build, action bundle check: what CI runs
pnpm test:browser     # web components and dashboard in headless Chromium (set RIPEN_CHROMIUM if needed)
pnpm test:dart        # Dart SDK against a real server (Dart 3.5+; RIPEN_DART=/path/to/dart)
pnpm dev:server       # a local server with the console at /dashboard/ (after pnpm build)
pnpm demo             # builds the in-browser demo into apps/demo/site
```

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | Domain model: channels, contract, gate. No I/O |
| `packages/server` | HTTP server (`node:http`, `node:sqlite`); `src/engine.ts` runs without Node |
| `packages/sdk-js`, `packages/sdk-dart` | Client SDKs |
| `packages/elements`, `packages/dashboard` | Web components |
| `packages/cli`, `action.yml`, `action/ripen.mjs` | CLI and the GitHub Action (generated bundle) |
| `packages/openfeature` | OpenFeature provider |
| `apps/demo` | In-browser demo |
| `docs/spec.md`, `docs/adr`, `docs/guide` | Specification, decisions, user guides |

## Rules

- **No runtime dependencies** in the core packages ([ADR 3](docs/adr/0003-zero-runtime-dependencies.md)). Integrations take their library as a peer dependency ([ADR 8](docs/adr/0008-integrations-as-peer-dependencies.md)). New dev dependencies need a reason in the pull request; versions must be at least 7 days old, which pnpm enforces.
- **TypeScript with erasable syntax only**: no `enum`, `namespace` or parameter properties; relative imports end in `.ts`. Node runs the sources directly.
- **Behaviour changes update [`docs/spec.md`](docs/spec.md)** in the same pull request. User-facing changes go into [`CHANGELOG.md`](CHANGELOG.md) under "Unreleased".
- **Tests come with the change.** Bugs get a test that failed before the fix.
- **Changing `packages/cli`?** Run `pnpm build:action` and commit `action/ripen.mjs`; CI checks it is up to date.
- **GitHub Actions** in workflows are avoided; if one is ever needed, pin it to a full commit SHA with a version comment.
- **No secrets** in code, tests, logs or issues. Test tokens are obvious placeholders.

## Commits and pull requests

Small, focused commits in the [Conventional Commits](https://www.conventionalcommits.org) style (`feat(cli): …`, `fix(server): …`). Describe what changed and why in the pull request and how you tested it.

By contributing you agree that your contributions are licensed under the [Apache-2.0](LICENSE) license.

Maintainers: the release process is in [RELEASING.md](RELEASING.md).
