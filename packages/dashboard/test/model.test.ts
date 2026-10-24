import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { featureStatus, keyProblem, relativeTime, sortFeatures, stageTrack } from '@ripen/dashboard';

const channels = [
  { id: 'early', name: 'Early' },
  { id: 'regular', name: 'Regular' },
  { id: 'calm', name: 'Calm' },
];

describe('dashboard model', () => {
  it('builds the stage track', () => {
    assert.deepEqual(stageTrack('regular', channels).map((s) => [s.id, s.reached, s.current]), [
      ['off', false, false],
      ['early', true, false],
      ['regular', true, true],
      ['calm', false, false],
    ]);
    assert.deepEqual(stageTrack('off', channels).filter((s) => s.reached), []);
  });

  it('derives a status from stage and gate', () => {
    assert.equal(featureStatus('off', 'early', null), 'off');
    assert.equal(featureStatus('calm', null, null), 'everywhere');
    assert.equal(featureStatus('early', 'regular', { pass: true }), 'ready');
    assert.equal(featureStatus('early', 'regular', { pass: false }), 'blocked');
  });

  it('puts features that need a decision first', () => {
    const sorted = sortFeatures([
      { key: 'b', status: 'everywhere' as const },
      { key: 'c', status: 'blocked' as const },
      { key: 'a', status: 'off' as const },
      { key: 'd', status: 'ready' as const },
    ]);
    assert.deepEqual(sorted.map((s) => s.key), ['d', 'c', 'a', 'b']);
  });

  it('formats relative times and validates keys', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    assert.equal(relativeTime('2026-10-24T11:59:40Z', now), 'just now');
    assert.equal(relativeTime('2026-10-24T11:15:00Z', now), '45 min ago');
    assert.equal(relativeTime('2026-10-21T12:00:00Z', now), '3 days ago');
    assert.equal(keyProblem('new-editor'), null);
    assert.match(keyProblem('New Editor') ?? '', /lowercase/);
    assert.match(keyProblem('') ?? '', /Enter a key/);
  });
});
