import React, { useEffect, useState } from 'react';
import db0 from './data/generated/cards.json' with { type: 'json' };
import decks from './data/generated/decks.json' with { type: 'json' };
import { GameEngine } from './engine/GameEngine.js';
import { AIController } from './ai/AIController.js';
import { Battlefield } from './components/Battlefield.jsx';
import { Card } from './components/Card.jsx';
import { buildCustomDeck, parseMassEntry } from './utils/deckImport.js';
import { automationActor, humanAutomationDecision } from './utils/turnAutomation.js';
import './styles.css';

const playableDecks = decks.filter(deck => deck.playable !== false);
const referenceDecks = decks.filter(deck => deck.playable === false);
const CUSTOM_DECKS_KEY = 'mtg-ai-trainer.custom-decks.v1';

function loadCustomDecks() {
  if (typeof window === 'undefined') return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem(CUSTOM_DECKS_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(deck => deck?.custom && deck?.cardCount === 100 && db0[deck.commander]) : [];
  } catch {
    return [];
  }
}

function saveCustomDecks(customDecks) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CUSTOM_DECKS_KEY, JSON.stringify(customDecks));
}

const PHASE_UI = {
  UNTAP: { label: 'Untap', mode: 'TURN', help: 'Permanents untap. Players do not receive priority in this step.' },
  UPKEEP: { label: 'Upkeep', mode: 'TURN', help: 'Upkeep triggers are on the stack before priority passes.' },
  DRAW: { label: 'Draw', mode: 'TURN', help: 'The active player draws, then players receive priority.' },
  PRECOMBAT_MAIN: { label: 'Main Phase', mode: 'PLAY', help: 'Play a land, cast spells, or activate abilities.' },
  BEGIN_COMBAT: { label: 'Beginning of Combat', mode: 'COMBAT', help: 'Beginning-of-combat effects occur, then players receive priority.' },
  DECLARE_ATTACKERS: { label: 'Declare Attackers', mode: 'ATTACK', help: 'Attackers are declared first; then players receive priority.' },
  DECLARE_BLOCKERS: { label: 'Declare Blockers', mode: 'DEFEND', help: 'Blockers are declared first; then players receive priority.' },
  FIRST_STRIKE_DAMAGE: { label: 'First-Strike Damage', mode: 'COMBAT', help: 'First-strike/double-strike damage has occurred. Players now receive priority.' },
  COMBAT_DAMAGE: { label: 'Combat Damage', mode: 'COMBAT', help: 'Normal combat damage has occurred. Players now receive priority.' },
  END_COMBAT: { label: 'End of Combat', mode: 'COMBAT', help: 'Players receive priority before combat ends.' },
  POSTCOMBAT_MAIN: { label: 'Second Main Phase', mode: 'PLAY', help: 'Play a land if available, cast spells, or activate abilities.' },
  END_STEP: { label: 'End Step', mode: 'TURN', help: 'End-step triggers occur, then players receive priority.' },
  CLEANUP: { label: 'Cleanup', mode: 'TURN', help: 'The active player discards to maximum hand size and damage is removed.' }
};

function PhaseBanner({ state, attackers, blockTarget }) {
  const ui = PHASE_UI[state.phase] || { label: state.phase.replaceAll('_', ' '), mode: 'TURN', help: 'Continue the current step.' };
  const yours = state.activePlayer === 'player';
  const activeName = yours ? 'YOUR TURN' : `${state.players[state.activePlayer]?.name?.toUpperCase() || 'OPPONENT'} TURN`;
  let detail = ui.help;
  if (state.turnActionPending === 'DECLARE_ATTACKERS' && yours) detail = `${attackers.length} attacker${attackers.length === 1 ? '' : 's'} selected. Choose an opponent, select creatures, then confirm attackers.`;
  else if (state.turnActionPending === 'DECLARE_BLOCKERS' && state.combat.currentDefender === 'player') detail = blockTarget ? 'Now click one of your creatures to assign it as a blocker.' : 'Select an attacker aimed at you, then assign your blockers.';
  else if (state.turnActionPending === 'DECLARE_BLOCKERS' && state.combat.currentDefender) detail = `${state.players[state.combat.currentDefender]?.name || 'An opponent'} is declaring blockers.`;
  else if (['DECLARE_ATTACKERS', 'DECLARE_BLOCKERS'].includes(state.phase) && !state.turnActionPending) detail = 'Declarations are complete. Players may now act with priority.';
  return <section className={`phase-banner mode-${ui.mode.toLowerCase()} ${yours ? 'turn-player' : 'turn-opponent'}`}>
    <div className="phase-owner">{activeName}</div>
    <div className="phase-main"><span className="phase-kicker">{ui.mode}</span><strong>{ui.label}</strong><span>{detail}</span></div>
    <div className="turn-chip">TURN {state.turn}</div>
  </section>;
}

