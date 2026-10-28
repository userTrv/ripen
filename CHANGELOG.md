# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org) (0.x: minor versions may break).

## [Unreleased]

## [0.2.0] - 2026-10-28

### Added
- Docker image for amd64 and arm64 on GitHub Container Registry: `ghcr.io/usertrv/ripen`. Releases are built by a workflow from this changelog; CI also builds and smoke-tests the image.
- `ripen promote-ready`: promotes every feature whose gate passes; features that are off stay off.
- GitHub Action (`action.yml`) running the bundled CLI, with no other actions and nothing to install.
- Dart and Flutter SDK (`packages/sdk-dart`), no dependencies.
- CI workflow without third-party actions, in the digest-pinned Node image.
- `RIPEN_RETENTION_DAYS`: deletes pulses, reports, errors and activity older than the given number of days.
- Events and signed webhooks (`RIPEN_WEBHOOK_URL`, `RIPEN_WEBHOOK_SECRET`): `feature.promoted`, `feature.rolled_back`, `report.created`, `subscriber.demoted`. `verifyWebhook()` checks them on the receiving side.
- `GET /metrics`: channel and feature health in the Prometheus format, for Prometheus, Grafana and the OpenTelemetry Collector.
- Guide for desktop apps: Electron and Tauri, with update channels that follow the Ripen channel. Threat model in `docs/threat-model.md`.
- User guides in `docs/guide`, package READMEs, contributing and security policies, example configuration.

### Changed
- The gate counts at most one "ok" and one "broken" pulse per subscriber per day, so a repeated pulse, or a script reusing one subscriber id, does not add weight.

### Fixed
- The server stops promptly on `SIGTERM` instead of waiting for idle keep-alive connections.
- A wrong `ripen.config.json` is reported with a one-line message instead of a stack trace.
- The release console asks to sign in again when the admin token was rotated.

## [0.1.0] - 2026-10-24

First version.

### Added
- Specification, ADRs 1–9, research and decision notes.
- `@ripen/core`: channels (three by default, any number by configuration), channel contract, promotion gate.
- `@ripen/server`: HTTP API on `node:http` and `node:sqlite`; `@ripen/server/engine` runs without Node with `MemoryStore`.
- `@ripen/sdk`: JavaScript SDK.
- `@ripen/elements`: `<ripen-channel-picker>` and `<ripen-feedback>`.
- `@ripen/cli`: `ripen` command for CI and terminals.
- `@ripen/openfeature`: OpenFeature web provider.
- `@ripen/dashboard`: release console served at `/dashboard/`.
- Docker image and the in-browser demo.

[Unreleased]: https://github.com/userTrv/ripen/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/userTrv/ripen/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/userTrv/ripen/releases/tag/v0.1.0
