import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateLibrary } from '../src/cards/compiler/OracleTemplateLibrary.js';
const lib=new OracleTemplateLibrary();
const cases=[
['phase141.additional-exile-creature-grave','As an additional cost to cast this spell, exile a creature card from your graveyard.'],
['phase142.conspire','Conspire (As you cast this spell, you may tap two untapped creatures you control that share a color with it. When you do, copy it and you may choose a new target for the copy.)'],
['phase143.firebending','Firebending 1 (Whenever this creature attacks, add {R}. This mana lasts until end of combat.)'],
['phase144.additional-sacrifice-artifact','As an additional cost to cast this spell, sacrifice an artifact.'],
['phase145.activated-flying','{U}: This creature gains flying until end of turn.'],
['phase146.increment',"Increment (Whenever you cast a spell, if the amount of mana you spent is greater than this creature's power or toughness, put a +1/+1 counter on this creature.)"],
['phase147.squad','Squad {2} (As an additional cost to cast this spell, you may pay {2} any number of times. When this creature enters, create that many tokens that are copies of it.)'],
['phase148.tap-freeze',"Tap target creature. It doesn't untap during its controller's next untap step."],
['phase149.entwine','Entwine {2} (Choose both if you pay the entwine cost.)'],
['phase150.activated-vigilance','{W}: This creature gains vigilance until end of turn.'],
['phase151.hand-disruption','Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.'],
['phase152.artifact-count-pump','This creature gets +1/+0 for each artifact you control.'],
['phase153.life-gain-plus-one','If you would gain life, you gain that much life plus 1 instead.'],
['phase154.charge-counters-entry','This artifact enters with three charge counters on it.'],
['phase155.stun-etb','When this creature enters, tap target creature an opponent controls and put a stun counter on it. (If a permanent with a stun counter would become untapped, remove one from it instead.)'],
['phase156.mobilize','Mobilize 1 (Whenever this creature attacks, create a tapped and attacking 1/1 red Warrior creature token. Sacrifice it at the beginning of the next end step.)'],
['phase157.tap-creature-mana','{T}, Tap an untapped creature you control: Add one mana of any color.'],
['phase158.global-minus-two','All creatures get -2/-2 until end of turn.'],
['phase159.sunburst','Sunburst (This creature enters with a +1/+1 counter on it for each color of mana spent to cast it.)'],
['phase160.devour','Devour 1 (As this creature enters, you may sacrifice any number of creatures. It enters with that many +1/+1 counters on it.)']];
for(const [id,oracleText] of cases)test(id,()=>{const m=lib.match({oracleText}); assert.ok(m.some(x=>x.templateId===id),JSON.stringify(m));});
