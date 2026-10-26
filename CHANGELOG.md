# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org) (0.x: minor versions may break).

## [Unreleased]

### Added
- `ripen promote-ready`: promotes every feature whose gate passes; features that are off stay off.
- GitHub Action (`action.yml`) running the bundled CLI, with no other actions and nothing to install.
- Dart and Flutter SDK (`packages/sdk-dart`), no dependencies.
- CI workflow without third-party actions, in the digest-pinned Node image.
- User guides in `docs/guide`, package READMEs, contributing and security policies, example configuration.

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

[Unreleased]: https://github.com/userTrv/ripen/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/userTrv/ripen/releases/tag/v0.1.0
