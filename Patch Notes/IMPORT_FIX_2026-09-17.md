# Engine import compatibility fix — 2026-09-17

## Problem
Vite could fail with:

`Failed to resolve import "./CardFace.js" from "src/engine/index.js"`

when a newer release was merged into an older project tree whose engine barrel still referenced the pre-refactor root-level state modules.

## Fix
Added compatibility re-export modules at:

- `src/engine/CardFace.js`
- `src/engine/GameObject.js`
- `src/engine/GameStateSchema.js`
- `src/engine/serialization.js`

Each forwards to the canonical implementation under `src/engine/state/`.

The current canonical `src/engine/index.js` continues to export `./state/index.js` and does not depend on these shims.

## Verification
- Canonical engine index imports successfully.
- Legacy compatibility imports pass their dedicated Node test.
- Project-wide relative import scan found zero missing relative modules across 329 JS-family source/test/script files.
- Gameplay release gate: 168/168 tests passing.

## Recommended Windows upgrade
Extract this release into a new empty directory instead of merging it onto an older source tree. Then run:

```powershell
npm ci
npm run dev
```
