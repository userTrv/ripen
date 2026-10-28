/// Data returned by the Ripen server. Mirrors the session in docs/spec.md.
library;

/// What a channel expects from its subscribers.
class ChannelContract {
  const ChannelContract({this.telemetry = false, this.pulseEveryDays});

  /// Joining requires consent to automatic error collection.
  final bool telemetry;

  /// A pulse is expected at least this often; null means no obligation.
  final int? pulseEveryDays;

  factory ChannelContract.fromJson(Map<String, Object?> json) => ChannelContract(
        telemetry: json['telemetry'] == true,
        pulseEveryDays: (json['pulseEveryDays'] as num?)?.toInt(),
      );
}

/// A level on the scale "new features first ↔ fewer bugs".
class Channel {
  const Channel({required this.id, required this.name, this.description, this.isDefault = false, this.contract});

  final String id;
  final String name;
  final String? description;
  final bool isDefault;
  final ChannelContract? contract;

  bool get requiresConsent => contract?.telemetry ?? false;

  factory Channel.fromJson(Map<String, Object?> json) => Channel(
        id: json['id']! as String,
        name: json['name']! as String,
        description: json['description'] as String?,
        isDefault: json['default'] == true,
        contract: json['contract'] is Map<String, Object?> ? ChannelContract.fromJson(json['contract']! as Map<String, Object?>) : null,
      );
}

/// Set when the subscriber was moved down for not keeping the channel contract.
class Demotion {
  const Demotion({required this.from, required this.reason});

  final String from;
  final String reason;
}

/// The subscriber's channel and which features are enabled for them.
class Session {
  const Session({
    required this.subscriberId,
    required this.channelId,
    required this.consent,
    required this.channels,
    required this.features,
    this.demotion,
  });

  final String subscriberId;
  final String channelId;
  final bool consent;
  final List<Channel> channels;
  final Map<String, bool> features;
  final Demotion? demotion;

  Channel? get channel {
    for (final c in channels) {
      if (c.id == channelId) return c;
    }
    return null;
  }

  factory Session.fromJson(Map<String, Object?> json) {
    final subscriber = json['subscriber']! as Map<String, Object?>;
    final demotion = subscriber['demotion'] as Map<String, Object?>?;
    return Session(
      subscriberId: subscriber['id']! as String,
      channelId: subscriber['channel']! as String,
      consent: subscriber['consent'] == true,
      demotion: demotion == null ? null : Demotion(from: demotion['from']! as String, reason: demotion['reason']! as String),
      channels: (json['channels']! as List<Object?>).map((c) => Channel.fromJson(c! as Map<String, Object?>)).toList(growable: false),
      features: (json['features']! as Map<String, Object?>).map((key, value) => MapEntry(key, value == true)),
    );
  }
}

/// An error answer from the server, e.g. `consent_required`.
class RipenException implements Exception {
  const RipenException(this.status, this.code, this.message);

  final int status;
  final String code;
  final String message;

  @override
  String toString() => 'RipenException($status, $code): $message';
}

/// The request did not reach the server: no network, DNS failure, refused connection or timeout.
class RipenNetworkException implements Exception {
  const RipenNetworkException(this.message);

  final String message;

  @override
  String toString() => 'RipenNetworkException: $message';
}
