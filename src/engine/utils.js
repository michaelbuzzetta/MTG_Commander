let seq=0;
export const uid=(prefix='id')=>`${prefix}-${++seq}`;
export function reserveUid(value){
  const match=String(value||'').match(/-(\d+)$/);
  if(match) seq=Math.max(seq, Number(match[1])||0);
}
export function currentUidSequence(){ return seq; }
export function setUidSequence(value=0){ seq=Math.max(0, Number(value)||0); return seq; }
export const clone=x=>structuredClone(x);
export function shuffle(a,rng){ if(typeof rng!=='function') throw new Error('shuffle requires the game RNG service'); const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; }
export function parseManaCost(cost=''){ const req={generic:0,W:0,U:0,B:0,R:0,G:0,C:0}; for(const m of cost.matchAll(/\{([^}]+)\}/g)){const x=String(m[1]).toUpperCase(); if(/^\d+$/.test(x))req.generic+=+x; else if(req[x]!=null)req[x]++; else if(x.includes('/') && x.split('/').every(part=>['W','U','B','R','G','C'].includes(part))) req.generic+=1;} return req; }
export function manaValue(cost=''){return [...cost.matchAll(/\{([^}]+)\}/g)].reduce((n,m)=>n+(/^\d+$/.test(m[1])?+m[1]:['X','Y','Z'].includes(m[1])?0:1),0)}
export const isType=(c,t)=>(c?.typeLine||'').toLowerCase().includes(t.toLowerCase());
const NON_CREATURE_SUBTYPES = new Set([
  'plains','island','swamp','mountain','forest',
  'aura','equipment','fortification','vehicle',
  'clue','food','treasure','map'
]);
export const hasSubtype=(c,t)=>{
  const wanted=String(t||'').toLowerCase();
  if((c?.subtypes||[]).some(x=>String(x).toLowerCase()===wanted)) return true;
  if((c?.typeLine||'').toLowerCase().split(/[^a-z]+/).includes(wanted)) return true;
  // Changeling is a characteristic-defining ability that functions in every
  // zone. Treat a Changeling creature as every creature type for tribal rules,
  // while keeping land/artifact/enchantment subtypes distinct.
  return isType(c,'Creature') && hasKeyword(c,'Changeling') && !NON_CREATURE_SUBTYPES.has(wanted);
};
export const hasKeyword=(c,k)=>(c?.keywords||[]).some(x=>x.toLowerCase()===k.toLowerCase());
export function powerOf(p,db){const c=db[p.cardId]; return Number(c?.power||0)+(p.counters?.['+1/+1']||0)-(p.counters?.['-1/-1']||0)+(p.modifiers?.power||0)}
export function toughnessOf(p,db){const c=db[p.cardId]; return Number(c?.toughness||0)+(p.counters?.['+1/+1']||0)-(p.counters?.['-1/-1']||0)+(p.modifiers?.toughness||0)}
