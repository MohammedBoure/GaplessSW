# Frontend JavaScript Directory (`public/js`)

This directory contains the client-side controllers for the three **Gapless** web portals.

## Files
- [`client.js`](./client.js): Powers the mobile-first 4-digit PIN gateway, real-time 5-minute lockout countdown timer, touch keypad, Arabic character normalization (`٩` -> `ج`), media upload previews, and live Socket.IO chat streaming.
- [`admin.js`](./admin.js): Powers the `/admin` dashboard including login (`admin` / `admin123`), PIN CRUD, custom instructions & model persona configuration, IP brute-force lockout monitoring, manual IP unblocking/locking, and security event audit logs.
- [`dev.js`](./dev.js): Powers the `/dev` Developer Co-Pilot workspace including live session monitoring, **Ghost Mode** message injection, **Secret Notes** (`[DEV_NOTE: ...]`) injection, and **One-Click PRD** (`[GENERATE_PRD]`) generation and Markdown export.
