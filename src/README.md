# Source Code Directory (`src`)

This directory contains the backend server, database layer, security guardrails, `agy` process manager, and HTTP/WebSocket routes for **Gapless**.

## Files & Subdirectories
- [`server.js`](./server.js): Main Express HTTP server and Socket.IO real-time hub serving `/`, `/admin`, and `/dev` alongside REST API endpoints.
- [`config/`](./config/README.md): Centralized environment settings, port bindings, rate-limit thresholds, and file paths.
- [`db/`](./db/README.md): SQLite database connection (`better-sqlite3`) and repository access layer for PINs, chat messages, IP lockouts, and security events.
- [`security/`](./security/README.md): Prompt injection sanitization, HMAC token authentication, and the isolated `sandbox_env` + `PreToolUse` hook gate for `agy`.
- [`services/`](./services/README.md): The `agy` CLI process manager (`agyManager.js`) handling sandboxed execution, persona injection, visual media analysis, secret developer notes, and PRD generation.
- [`routes/`](./routes/README.md): Express API route handlers for Client Gateway (`client.js`), Admin Dashboard (`admin.js`), and Developer Co-Pilot (`dev.js`).
