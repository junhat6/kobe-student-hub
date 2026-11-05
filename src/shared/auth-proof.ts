/** One standard sensitive header for browser proofs. This is not a session credential. */
export const AUTHORIZATION_HEADER='Authorization';
export type BrowserProofPurpose='command'|'csrf';
export interface BrowserProof {purpose:BrowserProofPurpose;token:string}
const raw=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
export function hasLegacyProofHeader(headers:Headers){return headers.has('X-Session-Command')||headers.has('X-CSRF-Token')}
export function proofAuthorization(purpose:BrowserProofPurpose,token:string):string{
 if(!['command','csrf'].includes(purpose)||!raw(token))throw new TypeError('Invalid browser proof');
 return 'Bearer '+purpose+'.'+token;
}
/** Fetch Headers joins duplicates with commas, which this exact grammar rejects.
 * HTTP-level OWS normalization happens before this API and cannot be reconstructed here. */
export function parseProofAuthorization(headers:Headers):BrowserProof|null{
 if(hasLegacyProofHeader(headers))return null;
 const value=headers.get(AUTHORIZATION_HEADER);if(value===null)return null;
 const match=/^Bearer (command|csrf)\.([A-Za-z0-9_-]{43})$/.exec(value);
 return match?{purpose:match[1] as BrowserProofPurpose,token:match[2]}:null;
}
