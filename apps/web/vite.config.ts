import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev, Vite serves the client and proxies the API and websocket to the
// server. In production the server serves the built files from `dist`.
// Set API_PROXY (e.g. http://localhost:3211) to point at a server on another
// port — say, a `pnpm --filter @cardball/server demo` instance — without
// disturbing the default dev stack.
const proxyTarget = process.env.API_PROXY ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': proxyTarget,
      '/socket.io': { target: proxyTarget, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
