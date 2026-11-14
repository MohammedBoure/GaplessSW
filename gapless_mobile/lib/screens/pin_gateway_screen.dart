import 'dart:async';
import 'package:flutter/material.dart';
import '../models/chat_models.dart';
import '../services/api_service.dart';

class PinGatewayScreen extends StatefulWidget {
  final ApiService apiService;
  final bool isDarkMode;
  final VoidCallback onToggleTheme;
  final Future<void> Function(String newUrl) onUpdateServerUrl;
  final void Function(String token, ClientSession session, List<ChatMessage> messages) onAuthenticated;

  const PinGatewayScreen({
    super.key,
    required this.apiService,
    required this.isDarkMode,
    required this.onToggleTheme,
    required this.onUpdateServerUrl,
    required this.onAuthenticated,
  });

  @override
  State<PinGatewayScreen> createState() => _PinGatewayScreenState();
}

class _PinGatewayScreenState extends State<PinGatewayScreen> {
  final List<String> _digits = [];
  bool _isSubmitting = false;
  bool _isLockedOut = false;
  bool _hasError = false;
  String _feedback = 'أدخل رمز الجلسة المكون من 4 أرقام للمتابعة';
  int _lockRemainingSec = 0;
  Timer? _lockTimer;

  @override
  void initState() {
    super.initState();
    _checkLockoutStatus();
  }

  @override
  void dispose() {
    _lockTimer?.cancel();
    super.dispose();
  }

  Future<void> _checkLockoutStatus() async {
    try {
      final status = await widget.apiService.getLockoutStatus();
      if (!mounted) return;
      if (status['isLocked'] == true && status['lockoutUntil'] is int) {
        _startLockoutTimer(status['lockoutUntil'] as int);
      } else if ((status['failedAttempts'] ?? 0) > 0) {
        final failed = status['failedAttempts'] as int;
        final maxAtt = (status['maxAttempts'] ?? 5) as int;
        setState(() {
          _feedback = 'تنبيه: لديك $failed محاولات خاطئة (متبقي ${maxAtt - failed})';
        });
      }
    } catch (_) {
      // Server may be unreachable until user updates server URL
    }
  }

  void _startLockoutTimer(int lockoutUntilMs) {
    _lockTimer?.cancel();
    setState(() => _isLockedOut = true);

    void tick() {
      final remMs = lockoutUntilMs - DateTime.now().millisecondsSinceEpoch;
      if (!mounted) return;
      if (remMs <= 0) {
        _lockTimer?.cancel();
        setState(() {
          _isLockedOut = false;
          _lockRemainingSec = 0;
          _digits.clear();
          _hasError = false;
          _feedback = 'انتهى الحظر المؤقت. يمكنك المحاولة الآن.';
        });
      } else {
        setState(() {
          _lockRemainingSec = (remMs / 1000).ceil();
        });
      }
    }

    tick();
    _lockTimer = Timer.periodic(const Duration(seconds: 1), (_) => tick());
  }

