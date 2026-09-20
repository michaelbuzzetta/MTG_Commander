import test from 'node:test'; import assert from 'node:assert/strict'; import { OracleTemplateLibrary } from '../src/cards/compiler/OracleTemplateLibrary.js';
const lib=new OracleTemplateLibrary();
const cases=[
['phase161.room-reminder','(You may cast either half. That door unlocks on the battlefield. As a sorcery, you may pay the mana cost of a locked door to unlock it.)'],
['phase162.prepared',"This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)"],
['phase163.ongoing-scheme',"(An ongoing scheme remains face up until it's abandoned.)"],
['phase164.hidden-agenda','Hidden agenda (Start the game with this conspiracy face down in the command zone and secretly choose a card name. You may turn this conspiracy face up any time and reveal that name.)'],
['phase165.faceup-conspiracy','(Start the game with this conspiracy face up in the command zone.)'],
['phase166.draft-faceup','Draft this card face up.'],
['phase167.open-attraction','When this creature enters, open an Attraction. (Put the top card of your Attraction deck onto the battlefield.)'],
['phase168.double-team','Double team'],
['phase169.ki-counter','Whenever you cast a Spirit or Arcane spell, you may put a ki counter on this creature.'],
['phase170.flash-cleanup-sacrifice',"You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step."],
['phase171.storied','Storied (If you control three or more artifacts, legendaries, and/or Sagas, you have an enduring story for the rest of the game.)'],
['phase172.library-top-creature',"Put target creature on top of its owner's library."],
['phase173.phyrexian-reminder','({B/P} can be paid with either {B} or 2 life.)'],
['phase174.day-entry-init',"If it's neither day nor night, it becomes day as this creature enters."],
['phase175.station',"Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)"],
['phase176.banding',"Banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)"],
['phase177.ante-removal',"Remove this card from your deck before playing if you're not playing for ante."],
['phase178.bounty-setup','Before the game, shuffle at least 6 unique bounty cards into a face-down pile.'],
['phase179.bounty-reveal',"As the starting player's third turn begins, reveal the top bounty card."],
['phase180.bounty-advance','As each turn begins, if no bounty is being offered, reveal the next one. If the pile is empty, shuffle all claimed bounties and restock']];
for(const [id,oracleText] of cases)test(id,()=>{const m=lib.match({oracleText}); assert.ok(m.some(x=>x.templateId===id),JSON.stringify(m));});
