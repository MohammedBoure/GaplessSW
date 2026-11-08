# Database Layer (`src/db`)

This directory manages the SQLite persistence layer for **Gapless** using `better-sqlite3` in WAL (Write-Ahead Logging) mode.

## Files
- [`connection.js`](./connection.js): Initializes the SQLite database file (`data/gapless.db`), sets up tables (`pins`, `messages`, `rate_limits`, `security_events`), and seeds initial sample projects and welcome messages.
- [`repository.js`](./repository.js): Provides structured repository objects (`PinRepo`, `MessageRepo`, `RateLimitRepo`, `SecurityEventRepo`) along with character normalization utilities (`normalizeArabicJeem`).
