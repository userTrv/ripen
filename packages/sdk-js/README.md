# @ripen/sdk

JavaScript client for a Ripen server. Browsers and Node.js 20+, no dependencies.

```ts
import { createRipen } from '@ripen/sdk';

const ripen = createRipen({ url: 'https://ripen.example.com', clientKey, appVersion: '2.4.0' });
await ripen.start();

if (ripen.isEnabled('new-editor')) mountNewEditor();

await ripen.setChannel('early', { consent: true });   // the person agreed to send errors
ripen.captureUncaughtErrors();
await ripen.pulse('broken', { feature: 'new-editor' });
```

Full API: [Web SDK and components](https://github.com/userTrv/ripen/blob/main/docs/guide/web.md).

## License

Apache-2.0. Part of [Ripen](https://github.com/userTrv/ripen): stability channels chosen by users, features promoted on real signals.
