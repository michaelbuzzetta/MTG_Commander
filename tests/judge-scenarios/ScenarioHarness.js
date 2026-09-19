import fs from 'node:fs';
import path from 'node:path';
import { GameEngine } from '../../src/engine/GameEngine.js';
import { makeCardInstance } from '../../src/engine/GameState.js';
import db from '../../src/data/generated/cards.json' with { type: 'json' };
import decks from '../../src/data/generated/decks.json' with { type: 'json' };

const PLAYABLE = decks.filter(deck => deck.playable !== false);

export class ScenarioHarness {
  constructor(metadata) {
    this.metadata = metadata;
    this.engine = null;
    this.semanticTrace = [];
  }

  createEngine({ players = this.metadata.players || 2, invariantChecks = false } = {}) {
    const selected = PLAYABLE.slice(0, Math.max(2, players));
    if (selected.length < players) throw new Error(`Judge scenario ${this.metadata.id} requires ${players} playable decks`);
    const opponents = players === 2 ? selected[1] : selected.slice(1, players);
    const e = new GameEngine(selected[0], opponents, db, {
      seed: `step36:${this.metadata.id}`,
      invariantChecks
    });
    e.start();
    for (const playerId of e.playerIds()) e.perform(playerId, { type: 'KEEP_HAND' });
    e.setVerboseRulesTracing(true);
    e.events.clearLog();
    e.replacements?.clearTrace?.();
    e.state.history = [];
    this.engine = e;
    return e;
  }

  trace(label) { this.semanticTrace.push(String(label)); }

  defineCard(id, definition = {}) {
    if (!this.engine) throw new Error('createEngine() must be called before defineCard()');
    return this.engine._registerRuntimeCardDefinition(id, {
      id,
      name: definition.name || id,
      typeLine: definition.typeLine || 'Creature — Judge Fixture',
      manaCost: definition.manaCost || '',
      manaValue: definition.manaValue ?? 0,
      colorIdentity: definition.colorIdentity || [],
      colors: definition.colors || [],
      subtypes: definition.subtypes || ['Judge'],
      keywords: definition.keywords || [],
      abilities: definition.abilities || [],
      spellEffects: definition.spellEffects || [],
      oracleText: definition.oracleText || 'Judge scenario fixture.',
      power: definition.power ?? 2,
      toughness: definition.toughness ?? 2,
      supported: true,
      ...definition
    });
  }

  permanent(playerId, id, definition = {}, extra = {}) {
    const e = this.engine;
    this.defineCard(id, definition);
    const card = makeCardInstance(id, playerId, 'battlefield', {
      controller: playerId,
      tapped: false,
      summoningSick: false,
      counters: {},
      damageMarked: 0,
      modifiers: { power: 0, toughness: 0, keywords: [] },
      createdTurn: e.state.turn,
      controlledSinceTurn: e.state.turn,
      ...extra
    }, e.db[id]);
    e.zones.place(card, 'battlefield', playerId);
    return card;
  }

  setPhase(phase, { activePlayer = 'player', priorityPlayer = activePlayer } = {}) {
    const e = this.engine;
    const order = ['UNTAP','UPKEEP','DRAW','PRECOMBAT_MAIN','BEGIN_COMBAT','DECLARE_ATTACKERS','DECLARE_BLOCKERS','FIRST_STRIKE_DAMAGE','COMBAT_DAMAGE','END_COMBAT','POSTCOMBAT_MAIN','END_STEP','CLEANUP'];
    e.state.activePlayer = activePlayer;
    e.state.phase = phase;
    e.state.phaseIndex = order.indexOf(phase);
    e.state.priorityPlayer = priorityPlayer;
    e.state.turnActionPending = null;
    e.state.passes = 0;
    e.state.stack ||= [];
  }

  diagnostic(error) {
    const e = this.engine;
    return {
      scenario: {
        id: this.metadata.id,
        title: this.metadata.title,
        tags: this.metadata.tags,
        rulesReferences: this.metadata.rulesReferences
      },
      error: { name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null },
      semanticTrace: [...this.semanticTrace],
      diagnosticBundle: e?.getDiagnosticBundle?.({ includeState: true, includeReplay: true }) || null
    };
  }

  persistFailure(error) {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
    const dir = path.join(root, 'coverage', 'judge-scenario-failures');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${this.metadata.id}.json`);
    fs.writeFileSync(file, `${JSON.stringify(this.diagnostic(error), null, 2)}\n`);
    return file;
  }
}
