// Only known public list routes and their existing filters may be used as return targets.
function canonicalList(value: unknown, profiles: boolean): string | null {
 if(typeof value!=='string'||value.length>4096||!value.startsWith('/')||value.startsWith('//')||value.includes('\\'))return null;
 try {
  const url=new URL(value,'https://navigation.invalid');
  if(url.origin!=='https://navigation.invalid'||url.hash)return null;
  const allowed=url.pathname==='/'||url.pathname==='/search'?['q','tag','kind']:url.pathname==='/study/cards'?['variant']:profiles&&/^\/students\/[a-zA-Z0-9_-]+$/.test(url.pathname)?['from']:null;
  if(!allowed)return null;
  const params=new URLSearchParams();
  for(const key of allowed){const v=key==='from'?(url.searchParams.getAll(key).length===1?canonicalList(url.searchParams.get(key),false):null):url.searchParams.get(key);if(v)params.set(key,v)}
  const target=url.pathname+(params.size?'?'+params.toString():'');
  return target.length<=4096?target:null;
 } catch {return null}
}
export function safeListPath(value:unknown):string|null{return canonicalList(value,true)}
// Unwrap only the one permitted profile layer; never recurse through profile routes.
export function listContextPath(value:unknown):string|null{const path=safeListPath(value);if(!path)return null;const url=new URL(path,'https://navigation.invalid');return url.pathname.startsWith('/students/')?canonicalList(url.searchParams.get('from'),false):path}
export interface ListOrigin {to:string;y:number;entryId:string}
export function readListOrigin(value: unknown, to: string | null): ListOrigin | null {
 if(!value||typeof value!=='object'||!to)return null;
 const v=value as Record<string,unknown>;
 return v.to===to&&typeof v.y==='number'&&Number.isFinite(v.y)&&v.y>=0&&v.y<=1000000&&typeof v.entryId==='string'&&v.entryId.length<=200?{to,y:v.y,entryId:v.entryId}:null;
}
