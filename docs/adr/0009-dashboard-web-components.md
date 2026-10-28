# 9. Dashboard as a web component served by the server

Date: 2026-10-24. Status: accepted.

## Context

The roadmap had an Angular dashboard. Angular brings a large dependency tree, against ADR 3, and adopters of a self-hosted tool expect the console to come with the server.

## Decision

- `@ripen/dashboard` is a framework-free custom element, `<ripen-dashboard>`, built like `@ripen/elements`.
- The server serves it at `/dashboard/` when `RIPEN_DASHBOARD_DIR` points to the build; the Docker image does this by default.
- The page has a strict CSP (`default-src 'self'`) and talks only to the admin API of the same server. The admin token stays in `sessionStorage` of the tab.
- Forcing a gate needs a second, explicit click; the move is recorded with the actor.

## Consequences

- No new dependencies; the console can also be embedded into an adopter's own admin pages.
- The console is covered by a browser test that runs it from the server, including the CSP and path traversal checks.
