# Threat model

What Ripen protects, against whom, and what it leaves to the operator. Ripen 0.x, one server process with one SQLite file behind the operator's reverse proxy.

## Assets

| Asset | Why it matters |
|---|---|
| Feature stages | Decide what code runs for which people. Moving a broken feature to everyone is the main harm Ripen exists to prevent |
| Gate evidence: pulses, errors, activity | Drives promotion. Tampering with it moves features the wrong way |
| Admin token | Full control over stages, including forced promotion and the kill switch |
| Webhook secret | Lets a receiver trust that an event came from Ripen |
| Reports and error messages | Written by users or produced by apps; may contain personal data the app should not have sent |
| Subscriber records | Opaque ids with channel and consent; personal data in some jurisdictions |

## Actors and trust boundaries

```
 app users ──(client key, public)──▶ ┐
 anyone with the app binary ───────▶ ├─ reverse proxy (TLS, rate limits) ─▶ Ripen ─▶ SQLite file
 team: console, CLI, CI ─(admin token)▶ ┘                                     │
                                                                              └─▶ webhook receiver (signed)
```

- **The client key is public.** Anyone who unpacks the app has it and can act as any number of subscribers.
- **The admin token is the only secret that grants control.** Holders are the team, CI and the console tab.
- **The server trusts its host**: whoever can read the database file or the process environment owns the instance.

## Threats and mitigations

| # | Threat | Mitigation in Ripen | Left to the operator |
|---|---|---|---|
| T1 | **Pushing a feature through the gate** with fake "ok" pulses | A subscriber counts once per day per pulse status; promotion needs time in the channel as well as pulses; every promotion is recorded with its gate checks and can be rolled back or switched off at once | Rate-limit `/v1/client/*` per IP at the proxy; set stricter gates for risky features; promote from CI only, and review promotions through webhooks |
| T2 | **Holding a feature back** with fake "broken" pulses or errors | The same per-day counting for pulses; errors are accepted only from consenting subscribers; a team member can force a promotion, recorded as forced | Rate limits; look at reports and history before forcing |
| T3 | **Sybil subscribers**: many ids from one script | Not prevented: subscriber ids are chosen by the client by design (no accounts, no fingerprinting) | Rate limits per IP; optionally put the client API behind your own authentication and pass your user ids as subscriber ids |
| T4 | **Admin token theft or guessing** | Tokens of at least 16 characters, constant-time comparison, read only from the environment (never arguments or logs); the console keeps it in `sessionStorage` of one tab under a strict CSP | Generate long random tokens, keep them in a secret store, rotate on suspicion (signed-in consoles ask for the new one) |
| T5 | **Client key used against the admin API** | Separate scopes; the client key is rejected on `/v1/admin/*` and `/metrics` | — |
| T6 | **XSS in the console** through report text or feature descriptions | The console and the components insert user text only as text nodes, never as HTML; CSP `default-src 'self'` with no inline scripts | Keep the console on its own origin |
| T7 | **Path traversal** through `/dashboard/` | Paths are resolved inside the dashboard directory; unknown file types are refused; covered by a browser test | — |
| T8 | **Forged or replayed webhooks** at the receiver | HMAC-SHA256 over timestamp and body; `verifyWebhook()` checks in constant time and rejects requests older than five minutes; every event has a unique id | Verify every request, store processed ids, keep the secret out of logs |
| T9 | **Webhook used to reach internal services** (SSRF) | The URL comes only from the operator's environment, never from the API; redirects are not followed; plain HTTP only to localhost | Point it only at receivers you run |
| T10 | **Oversized or malformed requests** | 64 KB body limit, length limits on every field, strict JSON validation, feature keys and ids by pattern | Request rate and connection limits at the proxy |
| T11 | **Personal data in reports and errors** | Errors only with consent; no IPs or user agents stored; events carry no subscriber ids or report context; retention via `RIPEN_RETENTION_DAYS` | Do not put personal data in reports or `context`; choose a retention period; host according to data residency rules |
| T12 | **Supply chain** | No runtime dependencies; the Docker image contains no npm packages; dev dependencies pinned with a release-age delay and a trust policy; CI uses no third-party actions | Pin the image or the repository by digest or commit when deploying |
| T13 | **Lost or corrupted data** | SQLite in WAL mode, transactions around every change, additive migrations | Back up the database file ([Self-hosting](guide/self-hosting.md#backups)) |

## Out of scope

- Denial of service beyond request limits: Ripen is a single process meant to sit behind a proxy that handles volume.
- A compromised host, database file or environment.
- Apps that ignore Ripen's answer: stages decide what the SDK reports, the app decides what it runs.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).
