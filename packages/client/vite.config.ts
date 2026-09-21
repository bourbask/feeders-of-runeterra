import { defineConfig } from 'vite';

// Minimal on purpose. This file exists so that `infra/Dockerfile` has a client
// bundle to copy into `/app/public`; the real client configuration (React
// plugin, dev proxy to the API, the "table" page) belongs to M0-19.
//
// It is NOT wired into `pnpm build` yet: the `build` script of this package
// still runs `tsc --noEmit`, because a `dist/` produced by a client with no
// page in it would only give a false sense of completeness. M0-19 flips the
// script to `vite build`; until then, `pnpm --filter @for/client exec vite build`
// is the way to exercise this file.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
