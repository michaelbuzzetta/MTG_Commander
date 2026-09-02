import test from'node:test';import assert from'node:assert/strict';import fs from 'node:fs';import{engine,putBattlefield,setPhase,db,decks}from'./helpers.js';import{AIController}from'../src/ai/AIController.js';import { GameEngine } from '../src/engine/GameEngine.js';
test('AI only chooses legal actions',()=>{const e=engine();e.state.priorityPlayer='ai';const ai=new AIController(e);const a=ai.choose();assert.ok(e.getLegalActions('ai').some(x=>x.type===a.type))});
test('AI declares legal attackers',()=>{const e=engine();e.state.activePlayer='ai';e.state.priorityPlayer='ai';e.state.phase='DECLARE_ATTACKERS';e.state.phaseIndex=5;e.state.turnActionPending='DECLARE_ATTACKERS';putBattlefield(e,'ai','grizzly-bears');const ai=new AIController(e);const a=ai.choose();assert.equal(a.type,'DECLARE_ATTACKERS');assert.equal(a.attackers.length,1)});


test('AI mulligans a clearly unplayable one-land Commander hand',()=>{
  const e=engine();
  e.state.pregame.active=true;
  e.state.pregame.currentPlayer='ai';
  e.state.priorityPlayer='ai';
  e.state.players.ai.mulligans=0;
  e.state.players.ai.hand=[
    {instanceId:'m-land',cardId:'island',owner:'ai',controller:'ai',zone:'hand'},
    {instanceId:'m-1',cardId:'giant-spider',owner:'ai',controller:'ai',zone:'hand'},
    {instanceId:'m-2',cardId:'trampling-rhino',owner:'ai',controller:'ai',zone:'hand'},
    {instanceId:'m-3',cardId:'doubling-season',owner:'ai',controller:'ai',zone:'hand'},
    {instanceId:'m-4',cardId:'smaug',owner:'ai',controller:'ai',zone:'hand'},
    {instanceId:'m-5',cardId:'menace-ogre',owner:'ai',controller:'ai',zone:'hand'},
    {instanceId:'m-6',cardId:'doubleblade',owner:'ai',controller:'ai',zone:'hand'}
  ];
  const action=new AIController(e,'ai').choose();
  assert.equal(action.type,'MULLIGAN');
});

test('AI does not let a heavily taxed commander crowd an ordinary playable spell out of its hand',()=>{
  const e=engine('explorers','blech');
  setPhase(e,'PRECOMBAT_MAIN',{activePlayer:'ai',priorityPlayer:'ai'});
  const p=e.state.players.ai;
  p.commanderTax=6;
  p.landPlaysRemaining=0;
  p.hand=[{instanceId:'normal-spell',cardId:'grizzly-bears',owner:'ai',controller:'ai',zone:'hand'}];
  for(let i=0;i<7;i++) putBattlefield(e,'ai',i%2===0?'forest':'swamp');
  const action=new AIController(e,'ai').choose();
  assert.equal(action.type,'CAST_SPELL');
  assert.equal(action.cardInstanceId,'normal-spell');
});

test('playing a land costs zero mana and does not tap existing mana sources',()=>{
  const e=engine();
  setPhase(e,'PRECOMBAT_MAIN',{activePlayer:'ai',priorityPlayer:'ai'});
  const p=e.state.players.ai;
  p.landPlaysRemaining=1;
  const source=putBattlefield(e,'ai','island');
  p.manaPool.U=1;
  const before={...p.manaPool};
  p.hand.push({instanceId:'free-land',cardId:'forest',owner:'ai',controller:'ai',zone:'hand'});
  e.perform('ai',{type:'PLAY_LAND',cardInstanceId:'free-land'});
  assert.deepEqual(p.manaPool,before);
  assert.equal(source.tapped,false);
  assert.equal(p.battlefield.some(card=>card.instanceId==='free-land'),true);
  const landEvent=[...e.state.history].reverse().find(entry=>entry.type==='LAND_PLAYED'&&entry.controller==='ai');
  assert.equal(landEvent?.manaSpent,0);
});

test('deterministic duel AI casts a real mix of noncommander spells',()=>{
  const playable=decks.filter(deck=>deck.playable!==false);
  const e=new GameEngine(playable[0],playable[1],db,{rng:()=>0.42});
  e.start();
  const casts={player:{ordinary:0,commander:0},ai:{ordinary:0,commander:0}};
  let actions=0;
  while(!e.state.winner&&actions<700){
    const id=e.state.pendingChoice?.playerId||(e.state.pregame.active?e.state.pregame.currentPlayer:e.state.priorityPlayer);
    assert.ok(id);
    const action=new AIController(e,id).choose();
    assert.ok(action,`${id} stalled on turn ${e.state.turn} ${e.state.phase}`);
    if(action.type==='CAST_COMMANDER') casts[id].commander++;
    if(action.type==='CAST_SPELL') casts[id].ordinary++;
    e.perform(id,action);
    actions++;
  }
  assert.ok(casts.ai.ordinary>=4,`expected AI to cast ordinary spells, got ${JSON.stringify(casts.ai)}`);
  assert.ok(casts.player.ordinary>=4,`expected opponent AI to cast ordinary spells, got ${JSON.stringify(casts.player)}`);
  assert.ok(casts.ai.ordinary>casts.ai.commander,`AI still over-prioritized its commander: ${JSON.stringify(casts.ai)}`);
});

test('opponent UI explicitly identifies land plays as zero-mana actions',()=>{
  const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.match(app,/land play costs 0 mana/);
  assert.match(app,/latestActionFor/);
});

