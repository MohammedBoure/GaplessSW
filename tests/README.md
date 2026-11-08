# Tests Directory (`tests`)

This directory contains automated verification scripts for **Gapless**.

## Files
- [`verify.js`](./verify.js): End-to-end verification suite testing the `sandbox_env` `PreToolUse` hook gate, prompt injection sanitization, Arabic `٩` -> `ج` normalization, 5-attempt / 5-minute IP lockout rate limiting, Admin authentication (`admin` / `admin123`), Client PIN authentication, and Developer Co-Pilot Ghost Mode & Secret Notes isolation.
