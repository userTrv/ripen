import 'dart:convert';
import 'dart:io';

import 'transport.dart';

RipenTransport? createDefaultTransport() => IoTransport();

/// HTTP over dart:io with a request timeout.
class IoTransport extends RipenTransport {
  IoTransport({this.timeout = const Duration(seconds: 10)});

  final Duration timeout;
  final HttpClient _client = HttpClient();

  @override
  Future<TransportResponse> send(String method, Uri url, Map<String, String> headers, String body) async {
    final request = await _client.openUrl(method, url).timeout(timeout);
    headers.forEach(request.headers.set);
    if (body.isNotEmpty) request.add(utf8.encode(body));
    final response = await request.close().timeout(timeout);
    final text = await response.transform(utf8.decoder).join().timeout(timeout);
    return TransportResponse(response.statusCode, text);
  }

  @override
  void close() => _client.close();
}
