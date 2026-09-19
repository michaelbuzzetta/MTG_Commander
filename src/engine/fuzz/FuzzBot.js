import { SeededRandom } from '../pregame/SeededRandom.js';
import { PropertyAssertions } from './PropertyAssertions.js';
import { FailureCorpus } from './FailureCorpus.js';

function chooseSubset(rng, ids, min = 0, max = ids.length) {
  const shuffled = rng.shuffle(ids);
  const lo = Math.max(0, Math.min(Number(min) || 0, ids.length));
  const hi = Math.max(lo, Math.min(Number(max) || ids.length, ids.length));
  const count = lo + rng.integer(hi - lo + 1);
  return shuffled.slice(0, count);
}

function materializeTemplate(action, rng, engine, playerId) {
  const out = structuredClone(action);
  switch (out.type) {
    case 'CHOOSE_CULTIVATE':
      out.cardInstanceIds = chooseSubset(rng, out.eligibleIds || [], Math.min(2, (out.eligibleIds || []).length), Math.min(Number(out.max || 2), (out.eligibleIds || []).length));
      break;
    case 'CHOOSE_PROLIFERATE':
      out.targetIds = chooseSubset(rng, out.eligibleIds || [], 0, (out.eligibleIds || []).length);
      break;
    case 'CHOOSE_PHASE_OUT_PROLIFERATED':
      out.permanentIds = chooseSubset(rng, out.eligibleIds || [], 0, (out.eligibleIds || []).length);
      break;
    case 'CHOOSE_EFFECT_CARDS':
      out.cardInstanceIds = chooseSubset(rng, out.candidateIds || [], out.min || 0, out.max ?? (out.candidateIds || []).length);
      break;
    case 'CHOOSE_LIBRARY_SEARCH':
      out.cardInstanceIds = chooseSubset(rng, out.candidateIds || [], out.min || 0, out.max ?? (out.candidateIds || []).length);
      break;
    case 'CHOOSE_TRIGGER_TARGET':
      out.targetIds = chooseSubset(rng, out.candidateIds || [], out.minTargets || 0, out.maxTargets ?? (out.candidateIds || []).length);
      break;
    case 'BOTTOM_CARDS':
    case 'DISCARD_CARDS': {
      const count = Math.max(0, Number(out.count || 0));
      const handIds = (engine?.state?.players?.[playerId]?.hand || []).map(card => card.instanceId);
      out.cardInstanceIds = chooseSubset(rng, handIds, Math.min(count, handIds.length), Math.min(count, handIds.length));
      break;
    }
    default:
      break;
  }
  return out;
}

function isExecutable(action) {
  if (!action?.type) return false;
  if (['BOTTOM_CARDS', 'DISCARD_CARDS'].includes(action.type) && !Array.isArray(action.cardInstanceIds)) return false;
  return true;
}

function noveltyWeight(action) {
  let weight = 1;
  const type = String(action?.type || '');
  if (type.startsWith('CHOOSE_') || type.startsWith('ORDER_')) weight += 7;
  if (type === 'ACTIVATE_ABILITY') weight += 6;
  if (type === 'CAST_SPELL' || type === 'CAST_COMMANDER') weight += 5;
  if (type === 'DECLARE_ATTACKERS' || type === 'DECLARE_BLOCKERS') weight += 4;
  if (action?.targets?.length || action?.targetIds?.length || action?.candidateIds?.length) weight += 5;
  if (action?.mode || action?.selectedModes?.length || action?.xValue != null) weight += 4;
  if (type === 'PASS_PRIORITY') weight = 1;
  return weight;
}

function weightedPick(rng, actions) {
  const weighted = actions.map(action => ({ action, weight: noveltyWeight(action) }));
  const total = weighted.reduce((sum, row) => sum + row.weight, 0);
  let cursor = rng.next() * total;
  for (const row of weighted) {
    cursor -= row.weight;
    if (cursor <= 0) return row.action;
  }
  return weighted.at(-1).action;
}

