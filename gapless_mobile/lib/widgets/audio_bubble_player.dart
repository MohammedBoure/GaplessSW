import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';

class AudioBubblePlayer extends StatefulWidget {
  final String audioUrl;
  final String? durationLabel;
  final bool isClient;

  const AudioBubblePlayer({
    super.key,
    required this.audioUrl,
    this.durationLabel,
    required this.isClient,
  });

  @override
  State<AudioBubblePlayer> createState() => _AudioBubblePlayerState();
}

class _AudioBubblePlayerState extends State<AudioBubblePlayer> {
  final AudioPlayer _player = AudioPlayer();
  bool _isPlaying = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;

  @override
  void initState() {
    super.initState();
    _player.onPlayerStateChanged.listen((state) {
      if (!mounted) return;
      setState(() => _isPlaying = state == PlayerState.playing);
    });
    _player.onPositionChanged.listen((pos) {
      if (!mounted) return;
      setState(() => _position = pos);
    });
    _player.onDurationChanged.listen((dur) {
      if (!mounted) return;
      setState(() => _duration = dur);
    });
    _player.onPlayerComplete.listen((_) {
      if (!mounted) return;
      setState(() {
        _isPlaying = false;
        _position = Duration.zero;
      });
    });
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _togglePlay() async {
    if (_isPlaying) {
      await _player.pause();
    } else {
      await _player.play(UrlSource(widget.audioUrl));
    }
  }

  String _fmt(Duration d) {
    final m = d.inMinutes;
    final s = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final fg = widget.isClient ? Colors.white : Theme.of(context).colorScheme.onSurface;
    final accent = widget.isClient ? Colors.white : Theme.of(context).colorScheme.primary;
    final maxMs = _duration.inMilliseconds > 0 ? _duration.inMilliseconds.toDouble() : 1.0;
    final curMs = _position.inMilliseconds.clamp(0, maxMs.toInt()).toDouble();

    return Container(
      constraints: const BoxConstraints(minWidth: 210, maxWidth: 270),
      margin: const EdgeInsets.only(bottom: 6),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            onPressed: _togglePlay,
            icon: Icon(_isPlaying ? Icons.pause_circle_filled : Icons.play_circle_filled, size: 36, color: accent),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    trackHeight: 3,
                    thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                    overlayShape: const RoundSliderOverlayShape(overlayRadius: 12),
                  ),
                  child: Slider(
                    value: curMs,
                    max: maxMs,
                    activeColor: accent,
                    inactiveColor: fg.withValues(alpha: 0.28),
                    onChanged: (val) async {
                      await _player.seek(Duration(milliseconds: val.toInt()));
                    },
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      _duration.inMilliseconds > 0 ? _fmt(_position) : (widget.durationLabel ?? '0:00'),
                      style: TextStyle(fontSize: 11, color: fg.withValues(alpha: 0.85)),
                    ),
                    Text(
                      'رسالة صوتية',
                      style: TextStyle(fontSize: 11, color: fg.withValues(alpha: 0.75)),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
