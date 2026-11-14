import 'dart:async';
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:share_plus/share_plus.dart';
import '../models/chat_models.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import '../widgets/audio_bubble_player.dart';

class ChatScreen extends StatefulWidget {
  final ApiService apiService;
  final String token;
  final ClientSession session;
  final List<ChatMessage> initialMessages;
  final bool isDarkMode;
  final VoidCallback onToggleTheme;
  final VoidCallback onLogout;

  const ChatScreen({
    super.key,
    required this.apiService,
    required this.token,
    required this.session,
    required this.initialMessages,
    required this.isDarkMode,
    required this.onToggleTheme,
    required this.onLogout,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final SocketService _socketService = SocketService();
  final AudioRecorder _audioRecorder = AudioRecorder();
  final ImagePicker _imagePicker = ImagePicker();
  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  late List<ChatMessage> _messages;
  final Set<dynamic> _messageIds = {};

  bool _isConnected = false;
  bool _isAiTyping = false;
  bool _isSending = false;
  bool _isRecording = false;
  bool _showSearch = false;
  String _searchQuery = '';

  File? _pendingFile;
  String? _pendingFileName;
  bool _pendingIsImage = false;

  Timer? _recTimer;
  int _recSeconds = 0;
  Timer? _typingDebounce;

  @override
  void initState() {
    super.initState();
    _messages = [];
    for (final m in widget.initialMessages) {
      if (!m.isInternal && m.sender != 'dev_note' && _messageIds.add(m.id)) {
        _messages.add(m);
      }
    }

    _socketService.connect(
      baseUrl: widget.apiService.normalizeBaseUrl(widget.apiService.baseUrl),
      token: widget.token,
      onConnectionChanged: (connected) {
        if (mounted) setState(() => _isConnected = connected);
      },
      onMessage: _appendIncomingMessage,
      onTyping: (typing) {
        if (mounted) setState(() => _isAiTyping = typing);
      },
      onReset: (msgs) {
        if (!mounted) return;
        setState(() {
          _messages.clear();
          _messageIds.clear();
          for (final m in msgs) {
            if (!m.isInternal && m.sender != 'dev_note' && _messageIds.add(m.id)) {
              _messages.add(m);
            }
          }
        });
        _scrollToBottom();
      },
      onRevoked: (reason) {
        if (!mounted) return;
        _showSnack(reason, isError: true);
        Future.delayed(const Duration(milliseconds: 900), widget.onLogout);
      },
    );

    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
  }

  @override
  void dispose() {
    _recTimer?.cancel();
    _typingDebounce?.cancel();
    _audioRecorder.dispose();
    _socketService.disconnect();
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _appendIncomingMessage(ChatMessage msg) {
    if (msg.isInternal || msg.sender == 'dev_note') return;
    if (!_messageIds.add(msg.id)) return;
    if (!mounted) return;
    setState(() => _messages.add(msg));
    _scrollToBottom();
  }

  void _scrollToBottom() {
    Future.delayed(const Duration(milliseconds: 120), () {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 240),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _showSnack(String text, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(normalizeArabicJeem(text)),
        backgroundColor: isError ? Theme.of(context).colorScheme.error : null,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _sendPayload({String? overrideText, File? audioFile, String? audioDuration}) async {
    if (_isSending) return;
    final text = normalizeArabicJeem((overrideText ?? _textController.text).trim());
    final file = audioFile ?? _pendingFile;
    if (text.isEmpty && file == null) return;

    setState(() {
      _isSending = true;
      _isAiTyping = true;
    });
    if (overrideText == null && audioFile == null) {
      _textController.clear();
      _clearPendingFile();
    }
    _socketService.emitTyping(false);

    try {
      final res = await widget.apiService.sendMessage(
        token: widget.token,
        content: text,
        mediaFile: file,
        audioDuration: audioDuration,
      );
      if (!mounted) return;
      if (res.error != null) {
        _showSnack(res.error!, isError: true);
      } else {
        if (res.clientMessage != null) _appendIncomingMessage(res.clientMessage!);
        if (res.aiMessage != null) _appendIncomingMessage(res.aiMessage!);
      }
    } catch (_) {
      if (mounted) _showSnack('حدث خطأ أثناء الإرسال للخادم', isError: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSending = false;
          _isAiTyping = false;
        });
      }
    }
  }

  void _clearPendingFile() {
    setState(() {
      _pendingFile = null;
      _pendingFileName = null;
      _pendingIsImage = false;
    });
  }

  Future<void> _showAttachmentSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      builder: (ctx) {
        return SafeArea(
          child: Wrap(
            children: [
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined),
                title: const Text('التقاط صورة بالكاميرا'),
                onTap: () async {
                  Navigator.pop(ctx);
                  final x = await _imagePicker.pickImage(source: ImageSource.camera, imageQuality: 85);
                  if (x != null && mounted) {
                    setState(() {
                      _pendingFile = File(x.path);
                      _pendingFileName = x.name;
                      _pendingIsImage = true;
                    });
                  }
                },
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('اختيار صورة من المعرض'),
                onTap: () async {
                  Navigator.pop(ctx);
                  final x = await _imagePicker.pickImage(source: ImageSource.gallery, imageQuality: 88);
                  if (x != null && mounted) {
                    setState(() {
                      _pendingFile = File(x.path);
                      _pendingFileName = x.name;
                      _pendingIsImage = true;
                    });
                  }
                },
              ),
              ListTile(
                leading: const Icon(Icons.attach_file),
                title: const Text('إرفاق ملف PDF أو ملف صوتي'),
                onTap: () async {
                  Navigator.pop(ctx);
                  final files = await FilePicker.pickFiles(
                    type: FileType.custom,
                    allowedExtensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'm4a', 'aac', 'wav', 'ogg'],
                  );
                  if (files.isNotEmpty && files.first.path != null && mounted) {
                    final f = files.first;
                    final ext = (f.extension ?? '').toLowerCase();
                    setState(() {
                      _pendingFile = File(f.path!);
                      _pendingFileName = f.name;
                      _pendingIsImage = ['png', 'jpg', 'jpeg', 'webp'].contains(ext);
                    });
                  }
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _startVoiceRecording() async {
    if (_isSending || _isRecording) return;
    final permitted = await _audioRecorder.hasPermission();
    if (!permitted) {
      _showSnack('يرجى السماح بصلاحية الميكروفون لتسجيل الرسائل الصوتية', isError: true);
      return;
    }

    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/voice-${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _audioRecorder.start(
      const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 96000, sampleRate: 44100),
      path: path,
    );

    _recTimer?.cancel();
    setState(() {
      _isRecording = true;
      _recSeconds = 0;
    });
    _recTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _recSeconds += 1);
    });
  }

  Future<void> _cancelVoiceRecording() async {
    _recTimer?.cancel();
    final path = await _audioRecorder.stop();
    if (path != null) {
      final f = File(path);
      if (await f.exists()) await f.delete();
    }
    if (mounted) setState(() => _isRecording = false);
  }

  Future<void> _finishAndSendVoiceRecording() async {
    _recTimer?.cancel();
    final durationStr = _formatSec(_recSeconds);
    final path = await _audioRecorder.stop();
    if (mounted) setState(() => _isRecording = false);
    if (path == null) return;
    final file = File(path);
    if (!await file.exists()) return;
    await _sendPayload(overrideText: '', audioFile: file, audioDuration: durationStr);
  }

  String _formatSec(int sec) {
    final m = sec ~/ 60;
    final s = (sec % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  Future<void> _exportTranscript() async {
    if (_messages.isEmpty) {
      _showSnack('لا توجد رسائل لتصديرها بعد', isError: true);
      return;
    }
    final buf = StringBuffer()
      ..writeln('Gapless — سجل جلسة استكشاف المتطلبات')
      ..writeln('المشروع: ${widget.session.projectGroup.isNotEmpty ? widget.session.projectGroup : widget.session.projectName}')
      ..writeln('المشارك: ${widget.session.clientName} (#${widget.session.pin})')
      ..writeln('==================================================');
    for (final m in _messages) {
      final who = m.sender == 'client' ? widget.session.clientName : 'المستشار الذكي';
      buf.writeln('[$who]: ${m.content}${m.mediaUrl != null ? ' (مرفق: ${m.mediaUrl})' : ''}');
    }
    await SharePlus.instance.share(ShareParams(text: buf.toString(), subject: 'Gapless - ${widget.session.projectName}'));
  }

  void _openSessionInfoSheet() {
    final voiceCount = _messages.where((m) => m.isAudio).length;
    final mediaCount = _messages.where((m) => m.mediaUrl != null && !m.isAudio).length;
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('تفاصيل الجلسة', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              Text('المشروع: ${widget.session.projectGroup.isNotEmpty ? widget.session.projectGroup : widget.session.projectName}'),
              Text('المشارك: ${widget.session.clientName} (${widget.session.participantRole}) • #${widget.session.pin}'),
              const SizedBox(height: 8),
              Text('الرسائل: ${_messages.length} • الصوتيات: $voiceCount • المرفقات: $mediaCount'),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () {
                  Navigator.pop(ctx);
                  _exportTranscript();
                },
                icon: const Icon(Icons.share_outlined),
                label: const Text('تصدير ومشاركة سجل المحادثة'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final visibleMessages = _searchQuery.trim().isEmpty
        ? _messages
        : _messages.where((m) => m.content.toLowerCase().contains(_searchQuery.trim().toLowerCase())).toList();

    final hasTextOrFile = _textController.text.trim().isNotEmpty || _pendingFile != null;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 8,
        title: InkWell(
          onTap: _openSessionInfoSheet,
          child: Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _isConnected ? Colors.greenAccent : Colors.redAccent,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.session.projectGroup.isNotEmpty ? widget.session.projectGroup : widget.session.projectName,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      '${widget.session.clientName} • #${widget.session.pin}',
                      style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          IconButton(
            onPressed: () => setState(() {
              _showSearch = !_showSearch;
              if (!_showSearch) _searchQuery = '';
            }),
            icon: Icon(_showSearch ? Icons.close : Icons.search),
            tooltip: 'بحث',
          ),
          IconButton(
            onPressed: widget.onToggleTheme,
            icon: Icon(widget.isDarkMode ? Icons.light_mode_outlined : Icons.dark_mode_outlined),
          ),
          IconButton(
            onPressed: widget.onLogout,
            icon: const Icon(Icons.logout),
            tooltip: 'خروج',
          ),
        ],
      ),
      body: Column(
        children: [
          if (_showSearch)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
              child: TextField(
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: 'ابحث في الرسائل...',
                  prefixIcon: Icon(Icons.search),
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                onChanged: (v) => setState(() => _searchQuery = normalizeArabicJeem(v)),
              ),
            ),
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              itemCount: visibleMessages.length + (_isAiTyping ? 1 : 0),
              itemBuilder: (ctx, index) {
                if (index >= visibleMessages.length) {
                  return Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.only(top: 6),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: cs.surfaceContainerHigh,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: const Text('جاري التحليل وصياغة الرد...', style: TextStyle(fontSize: 13)),
                    ),
                  );
                }

                final msg = visibleMessages[index];
                final isClient = msg.sender == 'client';
                final resolvedMedia = widget.apiService.resolveMediaUrl(msg.mediaUrl);

                return Align(
                  alignment: isClient ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
                    margin: const EdgeInsets.symmetric(vertical: 5),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: isClient ? cs.primary : cs.surfaceContainerHigh,
                      borderRadius: BorderRadius.only(
                        topLeft: const Radius.circular(16),
                        topRight: const Radius.circular(16),
                        bottomLeft: Radius.circular(isClient ? 16 : 4),
                        bottomRight: Radius.circular(isClient ? 4 : 16),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (msg.mediaUrl != null && msg.mediaUrl!.isNotEmpty) ...[
                          if (msg.isAudio)
                            AudioBubblePlayer(
                              audioUrl: resolvedMedia,
                              durationLabel: msg.audioDuration,
                              isClient: isClient,
                            )
                          else if (msg.isPdf)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.picture_as_pdf, color: isClient ? Colors.white : cs.primary),
                                  const SizedBox(width: 6),
                                  Text('ملف PDF مرفق', style: TextStyle(color: isClient ? Colors.white : cs.onSurface)),
                                ],
                              ),
                            )
                          else
                            GestureDetector(
                              onTap: () {
                                showDialog<void>(
                                  context: context,
                                  builder: (_) => Dialog(
                                    child: InteractiveViewer(child: Image.network(resolvedMedia)),
                                  ),
                                );
                              },
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: Image.network(
                                  resolvedMedia,
                                  height: 180,
                                  width: 240,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, _, _) => const Text('تعذر تحميل الصورة'),
                                ),
                              ),
                            ),
                        ],
                        if (msg.content.isNotEmpty)
                          SelectableText(
                            msg.content,
                            style: TextStyle(
                              fontSize: 14.5,
                              height: 1.45,
                              color: isClient ? Colors.white : cs.onSurface,
                            ),
                          ),
                        if (!isClient && msg.choices.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: msg.choices.map((choice) {
                              return ActionChip(
                                label: Text(choice, style: const TextStyle(fontSize: 12.5)),
                                onPressed: _isSending
                                    ? null
                                    : () {
                                        if (choice.endsWith('...')) {
                                          _textController.text = '${choice.replaceAll(RegExp(r'\.+$'), '')}: ';
                                        } else {
                                          _sendPayload(overrideText: choice);
                                        }
                                      },
                              );
                            }).toList(),
                          ),
                        ],
                        if (!isClient && msg.content.isNotEmpty)
                          Align(
                            alignment: Alignment.centerLeft,
                            child: InkWell(
                              onTap: () async {
                                await Clipboard.setData(ClipboardData(text: msg.content));
                                _showSnack('تم نسخ الرد');
                              },
                              child: Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.copy_outlined, size: 13, color: cs.onSurfaceVariant),
                                    const SizedBox(width: 4),
                                    Text('نسخ', style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
                                  ],
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          if (_pendingFile != null)
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: cs.primaryContainer.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: cs.primary),
              ),
              child: Row(
                children: [
                  if (_pendingIsImage)
                    ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: Image.file(_pendingFile!, width: 38, height: 38, fit: BoxFit.cover),
                    )
                  else
                    Icon(Icons.attach_file, color: cs.primary),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(_pendingFileName ?? 'مرفق', overflow: TextOverflow.ellipsis),
                  ),
                  IconButton(
                    onPressed: _clearPendingFile,
                    icon: const Icon(Icons.close, color: Colors.redAccent),
                  ),
                ],
              ),
            ),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
              decoration: BoxDecoration(
                color: cs.surfaceContainerLow,
                border: Border(top: BorderSide(color: cs.outlineVariant.withValues(alpha: 0.5))),
              ),
              child: _isRecording
                  ? Row(
                      children: [
                        IconButton.filledTonal(
                          onPressed: _cancelVoiceRecording,
                          icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                          tooltip: 'إلغاء التسجيل',
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            decoration: BoxDecoration(
                              color: cs.errorContainer.withValues(alpha: 0.3),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: cs.error.withValues(alpha: 0.6)),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.fiber_manual_record, color: Colors.redAccent, size: 14),
                                const SizedBox(width: 8),
                                Text(
                                  _formatSec(_recSeconds),
                                  style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.redAccent),
                                ),
                                const SizedBox(width: 10),
                                const Expanded(
                                  child: Text('جاري تسجيل رسالة صوتية...', overflow: TextOverflow.ellipsis),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          onPressed: _finishAndSendVoiceRecording,
                          icon: const Icon(Icons.send),
                          tooltip: 'إرسال الصوت',
                        ),
                      ],
                    )
                  : Row(
                      children: [
                        IconButton(
                          onPressed: _isSending ? null : _showAttachmentSheet,
                          icon: const Icon(Icons.attach_file),
                          tooltip: 'إرفاق صورة أو ملف',
                        ),
                        Expanded(
                          child: TextField(
                            controller: _textController,
                            minLines: 1,
                            maxLines: 4,
                            decoration: InputDecoration(
                              hintText: 'اكتب رسالتك أو أرسل صوتاً...',
                              filled: true,
                              fillColor: cs.surfaceContainerHighest.withValues(alpha: 0.5),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(20),
                                borderSide: BorderSide.none,
                              ),
                              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            ),
                            onChanged: (v) {
                              final norm = normalizeArabicJeem(v);
                              if (norm != v) {
                                _textController.value = TextEditingValue(
                                  text: norm,
                                  selection: TextSelection.collapsed(offset: norm.length),
                                );
                              }
                              setState(() {});
                              _socketService.emitTyping(norm.trim().isNotEmpty);
                              _typingDebounce?.cancel();
                              _typingDebounce = Timer(const Duration(seconds: 2), () {
                                _socketService.emitTyping(false);
                              });
                            },
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          onPressed: _isSending
                              ? null
                              : (hasTextOrFile ? () => _sendPayload() : _startVoiceRecording),
                          icon: Icon(hasTextOrFile ? Icons.send : Icons.mic),
                          tooltip: hasTextOrFile ? 'إرسال' : 'تسجيل صوتي',
                        ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
