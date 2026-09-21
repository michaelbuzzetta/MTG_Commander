import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTargetedDeckLandImplementations } from '../src/cards/index.js';
import { GameEngine } from '../src/engine/GameEngine.js';

const lands = {
  mountain:{id:'mountain',name:'Mountain',typeLine:'Basic Land — Mountain',subtypes:['Mountain'],oracleText:'{T}: Add {R}.',abilities:[{type:'mana',tap:true,mana:{R:1}}]},
  swamp:{id:'swamp',name:'Swamp',typeLine:'Basic Land — Swamp',subtypes:['Swamp'],oracleText:'{T}: Add {B}.',abilities:[{type:'mana',tap:true,mana:{B:1}}]},
  verge:{id:'verge',name:'Blazemire Verge',typeLine:'Land',oracleText:'{T}: Add {B}.\n{T}: Add {R}. Activate only if you control a Swamp or a Mountain.'},
  cairns:{id:'cairns',name:'Graven Cairns',typeLine:'Land',oracleText:'{T}: Add {C}.\n{B/R}, {T}: Add {B}{B}, {B}{R}, or {R}{R}.'},
  ridge:{id:'ridge',name:'Haunted Ridge',typeLine:'Land',oracleText:'This land enters tapped unless you control two or more other lands.\n{T}: Add {B} or {R}.'},
  leech:{id:'leech',name:'Leechridden Swamp',typeLine:'Land — Swamp',subtypes:['Swamp'],oracleText:'({T}: Add {B}.)\nThis land enters tapped.\n{B}, {T}: Each opponent loses 1 life. Activate only if you control two or more black permanents.'},
  suite:{id:'suite',name:'Luxury Suite',typeLine:'Land',oracleText:'This land enters tapped unless you have two or more opponents.\n{T}: Add {B} or {R}.'},
  minas:{id:'minas',name:'Minas Morgul, Dark Fortress',typeLine:'Legendary Land',oracleText:'Minas Morgul enters tapped.\n{T}: Add {B}.\n{3}{B}, {T}: Put a shadow counter on target creature. For as long as that creature has a shadow counter on it, it is a Wraith in addition to its other types.'},
  tower:{id:'tower',name:'Reliquary Tower',typeLine:'Land',oracleText:'You have no maximum hand size. {T}: Add {C}.'},
  gorge:{id:'gorge',name:'Shivan Gorge',typeLine:'Legendary Land',oracleText:'{T}: Add {C}.\n{2}{R}, {T}: Shivan Gorge deals 1 damage to each opponent.'},
  clinic:{id:'clinic',name:"Witch's Clinic",typeLine:'Land',oracleText:'{T}: Add {C}.\n{2}, {T}: Target commander gains lifelink until end of turn.'},
  black:{id:'black',name:'Black Permanent',typeLine:'Creature',manaCost:'{B}',colors:['B'],power:1,toughness:1,abilities:[]},
  creature:{id:'creature',name:'Test Creature',typeLine:'Legendary Creature',power:2,toughness:2,abilities:[]}
};
const db=applyTargetedDeckLandImplementations(lands);
const deck={id:'d',name:'d',commander:'creature',cards:[{id:'creature',quantity:1}]};
function engine(opponents=1){ return new GameEngine(deck, Array.from({length:opponents},(_,i)=>({...deck,id:`o${i}`,name:`o${i}`})), db, {validateDecks:false,rng:()=>0.5}); }
function put(e,pid,id,{commander=false}={}){ const c={instanceId:`${id}-${Math.random()}`,cardId:id,owner:pid,controller:pid,zone:'battlefield',tapped:false,phasedOut:false,summoningSick:false,counters:{},modifiers:{power:0,toughness:0,keywords:[]},isCommander:commander}; e.state.players[pid].battlefield.push(c); return c; }

test('targeted land definitions are exact executable overrides',()=>{
  for(const id of ['verge','cairns','ridge','leech','suite','minas','tower','gorge','clinic']) assert.equal(db[id].certificationEligible,true,id);
  assert.equal(db.tower.noMaximumHandSize,true);
  assert.deepEqual(db.ridge.entersTappedUnless,{kind:'controlCount',type:'Land',other:true,operator:'>=',amount:2});
  assert.deepEqual(db.suite.entersTappedUnless,{kind:'opponentCount',operator:'>=',amount:2});
});

test('Haunted Ridge and Luxury Suite entry conditions work',()=>{
  const e=engine(2), pid=Object.keys(e.state.players)[0];
  const ridge=put(e,pid,'ridge'); assert.equal(e._permanentEntersTapped(ridge,pid),true);
  put(e,pid,'mountain'); put(e,pid,'swamp'); assert.equal(e._permanentEntersTapped(ridge,pid),false);
  const suite=put(e,pid,'suite'); assert.equal(e._permanentEntersTapped(suite,pid),false);
});

test('Blazemire Verge red mana requires a Swamp or Mountain',()=>{
  const e=engine(), pid=Object.keys(e.state.players)[0], verge=put(e,pid,'verge'); const red=db.verge.abilities[1];
  assert.equal(e.mana.canUseManaAbility(e.state.players[pid],verge,db.verge,red,e),false);
  put(e,pid,'swamp'); assert.equal(e.mana.canUseManaAbility(e.state.players[pid],verge,db.verge,red,e),true);
});

test('Reliquary Tower removes maximum hand size',()=>{ const e=engine(),pid=Object.keys(e.state.players)[0]; put(e,pid,'tower'); assert.equal(e.static.maximumHandSize(pid),Infinity); });

test('Minas Morgul shadow counter grants Wraith and shadow',()=>{
  const e=engine(),pid=Object.keys(e.state.players)[0], target=put(e,pid,'creature'); target.counters.shadow=1;
  // Counter-granted characteristics are layer-derived, not destructive base mutations.
  target.cardId='minas'; target.counters.shadow=1;
  assert.equal(e.static.hasSubtype(target,'Wraith'),true); assert.ok(e.static.derivedStats(target).keywords.includes('shadow'));
});

test('Shivan Gorge damages every opponent and Leechridden drains every opponent',()=>{
  const e=engine(2),pid=Object.keys(e.state.players)[0], gorge=put(e,pid,'gorge'), leech=put(e,pid,'leech'); const opp=e.opponents(pid); const before=opp.map(x=>e.state.players[x].life);
  e.effects.resolve({type:'damageEachOpponent',amount:1},{controller:pid,source:gorge,targets:[]});
  assert.deepEqual(opp.map(x=>e.state.players[x].life),before.map(x=>x-1));
  e.effects.resolve({type:'eachOpponentLoseLife',amount:1},{controller:pid,source:leech,targets:[]});
  assert.deepEqual(opp.map(x=>e.state.players[x].life),before.map(x=>x-2));
});

test("Witch's Clinic target restriction accepts only commanders",()=>{
  const e=engine(),pid=Object.keys(e.state.players)[0], clinic=put(e,pid,'clinic'), normal=put(e,pid,'creature'), commander=put(e,pid,'creature',{commander:true}); const ability=db.clinic.abilities[1];
  assert.throws(()=>e.targeting.validateTargets(pid,ability,[normal.instanceId],{sourceObject:clinic}),/commander/);
  assert.equal(e.targeting.validateTargets(pid,ability,[commander.instanceId],{sourceObject:clinic}),true);
});
