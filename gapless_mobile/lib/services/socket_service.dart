import 'package:socket_io_client/socket_io_client.dart' as io;
import '../models/chat_models.dart';

class SocketService {
  io.Socket? _socket;

  void connect({
    required String baseUrl,
    required String token,
    required void Function(bool connected) onConnectionChanged,
    required void Function(ChatMessage msg) onMessage,
    required void Function(bool isTyping) onTyping,
    required void Function(List<ChatMessage> messages) onReset,
    required void Function(String reason) onRevoked,
  }) {
    disconnect();

    final cleanUrl = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    _socket = io.io(
      cleanUrl,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .enableAutoConnect()
          .enableReconnection()
          .build(),
    );

    _socket!.onConnect((_) {
      onConnectionChanged(true);
      _socket!.emit('client:join', {'token': token});
    });

    _socket!.onDisconnect((_) {
      onConnectionChanged(false);
    });

    _socket!.onConnectError((_) {
      onConnectionChanged(false);
    });

    _socket!.on('chat:message', (data) {
      if (data is Map) {
        onMessage(ChatMessage.fromJson(Map<String, dynamic>.from(data)));
      }
    });

    _socket!.on('chat:typing', (data) {
      if (data is Map) {
        onTyping(data['isTyping'] == true);
      }
    });

    _socket!.on('chat:reset', (data) {
      if (data is Map && data['messages'] is List) {
        final msgs = (data['messages'] as List)
            .whereType<Map>()
            .map((e) => ChatMessage.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        onReset(msgs);
      }
    });

    _socket!.on('session:revoked', (data) {
      final msg = data is Map ? (data['message'] ?? 'تم إيقاف الجلسة').toString() : 'تم إيقاف الجلسة';
      onRevoked(normalizeArabicJeem(msg));
    });
  }

  void emitTyping(bool isTyping) {
    _socket?.emit('client:typing', {'isTyping': isTyping});
  }

  void disconnect() {
    if (_socket != null) {
      _socket!.dispose();
      _socket = null;
    }
  }
}
