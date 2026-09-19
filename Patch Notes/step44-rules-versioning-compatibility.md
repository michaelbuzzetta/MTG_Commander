# Step 44 — Rules Versioning and Compatibility

## RulesVersion service
Every game and replay carries an explicit `rulesVersion`. `RulesVersionService` defines the current snapshot and validates historical replay compatibility before replay actions execute.

## Compatibility policy
Compatibility is **exact by default**. A historical replay may run on a different runtime rules version only when that relationship is explicitly declared in the compatibility map. Otherwise the runner throws `RULES_VERSION_INCOMPATIBLE` before applying game actions.

## Rules-update checklist
1. Review the new official Comprehensive Rules snapshot and record its identifier/date.
2. Identify changed rules and affected engine subsystems.
3. Use the Oracle/card update diff to identify potentially affected cards.
4. Add or update primitive, interaction, golden-card, and judge-scenario regression tests before changing behavior.
5. Implement the rules changes behind reusable rules primitives, not card-specific UI behavior.
6. Increment the engine `rulesVersion` and update explicit compatibility mappings only when proven safe.
7. Rebuild support metadata and `rules-change-impact-report.json`.
8. Run replay/version validation, strict-mode gates, judge scenarios, fuzzing, and affected golden tests.
9. Document migration notes for behavior changes and tag the compatible engine build.

## Replay policy
A replay records its exact rules version and card database version. Replay execution validates compatibility before playback. If a compatible historical engine is unavailable, execution fails with a clear version incompatibility rather than silently interpreting the replay under different rules.
