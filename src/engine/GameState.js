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
    name: id === 'player' ? 'Player' : `Opponent ${id === 'ai' ? 1 : Number(id.replace('ai', '')) || 1}`,
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
    lost: false,
    eliminatedAtTurn: null
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
}

function normalizeDecks(deckA, deckBOrDecks) {
  const opponents = Array.isArray(deckBOrDecks) ? deckBOrDecks : [deckBOrDecks];
  const decks = [deckA, ...opponents].filter(Boolean);
  if (decks.length < 2 || decks.length > 4) throw new Error('Commander games support between 2 and 4 players');
  return decks;
}

export function createGameState(deckA, deckBOrDecks, db, rng = Math.random) {
  const decks = normalizeDecks(deckA, deckBOrDecks);
  const playerOrder = decks.map((_, index) => index === 0 ? 'player' : (index === 1 ? 'ai' : `ai${index}`));
  const players = {};
  playerOrder.forEach((id, index) => { players[id] = makePlayer(id, decks[index], db, rng); });
  const keyed = initial => Object.fromEntries(playerOrder.map(id => [id, typeof initial === 'function' ? initial(id) : structuredClone(initial)]));

  return {
    turn: 1,
    activePlayer: 'player',
    priorityPlayer: null,
    phase: 'PREGAME',
    phaseIndex: -1,
    passes: 0,
    stack: [],
    players,
    playerOrder,
    combat: { attackers: [], attackTargets: {}, blockers: {}, blocked: {}, damageAssignments: {}, defendingPlayers: [], blockerQueue: [], currentDefender: null },
    pendingTriggers: [],
    continuousEffects: [],
    pendingChoice: null,
    turnActionPending: null,
    cleanupPriority: false,
    cardsDrawnThisTurn: keyed(0),
    castingPermissions: [],
    pendingResolution: null,
    turnMemory: keyed(() => ({})),
    pregame: {
      active: false,
      currentPlayer: 'player',
      kept: keyed(false)
    },
    history: [],
    winner: null,
    started: false,
    gameBegun: false
  };
}
