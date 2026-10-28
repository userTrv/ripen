// Integration test without package:test: starts the real Ripen server (Node.js)
// and drives it through the Dart client. Run from the repo root with
//   dart run packages/sdk-dart/test/ripen_test.dart
// or `pnpm test:dart`.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:ripen/ripen.dart';
import 'package:ripen/src/transport_io.dart';

const clientKey = 'dart-test-client-key';
const adminToken = 'dart-test-admin-token';

var passed = 0;

void check(bool condition, String message) {
  if (!condition) throw StateError('not ok - $message');
  passed++;
  print('ok - $message');
}

Future<void> main() async {
  final root = Directory.current.path.endsWith('sdk-dart') ? Directory.current.parent.parent.path : Directory.current.path;
  final port = await _freePort();
  final db = '${Directory.systemTemp.createTempSync('ripen-dart-').path}/ripen.db';
  final server = await Process.start(
    'node',
    ['--conditions=ripen-source', '--disable-warning=ExperimentalWarning', 'packages/server/src/main.ts'],
    workingDirectory: root,
    environment: {'RIPEN_CLIENT_KEY': clientKey, 'RIPEN_ADMIN_TOKEN': adminToken, 'RIPEN_DB': db, 'PORT': '$port', 'RIPEN_CONFIG': '/nonexistent'},
  );
  final serverLog = StringBuffer();
  server.stdout.transform(utf8.decoder).listen(serverLog.write);
  server.stderr.transform(utf8.decoder).listen(serverLog.write);
  final base = Uri.parse('http://127.0.0.1:$port');

  try {
    await _waitForServer(base);
    await _run(base);
    print('\n$passed checks passed');
  } catch (error) {
    print('$error\n--- server log ---\n$serverLog');
    exitCode = 1;
  } finally {
    server.kill();
    await server.exitCode.timeout(const Duration(seconds: 8), onTimeout: () {
      server.kill(ProcessSignal.sigkill);
      return -1;
    });
  }
  exit(exitCode);
}

