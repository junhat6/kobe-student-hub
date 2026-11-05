import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({root:resolve('tests/limited'),plugins:[react()],build:{outDir:resolve('.limited-preview'),emptyOutDir:true},server:{fs:{allow:[resolve('.')]}}});
