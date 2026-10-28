# @ripen/openfeature

OpenFeature provider for Ripen: read Ripen features through `@openfeature/web-sdk` and send pulses with `client.track`.

```ts
import { OpenFeature } from '@openfeature/web-sdk';
import { RipenProvider } from '@ripen/openfeature';

await OpenFeature.setProviderAndWait(new RipenProvider(ripen));
OpenFeature.getClient().getBooleanValue('new-editor', false);
OpenFeature.getClient().track('ripen.broken', { feature: 'new-editor' });
```

`@openfeature/web-sdk` (1.10+) and `@ripen/sdk` are peer dependencies. Details: [OpenFeature](https://github.com/userTrv/ripen/blob/main/docs/guide/openfeature.md).

## License

Apache-2.0. Part of [Ripen](https://github.com/userTrv/ripen): stability channels chosen by users, features promoted on real signals.
