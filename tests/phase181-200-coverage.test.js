import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateLibrary } from '../src/cards/compiler/OracleTemplateLibrary.js';

const lib = new OracleTemplateLibrary();
const samples = [
  ['Claim the revealed bounty during your turn and collect your reward!', 'phase181.bounty-claim'],
  ['If the bounty went unclaimed last turn, increase its reward to the next level.', 'phase182.bounty-escalate'],
  ['1 — Create a Treasure token', 'phase183.bounty-reward-one'],
  ['2 — Create two Treasure tokens', 'phase184.bounty-reward-two'],
  ['3 — Create two Treasure tokens *or* draw a card', 'phase185.bounty-reward-three'],
  ['4 — (Max) Create two Treasure tokens *and* draw a card.', 'phase186.bounty-reward-four'],
  ['As this Aura enters, choose a color.', 'phase187.choose-color-aura'],
  ['As this enchantment enters, choose a color.', 'phase188.choose-color-enchantment'],
  ['As this artifact enters, choose a color.', 'phase189.choose-color-artifact'],
  ['As this creature enters, choose a color.', 'phase190.choose-color-creature'],
  ["Tap target creature. It doesn't untap during its controller's next untap step.", 'phase191.freeze-one'],
  ["Tap up to two target creatures. Those creatures don't untap during their controller's next untap step.", 'phase192.freeze-two'],
  ["Increment (Whenever you cast a spell, if the amount of mana you spent is greater than this creature's power or toughness, put a +1/+1 counter on this creature.)", 'phase193.increment'],
  ['LEVEL 4+', 'phase194.level-four-marker'],
  ['• You gain 2 life.', 'phase195.gain-two'],
  ['• Draw a card.', 'phase196.draw-one'],
  ['Rewards', 'phase197.rewards-heading'],
  ['OBJECTIVE:', 'phase198.objective-heading'],
  ['GET READY:', 'phase199.get-ready-heading'],
  ['TO WIN:', 'phase200.to-win-heading']
];
for (const [text,id] of samples) test(id,()=>{ const r=lib.match({oracleText:text}); assert.ok(r.some(x=>x.templateId===id), JSON.stringify(r)); });
