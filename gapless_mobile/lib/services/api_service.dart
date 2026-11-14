import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../models/chat_models.dart';

class PinVerifyResult {
  final bool ok;
  final String? token;
  final ClientSession? session;
  final List<ChatMessage> messages;
  final String? error;
  final bool isLocked;
  final int? lockoutUntil;

  const PinVerifyResult({
    required this.ok,
    this.token,
    this.session,
    this.messages = const [],
    this.error,
    this.isLocked = false,
    this.lockoutUntil,
  });
}

class ApiService {
  String baseUrl;

  ApiService({required this.baseUrl});

  String normalizeBaseUrl(String raw) {
    var trimmed = raw.trim();
    if (trimmed.isEmpty) return 'http://192.168.1.7:1048';
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      trimmed = 'http://$trimmed';
    }
    return trimmed.endsWith('/') ? trimmed.substring(0, trimmed.length - 1) : trimmed;
  }

  String resolveMediaUrl(String? pathOrUrl) {
    if (pathOrUrl == null || pathOrUrl.isEmpty) return '';
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl;
    }
    final cleanBase = normalizeBaseUrl(baseUrl);
    final cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : '/$pathOrUrl';
    return '$cleanBase$cleanPath';
  }

  Future<Map<String, dynamic>> checkHealth() async {
    final uri = Uri.parse('${normalizeBaseUrl(baseUrl)}/api/health');
    final res = await http.get(uri).timeout(const Duration(seconds: 6));
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getLockoutStatus() async {
    final uri = Uri.parse('${normalizeBaseUrl(baseUrl)}/api/client/lockout-status');
    final res = await http.get(uri).timeout(const Duration(seconds: 8));
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<PinVerifyResult> verifyPin(String pin) async {
    final uri = Uri.parse('${normalizeBaseUrl(baseUrl)}/api/client/verify-pin');
    final res = await http
        .post(
          uri,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'pin': pin}),
        )
        .timeout(const Duration(seconds: 12));

    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 200 && res.statusCode < 300) {
      final rawMsgs = (data['messages'] as List?) ?? [];
      return PinVerifyResult(
        ok: true,
        token: data['token']?.toString(),
        session: ClientSession.fromJson(data['session'] as Map<String, dynamic>),
        messages: rawMsgs.map((m) => ChatMessage.fromJson(m as Map<String, dynamic>)).toList(),
      );
    }

    return PinVerifyResult(
      ok: false,
      error: normalizeArabicJeem((data['error'] ?? 'رمز غير صحيح').toString()),
      isLocked: data['isLocked'] == true,
      lockoutUntil: data['lockoutUntil'] is int ? data['lockoutUntil'] as int : null,
    );
  }

  Future<PinVerifyResult?> restoreSession(String token) async {
    final uri = Uri.parse('${normalizeBaseUrl(baseUrl)}/api/client/session');
    final res = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(const Duration(seconds: 8));

    if (res.statusCode != 200) return null;
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final rawMsgs = (data['messages'] as List?) ?? [];
    return PinVerifyResult(
      ok: true,
      token: token,
      session: ClientSession.fromJson(data['session'] as Map<String, dynamic>),
      messages: rawMsgs.map((m) => ChatMessage.fromJson(m as Map<String, dynamic>)).toList(),
    );
  }

  Future<void> logout() async {
    try {
      final uri = Uri.parse('${normalizeBaseUrl(baseUrl)}/api/client/logout');
      await http.post(uri).timeout(const Duration(seconds: 5));
    } catch (_) {}
  }

  Future<({ChatMessage? clientMessage, ChatMessage? aiMessage, String? error})> sendMessage({
    required String token,
    required String content,
    File? mediaFile,
    String? audioDuration,
  }) async {
    final uri = Uri.parse('${normalizeBaseUrl(baseUrl)}/api/client/message');
    final req = http.MultipartRequest('POST', uri);
    req.headers['Authorization'] = 'Bearer $token';
    req.fields['content'] = normalizeArabicJeem(content);
    if (audioDuration != null && audioDuration.isNotEmpty) {
      req.fields['audio_duration'] = audioDuration;
    }
    if (mediaFile != null) {
      req.files.add(await http.MultipartFile.fromPath('media', mediaFile.path));
    }

    final streamed = await req.send().timeout(const Duration(seconds: 95));
    final body = await streamed.stream.bytesToString();
    final data = jsonDecode(body) as Map<String, dynamic>;

    if (streamed.statusCode >= 200 && streamed.statusCode < 300) {
      return (
        clientMessage: data['clientMessage'] != null
            ? ChatMessage.fromJson(data['clientMessage'] as Map<String, dynamic>)
            : null,
        aiMessage: data['aiMessage'] != null
            ? ChatMessage.fromJson(data['aiMessage'] as Map<String, dynamic>)
            : null,
        error: null,
      );
    }

    return (
      clientMessage: null,
      aiMessage: null,
      error: normalizeArabicJeem((data['error'] ?? 'تعذر إرسال الرسالة').toString()),
    );
  }
}
