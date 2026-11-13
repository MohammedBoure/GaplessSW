# Database Layer (`src/db`)

This directory manages the SQLite persistence layer and hierarchical project tree synchronization for **Gapless** using `better-sqlite3` in WAL (Write-Ahead Logging) mode.

## Files
- [`connection.js`](./connection.js): Initializes the SQLite database file (`data/gapless.db`), runs non-destructive schema migrations for multi-user project groups (`project_group`, `participant_role`) and standalone developer AI threads (`dev_ai_threads`, `dev_ai_messages`), and seeds initial sample projects.
- [`repository.js`](./repository.js): Provides structured repository objects (`PinRepo`, `MessageRepo`, `ProjectTreeRepo`, `DevAiRepo`, `RateLimitRepo`, `SecurityEventRepo`), confidential welcome message builders, and real-time synchronization of hierarchical project trees (`sandbox_env/projects_tree/`).
