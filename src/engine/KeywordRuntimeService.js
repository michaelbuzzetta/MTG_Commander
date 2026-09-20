// Runtime semantics for long-tail keyword families introduced in phases 91-100.
// This service mutates only authoritative GameEngine state/services.
export class KeywordRuntimeService {
  constructor(engine){ this.engine=engine; }
  definition(permanent){ return this.engine.db[permanent?.cardId] || {}; }
  addCounter(permanent,n=1){ if(n>0) this.engine.counters.add(permanent,'+1/+1',n,{cause:'keyword-runtime'}); }
  exploit(source, sacrificeId=null){
    const e=this.engine, p=e.state.players[source.controller];
    const legal=(p?.battlefield||[]).filter(x=>e.static.isType(x,'Creature')&&!x.phasedOut);
    if(!sacrificeId) return {legal:legal.map(x=>x.instanceId), exploited:false};
    const target=legal.find(x=>x.instanceId===sacrificeId); if(!target) throw new Error('Illegal exploit sacrifice');
    e.sacrificePermanent(target); source.exploited=true; return {exploited:true,sacrificed:sacrificeId};
  }
  cumulativeUpkeep(source,{pay=false}={}){
    const d=this.definition(source), spec=d.cumulativeUpkeep; if(!spec) return false;
    source.counters ||= {}; source.counters.age=Number(source.counters.age||0)+1;
    const count=source.counters.age;
    if(pay){ for(let i=0;i<count;i++){ if(!eCanPay(this.engine,source.controller,spec.mana)) { pay=false; break; } ePay(this.engine,source.controller,spec.mana); } }
    if(!pay) this.engine.sacrificePermanent(source);
    return pay;
  }
  extort(source,{pay=false}={}){
    if(!pay) return false; const e=this.engine,pid=source.controller;
    if(!eCanPay(e,pid,'{W/B}')) return false; ePay(e,pid,'{W/B}');
    let gained=0; for(const opp of e.opponents(pid)){ if(e.state.players[opp]?.lost) continue; e.changeLife(opp,-1); gained++; }
    if(gained) e.changeLife(pid,gained); return true;
  }
  unleash(source,chooseCounter=false){ if(chooseCounter) this.addCounter(source,1); source.unleashed=!!chooseCounter; return source.unleashed; }
  riot(source,choice='counter'){
    if(choice==='counter') this.addCounter(source,1); else if(choice==='haste'){ source.modifiers ||= {power:0,toughness:0,keywords:[]}; source.modifiers.keywords ||= []; if(!source.modifiers.keywords.includes('haste')) source.modifiers.keywords.push('haste'); }
    else throw new Error('Riot choice must be counter or haste'); return choice;
  }
  melee(source){
    const e=this.engine; const n=new Set(Object.values(e.state.combat.attackDefendingPlayers||{}).filter(pid=>e.state.players[pid]&&pid!==source.controller)).size;
    source.modifiers.power=Number(source.modifiers.power||0)+n; source.modifiers.toughness=Number(source.modifiers.toughness||0)+n;
    source.meleeUntilCleanup=(source.meleeUntilCleanup||0)+n; return n;
  }
  bloodthirst(source){ const n=Number(this.definition(source).bloodthirst||0); const mem=this.engine.state.turnMemory?.[source.controller]||{}; if(mem.opponentDamagedThisTurn) this.addCounter(source,n); return mem.opponentDamagedThisTurn?n:0; }
  ravenous(source,x=0){ x=Math.max(0,Number(x||0)); this.addCounter(source,x); if(x>=5) this.engine.drawCard(source.controller,1); return x; }
  bargain(source, sacrificeId=null){
    const e=this.engine,p=e.state.players[source.controller];
    if(!sacrificeId) return {paid:false,legal:(p?.battlefield||[]).filter(x=>!x.phasedOut&&(x.token||e.static.isType(x,'Artifact')||e.static.isType(x,'Enchantment'))).map(x=>x.instanceId)};
    const target=(p?.battlefield||[]).find(x=>x.instanceId===sacrificeId&&!x.phasedOut&&(x.token||e.static.isType(x,'Artifact')||e.static.isType(x,'Enchantment')));
    if(!target) throw new Error('Illegal bargain sacrifice'); e.sacrificePermanent(target); source.bargained=true; return {paid:true,sacrificed:sacrificeId};
  }
  backup(source,targetId=null,amount=null){
    const e=this.engine,p=e.state.players[source.controller],n=Number(amount??this.definition(source).backup??1);
    const legal=(p?.battlefield||[]).filter(x=>e.static.isType(x,'Creature')&&!x.phasedOut);
    if(!targetId) return {legal:legal.map(x=>x.instanceId),resolved:false}; const target=legal.find(x=>x.instanceId===targetId);
    if(!target) throw new Error('Illegal backup target'); this.addCounter(target,n);
    if(target.instanceId!==source.instanceId){ target.backupGranted ||= []; target.backupGranted.push({sourceId:source.instanceId,expiresTurn:e.state.turn}); }
    return {resolved:true,targetId,amount:n};
  }
  soulbond(source,partnerId=null){
    const e=this.engine,p=e.state.players[source.controller];
    const candidates=(p?.battlefield||[]).filter(x=>x.instanceId!==source.instanceId&&e.static.isType(x,'Creature')&&!x.soulbondPartnerId&&!x.phasedOut);
    if(!partnerId) return {candidates:candidates.map(x=>x.instanceId),paired:false};
    const partner=candidates.find(x=>x.instanceId===partnerId); if(!partner) throw new Error('Illegal soulbond partner');
    source.soulbondPartnerId=partner.instanceId; partner.soulbondPartnerId=source.instanceId; return {paired:true,partnerId};
  }
  chooseColor(source,color){ if(!['W','U','B','R','G'].includes(color)) throw new Error('Illegal color choice'); source.chosenColor=color; return color; }
  freeze(target){ if(!target) throw new Error('Freeze requires a target'); target.tapped=true; target.skipNextUntap=true; return true; }
  kickedEntry(source,wasKicked=true){ const spec=this.definition(source).entersIfKickedCounters; if(wasKicked&&spec) this.engine.counters.add(source,spec.type||'+1/+1',Number(spec.amount||1),{cause:'kicked-entry'}); return !!(wasKicked&&spec); }
  startEngines(pid){ const p=this.engine.state.players[pid]; if(!p) throw new Error('Unknown player'); if(!Number(p.speed||0)) p.speed=1; return p.speed; }
  increaseSpeed(pid){ const p=this.engine.state.players[pid]; if(!p||!Number(p.speed||0)) return 0; if(p.speedIncreasedTurn===this.engine.state.turn) return p.speed; p.speed=Math.min(4,Number(p.speed)+1);p.speedIncreasedTurn=this.engine.state.turn;return p.speed; }
  noIslands(source){ const p=this.engine.state.players[source.controller]; const has=(p.battlefield||[]).some(x=>this.engine.static.isType(x,'Land')&&((this.definition(x).subtypes||[]).includes('Island')||/Island/i.test(this.definition(x).typeLine||''))); if(!has)this.engine.sacrificePermanent(source);return has; }
  movePlusOneCounter(source,target){ if(Number(source.counters?.['+1/+1']||0)<1) throw new Error('No +1/+1 counter to move'); source.counters['+1/+1']--;this.addCounter(target,1);return true; }
  fabricate(source,n=1,choice='counter'){ n=Math.max(0,Number(n)); if(choice==='counter')this.addCounter(source,n); else if(choice==='servo')this.engine.effects?.createToken?.(source.controller,{name:'Servo',typeLine:'Token Artifact Creature — Servo',power:1,toughness:1},n); else throw new Error('Illegal fabricate choice'); return choice; }
  offspring(source,paid=false){ if(!paid)return null; const e=this.engine; const copy=structuredClone(source); copy.instanceId=`offspring-${source.instanceId}-${e.state.turn}`;copy.token=true;copy.power=1;copy.toughness=1;copy.counters={};copy.zone='battlefield';e.zones.place(copy,'battlefield',source.controller);return copy; }
  conspire(source,creatureIds=[]){ if(creatureIds.length!==2) throw new Error('Conspire requires two creatures'); const p=this.engine.state.players[source.controller]; const cs=creatureIds.map(id=>(p.battlefield||[]).find(x=>x.instanceId===id&&!x.tapped)); if(cs.some(x=>!x))throw new Error('Illegal conspire creatures');cs.forEach(x=>x.tapped=true);source.conspired=true;return true; }
  firebending(source,n=1){ const p=this.engine.state.players[source.controller];p.manaPool ||= {};p.manaPool.R=Number(p.manaPool.R||0)+Number(n);p.firebendingMana=Number(p.firebendingMana||0)+Number(n);return Number(n); }
  squad(source,times=0){ const e=this.engine,n=Math.max(0,Number(times)); const made=[];for(let i=0;i<n;i++){const c=structuredClone(source);c.instanceId=`squad-${source.instanceId}-${e.state.turn}-${i}`;c.token=true;c.zone='battlefield';e.zones.place(c,'battlefield',source.controller);made.push(c);}return made; }
  sunburst(source,colorsSpent=[]){ const n=new Set(colorsSpent.filter(x=>['W','U','B','R','G'].includes(x))).size; const d=this.definition(source); const counter=/Creature/i.test(d.typeLine||'')?'+1/+1':'charge';this.engine.counters.add(source,counter,n,{cause:'sunburst'});return n; }
  devour(source,sacrificeIds=[],n=1){ const e=this.engine,p=e.state.players[source.controller];let count=0;for(const id of sacrificeIds){const c=(p.battlefield||[]).find(x=>x.instanceId===id&&x!==source&&e.static.isType(x,'Creature'));if(!c)throw new Error('Illegal devour sacrifice');e.sacrificePermanent(c);count++;}this.addCounter(source,count*Number(n));return count; }
  mobilize(source,n=1){ const e=this.engine,made=[];for(let i=0;i<Number(n);i++){const c={instanceId:`warrior-${source.instanceId}-${e.state.turn}-${i}`,cardId:'Warrior Token',controller:source.controller,owner:source.controller,zone:'battlefield',token:true,tapped:true,power:1,toughness:1,counters:{},modifiers:{power:0,toughness:0,keywords:[]}};e.zones.place(c,'battlefield',source.controller);made.push(c);}return made; }
  verse(source){ source.counters ||= {};source.counters.verse=Number(source.counters.verse||0)+1;return source.counters.verse; }
  giftCard(source,opponentId,promised=false){ if(!promised)return false; if(!this.engine.opponents(source.controller).includes(opponentId))throw new Error('Gift requires opponent');this.engine.drawCard(opponentId,1);source.giftPromisedTo=opponentId;return true; }
  enlist(source,helperId){ const e=this.engine,p=e.state.players[source.controller],h=(p.battlefield||[]).find(x=>x.instanceId===helperId&&x!==source&&!x.tapped&&e.static.isType(x,'Creature'));if(!h)throw new Error('Illegal enlist helper');h.tapped=true;const power=Number(e.static.derivedStats?.(h)?.power??h.power??0);source.modifiers.power=Number(source.modifiers.power||0)+power;source.enlistUntilCleanup=Number(source.enlistUntilCleanup||0)+power;return power; }
  storied(pid){ const p=this.engine.state.players[pid];if(p.storied)return true;const n=(p.battlefield||[]).filter(x=>{const d=this.definition(x);return this.engine.static.isType(x,'Artifact')||/Legendary/i.test(d.supertypes?.join(' ')||d.typeLine||'')||/Saga/i.test(d.subtypes?.join(' ')||d.typeLine||'');}).length;if(n>=3)p.storied=true;return !!p.storied; }
  prepared(source,value=true){ source.prepared=!!value;return source.prepared; }
  gainLevel(source,max=Infinity){ source.level=Number(source.level||1);if(source.level>=max)return source.level;source.level++;return source.level; }
  validatePairs(){
    for(const pid of this.engine.playerIds()) for(const c of this.engine.state.players[pid].battlefield||[]) if(c.soulbondPartnerId){
      const other=this.engine.findPermanent(c.soulbondPartnerId); if(!other||other.controller!==c.controller){ c.soulbondPartnerId=null; if(other?.soulbondPartnerId===c.instanceId) other.soulbondPartnerId=null; }
    }
  }
  saddle(source,helperIds=[],required=null){ const e=this.engine,p=e.state.players[source.controller],need=Number(required??this.definition(source).saddle??1);let total=0;const seen=new Set();for(const id of helperIds){if(seen.has(id))throw new Error('Duplicate saddle helper');seen.add(id);const c=(p.battlefield||[]).find(x=>x.instanceId===id&&x!==source&&!x.tapped&&e.static.isType(x,'Creature'));if(!c)throw new Error('Illegal saddle helper');total+=Number(e.static.derivedStats?.(c)?.power??c.power??0);}if(total<need)throw new Error('Insufficient saddle power');for(const id of helperIds)(p.battlefield||[]).find(x=>x.instanceId===id).tapped=true;source.saddled=true;source.saddledUntilCleanup=true;return total; }
  wardLife(source,pid,amount=null){ const n=Number(amount??this.definition(source).wardCost?.amount??0),p=this.engine.state.players[pid];if(!p||p.life<=n) return false;this.engine.changeLife(pid,-n);return true; }
  fading(source,onEntry=false){ const n=Number(this.definition(source).fading??0);source.counters ||= {};if(onEntry){source.counters.fade=n;return n;}if(Number(source.counters.fade||0)>0){source.counters.fade--;return true;}this.engine.sacrificePermanent(source);return false; }
  rampage(source,blockerCount=1,n=null){ const k=Number(n??this.definition(source).rampage??0),extra=Math.max(0,Number(blockerCount)-1),v=k*extra;source.modifiers.power=Number(source.modifiers.power||0)+v;source.modifiers.toughness=Number(source.modifiers.toughness||0)+v;source.rampageUntilCleanup=Number(source.rampageUntilCleanup||0)+v;return v; }
  afterlife(source,n=null){ const k=Number(n??this.definition(source).afterlife??0);this.engine.effects?.createToken?.(source.controller,{name:'Spirit',typeLine:'Token Creature — Spirit',colors:['W','B'],power:1,toughness:1,keywords:['flying']},k);return k; }
  annihilator(source,defenderId,sacrificeIds=[]){ const need=Number(this.definition(source).annihilator??0),p=this.engine.state.players[defenderId];if(!p||sacrificeIds.length!==need)throw new Error('Invalid annihilator sacrifices');for(const id of sacrificeIds){const x=(p.battlefield||[]).find(c=>c.instanceId===id);if(!x)throw new Error('Illegal annihilator sacrifice');this.engine.sacrificePermanent(x);}return need; }
  reconfigure(source,targetId=null){ const p=this.engine.state.players[source.controller];if(targetId==null){delete source.attachedTo;source.reconfigured=false;return null;}const t=(p.battlefield||[]).find(x=>x.instanceId===targetId&&this.engine.static.isType(x,'Creature'));if(!t)throw new Error('Illegal reconfigure target');source.attachedTo=t.instanceId;source.reconfigured=true;return t.instanceId; }
  amass(source,subtype='Orc',amount=1){ const p=this.engine.state.players[source.controller];let army=(p.battlefield||[]).find(x=>/Army/i.test(this.definition(x).typeLine||x.typeLine||''));if(!army){army={instanceId:`army-${source.instanceId}-${this.engine.state.turn}`,cardId:'Army Token',controller:source.controller,owner:source.controller,zone:'battlefield',token:true,power:0,toughness:0,counters:{},modifiers:{power:0,toughness:0,keywords:[]},typeLine:`Token Creature — ${subtype} Army`};this.engine.zones.place(army,'battlefield',source.controller);}army.counters['+1/+1']=Number(army.counters['+1/+1']||0)+Number(amount);return army; }
  collectEvidence(source,cardIds=[],amount=null){ const need=Number(amount??this.definition(source).collectEvidence?.amount??0),p=this.engine.state.players[source.controller];let total=0;const cards=[];for(const id of cardIds){const c=(p.graveyard||[]).find(x=>x.instanceId===id);if(!c)throw new Error('Illegal evidence card');total+=Number(this.definition(c).manaValue??c.manaValue??0);cards.push(c);}if(total<need)throw new Error('Insufficient evidence');for(const c of cards){this.engine.zones.move(c.instanceId,'exile',source.controller);}return total; }
  tribute(source,opponentAdds=true,n=null){const k=Number(n??this.definition(source).tribute??0);if(opponentAdds)this.addCounter(source,k);source.tributePaid=!!opponentAdds;return source.tributePaid;}
  soulshift(source,targetId=null,n=null){const k=Number(n??this.definition(source).soulshift??0),p=this.engine.state.players[source.controller];const legal=(p.graveyard||[]).filter(c=>/Spirit/i.test(this.definition(c).typeLine||'')&&Number(this.definition(c).manaValue??0)<=k);if(!targetId)return legal.map(c=>c.instanceId);const c=legal.find(x=>x.instanceId===targetId);if(!c)throw new Error('Illegal soulshift target');this.engine.zones.move(c.instanceId,'hand',source.controller);return c;}
  venture(pid,room='entrance'){const p=this.engine.state.players[pid];p.dungeon ||= {room:null,completed:0};p.dungeon.room=room;return p.dungeon;}
  cleanup(){ for(const pid of this.engine.playerIds()) for(const c of this.engine.state.players[pid].battlefield||[]){ const n=Number(c.meleeUntilCleanup||0); if(n){ c.modifiers.power-=n;c.modifiers.toughness-=n;c.meleeUntilCleanup=0; } const en=Number(c.enlistUntilCleanup||0); if(en){ c.modifiers.power-=en;c.enlistUntilCleanup=0; } const r=Number(c.rampageUntilCleanup||0);if(r){c.modifiers.power-=r;c.modifiers.toughness-=r;c.rampageUntilCleanup=0;}if(c.saddledUntilCleanup){c.saddled=false;delete c.saddledUntilCleanup;} } this.validatePairs(); }

}
function eCanPay(e,pid,cost){ return e.mana.canAfford(e.state.players[pid],cost,0); }
function ePay(e,pid,cost){ return e.mana.pay(e.state.players[pid],cost,0); }
