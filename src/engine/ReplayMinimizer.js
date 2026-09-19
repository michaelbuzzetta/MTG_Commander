/**
 * Finds the shortest replay prefix that still reproduces a supplied failure.
 * Prefix minimization is safe for stateful games because it never invents or
 * reorders actions. More aggressive delta-debugging would often invalidate
 * priority/choice dependencies.
 */
export class ReplayMinimizer {
  static minimizePrefix(replay, reproduces) {
    const actions = replay?.actions || [];
    if (!actions.length || typeof reproduces !== 'function') return replay;
    let low = 1;
    let high = actions.length;
    let best = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = structuredClone(replay);
      candidate.actions = candidate.actions.slice(0, mid);
      delete candidate.finalStateHash;
      let failed = false;
      try { failed = !!reproduces(candidate); } catch { failed = true; }
      if (failed) {
        best = candidate;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return best || replay;
  }
}
