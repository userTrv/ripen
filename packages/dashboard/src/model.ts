/** Pure helpers for the dashboard, testable without a DOM. */

export interface TrackStep {
  id: string;
  name: string;
  reached: boolean;
  current: boolean;
}

/** The stage track: "off" plus every channel, with the ones the feature has reached. */
export function stageTrack(stage: string, channels: { id: string; name: string }[]): TrackStep[] {
  const idx = channels.findIndex((c) => c.id === stage);
  return [
    { id: 'off', name: 'Off', reached: false, current: stage === 'off' },
    ...channels.map((c, i) => ({ id: c.id, name: c.name, reached: idx !== -1 && i <= idx, current: c.id === stage })),
  ];
}

export type Status = 'ready' | 'blocked' | 'off' | 'everywhere';

export function featureStatus(stage: string, nextStage: string | null, gate: { pass: boolean } | null): Status {
  if (stage === 'off') return 'off';
  if (nextStage === null) return 'everywhere';
  return gate?.pass ? 'ready' : 'blocked';
}

/** Ready features first, then blocked, then off, then the ones already everywhere; by key inside a group. */
export function sortFeatures<T extends { key: string; status: Status }>(items: T[]): T[] {
  const order: Record<Status, number> = { ready: 0, blocked: 1, off: 2, everywhere: 3 };
  return [...items].sort((a, b) => order[a.status] - order[b.status] || (a.key < b.key ? -1 : 1));
}

export function relativeTime(iso: string | number, now: number): string {
  const ms = now - (typeof iso === 'number' ? iso : Date.parse(iso));
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const FEATURE_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** Validates a new feature key the way the server does, with a message a person can act on. */
export function keyProblem(key: string): string | null {
  if (key === '') return 'Enter a key, for example new-editor';
  if (!FEATURE_KEY.test(key)) return 'Use lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit';
  return null;
}
