import type { GateResult } from '@ripen/core';

/**
 * What happened in Ripen, for webhooks and other listeners. Events are emitted
 * only after the change is stored.
 */
export type RipenEvent =
  | EventOf<'feature.promoted', { feature: string; from: string; to: string; actor: string | null; forced: boolean; gate: GateResult | null }>
  | EventOf<'feature.rolled_back', { feature: string; from: string; to: string; actor: string | null }>
  | EventOf<'report.created', { id: number; feature: string | null; channel: string; message: string; appVersion: string | null }>
  | EventOf<'subscriber.demoted', { from: string; to: string; reason: string }>;

export interface EventOf<Type extends string, Data> {
  /** Unique id, for receivers that must not process an event twice. */
  id: string;
  type: Type;
  /** ISO 8601 time of the change. */
  at: string;
  data: Data;
}

export type RipenEventType = RipenEvent['type'];

export type EventListener = (event: RipenEvent) => void;
