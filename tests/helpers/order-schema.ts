import {readFileSync} from 'node:fs';
export async function applyOrderSchema(db:Pick<D1Database,'prepare'|'batch'>){
 if((await db.prepare('PRAGMA table_info(auth_sessions)').all<{name:string}>()).results.some(c=>c.name==='context_hash'))return;
 const sql=readFileSync('migrations/0012_browser_session_order.sql','utf8');
 await db.batch(sql.split(/^-- @statement\s*$/m).map(s=>s.replace(/^--.*$/gm,'').trim()).filter(Boolean).map(s=>db.prepare(s)));
}
