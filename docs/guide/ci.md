# CI and automation

Everything the release console does is available to scripts: the `ripen` CLI, a GitHub Action that wraps it, and the admin HTTP API underneath both.

## The CLI

The server URL and the admin token come from the environment, never from arguments, so they stay out of shell history and logs.

```bash
export RIPEN_URL=https://ripen.example.com
export RIPEN_ADMIN_TOKEN=...   # from your secret store
```

| Command | What it does |
|---|---|
| `ripen channels` | Channels and subscriber counts |
| `ripen features` | Features and their stages |
| `ripen create <key> [--description <text>]` | Creates a feature at `off`, or updates its description |
| `ripen health <key>` | Metrics and gate checks |
| `ripen promote <key> [--force]` | Moves to the next channel if the gate passes |
| `ripen promote-ready` | Promotes every feature whose gate passes. Features at `off` stay off: opening the first channel is a human decision |
| `ripen rollback <key> [--to <stage>]` | Moves back one channel, or to `<stage>`; `--to off` turns it off for everyone |
| `ripen history <key>` | Every move with actor and gate checks |

Every command accepts `--json` and `--actor <name>` (recorded in history; defaults to `$GITHUB_ACTOR` or `$USER`).

Exit codes are made for pipelines:

| Code | Meaning |
|---|---|
| 0 | Done; for `health`, the gate passes |
| 1 | The gate does not pass, or the server refused (failed checks go to stderr) |
| 2 | Usage error: unknown command, missing key, missing `RIPEN_URL` or `RIPEN_ADMIN_TOKEN` |

Where to get it:

- `node action/ripen.mjs`: the CLI bundled into one file in this repository, Node.js 18+, nothing to install;
- `node packages/cli/dist/main.js` after `pnpm build`;
- `ripen` inside the Docker image.

## GitHub Action

The action runs the bundled CLI with the runner's Node.js. It uses no other actions and installs nothing. Pin it to a full commit SHA, as you should any action:

```yaml
- uses: userTrv/ripen@<full-commit-sha> # v0.3.0
  with:
    url: ${{ vars.RIPEN_URL }}
    admin-token: ${{ secrets.RIPEN_ADMIN_TOKEN }}
    command: promote-ready
```

| Input | Required | Description |
|---|---|---|
| `url` | yes | Base URL of the Ripen server |
| `admin-token` | yes | Admin token, from a secret |
| `command` | yes | CLI command and arguments, e.g. `promote new-editor` |
| `actor` | no | Name recorded in history; defaults to `github.actor` |

Output `json` holds the command's JSON result. Inputs reach the script only through environment variables, so a feature key cannot inject shell code; the command runs once.

### Nightly promotion

```yaml
name: Promote ready features
on:
  schedule:
    - cron: '17 6 * * 1-5'   # weekdays, before the team starts
  workflow_dispatch:

permissions: {}

jobs:
  promote:
    runs-on: ubuntu-24.04
    steps:
      - id: ripen
        uses: userTrv/ripen@<full-commit-sha> # v0.3.0
        with:
          url: ${{ vars.RIPEN_URL }}
          admin-token: ${{ secrets.RIPEN_ADMIN_TOKEN }}
          command: promote-ready
      - name: Summary
        env:
          RESULT: ${{ steps.ripen.outputs.json }}
        run: echo "$RESULT" >> "$GITHUB_STEP_SUMMARY"
```

### Open a feature with the release that ships it

```yaml
      - uses: userTrv/ripen@<full-commit-sha> # v0.3.0
        with:
          url: ${{ vars.RIPEN_URL }}
          admin-token: ${{ secrets.RIPEN_ADMIN_TOKEN }}
          command: promote new-editor
```

Run it after the deploy step: the code is live for everyone, the feature only for the earliest channel.

### Stop a deploy while a feature is unhealthy

```yaml
      - uses: userTrv/ripen@<full-commit-sha> # v0.3.0
        with:
          url: ${{ vars.RIPEN_URL }}
          admin-token: ${{ secrets.RIPEN_ADMIN_TOKEN }}
          command: health payments-v2
```

`health` fails the step while the gate does not pass.

## Other CI systems

Use the CLI from the Ripen Docker image, which you already build for the server. GitLab CI:

```yaml
promote:
  image: registry.example.com/ripen@sha256:...   # your Ripen image, pinned by digest
  script:
    - ripen promote-ready
  variables:
    RIPEN_URL: https://ripen.example.com
  # RIPEN_ADMIN_TOKEN comes from a masked, protected CI/CD variable
```

## The admin API

For anything else, call the API with `Authorization: Bearer <admin token>`. The endpoints are listed in the [specification](../spec.md#admin-api).
