# API Routes Layer (`src/routes`)

This directory contains the Express API routers for the three core surfaces of **Gapless**.

## Files
- [`client.js`](./client.js): Handles PIN validation (`/api/client/verify-pin`) with 5-attempt / 5-minute IP lockout protection, lockout status polling (`/api/client/lockout-status`), session state (`/api/client/session`), and sanitized message/image uploads (`/api/client/message`).
- [`admin.js`](./admin.js): Handles protected Admin authentication (`admin` / `admin123`), full CRUD for 4-digit PINs, per-PIN custom instructions and model persona settings, IP lockout tracking, manual IP unblocking/locking, and security audit logs.
- [`dev.js`](./dev.js): Powers the Developer Co-Pilot Mode (`/dev`), including live session inspection, **Ghost Mode** (`/api/dev/sessions/:pinId/ghost`), **Secret Notes** (`[DEV_NOTE: ...]` at `/api/dev/sessions/:pinId/note`), and **One-Click PRD** generation (`[GENERATE_PRD]` at `/api/dev/sessions/:pinId/prd`).
