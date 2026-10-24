// Display-only values: never transform model data or verification status.
export const palette=Object.freeze({background:0xf2f6fa,slab:0xf8f5ed,outline:0xa6bbc8,grid:0xdbe4eb,selection:0x247dd5,exterior:0xc4d5de});
export function equipmentStyle(color,selected){return {color,ringColor:selected?palette.selection:null};}
export function routeStyle(sourceId,targetId,selectedId,verified){
 const direct=Boolean(selectedId)&&(sourceId===selectedId||targetId===selectedId);
 return {opacity:!selectedId ? .78 : direct ? 1 : .4,dashed:!verified};
}
