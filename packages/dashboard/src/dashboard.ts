import { AdminClient, AdminError, type ChannelStat, type Feature, type Health, type HistoryEntry } from './admin-client.ts';
import { featureStatus, keyProblem, relativeTime, sortFeatures, stageTrack, type Status } from './model.ts';

const TOKEN_KEY = 'ripen.dashboard.token';
const REFRESH_MS = 30_000;

const STYLES = `
  :host {
    --bg: var(--ripen-bg, #f4f6f3);
    --surface: var(--ripen-surface, #ffffff);
    --ink: var(--ripen-ink, #18211c);
    --muted: var(--ripen-muted, #5d6a62);
    --line: var(--ripen-line, #d9dfd8);
    --accent: var(--ripen-accent, #18211c);
    --on-accent: var(--ripen-on-accent, #ffffff);
    --good: var(--ripen-good, #2f7d4a);
    --bad: var(--ripen-bad, #b23a2e);
    --step: var(--ripen-step, #4f8f2f);
    display: block;
    color: var(--ink);
    background: var(--bg);
    font: 15px/1.5 var(--ripen-font, system-ui, sans-serif);
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --bg: var(--ripen-bg, #111613); --surface: var(--ripen-surface, #19201c); --ink: var(--ripen-ink, #e6ece7);
      --muted: var(--ripen-muted, #9aa69e); --line: var(--ripen-line, #2c3530); --accent: var(--ripen-accent, #e6ece7);
      --on-accent: var(--ripen-on-accent, #111613); --good: var(--ripen-good, #6cc48a); --bad: var(--ripen-bad, #ef7a6c);
      --step: var(--ripen-step, #7cc25a);
    }
  }
  * { box-sizing: border-box; }
  h1, h2, h3 { margin: 0; line-height: 1.2; text-wrap: balance; }
  button, input { font: inherit; color: inherit; }
  button { cursor: pointer; padding: 6px 13px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  button.danger { color: var(--bad); border-style: dashed; }
  button:disabled { opacity: 0.45; cursor: default; }
  button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  input { padding: 7px 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); min-width: 0; }
  code { font-family: var(--ripen-mono, ui-monospace, monospace); font-size: 0.85em; color: var(--muted); }
  .wrap { display: grid; gap: 18px; position: relative; }
  .bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
  .bar h1 { font-size: 1.4em; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .muted { color: var(--muted); }
  .small { font-size: 0.86em; }
  .chip { padding: 2px 10px; border-radius: 999px; border: 1px solid var(--line); font-size: 0.85em; white-space: nowrap; }
  .chip b { font-variant-numeric: tabular-nums; }
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px; }
  .login { max-width: 420px; display: grid; gap: 10px; }
  .login label { font-weight: 600; }
  .create { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
  .create input[name=key] { flex: 1 1 160px; }
  .create input[name=description] { flex: 3 1 220px; }
  .error { color: var(--bad); margin: 0; }
  .status-line { margin: 0; }
  /* Kept in the accessibility tree while empty, so announcements are not lost, but out of the layout. */
  .status-line:empty { position: absolute; }
  .features { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 14px; align-items: start; }
  .feature { display: grid; gap: 10px; align-content: start; }
  .feature header { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
  .feature header > div { min-width: 0; }
  .feature h3 { font-size: 1.05em; overflow-wrap: anywhere; }
  .pill { font-size: 0.78em; font-weight: 600; padding: 3px 9px; border-radius: 6px; white-space: nowrap; }
  .pill.ready { color: var(--good); background: color-mix(in srgb, var(--good) 14%, transparent); }
  .pill.blocked { color: var(--bad); background: color-mix(in srgb, var(--bad) 12%, transparent); }
  .pill.off, .pill.everywhere { color: var(--muted); background: color-mix(in srgb, var(--muted) 12%, transparent); }
  .track { list-style: none; margin: 0; padding: 0; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; font-size: 0.75em; }
  .track li { padding-top: 6px; border-top: 4px solid var(--line); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track li.reached { border-color: var(--step); }
  .track li.current { color: var(--ink); font-weight: 600; }
  .stats { display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .stats b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .checks, .reports, .history { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
  .checks li { display: flex; gap: 8px; }
  .checks .mark { font-weight: 700; flex: none; width: 1em; }
  .checks .pass .mark { color: var(--good); }
  .checks .fail { color: var(--bad); }
  .reports li { font-style: italic; overflow-wrap: anywhere; }
  .reports li span { font-style: normal; color: var(--muted); }
  details summary { cursor: pointer; color: var(--muted); }
  .history li { font-variant-numeric: tabular-nums; }
  .empty { text-align: center; padding: 32px 16px; }
`;

