# Step 30 — Deterministic Replay and Seeded Randomness

## Goal

Make rules execution and simulation failures reproducible from a seed plus the authoritative action/choice log.

## Architecture

- `SeededRandom` is the engine-wide randomness service. Shuffles, random starting-player selection, library randomization, and rules-owned random ordering consume this service through `engine.rng`/`engine.random`.
- Rules and AI source trees contain no direct `Math.random()` calls.
- `ReplayService` records reproducibility metadata, post-action authoritative state hashes, RNG call counts, actions/choices, AI decision metadata, events, turn history, rules/database versions, and final state hash.
- `ReplayRunner` recreates the initial game from the recorded seed/configuration, feeds the recorded actions/choices without asking UI or AI for decisions, and validates each recorded state hash.
- `createCheckpoint()` captures canonical authoritative state, RNG state, runtime ID state, replay/action sequence, and AI decision sequence.
- `loadCheckpoint()` restores the checkpoint and verifies its authoritative state hash.
- Authoritative state hashes deliberately exclude legality/timing diagnostic query traces because UI/AI may query legal actions a different number of times without changing game state.

## Replay envelope

The replay contains:

- schema + schema version
- public engine API version
- rules version
- card database version
- engine build identifier
- seed + RNG snapshot
- initial deck identifiers/versions
- pregame configuration
- authoritative action and choice entries
- post-action state hash and RNG call count
- AI decision records
- final authoritative state hash
- event, turn, legality, timing, loop, and safety diagnostics

## Checkpoints

A checkpoint contains the serialized canonical `GameState`, RNG snapshot, runtime/global identity sequence position, authoritative action sequence, replay prefix, AI decision prefix, and a state hash. Pending choices and stack objects are part of the canonical `GameState`, so they survive checkpoint/load without a separate UI-owned structure.

## Determinism boundary

Seeded games are fully replayable. Legacy tests may still inject a custom RNG function; that path remains supported for compatibility and is logged as `mode: external`, but strict reproducibility is provided by seeded mode.

## Verification

`npm run test:step30` checks:

1. identical seeds reproduce opening libraries and starting player;
2. recorded actions replay to matching per-action and final hashes;
3. tampered replay hashes are rejected;
4. checkpoints restore state and RNG position;
5. replay metadata exposes bug reproduction coordinates;
6. every replay action has a deterministic post-action hash;
7. rules/AI contain no direct `Math.random()` calls;
8. explicit library shuffles consume only the centralized RNG service.
