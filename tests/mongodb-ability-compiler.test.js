import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Mongo ability compiler stores executable behavior separately from Scryfall card identity', () => {
  const src = fs.readFileSync(new URL('../scripts/compile-mongodb-abilities.mjs', import.meta.url), 'utf8');
  assert.match(src, /collection\('card_behaviors'\)/);
  assert.match(src, /compiler\.compileCard\(card\)/);
  assert.match(src, /fully_supported/);
  assert.match(src, /review_required/);
  assert.match(src, /behaviorFingerprint/);
});

test('Mongo indexes include behavior identity and support status', () => {
  const src = fs.readFileSync(new URL('../scripts/mongo-card-store.mjs', import.meta.url), 'utf8');
  assert.match(src, /behaviors\.createIndex\(\{ oracleId: 1 \}, \{ unique: true \}\)/);
  assert.match(src, /behaviors\.createIndex\(\{ status: 1 \}\)/);
});

import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { ORACLE_PARSER_VERSION } from '../src/cards/compiler/OracleTokenizer.js';

test('phase 2 compiler recognizes additional reusable spell families', () => {
  const compiler = new OracleTemplateCompiler();
  const cases = [
    ['Healing', 'You gain 4 life.', 'spell.gain-life-fixed'],
    ['Self Mill', 'Mill three cards.', 'spell.mill-self-fixed'],
    ['Tap Spell', 'Tap target creature.', 'spell.tap-target-creature'],
    ['Bounce', "Return target creature to its owner's hand.", 'spell.bounce-target'],
    ['Counter Growth', 'Put two +1/+1 counters on target creature.', 'spell.add-counter-target-creature']
  ];
  for (const [name, oracleText, templateId] of cases) {
    const result = compiler.compileCard({ id: name, name, oracleText, typeLine: 'Instant', layout: 'normal', keywords: [] });
    assert.equal(result.autoAccepted, true, `${name}: ${result.diagnostics?.join('; ')}`);
    assert.deepEqual(result.matchedTemplates, [templateId]);
  }
  assert.match(ORACLE_PARSER_VERSION, /^\d+\.\d+\.\d+$/);
});

test('phase 2 compiler composes exact reusable paragraphs without partial execution', () => {
  const compiler = new OracleTemplateCompiler();
  const result = compiler.compileCard({ id: 'two-step', name: 'Two Step', oracleText: 'You gain 2 life.\nDraw a card.', typeLine: 'Sorcery', layout: 'normal', keywords: [] });
  assert.equal(result.autoAccepted, true, result.diagnostics?.join('; '));
  assert.equal(result.composed, true);
  assert.equal(result.script.abilities.length, 2);
});


test('phase 3 compiler supports compound, keyword, graveyard, scheduled trigger, and generic activated families', () => {
  const compiler = new OracleTemplateCompiler();
  const cases = [
    ['Loot', 'Draw two cards, then discard a card.', 'Sorcery', 'spell.draw-then-discard-fixed'],
    ['Wing', 'Target creature gains flying until end of turn.', 'Instant', 'spell.target-gains-keyword-eot'],
    ['Recover', 'Return target creature card from your graveyard to your hand.', 'Sorcery', 'spell.return-graveyard-card-to-hand'],
    ['Upkeep', 'At the beginning of your upkeep, you gain 2 life.', 'Enchantment', 'trigger.upkeep-fixed-life'],
    ['End Draw', 'At the beginning of your end step, draw a card.', 'Enchantment', 'trigger.end-step-draw-fixed'],
    ['Book', '{2}, {T}: Draw a card.', 'Artifact', 'activated.generic-mana-tap-basic']
  ];
  for (const [name, oracleText, typeLine, templateId] of cases) {
    const result = compiler.compileCard({ id: name, name, oracleText, typeLine, layout: 'normal', keywords: [] });
    assert.equal(result.autoAccepted, true, `${name}: ${result.diagnostics?.join('; ')}`);
    assert.deepEqual(result.matchedTemplates, [templateId]);
  }
  assert.match(ORACLE_PARSER_VERSION, /^\d+\.\d+\.\d+$/);
});

test('phase 3 compound effects lower to an ordered authoritative sequence', () => {
  const compiler = new OracleTemplateCompiler();
  const result = compiler.compileCard({ id: 'loot', name: 'Loot', oracleText: 'Draw two cards, then discard a card.', typeLine: 'Sorcery', layout: 'normal', keywords: [] });
  assert.equal(result.autoAccepted, true);
  assert.equal(result.compiledCard.spellEffects[0].type, 'sequence');
  assert.equal(result.compiledCard.spellEffects[0].effects[0].type, 'draw');
  assert.equal(result.compiledCard.spellEffects[0].effects[1].type, 'scriptDiscard');
});


test('phase 4 compiler supports X values, optional effects, broader triggers, and sacrifice costs', () => {
  const compiler = new OracleTemplateCompiler();
  const cases = [
    ['X Draw', 'Draw X cards.', 'Sorcery', 'spell.draw-x'],
    ['X Mill', 'Mill X cards.', 'Sorcery', 'spell.mill-x'],
    ['May Draw', 'You may draw a card.', 'Sorcery', 'spell.may-draw-one'],
    ['Dies May', 'When this creature dies, you may draw a card.', 'Creature — Human', 'trigger.dies-may-draw-one'],
    ['Attack Draw', 'Whenever this creature attacks, draw two cards.', 'Creature — Human', 'trigger.attacks-draw-fixed'],
    ['Cast Draw', 'Whenever you cast a spell, draw a card.', 'Enchantment', 'trigger.cast-draw-fixed'],
    ['ETB May', 'When this creature enters, you may draw a card.', 'Creature — Human', 'trigger.etb-may-draw-one'],
    ['Sac Draw', 'Sacrifice this artifact: Draw a card.', 'Artifact', 'activated.sacrifice-self-draw'],
    ['Tap Sac Draw', '{2}, {T}, Sacrifice this artifact: Draw two cards.', 'Artifact', 'activated.tap-sacrifice-self-draw']
  ];
  for (const [name, oracleText, typeLine, templateId] of cases) {
    const result = compiler.compileCard({ id: name, name, oracleText, typeLine, layout: 'normal', keywords: [] });
    assert.equal(result.autoAccepted, true, `${name}: ${result.diagnostics?.join('; ')}`);
    assert.deepEqual(result.matchedTemplates, [templateId]);
  }
  assert.match(ORACLE_PARSER_VERSION, /^\d+\.\d+\.\d+$/);
});

