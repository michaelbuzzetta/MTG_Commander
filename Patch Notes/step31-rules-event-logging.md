# Step 31 — Rules and Event Logging

Step 31 adds a structured, non-authoritative diagnostic layer to the Commander rules engine.

## Capabilities

- Three log audiences: concise player log, developer event/action log, and opt-in verbose rules trace.
- Action lifecycle logging: requested, validated, rejected, completed.
- Event lifecycle correlation using event IDs, action sequence numbers, player IDs, game object IDs, stack IDs, and choice IDs where present.
- Replacement/prevention trace capture from authoritative events.
- On-demand legality tracing that explains permissions/restrictions and denials.
- On-demand continuous-effect/layer tracing with applied-effect details.
- Existing state-based-action, ward, trigger, stack-resolution, and rule-intervention history is bridged into structured logs.
- Download/copy-ready diagnostic bundle object containing reproduction metadata, state hash, logs, event log, rejected events, replacement trace, legality diagnostics, state snapshot, and replay.
- Replay exports include the structured Step 31 logs so diagnostic IDs can be correlated with deterministic reproductions.

## Public API

- `getRulesLogSnapshot({ level, sinceSequence })`
- `setVerboseRulesTracing(enabled)`
- `traceLegality(operation, playerId, context)`
- `traceCharacteristics(object)`
- `getDiagnosticBundle(options)`

Verbose tracing is disabled by default and does not change authoritative game behavior.
