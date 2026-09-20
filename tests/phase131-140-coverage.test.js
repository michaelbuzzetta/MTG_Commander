import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateLibrary } from '../src/cards/compiler/OracleTemplateLibrary.js';
const lib=new OracleTemplateLibrary();
const cases=[
['phase131.ward-discard','Ward—Discard a card.'],
['phase132.power-evasion',"Creatures with power less than this creature's power can't block it."],
['phase133.enlist',"Enlist (As this creature attacks, you may tap a nonattacking creature you control without summoning sickness. When you do, add its power to this creature's until end of turn.)"],
['phase134.verse-upkeep','At the beginning of your upkeep, you may put a verse counter on this enchantment.'],
['phase135.gift-card','Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)'],
['phase136.additional-discard-x','As an additional cost to cast this spell, discard X cards.'],
['phase137.move-plus-counter','{2}, Remove a +1/+1 counter from this creature: Put a +1/+1 counter on target creature.'],
['phase138.offspring','Offspring {2} (You may pay an additional {2} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)'],
['phase139.fabricate','Fabricate 1 (When this creature enters, put a +1/+1 counter on it or create a 1/1 colorless Servo artifact creature token.)'],
['phase140.island-dependency','When you control no Islands, sacrifice this creature.']];
for(const [id,oracleText] of cases)test(id,()=>{const m=lib.match({oracleText,keywords: id.includes('ward')?['Ward']:[]}); assert.ok(m.some(x=>x.templateId===id),JSON.stringify(m));});
