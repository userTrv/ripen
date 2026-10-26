# Web SDK and components

Two packages for browsers (the SDK also runs in Node.js 20+). Neither has dependencies.

## `@ripen/sdk`

```ts
import { createRipen } from '@ripen/sdk';

const ripen = createRipen({
  url: 'https://ripen.example.com',
  clientKey: 'public client key',
  appVersion: '2.4.0',          // attached to pulses, reports and errors
  // subscriberId: hashedUserId, // optional; otherwise a random UUID kept in localStorage
});
```

| Member | What it does |
|---|---|
| `await ripen.start()` | Loads the session: channel, channels, enabled features. Call on app start |
| `ripen.isEnabled(key, fallback = false)` | Whether a feature is on for this person; `fallback` before `start()` or for unknown keys |
| `ripen.session`, `ripen.channel`, `ripen.channels` | The current session, the person's channel, all channels with their contracts |
| `await ripen.setChannel(id, { consent })` | Switches channel. Telemetry channels need `consent: true`, otherwise `RipenError` with `code: 'consent_required'` |
| `await ripen.pulse('ok' \| 'broken', { feature? })` | One-tap check-in, about the app or one feature |
| `await ripen.report(message, { feature?, context? })` | Written report; returns `{ id }`. Keep personal data out of `context` |
| `await ripen.captureError(error, { feature? })` | Sends an error if the person consented, otherwise does nothing |
| `ripen.captureUncaughtErrors()` | Reports uncaught errors and unhandled rejections; returns a function that stops it |
| `ripen.onChange(listener)` | Called after every session change; returns an unsubscribe function |

Errors from the server are thrown as `RipenError` with `status`, `code` and a readable `message`.

### Choosing the subscriber id

The id identifies a person or an installation; Ripen never needs to know who it is. Pass your own (`subscriberId`) when a person uses several devices, e.g. an HMAC of your user id. Do not pass emails or other personal data. Without it, the SDK generates a random UUID and keeps it in `localStorage` (in memory when storage is blocked).

## `@ripen/elements`

```ts
import { defineRipenElements, RU } from '@ripen/elements';

defineRipenElements();                       // registers both elements; safe to call twice
const picker = document.querySelector('ripen-channel-picker')!;
picker.ripen = ripen;                         // starts the session if needed
picker.texts = RU;                            // English by default; any string can be overridden
```

### `<ripen-channel-picker>`

Lists channels with what each expects. Channels without obligations apply on click. Channels with telemetry show a consent checkbox, and "Join" stays disabled until it is checked. When a person was moved down for missing check-ins, a notice explains why.

Event: `ripen-channel-change`, `detail: { channel }`.

### `<ripen-feedback feature="optional-key">`

"Everything works" sends an `ok` pulse. "Something broke" sends a `broken` pulse and opens an optional report form. With `feature`, both are about that feature.

Event: `ripen-feedback`, `detail: { status }`.

### Theming

Both elements use Shadow DOM and inherit the page font. Adjust them with CSS custom properties:

| Property | Used for |
|---|---|
| `--ripen-accent`, `--ripen-on-accent` | Primary buttons, selected channel, focus ring |
| `--ripen-border`, `--ripen-radius` | Borders and corner radius |
| `--ripen-muted`, `--ripen-text` | Secondary and main text |

And `::part()` for `title`, `option`, `option-current`, `notice`, `button`, `button-primary`, `button-works`, `button-broken`, `textarea`, `status`.

```css
ripen-channel-picker { --ripen-accent: #0b6e4f; --ripen-radius: 6px; }
ripen-feedback::part(button-broken) { color: #b23a2e; }
```

### Server-side rendering

Importing `@ripen/elements` on the server does not throw: the element classes are created inside `defineRipenElements()`, which you call in the browser.

## Other frameworks

The elements are standard custom elements, so they work in Angular (`CUSTOM_ELEMENTS_SCHEMA`), React 19, Vue, Svelte and plain HTML. Set the `ripen` property from code: it is an object, not an attribute.

If you already use a feature flag service, read features through [OpenFeature](openfeature.md) instead of `isEnabled`.
