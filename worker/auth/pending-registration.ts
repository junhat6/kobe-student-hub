import type {VerifiedSchoolIdentity} from './google-identity';
const clean=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!!v.trim()&&!/[\p{Cc}\p{Cf}]/u.test(v)&&new TextDecoder().decode(new TextEncoder().encode(v))===v;
/** Server-only pending receipt, not enrollment, email identity/recovery, or permission to log in.
 * Callers must obtain identity through actual provider signature verification. */
export class PendingRegistrationStore{
 constructor(private readonly db:D1Database,private readonly clock:()=>number=Date.now){}
 async record(identity:VerifiedSchoolIdentity):Promise<{recorded:true}|null>{
  if(identity?.provider!=='google'||!clean(identity.subject,255)||!clean(identity.email,320)||!/^[^@\s]+@st\.kobedenshi\.ac\.jp$/i.test(identity.email))return null;
  try{const now=this.clock();if(!Number.isSafeInteger(now)||now<0||now>253402300799999)return null;
   // Email collision refusal is conservative: it never links subjects or changes stored contact.
   const row=await this.db.prepare(`INSERT INTO private_accounts(id,google_subject,email,status,session_epoch,created_at_ms)
    SELECT ?,?,?,'pending',0,? WHERE NOT EXISTS(SELECT 1 FROM private_accounts other WHERE other.google_subject<>? AND lower(other.email)=lower(?))
    ON CONFLICT(google_subject) DO UPDATE SET google_subject=private_accounts.google_subject
    WHERE private_accounts.status='pending' AND private_accounts.email=excluded.email AND private_accounts.created_at_ms<=excluded.created_at_ms RETURNING id`).bind(crypto.randomUUID(),identity.subject,identity.email,now,identity.subject,identity.email).first();
   return row?{recorded:true}:null;
  }catch{return null}
 }
}
