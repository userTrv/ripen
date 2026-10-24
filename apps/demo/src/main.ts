import { DEFAULT_CONFIG } from '@ripen/core';
import { defineRipenElements } from '@ripen/elements';
import { createRipen } from '@ripen/sdk';
import { ADMIN_TOKEN, CLIENT_KEY, Demo, FEATURES } from './simulation.ts';

const STAGES = ['off', ...DEFAULT_CONFIG.channels.map((c) => c.id)];
const STAGE_NAMES: Record<string, string> = { off: 'Off', early: 'Early', regular: 'Regular', calm: 'Calm' };

let demo = new Demo();
warmUp();

/** The SDK talks to the in-page API through this instead of the network. */
const demoFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const response = await demo.api({
    method: init?.method ?? 'GET',
    path: url.pathname,
    authorization: headers['Authorization'],
    body: typeof init?.body === 'string' ? init.body : '',
  });
  return new Response(response.body === null ? null : JSON.stringify(response.body), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  });
};

const ripen = createRipen({ url: 'https://ripen.demo', clientKey: CLIENT_KEY, subscriberId: 'you', fetch: demoFetch, appVersion: '2.4.0' });

async function admin(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return demo.api({ method, path, authorization: `Bearer ${ADMIN_TOKEN}`, body: body === undefined ? '' : JSON.stringify(body) });
}

function warmUp(): void {
  for (let i = 0; i < 4; i++) demo.nextDay();
  demo.add('Four days of history simulated. Try promoting a feature.', 'info');
}

// DOM helpers

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c !== null) node.append(c);
  return node;
}

const $ = <T extends Element>(selector: string) => document.querySelector(selector) as T;

// The phone: what "you" see in the app

function renderPhone(): void {
  const session = ripen.session;
  if (!session) return;
  const on = (key: string) => session.features[key] === true;
  const channelName = STAGE_NAMES[session.subscriber.channel] ?? session.subscriber.channel;

  const notes = [
    { title: 'Groceries', body: 'Oat milk, lemons, rye bread', pinned: true },
    { title: 'Release checklist', body: 'Changelog, store screenshots, rollout plan', pinned: false },
    { title: 'Ideas', body: 'Dark map style, offline mode', pinned: false },
  ];

  const screen = $<HTMLElement>('#phone-screen');
  screen.classList.toggle('focus', on('focus-editor'));
  screen.replaceChildren(
    el('div', { class: 'app-bar' }, el('strong', {}, 'Field Notes'), el('span', { class: `chip chip-${session.subscriber.channel}` }, channelName)),
    on('smart-search') ? el('div', { class: 'search' }, 'Search in notes…') : el('div', { class: 'search muted' }, 'Search titles…'),
    el(
      'ul',
      { class: 'notes' },
      ...notes
        .sort((a, b) => (on('pinned-notes') ? Number(b.pinned) - Number(a.pinned) : 0))
        .map((n) => el('li', {}, el('span', { class: 'note-title' }, n.title, on('pinned-notes') && n.pinned ? el('span', { class: 'pin', title: 'Pinned' }, ' ● pinned') : null), el('span', { class: 'note-body' }, n.body))),
    ),
    el(
      'div',
      { class: 'tools' },
      on('focus-editor') ? el('span', { class: 'tool' }, 'Focus mode') : null,
      on('voice-notes') ? el('span', { class: 'tool' }, 'Record voice') : null,
      el('span', { class: 'tool new' }, '+ New note'),
    ),
  );

  const enabled = FEATURES.filter((f) => on(f.key)).map((f) => f.title);
  $('#phone-caption').textContent = enabled.length ? `You see: ${enabled.join(', ')}.` : 'No new features in your channel yet.';
}

// The console: what the team sees

