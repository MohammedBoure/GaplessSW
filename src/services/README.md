# Services Layer (`src/services`)

This directory contains core business logic services and external engine managers for **Gapless**.

## Files
- [`agyManager.js`](./agyManager.js): Manages `agy` CLI process spawning in strict sandbox mode (`--sandbox`, `--disable-slash-commands`), constructs the combined system instructions (Mandatory Guardrails + ScopeMaster persona + Admin custom instructions + Developer Co-Pilot `[DEV_NOTE: ...]` injections), handles visual inspection of client-uploaded media (`--add-dir uploads`), and executes `[GENERATE_PRD]` to produce structured Product Requirements Documents.
