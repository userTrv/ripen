# @ripen/elements

Web components for a Ripen client: `<ripen-channel-picker>` (choose a channel, with the consent step) and `<ripen-feedback>` (one-tap pulse and an optional report). Shadow DOM, English and Russian texts, themable, no dependencies.

```ts
import { defineRipenElements } from '@ripen/elements';

defineRipenElements();
document.querySelector('ripen-channel-picker').ripen = ripen;
document.querySelector('ripen-feedback').ripen = ripen;
```

Events, theming and texts: [Web SDK and components](https://github.com/userTrv/ripen/blob/main/docs/guide/web.md#ripenelements).

## License

Apache-2.0. Part of [Ripen](https://github.com/userTrv/ripen): stability channels chosen by users, features promoted on real signals.
