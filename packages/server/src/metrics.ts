import type { Service } from './service.ts';

/**
 * Channel and feature health in the Prometheus text format, for Prometheus,
 * Grafana Agent or the OpenTelemetry Collector's Prometheus receiver.
 * Values describe each feature's current stage, as the gate sees them.
 */
export function renderMetrics(service: Service): string {
  const out: string[] = [];
  const metric = (name: string, help: string, rows: [Record<string, string>, number | null][]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
    for (const [labels, value] of rows) {
      if (value === null || !Number.isFinite(value)) continue;
      const text = Object.entries(labels).map(([k, v]) => `${k}="${escape(v)}"`).join(',');
      out.push(`${name}{${text}} ${value}`);
    }
  };

  metric('ripen_channel_subscribers', 'Subscribers in the channel.', service.channelStats().map((c) => [{ channel: c.id }, c.subscribers]));

  const stages = ['off', ...service.config.channels.map((c) => c.id)];
  const features = service.listFeatures().map((f) => service.health(f.key));
  metric(
    'ripen_feature_stage',
    `Index of the feature's stage: ${stages.map((s, i) => `${i}=${s}`).join(', ')}.`,
    features.map((h) => [{ feature: h.feature.key, stage: h.feature.stage }, stages.indexOf(h.feature.stage)]),
  );
  metric('ripen_feature_days_in_stage', 'Days since the feature entered its stage.', features.map((h) => [{ feature: h.feature.key }, round(h.health.daysInStage)]));
  metric(
    'ripen_feature_pulses',
    'Pulses from channels that have the feature, since it entered its stage.',
    features.flatMap((h) => [
      [{ feature: h.feature.key, status: 'ok' }, h.health.pulsesOk],
      [{ feature: h.feature.key, status: 'broken' }, h.health.pulsesBroken],
    ]),
  );
  metric(
    'ripen_feature_error_rate',
    'Errors per active consenting subscriber, in channels with and without the feature.',
    features.flatMap((h) => [
      [{ feature: h.feature.key, group: 'with' }, h.health.errorRateWith],
      [{ feature: h.feature.key, group: 'without' }, h.health.errorRateWithout],
    ]),
  );
  metric(
    'ripen_feature_gate_pass',
    'Whether the gate to the next channel passes now (1) or not (0). Absent at "off" and in the last channel.',
    features.map((h) => [{ feature: h.feature.key }, h.gate === null ? null : h.gate.pass ? 1 : 0]),
  );
  return out.join('\n') + '\n';
}

function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
