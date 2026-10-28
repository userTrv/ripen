# OpenFeature

[OpenFeature](https://openfeature.dev) is the CNCF standard API for feature flags. `@ripen/openfeature` is a provider for its web SDK: code that already reads flags through OpenFeature can read Ripen features without changes.

```bash
pnpm add @ripen/sdk @ripen/openfeature @openfeature/web-sdk
```

`@openfeature/web-sdk` is a peer dependency: you bring the version you use (1.10 or newer); Ripen does not install a second copy ([ADR 8](../adr/0008-integrations-as-peer-dependencies.md)).

```ts
import { OpenFeature } from '@openfeature/web-sdk';
import { createRipen } from '@ripen/sdk';
import { RipenProvider } from '@ripen/openfeature';

const ripen = createRipen({ url: 'https://ripen.example.com', clientKey, subscriberId: hashedUserId });
await OpenFeature.setProviderAndWait(new RipenProvider(ripen));

const client = OpenFeature.getClient();
client.getBooleanValue('new-editor', false);
```

## How flags map

| OpenFeature | Ripen |
|---|---|
| `getBooleanValue(key, default)` | `true` when the feature has reached the subscriber's channel |
| `variant` | `on` or `off` |
| `reason` | `TARGETING_MATCH` |
| `flagMetadata.channel` | The subscriber's channel |
| Unknown key | Default value, `FLAG_NOT_FOUND` |
| String, number or object flag | Default value, `TYPE_MISMATCH`: Ripen features are boolean |
| Before the session loads | Default value, `PROVIDER_NOT_READY` |

When the session changes (the person switches channel, or you call `ripen.start()` again), the provider emits `ConfigurationChanged`, so OpenFeature hooks and framework bindings re-render.

The subscriber id is fixed when the Ripen client is created. OpenFeature's evaluation context does not change it; use the same id you pass as `targetingKey` elsewhere.

## Feedback through tracking

OpenFeature's tracking API carries Ripen pulses:

```ts
client.track('ripen.ok');                                  // everything works
client.track('ripen.broken', { feature: 'new-editor' });   // something broke in one feature
```

Other tracking events are ignored by this provider, so it can sit next to an analytics provider.

## Next to another flag service

Ripen decides *who* has a feature by channel. If you also run Unleash, Flagsmith, LaunchDarkly or another service for experiments and configuration, keep it for those flags and use Ripen for features that ripen through channels. OpenFeature domains let both providers coexist:

```ts
await OpenFeature.setProviderAndWait('ripen', new RipenProvider(ripen));
OpenFeature.getClient('ripen').getBooleanValue('new-editor', false);
```
