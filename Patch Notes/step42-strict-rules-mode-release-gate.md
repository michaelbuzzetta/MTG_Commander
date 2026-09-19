# Step 42 — Strict Rules Mode and Release Gate

Step 42 converts the correctness/reliability systems from Steps 1–41 into an enforceable release operating mode. It follows the workflow requirement that a strict game use only authoritative, fully supported behavior; run startup preflight over deck support, version/configuration, mechanics and required engine modules; prevent developer/manual mutation tools from bypassing the engine; and attach reproducibility certification metadata to strict simulation output.

## Strict-mode guarantees

`StrictRulesService` exposes the versioned `step42-strict-rules-v1` contract. Strict mode forces the Step 41 unsupported-interaction policy to `strict`, rejects partial-support overrides, disallows sandbox approximations, requires strict-eligible cards, keeps runtime invariants enabled, requires deterministic seeded randomness for simulation workloads, and preserves the existing authoritative trigger/AI legality architecture. The release gate reruns the dedicated trigger, AI legality, replay, invariant, primitive, cross-system, golden-card, judge-scenario, fuzz, performance, unsupported-interaction and strict-mode suites.

## Startup preflight

A strict engine receives an initial preflight during construction and a second gate immediately before `GameEngine.start()` mutates pregame state. The report validates card/deck support, nonempty rules/database versions, required engine modules, mechanic registrations, required custom hooks, unsupported-interaction policy, deterministic simulation RNG, and invariant enforcement. Any failed strict check raises `STRICT_PREFLIGHT_FAILED` instead of starting the game.

## Developer/manual tool lock

Strict gameplay blocks explicit runtime card registration, custom-hook registration, custom token registration, runtime legality-rule editing, direct state restore/checkpoint loading, and disabling invariant checks. Engine-internal transactional restores and generated-token materialization remain available through explicit internal calls so rollback and normal rules execution still function.

## Simulation certification

`getSimulationCertification()` and serialized replays include a Step 42 certification record with the strict-mode version, engine build, rules version, card database version, game/simulation purpose, startup preflight result, unsupported-interaction policy, deterministic RNG seed/state summary, and current replay/state hash. Official headless simulation refuses to return a result unless this certification is valid.

## Release gate

`step42-release-checklist.json` defines the mandatory strict release checks. `npm run release:step42` executes them in order and writes `release-artifacts/step42-release-gate.json`. A failed gate exits nonzero; release is green only when every declared gate passes.

Commands:

```bash
npm run check:step42
npm run test:step42
npm run release:step42
```