async function renderConsole(): Promise<void> {
  const channels = (await admin('GET', '/v1/admin/channels')).body as { id: string; name: string; subscribers: number }[];
  $('#day').textContent = `Day ${demo.day}`;
  $('#crowd').replaceChildren(
    ...channels.map((c) => el('span', { class: `chip chip-${c.id}` }, `${c.name} `, el('b', {}, String(c.subscribers)))),
  );

  const rows = await Promise.all(
    demo.features().map(async (f) => ({ f, health: (await admin('GET', `/v1/admin/features/${f.key}/health`)).body })),
  );

  $('#features').replaceChildren(
    ...rows.map(({ f, health }) => {
      const meta = FEATURES.find((d) => d.key === f.key)!;
      const stageIdx = STAGES.indexOf(f.stage);
      const track = el(
        'ol',
        { class: 'track', 'aria-label': `Stage: ${STAGE_NAMES[f.stage]}` },
        ...STAGES.map((s, i) => el('li', { class: `${s}${i <= stageIdx && f.stage !== 'off' && s !== 'off' ? ' reached' : ''}${s === f.stage ? ' current' : ''}` }, STAGE_NAMES[s] ?? s)),
      );

      const checks = health.gate
        ? el('ul', { class: 'checks' }, ...health.gate.checks.map((c: { pass: boolean; message: string }) => el('li', { class: c.pass ? 'pass' : 'fail' }, el('span', { class: 'mark', 'aria-hidden': 'true' }, c.pass ? '✓' : '✗'), c.message)))
        : el('p', { class: 'hint' }, f.stage === 'off' ? 'Off for everyone. Promoting it opens the first channel, no gate needed.' : 'Enabled in every channel.');

      const verdict = health.gate ? el('span', { class: `verdict ${health.gate.pass ? 'pass' : 'fail'}` }, health.gate.pass ? 'Ready to promote' : 'Gate not passed') : null;

      const promote = el('button', { class: 'primary', type: 'button' }, f.nextStage ? `Promote to ${STAGE_NAMES[f.nextStage]}` : 'Everywhere');
      promote.toggleAttribute('disabled', !f.nextStage);
      promote.addEventListener('click', () => void act(() => promoteFeature(f.key, false)));
      const rollback = el('button', { type: 'button' }, 'Roll back');
      rollback.toggleAttribute('disabled', f.stage === 'off');
      rollback.addEventListener('click', () => void act(() => rollbackFeature(f.key)));
      const actions = el('div', { class: 'actions' }, promote, rollback);
      if (health.gate && !health.gate.pass && f.nextStage) {
        const force = el('button', { type: 'button', class: 'ghost' }, 'Force');
        force.addEventListener('click', () => void act(() => promoteFeature(f.key, true)));
        actions.append(force);
      }

      const report = health.recentReports[0];
      return el(
        'article',
        { class: 'feature' },
        el('header', {}, el('div', {}, el('h3', {}, meta.title), el('code', {}, f.key)), verdict),
        track,
        el(
          'div',
          { class: 'feature-body' },
          el('div', { class: 'stats' }, el('span', {}, el('b', {}, String(health.health.pulsesOk)), ' ok'), el('span', {}, el('b', {}, String(health.health.pulsesBroken)), ' broken'), el('span', {}, el('b', {}, `${Math.floor(health.health.daysInStage)}d`), ' in stage')),
          checks,
          report ? el('p', { class: 'report' }, `“${report.message}”`, el('span', {}, ` · ${health.recentReports.length} report${health.recentReports.length === 1 ? '' : 's'}`)) : null,
        ),
        actions,
      );
    }),
  );

  $('#log').replaceChildren(...demo.log.map((l) => el('li', { class: l.tone }, el('span', { class: 'log-day' }, `D${l.day}`), l.text)));
}

async function promoteFeature(key: string, force: boolean): Promise<void> {
  const result = await admin('POST', `/v1/admin/features/${key}/promote`, { actor: 'you', force });
  const title = FEATURES.find((f) => f.key === key)!.title;
  if (result.status === 200) {
    demo.add(`${title} promoted to ${STAGE_NAMES[result.body.feature.stage]}${force ? ' (forced)' : ''}`, force ? 'bad' : 'good');
  } else {
    const failed = (result.body.gate?.checks ?? []).filter((c: { pass: boolean }) => !c.pass).map((c: { message: string }) => c.message);
    demo.add(`${title} stays: ${failed.join('; ') || result.body.message}`, 'bad');
  }
}

async function rollbackFeature(key: string): Promise<void> {
  const result = await admin('POST', `/v1/admin/features/${key}/rollback`, { actor: 'you' });
  if (result.status === 200) demo.add(`${FEATURES.find((f) => f.key === key)!.title} rolled back to ${STAGE_NAMES[result.body.stage]}`, 'info');
}

async function act(action: () => void | Promise<void>): Promise<void> {
  await action();
  await ripen.start(); // the app picks up the change on its next session
  await renderConsole();
}

// Wiring

defineRipenElements();
const picker = $('ripen-channel-picker') as HTMLElement & { ripen: typeof ripen };
const feedback = $('ripen-feedback') as HTMLElement & { ripen: typeof ripen };
picker.ripen = ripen;
feedback.ripen = ripen;
ripen.onChange(() => {
  renderPhone();
  void renderConsole();
});

$('#next-day').addEventListener('click', () => void act(() => demo.nextDay()));
$('#next-week').addEventListener('click', () => void act(() => { for (let i = 0; i < 7; i++) demo.nextDay(); }));
$('#reset').addEventListener('click', () => {
  demo = new Demo();
  warmUp();
  void act(() => {});
});

await ripen.start();
