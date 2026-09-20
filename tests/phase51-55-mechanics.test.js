import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { GameEngine } from '../src/engine/GameEngine.js';
import { db, decks, putBattlefield } from './helpers.js';

const compiler=new OracleTemplateCompiler();
const compile=(oracleText,typeLine='Instant')=>compiler.compileCard({id:'p55',name:'P55',typeLine,keywords:[],oracleText,manaCost:'{2}'});
function game(){return new GameEngine(decks[0],decks[1],structuredClone(db),{rng:()=>0.42});}
function add(e,id,fields){e.db[id]={id,name:id,typeLine:'Artifact — Vehicle',manaCost:'{2}',manaValue:2,power:4,toughness:4,keywords:[],abilities:[],spellEffects:[],supported:true,...fields};}

test('Step51: Crew compiles to a variable creature-selection tap cost',()=>{
 const r=compile('Crew 3 (Tap any number of creatures you control with total power 3 or more: This Vehicle becomes an artifact creature until end of turn.)','Artifact — Vehicle');
 assert.equal(r.autoAccepted,true); const a=r.compiledCard.abilities[0]; assert.equal(a.selection.minCombinedPower,3); assert.equal(a.effect.type,'crewVehicle');
});

test('Step51: Crew validates combined power and becomes a creature until EOT',()=>{
 const e=game(); add(e,'veh',{abilities:[{type:'activated',cost:{},selection:{type:'Creature',minCount:1,maxCount:100,minCombinedPower:3,tap:true},effect:{type:'crewVehicle'}}]});
 add(e,'crew-a',{typeLine:'Creature',power:2,toughness:2}); add(e,'crew-b',{typeLine:'Creature',power:1,toughness:1});
 const v=putBattlefield(e,'player','veh'), a=putBattlefield(e,'player','crew-a',{summoningSick:false}), b=putBattlefield(e,'player','crew-b',{summoningSick:false}); const ability=e.db.veh.abilities[0];
 assert.throws(()=>e._validateAbilitySelections('player',v,ability.selection,[a.instanceId]),/combined power/);
 e._validateAbilitySelections('player',v,ability.selection,[a.instanceId,b.instanceId]);
 e.effects.resolve({type:'crewVehicle'},{controller:'player',source:v,selections:[a.instanceId,b.instanceId]});
 assert.equal(e.static.isType(v,'Creature'),true);
});

test('Step52: ordinary Saga entry gets lore and queues chapter I',()=>{
 const e=game(); add(e,'saga',{typeLine:'Enchantment — Saga',sagaChapters:[{number:1,effect:{type:'draw',amount:1}},{number:2,effect:{type:'gainLife',amount:2}}]});
 const s=putBattlefield(e,'player','saga'); e.counters.ensureEntryCounters(s); assert.equal(e.counters.count(s,'lore'),1); assert.ok(e.state.stack.some(x=>x.effect?.type==='resolveSagaChapter'&&x.effect.chapter.number===1));
});

test('Step53: adding multiple lore counters queues every crossed chapter and Read Ahead supports a chosen chapter',()=>{
 const e=game(); add(e,'ra',{typeLine:'Enchantment — Saga',readAhead:true,sagaChapters:[1,2,3].map(number=>({number,effect:{type:'draw',amount:1}}))});
 const s=putBattlefield(e,'player','ra'); e.counters.ensureEntryCounters(s); assert.equal(e.counters.count(s,'lore'),0); e.chooseReadAheadChapter('player',s,2); assert.equal(e.counters.count(s,'lore'),2); assert.deepEqual(e.state.stack.filter(x=>x.effect?.type==='resolveSagaChapter').map(x=>x.effect.chapter.number),[2]);
});

test('Step54: landfall, generic cast, and leave-the-battlefield event families compile',()=>{
 assert.equal(compile('Whenever a land enters the battlefield under your control, draw a card.','Enchantment').autoAccepted,true);
 assert.equal(compile('Whenever you cast a spell, you gain 2 life.','Enchantment').autoAccepted,true);
 assert.equal(compile('Whenever another permanent you control leaves the battlefield, draw a card.','Enchantment').autoAccepted,true);
});

test('Step55: choose two modal spells compile combinations and preserve per-mode target clauses',()=>{
 const r=compile('Choose two —\n• Draw a card.\n• You gain 2 life.\n• Destroy target creature.');
 assert.equal(r.autoAccepted,true); assert.equal(r.compiledCard.modes.length,3); const targeted=r.compiledCard.modes.find(m=>m.targets); assert.ok(targeted); assert.equal(targeted.effects[0].type,'sequence');
});
