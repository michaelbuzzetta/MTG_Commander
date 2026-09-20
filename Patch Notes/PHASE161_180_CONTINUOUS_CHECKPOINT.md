# Phases 161–180 Continuous Checkpoint

Intermediate checkpoint; release gate is not declared passed.

Implemented semantic/compiler families:
161 Rooms reminder/doors; 162 Prepared; 163 ongoing schemes; 164 Hidden agenda; 165 face-up Conspiracy command-zone start; 166 face-up draft instruction; 167 open an Attraction; 168 Double team; 169 Spirit/Arcane ki counters; 170 flash permission with delayed cleanup sacrifice; 171 Storied; 172 put target creature on top of owner library; 173 Phyrexian mana reminder semantics; 174 day initialization on entry; 175 Station; 176 Banding; 177 ante-only pregame removal; 178 bounty setup; 179 bounty initial reveal; 180 bounty progression/restock.

Verification actually run:
- Phase 161–180 focused coverage: 20/20 passed.
- Combined Phase 131–180 coverage regressions: 50/50 passed.

Strictness note: these phases expand semantic/compiler coverage. Complex mechanics including Rooms, Prepared, Schemes, Hidden Agenda/Conspiracy, Attractions, Double Team, Station, Banding, and Bounties still require authoritative end-to-end runtime enforcement before dependent cards qualify as genuinely fully runtime-implemented. No new catalog-wide fully-implemented count is claimed from this pass.
