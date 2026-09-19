import { stackObjectPublicSnapshot } from './StackObject.js';

/**
 * Small deterministic view-model used by Step 5 tests and by future UI work.
 * It contains no rules decisions; it only renders authoritative stack/priority
 * state in a form that can be snapshot-tested.
 */
export function buildStackPriorityView(engine) {
  const s = engine.state;
  const stack = s.stack.map(stackObjectPublicSnapshot);
  return {
    phase: s.phase,
    activePlayer: s.activePlayer,
    priorityPlayer: s.priorityPlayer,
    consecutivePasses: s.passes,
    livingPlayers: engine.livingPlayerIds(),
    stackDepth: stack.length,
    topStackObjectId: stack.at(-1)?.id || null,
    stackBottomToTop: stack
  };
}
