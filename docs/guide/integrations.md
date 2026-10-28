# Integrations

Ripen tells other systems what happens in two ways: **webhooks** for events (a feature moved, a report arrived) and **`/metrics`** for numbers (subscribers per channel, pulses, error rates, whether a gate passes). Both are built into the server, with no plugins to install.

## Webhooks

Set three variables and restart:

```bash
RIPEN_WEBHOOK_URL=https://hooks.example.com/ripen
RIPEN_WEBHOOK_SECRET=<openssl rand -hex 24>
# Optional: only some types
RIPEN_WEBHOOK_EVENTS=feature.promoted,feature.rolled_back,report.created
```

Each event arrives as a `POST` with a JSON body:

```json
{
  "id": "5b0c1f0e-6a52-4c5e-9d0e-3f6f3c1c2a10",
  "type": "feature.promoted",
  "at": "2026-10-28T09:00:00.000Z",
  "data": { "feature": "new-editor", "from": "early", "to": "regular", "actor": "ci", "forced": false, "gate": { "pass": true, "checks": [] } }
}
```

| Type | When |
|---|---|
| `feature.promoted` | A feature moved to the next channel, by the gate or forced |
| `feature.rolled_back` | A feature moved back or was switched off |
| `report.created` | Someone sent a problem report |
| `subscriber.demoted` | Someone was moved down a channel for missing the contract (no subscriber id) |

The exact fields are in the [specification](../spec.md#events-and-metrics).

### Receiving them

Check the signature on the **raw** body before parsing it. With Node.js and `@ripen/server/engine`:

```ts
import { createServer } from 'node:http';
import { verifyWebhook } from '@ripen/server/engine';

const secret = process.env.RIPEN_WEBHOOK_SECRET!;
const seen = new Set<string>(); // use your database in production

createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!(await verifyWebhook(secret, req.headers['ripen-signature'] as string, body))) {
    res.statusCode = 401;
    return res.end();
  }
  const event = JSON.parse(body);
  res.end(); // answer quickly; slow receivers are retried
  if (seen.has(event.id)) return;
  seen.add(event.id);
  if (event.type === 'report.created') await createIssue(event.data);
}).listen(8080);
```

In other languages: split `Ripen-Signature: t=…,v1=…`, compute HMAC-SHA256 of `` `${t}.${body}` `` with the secret, compare it to `v1` in constant time, and reject `t` older than five minutes.

Delivery rules: one event at a time, in order; network errors, timeouts, `408`, `429` and `5xx` are retried after 1 s, 10 s and 60 s; any other status is final. Events queued in memory are lost if the server stops, so treat webhooks as notifications and the admin API as the source of truth.

### Chat notifications

Chat services accept their own payload, so put a small receiver in between. For a Slack incoming webhook, inside the receiver above:

```ts
const text = {
  'feature.promoted': (d) => `:seedling: ${d.feature} → ${d.to}${d.forced ? ' (forced)' : ''}`,
  'feature.rolled_back': (d) => `:rewind: ${d.feature} → ${d.to}`,
  'report.created': (d) => `:speech_balloon: ${d.channel}${d.feature ? ` / ${d.feature}` : ''}: ${d.message}`,
}[event.type]?.(event.data);
if (text) await fetch(process.env.SLACK_WEBHOOK_URL!, { method: 'POST', body: JSON.stringify({ text }) });
```

Report messages are written by your users: escape them as the target service requires.

## Metrics

`GET /metrics` returns the Prometheus text format and needs the admin token:

```
ripen_channel_subscribers{channel="early"} 42
ripen_feature_stage{feature="new-editor",stage="early"} 1
ripen_feature_pulses{feature="new-editor",status="broken"} 3
ripen_feature_error_rate{feature="new-editor",group="with"} 0.12
ripen_feature_gate_pass{feature="new-editor"} 1
```

The full list is in the [specification](../spec.md#events-and-metrics). Values describe each feature's current stage and are computed on request, so a scrape every minute or two is plenty.

### Prometheus

```yaml
scrape_configs:
  - job_name: ripen
    scrape_interval: 1m
    scheme: https
    authorization:
      credentials_file: /etc/prometheus/ripen-admin-token
    static_configs:
      - targets: ["ripen.example.com"]
```

An alert when a feature's error rate in early channels is more than twice the rest:

```yaml
- alert: RipenFeatureErrors
  expr: ripen_feature_error_rate{group="with"} > 2 * ripen_feature_error_rate{group="without"}
  for: 30m
  annotations:
    summary: "{{ $labels.feature }} has twice the error rate of subscribers without it"
```

### OpenTelemetry Collector

The Collector's Prometheus receiver scrapes the same endpoint and forwards the metrics through any exporter (OTLP, Grafana Cloud, Datadog and others):

```yaml
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: ripen
          scrape_interval: 1m
          scheme: https
          authorization:
            credentials_file: /etc/otelcol/ripen-admin-token
          static_configs:
            - targets: ["ripen.example.com"]
```

Keep the token in a file readable only by the collector, not in the configuration itself.

## In-process listeners

When Ripen runs inside your own Node.js or edge code (see `@ripen/server/engine`), subscribe to the service directly:

```ts
const off = service.onEvent((event) => console.log(event.type, event.data));
```

Listeners run after the change is stored; an exception in a listener is logged and does not fail the request.
