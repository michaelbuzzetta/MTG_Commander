import test from 'node:test';
import assert from 'node:assert/strict';
import { CardGoldenHarness } from './golden/CardGoldenHarness.js';

for (const cardId of ['arch-memnite', 'arch-yargle-and-multani']) {
  test(`release certification: ${cardId} resolves using only base characteristics`, () => {
    const h = new CardGoldenHarness();
    const definition = h.definition(cardId);
    const card = h.castAndResolve(cardId);
    assert.equal(h.zoneOf(card), 'battlefield');
    const permanent = h.engine.findPermanent(card.instanceId);
    assert.equal(h.engine.getDerivedStats(permanent).power, Number(definition.power));
    assert.equal(h.engine.getDerivedStats(permanent).toughness, Number(definition.toughness));
  });
}

test('release certification: arch-disenchant destroys only through the authoritative destroy path', () => {
  const h = new CardGoldenHarness();
  const target = h.permanent('sol-ring', 'ai');
  const spell = h.castAndResolve('arch-disenchant', { targets: [target.instanceId] });
  assert.equal(h.zoneOf(target), 'graveyard');
  assert.equal(h.zoneOf(spell), 'graveyard');
});

test('release certification: arch-rampant-growth finds a basic land and puts it onto the battlefield tapped', () => {
  const h = new CardGoldenHarness();
  const beforeIds = new Set(h.engine.state.players.player.battlefield.map(card => card.instanceId));
  const spell = h.castAndResolve('arch-rampant-growth');
  assert.equal(h.zoneOf(spell), 'graveyard');
  const added = h.engine.state.players.player.battlefield.filter(card => !beforeIds.has(card.instanceId));
  assert.equal(added.length, 1);
  assert.equal(added[0].tapped, true);
  assert.match(h.definition(added[0].cardId).typeLine || '', /Basic Land/i);
});
