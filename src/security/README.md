# Security & Guardrails Layer (`src/security`)

This directory implements the multi-layered security architecture for **Gapless**, enforcing strict sandboxing, prompt injection defense, and cryptographic session authentication.

## Files
- [`auth.js`](./auth.js): Implements HMAC-SHA256 stateless token generation and verification for both Admin/Developer sessions and Client PIN sessions, plus IP extraction and Express route middleware.
- [`sanitizer.js`](./sanitizer.js): Implements strict input sanitization (`sanitizeClientInput`, `sanitizeDevNote`), Arabic character normalization (`٩` -> `ج`), and regex detection/neutralization of shell commands (`rm -rf`, `curl`, etc.) and prompt injection attempts.
- [`sandbox.js`](./sandbox.js): Sets up the isolated `sandbox_env/` directory, writes `GEMINI.md` rules, and installs a `PreToolUse` lifecycle hook (`hooks.json` + `tool-gate.js`) that hard-denies all shell execution and file modification tools while permitting read-only inspection of client-uploaded media inside `uploads/`.
