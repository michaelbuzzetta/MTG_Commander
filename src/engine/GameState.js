import { uid, shuffle } from './utils.js';

export function makePlayer(id, deck, db, rng = Math.random) {
  const commanderDef = db[deck.commander];
  if (!commanderDef) throw new Error(`Missing commander ${deck.commander}`);
  const cards = [];
  for (const entry of deck.cards) {
    for (let i = 0; i < entry.quantity; i++) {
      if (entry.id === deck.commander) continue;
      cards.push(makeCardInstance(entry.id, id, 'library'));
    }
  }
  return {
    id,
    colorIdentity: [...(deck.colorIdentity || [])],
    life: 40,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    library: shuffle(cards, rng),
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    command: [makeCardInstance(deck.commander, id, 'command', { isCommander: true })],
    landPlaysRemaining: 1,
    commanderTax: 0,
    commanderDamage: {},
    counters: {},
    mulligans: 0,
    maxHandSize: 7,
    additionalLandPlays: 0,
    damagePrevention: 0,
    lost: false
  };
}

export function makeCardInstance(cardId, owner, zone, extra = {}) {
  return {
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
}

export function createGameState(deckA, deckB, db, rng = Math.random) {
  return {
    turn: 1,
    activePlayer: 'player',
    priorityPlayer: null,
    phase: 'PREGAME',
    phaseIndex: -1,
    passes: 0,
    stack: [],
    players: {
      player: makePlayer('player', deckA, db, rng),
      ai: makePlayer('ai', deckB, db, rng)
    },
    combat: { attackers: [], blockers: {}, blocked: {}, damageAssignments: {} },
    pendingTriggers: [],
    continuousEffects: [],
    pendingChoice: null,
    turnActionPending: null,
    cleanupPriority: false,
    cardsDrawnThisTurn: { player: 0, ai: 0 },
    castingPermissions: [],
    pendingResolution: null,
    turnMemory: { player: {}, ai: {} },
    pregame: {
      active: false,
      currentPlayer: 'player',
      kept: { player: false, ai: false }
    },
    history: [],
    winner: null,
    started: false,
    gameBegun: false
  };
}