test('phase 4 activated tap costs lower to the runtime tap contract', () => {
  const compiler = new OracleTemplateCompiler();
  const result = compiler.compileCard({ id: 'book', name: 'Book', oracleText: '{2}, {T}: Draw a card.', typeLine: 'Artifact', layout: 'normal', keywords: [] });
  assert.equal(result.autoAccepted, true);
  assert.equal(result.compiledCard.abilities[0].tap, true);
  assert.equal(result.compiledCard.abilities[0].cost.tap, true);
});

test('phase 4 X effects preserve a value expression for runtime resolution', () => {
  const compiler = new OracleTemplateCompiler();
  const result = compiler.compileCard({ id: 'xdraw', name: 'X Draw', oracleText: 'Draw X cards.', typeLine: 'Sorcery', layout: 'normal', keywords: [] });
  assert.equal(result.autoAccepted, true);
  assert.deepEqual(result.compiledCard.spellEffects[0].amount, { xValue: true });
});

test('phase 5 compiler supports selector-count and derived-value expressions', () => {
  const compiler = new OracleTemplateCompiler();
  const cases = [
    ['Creature Census', 'Draw a card for each creature you control.', 'Sorcery', 'spell.draw-for-each-creature-you-control'],
    ['Artifact Census', 'Draw a card for each artifact you control.', 'Sorcery', 'spell.draw-for-each-artifact-you-control'],
    ['Hand Census', 'Draw cards equal to the number of cards in your hand.', 'Sorcery', 'spell.draw-equal-cards-in-hand'],
    ['Power ETB', 'When this creature enters, draw cards equal to its power.', 'Creature — Test', 'trigger.etb-draw-equal-source-power'],
    ['Counter Death', 'When this creature dies, draw a card for each +1/+1 counter on it.', 'Creature — Test', 'trigger.dies-draw-for-each-counter']
  ];
  for (const [name, oracleText, typeLine, templateId] of cases) {
    const result = compiler.compileCard({ id: name, name, oracleText, typeLine, layout: 'normal', keywords: [] });
    assert.equal(result.autoAccepted, true, `${name}: ${result.diagnostics?.join('; ')}`);
    assert.deepEqual(result.matchedTemplates, [templateId]);
  }
  assert.match(ORACLE_PARSER_VERSION, /^\d+\.\d+\.\d+$/);
});

test('phase 5 derived quantities remain expressions through lowering', () => {
  const compiler = new OracleTemplateCompiler();
  const count = compiler.compileCard({ id: 'count', name: 'Count', oracleText: 'Draw a card for each creature you control.', typeLine: 'Sorcery', layout: 'normal', keywords: [] });
  assert.deepEqual(count.compiledCard.spellEffects[0].amount, { countSelector: { kind: 'permanent', controller: 'you', type: 'Creature' } });
  const power = compiler.compileCard({ id: 'power', name: 'Power', oracleText: 'When this creature enters, draw cards equal to its power.', typeLine: 'Creature — Test', layout: 'normal', keywords: [] });
  assert.deepEqual(power.compiledCard.abilities[0].effect.amount, { sourcePower: true });
});

test('phase 10 compiler supports non-hand casting permissions and flashback costs', () => {
  const compiler = new OracleTemplateCompiler();
  const flashback = compiler.compileCard({ id: 'fb', name: 'Think Again', oracleText: 'Draw two cards, then discard two cards.\nFlashback {2}{R}', typeLine: 'Sorcery', manaCost: '{1}{R}', layout: 'normal', keywords: [] });
  assert.equal(flashback.autoAccepted, true, flashback.diagnostics?.join('; '));
  assert.equal(flashback.compiledCard.castingOptions[0].fromZone, 'graveyard');
  assert.equal(flashback.compiledCard.castingOptions[0].castOption, 'flashback');
  assert.equal(flashback.compiledCard.castingOptions[0].manaCost, '{2}{R}');
  assert.equal(flashback.compiledCard.castingOptions[0].exileOnLeaveStack, true);

  const gy = compiler.compileCard({ id: 'gy', name: 'Again', oracleText: 'You may cast this card from your graveyard.', typeLine: 'Creature — Spirit', manaCost: '{3}{B}', layout: 'normal', keywords: [] });
  assert.equal(gy.autoAccepted, true);
  assert.equal(gy.compiledCard.castingOptions[0].castOption, 'graveyard');

  const exile = compiler.compileCard({ id: 'ex', name: 'Beyond', oracleText: 'You may cast this card from exile.', typeLine: 'Creature — Spirit', manaCost: '{2}{U}', layout: 'normal', keywords: [] });
  assert.equal(exile.autoAccepted, true);
  assert.equal(exile.compiledCard.castingOptions[0].castOption, 'exile');
  assert.match(ORACLE_PARSER_VERSION, /^2\./);
});
