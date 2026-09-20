import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
const c=new OracleTemplateCompiler();
const compile=(oracleText,typeLine='Creature')=>c.compileCard({id:oracleText,name:'P111-120',typeLine,oracleText,manaCost:'{2}',keywords:[]});
const cases=[
 ['111','Fuse (You may cast one or both halves of this card from your hand.)','fuse'],
 ['112','Spree (Choose one or more additional costs.)','spree'],
 ['113','Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)','bargain'],
 ['114','Backup 1 (When this creature enters, put a +1/+1 counter on target creature. If that’s another creature, it gains the following ability until end of turn.)','backup'],
 ['115','Umbra armor (If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura.)','umbraArmor'],
 ['116','Cipher (Then you may exile this spell card encoded on a creature you control. Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost.)','cipher'],
 ['117','Choose three. You may choose the same mode more than once.','modalChoice'],
 ['118','Choose one. If you control a commander as you cast this spell, you may choose both instead.','modalChoice'],
 ['120','You may choose not to untap this artifact during your untap step.','optionalUntap']
];
for(const [phase,text,key] of cases)test(`Phase ${phase} compiles ${key}`,()=>{const r=compile(text);assert.equal(r.autoAccepted,true);assert.ok(r.compiledCard[key]||r.compiledCard.abilities?.length,JSON.stringify(r));});
