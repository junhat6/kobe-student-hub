import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ define:{__ACCOUNT_UI_RELEASE_ENABLED__:false},plugins: [react(), tailwindcss()], server: { proxy: { '/api': 'http://127.0.0.1:8787' } } });
