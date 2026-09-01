
export function isCreature(c){return c.cardType==="Creature"}
export function isLand(c){return c.cardType==="Land"}
export function isInstant(c){return c.cardType==="Instant"}
export function isSorcery(c){return c.cardType==="Sorcery"}

export function isMerfolk(c){return (c.typeLine||"").includes("Merfolk")}

export function computedPT(card,battlefield=[]){
  let p=(card.power||0)+(card.counters?.["+1/+1"]||0)-(card.counters?.["-1/-1"]||0);
  let t=(card.toughness||0)+(card.counters?.["+1/+1"]||0)-(card.counters?.["-1/-1"]||0);

  if(isMerfolk(card)){
    for(const src of battlefield){
      if(src.id===card.id) continue;
      const txt=(src.oracleText||"").toLowerCase();
      if(txt.includes("other merfolk") && txt.includes("get +1/+1")){p++;t++}
      if(["Master of the Pearl Trident","Merfolk Sovereign","Merfolk Mistbinder"].includes(src.name)){p++;t++}
    }
  }
  return {power:p,toughness:t};
}

export function canAttack(card){
  return isCreature(card) && !card.tapped && !card.summoningSick;
}

export function canBlock(card){
  return isCreature(card) && !card.tapped;
}

export function hasKeyword(card,k){
  return (card.keywords||[]).some(x=>x.toLowerCase()===k.toLowerCase()) ||
    (card.oracleText||"").toLowerCase().includes(k.toLowerCase());
}

export function legalBlock(attacker,blocker){
  if(!canBlock(blocker)) return false;
  if(hasKeyword(attacker,"flying") && !(hasKeyword(blocker,"flying")||hasKeyword(blocker,"reach"))) return false;
  return true;
}

export function cardSpeedAllowed(card,state,side){
  if(card.cardType==="Land") return state.activePlayer===side && state.step.includes("MAIN") && state.stack.length===0;
  if(isInstant(card)) return true;
  if(card.oracleText?.toLowerCase().includes("flash")) return true;
  return state.activePlayer===side && state.step.includes("MAIN") && state.stack.length===0;
}
