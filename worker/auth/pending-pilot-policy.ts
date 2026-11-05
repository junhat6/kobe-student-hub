/** Private one-identity, time-limited pending receipt policy. Never render or log it. */
export interface PendingPilotPolicy {allowedEmail:string;expiresAtMs:number}
export function parsePendingPilot(raw:unknown,now:number):PendingPilotPolicy|null{
 try{
  if(typeof raw!=='string'||raw.length>1024||!Number.isSafeInteger(now)||now<0)return null;
  const p:unknown=JSON.parse(raw);
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='allowedEmail,expiresAtMs')return null;
  const {allowedEmail,expiresAtMs}=p as PendingPilotPolicy;
  if(typeof allowedEmail!=='string'||allowedEmail.length>320||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@st\.kobedenshi\.ac\.jp$/.test(allowedEmail)||!Number.isSafeInteger(expiresAtMs)||expiresAtMs<=now||expiresAtMs>now+24*60*60*1000)return null;
  return {allowedEmail,expiresAtMs};
 }catch{return null}
}
