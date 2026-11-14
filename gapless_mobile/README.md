# Gapless Mobile (`gapless_mobile`)

Native **Flutter** client application for Gapless, supporting Arabic RTL, Light/Dark themes, 4-digit PIN authentication with lockout protection, real-time Socket.IO messaging, voice note recording & playback, camera/gallery/PDF attachments, quick-choice chips, in-chat search, and transcript export.

## Directory Structure
- `lib/main.dart`: Application entry point, RTL wrapper, theme persistence, and automatic session restoration.
- `lib/models/chat_models.dart`: Data models (`ClientSession`, `ChatMessage`) and Arabic character normalization (`٩` -> `ج`).
- `lib/services/api_service.dart`: HTTP REST & multipart media upload client for `/api/client/*`.
- `lib/services/socket_service.dart`: Real-time Socket.IO client for live chat updates, typing indicators, resets, and revocation.
- `lib/screens/pin_gateway_screen.dart`: 4-digit PIN keypad screen, 5-minute lockout countdown, and configurable server URL dialog.
- `lib/screens/chat_screen.dart`: Full discovery chat UI with WhatsApp-style voice recording, image/PDF attachments, quick choices, search, and export.
- `lib/widgets/audio_bubble_player.dart`: In-bubble audio player widget with play/pause and seek slider.