test('advanced AI keeps a useful nonland on top with scry instead of automatically bottoming it',()=>{
  const e=engine();
  setPhase(e,'PRECOMBAT_MAIN',{activePlayer:'ai',priorityPlayer:'ai'});
  const p=e.state.players.ai;
  p.hand=[
    {instanceId:'land-a',cardId:'forest',owner:'ai',controller:'ai',zone:'hand'},
    {instanceId:'land-b',cardId:'island',owner:'ai',controller:'ai',zone:'hand'}
  ];
  const top={instanceId:'scry-good',cardId:'grizzly-bears',owner:'ai',controller:'ai',zone:'library'};
  p.library.unshift(top);
  e.state.pendingChoice={type:'SCRY',playerId:'ai',cardInstanceId:top.instanceId};
  const action=new AIController(e,'ai').choose();
  assert.equal(action.type,'CHOOSE_SCRY');
  assert.equal(action.putOnBottom,false);
});

test('advanced AI bottoms an excess land with scry when already flooded',()=>{
  const e=engine();
  setPhase(e,'PRECOMBAT_MAIN',{activePlayer:'ai',priorityPlayer:'ai'});
  const p=e.state.players.ai;
  p.hand=[0,1,2].map(i=>({instanceId:`hand-land-${i}`,cardId:'forest',owner:'ai',controller:'ai',zone:'hand'}));
  for(let i=0;i<7;i++) putBattlefield(e,'ai',i%2?'island':'forest');
  const top={instanceId:'scry-land',cardId:'forest',owner:'ai',controller:'ai',zone:'library'};
  p.library.unshift(top);
  e.state.pendingChoice={type:'SCRY',playerId:'ai',cardInstanceId:top.instanceId};
  const action=new AIController(e,'ai').choose();
  assert.equal(action.putOnBottom,true);
});

test('advanced AI removal targets the highest-value opposing creature',()=>{
  const e=engine();
  setPhase(e,'PRECOMBAT_MAIN',{activePlayer:'ai',priorityPlayer:'ai'});
  const p=e.state.players.ai;
  p.landPlaysRemaining=0;
  p.hand=[{instanceId:'kill-spell',cardId:'murder',owner:'ai',controller:'ai',zone:'hand'}];
  for(let i=0;i<3;i++) putBattlefield(e,'ai','swamp');
  const small=putBattlefield(e,'player','grizzly-bears');
  const large=putBattlefield(e,'player','smaug');
  const action=new AIController(e,'ai').choose();
  assert.equal(action.type,'CAST_SPELL');
  assert.equal(action.cardInstanceId,'kill-spell');
  assert.deepEqual(action.targets,[large.instanceId]);
  assert.notDeepEqual(action.targets,[small.instanceId]);
});

test('advanced multiplayer AI avoids wasting a second unblocked attacker on an already lethal opponent',()=>{
  const playable=decks.filter(deck=>deck.playable!==false).slice(0,3);
  const e=new GameEngine(playable[0],playable.slice(1),db,{rng:()=>0.42});
  e.start();
  for(const id of e.state.playerOrder) e.perform(id,{type:'KEEP_HAND'});
  e.state.players.player.life=2;
  e.state.players.ai2.life=40;
  const a1=putBattlefield(e,'ai','grizzly-bears');
  const a2=putBattlefield(e,'ai','grizzly-bears');
  setPhase(e,'DECLARE_ATTACKERS',{activePlayer:'ai',priorityPlayer:'ai',turnActionPending:'DECLARE_ATTACKERS'});
  const action=new AIController(e,'ai').choose();
  assert.equal(action.type,'DECLARE_ATTACKERS');
  assert.equal(action.attackers.length,2);
  const defenders=Object.values(action.attackTargets);
  assert.ok(defenders.includes('player'));
  assert.ok(defenders.includes('ai2'));
  assert.equal(e.isActionLegal('ai',action),true);
});

test('advanced AI uses Quandrix Command to counter a high-value opposing enchantment on the stack',()=>{
  const e=engine('explorers','explorers');
  setPhase(e,'PRECOMBAT_MAIN',{activePlayer:'player',priorityPlayer:'player'});
  const human=e.state.players.player, ai=e.state.players.ai;
  human.landPlaysRemaining=0;
  ai.landPlaysRemaining=0;
  human.hand=[{instanceId:'danger-enchantment',cardId:'doubling-season',owner:'player',controller:'player',zone:'hand'}];
  ai.hand=[{instanceId:'answer-command',cardId:'lcc-quandrix-command',owner:'ai',controller:'ai',zone:'hand'}];
  for(let i=0;i<5;i++) putBattlefield(e,'player','forest');
  putBattlefield(e,'player','grizzly-bears');
  putBattlefield(e,'ai','forest');
  putBattlefield(e,'ai','island');
  putBattlefield(e,'ai','forest');
  const ownCreature=putBattlefield(e,'ai','grizzly-bears');
  e.perform('player',{type:'CAST_SPELL',cardInstanceId:'danger-enchantment'});
  e.perform('player',{type:'PASS_PRIORITY'});
  assert.equal(e.state.priorityPlayer,'ai');
  const action=new AIController(e,'ai').choose();
  assert.equal(action.type,'CAST_SPELL');
  assert.equal(action.cardInstanceId,'answer-command');
  assert.ok(action.targets.includes('danger-enchantment'));
  assert.ok(action.targets.includes(ownCreature.instanceId) || action.mode==='pair-1' || action.mode==='pair-5');
});
