# Step 37 Fuzz Failure Corpus

Confirmed fuzz failures belong here after they have been reproduced and promoted to deterministic regression coverage. Runtime fuzz artifacts are written to `fuzz-artifacts/failures/` and are not committed automatically.

Promotion workflow:
1. Re-run the exact seed/replay.
2. Confirm the failure is a rules/engine defect rather than unsupported setup.
3. Add the smallest deterministic unit, interaction, golden, or judge scenario that fails first.
4. Fix the engine.
5. Keep the deterministic regression test permanently.
