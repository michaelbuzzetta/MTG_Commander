import { uid, shuffle } from './utils.js';
import { GAME_STATE_SCHEMA_VERSION } from './state/GameStateSchema.js';
import { createPlayerObject, ensureCanonicalCardObject } from './state/GameObject.js';
import { normalizeCommanderIds, validateCommanderSelection } from './multiplayer/CommanderRules.js';

export function makePlayer(id, deck, db, rng) {
  const selection = validateCommanderSelection(deck, db, { throwOnError: true });
  const commanderIds = normalizeCommanderIds(deck);
  const commanderIdSet = new Set(commanderIds);
  const cards = [];
  for (const entry of deck.cards) {
    for (let i = 0; i < entry.quantity; i++) {
      if (commanderIdSet.has(entry.id)) continue;
      cards.push(makeCardInstance(entry.id, id, 'library', {}, db[entry.id] || {}));
    }
  }

  const commanders = commanderIds.map((cardId, index) => makeCardInstance(
    cardId,
    id,
    'command',
    {
      isCommander: true,
      commanderIdentity: `commander:${id}:${index + 1}:${cardId}`,
      commanderDesignationIndex: index
    },
    db[cardId] || {}
  ));
  const commanderTaxLedger = Object.fromEntries(commanders.map(card => [card.commanderIdentity, {
    commanderIdentity: card.commanderIdentity,
    cardId: card.cardId,
    castsFromCommandZone: 0,
    tax: 0
  }]));

  return createPlayerObject(id, {
    name: id === 'player' ? 'Player' : `Opponent ${id === 'ai' ? 1 : Number(id.replace('ai', '')) || 1}`,
    colorIdentity: [...selection.colorIdentity],
    life: 40,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    restrictedMana: [],
    library: shuffle(cards, rng),
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    command: commanders,
    commanderIdentities: commanders.map(card => card.commanderIdentity),
    commanderCardIds: [...commanderIds],
    commanderPairing: selection.pairing ? { mechanic: selection.pairing.mechanic } : null,
    landPlaysRemaining: 1,
    commanderTax: 0,
    commanderTaxLedger,
    commanderDamage: {},
    counters: {},
    mulligans: 0,
    maxHandSize: 7,
    additionalLandPlays: 0,
    damagePrevention: 0,
    lost: false,
    eliminatedAtTurn: null
  });
}

export function makeCardInstance(cardId, owner, zone, extra = {}, definition = {}) {
  const card = {
    instanceId: uid('card'),
    cardId,
    owner,
    controller: owner,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damageMarked: 0,
    damagePrevention: 0,
    attacking: false,
    attackTarget: null,
    blocking: null,
    modifiers: { power: 0, toughness: 0, keywords: [] },
    createdTurn: null,
    controlledSinceTurn: null,
    chosenType: null,
    attachedTo: null,
    phasedOut: false,
    foretold: false,
    faceDown: false,
    exiledBy: null,
    castMode: null,
    ...extra
  };
  return ensureCanonicalCardObject(card, definition);
}

function normalizeDecks(deckA, deckBOrDecks) {
  const opponents = Array.isArray(deckBOrDecks) ? deckBOrDecks : [deckBOrDecks];
  const decks = [deckA, ...opponents].filter(Boolean);
  if (decks.length < 2 || decks.length > 4) throw new Error('Commander games support between 2 and 4 players');
  return decks;
}

export function createGameState(deckA, deckBOrDecks, db, rng) {
  const decks = normalizeDecks(deckA, deckBOrDecks);
  const playerOrder = decks.map((_, index) => index === 0 ? 'player' : (index === 1 ? 'ai' : `ai${index}`));
  const players = {};
  playerOrder.forEach((id, index) => { players[id] = makePlayer(id, decks[index], db, rng); });
  const keyed = initial => Object.fromEntries(playerOrder.map(id => [id, typeof initial === 'function' ? initial(id) : structuredClone(initial)]));

  return {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    turn: 1,
    activePlayer: 'player',
    priorityPlayer: null,
    phase: 'PREGAME',
    phaseIndex: -1,
    passes: 0,
    stack: [],
    players,
    playerOrder,
    combat: { attackers: [], attackTargets: {}, attackDefendingPlayers: {}, defendingEntities: {}, blockers: {}, blocked: {}, damageAssignments: {}, defendingPlayers: [], blockerQueue: [], currentDefender: null },
    pendingTriggers: [],
    triggerRegistrations: [],
    continuousEffects: [],
    continuousTimestampSequence: 0,
    attachments: [],
    attachmentTimestampSequence: 0,
    preventionEffects: [],
    pendingChoice: null,
    pendingDamageBatch: null,
    turnActionPending: null,
    cleanupPriority: false,
    cardsDrawnThisTurn: keyed(0),
    extraTurns: keyed(0),
    extraTurnQueue: [],
    turnKind: 'normal',
    normalTurnPlayer: 'player',
    turnSequence: [],
    turnStepId: null,
    turnPhaseGroup: null,
    cleanupIteration: 0,
    turnHistory: [],
    skippedTurnHistory: [],
    turnModifiers: {
      skippedTurns: keyed(0),
      extraUpkeeps: keyed(0),
      skippedDrawSteps: keyed(0),
      skippedCombatPhases: keyed(0),
      skipSteps: keyed(() => ({})),
      skipPhaseGroups: keyed(() => ({}))
    },
    castingPermissions: [],
    legalityUsage: [],
    legalityDiagnostics: [],
    timingUsage: [],
    timingDiagnostics: [],
    knownInformation: Object.fromEntries(playerOrder.map(id => [id, { cards: {} }])),
    lastKnownInformation: { sequence: 0, byObjectId: {}, byInstanceId: {} },
    pendingResolution: null,
    turnMemory: keyed(() => ({})),
    pregame: {
      active: false,
      stage: 'not-started',
      currentPlayer: 'player',
      startingPlayer: 'player',
      turnOrder: [...playerOrder],
      kept: keyed(false),
      freeMulligans: playerOrder.length > 1 ? 1 : 0,
      companions: keyed(null),
      actionsComplete: false,
      validation: []
    },
    history: [],
    winner: null,
    started: false,
    gameBegun: false
  };
}
