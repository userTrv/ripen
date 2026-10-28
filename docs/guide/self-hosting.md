# Self-hosting

Ripen is one Node.js process with one SQLite file. It runs on your infrastructure and sends nothing anywhere else.

## Run it

### Docker (recommended)

```bash
docker build -t ripen .
docker run -d --name ripen --restart unless-stopped \
  -p 127.0.0.1:4747:4747 -v ripen-data:/data --env-file ripen.env ripen
```

The image is built on `node:22.23.3-alpine` pinned by digest and contains only Ripen's compiled code: no packages from npm at runtime. It runs as the non-root `node` user, keeps data in the `/data` volume, has a healthcheck on `/healthz`, and serves the release console at `/dashboard/`.

Docker Compose:

```yaml
services:
  ripen:
    build: .
    restart: unless-stopped
    ports: ["127.0.0.1:4747:4747"]
    env_file: ripen.env
    volumes: ["ripen-data:/data"]
volumes:
  ripen-data:
```

### Without Docker

Node.js 22.13+ (22.18+ to run from source):

```bash
pnpm install --frozen-lockfile && pnpm build
RIPEN_DASHBOARD_DIR=packages/dashboard/dist node --disable-warning=ExperimentalWarning packages/server/dist/main.js
```

On Node.js 22 `node:sqlite` prints an "experimental" warning; the flag hides it.

## Configuration

### Environment variables

| Variable | Default (Docker default) | Meaning |
|---|---|---|
| `RIPEN_CLIENT_KEY` | required | Key apps send to the client API. At least 16 characters. Public by design |
| `RIPEN_ADMIN_TOKEN` | required | Token for the console, CLI and CI. At least 16 characters. Secret |
| `RIPEN_CONFIG` | `ripen.config.json` (`/data/ripen.config.json`) | Channels and gate rules; the default channels are used if the file is missing |
| `RIPEN_DB` | `ripen.db` (`/data/ripen.db`) | SQLite file |
| `RIPEN_CORS_ORIGINS` | `*` | Comma-separated origins allowed to call the client API from browsers |
| `RIPEN_DASHBOARD_DIR` | not set (`/app/dashboard`) | Directory of the built console, served at `/dashboard/` |
| `RIPEN_RETENTION_DAYS` | not set: keep everything | Delete pulses, reports, errors and activity older than this many days, at start and daily |
| `RIPEN_WEBHOOK_URL` | not set | Where to POST events; `https`, or `http` for localhost only. See [Integrations](integrations.md) |
| `RIPEN_WEBHOOK_SECRET` | required with a URL | Signs webhook requests. At least 16 characters. Secret |
| `RIPEN_WEBHOOK_EVENTS` | all | Comma-separated event types to send |
| `HOST` | `127.0.0.1` (`0.0.0.0`) | Address to listen on |
| `PORT` | `4747` | Port to listen on |

Secrets are read only from the environment, never from arguments, so they do not show up in the process list. A template is in [`.env.example`](../../.env.example).

### Channels and gate rules

`ripen.config.json` (see [`ripen.config.example.json`](../../ripen.config.example.json)):

```json
{
  "channels": [
    { "id": "early", "name": "Early", "description": "Get new features first and help find problems.",
      "contract": { "telemetry": true, "pulseEveryDays": 14 } },
    { "id": "regular", "name": "Regular", "default": true },
    { "id": "calm", "name": "Calm" }
  ],
  "gate": { "minDaysInChannel": 3, "minPulses": 20, "maxBrokenRatio": 0.05, "maxErrorRateRatio": 1.5 }
}
```

- At least two channels, ordered from earliest to most stable; ids are lowercase letters, digits and dashes; `off` is reserved.
- Exactly one channel has `"default": true`; new subscribers land there.
- `contract.telemetry` requires consent to join; `contract.pulseEveryDays` moves inactive subscribers one channel down.
- `gate` fields are optional; missing ones take the defaults shown.

The server validates the file at start and refuses to run with a clear message if something is wrong. Removing a channel moves its subscribers to the default channel on their next visit.

## TLS and a reverse proxy

Ripen speaks plain HTTP; put it behind the proxy you already run. Caddy:

```
ripen.example.com {
  reverse_proxy 127.0.0.1:4747
}
```

nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:4747;
  proxy_set_header Host $host;
  client_max_body_size 64k;
}
```

Keep the port bound to `127.0.0.1` (as in the examples above) so the server is reachable only through the proxy.

## Backups

The data is the SQLite file in WAL mode. For a consistent copy while the server runs, use SQLite's online backup:

```bash
docker run --rm -v ripen-data:/data alpine sh -c "apk add --no-cache sqlite >/dev/null && sqlite3 /data/ripen.db '.backup /data/backup.db'"
```

or stop the container and copy `ripen.db` together with `ripen.db-wal` and `ripen.db-shm`.

## Upgrades

Rebuild the image and restart the container. The server migrates the database schema at start; migrations only add columns and tables. `SIGTERM` lets requests in flight finish and stops within five seconds.

## Security

- **The client key is public.** It ships in apps and only lets a caller act as some subscriber: read features, choose a channel, send pulses, reports and errors. Rate-limit the client API at your proxy if you expect abuse.
- **The admin token is a secret.** Keep it in your secret store and CI secrets. Rotate it by changing `RIPEN_ADMIN_TOKEN` and restarting; signed-in consoles will ask for the new one.
- **The console** is served with `Content-Security-Policy: default-src 'self'`, talks only to its own server, and keeps the token in `sessionStorage` of the tab.
- **Webhooks** are signed with `RIPEN_WEBHOOK_SECRET`; the URL must not carry credentials, and only its host appears in logs.
- **Metrics** at `/metrics` need the admin token, like the rest of the admin API.
- **Request limits**: bodies up to 64 KB, reports up to 4000 characters, errors up to 1000.
- **Supply chain**: the server has no runtime dependencies; the image contains no npm packages.

To report a vulnerability, see [SECURITY.md](../../SECURITY.md).

## Data and privacy

Ripen stores: subscriber ids (opaque), their channel and consent, daily activity per channel, pulses, reports and errors with the app version. It does not store IP addresses or user agents.

- Errors are stored only for people who consented.
- Report text and `context` are whatever your app sends. Do not put personal data there.
- Subscriber ids should not be emails or other personal data; the SDKs generate random ones by default.
- Set `RIPEN_RETENTION_DAYS` (for example 180) to delete old events automatically. Keep it longer than the longest time a feature stays in one channel: the gate only counts events since the feature entered its current channel.

You are the operator of this data. If your users are in jurisdictions with data residency rules (GDPR, Russia's 152-FZ and others), host the server accordingly.
