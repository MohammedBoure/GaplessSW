import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'models/chat_models.dart';
import 'screens/chat_screen.dart';
import 'screens/pin_gateway_screen.dart';
import 'services/api_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const GaplessClientApp());
}

class GaplessClientApp extends StatefulWidget {
  const GaplessClientApp({super.key});

  @override
  State<GaplessClientApp> createState() => _GaplessClientAppState();
}

class _GaplessClientAppState extends State<GaplessClientApp> {
  static const _kServerUrlKey = 'gapless_server_url';
  static const _kTokenKey = 'gapless_client_token';
  static const _kThemeKey = 'gapless_dark_mode';

  late ApiService _apiService;
  bool _isDarkMode = true;
  bool _isBootstrapping = true;
  String? _token;
  ClientSession? _session;
  List<ChatMessage> _initialMessages = [];

  @override
  void initState() {
    super.initState();
    _apiService = ApiService(baseUrl: 'http://192.168.1.7:1048');
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final prefs = await SharedPreferences.getInstance();
    final savedUrl = prefs.getString(_kServerUrlKey);
    final savedDark = prefs.getBool(_kThemeKey);
    final savedToken = prefs.getString(_kTokenKey);

    if (savedUrl != null && savedUrl.isNotEmpty) {
      _apiService = ApiService(baseUrl: savedUrl);
    }
    if (savedDark != null) {
      _isDarkMode = savedDark;
    }

    if (savedToken != null && savedToken.isNotEmpty) {
      try {
        final restored = await _apiService.restoreSession(savedToken);
        if (restored != null && restored.session != null) {
          _token = savedToken;
          _session = restored.session;
          _initialMessages = restored.messages;
        } else {
          await prefs.remove(_kTokenKey);
        }
      } catch (_) {}
    }

    if (mounted) setState(() => _isBootstrapping = false);
  }

  Future<void> _toggleTheme() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() => _isDarkMode = !_isDarkMode);
    await prefs.setBool(_kThemeKey, _isDarkMode);
  }

  Future<void> _updateServerUrl(String rawUrl) async {
    final normalized = _apiService.normalizeBaseUrl(rawUrl);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kServerUrlKey, normalized);
    setState(() => _apiService = ApiService(baseUrl: normalized));
  }

  Future<void> _handleAuthenticated(String token, ClientSession session, List<ChatMessage> messages) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kTokenKey, token);
    setState(() {
      _token = token;
      _session = session;
      _initialMessages = messages;
    });
  }

  Future<void> _handleLogout() async {
    await _apiService.logout();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kTokenKey);
    if (!mounted) return;
    setState(() {
      _token = null;
      _session = null;
      _initialMessages = [];
    });
  }

  @override
  Widget build(BuildContext context) {
    final seed = const Color(0xFF6366F1);
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Gapless Client',
      themeMode: _isDarkMode ? ThemeMode.dark : ThemeMode.light,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.light),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.dark),
      ),
      builder: (context, child) => Directionality(
        textDirection: TextDirection.rtl,
        child: child ?? const SizedBox.shrink(),
      ),
      home: _isBootstrapping
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : (_token != null && _session != null)
              ? ChatScreen(
                  apiService: _apiService,
                  token: _token!,
                  session: _session!,
                  initialMessages: _initialMessages,
                  isDarkMode: _isDarkMode,
                  onToggleTheme: _toggleTheme,
                  onLogout: _handleLogout,
                )
              : PinGatewayScreen(
                  apiService: _apiService,
                  isDarkMode: _isDarkMode,
                  onToggleTheme: _toggleTheme,
                  onUpdateServerUrl: _updateServerUrl,
                  onAuthenticated: _handleAuthenticated,
                ),
    );
  }
}
