# Public Web Assets Directory (`public`)

This directory contains the HTML entry points, stylesheets, and frontend JavaScript modules for **Gapless**.

## Files & Subdirectories
- [`index.html`](./index.html): Mobile-first (`100dvh`) Arabic RTL Client Gateway PWA with 4-digit PIN protection, brute-force lockout timer, voice notes, media/image lightbox, in-chat search, session export, and touch-friendly requirements discovery chat.
- [`manifest.json`](./manifest.json): Web App Manifest enabling PWA home-screen installation for Gapless Client.
- [`sw.js`](./sw.js): Service Worker caching the client app shell for fast loading and offline resilience.
- [`icon.svg`](./icon.svg): Vector application icon used for favicon and PWA home-screen shortcuts.
- [`admin.html`](./admin.html): Admin Management Dashboard (`/admin`) for managing client PINs, custom context instructions, personas, IP lockouts, and security logs.
- [`dev.html`](./dev.html): Developer Co-Pilot Live Dashboard (`/dev`) with real-time chat monitoring, **Ghost Mode**, **Secret Notes** (`[DEV_NOTE: ...]`), and **One-Click PRD** (`[GENERATE_PRD]`) generation.
- [`css/`](./css/README.md): Design system and responsive RTL stylesheets.
- [`js/`](./js/README.md): Frontend logic for client, admin, and developer portals.