export class FuzzBot {
  constructor(engine, {
    seed = 'step37-fuzz',
    maxActions = 1000,
    unchangedStateLimit = 48,
    persistFailures = true,
    failureDirectory = null
  } = {}) {
    this.engine = engine;
    this.seed = String(seed);
    this.botSeed = `${this.seed}:bot`;
    this.random = new SeededRandom({ seed: this.botSeed });
    this.maxActions = Math.max(1, Number(maxActions) || 1000);
    this.properties = new PropertyAssertions(engine, { unchangedStateLimit });
    this.persistFailures = persistFailures !== false;
    this.corpus = new FailureCorpus(failureDirectory || undefined);
    this.trace = [];
  }

  currentActor() {
    const state = this.engine.state;
    if (state.pendingChoice?.playerId) return state.pendingChoice.playerId;
    if (state.pregame?.active && state.pregame.currentPlayer) return state.pregame.currentPlayer;
    if (state.turnActionPending === 'DECLARE_ATTACKERS') return state.activePlayer;
    if (state.turnActionPending === 'DECLARE_BLOCKERS') return state.combat?.currentDefender || this.engine.opponent(state.activePlayer);
    return state.priorityPlayer || state.activePlayer;
  }

  _concreteLegalActions(playerId) {
    const templates = this.engine.getLegalActions(playerId);
    const concrete = templates.map(action => materializeTemplate(action, this.random, this.engine, playerId)).filter(isExecutable);
    return { templates, concrete };
  }

  _sameTemplate(template, concrete) {
    if (JSON.stringify(template) === JSON.stringify(concrete)) return true;
    if (template?.type !== concrete?.type) return false;
    const derivedFields = new Set(['cardInstanceIds','targetIds','permanentIds']);
    const clean = value => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !derivedFields.has(key)));
    return JSON.stringify(clean(template)) === JSON.stringify(clean(concrete));
  }

  run() {
    if (!this.engine.state.started) this.engine.start();
    let lastAction = null;
    try {
      for (let index = 0; index < this.maxActions; index++) {
        if (this.engine.state.winner) return this.summary('winner', index);
        const playerId = this.currentActor();
        const { templates, concrete } = this._concreteLegalActions(playerId);
        this.properties.assertActorCanAct(playerId, concrete);
        const action = weightedPick(this.random, concrete);
        lastAction = action;
        if (!templates.some(template => this._sameTemplate(template, action))) {
          throw Object.assign(new Error('Materialized fuzz action no longer corresponds to an engine-provided legal action template.'), { code: 'FUZZ_ACTION_NOT_ENGINE_PROVIDED' });
        }
        const response = this.engine.state.pendingChoice
          ? this.engine.submitChoice(playerId, action)
          : (action.type === 'PASS_PRIORITY' ? this.engine.passPriority(playerId) : this.engine.submitAction(playerId, action));
        // The exact concrete action must itself be accepted. Invariant checks also
        // execute inside the engine transaction boundary before this point.
        if (!response.ok) {
          const err = new Error(response.error?.message || 'Legal fuzz action rejected');
          err.code = 'LEGAL_ACTION_REJECTED';
          err.detail = { response: response.error, action, playerId, templates };
          throw err;
        }
        this.properties.afterAction({ playerId, action, response });
        this.trace.push({ index, playerId, type: action.type, stateHash: this.engine.getReplayStateHash() });
      }
      return this.summary('action-budget', this.maxActions);
    } catch (error) {
      let persisted = null;
      if (this.persistFailures) {
        persisted = this.corpus.persist({
          seed: this.seed,
          botSeed: this.botSeed,
          error,
          engine: this.engine,
          actionIndex: this.trace.length,
          action: lastAction,
          metadata: { maxActions: this.maxActions }
        });
      }
      error.fuzz = { seed: this.seed, botSeed: this.botSeed, actionIndex: this.trace.length, persisted };
      throw error;
    }
  }

  summary(stopReason, actionsExecuted) {
    return {
      ok: true,
      seed: this.seed,
      botSeed: this.botSeed,
      stopReason,
      actionsExecuted,
      winner: this.engine.state.winner || null,
      turn: this.engine.state.turn,
      phase: this.engine.state.phase,
      stateHash: this.engine.getReplayStateHash(),
      replayActions: JSON.parse(this.engine.serializeReplay()).actions.length,
      botRandomCalls: this.random.snapshot().calls
    };
  }
}