Future<void> _run(Uri base) async {
  // Setup through the admin API: a feature released to the early channel.
  await _admin(base, 'PUT', '/v1/admin/features/new-editor', {'description': 'Rewritten editor'});
  await _admin(base, 'PUT', '/v1/admin/features/later', {});
  await _admin(base, 'POST', '/v1/admin/features/new-editor/promote', {'actor': 'dart-test'});

  final storage = MemoryStorage();
  final ripen = Ripen(url: base, clientKey: clientKey, storage: storage, appVersion: '1.0.0+3');

  check(ripen.isEnabled('new-editor', fallback: true), 'fallback is used before start');
  final changes = <Session>[];
  ripen.changes.listen(changes.add);

  final session = await ripen.start();
  final id = await ripen.subscriberId();
  check(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').hasMatch(id), 'a random UUID v4 subscriber id is generated');
  check(storage.read(Ripen.storageKey) == id, 'the id is kept in storage');
  check(session.channelId == 'regular' && ripen.channel?.name == 'Regular', 'new subscribers start in the default channel');
  check(ripen.channels.map((c) => c.id).join(',') == 'early,regular,calm', 'channels are listed in order');
  check(ripen.channels.first.requiresConsent && ripen.channels.first.contract?.pulseEveryDays == 14, 'the early contract is parsed');
  check(!ripen.isEnabled('new-editor') && !ripen.isEnabled('later'), 'regular does not have early features');

  try {
    await ripen.setChannel('early');
    check(false, 'joining early without consent must fail');
  } on RipenException catch (e) {
    check(e.status == 400 && e.code == 'consent_required', 'joining early without consent is refused');
  }

  await ripen.setChannel('early', consent: true);
  check(ripen.isEnabled('new-editor') && ripen.session!.consent, 'early with consent has the feature');
  await Future<void>.delayed(Duration.zero);
  check(changes.length == 2, 'changes stream emits on start and on channel switch');

  await ripen.pulse(ok: false, feature: 'new-editor');
  await ripen.pulse(ok: true);
  final reportId = await ripen.report('Undo loses the last word', feature: 'new-editor', context: {'screen': 'editor'});
  check(reportId != null && reportId > 0, 'report returns its id');
  try {
    throw StateError('editor state lost');
  } catch (error, stack) {
    await ripen.captureError(error, stack, 'new-editor');
  }

  final health = await _admin(base, 'GET', '/v1/admin/features/new-editor/health');
  final h = health['health'] as Map<String, Object?>;
  check(h['pulsesOk'] == 1 && h['pulsesBroken'] == 1, 'pulses reach the server');
  check((h['errorRateWith'] as num) > 0, 'the error reaches the server');
  final reports = health['recentReports'] as List<Object?>;
  check((reports.first as Map<String, Object?>)['message'] == 'Undo loses the last word', 'the report reaches the server');

  // A second client with the same storage is the same subscriber.
  final again = Ripen(url: base, clientKey: clientKey, storage: storage);
  check((await again.start()).channelId == 'early', 'a restarted app keeps its subscriber and channel');
  await again.close();

  final wrong = Ripen(url: base, clientKey: 'wrong', subscriberId: 'x');
  try {
    await wrong.start();
    check(false, 'a wrong key must fail');
  } on RipenException catch (e) {
    check(e.status == 401, 'a wrong client key is refused');
  }
  await wrong.close();

  // Offline: events are queued in storage and sent once the network is back.
  final switchable = _SwitchableTransport();
  final offline = Ripen(url: base, clientKey: clientKey, storage: MemoryStorage(), transport: switchable);
  await offline.start();
  await offline.setChannel('early', consent: true);
  switchable.online = false;
  await offline.pulse(ok: true, feature: 'new-editor');
  check(await offline.report('Written on a plane', feature: 'new-editor') == null, 'a report without network is queued');
  check(await offline.queued() == 2, 'two events wait in the queue');
  try {
    await offline.start();
    check(false, 'loading the session without network must fail');
  } on RipenNetworkException {
    check(true, 'loading the session without network fails with RipenNetworkException');
  }
  switchable.online = true;
  await offline.flush();
  check(await offline.queued() == 0, 'the queue is sent once online');
  final after = await _admin(base, 'GET', '/v1/admin/features/new-editor/health');
  final afterHealth = after['health'] as Map<String, Object?>;
  final afterReports = (after['recentReports'] as List).cast<Map<String, Object?>>();
  check(afterHealth['pulsesOk'] == 2 && afterReports.any((r) => r['message'] == 'Written on a plane'), 'queued events reach the server');
  await offline.close();
  switchable.inner.close();

  await ripen.close();
}

/// Real HTTP that can be switched off, as a phone in flight mode.
class _SwitchableTransport extends RipenTransport {
  final inner = IoTransport();
  bool online = true;

  @override
  Future<TransportResponse> send(String method, Uri url, Map<String, String> headers, String body) {
    if (!online) throw const SocketException('network is unreachable');
    return inner.send(method, url, headers, body);
  }
}

Future<Map<String, Object?>> _admin(Uri base, String method, String path, [Map<String, Object?>? body]) async {
  final client = HttpClient();
  try {
    final request = await client.openUrl(method, base.replace(path: path));
    request.headers.set('Authorization', 'Bearer $adminToken');
    request.headers.set('Content-Type', 'application/json');
    if (body != null) request.write(jsonEncode(body));
    final response = await request.close();
    final text = await response.transform(utf8.decoder).join();
    if (response.statusCode >= 400) throw StateError('admin $method $path: ${response.statusCode} $text');
    return text.isEmpty ? {} : jsonDecode(text) as Map<String, Object?>;
  } finally {
    client.close();
  }
}

Future<int> _freePort() async {
  final socket = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  final port = socket.port;
  await socket.close();
  return port;
}

Future<void> _waitForServer(Uri base) async {
  final deadline = DateTime.now().add(const Duration(seconds: 10));
  while (DateTime.now().isBefore(deadline)) {
    try {
      final client = HttpClient();
      final response = await (await client.getUrl(base.replace(path: '/healthz'))).close();
      client.close();
      if (response.statusCode == 200) return;
    } on SocketException {
      // not up yet
    }
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  throw StateError('the server did not start');
}
