# @ripen/core

The Ripen domain model as pure functions: channel configuration, feature stages, the channel contract and the promotion gate. No I/O and no dependencies; the server and the in-browser demo are built on it.

```ts
import { DEFAULT_CONFIG, parseConfig, isEnabled, nextStage, checkContract, evaluateGate } from '@ripen/core';

const config = parseConfig(JSON.parse(text));          // validates and fills gate defaults
isEnabled(config, 'regular', 'early');                 // true: early has everything regular has
nextStage(config, 'early');                            // 'regular'
evaluateGate(config.gate, { daysInStage: 4, pulsesOk: 40, pulsesBroken: 1, errorRateWith: 0.2, errorRateWithout: 0.2 });
// { pass: true, checks: [...] }
```

| Export | Purpose |
|---|---|
| `parseConfig`, `parseGate`, `DEFAULT_CONFIG`, `DEFAULT_GATE` | Validate configuration |
| `isEnabled`, `nextStage`, `previousStage`, `splitByStage`, `defaultChannel` | Stages and channels |
| `checkContract`, `assertCanJoin` | Channel contract: inactivity and consent |
| `evaluateGate` | Gate checks with readable messages |

The rules are described in [Concepts](https://github.com/userTrv/ripen/blob/main/docs/guide/concepts.md) and the [specification](https://github.com/userTrv/ripen/blob/main/docs/spec.md).

## License

Apache-2.0. Part of [Ripen](https://github.com/userTrv/ripen): stability channels chosen by users, features promoted on real signals.
