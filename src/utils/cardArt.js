const cache=new Map();
export async function resolveCardArt(name){if(cache.has(name))return cache.get(name);try{const r=await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);if(!r.ok)throw new Error();const j=await r.json();const u=j.image_uris?.normal||j.card_faces?.[0]?.image_uris?.normal||null;cache.set(name,u);return u;}catch{cache.set(name,null);return null;}}
