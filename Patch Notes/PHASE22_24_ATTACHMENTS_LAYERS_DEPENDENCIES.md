# Steps 22–24 — Attachments, Layers, and Dependencies

- Oracle parser/compiler version: 3.6.0.
- Adds exact high-confidence templates for common Equipment and creature Aura families.
- Equipment compiles its equip cost into card metadata and uses the existing authoritative sorcery-speed attach action.
- Aura host restrictions compile into card-level target/enchant filters; attachment legality remains state-based and is rechecked after type/control/protection changes.
- Attached bonuses are continuous effects, not mutations of the host permanent.
- Static-effect dependency declarations are now preserved from Oracle AST through Ability IR/CardScript compilation into the continuous-effect engine.
- Layer ordering remains copy, control, text, type, color, ability, then P/T sublayers; same-layer ordering uses dependencies first and timestamps as the deterministic fallback.
- Unknown attachment clauses and dependencies that cannot be proven remain review_required.
