import {readFileSync} from 'node:fs';
export async function applyOrderSchema(db:Pick<D1Database,'prepare'|'batch'>){
 if((await db.prepare('PRAGMA table_info(auth_sessions)').all<{name:string}>()).results.some(c=>c.name==='context_hash'))return;
 const sql=readFileSync('migrations/0012_browser_session_order.sql','utf8');
 await db.batch(sql.split(/^-- @statement\s*$/m).map(s=>s.replace(/^--.*$/gm,'').trim()).filter(Boolean).map(s=>db.prepare(s)));
}

export async function applySelfRegistrationSchema(db:Pick<D1Database,'prepare'|'batch'>){
 await applyOrderSchema(db);
 for(const [name,table] of [['0016_self_declared_enrollment.sql','private_enrollment_periods'],['0017_self_registration.sql','auth_self_registration_attempts']]){
  if(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").bind(table).first())continue;
  const raw=readFileSync('migrations/'+name,'utf8'),statements=(raw.includes('-- @statement')?raw.split(/^-- @statement\s*$/m):raw.split(/;\s*(?:\n|$)/)).map(s=>s.replace(/^--.*$/gm,'').trim()).filter(Boolean);
  await db.batch(statements.map(sql=>db.prepare(sql)));
 }
}
