import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EN, RU, choiceStep, format, pickerModel } from '@ripen/elements';
import type { Session } from '@ripen/sdk';

const session: Session = {
  subscriber: { id: 'u1', channel: 'regular', consent: false, demotion: null },
  channels: [
    { id: 'early', name: 'Early', description: 'New features first.', contract: { telemetry: true, pulseEveryDays: 14 } },
    { id: 'regular', name: 'Regular', default: true },
    { id: 'calm', name: 'Calm' },
  ],
  features: {},
};

describe('pickerModel', () => {
  it('describes what every channel expects', () => {
    const model = pickerModel(session, EN);
    assert.deepEqual(model.options[0]?.expectations, ['Errors are sent automatically', 'A one-tap check-in every 14 days']);
    assert.deepEqual(model.options[2]?.expectations, ['Nothing is expected from you']);
    assert.equal(model.options.find((o) => o.current)?.id, 'regular');
    assert.equal(model.options[0]?.needsConsent, true);
    assert.equal(model.demotionNotice, null);
  });

  it('explains a demotion using the channel name', () => {
    const demoted = { ...session, subscriber: { ...session.subscriber, demotion: { from: 'early', reason: 'no pulse in 14 days' } } };
    assert.equal(pickerModel(demoted, RU).demotionNotice, 'Вы перемещены из канала «Early»: no pulse in 14 days. Вернуться можно в любой момент.');
  });
});

describe('choiceStep', () => {
  it('asks for consent before a telemetry channel', () => {
    assert.equal(choiceStep(session, 'early', false), 'ask-consent');
    assert.equal(choiceStep(session, 'early', true), 'apply');
  });

  it('applies other channels right away and ignores the current one', () => {
    assert.equal(choiceStep(session, 'calm', false), 'apply');
    assert.equal(choiceStep(session, 'regular', false), 'none');
    assert.equal(choiceStep(session, 'nightly', false), 'none');
  });
});

describe('format', () => {
  it('replaces known placeholders and keeps unknown ones', () => {
    assert.equal(format('{a} and {b}', { a: 1 }), '1 and {b}');
  });
});
