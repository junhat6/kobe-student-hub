import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
// A dedicated asset directory/binding: never substitute the ordinary public assets.
export default defineConfig({root:resolve('src/trial'),base:'/trial-assets/',plugins:[react()],build:{outDir:resolve('.trial-assets'),emptyOutDir:true},server:{fs:{allow:[resolve('.')]}}});
