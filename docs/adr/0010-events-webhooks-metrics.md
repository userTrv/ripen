# 10. Events through webhooks, metrics through a Prometheus endpoint

Date: 2026-10-28. Status: accepted.

## Context

Adopters want promotions and reports where their team already looks: chat, issue trackers, Grafana, Sentry. The direction note planned "export to webhooks and OpenTelemetry". An OpenTelemetry SDK or an OTLP exporter would be a runtime dependency (ADR 3), and every observability stack can already scrape the Prometheus text format, including the OpenTelemetry Collector.

## Decision

- The service emits typed events after a change commits: `feature.promoted`, `feature.rolled_back`, `report.created`, `subscriber.demoted`. In-process listeners subscribe with `service.onEvent()`.
- The server sends them to one webhook URL, signed with HMAC-SHA256 in the `t=…,v1=…` form used by Stripe and others, so receivers can reuse familiar code. `verifyWebhook()` is exported for receivers written in JavaScript.
- Delivery is in memory, ordered, with three retries. No outbox table: losing events when the process stops is acceptable, because the state they describe is always available from the admin API and history.
- `GET /metrics` exposes gauges in the Prometheus text format behind the admin token. They are computed on request from the same numbers the gate uses.
- Events carry no subscriber ids and no report `context`.

## Consequences

- No dependencies; webhooks and metrics also work in the Node-free engine.
- Integrations with a specific service (Slack, GitHub Issues, Sentry) are small receivers outside Ripen, shown in the guide, rather than code in the server.
- If at-least-once across restarts is needed later, an outbox table can be added behind the same event types.
