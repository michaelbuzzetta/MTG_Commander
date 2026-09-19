import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { engine } from './helpers.js';
import {
  buildLegalActionIndex,
  cardActionPresentation,
  buildStackPriorityModel,
  paymentPresentation,
  normalizeUnsupportedInteraction
} from '../src/ui/RulesUiModel.js';

test('Step 39 legal-action presentation is driven only by engine-provided legal actions', () => {
  const actions = [
    { type: 'CAST_SPELL', cardInstanceId: 'card-a' },
    { type: 'ACTIVATE_ABILITY', permanentId: 'perm-a' },
    { type: 'ACTIVATE_MANA', permanentId: 'perm-a' }
  ];
  const index = buildLegalActionIndex(actions);
  assert.equal(index.byCard.get('card-a').length, 1);
  assert.equal(index.byPermanent.get('perm-a').length, 2);
  assert.equal(cardActionPresentation({ instanceId: 'card-a', zone: 'hand', index, hasPriority: true }).state, 'legal');
  assert.equal(cardActionPresentation({ instanceId: 'missing', zone: 'hand', index, hasPriority: false }).state, 'blocked');
  assert.match(cardActionPresentation({ instanceId: 'missing', zone: 'hand', index, hasPriority: false }).tooltip, /priority/i);
});

test('Step 39 stack/priority view model preserves authoritative ordering, controller, targets and priority owner', () => {
  const e = engine();
  const source = e.state.players.player.battlefield[0] || e.state.players.player.command[0];
  const card = e.state.players.player.hand[0];
  e.stack.push({ type: 'spell', controller: 'player', card, source: card, targets: ['ai'] });
  e.stack.push({ type: 'ability', controller: 'ai', source: source || { instanceId: 'source', cardId: 'unknown' }, ability: { id: 'test' }, targets: ['player'] });
  e.state.priorityPlayer = 'player';
  const model = buildStackPriorityModel(e.getStackPriorityView(), e.getCardDatabaseSnapshot(), id => id === 'player' ? 'You' : 'AI', id => id === 'player' ? 'You' : id === 'ai' ? 'AI' : String(id));
  assert.equal(model.stackDepth, 2);
  assert.equal(model.items[0].type, 'ability', 'UI order must show the top of stack first');
  assert.equal(model.items[1].type, 'spell');
  assert.equal(model.priorityPlayerLabel, 'You');
  assert.deepEqual(model.items[0].targetLabels, ['You']);
});

test('Step 39 payment presentation renders an authoritative engine payment plan without mutating game state', () => {
  const state = {
    players: {
      player: { battlefield: [{ instanceId: 'land-1', cardId: 'forest' }] }
    }
  };
  const plan = {
    lockedCost: { finalManaCost: '{1}{G}', nonManaCosts: [{ type: 'payLife', amount: 2 }] },
    activations: [{ permanentId: 'land-1', mana: { G: 1 }, requiresTap: true }],
    lifePayment: 1
  };
  const model = paymentPresentation(plan, state, { forest: { name: 'Forest' } });
  assert.equal(model.finalManaCost, '{1}{G}');
  assert.equal(model.sources[0].label, 'Forest → G');
  assert.equal(model.lifePayment, 1);
  assert.equal(model.nonManaCosts[0].type, 'payLife');
  assert.deepEqual(state.players.player.battlefield[0], { instanceId: 'land-1', cardId: 'forest' });
});

test('Step 39 unsupported interaction normalization is explicit and does not misclassify ordinary errors', () => {
  const unsupported = normalizeUnsupportedInteraction(new Error('This script node is not implemented'), { cardName: 'Example Card', rulesVersion: 'rules-test' });
  assert.equal(unsupported.title, 'Unsupported interaction');
  assert.equal(unsupported.cardName, 'Example Card');
  assert.equal(unsupported.rulesVersion, 'rules-test');
  assert.ok(unsupported.diagnosticId);
  assert.equal(normalizeUnsupportedInteraction(new Error('Insufficient mana')), null);
});

test('Step 39 React integration contains generic rules dialogs, stack/priority panel, legal highlighting and unsupported fail-safe surface', () => {
  const app = fs.readFileSync('src/App.jsx', 'utf8');
  const card = fs.readFileSync('src/components/Card.jsx', 'utf8');
  const choice = fs.readFileSync('src/components/ChoiceDialog.jsx', 'utf8');
  const payment = fs.readFileSync('src/components/PaymentDialog.jsx', 'utf8');
  const stack = fs.readFileSync('src/components/StackPriorityPanel.jsx', 'utf8');
  const unsupported = fs.readFileSync('src/components/UnsupportedInteractionDialog.jsx', 'utf8');
  assert.match(app, /<StackPriorityPanel/);
  assert.match(app, /<PaymentDialog/);
  assert.match(app, /<RulesActionPicker/);
  assert.match(app, /<UnsupportedInteractionDialog/);
  assert.match(app, /buildLegalActionIndex\(playerLegalActions\)/);
  assert.match(card, /legal-action/);
  assert.match(choice, /request\.choiceType/);
  assert.match(payment, /authoritative cost\/payment engine/);
  assert.match(stack, /getStackPriorityView/);
  assert.match(unsupported, /did not approximate the interaction/);
});
