import test from 'node:test';
import assert from 'node:assert/strict';
import compilation from '../src/data/generated/oracle-template-compilation.json' with { type: 'json' };
import reviewQueue from '../src/data/generated/oracle-template-review-queue.json' with { type: 'json' };
import coverage from '../src/data/generated/oracle-template-coverage.json' with { type: 'json' };
import changeDiff from '../src/data/generated/oracle-change-diff.json' with { type: 'json' };
import { db } from './helpers.js';
import {
  OracleTemplateCompiler,
  ORACLE_PARSER_VERSION,
  tokenizeOracleText,
  diffOracleCardSets,
  diffCompilerSnapshots
} from '../src/cards/index.js';

const compiler = new OracleTemplateCompiler();

function card(id, oracleText, fields = {}) {
  return {
    id,
    name: fields.name || id,
    layout: fields.layout || 'normal',
    typeLine: fields.typeLine || 'Sorcery',
    manaCost: fields.manaCost || '',
    manaValue: fields.manaValue || 0,
    power: fields.power ?? null,
    toughness: fields.toughness ?? null,
    colors: fields.colors || [],
    colorIdentity: fields.colorIdentity || [],
    subtypes: fields.subtypes || [],
    keywords: fields.keywords || [],
    abilities: fields.abilities || [],
    spellEffects: fields.spellEffects || [],
    oracleText,
    supported: true,
    ...fields
  };
}

test('Step 18: tokenizer preserves rules-significant mana, numbers, punctuation, and newlines deterministically', () => {
  const text = 'Kicker {1}{G}\nDraw two cards.';
  const first = tokenizeOracleText(text);
  const second = tokenizeOracleText(text);
  assert.deepEqual(first, second);
  assert.ok(first.some(token => token.type === 'mana' && token.value === '{1}'));
  assert.ok(first.some(token => token.type === 'mana' && token.value === '{G}'));
  assert.ok(first.some(token => token.type === 'newline'));
  assert.ok(first.some(token => token.type === 'word' && token.value === 'Draw'));
});

test('Step 18: textless normal creatures compile as vanilla while textless noncreatures stay fail-closed', () => {
  const vanilla = compiler.compileCard(card('vanilla-fixture', '', { typeLine: 'Creature — Bear', power: 2, toughness: 2 }));
  assert.equal(vanilla.autoAccepted, true);
  assert.deepEqual(vanilla.matchedTemplates, ['card.vanilla-creature']);
  assert.deepEqual(vanilla.compiledCard.abilities, []);
  assert.deepEqual(vanilla.compiledCard.spellEffects, []);

  const blankArtifact = compiler.compileCard(card('blank-artifact', '', { typeLine: 'Artifact' }));
  assert.equal(blankArtifact.autoAccepted, false);
  assert.match(blankArtifact.diagnostics.join(' '), /No exact high-confidence Oracle template/i);
});

test('Step 18: exact generic keyword-only cards reuse engine keyword semantics without accepting trailing rules text', () => {
  const flying = compiler.compileCard(card('flying-fixture', 'Flying', { typeLine: 'Creature — Bird', keywords: ['flying'] }));
  assert.equal(flying.autoAccepted, true);
  assert.deepEqual(flying.matchedTemplates, ['card.keyword-only']);
  assert.deepEqual(flying.compiledCard.keywords, ['flying']);

  const reach = compiler.compileCard(card('reach-fixture', 'Reach (This creature can block creatures with flying.)', { typeLine: 'Creature — Spider', keywords: ['reach'] }));
  assert.equal(reach.autoAccepted, true);

  const combined = compiler.compileCard(card('keyword-pair', 'Flying, vigilance', { typeLine: 'Creature — Angel', keywords: ['flying', 'vigilance'] }));
  assert.equal(combined.autoAccepted, true);

  const extraRule = compiler.compileCard(card('keyword-extra', 'Flying\nThis creature can block only creatures with flying.', { typeLine: 'Creature — Bird', keywords: ['flying'] }));
  assert.equal(extraRule.autoAccepted, false, 'keyword templates must never swallow additional functional rules text');
});

