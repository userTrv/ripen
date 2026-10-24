import type { Channel, Session } from '@ripen/sdk';
import { format, type RipenTexts } from './texts.ts';

/**
 * Pure view models, kept apart from the DOM so they can be tested in Node.
 */

export interface ChannelOption {
  id: string;
  name: string;
  description: string;
  /** What the channel expects from its subscribers, one line per obligation. */
  expectations: string[];
  current: boolean;
  needsConsent: boolean;
}

export interface PickerModel {
  options: ChannelOption[];
  demotionNotice: string | null;
}

export function pickerModel(session: Session, texts: RipenTexts): PickerModel {
  const options = session.channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    description: channel.description ?? '',
    expectations: expectations(channel, texts),
    current: channel.id === session.subscriber.channel,
    needsConsent: channel.contract?.telemetry === true,
  }));

  const demotion = session.subscriber.demotion;
  const fromName = demotion && (session.channels.find((c) => c.id === demotion.from)?.name ?? demotion.from);
  return {
    options,
    demotionNotice: demotion ? format(texts.demoted, { from: fromName ?? '', reason: demotion.reason }) : null,
  };
}

export function expectations(channel: Channel, texts: RipenTexts): string[] {
  const lines: string[] = [];
  if (channel.contract?.telemetry) lines.push(texts.expectsTelemetry);
  if (channel.contract?.pulseEveryDays) lines.push(format(texts.expectsPulse, { days: channel.contract.pulseEveryDays }));
  return lines.length > 0 ? lines : [texts.expectsNothing];
}

/** Whether choosing `channelId` can be applied right away or needs the consent step first. */
export function choiceStep(session: Session, channelId: string, consent: boolean): 'apply' | 'ask-consent' | 'none' {
  if (channelId === session.subscriber.channel) return 'none';
  const channel = session.channels.find((c) => c.id === channelId);
  if (!channel) return 'none';
  return channel.contract?.telemetry && !consent ? 'ask-consent' : 'apply';
}
