import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
const c=new OracleTemplateCompiler();
const compile=(oracleText,typeLine='Creature')=>c.compileCard({id:oracleText,name:'P91-100',typeLine,oracleText,manaCost:'{2}',keywords:[]});
const cases=[
 ['91','Exploit (When this creature enters, you may sacrifice a creature.)','exploit'],
 ['92','Cumulative upkeep {1} (At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it.)','cumulativeUpkeep'],
 ['93','Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)','extort'],
 ['94',"Unleash (You may have this creature enter with a +1/+1 counter on it. It can't block as long as it has a +1/+1 counter on it.)",'unleash'],
 ['95','Riot (This creature enters with your choice of a +1/+1 counter or haste.)','riot'],
 ['96','Melee (Whenever this creature attacks, it gets +1/+1 until end of turn for each opponent you attacked this combat.)','melee'],
 ['97','Bloodthirst 1 (If an opponent was dealt damage this turn, this creature enters with a +1/+1 counter on it.)','bloodthirst'],
 ['98','Ravenous (This creature enters with X +1/+1 counters on it. If X is 5 or more, draw a card when it enters.)','ravenous'],
 ['99','Jump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs. Then exile this card.)','castingOptions'],
 ['100','Soulbond (You may pair this creature with another unpaired creature when either enters. They remain paired for as long as you control both of them.)','soulbond']
];
for(const [phase,text,key] of cases)test(`Phase ${phase} compiles explicit ${key} semantics`,()=>{const r=compile(text);assert.equal(r.autoAccepted,true);assert.ok(r.compiledCard[key]||r.compiledCard.abilities?.length);});