test('Step 18: fixed draw template compiles to the same primitive behavior as the hand-authored Divination card', () => {
  const result = compiler.compileCard(db.divination);
  assert.equal(result.autoAccepted, true);
  assert.deepEqual(result.matchedTemplates, ['spell.draw-fixed']);
  assert.deepEqual(result.compiledCard.spellEffects, db.divination.spellEffects);
  assert.equal(result.script.metadata.parserVersion, ORACLE_PARSER_VERSION);
});

test('Step 18: target-destroy templates preserve target legality as well as effect semantics', () => {
  const murder = compiler.compileCard(db.murder);
  assert.equal(murder.autoAccepted, true);
  assert.equal(murder.compiledCard.spellEffects[0].type, 'destroy');
  assert.equal(murder.compiledCard.targets.type, 'Creature');
  assert.equal(murder.compiledCard.targets.kind, 'permanent');

  const disenchant = compiler.compileCard(db['arch-disenchant']);
  assert.equal(disenchant.autoAccepted, true);
  assert.deepEqual(disenchant.compiledCard.targets.types, ['Artifact', 'Enchantment']);
});

test('Step 18: basic-land search template lowers to the existing choice-aware land-search engine path', () => {
  const result = compiler.compileCard(db['arch-rampant-growth']);
  assert.equal(result.autoAccepted, true);
  const effect = result.compiledCard.spellEffects[0];
  assert.equal(effect.type, 'searchLand');
  assert.equal(effect.basicOnly, true);
  assert.equal(effect.destination, 'battlefield');
  assert.equal(effect.tapped, true);
});

test('Step 18: fixed damage to any target produces the shared damage primitive and legal player/permanent target contract', () => {
  const result = compiler.compileCard(card('shock-fixture', 'Shock Fixture deals 2 damage to any target.', { name: 'Shock Fixture', typeLine: 'Instant' }));
  assert.equal(result.autoAccepted, true);
  assert.deepEqual(result.matchedTemplates, ['spell.damage-any-target']);
  assert.equal(result.compiledCard.spellEffects[0].type, 'damage');
  assert.equal(result.compiledCard.spellEffects[0].amount, 2);
  assert.equal(result.compiledCard.targets.kind, 'playerOrPermanent');
  assert.deepEqual(result.compiledCard.targets.types, ['Creature', 'Planeswalker', 'Battle']);
});

test('Step 18: fixed pump template compiles through modifyCharacteristics rather than a card-specific handler', () => {
  const result = compiler.compileCard(card('pump-fixture', 'Target creature you control gets +3/+3 until end of turn.', { typeLine: 'Instant' }));
  assert.equal(result.autoAccepted, true);
  assert.deepEqual(result.matchedTemplates, ['spell.pump-until-eot']);
  assert.equal(result.compiledCard.targets.controller, 'you');
  assert.deepEqual(result.compiledCard.spellEffects[0], { type: 'pump', power: 3, toughness: 3, duration: 'until-end-of-turn' });
});

test('Step 18: exact target-land destruction and ETB draw use existing generic primitives', () => {
  const destroyLand = compiler.compileCard(card('destroy-land', 'Destroy target land.', { typeLine: 'Sorcery' }));
  assert.equal(destroyLand.autoAccepted, true);
  assert.equal(destroyLand.compiledCard.targets.type, 'Land');
  assert.equal(destroyLand.compiledCard.spellEffects[0].type, 'destroy');

  const etbDraw = compiler.compileCard(card('etb-draw', 'When this creature enters, draw a card.', { typeLine: 'Creature — Wizard', power: 1, toughness: 1 }));
  assert.equal(etbDraw.autoAccepted, true);
  assert.deepEqual(etbDraw.matchedTemplates, ['trigger.etb-draw-fixed']);
  assert.equal(etbDraw.compiledCard.abilities[0].event, 'ENTER_BATTLEFIELD');
  assert.deepEqual(etbDraw.compiledCard.abilities[0].effect, { type: 'draw', amount: 1 });
});

