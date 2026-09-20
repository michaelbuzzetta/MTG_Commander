import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { engine } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';

const compiler = new OracleTemplateCompiler();
function compile(id, oracleText, manaCost = '{4}{U}', typeLine = 'Instant') {
  const result = compiler.compileCard({ id, name: id, oracleText, typeLine, manaCost });
  assert.equal(result.autoAccepted, true, result.diagnostics?.join('; '));
  return result.compiledCard;
}

test('Phase 10: non-hand casting permissions compile into declarative casting options', () => {
  const grave = compile('grave', 'You may cast this card from your graveyard.');
  assert.deepEqual(grave.castingOptions[0], { id: 'graveyard', fromZone: 'graveyard', castOption: 'graveyard' });
  const exile = compile('exile-free', 'You may cast this card from exile without paying its mana cost.');
  assert.equal(exile.castingOptions[0].withoutManaCost, true);
  const alt = compile('grave-alt', 'You may cast this card from your graveyard by paying {1}{U} rather than paying its mana cost.');
  assert.equal(alt.castingOptions[0].manaCost, '{1}{U}');
});

test('Phase 10: declarative free-cast option removes only the mana cost', () => {
  const e = engine();
  const d = compile('phase10-free', 'You may cast this card from exile without paying its mana cost.', '{7}{U}');
  e.db['phase10-free'] = d;
  const c = makeCardInstance('phase10-free', 'player', 'exile', { controller: 'player' }, d);
  e.state.players.player.exile.push(c);
  const cost = e.costs.determineSpellCost('player', c, { zone: 'exile', castOption: 'exile-free' });
  assert.equal(cost.finalManaCost, '');
});

test('Phase 10: a casting option can independently grant instant timing', () => {
  const e = engine();
  // Use a sorcery to prove the option, rather than card type, grants timing.
  const d = compile('phase10-flash', 'You may cast this card from your graveyard as though it had flash.', '{2}{U}', 'Sorcery');
  e.db['phase10-flash'] = d;
  const c = makeCardInstance('phase10-flash', 'player', 'graveyard', { controller: 'player' }, d);
  e.state.players.player.graveyard.push(c);
  e.state.activePlayer = 'opponent';
  e.state.priorityPlayer = 'player';
  assert.equal(e.timing.allowsSpell('player', c, 'graveyard', null, null, 'graveyard-flash'), true);
});
