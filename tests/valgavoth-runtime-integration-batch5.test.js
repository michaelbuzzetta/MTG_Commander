import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameEngine } from '../src/engine/GameEngine.js';
const raw=JSON.parse(fs.readFileSync(new URL('../src/data/generated/cards.json',import.meta.url),'utf8'));
const names=['Nightshade Harvester','No Mercy','Persistent Constrictor','Play with Fire','Price of Progress','Rakdos Charm','Razorkin Needlehead','Redirect Lightning'];
test('Valgavoth integration batch 5 is reachable in the real runtime database',()=>{
 const deck={id:'d',name:'d',commander:'hakbal',cards:[{id:'hakbal',quantity:1}]};
 const e=new GameEngine(deck,[{...deck,id:'o',name:'o'}],raw,{validateDecks:false,rng:()=>0.5});
 for(const name of names){const c=Object.values(e.db).find(x=>x.name===name);assert.ok(c,`${name} missing`);assert.equal(c.certificationEligible,true,`${name} not targeted`);assert.match(c.targetedImplementation,/^rakdos-deck-/);}
});
