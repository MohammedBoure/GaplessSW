# Frontend JavaScript Directory (`public/js`)

This directory contains the client-side controllers and shared utilities for the three **Gapless** web portals.

## Files
- [`theme.js`](./theme.js): Shared Light / Dark theme controller (`[data-theme="light"]` / `[data-theme="dark"]`) with `localStorage` persistence and vector SVG Sun/Moon icon rendering across `/`, `/admin`, and `/dev`.
- [`client.js`](./client.js): Powers the mobile-first 4-digit PIN gateway, real-time 5-minute lockout countdown timer, touch keypad, interactive one-tap Choice Chips (`meta.choices`), Arabic character normalization (`٩` -> `ج`), media upload previews, and live Socket.IO chat streaming.
- [`admin.js`](./admin.js): Powers the `/admin` dashboard including login (`admin` / `admin123`), multi-user shared project grouping (`project_group`), participant role assignment (`participant_role`), confidential background instructions (hidden from the client), IP brute-force lockout monitoring, manual IP unblocking/locking, and security event audit logs.
- [`dev.js`](./dev.js): Powers the `/dev` Developer Co-Pilot workspace including grouped project sessions, **Ghost Mode** (with optional interactive choice chips), **Secret Notes** (`[DEV_NOTE: ...]`), the **Standalone Developer AI Assistant** (`tabPaneDevAi`), the **Hierarchical Project Knowledge Tree Viewer** (`tabPaneProjectTree`), and **One-Click PRD** (`[GENERATE_PRD]`) generation.
