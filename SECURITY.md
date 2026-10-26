# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report it privately through [GitHub security advisories](https://github.com/userTrv/ripen/security/advisories/new) for this repository.

Include what is affected, how to reproduce it and what an attacker could do. You will get an answer within a week. Once a fix is released, the advisory is published with credit, unless you prefer otherwise.

## Supported versions

Ripen is at 0.x: only the latest release gets fixes.

## Scope notes

- The **client key** is public by design: it ships inside apps and only allows acting as some subscriber. Abuse of the client API with a valid key (e.g. sending many pulses) is a rate-limiting matter for the proxy in front of Ripen, not a vulnerability, unless it lets a caller do more than the [specification](docs/spec.md) allows.
- The **admin token** must stay secret. Anything that reveals it, bypasses it or lets the client key reach admin endpoints is in scope.
- The release console's CSP and the server's path handling for `/dashboard/` are in scope.

Deployment guidance is in [Self-hosting → Security](docs/guide/self-hosting.md#security).
