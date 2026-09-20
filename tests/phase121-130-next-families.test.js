import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
const c=new OracleTemplateCompiler();
const compile=(oracleText,typeLine='Creature')=>c.compileCard({id:oracleText,name:'P121-130',typeLine,oracleText,manaCost:'{2}',keywords:[]});
const cases=[
['121','When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.','Enchantment'],
['122','{T}: Prevent the next 1 damage that would be dealt to any target this turn.','Creature'],
['123',"Cast this spell only during the declare attackers step and only if you've been attacked this step.",'Instant'],
['124','Remove three spore counters from this creature: Create a 1/1 green Saproling creature token.','Creature'],
['125','As this creature enters, choose a color.','Creature'],
['126','If this creature was kicked, it enters with two +1/+1 counters on it.','Creature'],
['127','Learn. (You may reveal a Lesson card you own from outside the game and put it into your hand, or discard a card to draw a card.)','Sorcery'],
['128','Start your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)','Enchantment'],
['129','(Gain the next level as a sorcery to add its ability.)','Enchantment — Class'],
['130',"(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)",'Battle — Siege']
];
for(const [phase,text,typeLine] of cases)test(`Phase ${phase}`,()=>{const r=compile(text,typeLine);assert.equal(r.autoAccepted,true,JSON.stringify(r));});
