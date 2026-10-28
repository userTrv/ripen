import {
  ErrorCode,
  OpenFeatureEventEmitter,
  ProviderEvents,
  StandardResolutionReasons,
  type EvaluationContext,
  type JsonValue,
  type Provider,
  type ResolutionDetails,
  type TrackingEventDetails,
} from '@openfeature/web-sdk';
import type { Ripen } from '@ripen/sdk';

/**
 * OpenFeature provider backed by a Ripen client. Ripen features are booleans:
 * a feature is on when it has reached the subscriber's channel.
 *
 *   const ripen = createRipen({ url, clientKey, subscriberId: user.id });
 *   await OpenFeature.setProviderAndWait(new RipenProvider(ripen));
 *   OpenFeature.getClient().getBooleanValue('new-editor', false);
 *
 * Feedback goes through OpenFeature tracking:
 *   client.track('ripen.ok');                                   // a pulse: everything works
 *   client.track('ripen.broken', { feature: 'new-editor' });    // a pulse about one feature
 */
export class RipenProvider implements Provider {
  readonly metadata = { name: 'ripen' } as const;
  readonly runsOn = 'client';
  readonly events = new OpenFeatureEventEmitter();
  private readonly ripen: Ripen;
  private unsubscribe: (() => void) | null = null;

  constructor(ripen: Ripen) {
    this.ripen = ripen;
  }

  async initialize(): Promise<void> {
    await this.ripen.start();
    // Later session refreshes (a channel switch, ripen.start()) may change flag values.
    this.unsubscribe = this.ripen.onChange(() => this.events.emit(ProviderEvents.ConfigurationChanged));
  }

  /**
   * Ripen evaluates on the server per subscriber, so a new context only means
   * fetching a fresh session. The subscriber id is fixed when the client is created.
   */
  async onContextChange(): Promise<void> {
    await this.ripen.start();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  resolveBooleanEvaluation(flagKey: string, defaultValue: boolean): ResolutionDetails<boolean> {
    const session = this.ripen.session;
    if (!session) {
      return { value: defaultValue, reason: StandardResolutionReasons.ERROR, errorCode: ErrorCode.PROVIDER_NOT_READY };
    }
    const value = session.features[flagKey];
    if (value === undefined) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.FLAG_NOT_FOUND,
        errorMessage: `Ripen has no feature "${flagKey}"`,
      };
    }
    return {
      value,
      variant: value ? 'on' : 'off',
      reason: StandardResolutionReasons.TARGETING_MATCH,
      flagMetadata: { channel: session.subscriber.channel },
    };
  }

  resolveStringEvaluation(flagKey: string, defaultValue: string): ResolutionDetails<string> {
    return typeMismatch(flagKey, defaultValue);
  }

  resolveNumberEvaluation(flagKey: string, defaultValue: number): ResolutionDetails<number> {
    return typeMismatch(flagKey, defaultValue);
  }

  resolveObjectEvaluation<T extends JsonValue>(flagKey: string, defaultValue: T): ResolutionDetails<T> {
    return typeMismatch(flagKey, defaultValue);
  }

  /** `ripen.ok` and `ripen.broken` become pulses; `details.feature` narrows one to a feature. */
  track(trackingEventName: string, _context: EvaluationContext, details?: TrackingEventDetails): void {
    const status = trackingEventName === 'ripen.ok' ? 'ok' : trackingEventName === 'ripen.broken' ? 'broken' : null;
    if (!status) return;
    const feature = typeof details?.['feature'] === 'string' ? details['feature'] : undefined;
    void this.ripen.pulse(status, feature ? { feature } : {}).catch(() => {});
  }
}

function typeMismatch<T>(flagKey: string, defaultValue: T): ResolutionDetails<T> {
  return {
    value: defaultValue,
    reason: StandardResolutionReasons.ERROR,
    errorCode: ErrorCode.TYPE_MISMATCH,
    errorMessage: `Ripen features are boolean; "${flagKey}" was requested as another type`,
  };
}