test('Step 18: ETB life and utility-token templates compile into normal triggered abilities', () => {
  const life = compiler.compileCard(card('life-etb', 'When this creature enters, you gain 3 life.', { typeLine: 'Creature — Cleric', power: 2, toughness: 2 }));
  assert.equal(life.autoAccepted, true);
  assert.equal(life.compiledCard.abilities[0].type, 'triggered');
  assert.equal(life.compiledCard.abilities[0].event, 'ENTER_BATTLEFIELD');
  assert.deepEqual(life.compiledCard.abilities[0].effect, { type: 'gainLife', amount: 3 });

  const token = compiler.compileCard(card('treasure-etb', 'When this artifact enters, create two Treasure tokens.', { typeLine: 'Artifact' }));
  assert.equal(token.autoAccepted, true);
  assert.equal(token.compiledCard.abilities[0].effect.type, 'createToken');
  assert.equal(token.compiledCard.abilities[0].effect.amount, 2);
  assert.equal(token.compiledCard.abilities[0].effect.token.name, 'Treasure');
});

test('Step 18: simple triggered +1/+1 counter templates target their source without bespoke card logic', () => {
  const etb = compiler.compileCard(card('counter-etb', 'When this creature enters, put two +1/+1 counters on it.', { typeLine: 'Creature — Test', power: 1, toughness: 1 }));
  assert.equal(etb.autoAccepted, true);
  assert.equal(etb.compiledCard.abilities[0].effect.type, 'addCounter');
  assert.equal(etb.compiledCard.abilities[0].effect.source, true);
  assert.equal(etb.compiledCard.abilities[0].effect.amount, 2);

  const cast = compiler.compileCard(card('counter-cast', 'Whenever you cast a creature spell, put a +1/+1 counter on this creature.', { typeLine: 'Creature — Test', power: 1, toughness: 1 }));
  assert.equal(cast.autoAccepted, true);
  assert.equal(cast.compiledCard.abilities[0].condition.cardType, 'Creature');
  assert.equal(cast.compiledCard.abilities[0].effect.source, true);
});

test('Step 18: additional engine-backed keyword-only mechanics compile only as complete rules text', () => {
  for (const keyword of ['defender', 'prowess', 'exalted', 'infect', 'wither', 'shroud', 'fear', 'intimidate', 'horsemanship', 'shadow']) {
    const result = compiler.compileCard(card(`keyword-${keyword}`, keyword[0].toUpperCase() + keyword.slice(1), { typeLine: 'Creature — Test', keywords: [keyword] }));
    assert.equal(result.autoAccepted, true, `${keyword} should compile through the reusable mechanic engine`);
    assert.deepEqual(result.matchedTemplates, ['card.keyword-only']);
  }
  const extra = compiler.compileCard(card('prowess-extra', 'Prowess\nWhenever this creature attacks, draw a card.', { typeLine: 'Creature — Test', keywords: ['prowess'] }));
  assert.equal(extra.autoAccepted, false);
});

test('Step 18: targeted ETB counter, artifact removal, and damage templates preserve target contracts', () => {
  const counter = compiler.compileCard(card('etb-target-counter', 'When this creature enters, put a +1/+1 counter on target creature.', { typeLine: 'Creature — Test' }));
  assert.equal(counter.autoAccepted, true);
  assert.equal(counter.compiledCard.abilities[0].effect.type, 'addCounter');
  assert.equal(counter.compiledCard.abilities[0].targets.type, 'Creature');

  const destroy = compiler.compileCard(card('etb-destroy-artifact', 'When this creature enters, destroy target artifact.', { typeLine: 'Creature — Test' }));
  assert.equal(destroy.autoAccepted, true);
  assert.equal(destroy.compiledCard.abilities[0].effect.type, 'destroy');
  assert.equal(destroy.compiledCard.abilities[0].targets.type, 'Artifact');

  const damage = compiler.compileCard(card('etb-damage', 'When this creature enters, Spark Tester deals 1 damage to any target.', { name: 'Spark Tester', typeLine: 'Creature — Test' }));
  assert.equal(damage.autoAccepted, true);
  assert.equal(damage.compiledCard.abilities[0].effect.type, 'damage');
  assert.equal(damage.compiledCard.abilities[0].effect.amount, 1);
  assert.equal(damage.compiledCard.abilities[0].targets.kind, 'playerOrPermanent');
});

