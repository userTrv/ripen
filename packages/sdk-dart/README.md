# ripen (Dart and Flutter)

Client for a [Ripen](https://github.com/userTrv/ripen) server: users choose how early they get new features, the app checks which features are enabled for them and sends one-tap feedback.

No dependencies. Uses `dart:io` on mobile, desktop and server; on Flutter web pass your own `RipenTransport`.

## Use

```dart
import 'package:ripen/ripen.dart';

final ripen = Ripen(
  url: Uri.parse('https://ripen.example.com'),
  clientKey: const String.fromEnvironment('RIPEN_CLIENT_KEY'),
  storage: myStorage,          // keeps the generated subscriber id, see below
  appVersion: '2.4.0+31',
);

await ripen.start();

if (ripen.isEnabled('new-editor')) { /* show it */ }

// Settings screen: the user opts in, after agreeing to send errors.
await ripen.setChannel('early', consent: true);

// After an update, ask once.
await ripen.pulse(ok: false, feature: 'new-editor');
await ripen.report('Undo loses the last word', feature: 'new-editor');
```

Without network, `pulse`, `report` and `captureError` keep the event in the storage (up to 50, for 7 days) instead of failing; `report` then returns `null` instead of the id. The queue is sent on the next `start()`, or call `ripen.flush()` when your connectivity listener sees the network come back. `start()` and `setChannel()` throw `RipenNetworkException` without network. Turn the queue off with `offlineQueue: false`.

`ripen.changes` emits a `Session` after `start()` and every channel switch, so a Flutter widget can rebuild with a `StreamBuilder`. `ripen.channels` lists every channel with its contract (`requiresConsent`, `contract.pulseEveryDays`) for a settings screen.

### Errors in Flutter

```dart
FlutterError.onError = (details) {
  FlutterError.presentError(details);
  ripen.captureError(details.exception, details.stack);
};
PlatformDispatcher.instance.onError = (error, stack) {
  ripen.captureError(error, stack);
  return false;
};
```

`captureError` sends nothing unless the subscriber consented.

### Keeping the subscriber id

Implement `RipenStorage` with whatever the app already uses, for example `shared_preferences`:

```dart
class PrefsStorage implements RipenStorage {
  PrefsStorage(this.prefs);
  final SharedPreferences prefs;
  @override
  String? read(String key) => prefs.getString(key);
  @override
  Future<void> write(String key, String value) => prefs.setString(key, value);
}
```

Or pass `subscriberId:` yourself, for example a hash of your user id. Do not use emails or other personal data.

## Test

The integration test starts the real Node.js server and needs no packages:

```bash
pnpm test:dart          # from the repository root, Dart SDK 3.5+ on PATH (or RIPEN_DART=/path/to/dart)
```
