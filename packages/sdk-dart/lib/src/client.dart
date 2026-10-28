import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'models.dart';
import 'transport.dart';

/// Where to keep the generated subscriber id between app launches.
/// In Flutter, back it with shared_preferences or secure storage.
abstract interface class RipenStorage {
  FutureOr<String?> read(String key);
  FutureOr<void> write(String key, String value);
}

/// Keeps the id for the lifetime of the process only.
class MemoryStorage implements RipenStorage {
  final Map<String, String> _values = {};

  @override
  String? read(String key) => _values[key];

  @override
  void write(String key, String value) => _values[key] = value;
}

/// Ripen client. Mirrors the JavaScript SDK (@ripen/sdk).
///
/// ```dart
/// final ripen = Ripen(url: Uri.parse('https://ripen.example.com'), clientKey: key);
/// await ripen.start();
/// if (ripen.isEnabled('new-editor')) showNewEditor();
/// ```
class Ripen {
  Ripen({
    required Uri url,
    required this.clientKey,
    String? subscriberId,
    RipenStorage? storage,
    RipenTransport? transport,
    this.appVersion,
    this.offlineQueue = true,
  })  : _base = url,
        _fixedId = subscriberId,
        _storage = storage ?? MemoryStorage(),
        _ownsTransport = transport == null,
        _transport = transport ?? defaultTransport() ?? (throw ArgumentError('no default HTTP transport on this platform; pass `transport`'));

  static const storageKey = 'ripen.subscriberId';
  static const outboxKey = 'ripen.outbox';
  static const _outboxMax = 50;
  static const _outboxMaxAge = Duration(days: 7);

  /// Public by design: it only grants the client API.
  final String clientKey;

  /// Attached to pulses, reports and errors.
  final String? appVersion;

  /// Keep pulses, reports and errors that fail for lack of network in the
  /// storage (up to 50 for 7 days) and send them on the next [start] or [flush].
  /// Call [flush] when your connectivity listener reports the network is back.
  final bool offlineQueue;

  final Uri _base;
  final String? _fixedId;
  final RipenStorage _storage;
  final RipenTransport _transport;
  final bool _ownsTransport;
  final StreamController<Session> _changes = StreamController<Session>.broadcast();
  String? _subscriberId;
  Session? _session;
  Future<void>? _flushing;

  /// The latest session, or null before [start].
  Session? get session => _session;

  /// Emits whenever the session changes (start, channel switch).
  Stream<Session> get changes => _changes.stream;

  Channel? get channel => _session?.channel;

  List<Channel> get channels => _session?.channels ?? const [];

  /// Whether [feature] is enabled for this subscriber; [fallback] before [start] or for unknown features.
  bool isEnabled(String feature, {bool fallback = false}) => _session?.features[feature] ?? fallback;

  /// Loads the session: the subscriber's channel and enabled features.
  /// Then sends anything queued offline, without waiting for it.
  Future<Session> start() async {
    final id = await subscriberId();
    final session = _setSession(await _request('POST', '/v1/client/session', {'subscriberId': id}));
    if (offlineQueue) unawaited(flush());
    return session;
  }

  /// How many pulses, reports and errors wait to be sent.
  Future<int> queued() async => (await _readOutbox()).length;

  /// Sends what was queued offline, oldest first. Stops at the first network
  /// failure; drops items the server rejects, since they would be rejected again.
  Future<void> flush() => _flushing ??= _flush().whenComplete(() => _flushing = null);

  Future<void> _flush() async {
    while (true) {
      final outbox = await _readOutbox();
      if (outbox.isEmpty) return;
      final item = outbox.first;
      try {
        await _request('POST', item['path']! as String, (item['body']! as Map).cast<String, Object?>());
      } on RipenNetworkException {
        return;
      } on RipenException catch (e) {
        if (e.status >= 500) return;
      }
      final rest = await _readOutbox();
      rest.removeWhere((i) => i['at'] == item['at'] && i['path'] == item['path']);
      await _writeOutbox(rest);
    }
  }

  /// Switches channel. Telemetry channels need [consent], asked from the user explicitly.
  Future<Session> setChannel(String channelId, {bool consent = false}) async {
    final id = Uri.encodeComponent(await subscriberId());
    return _setSession(await _request('PUT', '/v1/client/subscribers/$id/channel', {'channel': channelId, 'consent': consent}));
  }

  /// One-tap signal: everything works ([ok] true) or something broke, optionally about one [feature].
  Future<void> pulse({required bool ok, String? feature}) async {
    await _send('/v1/client/pulses', {
      'subscriberId': await subscriberId(),
      'status': ok ? 'ok' : 'broken',
      if (feature != null) 'feature': feature,
      if (appVersion != null) 'appVersion': appVersion,
    });
  }

  /// A written report. Keep personal data out of [message] and [context].
  /// Returns the report id, or null when it was queued to send once online.
  Future<int?> report(String message, {String? feature, Map<String, Object?>? context}) async {
    final result = await _send('/v1/client/reports', {
      'subscriberId': await subscriberId(),
      'message': message,
      if (feature != null) 'feature': feature,
      if (context != null) 'context': context,
      if (appVersion != null) 'appVersion': appVersion,
    });
    return result == null ? null : (result['id']! as num).toInt();
  }

