import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTargetedDeckRemovalImplementations } from '../src/cards/index.js';
import { GameEngine } from '../src/engine/GameEngine.js';
import { expandManaCostAlternatives } from '../src/engine/costs/ManaSymbol.js';
const raw={
 commander:{id:'commander',name:'Commander',typeLine:'Legendary Creature',manaCost:'{B}{R}',colors:['B','R'],power:2,toughness:2,abilities:[]},
 bedevil:{id:'bedevil',name:'Bedevil',typeLine:'Instant',manaCost:'{B}{B}{R}',colors:['B','R']},
 terminate:{id:'terminate',name:'Terminate',typeLine:'Instant',manaCost:'{B}{R}',colors:['B','R']},
 gut:{id:'gut',name:'Gut Shot',typeLine:'Instant',manaCost:'{R/P}',colors:['R']},
 play:{id:'play',name:'Play with Fire',typeLine:'Instant',manaCost:'{R}',colors:['R']},
 creature:{id:'creature',name:'Creature',typeLine:'Creature',manaCost:'{1}',power:2,toughness:2,abilities:[]},
 artifact:{id:'artifact',name:'Artifact',typeLine:'Artifact',manaCost:'{1}',abilities:[]},
 walker:{id:'walker',name:'Walker',typeLine:'Legendary Planeswalker',manaCost:'{2}',loyalty:3,abilities:[]},
 top:{id:'top',name:'Top',typeLine:'Sorcery',manaCost:'{1}',spellEffects:[]}
};
const db=applyTargetedDeckRemovalImplementations(raw);
const deck={id:'d',name:'d',commander:'commander',cards:[{id:'commander',quantity:1}]};
function eng(){return new GameEngine(deck,{...deck,id:'o',name:'o'},db,{validateDecks:false,rng:()=>0.5});}
function put(e,pid,id){const c={instanceId:`${id}-${Math.random()}`,cardId:id,owner:pid,controller:pid,zone:'battlefield',tapped:false,phasedOut:false,summoningSick:false,counters:{},damageMarked:0,modifiers:{power:0,toughness:0,keywords:[]}};e.state.players[pid].battlefield.push(c);return c;}
test('four removal cards receive exact certified overrides',()=>{for(const id of ['bedevil','terminate','gut','play']) assert.equal(db[id].certificationEligible,true,id); assert.equal(db.terminate.spellEffects[0].cannotRegenerate,true);});
test('Bedevil destroys an artifact target',()=>{const e=eng(),pid=e.playerIds()[0],opp=e.opponents(pid)[0],a=put(e,opp,'artifact');e.effects.resolve(db.bedevil.spellEffects[0],{controller:pid,targets:[a.instanceId],targeted:true});assert.equal(e.findPermanent(a.instanceId),null);assert.equal(e.state.players[opp].graveyard.at(-1).cardId,'artifact');});
test('Terminate destroys a creature target',()=>{const e=eng(),pid=e.playerIds()[0],opp=e.opponents(pid)[0],c=put(e,opp,'creature');e.effects.resolve(db.terminate.spellEffects[0],{controller:pid,targets:[c.instanceId],targeted:true});assert.equal(e.findPermanent(c.instanceId),null);});
test('Gut Shot uses Phyrexian red mana and deals one damage',()=>{const e=eng(),pid=e.playerIds()[0],opp=e.opponents(pid)[0];const cost=e.costs.determineSpellCost(pid,{instanceId:'g',cardId:'gut',zone:'hand'}).finalManaCost;const alts=expandManaCostAlternatives(cost);assert.ok(alts.some(x=>x.life===2));const before=e.state.players[opp].life;e.effects.resolve(db.gut.spellEffects[0],{controller:pid,targets:[opp],targeted:true});assert.equal(e.state.players[opp].life,before-1);});
test('Play with Fire damages a player then opens scry 1',()=>{const e=eng(),pid=e.playerIds()[0],opp=e.opponents(pid)[0];e.state.players[pid].library=[{instanceId:'top-1',cardId:'top',owner:pid,controller:pid,zone:'library'}];const before=e.state.players[opp].life;e.effects.resolve(db.play.spellEffects[0],{controller:pid,targets:[opp],targeted:true});assert.equal(e.state.players[opp].life,before-2);assert.equal(e.state.pendingChoice?.type,'SCRY');});
test('Play with Fire hitting a creature does not scry',()=>{const e=eng(),pid=e.playerIds()[0],opp=e.opponents(pid)[0],c=put(e,opp,'creature');e.state.players[pid].library=[{instanceId:'top-1',cardId:'top',owner:pid,controller:pid,zone:'library'}];e.effects.resolve(db.play.spellEffects[0],{controller:pid,targets:[c.instanceId],targeted:true});assert.notEqual(e.state.pendingChoice?.type,'SCRY');assert.equal(c.damageMarked,2);});
