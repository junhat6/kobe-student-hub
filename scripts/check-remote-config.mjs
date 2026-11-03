import { readFileSync } from 'node:fs';
const c=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const db=c.d1_databases?.find(d=>d.binding==='DB');
if(!db||db.database_id==='00000000-0000-0000-0000-000000000000'||!c.workers_dev){
 console.error('Remote deployment disabled: provision the specifically authorized D1 database, record its returned ID and enable the intended preview Worker. See docs/DEPLOYMENT.md.');process.exit(1);
}
if(!/^[a-f0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID||'') || process.env.CLOUDFLARE_ACCOUNT_ID!==process.env.CLOUDFLARE_EXPECTED_ACCOUNT_ID){
 console.error('Unexpected Cloudflare account. Refusing to deploy.');process.exit(1);
}
