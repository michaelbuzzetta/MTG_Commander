import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTargetedDeckManaImplementations } from '../src/cards/index.js';
import { GameEngine } from '../src/engine/GameEngine.js';

const raw={
 commander:{id:'commander',name:'Commander',typeLine:'Legendary Creature',manaCost:'{B}{R}',colors:['B','R'],power:2,toughness:2,abilities:[]},
 swamp:{id:'swamp',name:'Swamp',typeLine:'Basic Land — Swamp',subtypes:['Swamp'],abilities:[{type:'mana',tap:true,mana:{B:1}}]},
 ritual:{id:'ritual',name:'Dark Ritual',typeLine:'Instant',manaCost:'{B}',colors:['B'],oracleText:'Add {B}{B}{B}.'},
 jet:{id:'jet',name:'Jet Medallion',typeLine:'Artifact',manaCost:'{2}',oracleText:'Black spells you cast cost {1} less to cast.'},
 ruby:{id:'ruby',name:'Ruby Medallion',typeLine:'Artifact',manaCost:'{2}',oracleText:'Red spells you cast cost {1} less to cast.'},
 ghast:{id:'ghast',name:'Crypt Ghast',typeLine:'Creature — Spirit',manaCost:'{3}{B}',colors:['B'],power:2,toughness:2,oracleText:'Extort\nWhenever you tap a Swamp for mana, add an additional {B}.'},
 blackspell:{id:'blackspell',name:'Black Spell',typeLine:'Sorcery',manaCost:'{3}{B}',colors:['B'],spellEffects:[]},
 redspell:{id:'redspell',name:'Red Spell',typeLine:'Sorcery',manaCost:'{3}{R}',colors:['R'],spellEffects:[]},
 bluespell:{id:'bluespell',name:'Blue Spell',typeLine:'Sorcery',manaCost:'{3}{U}',colors:['U'],spellEffects:[]}
};
const db=applyTargetedDeckManaImplementations(raw);
const deck={id:'d',name:'d',commander:'commander',cards:[{id:'commander',quantity:1}]};
function eng(n=1){return new GameEngine(deck,Array.from({length:n},(_,i)=>({...deck,id:`o${i}`,name:`o${i}`})),db,{validateDecks:false,rng:()=>0.5});}
function put(e,pid,id){const c={instanceId:`${id}-${Math.random()}`,cardId:id,owner:pid,controller:pid,zone:'battlefield',tapped:false,phasedOut:false,summoningSick:false,counters:{},modifiers:{power:0,toughness:0,keywords:[]}};e.state.players[pid].battlefield.push(c);return c;}

test('all four targeted mana cards are certified exact overrides',()=>{for(const id of ['ritual','jet','ruby','ghast']) assert.equal(db[id].certificationEligible,true,id);});
test('Dark Ritual adds exactly three black mana',()=>{const e=eng(),pid=e.playerIds()[0];e.effects.resolve(db.ritual.spellEffects[0],{controller:pid});assert.equal(e.state.players[pid].manaPool.B,3);});
test('Jet and Ruby Medallion reduce only matching colored spells',()=>{const e=eng(),pid=e.playerIds()[0];put(e,pid,'jet');put(e,pid,'ruby');assert.equal(e.costs.determineSpellCost(pid,{instanceId:'b',cardId:'blackspell',zone:'hand'}).finalManaCost,'{2}{B}');assert.equal(e.costs.determineSpellCost(pid,{instanceId:'r',cardId:'redspell',zone:'hand'}).finalManaCost,'{2}{R}');assert.equal(e.costs.determineSpellCost(pid,{instanceId:'u',cardId:'bluespell',zone:'hand'}).finalManaCost,'{3}{U}');});
test('Crypt Ghast doubles mana produced by tapping a Swamp',()=>{const e=eng(),pid=e.playerIds()[0];put(e,pid,'ghast');const swamp=put(e,pid,'swamp');e._applyActivateMana(pid,swamp.instanceId,db.swamp.abilities[0]);assert.equal(e.state.players[pid].manaPool.B,2);});
test('Crypt Ghast extort payment drains each opponent and gains total life lost',()=>{const e=eng(2),pid=e.playerIds()[0],ghast=put(e,pid,'ghast');e.state.players[pid].manaPool.B=1;const before=e.state.players[pid].life;e.effects.resolve(db.ghast.abilities[0].effect,{controller:pid,source:ghast});assert.equal(e.state.pendingChoice.type,'OPTIONAL_EFFECT');e._applyOptionalEffectChoice(pid,true);assert.equal(e.state.players[pid].life,before+2);for(const opp of e.opponents(pid)) assert.equal(e.state.players[opp].life,39);assert.equal(e.state.players[pid].manaPool.B,0);});

test('Crypt Ghast extort trigger observes spells cast by its controller',()=>{const e=eng(),pid=e.playerIds()[0];put(e,pid,'ghast');e.emit('SPELL_CAST',{controller:pid,card:{instanceId:'spell-x',cardId:'blackspell',controller:pid,zone:'stack'}});assert.ok(e.state.stack.some(t=>t.source?.cardId==='ghast' || t.sourceId?.includes?.('ghast')));});
