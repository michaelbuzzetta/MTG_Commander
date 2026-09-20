import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
const c=new OracleTemplateCompiler();
const card=(oracleText,typeLine='Creature')=>({id:'x',name:'X',oracleText,typeLine,abilities:[],keywords:[]});
for (const [name,text,type] of [
 ['uncounterable',"This spell can't be countered.",'Instant'],
 ['affinity','Affinity for artifacts','Artifact Creature'],
 ['delve','Delve','Sorcery'],
 ['improvise','Improvise','Sorcery'],
 ['protection','Protection from black','Creature'],
 ['loot','{T}: Draw a card, then discard a card.','Creature'],
 ['pregame','If this card is in your opening hand, you may begin the game with it on the battlefield.','Artifact']
]) test(`Phase68 compiles ${name}`,()=>assert.equal(c.compileCard(card(text,type)).autoAccepted,true));
