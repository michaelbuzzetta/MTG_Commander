# Step 30 Completion Report

Status: **COMPLETE**

## Workflow target

Step 30 implements **Deterministic Replay and Seeded Randomness** so games, simulations, and discovered failures can be reproduced from a seed plus authoritative action/choice history.

## Implemented

- Promoted `SeededRandom` from a pregame helper into the game-wide RNG service.
  - Seeded shuffles and starting-player selection are deterministic.
  - Automatic games receive a recorded generated seed when the caller does not provide one.
  - Legacy injected RNG functions remain supported for tests and are explicitly marked external/non-seeded.
  - RNG snapshots expose seed, internal state, call count, mode, and consumed values for diagnostics.
- Removed direct `Math.random()` usage from `src/engine/` and `src/ai/`.
  - Runtime saga, ability, ward, and encore identifiers use deterministic engine-local sequences.
  - Generic shuffle helpers now require the engine RNG instead of silently falling back to ambient randomness.
- Added `src/engine/replay/ReplayService.js`.
  - Replay envelope records schema/API version, rules version, card DB version, engine build, seed/RNG state, deck identifiers, pregame config, actions, choices, AI decisions, event/turn diagnostics, per-action state hashes, RNG call counts, and final state hash.
- Added `src/engine/replay/ReplayRunner.js`.
  - Recreates the game from seed/configuration.
  - Replays recorded actions/choices without asking UI/AI for decisions.
  - Verifies each post-action state hash and the final state hash.
  - Rejects altered/tampered replay hashes.
- Added deterministic authoritative state hashing.
  - Legality/timing diagnostic query traces are excluded because they do not affect rules state and may differ depending on UI/AI inspection frequency.
- Added save/load checkpoints.
  - `createCheckpoint()` captures canonical `GameState`, RNG state, pending choice/stack through the state snapshot, runtime/global ID sequence positions, action log prefix, AI decisions, and hash.
  - `loadCheckpoint()` restores and verifies the checkpoint.
- Added public replay helpers:
  - `getReplayStateHash()`
  - `createCheckpoint()`
  - `loadCheckpoint()`
  - `getReplayMetadata()`
  - `GameEngine.replay(...)`
- Added Step 30 architecture documentation, test command, and regression suite.

## Verification

- Dedicated Step 30 suite: **8/8 passed**.
- Step 29 regression suite: **8/8 passed**.
- Core engine regression suite: **26/26 passed**.
- Explorers complete regression suite: **21/21 passed**.
- Step 1 architecture compatibility suite + Step 30 suite: **16/16 passed**.
- Architecture boundary check: **PASS**.
- Card/deck schema validation: **647 cards / 13 decks — PASS**.
- Step 17 support-data validation: **26 fully supported / 621 partial / 0 unsupported — PASS**.
- Step 18 Oracle compiler validation: **4 exact / 643 review-required — PASS**.
- A broad all-step invocation was also exercised; the sandbox command exceeded its execution window during the long aggregate run, so completion is based on the dedicated Step 30 acceptance suite plus the targeted regression suites above rather than claiming a completed all-tests aggregate.
- Production build was not attempted because `node_modules` is not installed in this sandbox.

## Acceptance criteria

- Same replay produces identical authoritative state hashes: **PASS**.
- A discovered bug can be reproduced from seed + replay: **PASS** through `ReplayRunner` and reproduction metadata.
- No hidden rules/AI `Math.random()` remains outside the centralized RNG service: **PASS**.
- Simulation/game runs can emit a compact replay envelope with action-level reproduction hashes and checkpoint metadata: **PASS**.

## Files of interest

- `src/engine/pregame/SeededRandom.js`
- `src/engine/replay/StateHasher.js`
- `src/engine/replay/ReplayService.js`
- `src/engine/replay/ReplayRunner.js`
- `src/engine/replay/index.js`
- `src/engine/GameEngine.js`
- `src/engine/GameState.js`
- `src/engine/utils.js`
- `tests/step30-deterministic-replay.test.js`
- `docs/architecture/step30-deterministic-replay.md`

Next: **Step 31 — Rules and Event Logging**.