export default function App() {
  const [customDecks, setCustomDecks] = useState(loadCustomDecks);
  const selectableDecks = [...playableDecks, ...customDecks];
  const [choice, setChoice] = useState(playableDecks[0]?.id || '');
  const [playerCount, setPlayerCount] = useState(2);
  const [showDeckImporter, setShowDeckImporter] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [commanderName, setCommanderName] = useState('');
  const [deckList, setDeckList] = useState('');
  const [deckImportError, setDeckImportError] = useState('');
  const [engine, setEngine] = useState(null);
  const [renderTick, redraw] = useState(0);
  const [attackers, setAttackers] = useState([]);
  const [attackTargets, setAttackTargets] = useState({});
  const [attackDefender, setAttackDefender] = useState(null);
  const [blockTarget, setBlockTarget] = useState(null);
  const [blockers, setBlockers] = useState({});
  const [choiceCards, setChoiceCards] = useState([]);
  const [damageOrders, setDamageOrders] = useState({});
  const [combatMessage, setCombatMessage] = useState('');
  const [targetingAction, setTargetingAction] = useState(null);
  const [triggerOrder, setTriggerOrder] = useState([]);
  const [proliferateTargets, setProliferateTargets] = useState([]);
  const [phaseOutTargets, setPhaseOutTargets] = useState([]);
  const [replacementOrder, setReplacementOrder] = useState([]);
  const [exploreOrder, setExploreOrder] = useState([]);
  const [cultivateChoices, setCultivateChoices] = useState([]);
  const [triggerTargets, setTriggerTargets] = useState([]);
  const [effectChoices, setEffectChoices] = useState([]);
  const [copyTargets, setCopyTargets] = useState([]);
  const [abilitySelection, setAbilitySelection] = useState(null);
  const [autoPassAITurns, setAutoPassAITurns] = useState(true);
  const [holdPriority, setHoldPriority] = useState(false);
  const [skipNextHumanPriority, setSkipNextHumanPriority] = useState(false);
  const [automationError, setAutomationError] = useState('');
  const refresh = () => redraw(x => x + 1);

  const start = () => {
    const mine = selectableDecks.find(d => d.id === choice);
    if (!mine) throw new Error('Choose a playable deck before starting.');
    const others = selectableDecks.filter(d => d.id !== choice);
    const aiPool = others.length ? others : playableDecks.filter(d => d.id !== choice);
    if (aiPool.length < playerCount - 1) throw new Error(`At least ${playerCount} distinct playable decks are required for a ${playerCount}-player match.`);
    const shuffled = [...aiPool].sort(() => Math.random() - 0.5);
    const aiDecks = shuffled.slice(0, playerCount - 1);
    const e = new GameEngine(mine, aiDecks, db0);
    e.start();
    setEngine(e);
    setAttackers([]);
    setAttackTargets({});
    setAttackDefender(null);
    setBlockTarget(null);
    setBlockers({});
    setChoiceCards([]);
    setDamageOrders({});
    setCombatMessage('');
    setTargetingAction(null);
    setTriggerOrder([]);
    setProliferateTargets([]);
    setPhaseOutTargets([]);
    setReplacementOrder([]);
    setExploreOrder([]);
    setCultivateChoices([]);
    setTriggerTargets([]);
    setEffectChoices([]);
    setCopyTargets([]);
    setAbilitySelection(null);
    setHoldPriority(false);
    setSkipNextHumanPriority(false);
    setAutomationError('');
  };

  const importedCardCount = parseMassEntry(deckList).count;

  const importDeck = () => {
    try {
      const deck = buildCustomDeck({ name: deckName, commander: commanderName, list: deckList }, db0, selectableDecks);
      const next = [...customDecks, deck];
      setCustomDecks(next);
      saveCustomDecks(next);
      setChoice(deck.id);
      setDeckName('');
      setCommanderName('');
      setDeckList('');
      setDeckImportError('');
      setShowDeckImporter(false);
    } catch (err) {
      setDeckImportError(err.message);
    }
  };

  const removeSelectedCustomDeck = () => {
    const selected = customDecks.find(deck => deck.id === choice);
    if (!selected) return;
    const next = customDecks.filter(deck => deck.id !== choice);
    setCustomDecks(next);
    saveCustomDecks(next);
    setChoice(playableDecks[0]?.id || next[0]?.id || '');
  };

  useEffect(() => {
    if (!engine || automationError) return undefined;
    const s = engine.state;
    if (s.winner) return undefined;
    const actor = automationActor(engine);
    if (!actor) return undefined;

    if (actor === 'player') {
      const decision = humanAutomationDecision(engine, {
        playerId: 'player',
        autoPass: autoPassAITurns,
        holdPriority,
        skipNextPriority: skipNextHumanPriority
      });
      if (decision.mode !== 'AUTO_PASS') return undefined;
      const timer = window.setTimeout(() => {
        try {
          engine.perform('player', { type: 'PASS_PRIORITY' });
          if (skipNextHumanPriority) setSkipNextHumanPriority(false);
          refresh();
        } catch (err) {
          setAutomationError(`Automatic priority pass failed: ${err.message}`);
        }
      }, 70);
      return () => window.clearTimeout(timer);
    }

    if (s.players[actor]?.lost) return undefined;
    let action = null;
    try {
      action = new AIController(engine, actor).choose();
    } catch (err) {
      setAutomationError(`AI decision failed for ${s.players[actor]?.name || actor}: ${err.message}`);
      return undefined;
    }
    if (!action) {
      setAutomationError(`${s.players[actor]?.name || actor} could not choose a legal action.`);
      return undefined;
    }

    const quietAction = action.type === 'PASS_PRIORITY' || action.type.startsWith('CHOOSE_') || action.type === 'KEEP_HAND' || action.type === 'BOTTOM_CARDS';
    const delay = quietAction ? 70 : 300;
    const timer = window.setTimeout(() => {
      try {
        engine.perform(actor, action);
        refresh();
      } catch (err) {
        setAutomationError(`AI action ${action.type} failed for ${s.players[actor]?.name || actor}: ${err.message}`);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [engine, renderTick, autoPassAITurns, holdPriority, skipNextHumanPriority, automationError]);

  if (!engine) return <main className="setup">
    <div className="setup-panel">
      <div className="brand-mark">✦</div>
      <h1>MTG AI Trainer</h1>
      <p>Commander practice table</p>
      <label>Choose your deck</label>
      <select value={choice} onChange={e => setChoice(e.target.value)}>
        {selectableDecks.map(d => <option value={d.id} key={d.id}>{d.name}{d.custom ? ' — Custom' : ''}</option>)}
      </select>
      <label>Number of players</label>
      <div className="player-count-picker" role="group" aria-label="Number of players">
        {[2,3,4].map(count => <button key={count} type="button" className={playerCount === count ? 'selected' : ''} onClick={() => setPlayerCount(count)}>{count} Players</button>)}
      </div>
      <div className="setup-match-note">You + {playerCount - 1} AI opponent{playerCount === 2 ? '' : 's'}</div>
      <button className="primary" onClick={start}>Start {playerCount}-Player Match</button>
      <button className="secondary setup-secondary" onClick={() => { setDeckImportError(''); setShowDeckImporter(true); }}>+ Add Your Own Deck</button>
      {customDecks.some(deck => deck.id === choice) && <button className="text-button remove-deck" onClick={removeSelectedCustomDeck}>Remove selected custom deck</button>}
      {referenceDecks.length > 0 && <div className="reference-note"><b>Published deck reference preserved</b><span>{referenceDecks.map(d => d.name).join(', ')} is stored with its exact 100-card list but is disabled until every card mechanic is implemented. The supported trainer version remains playable.</span></div>}
    </div>
    {showDeckImporter && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setShowDeckImporter(false)}>
      <section className="deck-import-modal" role="dialog" aria-modal="true" aria-labelledby="deck-import-title">
        <button className="modal-close" aria-label="Close deck importer" onClick={() => setShowDeckImporter(false)}>×</button>
        <div className="modal-kicker">CUSTOM COMMANDER DECK</div>
        <h2 id="deck-import-title">Add Your Own Deck</h2>
        <p className="modal-copy">Paste the 99-card main deck in TCGPlayer Mass Entry format. Cards must already exist in this trainer’s local card database so their game mechanics can run correctly.</p>
        <div className="import-grid">
          <label>Deck name<input value={deckName} onChange={e => setDeckName(e.target.value)} placeholder="My Commander Deck" /></label>
          <label>Commander<input value={commanderName} onChange={e => setCommanderName(e.target.value)} placeholder="Hakbal of the Surging Soul" /></label>
        </div>
        <label className="deck-list-label"><span>99 other cards <b className={importedCardCount === 99 ? 'count-good' : ''}>{importedCardCount} / 99</b></span>
          <textarea value={deckList} onChange={e => { setDeckList(e.target.value); if (deckImportError) setDeckImportError(''); }} placeholder={'1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n13 Island\n...'} spellCheck="false" />
        </label>
        <div className="format-hint"><b>Accepted examples:</b> <code>1 Sol Ring</code>, <code>1x Sol Ring</code>, <code>13 Island</code>, <code>1 Sol Ring [CMM] 396</code></div>
        {deckImportError && <div className="import-error" role="alert">{deckImportError}</div>}
        <div className="modal-actions">
          <button className="secondary" onClick={() => setShowDeckImporter(false)}>Cancel</button>
          <button className="primary" onClick={importDeck}>Save Deck</button>
        </div>
      </section>
    </div>}
  </main>;

  const s = engine.state, p = s.players.player;
  const opponentEntries = s.playerOrder.filter(id => id !== 'player').map(id => [id, s.players[id]]);
  const livingOpponents = opponentEntries.filter(([, player]) => !player.lost);
  const playerLabel = id => id === 'player' ? 'You' : (s.players[id]?.name || 'Opponent');
  const latestActionFor = id => {
    const entry = [...(s.history || [])].reverse().find(item => item.controller === id && ['LAND_PLAYED', 'SPELL_CAST', 'DECLARE_ATTACKERS', 'DECLARE_BLOCKERS'].includes(item.type));
    if (!entry) return 'Waiting for first action';
    if (entry.type === 'LAND_PLAYED') {
      const name = engine.db[entry.target?.cardId]?.name || 'a land';
      return `Played ${name} · land play costs 0 mana`;
    }
    if (entry.type === 'SPELL_CAST') {
      const name = engine.db[entry.card?.cardId]?.name || 'a spell';
      return `Cast ${name}`;
    }
    if (entry.type === 'DECLARE_ATTACKERS') return 'Declared attackers';
    if (entry.type === 'DECLARE_BLOCKERS') return 'Declared blockers';
    return entry.type;
  };

  const act = action => {
    try {
      const onOpponentTurn = !s.pregame.active && s.activePlayer !== 'player';
      const voluntaryResponse = onOpponentTurn && ['CAST_SPELL', 'CAST_COMMANDER', 'ACTIVATE_ABILITY'].includes(action.type);
      engine.perform('player', action);
      setChoiceCards([]);
      setTargetingAction(null);
      setTriggerOrder([]);
      setProliferateTargets([]);
      setPhaseOutTargets([]);
      setReplacementOrder([]);
      setExploreOrder([]);
      setCultivateChoices([]);
      setTriggerTargets([]);
      setEffectChoices([]);
      setCopyTargets([]);
      setAbilitySelection(null);
      setHoldPriority(false);
      setSkipNextHumanPriority(voluntaryResponse && autoPassAITurns);
      setAutomationError('');
      refresh();
    } catch (err) { alert(err.message); }
  };

  const toggleChoiceCard = id => setChoiceCards(xs => xs.includes(id) ? xs.filter(x => x !== id) : [...xs, id]);

  if (s.pregame.active) {
    const pending = s.pendingChoice?.playerId === 'player' ? s.pendingChoice : null;
    const required = pending?.count || 0;
    const canDecide = s.pregame.currentPlayer === 'player';
    return <main className="setup pregame-shell">
      <div className="pregame-panel">
        <div className="brand-mark">✦</div>
        <h1>Opening Hand</h1>
        <p>{pending ? `Choose exactly ${required} card${required === 1 ? '' : 's'} to put on the bottom of your library.` : `Commander mulligan: your first mulligan is free. Mulligans taken: ${p.mulligans}.`}</p>
        <div className="pregame-hand">{p.hand.map(c => <Card key={c.instanceId} perm={c} def={engine.db[c.cardId]} selected={choiceCards.includes(c.instanceId)} onClick={() => pending && toggleChoiceCard(c.instanceId)} />)}</div>
        <div className="pregame-actions">
          {pending ? <button className="primary" disabled={choiceCards.length !== required} onClick={() => act({ type: 'BOTTOM_CARDS', cardInstanceIds: choiceCards })}>Put Selected on Bottom</button> : <>
            <button disabled={!canDecide} onClick={() => act({ type: 'MULLIGAN' })}>Mulligan</button>
            <button className="primary" disabled={!canDecide} onClick={() => act({ type: 'KEEP_HAND' })}>Keep Hand</button>
          </>}
        </div>
      </div>
    </main>;
  }

  const pendingCleanup = s.pendingChoice?.type === 'CLEANUP_DISCARD' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingDamageOrder = s.pendingChoice?.type === 'COMBAT_DAMAGE_ORDER' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingLegend = s.pendingChoice?.type === 'LEGEND_RULE' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingCommander = s.pendingChoice?.type === 'COMMANDER_ZONE' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingWard = s.pendingChoice?.type === 'WARD_PAYMENT' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingOptionalTrigger = s.pendingChoice?.type === 'OPTIONAL_TRIGGER' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingOptionalManaPayment = s.pendingChoice?.type === 'OPTIONAL_MANA_PAYMENT' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingTapOrUntap = s.pendingChoice?.type === 'TAP_OR_UNTAP' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingOptionalEffect = s.pendingChoice?.type === 'OPTIONAL_EFFECT' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingTriggerOrder = s.pendingChoice?.type === 'TRIGGER_ORDER' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingProliferate = s.pendingChoice?.type === 'PROLIFERATE' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingPhaseOut = s.pendingChoice?.type === 'PHASE_OUT_PROLIFERATED' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingReplacementOrder = s.pendingChoice?.type === 'REPLACEMENT_ORDER' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingExplore = s.pendingChoice?.type === 'EXPLORE_NONLAND' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingExploreOrder = s.pendingChoice?.type === 'EXPLORE_ORDER' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingHakbal = s.pendingChoice?.type === 'HAKBAL_ATTACK' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingCultivate = s.pendingChoice?.type === 'CULTIVATE_SEARCH' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingSisay = s.pendingChoice?.type === 'SISAY_TUTOR' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingScry = s.pendingChoice?.type === 'SCRY' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingTriggerTarget = s.pendingChoice?.type === 'TRIGGER_TARGET' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingCreatureType = s.pendingChoice?.type === 'CREATURE_TYPE' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingEffectCards = s.pendingChoice?.type === 'EFFECT_CARD_CHOICE' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingHideaway = s.pendingChoice?.type === 'HIDEAWAY' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingHideawayPlay = s.pendingChoice?.type === 'HIDEAWAY_PLAY' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingEntryReveal = s.pendingChoice?.type === 'ENTRY_REVEAL' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const pendingCopyTargets = s.pendingChoice?.type === 'COPY_TARGETS' && s.pendingChoice.playerId === 'player' ? s.pendingChoice : null;
  const legalAttackerIds = new Set(s.turnActionPending === 'DECLARE_ATTACKERS' && s.activePlayer === 'player'
    ? engine.combat.legalAttackers('player').map(x => x.instanceId)
    : []);
  const blockersValid = (() => {
    if (!(s.turnActionPending === 'DECLARE_BLOCKERS' && s.combat.currentDefender === 'player')) return true;
    try { engine.combat.validateBlockers('player', blockers); return true; }
    catch { return false; }
  })();
  const damageOrderReady = !pendingDamageOrder || Object.entries(pendingDamageOrder.attackers || {}).every(([aid, bids]) => {
    const order = damageOrders[aid] || [];
    return order.length === bids.length && new Set(order).size === bids.length && order.every(id => bids.includes(id));
  });

  const targetBounds = targetingAction ? engine.targeting.bounds(targetingAction.source) : { min: 0, max: 0 };
  const targetingCandidates = targetingAction
    ? engine.targeting.getCandidates('player', targetingAction.source, targetingAction.selectedTargets, { sourceObject: targetingAction.sourceObject })
    : [];
  const targetCandidateIds = new Set(targetingCandidates.map(candidate => candidate.id));
  const selectedTargetIds = new Set(targetingAction?.selectedTargets || []);
  const playerTargetCandidates = targetingCandidates.filter(candidate => candidate.kind === 'player');
  const offBoardTargetCandidates = targetingCandidates.filter(candidate => candidate.kind !== 'player' && candidate.zone !== 'battlefield');
  const targetSelectionReady = !!targetingAction
    && targetingAction.selectedTargets.length >= targetBounds.min
    && targetingAction.selectedTargets.length <= targetBounds.max;
  const copyTargetCandidates = pendingCopyTargets
    ? engine.targeting.getCandidates('player', pendingCopyTargets.targetSource, copyTargets, { sourceObject: pendingCopyTargets.copyItem?.card })
    : [];
  const copyTargetCount = pendingCopyTargets?.originalTargets?.length || 0;
  const copyTargetReady = !!pendingCopyTargets && copyTargets.length === copyTargetCount;
  const appendCopyTarget = id => setCopyTargets(ids => ids.length < copyTargetCount ? [...ids, id] : ids);
  const wardCostLabel = pendingWard
    ? [pendingWard.cost?.mana, pendingWard.cost?.life ? `${pendingWard.cost.life} life` : ''].filter(Boolean).join(' and ')
    : '';

  const toggleProliferateTarget = id => {
    if (!pendingProliferate?.eligibleIds.includes(id)) return;
    setProliferateTargets(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };
  const togglePhaseOutTarget = id => {
    if (!pendingPhaseOut?.eligibleIds.includes(id)) return;
    setPhaseOutTargets(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const appendTriggerOrder = id => setTriggerOrder(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const appendReplacementOrder = id => setReplacementOrder(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const appendExploreOrder = id => setExploreOrder(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const toggleCultivateChoice = id => setCultivateChoices(ids => ids.includes(id) ? ids.filter(x => x !== id) : (ids.length < 2 ? [...ids, id] : ids));
  const toggleTriggerTarget = id => setTriggerTargets(ids => ids.includes(id) ? ids.filter(x => x !== id) : (ids.length < (pendingTriggerTarget?.maxTargets || 1) ? [...ids, id] : ids));
  const toggleEffectChoice = id => setEffectChoices(ids => ids.includes(id)
    ? ids.filter(x => x !== id)
    : (ids.length < (pendingEffectCards?.max || 1) ? [...ids, id] : ids));
  const cardNameForInstance = id => {
    const permanent = engine.findPermanent(id);
    if (permanent) return engine.db[permanent.cardId]?.name || permanent.cardId;
    for (const player of Object.values(s.players)) {
      for (const zone of ['hand', 'library', 'graveyard', 'exile', 'command']) {
        const card = player[zone]?.find(item => item.instanceId === id);
        if (card) return engine.db[card.cardId]?.name || card.cardId;
      }
    }
    if (s.players[id]) return playerLabel(id);
    return id;
  };
  const hideawayPlayCard = pendingHideawayPlay ? p.exile.find(card => card.instanceId === pendingHideawayPlay.cardInstanceId) : null;
  const hideawayPlayActions = pendingHideawayPlay ? engine.getLegalActions('player').filter(action => action.cardInstanceId === pendingHideawayPlay.cardInstanceId) : [];
  const hideawayCastActions = hideawayPlayActions.filter(action => action.type === 'CAST_SPELL');
  const hideawayLandAction = hideawayPlayActions.find(action => action.type === 'PLAY_HIDEAWAY_LAND') || null;

  const beginTargeting = (action, source, sourceObject, label) => {
    if (!engine.targeting.hasTargets(source)) { act(action); return; }
    const { targets: _ignoredTargets, ...baseAction } = action;
    setCombatMessage('');
    setTargetingAction({ baseAction, source, sourceObject, label, selectedTargets: [] });
  };

  const chooseCardAction = (card, actions) => {
    if (!actions.length) return;
    const definition = engine.db[card.cardId];
    const explicitModes = definition.modes || []; // retained for ordinary modal cards; dynamic X modes are supplied by the engine.
    const foretellAction = actions.find(action => action.type === 'FORETELL_CARD');
    const castActions = actions.filter(action => ['CAST_SPELL', 'CAST_COMMANDER'].includes(action.type));
    if (foretellAction && castActions.length) {
      const raw = window.prompt(`Choose action for ${definition?.name || card.cardId}:\n1. Cast/play it now\n2. Foretell it for {2}`)?.trim();
      if (!raw) return;
      if (raw === '2' || raw.toLowerCase() === 'foretell') { act(foretellAction); return; }
      if (raw !== '1' && raw.toLowerCase() !== 'cast' && raw.toLowerCase() !== 'play') { alert('Choose 1 to cast or 2 to foretell.'); return; }
      actions = castActions;
    } else if (foretellAction && !castActions.length) {
      act(foretellAction);
      return;
    } else if (castActions.length) {
      actions = castActions;
    }

    const modeIds = [...new Set(actions.map(action => action.mode).filter(Boolean))];
    let action = actions[0];
    let targetSource = definition;
    let label = definition?.name || card.cardId;
    if (modeIds.length) {
      let selectedMode = modeIds[0];
      if (modeIds.length > 1) {
        const menu = modeIds.map((id, index) => `${index + 1}. ${engine.targetSourceForAction({ mode: id }, definition)?.label || explicitModes.find(mode => mode.id === id)?.label || id}`).join('\n');
        const raw = window.prompt(`Choose mode for ${definition.name}:\n${menu}`)?.trim();
        if (!raw) return;
        const numeric = Number(raw);
        selectedMode = Number.isInteger(numeric) && numeric >= 1 && numeric <= modeIds.length ? modeIds[numeric - 1] : raw;
        if (!modeIds.includes(selectedMode)) { alert('Choose one of the listed modes.'); return; }
      }
      actions = actions.filter(candidate => candidate.mode === selectedMode);
      action = actions[0] || action;
      targetSource = engine.targetSourceForAction({ mode: selectedMode }, definition) || definition;
      label = `${definition.name} — ${targetSource.label || selectedMode}`;
    }
    const retraceActions = actions.filter(candidate => candidate.castOption === 'retrace' && candidate.retraceLandInstanceId);
    if (retraceActions.length > 1) {
      const menu = retraceActions.map((candidate, index) => `${index + 1}. ${cardNameForInstance(candidate.retraceLandInstanceId)}`).join('\n');
      const raw = window.prompt(`Choose the land to discard for retrace:\n${menu}`)?.trim();
      if (!raw) return;
      const numeric = Number(raw);
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > retraceActions.length) { alert('Choose one of the listed lands.'); return; }
      action = retraceActions[numeric - 1];
    } else if (retraceActions.length === 1) {
      action = retraceActions[0];
    }
    if (engine.targeting.hasTargets(targetSource)) beginTargeting(action, targetSource, card, label);
    else act(action);
  };

  const abilityLabel = (ability, index = 0) => {
    const cost = [ability.cost?.mana || ability.manaCost || '', ability.tap ? '{T}' : '', ability.selection?.count ? `tap ${ability.selection.count}` : ''].filter(Boolean).join(', ');
    const effect = ability.effect?.type || 'ability';
    const names = {
      addKeywordSource: 'Make this creature unblockable this turn',
      draw: `Draw ${ability.effect?.amount || 1} card${Number(ability.effect?.amount || 1) === 1 ? '' : 's'}`,
      addCountersAll: 'Put counters on your creatures',
      proliferate: 'Proliferate',
      attachEquipment: 'Equip',
      cantBeBlocked: 'Make target creature unblockable',
      doubleCounters: 'Double counters',
      levelUp: 'Level up',
      adapt: 'Adapt'
    };
    return `${cost ? `${cost}: ` : ''}${names[effect] || `Activated ability ${index + 1}`}`;
  };

  const chooseActivatedAbility = (perm, actions) => {
    const unique = [];
    const seen = new Set();
    for (const action of actions) {
      const key = JSON.stringify(action.ability);
      if (!seen.has(key)) { seen.add(key); unique.push(action.ability); }
    }
    let ability = unique[0];
    if (unique.length > 1) {
      const menu = unique.map((candidate, index) => `${index + 1}. ${abilityLabel(candidate, index)}`).join('\n');
      const raw = window.prompt(`Choose an ability for ${engine.db[perm.cardId]?.name || perm.cardId}:\n${menu}`)?.trim();
      if (!raw) return;
      const index = Number(raw) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= unique.length) { alert('Choose one of the listed ability numbers.'); return; }
      ability = unique[index];
    }

    if (ability.selection) {
      const candidates = engine._selectionCandidates('player', perm, ability.selection).map(card => card.instanceId);
      setAbilitySelection({
        permanentId: perm.instanceId,
        ability,
        label: abilityLabel(ability, unique.indexOf(ability)),
        count: Number(ability.selection.count || 0),
        candidateIds: candidates,
        selectedIds: []
      });
      setCombatMessage('');
      return;
    }

    const action = { type: 'ACTIVATE_ABILITY', permanentId: perm.instanceId, ability, selections: [] };
    if (engine.targeting.hasTargets(ability)) beginTargeting(action, ability, perm, engine.db[perm.cardId]?.name || 'ability');
    else act(action);
  };

  const toggleAbilitySelection = id => {
    if (!abilitySelection?.candidateIds.includes(id)) return;
    setAbilitySelection(current => {
      const selected = current.selectedIds.includes(id)
        ? current.selectedIds.filter(x => x !== id)
        : (current.selectedIds.length < current.count ? [...current.selectedIds, id] : current.selectedIds);
      return { ...current, selectedIds: selected };
    });
  };

  const confirmAbilitySelection = () => {
    if (!abilitySelection || abilitySelection.selectedIds.length !== abilitySelection.count) return;
    const perm = engine.findPermanent(abilitySelection.permanentId);
    const action = { type: 'ACTIVATE_ABILITY', permanentId: abilitySelection.permanentId, ability: abilitySelection.ability, selections: [...abilitySelection.selectedIds] };
    if (engine.targeting.hasTargets(abilitySelection.ability)) {
      const choice = abilitySelection;
      setAbilitySelection(null);
      beginTargeting(action, choice.ability, perm, engine.db[perm?.cardId]?.name || 'ability');
    } else act(action);
  };

  const selectTarget = targetId => {
    if (!targetingAction) return;
    if (!targetCandidateIds.has(targetId)) {
      setCombatMessage('That object is not a legal target for the selected spell or ability.');
      return;
    }
    const nextTargets = [...targetingAction.selectedTargets, targetId];
    setCombatMessage('');
    if (nextTargets.length >= targetBounds.max) {
      act({ ...targetingAction.baseAction, targets: nextTargets });
      return;
    }
    setTargetingAction(current => ({ ...current, selectedTargets: nextTargets }));
  };

  const confirmTargets = () => {
    if (!targetingAction || !targetSelectionReady) return;
    act({ ...targetingAction.baseAction, targets: [...targetingAction.selectedTargets] });
  };

  const clickOwnPermanent = perm => {
    if (abilitySelection) { toggleAbilitySelection(perm.instanceId); return; }
    if (pendingProliferate) { toggleProliferateTarget(perm.instanceId); return; }
    if (pendingPhaseOut) { togglePhaseOutTarget(perm.instanceId); return; }
    if (targetingAction) { selectTarget(perm.instanceId); return; }
    if (s.turnActionPending === 'DECLARE_ATTACKERS' && s.activePlayer === 'player') {
      if (!legalAttackerIds.has(perm.instanceId)) {
        setCombatMessage('That permanent is not a legal attacker. Only untapped creatures that can attack may be selected.');
        return;
      }
      if (attackers.includes(perm.instanceId)) {
        setCombatMessage('');
        setAttackers(xs => xs.filter(x => x !== perm.instanceId));
        setAttackTargets(current => { const next = { ...current }; delete next[perm.instanceId]; return next; });
        return;
      }
      const defender = attackDefender && !s.players[attackDefender]?.lost ? attackDefender : livingOpponents[0]?.[0];
      if (!defender) {
        setCombatMessage('There is no living opponent to attack.');
        return;
      }
      setCombatMessage('');
      setAttackers(xs => [...xs, perm.instanceId]);
      setAttackTargets(current => ({ ...current, [perm.instanceId]: defender }));
      return;
    }
    if (s.turnActionPending === 'DECLARE_BLOCKERS' && s.combat.currentDefender === 'player' && blockTarget) {
      const attacker = engine.findPermanent(blockTarget);
      const existingAid = Object.entries(blockers).find(([, ids]) => ids.includes(perm.instanceId))?.[0];
      if (existingAid === blockTarget) {
        setCombatMessage('');
        setBlockers(m => Object.fromEntries(Object.entries(m)
          .map(([aid, ids]) => [aid, ids.filter(x => x !== perm.instanceId)])
          .filter(([, ids]) => ids.length)));
        return;
      }
      if (!engine.combat.canBlock(perm, attacker)) {
        setCombatMessage('That permanent cannot legally block the selected attacker.');
        return;
      }
      setCombatMessage('');
      setBlockers(m => {
        const cleaned = Object.fromEntries(Object.entries(m)
          .map(([aid, ids]) => [aid, ids.filter(x => x !== perm.instanceId)])
          .filter(([, ids]) => ids.length));
        return { ...cleaned, [blockTarget]: [...(cleaned[blockTarget] || []), perm.instanceId] };
      });
      return;
    }
    const activatedActions = engine.getLegalActions('player').filter(x => x.type === 'ACTIVATE_ABILITY' && x.permanentId === perm.instanceId);
    if (activatedActions.length) {
      chooseActivatedAbility(perm, activatedActions);
      return;
    }
    const manaActions = engine.getLegalActions('player').filter(x => x.type === 'ACTIVATE_MANA' && x.permanentId === perm.instanceId);
    if (manaActions.length === 1) act(manaActions[0]);
    else if (manaActions.length > 1) {
      const choices = manaActions.map(x => x.manaColor).filter(Boolean);
      const selected = window.prompt(`Choose mana color: ${choices.join(', ')}`)?.trim().toUpperCase();
      const action = manaActions.find(x => x.manaColor === selected);
      if (action) act(action);
      else if (selected) alert('Choose one of the listed mana colors.');
    }
  };

  const clickOpponent = (opponentId, perm) => {
    if (pendingProliferate) { toggleProliferateTarget(perm.instanceId); return; }
    if (targetingAction) { selectTarget(perm.instanceId); return; }
    if (pendingDamageOrder) {
      const entry = Object.entries(pendingDamageOrder.attackers || {}).find(([, bids]) => bids.includes(perm.instanceId));
      if (!entry) return;
      const [aid, bids] = entry;
      setDamageOrders(current => {
        const order = current[aid] || [];
        if (order.includes(perm.instanceId)) return { ...current, [aid]: order.filter(id => id !== perm.instanceId) };
        if (order.length >= bids.length) return current;
        return { ...current, [aid]: [...order, perm.instanceId] };
      });
      return;
    }
    if (s.turnActionPending === 'DECLARE_BLOCKERS'
      && s.combat.currentDefender === 'player'
      && s.combat.attackers.includes(perm.instanceId)
      && s.combat.attackTargets?.[perm.instanceId] === 'player') {
      setCombatMessage('');
      setBlockTarget(perm.instanceId);
    }
  };

  const next = () => {
    if (targetingAction || pendingWard || pendingLegend || pendingCommander || pendingOptionalTrigger || pendingOptionalManaPayment || pendingTapOrUntap || pendingOptionalEffect || pendingExplore || pendingHakbal || pendingSisay || pendingScry || pendingCreatureType || pendingHideaway || pendingHideawayPlay || pendingEntryReveal || pendingCopyTargets) return;
    if (abilitySelection) {
      confirmAbilitySelection();
      return;
    }
    if (pendingEffectCards) {
      act({ type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: effectChoices });
      return;
    }
    if (pendingExploreOrder) {
      act({ type: 'ORDER_EXPLORES', permanentIds: exploreOrder });
      return;
    }
    if (pendingCultivate) {
      act({ type: 'CHOOSE_CULTIVATE', cardInstanceIds: cultivateChoices });
      return;
    }
    if (pendingTriggerTarget) {
      act({ type: 'CHOOSE_TRIGGER_TARGET', targetIds: triggerTargets });
      return;
    }
    if (pendingTriggerOrder) {
      act({ type: 'ORDER_TRIGGERS', triggerIds: triggerOrder });
      return;
    }
    if (pendingProliferate) {
      act({ type: 'CHOOSE_PROLIFERATE', targetIds: proliferateTargets });
      return;
    }
    if (pendingPhaseOut) {
      act({ type: 'CHOOSE_PHASE_OUT_PROLIFERATED', permanentIds: phaseOutTargets });
      return;
    }
    if (pendingReplacementOrder) {
      act({ type: 'ORDER_REPLACEMENTS', replacementIds: replacementOrder });
      return;
    }
    if (pendingCleanup) {
      act({ type: 'DISCARD_CARDS', cardInstanceIds: choiceCards });
      return;
    }
    if (pendingDamageOrder) {
      act({ type: 'ORDER_BLOCKERS', orders: damageOrders });
      setDamageOrders({});
      return;
    }
    if (s.turnActionPending === 'DECLARE_ATTACKERS' && s.activePlayer === 'player') {
      act({ type: 'DECLARE_ATTACKERS', attackers, attackTargets });
      setAttackers([]);
      setAttackTargets({});
      setAttackDefender(null);
      return;
    }
    if (s.turnActionPending === 'DECLARE_BLOCKERS' && s.combat.currentDefender === 'player') {
      act({ type: 'DECLARE_BLOCKERS', blockers });
      setBlockers({});
      setBlockTarget(null);
      return;
    }
    act({ type: 'PASS_PRIORITY' });
  };

  const castCommander = () => {
    const c = p.command[0];
    if (!c || targetingAction) return;
    const actions = engine.getLegalActions('player').filter(action => action.cardInstanceId === c.instanceId);
    chooseCardAction(c, actions);
  };

  const buttonText = targetingAction ? 'Choose Target'
    : pendingWard || pendingOptionalTrigger || pendingOptionalManaPayment || pendingTapOrUntap || pendingOptionalEffect || pendingExplore || pendingHakbal || pendingSisay || pendingScry || pendingCreatureType || pendingHideaway || pendingHideawayPlay || pendingEntryReveal || pendingCopyTargets ? 'Resolve Required Choice'
      : abilitySelection ? `Confirm ${abilitySelection.selectedIds.length}/${abilitySelection.count} Selected`
        : pendingEffectCards ? `Confirm ${effectChoices.length} Card${effectChoices.length === 1 ? '' : 's'}`
      : pendingExploreOrder ? 'Confirm Explore Order'
        : pendingCultivate ? 'Confirm Cultivate Choices'
          : pendingTriggerTarget ? 'Confirm Trigger Target'
            : pendingTriggerOrder ? 'Confirm Trigger Order'
              : pendingProliferate ? 'Confirm Proliferate Selection'
                : pendingPhaseOut ? 'Confirm Phase-Out Selection'
                : pendingReplacementOrder ? 'Confirm Replacement Order'
                  : pendingCleanup ? `Discard ${pendingCleanup.count} Selected Card${pendingCleanup.count === 1 ? '' : 's'}`
                    : pendingDamageOrder ? 'Confirm Damage Order'
                      : s.turnActionPending === 'DECLARE_ATTACKERS' ? 'Confirm Attackers'
                        : s.turnActionPending === 'DECLARE_BLOCKERS' ? 'Confirm Blockers'
                          : pendingLegend || pendingCommander ? 'Make Required Choice'
                            : (!s.pregame.active && s.activePlayer !== 'player' && s.priorityPlayer === 'player') ? 'Pass & Resume AI'
                              : 'Pass Priority';
  const buttonDisabled = !!targetingAction
    || (!!abilitySelection && abilitySelection.selectedIds.length !== abilitySelection.count)
    || (!!pendingEffectCards && (effectChoices.length < pendingEffectCards.min || effectChoices.length > pendingEffectCards.max))
    || !!pendingWard
    || !!pendingOptionalTrigger
    || !!pendingOptionalManaPayment
    || !!pendingTapOrUntap
    || !!pendingOptionalEffect
    || !!pendingExplore
    || !!pendingHakbal
    || !!pendingSisay
    || !!pendingScry
    || !!pendingCreatureType
    || !!pendingHideaway
    || !!pendingHideawayPlay
    || !!pendingEntryReveal
    || !!pendingCopyTargets
    || (!!pendingExploreOrder && exploreOrder.length !== pendingExploreOrder.permanentIds.length)
    || (!!pendingTriggerTarget && (triggerTargets.length < pendingTriggerTarget.minTargets || triggerTargets.length > pendingTriggerTarget.maxTargets))
    || (!!pendingTriggerOrder && triggerOrder.length !== pendingTriggerOrder.triggerIds.length)
    || (!!pendingReplacementOrder && replacementOrder.length !== pendingReplacementOrder.replacementIds.length)
    || (!!pendingCleanup && choiceCards.length !== pendingCleanup.count)
    || (!!pendingDamageOrder && !damageOrderReady)
    || !!pendingLegend
    || !!pendingCommander
    || (s.turnActionPending === 'DECLARE_BLOCKERS' && s.combat.currentDefender === 'player' && !blockersValid);
  const playerSelected = id => targetCandidateIds.has(id) || selectedTargetIds.has(id) || proliferateTargets.includes(id) || phaseOutTargets.includes(id) || attackers.includes(id) || Object.values(blockers).flat().includes(id) || abilitySelection?.candidateIds.includes(id) || abilitySelection?.selectedIds.includes(id);
  const damageOrderSelected = id => Object.values(damageOrders).flat().includes(id);
  const legacyPriorityText = s.priorityPlayer === 'player' ? 'You have priority' : 'Opponent has priority';
  const priorityText = s.priorityPlayer === 'player' ? 'You have priority' : (s.priorityPlayer ? `${playerLabel(s.priorityPlayer)} has priority` : legacyPriorityText);
  const automationDecision = humanAutomationDecision(engine, {
    playerId: 'player',
    autoPass: autoPassAITurns,
    holdPriority,
    skipNextPriority: skipNextHumanPriority
  });
  const aiTurnHumanPriority = !s.pregame.active && s.activePlayer !== 'player' && s.priorityPlayer === 'player';
  const aiTurnPausedForHuman = aiTurnHumanPriority && automationDecision.mode === 'PAUSE';
  const topStackItem = s.stack[s.stack.length - 1];
  const topStackName = topStackItem
    ? (engine.db[topStackItem.card?.cardId]?.name || engine.db[topStackItem.source?.cardId]?.name || (topStackItem.type === 'ward' ? 'Ward ability' : 'spell or ability'))
    : null;
  const specialZoneActionGroups = (() => {
    const actions = engine.getLegalActions('player').filter(action => action.cardInstanceId && !p.hand.some(card => card.instanceId === action.cardInstanceId) && !p.command.some(card => card.instanceId === action.cardInstanceId));
    const grouped = new Map();
    for (const action of actions) {
      const list = grouped.get(action.cardInstanceId) || [];
      list.push(action);
      grouped.set(action.cardInstanceId, list);
    }
    return [...grouped.entries()].map(([cardInstanceId, cardActions]) => ({ cardInstanceId, cardActions }));
  })();

  return <main className="game-shell">
    <PhaseBanner state={s} attackers={attackers} blockTarget={blockTarget} />
    {automationError && <div className="decision-banner automation-error" role="alert"><b>Automation paused</b> — {automationError} <button onClick={() => setAutomationError('')}>Retry</button></div>}
    {aiTurnPausedForHuman && !s.pendingChoice && s.turnActionPending !== 'DECLARE_BLOCKERS' && <div className="decision-banner response-window-banner">
      <b>{automationDecision.kind === 'held-priority' ? 'Priority held' : automationDecision.kind === 'manual-priority' ? 'Manual priority' : 'Response window'}</b> — {topStackName && automationDecision.kind === 'stack-response' ? `${topStackName} is on the stack. ` : ''}{automationDecision.reason} Use a highlighted instant/ability, or pass to resume the AI turn.
    </div>}
    {pendingCleanup && <div className="decision-banner">Cleanup: select exactly <b>{pendingCleanup.count}</b> card{pendingCleanup.count === 1 ? '' : 's'} from your hand to discard.</div>}
    {pendingDamageOrder && <div className="decision-banner">Combat damage order: click each blocking creature in the order you want the attacker to assign damage. {Object.entries(pendingDamageOrder.attackers || {}).map(([aid, bids]) => {
      const attacker = engine.findPermanent(aid);
      const picked = damageOrders[aid] || [];
      return <span key={aid}> <b>{engine.db[attacker?.cardId]?.name || 'Attacker'}:</b> {picked.length}/{bids.length} ordered.</span>;
    })}</div>}
    {pendingLegend && <div className="decision-banner">
      Legend rule: choose one <b>{pendingLegend.cardName}</b> to keep.{' '}
      {pendingLegend.permanentIds.map((id, index) => <button key={id} onClick={() => act({ type: 'CHOOSE_LEGEND', keepInstanceId: id })}>Keep copy {index + 1}</button>)}
    </div>}
    {pendingCommander && <div className="decision-banner">
      Your commander is in {pendingCommander.fromZone}. Move it to the command zone?{' '}
      <button className="primary" onClick={() => act({ type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: true })}>Move to Command Zone</button>{' '}
      <button onClick={() => act({ type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: false })}>Leave It There</button>
    </div>}
    {pendingWard && <div className="decision-banner ward-banner">
      Ward — <b>{pendingWard.sourceName}</b> requires {wardCostLabel || 'its ward cost'}. Pay it or the spell/ability targeting that permanent will be countered.{' '}
      <button className="primary" disabled={!engine.canPayWard(pendingWard)} onClick={() => act({ type: 'PAY_WARD' })}>Pay {wardCostLabel || 'Ward'}</button>{' '}
      <button onClick={() => act({ type: 'DECLINE_WARD' })}>Do Not Pay</button>
    </div>}
    {pendingOptionalTrigger && <div className="decision-banner">
      Optional trigger — <b>{pendingOptionalTrigger.sourceName}</b>. Put this trigger on the stack?{' '}
      <button className="primary" onClick={() => act({ type: 'CHOOSE_TRIGGER', accept: true, triggerId: pendingOptionalTrigger.triggerId })}>Use Trigger</button>{' '}
      <button onClick={() => act({ type: 'CHOOSE_TRIGGER', accept: false, triggerId: pendingOptionalTrigger.triggerId })}>Decline</button>
    </div>}
    {pendingOptionalManaPayment && <div className="decision-banner">
      <b>{pendingOptionalManaPayment.sourceName}</b> — you may pay <b>{pendingOptionalManaPayment.mana}</b>.{' '}
      <button className="primary" onClick={() => act({ type: 'CHOOSE_OPTIONAL_MANA_PAYMENT', pay: true })}>Pay {pendingOptionalManaPayment.mana}</button>{' '}
      <button onClick={() => act({ type: 'CHOOSE_OPTIONAL_MANA_PAYMENT', pay: false })}>Do Not Pay</button>
    </div>}
    {pendingTapOrUntap && <div className="decision-banner">
      <b>{pendingTapOrUntap.sourceName}</b> — choose what to do with <b>{pendingTapOrUntap.targetName || cardNameForInstance(pendingTapOrUntap.targetId)}</b>.{' '}
      <button className="primary" onClick={() => act({ type: 'CHOOSE_TAP_OR_UNTAP', choice: 'tap' })}>Tap It</button>{' '}
      <button className="primary" onClick={() => act({ type: 'CHOOSE_TAP_OR_UNTAP', choice: 'untap' })}>Untap It</button>{' '}
      <button onClick={() => act({ type: 'CHOOSE_TAP_OR_UNTAP', choice: 'none' })}>Do Nothing</button>
    </div>}
    {pendingOptionalEffect && <div className="decision-banner">
      <b>{pendingOptionalEffect.sourceName}</b> — {pendingOptionalEffect.prompt || 'Use this optional effect?'}{' '}
      <button className="primary" onClick={() => act({ type: 'CHOOSE_OPTIONAL_EFFECT', accept: true })}>Use Effect</button>{' '}
      <button onClick={() => act({ type: 'CHOOSE_OPTIONAL_EFFECT', accept: false })}>Decline</button>
    </div>}
    {pendingTriggerOrder && <div className="decision-banner">
      Simultaneous triggers — choose the order to put your triggers on the stack. The last one placed will resolve first.{' '}
      {(pendingTriggerOrder.triggers || []).map(trigger => <button key={trigger.id} disabled={triggerOrder.includes(trigger.id)} onClick={() => appendTriggerOrder(trigger.id)}>{triggerOrder.indexOf(trigger.id) >= 0 ? `${triggerOrder.indexOf(trigger.id) + 1}. ` : ''}{trigger.sourceName}</button>)}{' '}
      {triggerOrder.length > 0 && <button onClick={() => setTriggerOrder([])}>Reset Order</button>}
    </div>}
    {pendingProliferate && <div className="decision-banner">
      Proliferate — choose any number of permanents or players that already have counters. Click eligible permanents on the battlefield.{' '}
      {s.playerOrder.filter(id => pendingProliferate.eligibleIds.includes(id)).map(id => <button key={id} onClick={() => toggleProliferateTarget(id)}>{proliferateTargets.includes(id) ? '✓ ' : ''}{playerLabel(id)}</button>)}{' '}
      <span>{proliferateTargets.length} selected</span>
    </div>}
    {pendingPhaseOut && <div className="decision-banner">
      <b>Ripples of Potential</b> — choose any number of your permanents that received a counter from this proliferate to phase out. Click them on the battlefield, then confirm.{' '}
      {pendingPhaseOut.eligibleIds.map(id => <button key={id} onClick={() => togglePhaseOutTarget(id)}>{phaseOutTargets.includes(id) ? '✓ ' : ''}{cardNameForInstance(id)}</button>)}{' '}
      <span>{phaseOutTargets.length} selected</span>{' '}
      {phaseOutTargets.length > 0 && <button onClick={() => setPhaseOutTargets([])}>Clear</button>}
    </div>}
    {pendingReplacementOrder && <div className="decision-banner">
      Multiple replacement effects apply. Choose their application order.{' '}
      {(pendingReplacementOrder.replacements || []).map(replacement => <button key={replacement.id} disabled={replacementOrder.includes(replacement.id)} onClick={() => appendReplacementOrder(replacement.id)}>{replacementOrder.indexOf(replacement.id) >= 0 ? `${replacementOrder.indexOf(replacement.id) + 1}. ` : ''}{replacement.sourceName}</button>)}{' '}
      {replacementOrder.length > 0 && <button onClick={() => setReplacementOrder([])}>Reset Order</button>}
    </div>}
    {pendingExplore && <div className="decision-banner explore-banner">
      Explore revealed <b>{pendingExplore.cardName}</b>, a nonland. The exploring creature received a +1/+1 counter.{' '}
      <button className="primary" onClick={() => act({ type: 'CHOOSE_EXPLORE', putInGraveyard: false })}>Keep on Top</button>{' '}
      <button onClick={() => act({ type: 'CHOOSE_EXPLORE', putInGraveyard: true })}>Put in Graveyard</button>
    </div>}
    {pendingExploreOrder && <div className="decision-banner explore-banner">
      Hakbal — choose the order your Merfolk explore.{' '}
      {pendingExploreOrder.permanentIds.map(id => <button key={id} disabled={exploreOrder.includes(id)} onClick={() => appendExploreOrder(id)}>{exploreOrder.indexOf(id) >= 0 ? `${exploreOrder.indexOf(id) + 1}. ` : ''}{cardNameForInstance(id)}</button>)}{' '}
      {exploreOrder.length > 0 && <button onClick={() => setExploreOrder([])}>Reset Order</button>}
    </div>}
    {pendingHakbal && <div className="decision-banner">
      Hakbal attack — you may put a land from your hand onto the battlefield. If you do not, draw a card.{' '}
      {pendingHakbal.landInstanceIds.map(id => <button key={id} className="primary" onClick={() => act({ type: 'CHOOSE_HAKBAL_ATTACK', landInstanceId: id })}>Put {cardNameForInstance(id)} onto Battlefield</button>)}{' '}
      <button onClick={() => act({ type: 'CHOOSE_HAKBAL_ATTACK', landInstanceId: null })}>Draw a Card</button>
    </div>}
    {pendingCultivate && <div className="decision-banner">
      Cultivate — choose up to two basic lands. Your <b>first</b> selection enters tapped; your <b>second</b> goes to your hand.{' '}
      {pendingCultivate.eligibleIds.map(id => <button key={id} onClick={() => toggleCultivateChoice(id)}>{cultivateChoices.includes(id) ? `${cultivateChoices.indexOf(id) + 1}. ✓ ` : ''}{cardNameForInstance(id)}</button>)}{' '}
      <span>{cultivateChoices.length}/2 selected</span>{' '}
      {cultivateChoices.length > 0 && <button onClick={() => setCultivateChoices([])}>Clear</button>}
    </div>}
    {pendingSisay && <div className="decision-banner">
      Sisay — choose a legendary permanent card with mana value less than {pendingSisay.sourcePower}.{' '}
      {pendingSisay.eligibleIds.map(id => <button key={id} className="primary" onClick={() => act({ type: 'CHOOSE_SISAY_TUTOR', cardInstanceId: id })}>Find {cardNameForInstance(id)}</button>)}{' '}
      <button onClick={() => act({ type: 'CHOOSE_SISAY_TUTOR', cardInstanceId: null })}>Find Nothing</button>
    </div>}
    {pendingScry && <div className="decision-banner">
      Scry 1 — top card: <b>{pendingScry.cardName}</b>.{' '}
      <button className="primary" onClick={() => act({ type: 'CHOOSE_SCRY', putOnBottom: false })}>Keep on Top</button>{' '}
      <button onClick={() => act({ type: 'CHOOSE_SCRY', putOnBottom: true })}>Put on Bottom</button>
    </div>}
    {pendingCreatureType && <div className="decision-banner">
      <b>{pendingCreatureType.cardName || 'Choose a creature type'}</b> — choose a creature type.{' '}
      {pendingCreatureType.options.map(type => <button key={type} className={type === 'Merfolk' ? 'primary' : ''} onClick={() => act({ type: 'CHOOSE_CREATURE_TYPE', creatureType: type })}>{type}</button>)}
    </div>}
    {pendingEffectCards && <div className="decision-banner">
      <b>{pendingEffectCards.prompt || 'Choose cards'}</b>{' '}
      {pendingEffectCards.candidateIds.map(id => <button key={id} onClick={() => toggleEffectChoice(id)}>{effectChoices.includes(id) ? '✓ ' : ''}{cardNameForInstance(id)}</button>)}{' '}
      <span>{effectChoices.length} selected (choose {pendingEffectCards.min === pendingEffectCards.max ? pendingEffectCards.min : `${pendingEffectCards.min}–${pendingEffectCards.max}`})</span>{' '}
      {effectChoices.length > 0 && <button onClick={() => setEffectChoices([])}>Clear</button>}
    </div>}
    {pendingHideaway && <div className="decision-banner">
      Hideaway {pendingHideaway.count || pendingHideaway.candidateIds.length} — choose one card to exile face down.{' '}
      {pendingHideaway.candidateIds.map(id => <button key={id} className="primary" onClick={() => act({ type: 'CHOOSE_HIDEAWAY', cardInstanceId: id })}>{cardNameForInstance(id)}</button>)}
    </div>}
    {pendingHideawayPlay && <div className="decision-banner">
      <b>Mosswort Bridge</b> — creatures you control have enough total power. You may play <b>{pendingHideawayPlay.cardName || cardNameForInstance(pendingHideawayPlay.cardInstanceId)}</b> now without paying its mana cost.{' '}
      {hideawayLandAction && <button className="primary" onClick={() => act(hideawayLandAction)}>Play Hidden Land</button>}{' '}
      {hideawayCastActions.length > 0 && hideawayPlayCard && <button className="primary" onClick={() => chooseCardAction(hideawayPlayCard, hideawayCastActions)}>Cast Hidden Card</button>}{' '}
      {!hideawayLandAction && hideawayCastActions.length === 0 && <span>The hidden card cannot legally be played right now. </span>}
      <button onClick={() => act({ type: 'DECLINE_HIDEAWAY_PLAY', cardInstanceId: pendingHideawayPlay.cardInstanceId })}>Do Not Play It</button>
    </div>}
    {pendingEntryReveal && <div className="decision-banner">
      <b>{pendingEntryReveal.cardName}</b> — you may reveal a qualifying land card from your hand so it enters untapped.{' '}
      {pendingEntryReveal.candidateIds.map(id => <button key={id} className="primary" onClick={() => act({ type: 'CHOOSE_ENTRY_REVEAL', cardInstanceId: id })}>Reveal {cardNameForInstance(id)}</button>)}{' '}
      <button onClick={() => act({ type: 'CHOOSE_ENTRY_REVEAL', cardInstanceId: null })}>Reveal Nothing (enter tapped)</button>
    </div>}
    {pendingCopyTargets && <div className="decision-banner targeting-banner">
      <b>{pendingCopyTargets.sourceName}</b> copy — you may choose new target{copyTargetCount === 1 ? '' : 's'}.{' '}
      <button className="primary" onClick={() => act({ type: 'CHOOSE_COPY_TARGETS', targetIds: [...pendingCopyTargets.originalTargets] })}>Keep Original Target{copyTargetCount === 1 ? '' : 's'}</button>{' '}
      {copyTargetCandidates.map(candidate => { const count = copyTargets.filter(id => id === candidate.id).length; return <button key={`${candidate.id}-${copyTargets.length}`} onClick={() => appendCopyTarget(candidate.id)}>{count ? `${count}× ` : ''}{candidate.kind === 'player' ? playerLabel(candidate.id) : cardNameForInstance(candidate.id)}</button>; })}{' '}
      {copyTargetCount > 0 && <><span>{copyTargets.length}/{copyTargetCount} selected</span>{' '}<button disabled={!copyTargetReady} onClick={() => act({ type: 'CHOOSE_COPY_TARGETS', targetIds: copyTargets })}>Use New Target{copyTargetCount === 1 ? '' : 's'}</button>{' '}</>}
      {copyTargets.length > 0 && <><button onClick={() => setCopyTargets(ids => ids.slice(0, -1))}>Undo Last</button>{' '}<button onClick={() => setCopyTargets([])}>Clear</button></>}
    </div>}
    {abilitySelection && <div className="decision-banner targeting-banner">
      <b>{abilitySelection.label}</b> — select exactly {abilitySelection.count} eligible permanent{abilitySelection.count === 1 ? '' : 's'} on your battlefield.{' '}
      <span>{abilitySelection.selectedIds.length}/{abilitySelection.count} selected</span>{' '}
      {abilitySelection.selectedIds.length > 0 && <button onClick={() => setAbilitySelection(current => ({ ...current, selectedIds: [] }))}>Clear</button>}{' '}
      <button onClick={() => setAbilitySelection(null)}>Cancel</button>
    </div>}
    {pendingTriggerTarget && <div className="decision-banner targeting-banner">
      Choose target{pendingTriggerTarget.maxTargets === 1 ? '' : 's'} for <b>{pendingTriggerTarget.sourceName}</b>.{' '}
      {pendingTriggerTarget.candidateIds.map(id => <button key={id} onClick={() => toggleTriggerTarget(id)}>{triggerTargets.includes(id) ? '✓ ' : ''}{cardNameForInstance(id)}</button>)}{' '}
      <span>{triggerTargets.length}/{pendingTriggerTarget.maxTargets} selected</span>{' '}
      {triggerTargets.length > 0 && <button onClick={() => setTriggerTargets([])}>Clear</button>}
    </div>}
    {targetingAction && <div className="decision-banner targeting-banner">
      Choose a legal target for <b>{targetingAction.label}</b>. Highlighted permanents are legal targets.{' '}
      {playerTargetCandidates.map(candidate => <button key={candidate.id} className="target-player-button" onClick={() => selectTarget(candidate.id)}>{candidate.id === 'player' ? 'Target Yourself' : `Target ${playerLabel(candidate.id)}`}</button>)}{' '}
      {offBoardTargetCandidates.map(candidate => <button key={candidate.id} onClick={() => selectTarget(candidate.id)}>{candidate.zone === 'stack' ? 'Target spell: ' : `Target ${candidate.zone}: `}{cardNameForInstance(candidate.id)}</button>)}{' '}
      <span>Selected {targetingAction.selectedTargets.length}/{targetBounds.max}</span>{' '}
      {targetingAction.selectedTargets.length > 0 && <button onClick={() => setTargetingAction(current => ({ ...current, selectedTargets: current.selectedTargets.slice(0, -1) }))}>Undo Last</button>}{' '}
      {targetBounds.min < targetBounds.max && <button className="primary" disabled={!targetSelectionReady} onClick={confirmTargets}>Confirm Targets</button>}{' '}
      <button onClick={() => { setTargetingAction(null); setCombatMessage(''); }}>Cancel</button>
    </div>}
    {combatMessage && <div className="decision-banner">{combatMessage}</div>}
    {!s.pendingChoice && !targetingAction && !abilitySelection && specialZoneActionGroups.length > 0 && <div className="decision-banner special-actions-banner">
      <b>Available special actions:</b>{' '}
      {specialZoneActionGroups.map(({ cardInstanceId, cardActions }) => {
        const found = cardActions[0]?.cardInstanceId ? (() => {
          for (const player of Object.values(s.players)) for (const zone of ['graveyard','exile','library']) {
            const card = player[zone]?.find(item => item.instanceId === cardInstanceId);
            if (card) return { card, zone };
          }
          return null;
        })() : null;
        if (!found) return null;
        return <button key={cardInstanceId} className="primary" onClick={() => chooseCardAction(found.card, cardActions)}>{found.zone === 'library' ? 'Cast from top' : found.zone === 'graveyard' ? 'Cast from graveyard' : 'Cast foretold'}: {engine.db[found.card.cardId]?.name || found.card.cardId}</button>;
      })}
    </div>}
    <div className={`table multiplayer-table opponents-${opponentEntries.length}`}>
      <section className={`opponent-arena opponents-${opponentEntries.length}`} aria-label={`${opponentEntries.length} opponent battlefield${opponentEntries.length === 1 ? '' : 's'}`}>
        {opponentEntries.map(([id, opponent], index) => {
          const isAttackChoice = s.turnActionPending === 'DECLARE_ATTACKERS' && s.activePlayer === 'player' && !opponent.lost;
          const assignedAttackers = attackers.filter(attackerId => attackTargets[attackerId] === id).length;
          const seatSelected = (attackDefender || livingOpponents[0]?.[0]) === id;
          const seatActive = s.activePlayer === id;
          const seatPriority = s.priorityPlayer === id;
          const seatDefending = s.combat.currentDefender === id;
          return <section key={id} className={`opponent-seat ${opponent.lost ? 'eliminated' : ''} ${seatActive ? 'active-seat' : ''} ${seatPriority ? 'priority-seat' : ''} ${seatDefending ? 'defending-seat' : ''}`}>
            <div className="opponent-seat-header">
              <div className="identity compact"><span className="avatar">AI {index + 1}</span><div><b>{playerLabel(id)}</b><small>{opponent.lost ? 'Eliminated' : `${opponent.hand.length} cards in hand`}</small></div></div>
              <div className="life compact-life">{opponent.life}<span>♥</span></div>
              <div className="seat-zone-counts"><span>Lib <b>{opponent.library.length}</b></span><span>GY <b>{opponent.graveyard.length}</b></span></div>
            </div>
            <div className="ai-last-action" title="Land plays never spend mana; only spells and activated abilities do.">{latestActionFor(id)}</div>
            {isAttackChoice && <button type="button" className={`attack-defender ${seatSelected ? 'selected' : ''}`} onClick={() => { setAttackDefender(id); setCombatMessage(''); }}>
              {seatSelected ? `Assign attackers here${assignedAttackers ? ` (${assignedAttackers})` : ''}` : `Attack ${playerLabel(id)}${assignedAttackers ? ` (${assignedAttackers})` : ''}`}
            </button>}
            <div className="opponent-play-area">
              <section className="seat-command-slot"><span>COMMANDER</span>{opponent.command.map(c => <Card key={c.instanceId} perm={c} def={engine.db[c.cardId]} />)}</section>
              <section className="battle-zone opponent-zone"><Battlefield side="opponent" player={opponent} db={engine.db} onCard={perm => clickOpponent(id, perm)} selected={cardId => targetCandidateIds.has(cardId) || selectedTargetIds.has(cardId) || proliferateTargets.includes(cardId) || damageOrderSelected(cardId) || cardId === blockTarget || s.combat.attackers.includes(cardId)} /></section>
            </div>
            {opponent.lost && <div className="eliminated-label">ELIMINATED</div>}
          </section>;
        })}
      </section>

      <section className="center-line"><div className="stack-panel"><span>STACK</span><b>{s.stack.length ? s.stack.map(x => x.type === 'ward' ? `Ward — ${engine.db[x.source?.cardId]?.name || 'permanent'}` : engine.db[x.card?.cardId]?.name || 'Triggered/activated ability').join(' → ') : 'Empty'}</b></div></section>

      <section className="player-play-area">
        <section className="battle-zone player-zone"><Battlefield side="player" player={p} db={engine.db} onCard={clickOwnPermanent} selected={playerSelected} /></section>
        <section className="command-slot player-command"><span>COMMANDER</span>{p.command.map(c => <Card key={c.instanceId} perm={c} def={engine.db[c.cardId]} onClick={castCommander} />)}</section>
      </section>

      <section className="player-strip self">
        <div className="identity"><span className="avatar">YOU</span><div><b>Player</b><small>{p.hand.length} cards in hand</small></div></div>
        <div className="life">{p.life}<span>♥</span></div>
        <div className="mana"><span>W <b>{p.manaPool.W}</b></span><span>U <b>{p.manaPool.U}</b></span><span>B <b>{p.manaPool.B}</b></span><span>R <b>{p.manaPool.R}</b></span><span>G <b>{p.manaPool.G}</b></span><span>C <b>{p.manaPool.C}</b></span></div>
      </section>
    </div>

    <section className="hand-tray">
      <div className="hand-label"><b>YOUR HAND</b><span>{pendingCleanup ? 'Click cards to choose your cleanup discard' : targetingAction ? 'Choose a highlighted battlefield/player target above' : 'Playable cards are highlighted when you have priority'}</span></div>
      <div className="hand-cards">{p.hand.map(c => {
        const legal = !pendingCleanup && !targetingAction && engine.getLegalActions('player').some(action => action.cardInstanceId === c.instanceId);
        const selected = pendingCleanup ? choiceCards.includes(c.instanceId) : (targetingAction?.baseAction.cardInstanceId === c.instanceId || legal);
        return <Card key={c.instanceId} perm={c} def={engine.db[c.cardId]} selected={selected} onClick={() => {
          if (targetingAction) return;
          if (pendingCleanup) { toggleChoiceCard(c.instanceId); return; }
          const actions = engine.getLegalActions('player').filter(action => action.cardInstanceId === c.instanceId);
          chooseCardAction(c, actions);
        }} />;
      })}</div>
    </section>

    <footer className="action-bar">
      <div className="action-context"><b>{(PHASE_UI[s.phase] || {}).label || s.phase}</b><span>{targetingAction ? 'Select a legal target before paying costs' : s.pendingChoice ? 'Complete the required choice' : aiTurnPausedForHuman ? automationDecision.reason : priorityText}</span></div>
      <button className="primary action-button" disabled={buttonDisabled || s.priorityPlayer !== 'player'} onClick={next}>{buttonText}</button>
      <div className="action-right">
        <div className="automation-controls" aria-label="AI turn automation">
          <label title="When enabled, routine priority on opponent turns is passed automatically."><input type="checkbox" checked={autoPassAITurns} onChange={e => setAutoPassAITurns(e.target.checked)} /> Auto-pass AI turns</label>
          <button type="button" className={holdPriority ? 'hold-active' : ''} disabled={s.activePlayer === 'player' || !!s.winner || !autoPassAITurns} onClick={() => setHoldPriority(value => !value)}>{holdPriority ? 'Priority held' : 'Hold next priority'}</button>
        </div>
        <div className="resources"><span>Graveyard <b>{p.graveyard.length}</b></span><span>Library <b>{p.library.length}</b></span></div>
      </div>
    </footer>
    {s.winner && <div className="winner"><div>{s.winner === 'player' ? 'Victory' : s.winner === 'draw' ? 'Draw' : 'Defeat'}</div></div>}
  </main>;
}
