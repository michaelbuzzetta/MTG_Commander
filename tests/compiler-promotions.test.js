import test from 'node:test';
import assert from 'node:assert/strict';
import promotions from '../src/data/generated/compiler-promoted-cards.json' with { type: 'json' };
import { getBuiltInCardDatabase } from '../src/database/index.js';
import { CardSupportService } from '../src/cards/index.js';

test('compiler promotion artifact contains only explicit uncertified runtime implementations', () => {
  assert.ok(promotions.promotedCount > 1000);
  assert.equal(promotions.promotedCount, Object.keys(promotions.cards).length);
  for (const card of Object.values(promotions.cards)) {
    assert.equal(card.compilerPromoted, true);
    assert.ok(card.script?.abilities);
    assert.equal(card.compilerPromotion.certificationEligible, false);
    assert.equal(card.compilerPromotion.certificationStatus, 'uncertified');
  }
});

test('compiler-promoted cards enter the built-in runtime database as partial/strict-ineligible behavior', () => {
  const db = getBuiltInCardDatabase();
  const essence = Object.values(promotions.cards).find(card => card.name === 'Essence Scatter');
  assert.ok(essence);
  assert.ok(db[essence.id]);
  const support = new CardSupportService(db);
  const prepared = support.prepareCard(db[essence.id]);
  assert.equal(prepared.supportStatus, 'partially_supported');
  assert.equal(prepared.supportMetadata.strictEligible, false);
  assert.match(prepared.supportMetadata.caveats.join(' '), /not been certified/i);
});
