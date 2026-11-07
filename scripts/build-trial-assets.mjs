import {cpSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
// Local packaging only; this script never deploys or touches a database.
execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','vite.trial.config.ts'],{stdio:'inherit'});
mkdirSync('dist/trial-assets',{recursive:true});
cpSync('.trial-assets','dist/trial-assets',{recursive:true,force:true});
