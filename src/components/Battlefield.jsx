import React from 'react';
import {Card} from './Card.jsx';

function kind(def={}){
 const t=(def.typeLine||'').toLowerCase();
 if(t.includes('land'))return'land';
 if(t.includes('creature'))return'creature';
 return'other';
}

export function Battlefield({player,db,onCard,selected=()=>false,side='player'}){
 const groups={creature:[],other:[],land:[]};
 player.battlefield.forEach(p=>groups[kind(db[p.cardId])].push(p));
 const row=(name,items,cls)=><div key={cls} className={`permanent-row ${cls}`}>
   <span className="row-label">{name}</span>
   <div className="permanent-cards">{items.map(p=><Card key={p.instanceId} perm={p} def={db[p.cardId]} selected={selected(p.instanceId)} onClick={()=>onCard?.(p)}/>)}</div>
 </div>;

 // Mirror the battlefield like a tabletop: each player's creatures sit nearest
 // the center combat line while lands remain behind them. This is presentation
 // only; battlefield state and interaction behavior are unchanged.
 const creatureRow=row('CREATURES',groups.creature,'creature-row');
 const otherRow=groups.other.length>0?row('PERMANENTS',groups.other,'other-row'):null;
 const landRow=row('LANDS',groups.land,'land-row');
 const rows=side==='opponent'?[landRow,otherRow,creatureRow]:[creatureRow,otherRow,landRow];

 return <div className={`battlefield ${side}-battlefield`}>{rows}</div>;
}
