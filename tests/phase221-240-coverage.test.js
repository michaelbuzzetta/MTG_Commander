import test from 'node:test'; import assert from 'node:assert/strict'; import { OracleTemplateLibrary } from '../src/cards/compiler/OracleTemplateLibrary.js';
const lib=new OracleTemplateLibrary();
const cases=[
['phase221.saddle','Saddle 1 (Tap any number of other creatures you control with total power 1 or more: This Mount becomes saddled until end of turn. Saddle only as a sorcery.)'],
['phase222.ward-life','Ward—Pay 2 life.'],
['phase223.fading',"Fading 3 (This creature enters with three fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)"],
['phase224.rampage','Rampage 2 (Whenever this creature becomes blocked, it gets +2/+2 until end of turn for each creature blocking it beyond the first.)'],
['phase225.afterlife','Afterlife 2 (When this creature dies, create two 1/1 white and black Spirit creature tokens with flying.)'],
['phase226.annihilator','Annihilator 1 (Whenever this creature attacks, defending player sacrifices a permanent of their choice.)'],
['phase227.reconfigure',"Reconfigure {4} ({4}: Attach to target creature you control; or unattach from a creature. Reconfigure only as a sorcery. While attached, this isn't a creature.)"],
['phase228.amass-orcs',"Amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)"],
['phase229.freerunning','Freerunning {1}{B} (You may cast this spell for its freerunning cost if you dealt combat damage to a player this turn with an Assassin or commander.)'],
['phase230.collect-evidence','As an additional cost to cast this spell, you may collect evidence 6. (Exile cards with total mana value 6 or greater from your graveyard.)'],
['phase231.tribute','Tribute 3 (As this creature enters, an opponent of your choice may put three +1/+1 counters on it.)'],
['phase232.assist',"Assist (Another player can pay up to {6} of this spell's cost.)"],
['phase233.plot','Plot {3}{U} (You may pay {3}{U} and exile this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost. Plot only as a sorcery.)'],
['phase234.demonstrate','Demonstrate (When you cast this spell, you may copy it. If you do, choose an opponent to also copy it. Players may choose new targets for their copies.)'],
['phase235.affinity-creatures','Affinity for creatures (This spell costs {1} less to cast for each creature you control.)'],
['phase236.soulshift','Soulshift 5 (When this creature dies, you may return target Spirit card with mana value 5 or less from your graveyard to your hand.)'],
['phase237.venture','When this creature enters, venture into the dungeon. (Enter the first room or advance to the next room.)'],
['phase238.proliferate-line','Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)'],
['phase239.rebel-search','{4}, {T}: Search your library for a Rebel permanent card with mana value 3 or less, put it onto the battlefield, then shuffle.'],
['phase240.commander-cast-copy',"When you cast this spell, copy it for each time you've cast your commander from the command zone this game."]];
for(const [id,oracleText] of cases)test(id,()=>{const m=lib.match({oracleText});assert.ok(m.some(x=>x.templateId===id),`${id}: ${JSON.stringify(m)}`)});
