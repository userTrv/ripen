# Concepts

The precise model, with every rule and endpoint, is in the [specification](../spec.md). This page explains the ideas.

## Channels

A channel is a level on the scale "new features first ↔ fewer bugs". Channels are ordered from the earliest to the most stable:

| Channel | Gets | Is asked to |
|---|---|---|
| `early` | New features first | Agree to automatic error reports and answer a one-tap check-in every 14 days |
| `regular` (default) | Features the early channel found no serious problems with | Nothing |
| `calm` | Only features that have proven themselves | Nothing |

People choose their channel themselves. That is the main difference from percentage rollouts, where the vendor picks a random slice of users.

The default is three channels on purpose. Each channel needs enough active people to catch a bug before the feature moves on: if a bug affects 1% of users and 5% of them report it, three reports take about 6000 active subscribers in that channel. More channels split the same people into thinner slices. The number is configurable when you have the audience for it ([ADR 4](../adr/0004-three-default-channels.md)).

## Features and stages

Every feature ships in every build. Its **stage** says how far it has got: `off`, or the most stable channel it has reached. A feature at stage `regular` is enabled for `regular` and every earlier channel:

```
stage:        off      early     regular    calm
early         –        ✓         ✓          ✓
regular       –        –         ✓          ✓
calm          –        –         –          ✓
```

Moving a feature forward is a **promotion**; moving it back is a **rollback**. Rolling back to `off` is the kill switch.

## The channel contract

Earlier channels expect more, but nobody can be forced to write bug reports. So the contract asks for cheap contributions:

- **Consent to error reports.** Joining a channel with `telemetry` in its contract requires `consent: true`, which your app must get from the person explicitly. Errors from people without consent are dropped by the server.
- **A pulse every N days.** A pulse is one tap: "everything works" or "something broke". Whoever stops sending pulses is moved one channel towards stable, and the app can tell them why (`session.subscriber.demotion`). There are no other penalties.

Written reports stay optional. The signal comes mostly from automatic errors and pulses, so it grows with the number of early subscribers, not with their discipline ([ADR 5](../adr/0005-contract-and-consent.md)).

## The gate

A feature moves to the next channel only when all checks pass. The defaults:

| Check | Default |
|---|---|
| Days in the current channel | at least 3 |
| Pulses from people who have the feature | at least 20 |
| Share of "broken" pulses | at most 5% |
| Error rate compared to people without the feature | at most ×1.5 |

Pulses and errors can name the feature they are about. Those that name another feature do not count, so one broken feature does not hold back healthy ones in the same channel. The error comparison uses only people who agreed to send errors, in both groups.

The first step, from `off` to the earliest channel, needs no gate: that is where the evidence is collected. A person can force a promotion past a failed gate; the move is recorded in the history with their name ([ADR 6](../adr/0006-gate.md)).

Any feature can override these rules through the admin API (`PUT /v1/admin/features/:key` with `gate`), e.g. a payment change may require 100 pulses and a week in each channel.

## Where it runs

Ripen is self-hosted: one Node.js process and one SQLite file on your infrastructure, with no runtime dependencies. Your users' data never leaves it ([ADR 2](../adr/0002-self-hosted.md), [ADR 3](../adr/0003-zero-runtime-dependencies.md)).
