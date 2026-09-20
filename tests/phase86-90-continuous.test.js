import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { GameEngine } from '../src/engine/GameEngine.js';
import { db, decks, putBattlefield } from './helpers.js';

const compiler = new OracleTemplateCompiler();
const compile=(oracleText,typeLine='Instant',keywords=[])=>compiler.compileCard({id:oracleText,name:'Phase86-90',typeLine,oracleText,manaCost:'{2}',keywords});
function game(){ return new GameEngine(decks[0],decks[1],structuredClone(db),{rng:()=>0.42}); }

test('Phase86 groups ordinary multiline modal Oracle into one executable semantic unit',()=>{
 const r=compile('Choose one —\n• Draw a card.\n• Destroy target artifact.');
 assert.equal(r.autoAccepted,true); assert.equal(r.compiledCard.modes.length,2);
});

test('Phase87 Aura reminder text and arbitrary entry life payment compile',()=>{
 const aura=compile('Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)','Enchantment — Aura');
 assert.equal(aura.autoAccepted,true); assert.equal(aura.compiledCard.enchantFilter.type,'Creature');
 const land=compile("As this land enters, you may pay 3 life. If you don't, it enters tapped.",'Land');
 assert.equal(land.autoAccepted,true); assert.equal(land.compiledCard.entryChoice.payLife,3);
});

test('Phase88 phasing compiles to an explicit runtime-backed keyword flag',()=>{
 const r=compile("Phasing (This phases in or out before you untap during each of your untap steps. While it's phased out, it's treated as though it doesn't exist.)",'Creature',['Phasing']);
 assert.equal(r.autoAccepted,true); assert.equal(r.compiledCard.phasing,true);
});

test('Phase89 Living metal is a creature only during its controller turn',()=>{
 const e=game(); e.db.lm={id:'lm',name:'LM',typeLine:'Artifact — Vehicle',manaCost:'{2}',manaValue:2,power:3,toughness:3,keywords:['living metal'],livingMetal:true,abilities:[],spellEffects:[],supported:true};
 const p=putBattlefield(e,'player','lm'); e.state.activePlayer='player'; e.performance?.markMutation('test-turn'); assert.equal(e.static.isType(p,'Creature'),true);
 e.state.activePlayer='opponent'; e.performance?.markMutation('test-turn'); assert.equal(e.static.isType(p,'Creature'),false);
});

test('Phase90 during-your-turn first strike is derived in the ability layer',()=>{
 const e=game(); e.db.fs={id:'fs',name:'FS',typeLine:'Creature',manaCost:'{2}',manaValue:2,power:2,toughness:2,keywords:[],ownTurnKeywords:['first strike'],abilities:[],spellEffects:[],supported:true};
 const p=putBattlefield(e,'player','fs'); e.state.activePlayer='player'; e.performance?.markMutation('test-turn'); assert.ok(e.continuous.characteristics(p).keywords.includes('first strike'));
 e.state.activePlayer='opponent'; e.performance?.markMutation('test-turn'); assert.ok(!e.continuous.characteristics(p).keywords.includes('first strike'));
});
