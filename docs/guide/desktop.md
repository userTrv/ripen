# Desktop apps: Electron and Tauri

Ripen works inside one build: the same binary asks the server which features are on for this person. That needs nothing desktop-specific, and it is the recommended setup, because a person who moves to a calmer channel gets fewer new features right away, without a reinstall.

Some teams also ship separate builds (beta and stable) through their auto-updater. This guide covers both: features inside the app, and, optionally, an update channel that follows the person's Ripen channel.

## Features inside the app

Use `@ripen/sdk` in the renderer, exactly as on the web ([Web SDK and components](web.md)):

```ts
import { createRipen } from '@ripen/sdk';

const ripen = createRipen({ url: 'https://ripen.example.com', clientKey, appVersion: APP_VERSION });
await ripen.start();
if (ripen.isEnabled('new-editor')) mountNewEditor();
```

- The subscriber id is kept in `localStorage`, which Electron and Tauri persist per app.
- Allow the app's origin in `RIPEN_CORS_ORIGINS`: `app://-` or `file://` for Electron, `tauri://localhost` (macOS, Linux) and `http://tauri.localhost` (Windows) for Tauri, or whatever your app uses.
- In a strict Content Security Policy, add the server to `connect-src`.
- `ripen.captureUncaughtErrors()` reports renderer errors. For the Electron main process, use the SDK there too (it runs on Node.js) and pass its errors with `captureError`.

`<ripen-channel-picker>` and `<ripen-feedback>` work in both, so the settings screen can be the same as on the web.

## Optional: an update channel per Ripen channel

Map Ripen channels to the update channels you publish. A simple, safe mapping: the earliest channel gets prereleases, every other channel gets stable builds.

```ts
// Which build line each Ripen channel follows.
const UPDATE_CHANNEL: Record<string, 'beta' | 'latest'> = { early: 'beta', regular: 'latest', calm: 'latest' };

function updateChannel(ripen: Ripen): 'beta' | 'latest' {
  return UPDATE_CHANNEL[ripen.channel?.id ?? ''] ?? 'latest';
}
```

Keep two rules:

1. **Never downgrade automatically.** When someone leaves the early channel they keep the build they have until the stable line catches up. Features in that build are still switched by Ripen, so new ones stop reaching them at once.
2. **The prerelease build still asks Ripen.** A beta binary contains features at every stage; Ripen decides which of them are on.

### Electron with electron-updater

`electron-updater` supports channels through `autoUpdater.channel`: publish prereleases with a `-beta` version suffix (for example `2.5.0-beta.1`) and electron-builder writes a `beta.yml` feed next to `latest.yml`. In the main process:

```ts
import { autoUpdater } from 'electron-updater';

export function applyUpdateChannel(channel: 'beta' | 'latest') {
  autoUpdater.channel = channel;
  // Setting channel turns on allowDowngrade; turn it off again so leaving "early" keeps the current build.
  autoUpdater.allowDowngrade = false;
  void autoUpdater.checkForUpdatesAndNotify();
}
```

Send the channel from the renderer after `ripen.start()` and in `ripen.onChange()` (through your preload bridge), so a change in the channel picker takes effect on the next check.

### Tauri with the updater plugin

The Tauri updater asks your endpoints for a JSON manifest. Let the endpoint choose the build line by a header you pass when checking:

```ts
import { check } from '@tauri-apps/plugin-updater';

const update = await check({ headers: { 'X-Update-Channel': updateChannel(ripen) } });
if (update) await update.downloadAndInstall();
```

The update server returns the beta manifest for `X-Update-Channel: beta` and the stable one otherwise. A static host can do the same with two endpoint URLs, configured from Rust with `app.updater_builder().endpoints(...)` before checking. Tauri does not install a lower version than the current one by default, which follows rule 1.

### Other updaters

Sparkle (appcast per channel), Squirrel.Windows and MSIX follow the same pattern: read the channel from the Ripen session, pick the feed, never downgrade. Ripen does not ship adapters for them: the mapping is a few lines of code that belongs to your app.

## Signals from desktop apps

- Send `appVersion` with every event, so reports and errors from beta builds are easy to tell apart in the console.
- A pulse prompt fits naturally after an update: "Version 2.5 is installed. Is everything working?" with `<ripen-feedback>`.
- Desktop apps are often offline. The SDK keeps pulses, reports and errors sent without network and sends them on the next start or when the connection returns ([Offline](web.md#offline)); wrap `start()` in a `try` and fall back to `isEnabled(key, fallback)`.
