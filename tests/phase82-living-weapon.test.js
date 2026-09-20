import test from 'node:test'; import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
test('Phase 82 living weapon compiles to executable ETB effect',()=>{const r=new OracleTemplateCompiler().compileCard({id:'lw',name:'LW',typeLine:'Artifact — Equipment',oracleText:'Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)'});assert.equal(r.status,'compiled');assert.equal(r.compiledCard.abilities[0].effect.type,'livingWeapon');});
