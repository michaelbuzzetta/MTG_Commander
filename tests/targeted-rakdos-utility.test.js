import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTargetedDeckUtilityImplementations } from '../src/cards/index.js';
import { GameEngine } from '../src/engine/GameEngine.js';

const raw={
 cmd:{id:'cmd',name:'Valgavoth',typeLine:'Legendary Creature',manaCost:'{2}{B}{R}',colors:['B','R'],colorIdentity:['B','R'],power:4,toughness:4,abilities:[]},
 greaves:{id:'greaves',name:'Lightning Greaves',typeLine:'Artifact — Equipment',manaCost:'{2}',abilities:[]},
 spear:{id:'spear',name:'Shadowspear',typeLine:'Legendary Artifact — Equipment',manaCost:'{1}',abilities:[]},
 ring:{id:'ring',name:'Sol Ring',typeLine:'Artifact',manaCost:'{1}',abilities:[]},
 signet:{id:'signet',name:'Arcane Signet',typeLine:'Artifact',manaCost:'{2}',abilities:[]},
 reper:{id:'reper',name:'Repercussion',typeLine:'Enchantment',manaCost:'{1}{R}{R}',colors:['R'],abilities:[]},
 bear:{id:'bear',name:'Bear',typeLine:'Creature',manaCost:'{1}{G}',colors:['G'],power:2,toughness:2,abilities:[]},
 warded:{id:'warded',name:'Warded',typeLine:'Creature',manaCost:'{2}',power:4,toughness:4,keywords:['hexproof','indestructible'],abilities:[]}
};
const db=applyTargetedDeckUtilityImplementations(raw),deck={id:'d',name:'d',commander:'cmd',cards:[{id:'cmd',quantity:1}]};
const eng=()=>new GameEngine(deck,{...deck,id:'o'},db,{validateDecks:false,rng:()=>.5});
let n=0; function put(e,p,id,extra={}){const c={instanceId:`${id}-${++n}`,cardId:id,owner:p,controller:p,zone:'battlefield',tapped:false,phasedOut:false,summoningSick:false,counters:{},damageMarked:0,modifiers:{power:0,toughness:0,keywords:[]},...extra};e.state.players[p].battlefield.push(c);return c;}

test('utility batch is certified',()=>{for(const id of ['greaves','spear','ring','signet','reper']){assert.equal(db[id].certificationEligible,true);assert.equal(db[id].targetedImplementation,'rakdos-deck-utility-v1')}});
test('Lightning Greaves grants haste and shroud and equips for zero',()=>{const e=eng(),p=e.playerIds()[0],g=put(e,p,'greaves'),c=put(e,p,'bear');g.attachedTo=c.instanceId;const k=e.static.derivedStats(c).keywords;assert.ok(k.includes('haste'));assert.ok(k.includes('shroud'));assert.equal(e.attachments.equipCost(g),'{0}')});
test('Shadowspear grants +1/+1 trample lifelink and strips current opposing hexproof/indestructible',()=>{const e=eng(),p=e.playerIds()[0],o=e.opponents(p)[0],s=put(e,p,'spear'),c=put(e,p,'bear'),w=put(e,o,'warded');s.attachedTo=c.instanceId;let st=e.static.derivedStats(c);assert.equal(st.power,3);assert.equal(st.toughness,3);assert.ok(st.keywords.includes('trample'));assert.ok(st.keywords.includes('lifelink'));e.effects.resolve({type:'opponentsPermanentsLoseKeywordsUntilEOT',keywords:['hexproof','indestructible']},{controller:p,source:s});st=e.static.derivedStats(w);assert.ok(!st.keywords.includes('hexproof'));assert.ok(!st.keywords.includes('indestructible'))});
test('Sol Ring taps for two colorless',()=>{const e=eng(),p=e.playerIds()[0],r=put(e,p,'ring'),a=db.ring.abilities[0];e._applyActivateMana(p,r.instanceId,a);assert.equal(e.state.players[p].manaPool.C,2);assert.equal(r.tapped,true)});
test('Arcane Signet in this BR commander deck produces black or red only',()=>{const e=eng(),p=e.playerIds()[0],a=db.signet.abilities[0];assert.deepEqual(a.colors,['B','R']);const s=put(e,p,'signet');e._applyActivateMana(p,s.instanceId,a,'R');assert.equal(e.state.players[p].manaPool.R,1)});
test('Repercussion damage effect mirrors creature damage amount to its controller',()=>{const e=eng(),p=e.playerIds()[0],o=e.opponents(p)[0],src=put(e,p,'reper'),c=put(e,o,'bear');const life=e.state.players[o].life;e.effects.resolve({type:'repercussionDamage'},{controller:p,source:src,eventPayload:{controller:o,target:c,amount:3}});assert.equal(e.state.players[o].life,life-3)});
test('Repercussion trigger is created when a creature is dealt damage',()=>{const e=eng(),p=e.playerIds()[0],o=e.opponents(p)[0];put(e,p,'reper');const c=put(e,o,'bear');e.dealDamageToPermanent(c,1,{instanceId:'src',cardId:'cmd',controller:p,owner:p});assert.ok(e.state.stack.some(x=>x.effect?.type==='repercussionDamage'))});
