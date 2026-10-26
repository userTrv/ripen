/// How the client talks HTTP. The default uses dart:io (mobile, desktop,
/// server). On Flutter web pass your own, e.g. one built on package:http.
library;

import 'transport_stub.dart' if (dart.library.io) 'transport_io.dart' as platform;

class TransportResponse {
  const TransportResponse(this.status, this.body);

  final int status;

  /// Raw response body; empty for 204.
  final String body;
}

abstract class RipenTransport {
  Future<TransportResponse> send(String method, Uri url, Map<String, String> headers, String body);

  /// Releases connections. Called by [Ripen.close] for the default transport.
  void close() {}
}

/// The platform default, or null where none exists (web).
RipenTransport? defaultTransport() => platform.createDefaultTransport();
