import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateLibrary } from '../src/cards/compiler/OracleTemplateLibrary.js';
const lib=new OracleTemplateLibrary();
const cases=[
["When this creature leaves the battlefield, return the exiled card to the battlefield under its owner's control.",'phase261.'],
['{4}{W}: Creatures you control get +1/+1 until end of turn.','phase262.'],["You have hexproof. (You can't be the target of spells or abilities your opponents control.)",'phase263.'],
['Protection from artifacts','phase264.'],['Provoke (Whenever this creature attacks, you may have target creature defending player controls untap and block it if able.)','phase265.'],
['This land enters tapped. As it enters, choose a color.','phase266.'],['Whenever you cast a noncreature spell, put an oil counter on this creature.','phase267.'],
['Ready to run (You can have two commanders if both have ready to run.)','phase268.'],['This spell costs {1} less to cast for each instant and sorcery card in your graveyard.','phase269.'],
['{1}, {T}: Put a storage counter on this land.','phase270.'],['As an additional cost to cast this spell, pay X life.','phase271.'],
['{1}: This creature becomes the creature type of your choice until end of turn.','phase272.'],['Whenever a creature dealt damage by this creature this turn dies, put a +1/+1 counter on this creature.','phase273.'],
['Madness {2}{B} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)','phase274.'],
['(You may cast a legendary sorcery only if you control a legendary creature or planeswalker.)','phase275.'],['Each creature you control with a +1/+1 counter on it has trample.','phase276.'],
['Specialize {2}','phase277.'],['If a creature an opponent controls would die, exile it instead.','phase278.'],
['{1}{G}: This creature gets +2/+2 until end of turn. Activate only once each turn.','phase279.'],['Partner—Friends forever (You can have two commanders if both have this ability.)','phase280.']];
for(const [oracle,prefix] of cases)test(prefix+oracle.slice(0,30),()=>{const m=lib.match({oracleText:oracle});assert.ok(m.some(x=>x.templateId.startsWith(prefix)),JSON.stringify(m));});