  /// Sends an error if the subscriber consented; otherwise does nothing.
  /// In Flutter, call it from FlutterError.onError and PlatformDispatcher.onError.
  Future<void> captureError(Object error, [StackTrace? stack, String? feature]) async {
    if (_session?.consent != true) return;
    final described = describeError(error, stack);
    await _send('/v1/client/errors', {
      'subscriberId': await subscriberId(),
      'fingerprint': described.fingerprint,
      'message': described.message,
      if (feature != null) 'feature': feature,
      if (appVersion != null) 'appVersion': appVersion,
    });
  }

  /// The id given to the constructor, or a stored or newly generated random one.
  Future<String> subscriberId() async {
    if (_subscriberId != null) return _subscriberId!;
    final stored = _fixedId ?? await _storage.read(storageKey);
    if (stored != null && stored.isNotEmpty) return _subscriberId = stored;
    final generated = _randomId();
    await _storage.write(storageKey, generated);
    return _subscriberId = generated;
  }

  /// Closes the change stream and, unless you passed your own transport, its connections.
  Future<void> close() async {
    if (_ownsTransport) _transport.close();
    await _changes.close();
  }

  Session _setSession(Map<String, Object?>? json) {
    final session = Session.fromJson(json!);
    _session = session;
    _changes.add(session);
    return session;
  }

  /// Posts an event; without network, queues it and returns null (unless the queue is off).
  Future<Map<String, Object?>?> _send(String path, Map<String, Object?> body) async {
    try {
      return await _request('POST', path, body);
    } on RipenNetworkException {
      if (!offlineQueue) rethrow;
      final outbox = await _readOutbox();
      final now = DateTime.now().millisecondsSinceEpoch;
      // Distinct timestamps keep items apart when removing them after sending.
      final last = outbox.isEmpty ? 0 : outbox.last['at']! as int;
      outbox.add({'path': path, 'body': body, 'at': max(now, last + 1)});
      await _writeOutbox(outbox.length > _outboxMax ? outbox.sublist(outbox.length - _outboxMax) : outbox);
      return null;
    }
  }

  Future<List<Map<String, Object?>>> _readOutbox() async {
    final fresh = DateTime.now().subtract(_outboxMaxAge).millisecondsSinceEpoch;
    try {
      final raw = await _storage.read(outboxKey);
      if (raw == null || raw.isEmpty) return [];
      return (jsonDecode(raw) as List)
          .whereType<Map<String, Object?>>()
          .where((i) => i['path'] is String && i['body'] is Map && i['at'] is int && (i['at']! as int) >= fresh)
          .toList();
    } on FormatException {
      return [];
    }
  }

  Future<void> _writeOutbox(List<Map<String, Object?>> items) => Future.value(_storage.write(outboxKey, jsonEncode(items)));

  Future<Map<String, Object?>?> _request(String method, String path, Map<String, Object?> body) async {
    final url = _base.replace(path: '${_base.path.replaceAll(RegExp(r'/+$'), '')}$path');
    final TransportResponse response;
    try {
      response = await _transport.send(
        method,
        url,
        {'Authorization': 'Bearer $clientKey', 'Content-Type': 'application/json'},
        jsonEncode(body),
      );
    } catch (error) {
      throw RipenNetworkException('$error');
    }
    if (response.status == 204 || response.body.isEmpty) {
      if (response.status >= 400) throw RipenException(response.status, 'http_error', 'HTTP ${response.status}');
      return null;
    }
    final Object? data;
    try {
      data = jsonDecode(response.body);
    } on FormatException {
      throw RipenException(response.status, 'bad_response', 'the server did not answer with JSON');
    }
    if (response.status >= 400) {
      final map = data is Map<String, Object?> ? data : const <String, Object?>{};
      throw RipenException(response.status, map['error'] as String? ?? 'http_error', map['message'] as String? ?? 'HTTP ${response.status}');
    }
    return data as Map<String, Object?>;
  }
}

/// Same grouping rule as the JavaScript SDK: type, message and first stack frame.
({String message, String fingerprint}) describeError(Object error, StackTrace? stack) {
  final type = error.runtimeType.toString();
  final text = error.toString();
  final message = text.length > 1000 ? text.substring(0, 1000) : text;
  final frame = stack?.toString().split('\n').firstWhere((line) => line.trim().isNotEmpty, orElse: () => '').trim() ?? '';
  return (message: message, fingerprint: _fnv1a('$type|$text|$frame'));
}

String _fnv1a(String input) {
  var hash = 0x811c9dc5;
  for (final unit in input.codeUnits) {
    hash ^= unit;
    hash = (hash * 0x01000193) & 0xffffffff;
  }
  return hash.toRadixString(16).padLeft(8, '0');
}

String _randomId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // UUID v4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