  Future<void> _submitPin(String pin) async {
    setState(() {
      _isSubmitting = true;
      _hasError = false;
      _feedback = 'جاري التحقق من الرمز...';
    });

    try {
      final res = await widget.apiService.verifyPin(pin);
      if (!mounted) return;

      if (res.ok && res.token != null && res.session != null) {
        widget.onAuthenticated(res.token!, res.session!, res.messages);
        return;
      }

      setState(() {
        _isSubmitting = false;
        _hasError = true;
        _feedback = res.error ?? 'رمز PIN غير صحيح';
      });

      if (res.isLocked && res.lockoutUntil != null) {
        _startLockoutTimer(res.lockoutUntil!);
      } else {
        Future.delayed(const Duration(milliseconds: 500), () {
          if (!mounted) return;
          setState(() {
            _digits.clear();
            _hasError = false;
          });
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _hasError = true;
        _digits.clear();
        _feedback = 'تعذر الاتصال بالخادم (${widget.apiService.baseUrl}). تحقق من الشبكة أو إعدادات الخادم.';
      });
    }
  }

  void _onDigitTap(String d) {
    if (_isLockedOut || _isSubmitting || _digits.length >= 4) return;
    setState(() {
      _digits.add(d);
      _hasError = false;
    });
    if (_digits.length == 4) {
      _submitPin(_digits.join());
    }
  }

  Future<void> _openServerSettingsDialog() async {
    final controller = TextEditingController(text: widget.apiService.baseUrl);
    String? testResult;
    bool testing = false;

    await showDialog<void>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              title: const Text('إعدادات الخادم (Server URL)'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'أدخل عنوان خادم Gapless على شبكتك أو الإنترنت:',
                    style: TextStyle(fontSize: 13),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: controller,
                    textDirection: TextDirection.ltr,
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                      hintText: 'http://192.168.1.7:1048',
                    ),
                  ),
                  if (testResult != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      testResult!,
                      style: TextStyle(
                        fontSize: 12,
                        color: testResult!.startsWith('متصل') ? Colors.green : Colors.redAccent,
                      ),
                    ),
                  ],
                ],
              ),
              actions: [
                TextButton(
                  onPressed: testing
                      ? null
                      : () async {
                          setDialogState(() {
                            testing = true;
                            testResult = null;
                          });
                          final tempApi = ApiService(baseUrl: controller.text);
                          try {
                            await tempApi.checkHealth();
                            setDialogState(() {
                              testing = false;
                              testResult = 'متصل بنجاح بالخادم!';
                            });
                          } catch (e) {
                            setDialogState(() {
                              testing = false;
                              testResult = 'فشل الاتصال: $e';
                            });
                          }
                        },
                  child: Text(testing ? 'جاري الفحص...' : 'فحص الاتصال'),
                ),
                FilledButton(
                  onPressed: () async {
                    await widget.onUpdateServerUrl(controller.text);
                    if (ctx.mounted) Navigator.pop(ctx);
                    _checkLockoutStatus();
                  },
                  child: const Text('حفظ'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  String _formatLockTimer(int sec) {
    final m = (sec ~/ 60).toString().padLeft(2, '0');
    final s = (sec % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final disabled = _isLockedOut || _isSubmitting;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Icon(Icons.verified_user_outlined, size: 18, color: cs.primary),
                      const SizedBox(width: 6),
                      Text('بوابة العميل الآمنة', style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                    ],
                  ),
                  Row(
                    children: [
                      IconButton(
                        onPressed: _openServerSettingsDialog,
                        icon: const Icon(Icons.dns_outlined),
                        tooltip: 'إعدادات الخادم',
                      ),
                      IconButton(
                        onPressed: widget.onToggleTheme,
                        icon: Icon(widget.isDarkMode ? Icons.light_mode_outlined : Icons.dark_mode_outlined),
                        tooltip: 'تبديل المظهر',
                      ),
                    ],
                  ),
                ],
              ),
              const Spacer(),
              Container(
                width: 68,
                height: 68,
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: [cs.primary, cs.secondary]),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(Icons.hub_outlined, color: Colors.white, size: 34),
              ),
              const SizedBox(height: 14),
              const Text('Gapless', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(
                'منصة استكشاف وتحليل متطلبات المشاريع',
                style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
              ),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(4, (idx) {
                  final filled = idx < _digits.length;
                  final active = idx == _digits.length && !_isLockedOut;
                  return Container(
                    width: 54,
                    height: 60,
                    margin: const EdgeInsets.symmetric(horizontal: 6),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: cs.surfaceContainerHighest.withValues(alpha: 0.55),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        width: active ? 2 : 1.2,
                        color: _hasError
                            ? cs.error
                            : active
                                ? cs.primary
                                : cs.outlineVariant,
                      ),
                    ),
                    child: Text(
                      filled ? '•' : '',
                      style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                    ),
                  );
                }),
              ),
              const SizedBox(height: 14),
              if (_isLockedOut)
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: cs.errorContainer.withValues(alpha: 0.35),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: cs.error),
                  ),
                  child: Column(
                    children: [
                      Text('تم قفل المحاولات مؤقتاً', style: TextStyle(color: cs.error, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text(
                        _formatLockTimer(_lockRemainingSec),
                        style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: cs.error),
                      ),
                    ],
                  ),
                )
              else
                Text(
                  _feedback,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    color: _hasError ? cs.error : cs.onSurfaceVariant,
                    fontWeight: _hasError ? FontWeight.w600 : FontWeight.normal,
                  ),
                ),
              const SizedBox(height: 22),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 320),
                child: GridView.count(
                  shrinkWrap: true,
                  crossAxisCount: 3,
                  mainAxisSpacing: 10,
                  crossAxisSpacing: 10,
                  childAspectRatio: 1.45,
                  physics: const NeverScrollableScrollPhysics(),
                  children: [
                    for (final d in ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
                      _buildKeypadBtn(d, disabled ? null : () => _onDigitTap(d), cs),
                    _buildKeypadBtn('مسح', disabled ? null : () => setState(() => _digits.clear()), cs, isAction: true),
                    _buildKeypadBtn('0', disabled ? null : () => _onDigitTap('0'), cs),
                    _buildKeypadIconBtn(
                      Icons.backspace_outlined,
                      disabled
                          ? null
                          : () {
                              if (_digits.isNotEmpty) {
                                setState(() => _digits.removeLast());
                              }
                            },
                      cs,
                    ),
                  ],
                ),
              ),
              const Spacer(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildKeypadBtn(String label, VoidCallback? onTap, ColorScheme cs, {bool isAction = false}) {
    return Material(
      color: isAction ? cs.surfaceContainerHighest.withValues(alpha: 0.4) : cs.surfaceContainerHigh,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              fontSize: isAction ? 14 : 22,
              fontWeight: FontWeight.w700,
              color: onTap == null ? cs.onSurface.withValues(alpha: 0.35) : cs.onSurface,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildKeypadIconBtn(IconData icon, VoidCallback? onTap, ColorScheme cs) {
    return Material(
      color: cs.surfaceContainerHighest.withValues(alpha: 0.4),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Center(
          child: Icon(icon, color: onTap == null ? cs.onSurface.withValues(alpha: 0.35) : cs.onSurface),
        ),
      ),
    );
  }
}
