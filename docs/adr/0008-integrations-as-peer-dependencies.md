# 8. Integrations use the adopter's libraries as peer dependencies

Date: 2026-10-24. Status: accepted.

## Context

ADR 3 keeps Ripen free of runtime dependencies. Integrations such as the OpenFeature provider cannot work without the library they integrate with.

## Decision

- An integration lives in its own package (`@ripen/openfeature`) and declares the library as a peer dependency. The adopter already has it; Ripen does not bring a second copy.
- The library is a dev dependency only for tests and typechecking, pinned to an exact version that passed the 7-day release-age rule.
- Core packages (`core`, `server`, `sdk`, `elements`, `cli`) stay without runtime and peer dependencies on third-party code.

## Consequences

The OpenFeature provider is tested against the real `@openfeature/web-sdk` (1.10.0) and `@openfeature/core` (1.12.0), published by the OpenFeature project.