type Attrs = Record<string, string | boolean | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child !== null && child !== false) node.append(child);
  return node;
}

interface Row {
  key: string;
  status: Status;
  feature: Feature;
  health: Health;
}

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage blocked: the token lives only in memory for this page.
  }
}

/**
 * Creates the `<ripen-dashboard>` class. Attributes: `api` (server base URL,
 * defaults to this page's origin), `actor` (name recorded in history).
 * Property `fetch` replaces the network, e.g. for an in-page server.
 */
export function createDashboardClass(): CustomElementConstructor {
  return class RipenDashboard extends HTMLElement {
    fetch: typeof fetch | null = null;
    private client: AdminClient | null = null;
    private channels: ChannelStat[] = [];
    private rows: Row[] = [];
    private message: { text: string; tone: 'info' | 'bad' } | null = null;
    private confirmingForce: string | null = null;
    private openHistory = new Map<string, HistoryEntry[]>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private readonly root: ShadowRoot;

    constructor() {
      super();
      this.root = this.attachShadow({ mode: 'open' });
    }

    connectedCallback(): void {
      const token = readToken();
      if (token) void this.connect(token);
      else this.render();
      this.timer = setInterval(() => {
        if (this.client && document.visibilityState === 'visible') void this.load();
      }, REFRESH_MS);
    }

    disconnectedCallback(): void {
      if (this.timer) clearInterval(this.timer);
    }

    private get actor(): string {
      return this.getAttribute('actor') ?? 'dashboard';
    }

    private makeClient(token: string): AdminClient {
      const base = this.getAttribute('api') ?? location.origin;
      return new AdminClient(base, token, this.fetch ?? globalThis.fetch.bind(globalThis));
    }

    async connect(token: string): Promise<void> {
      const client = this.makeClient(token);
      try {
        await client.channels();
      } catch (error) {
        writeToken(null);
        this.client = null;
        const status = error instanceof AdminError ? error.status : 0;
        this.message = { text: status === 401 ? 'That token is not accepted. Check RIPEN_ADMIN_TOKEN on the server.' : 'Cannot reach the Ripen server.', tone: 'bad' };
        this.render();
        return;
      }
      this.client = client;
      writeToken(token);
      this.message = null;
      await this.load();
    }

    private signOut(): void {
      writeToken(null);
      this.client = null;
      this.rows = [];
      this.render();
    }

    async load(): Promise<void> {
      if (!this.client) return;
      try {
        const [channels, features] = await Promise.all([this.client.channels(), this.client.features()]);
        const healths = await Promise.all(features.map((f) => this.client!.health(f.key)));
        this.channels = channels;
        this.rows = sortFeatures(
          features.map((feature, i) => ({ key: feature.key, feature, health: healths[i]!, status: featureStatus(feature.stage, feature.nextStage, healths[i]!.gate) })),
        );
        for (const key of this.openHistory.keys()) this.openHistory.set(key, await this.client.history(key));
      } catch (error) {
        if (error instanceof AdminError && error.status === 401) {
          // The token was rotated on the server: ask for the new one.
          this.signOut();
          this.message = { text: 'The admin token changed. Sign in with the new one.', tone: 'bad' };
          this.render();
          return;
        }
        this.message = { text: `Could not load: ${(error as Error).message}`, tone: 'bad' };
      }
      this.render();
    }

    private async run(action: () => Promise<string>): Promise<void> {
      try {
        this.message = { text: await action(), tone: 'info' };
      } catch (error) {
        const e = error as AdminError;
        const failed = e.checks?.filter((c) => !c.pass).map((c) => c.message) ?? [];
        this.message = { text: failed.length ? `${e.message}: ${failed.join('; ')}` : e.message, tone: 'bad' };
      }
      this.confirmingForce = null;
      await this.load();
    }

    private render(): void {
      const style = h('style');
      style.textContent = STYLES;
      this.root.replaceChildren(style, this.client ? this.renderConsole() : this.renderLogin());
    }

    private renderLogin(): HTMLElement {
      const input = h('input', { id: 'token', name: 'token', type: 'password', autocomplete: 'current-password', required: true });
      const form = h(
        'form',
        { class: 'panel login' },
        h('h1', {}, 'Ripen'),
        h('label', { for: 'token' }, 'Admin token'),
        input,
        h('p', { class: 'muted small' }, 'The value of RIPEN_ADMIN_TOKEN. It stays in this browser tab and is sent only to this server.'),
        h('button', { class: 'primary', type: 'submit' }, 'Sign in'),
        this.message ? h('p', { class: 'error', role: 'alert' }, this.message.text) : null,
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void this.connect(input.value.trim());
      });
      return h('div', { class: 'wrap' }, form);
    }

    private renderConsole(): HTMLElement {
      const refresh = h('button', { type: 'button' }, 'Refresh');
      refresh.addEventListener('click', () => void this.load());
      const signOut = h('button', { type: 'button' }, 'Sign out');
      signOut.addEventListener('click', () => this.signOut());

      const bar = h(
        'div',
        { class: 'bar' },
        h('div', { class: 'row' }, h('h1', {}, 'Release console'), ...this.channels.map((c) => h('span', { class: 'chip', title: `${c.subscribers} subscribers in ${c.name}` }, `${c.name} `, h('b', {}, String(c.subscribers))))),
        h('div', { class: 'row' }, refresh, signOut),
      );

      const status = h('p', { class: `status-line small${this.message?.tone === 'bad' ? ' error' : ' muted'}`, role: 'status', 'aria-live': 'polite' }, this.message?.text ?? '');
      const list = this.rows.length
        ? h('div', { class: 'features' }, ...this.rows.map((row) => this.renderFeature(row)))
        : h('div', { class: 'panel empty muted' }, 'No features yet. Create the first one above, then promote it to the earliest channel.');

      return h('div', { class: 'wrap' }, bar, this.renderCreate(), status, list);
    }

    private renderCreate(): HTMLElement {
      const key = h('input', { id: 'new-key', name: 'key', placeholder: 'feature-key', 'aria-label': 'Feature key', autocomplete: 'off' });
      const description = h('input', { id: 'new-description', name: 'description', placeholder: 'What it does (optional)', 'aria-label': 'Description' });
      const problem = h('p', { class: 'error small', role: 'alert' });
      const form = h('form', { class: 'panel create', 'aria-label': 'Create a feature' }, key, description, h('button', { class: 'primary', type: 'submit' }, 'Create feature'), problem);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = key.value.trim();
        const issue = keyProblem(value);
        if (issue) {
          problem.textContent = issue;
          key.focus();
          return;
        }
        void this.run(async () => {
          await this.client!.create(value, description.value.trim());
          return `Created ${value}. It is off until you promote it.`;
        });
      });
      return form;
    }

    private renderFeature(row: Row): HTMLElement {
      const { feature: f, health, status } = row;
      const now = Date.now();
      const names: Record<string, string> = { off: 'Off', ...Object.fromEntries(this.channels.map((c) => [c.id, c.name])) };
      const label: Record<Status, string> = { ready: 'Ready to promote', blocked: 'Gate not passed', off: 'Off', everywhere: 'Everywhere' };

      const track = h(
        'ol',
        { class: 'track', 'aria-label': `Stage: ${names[f.stage] ?? f.stage}` },
        ...stageTrack(f.stage, this.channels).map((s) => h('li', { class: [s.reached && 'reached', s.current && 'current'].filter(Boolean).join(' ') }, s.name)),
      );

      const hs = health.health;
      const rate = (n: number | null) => (n === null ? '–' : n.toFixed(2));
      const stats = h(
        'div',
        { class: 'stats small muted' },
        h('span', {}, h('b', {}, String(hs.pulsesOk)), ' ok'),
        h('span', {}, h('b', {}, String(hs.pulsesBroken)), ' broken'),
        h('span', {}, 'errors ', h('b', {}, rate(hs.errorRateWith)), ' vs ', h('b', {}, rate(hs.errorRateWithout))),
        h('span', { title: f.stageSince }, `in stage since ${relativeTime(f.stageSince, now)}`),
      );

      const checks = health.gate
        ? h('ul', { class: 'checks small' }, ...health.gate.checks.map((c) => h('li', { class: c.pass ? 'pass' : 'fail' }, h('span', { class: 'mark', 'aria-hidden': 'true' }, c.pass ? '✓' : '✗'), c.message)))
        : h('p', { class: 'muted small' }, f.stage === 'off' ? 'Off for everyone. Promoting opens the first channel; no gate needed.' : 'Enabled in every channel.');

      const reports = health.recentReports.length
        ? h('ul', { class: 'reports small' }, ...health.recentReports.slice(0, 3).map((r) => h('li', {}, `“${r.message}”`, h('span', {}, ` · ${names[r.channel] ?? r.channel}, ${relativeTime(r.created_at, now)}`))))
        : null;

      const actions = h('div', { class: 'row' });
      const promote = h('button', { class: 'primary', type: 'button', disabled: !f.nextStage }, f.nextStage ? `Promote to ${names[f.nextStage] ?? f.nextStage}` : 'Everywhere');
      promote.addEventListener('click', () => void this.run(async () => {
        const result = await this.client!.promote(f.key, false, this.actor);
        return `${f.key} is now in ${names[result.feature.stage] ?? result.feature.stage}`;
      }));
      const rollback = h('button', { type: 'button', disabled: f.stage === 'off' }, 'Roll back');
      rollback.addEventListener('click', () => void this.run(async () => {
        const result = await this.client!.rollback(f.key, this.actor);
        return `${f.key} rolled back to ${names[result.stage] ?? result.stage}`;
      }));
      actions.append(promote, rollback);
      if (f.stage !== 'off') {
        const off = h('button', { type: 'button', class: 'danger' }, 'Turn off');
        off.addEventListener('click', () => void this.run(async () => {
          await this.client!.rollback(f.key, this.actor, 'off');
          return `${f.key} is off for everyone`;
        }));
        actions.append(off);
      }
      if (status === 'blocked') {
        if (this.confirmingForce === f.key) {
          const yes = h('button', { type: 'button', class: 'danger' }, 'Yes, promote anyway');
          yes.addEventListener('click', () => void this.run(async () => {
            const result = await this.client!.promote(f.key, true, this.actor);
            return `${f.key} forced into ${names[result.feature.stage] ?? result.feature.stage}; recorded in history`;
          }));
          const cancel = h('button', { type: 'button' }, 'Cancel');
          cancel.addEventListener('click', () => {
            this.confirmingForce = null;
            this.render();
          });
          actions.append(yes, cancel);
        } else {
          const force = h('button', { type: 'button', class: 'danger' }, 'Force…');
          force.addEventListener('click', () => {
            this.confirmingForce = f.key;
            this.render();
          });
          actions.append(force);
        }
      }

      const history = h('details', { open: this.openHistory.has(f.key) }, h('summary', { class: 'small' }, 'History'));
      const entries = this.openHistory.get(f.key);
      if (entries) {
        history.append(
          entries.length
            ? h('ul', { class: 'history small muted' }, ...entries.map((e) => h('li', {}, `${relativeTime(e.at, now)}: ${e.action} ${names[e.from] ?? e.from} → ${names[e.to] ?? e.to}${e.actor ? ` by ${e.actor}` : ''}${e.forced ? ' (forced)' : ''}`)))
            : h('p', { class: 'small muted' }, 'No moves yet.'),
        );
      }
      history.addEventListener('toggle', () => {
        if (history.open && !this.openHistory.has(f.key)) {
          void this.client!.history(f.key).then((list) => {
            this.openHistory.set(f.key, list);
            this.render();
          });
        } else if (!history.open) {
          this.openHistory.delete(f.key);
        }
      });

      return h(
        'article',
        { class: 'panel feature', 'data-key': f.key },
        h('header', {}, h('div', {}, h('h3', {}, f.description || f.key), h('code', {}, f.key)), h('span', { class: `pill ${status}` }, label[status])),
        track,
        stats,
        checks,
        reports,
        actions,
        history,
      );
    }
  };
}

/** Registers `<ripen-dashboard>`. Safe to call more than once. */
export function defineRipenDashboard(registry: CustomElementRegistry = customElements): void {
  if (!registry.get('ripen-dashboard')) registry.define('ripen-dashboard', createDashboardClass());
}