test('Step 18: simple dies/combat-damage draw and narrow removal/counterspell patterns compile exactly', () => {
  const dies = compiler.compileCard(card('dies-draw', 'When this creature dies, draw a card.', { typeLine: 'Creature — Test' }));
  assert.equal(dies.autoAccepted, true);
  assert.equal(dies.compiledCard.abilities[0].event, 'CREATURE_DIED');
  assert.equal(dies.compiledCard.abilities[0].condition.sourceEvent, true);

  const combatDraw = compiler.compileCard(card('combat-draw', 'Whenever this creature deals combat damage to a player, draw a card.', { typeLine: 'Creature — Test' }));
  assert.equal(combatDraw.autoAccepted, true);
  assert.equal(combatDraw.compiledCard.abilities[0].event, 'COMBAT_DAMAGE_PLAYER');

  const tapped = compiler.compileCard(card('destroy-tapped', 'Destroy target tapped creature.', { typeLine: 'Instant' }));
  assert.equal(tapped.autoAccepted, true);
  assert.equal(tapped.compiledCard.targets.tapped, true);

  const counter = compiler.compileCard(card('counter-creature', 'Counter target creature spell.', { typeLine: 'Instant' }));
  assert.equal(counter.autoAccepted, true);
  assert.equal(counter.compiledCard.spellEffects[0].type, 'counterSpellTarget');
  assert.equal(counter.compiledCard.targets.zone, 'stack');
  assert.equal(counter.compiledCard.targets.type, 'Creature');
});

test('Step 18: generic basic-landwalk keyword cards compile through authoritative combat semantics', () => {
  for (const [keyword, subtype] of [['plainswalk','Plains'], ['islandwalk','Island'], ['swampwalk','Swamp'], ['mountainwalk','Mountain'], ['forestwalk','Forest']]) {
    const article = subtype === 'Island' ? 'an' : 'a';
    const text = `${keyword[0].toUpperCase() + keyword.slice(1)} (This creature can't be blocked as long as defending player controls ${article} ${subtype}.)`;
    const result = compiler.compileCard(card(`walk-${keyword}`, text, { typeLine: 'Creature — Test', keywords: ['landwalk', keyword] }));
    assert.equal(result.autoAccepted, true, `${keyword} should exact-compile`);
    assert.deepEqual(result.matchedTemplates, ['card.keyword-only']);
  }
});

test('Step 18: exact keyword-plus-draw and simple activated templates compile through shared primitives', () => {
  const etb = compiler.compileCard(card('flying-etb-draw', 'Flying\nWhen this creature enters, draw a card.', { typeLine: 'Creature — Bird', keywords: ['flying'] }));
  assert.equal(etb.autoAccepted, true);
  assert.deepEqual(etb.matchedTemplates, ['card.keyword-plus-etb-draw-one']);
  assert.equal(etb.compiledCard.abilities[0].effect.type, 'draw');

  const dies = compiler.compileCard(card('flying-dies-draw', 'Flying\nWhen this creature dies, draw a card.', { typeLine: 'Creature — Spirit', keywords: ['flying'] }));
  assert.equal(dies.autoAccepted, true);
  assert.deepEqual(dies.matchedTemplates, ['card.keyword-plus-dies-draw-one']);

  const pinger = compiler.compileCard(card('pinger', '{T}: This creature deals 1 damage to any target.', { typeLine: 'Creature — Wizard' }));
  assert.equal(pinger.autoAccepted, true);
  assert.equal(pinger.compiledCard.abilities[0].cost.tap, true);
  assert.equal(pinger.compiledCard.abilities[0].effect.type, 'damage');

  const tapper = compiler.compileCard(card('tapper', '{W}, {T}: Tap target creature.', { typeLine: 'Creature — Cleric' }));
  assert.equal(tapper.autoAccepted, true);
  assert.equal(tapper.compiledCard.abilities[0].cost.mana, '{W}');
  assert.equal(tapper.compiledCard.abilities[0].targets.type, 'Creature');
  assert.equal(tapper.compiledCard.abilities[0].effect.type, 'scriptTap');

  const healer = compiler.compileCard(card('healer', '{T}: You gain 1 life.', { typeLine: 'Creature — Cleric' }));
  assert.equal(healer.autoAccepted, true);
  assert.equal(healer.compiledCard.abilities[0].effect.type, 'gainLife');
});

