# Step 36 Judge Scenario Coverage

Scenarios: **9**  
Executable: **9**  
Critical trace snapshots: **8**  
Status: **PASS**

- [trace] **J36-LAYERS-DEPENDENCY-001** — Type, ability, and power/toughness layer dependency analogue (layers, dependencies, blood-moon-like, humility-like, opalescence-like)
- [trace] **J36-REPLACEMENTS-ORDER-002** — Multiple noncommutative replacement effects require affected-player ordering (replacement, choice, ordering)
- [trace] **J36-SIMULTANEOUS-DEATHS-003** — Simultaneous lethal damage produces one SBA batch and simultaneous death triggers (state-based-actions, damage, simultaneous-deaths, triggers)
- [trace] **J36-APNAP-004** — Four-player simultaneous triggers use rotated APNAP stack ordering (multiplayer, apnap, simultaneous-triggers)
- [trace] **J36-PLAYER-ELIMINATION-005** — Four-player elimination unwinds ownership, control, stack, choices, turns, and combat references atomically (multiplayer, player-elimination, ownership, control-change, stack)
- [run] **J36-CONTROL-ATTACHMENT-006** — Control change invalidates a control-sensitive Aura and SBA removes it (control-change, attachments, state-based-actions)
- [trace] **J36-COMMANDER-MOVE-007** — Commander movement uses replacement timing for hand/library and SBA timing for graveyard/exile (commander, zone-change, replacement, state-based-actions)
- [trace] **J36-COPY-LAYERS-008** — Copied permanent receives copiable base values, then later type and ability layers recalculate (copy, layers, type-change, ability-change)
- [trace] **J36-BUG-SEARCH-RESOLUTION-009** — Regression: resolving search spell remains authoritative while waiting for a library choice (bug-regression, stack, library-search, choice, invariants)
