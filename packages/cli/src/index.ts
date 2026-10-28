import { parseArgs } from 'node:util';

/**
 * `ripen` command. The server URL and admin token come from the environment
 * (RIPEN_URL, RIPEN_ADMIN_TOKEN), never from arguments, so they stay out of
 * shell history and CI logs.
 *
 * Exit codes: 0 success, 1 the gate did not pass or the server refused, 2 usage error.
 */

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  fetch: typeof fetch;
}

const USAGE = `Usage: ripen <command> [options]

Commands:
  channels                       Channels and subscriber counts
  features                       Features and their stages
  create <key> [--description <text>]
                                 Create a feature (starts at "off") or update its description
  health <key>                   Metrics and gate checks; exits 1 if the gate does not pass
  promote <key> [--force]        Move to the next channel if the gate passes
  rollback <key> [--to <stage>]  Move back one channel, or to <stage> ("off" turns it off)
  history <key>                  Every move with actor and gate checks
  promote-ready                  Promote every feature whose gate passes (features that are
                                 off stay off: opening the first channel is a human decision)

Options:
  --actor <name>   Recorded in history (default: $GITHUB_ACTOR or $USER)
  --json           Print the raw JSON response
  -h, --help       Show this help

Environment:
  RIPEN_URL           Server URL, e.g. https://ripen.example.com
  RIPEN_ADMIN_TOKEN   Admin token`;

class UsageError extends Error {}

class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown> | null;

  constructor(status: number, body: Record<string, unknown> | null) {
    super(typeof body?.['message'] === 'string' ? body['message'] : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

interface Check {
  id: string;
  pass: boolean;
  message: string;
}

export async function run(argv: string[], env: Record<string, string | undefined>, io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        description: { type: 'string' },
        force: { type: 'boolean' },
        to: { type: 'string' },
        actor: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    io.err((error as Error).message);
    io.err(USAGE);
    return 2;
  }

  const { values, positionals } = parsed;
  const [command, key] = positionals;
  if (values.help) {
    io.out(USAGE);
    return 0;
  }
  if (!command) {
    io.err(USAGE);
    return 2;
  }

  const url = env['RIPEN_URL']?.replace(/\/+$/, '');
  const token = env['RIPEN_ADMIN_TOKEN'];
  if (!url || !token) {
    io.err('RIPEN_URL and RIPEN_ADMIN_TOKEN must be set');
    return 2;
  }

  const actor = values.actor ?? env['GITHUB_ACTOR'] ?? env['USER'] ?? null;
  const api = async (method: string, path: string, body?: unknown): Promise<any> => {
    const response = await io.fetch(url + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new ApiError(response.status, data);
    return data;
  };
  const print = (data: unknown, human: () => void) => (values.json ? io.out(JSON.stringify(data, null, 2)) : human());
  const needKey = (): string => {
    if (!key) throw new UsageError(`"${command}" needs a feature key`);
    return encodeURIComponent(key);
  };

  try {
    switch (command) {
      case 'channels': {
        const channels = await api('GET', '/v1/admin/channels');
        print(channels, () => {
          for (const c of channels) io.out(`${c.id.padEnd(16)} ${String(c.subscribers).padStart(8)}  ${c.name}`);
        });
        return 0;
      }
      case 'features': {
        const features = await api('GET', '/v1/admin/features');
        print(features, () => {
          if (features.length === 0) io.out('no features yet');
          for (const f of features) io.out(`${f.key.padEnd(32)} ${f.stage.padEnd(12)} since ${f.stageSince}`);
        });
        return 0;
      }
      case 'create': {
        const feature = await api('PUT', `/v1/admin/features/${needKey()}`, values.description === undefined ? {} : { description: values.description });
        print(feature, () => io.out(`${feature.key}: ${feature.stage}`));
        return 0;
      }
      case 'health': {
        const health = await api('GET', `/v1/admin/features/${needKey()}/health`);
        print(health, () => {
          const h = health.health;
          io.out(`${health.feature.key}: ${health.feature.stage} → ${health.feature.nextStage ?? '(everywhere)'}`);
          io.out(`pulses ${h.pulsesOk} ok / ${h.pulsesBroken} broken, ${round(h.daysInStage)} days in channel`);
          if (health.gate) printChecks(io, health.gate.checks);
          for (const r of health.recentReports) io.out(`report [${r.channel}] ${r.message}`);
        });
        return health.gate === null || health.gate.pass ? 0 : 1;
      }
      case 'promote': {
        const result = await api('POST', `/v1/admin/features/${needKey()}/promote`, { actor, force: values.force === true });
        print(result, () => {
          io.out(`${result.feature.key}: now in ${result.feature.stage}${values.force ? ' (forced)' : ''}`);
          if (result.gate) printChecks(io, result.gate.checks);
        });
        return 0;
      }
      case 'rollback': {
        const feature = await api('POST', `/v1/admin/features/${needKey()}/rollback`, { actor, ...(values.to ? { to: values.to } : {}) });
        print(feature, () => io.out(`${feature.key}: now ${feature.stage}`));
        return 0;
      }
      case 'promote-ready': {
        const features: { key: string; stage: string; nextStage: string | null }[] = await api('GET', '/v1/admin/features');
        const results: { key: string; from: string; to: string | null; promoted: boolean; failed: string[] }[] = [];
        for (const f of features) {
          if (f.stage === 'off' || f.nextStage === null) continue;
          const key = encodeURIComponent(f.key);
          const health = await api('GET', `/v1/admin/features/${key}/health`);
          if (health.gate?.pass) {
            const result = await api('POST', `/v1/admin/features/${key}/promote`, { actor, force: false });
            results.push({ key: f.key, from: f.stage, to: result.feature.stage, promoted: true, failed: [] });
          } else {
            const failed = (health.gate?.checks ?? []).filter((c: Check) => !c.pass).map((c: Check) => c.message);
            results.push({ key: f.key, from: f.stage, to: null, promoted: false, failed });
          }
        }
        print(results, () => {
          if (results.length === 0) io.out('nothing to promote: every feature is off or already everywhere');
          for (const r of results) {
            io.out(r.promoted ? `✓ ${r.key}: ${r.from} → ${r.to}` : `· ${r.key}: stays in ${r.from} (${r.failed.join('; ')})`);
          }
        });
        return 0;
      }
      case 'history': {
        const history = await api('GET', `/v1/admin/features/${needKey()}/history`);
        print(history, () => {
          for (const h of history) io.out(`${h.at}  ${h.action.padEnd(8)} ${h.from} → ${h.to}  ${h.actor ?? ''}${h.forced ? ' (forced)' : ''}`);
        });
        return 0;
      }
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      io.err(USAGE);
      return 2;
    }
    if (error instanceof ApiError) {
      if (values.json && error.body) io.out(JSON.stringify(error.body, null, 2));
      io.err(`error: ${error.message}`);
      const gate = error.body?.['gate'] as { checks: Check[] } | undefined;
      if (gate && !values.json) printChecks(io, gate.checks, io.err);
      return 1;
    }
    io.err(`error: ${(error as Error).message}`);
    return 1;
  }
}

function printChecks(io: Io, checks: Check[], write: (line: string) => void = io.out): void {
  for (const c of checks) write(`  ${c.pass ? '✓' : '✗'} ${c.message}`);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