test('Step 18: exact reanimation and utility-token reminder patterns remain choice-aware and declarative', () => {
  const reanimate = compiler.compileCard(card('reanimate', 'Return target creature card from your graveyard to the battlefield.', { typeLine: 'Sorcery' }));
  assert.equal(reanimate.autoAccepted, true);
  assert.equal(reanimate.compiledCard.targets.zone, 'graveyard');
  assert.equal(reanimate.compiledCard.targets.owner, 'you');
  assert.equal(reanimate.compiledCard.targets.type, 'Creature');
  assert.equal(reanimate.compiledCard.spellEffects[0].type, 'scriptMoveZone');
  assert.equal(reanimate.compiledCard.spellEffects[0].toZone, 'battlefield');

  const treasure = compiler.compileCard(card('treasure-etb-reminder', 'When this creature enters, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")', { typeLine: 'Creature — Rogue' }));
  assert.equal(treasure.autoAccepted, true);
  assert.equal(treasure.compiledCard.abilities[0].effect.type, 'createToken');
  assert.equal(treasure.compiledCard.abilities[0].effect.token.name, 'Treasure');
});

test('Compiler 1.3: multiple independently exact ability paragraphs compose through the generic card-script path', () => {
  const result = compiler.compileCard(card(
    'composed-generic-fixture',
    'Flying\nWhen this creature enters, draw a card.\n{T}: You gain 1 life.',
    { typeLine: 'Creature — Bird Cleric', keywords: ['flying'], power: 2, toughness: 2 }
  ));
  assert.equal(result.autoAccepted, true);
  assert.equal(result.composed, true);
  assert.equal(result.composedParagraphs, 3);
  assert.deepEqual(result.matchedTemplates, ['card.keyword-only', 'trigger.etb-draw-fixed', 'activated.tap-gain-one-life']);
  assert.equal(result.compiledCard.abilities.length, 2);
  assert.equal(result.compiledCard.abilities[0].event, 'ENTER_BATTLEFIELD');
  assert.equal(result.compiledCard.abilities[1].type, 'activated');
  assert.equal(result.compiledCard.abilities[1].cost.tap, true);
});

test('Compiler 1.3: paragraph composition remains fail-closed when any paragraph is unknown', () => {
  const result = compiler.compileCard(card(
    'composed-unknown-fixture',
    'Flying\nWhen this creature enters, draw a card.\nWhenever an opponent sneezes, untap this creature.',
    { typeLine: 'Creature — Bird', keywords: ['flying'], power: 2, toughness: 2 }
  ));
  assert.equal(result.autoAccepted, false);
  assert.equal(result.status, 'review_required');
  assert.match(result.diagnostics.join(' '), /complete paragraph composition/i);
});

test('Step 18: unrecognized or partially recognized Oracle text fails closed to the review queue', () => {
  const unknown = compiler.compileCard(card('unknown', 'Draw two cards. Then take an extra turn after this one.'));
  assert.equal(unknown.autoAccepted, false);
  assert.equal(unknown.status, 'review_required');
  assert.equal(unknown.script, null);
  assert.match(unknown.diagnostics.join(' '), /No exact high-confidence Oracle template/i);

  const almostDestroy = compiler.compileCard(card('almost-destroy', 'Destroy target creature. Its controller draws a card.', { typeLine: 'Instant' }));
  assert.equal(almostDestroy.autoAccepted, false, 'partial first-sentence matches must never execute');
});

