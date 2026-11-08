# Configuration Directory (`src/config`)

This directory holds the centralized configuration for the **Gapless** application.

## Files
- [`index.js`](./index.js): Exports server settings, admin credentials, brute-force lockout parameters (`MAX_FAILED_ATTEMPTS = 5`, `LOCKOUT_DURATION_MS = 5 minutes`), filesystem paths, and `agy` CLI execution settings.
