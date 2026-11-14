import 'dart:convert';

String normalizeArabicJeem(String input) {
  return input.replaceAll('\u0669', 'ج');
}

class ClientSession {
  final String pin;
  final String clientName;
  final String projectName;
  final String projectGroup;
  final String participantRole;
  final String persona;

  const ClientSession({
    required this.pin,
    required this.clientName,
    required this.projectName,
    required this.projectGroup,
    required this.participantRole,
    required this.persona,
  });

  factory ClientSession.fromJson(Map<String, dynamic> json) {
    return ClientSession(
      pin: (json['pin'] ?? '').toString(),
      clientName: normalizeArabicJeem((json['clientName'] ?? json['client_name'] ?? '').toString()),
      projectName: normalizeArabicJeem((json['projectName'] ?? json['project_name'] ?? '').toString()),
      projectGroup: normalizeArabicJeem((json['projectGroup'] ?? json['project_group'] ?? '').toString()),
      participantRole: normalizeArabicJeem((json['participantRole'] ?? json['participant_role'] ?? '').toString()),
      persona: (json['persona'] ?? 'adaptive_smart').toString(),
    );
  }
}

class ChatMessage {
  final dynamic id;
  final String sender;
  final String content;
  final String? mediaUrl;
  final String? mediaType;
  final String? audioDuration;
  final List<String> choices;
  final bool isInternal;
  final String createdAt;

  const ChatMessage({
    required this.id,
    required this.sender,
    required this.content,
    this.mediaUrl,
    this.mediaType,
    this.audioDuration,
    this.choices = const [],
    this.isInternal = false,
    required this.createdAt,
  });

  bool get isAudio {
    if (mediaType == 'audio') return true;
    final url = (mediaUrl ?? '').toLowerCase();
    return url.endsWith('.aac') ||
        url.endsWith('.m4a') ||
        url.endsWith('.mp3') ||
        url.endsWith('.wav') ||
        url.endsWith('.ogg') ||
        url.endsWith('.webm');
  }

  bool get isPdf {
    if (mediaType == 'pdf') return true;
    return (mediaUrl ?? '').toLowerCase().endsWith('.pdf');
  }

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    Map<String, dynamic> meta = {};
    final rawMeta = json['metadata'];
    if (rawMeta is Map<String, dynamic>) {
      meta = rawMeta;
    } else if (rawMeta is String && rawMeta.isNotEmpty) {
      try {
        final decoded = jsonDecode(rawMeta);
        if (decoded is Map<String, dynamic>) meta = decoded;
      } catch (_) {}
    }

    final rawChoices = meta['choices'];
    final List<String> parsedChoices = rawChoices is List
        ? rawChoices.map((e) => normalizeArabicJeem(e.toString())).toList()
        : <String>[];

    return ChatMessage(
      id: json['id'],
      sender: (json['sender'] ?? 'ai').toString(),
      content: normalizeArabicJeem((json['content'] ?? '').toString()),
      mediaUrl: json['media_url']?.toString(),
      mediaType: meta['mediaType']?.toString(),
      audioDuration: meta['audioDuration']?.toString(),
      choices: parsedChoices,
      isInternal: json['is_internal'] == true || json['is_internal'] == 1,
      createdAt: (json['created_at'] ?? '').toString(),
    );
  }
}
