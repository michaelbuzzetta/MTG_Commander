/** Extensible action-scoring registry. Rules legality remains outside this layer. */
export class AIActionScorer {
  constructor() {
    this.scorers = new Map();
    this.thresholds = new Map();
  }

  register(actionType, scorer, threshold = () => 0) {
    if (!actionType || typeof scorer !== 'function') throw new Error('AI action scorer requires an action type and scorer');
    this.scorers.set(actionType, scorer);
    this.thresholds.set(actionType, typeof threshold === 'function' ? threshold : () => Number(threshold || 0));
    return this;
  }

  evaluate(action, context = {}) {
    const scorer = this.scorers.get(action?.type);
    const threshold = this.thresholds.get(action?.type);
    return Object.freeze({
      action,
      value: scorer ? Number(scorer(action, context)) : -Infinity,
      threshold: threshold ? Number(threshold(action, context)) : 0
    });
  }
}
