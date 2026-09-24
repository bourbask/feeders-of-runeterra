import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Le proxy de developpement envoie l'API et la socket sur le serveur Fastify
// (M0-20) : le navigateur ne voit qu'une seule origine, donc le cookie de
// session `fr_session` (`SameSite=Lax`) part avec la requete comme en
// production, ou Caddy sert les deux depuis la meme origine.
const API_TARGET = process.env['VITE_DEV_API_TARGET'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/healthz': { target: API_TARGET, changeOrigin: false },
      '/readyz': { target: API_TARGET, changeOrigin: false },
      '/ws': { target: API_TARGET, changeOrigin: false, ws: true },
    },
  },
});
