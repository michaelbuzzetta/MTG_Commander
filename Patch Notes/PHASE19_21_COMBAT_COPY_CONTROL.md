# Steps 19–21 — Combat Restrictions, Copying, and Control

Oracle compiler v3.3.0 expands three related rules families through generalized engine primitives.

- Step 19: temporary attack restrictions and requirements route through CombatEngine's existing legality/maximum-requirements model and expire during cleanup.
- Step 20: exact spell-copy and creature-token-copy Oracle families lower into the existing CopyService, preserving stack copy metadata and optional retargeting.
- Step 21: permanent and until-end-of-turn control-changing effects lower into the authoritative CONTROL_CHANGE event path. Temporary control records the prior controller and restores control during cleanup; supported effects may also untap the stolen creature.

Unknown compound restrictions, copy exceptions, duration dependencies, and multiplayer control clauses remain fail-closed for later coverage passes.
