// Minimal console example. Run a Ripen server, then:
//   RIPEN_URL=http://127.0.0.1:4747 RIPEN_CLIENT_KEY=... dart example/main.dart
import 'dart:io';

import 'package:ripen/ripen.dart';

Future<void> main() async {
  final ripen = Ripen(
    url: Uri.parse(Platform.environment['RIPEN_URL'] ?? 'http://127.0.0.1:4747'),
    clientKey: Platform.environment['RIPEN_CLIENT_KEY'] ?? '',
    subscriberId: 'example-user',
    appVersion: '1.0.0',
  );

  final session = await ripen.start();
  print('Channel: ${session.channel?.name}');
  for (final channel in ripen.channels) {
    final duty = channel.requiresConsent ? 'sends errors, pulses every ${channel.contract?.pulseEveryDays} days' : 'nothing expected';
    print('  ${channel.id.padRight(10)} $duty');
  }
  print('Features: ${session.features}');

  await ripen.pulse(ok: true);
  await ripen.close();
}
