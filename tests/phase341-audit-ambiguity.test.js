import test from 'node:test'; import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
const compiler=new OracleTemplateCompiler();
for (const [name,typeLine,oracleText] of [
 ['Reach Through Mists','Instant — Arcane','Draw a card.'],
 ['Mana Rock','Artifact','{T}: Add {C}.'],
 ['Shatter','Instant','Destroy target artifact.'],
 ['Healer','Creature — Cleric','When this creature enters, you gain 3 life.']
]) test(`phase341 resolves rediscovered template ambiguity: ${oracleText}`,()=>{const r=compiler.compileCard({name,typeLine,oracleText}); assert.equal(r.autoAccepted,true,JSON.stringify(r.diagnostics));});