test('Step 18: parser output is deterministic and versioned', () => {
  const first = compiler.compileCard(card('deterministic', 'Draw three cards.'));
  const second = compiler.compileCard(card('deterministic', 'Draw three cards.'));
  assert.equal(first.parserVersion, ORACLE_PARSER_VERSION);
  assert.equal(first.oracleFingerprint, second.oracleFingerprint);
  assert.equal(first.behaviorFingerprint, second.behaviorFingerprint);
  assert.deepEqual(first.script, second.script);
});

test('Step 18: Oracle text diff flags semantic behavior changes for review', () => {
  const before = { x: card('x', 'Draw two cards.', { name: 'Diff Card', oracleId: 'oracle-diff' }) };
  const after = { x: card('x', 'Draw three cards.', { name: 'Diff Card', oracleId: 'oracle-diff' }) };
  const diff = diffOracleCardSets(before, after, { compiler });
  assert.equal(diff.changeCount, 1);
  assert.equal(diff.changes[0].kind, 'oracle-text-changed');
  assert.equal(diff.changes[0].semanticBehaviorChanged, true);
  assert.equal(diff.changes[0].requiresReview, true);
});

test('Step 18: parser-version snapshot diff identifies exactly which compiled implementations changed', () => {
  const before = { cards: {
    a: { parserVersion: '1.0.0', oracleFingerprint: 'same', behaviorFingerprint: 'aaa' },
    b: { parserVersion: '1.0.0', oracleFingerprint: 'same2', behaviorFingerprint: 'bbb' }
  }};
  const after = { cards: {
    a: { parserVersion: '1.1.0', oracleFingerprint: 'same', behaviorFingerprint: 'ccc' },
    b: { parserVersion: '1.1.0', oracleFingerprint: 'same2', behaviorFingerprint: 'bbb' }
  }};
  const diff = diffCompilerSnapshots(before, after);
  assert.equal(diff.changeCount, 2);
  assert.equal(diff.behaviorChangeCount, 1);
  assert.equal(diff.parserVersionChangeCount, 2);
  assert.equal(diff.changes.find(row => row.cardId === 'a').kind, 'compiled-behavior-changed');
  assert.equal(diff.changes.find(row => row.cardId === 'b').kind, 'parser-version-changed-no-behavior-change');
});

test('Step 18: generated compiler artifacts cover every current card and never auto-accept unknown behavior', () => {
  assert.equal(compilation.parserVersion, ORACLE_PARSER_VERSION);
  assert.equal(compilation.rows.length, coverage.cardCount);
  if (coverage.productionCatalogUniverse) assert.ok(coverage.cardCount > Object.keys(db).length, 'production compiler artifacts should enumerate more than the curated trainer database');
  else assert.equal(coverage.cardCount, Object.keys(db).length);
  assert.equal(coverage.exactHighConfidenceCompilations, compilation.rows.filter(row => row.autoAccepted).length);
  assert.equal(reviewQueue.reviewCount, compilation.rows.filter(row => !row.autoAccepted).length);
  assert.equal(reviewQueue.reviewCount + coverage.exactHighConfidenceCompilations, coverage.cardCount);
  assert.ok(reviewQueue.cards.every(row => row.diagnostics.length > 0));
});

test('Step 18: current exact-template cards include representative draw, removal, and land-search templates', () => {
  const acceptedNames = new Set(compilation.rows.filter(row => row.autoAccepted).map(row => row.name));
  for (const name of ['Divination', 'Murder', 'Disenchant', 'Rampant Growth']) assert.ok(acceptedNames.has(name), `${name} should be exact-template compilable`);
  assert.ok(coverage.templateCounts['spell.draw-fixed'] >= 1);
  assert.ok(coverage.templateCounts['spell.destroy-target'] >= 2);
  assert.ok(coverage.templateCounts['spell.search-basic-land'] >= 1);
});

test('Step 18: committed compiler snapshot has a clean self-diff while retaining explicit review policy', () => {
  assert.equal(changeDiff.changeCount, 0);
  assert.match(changeDiff.policy, /never silently accepted/i);
  assert.match(coverage.metricPolicy, /exact full-text high-confidence/i);
});
