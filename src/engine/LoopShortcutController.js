import { LOOP_SHORTCUT_ACTION } from './LoopTypes.js';

export function finiteLoopShortcut(loopId, iterations) {
  return { type: LOOP_SHORTCUT_ACTION, loopId, iterations: Number(iterations) };
}

export function repeatUntilLoopShortcut(loopId, until, maxIterations = 1000) {
  return { type: LOOP_SHORTCUT_ACTION, loopId, until: structuredClone(until), maxIterations: Number(maxIterations) };
}

export function describeLoop(loop) {
  if (!loop) return 'Unknown loop';
  const period = Number(loop.period || loop.sequence?.length || 0);
  return `${loop.classification} (${period} action${period === 1 ? '' : 's'} per iteration)`;
}
