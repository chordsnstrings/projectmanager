import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API path prefixes the Fastify server owns; proxied to it in dev.
const API_PREFIXES = ['/healthz', '/me', '/api', '/auth', '/webhooks', '/tasks', '/sessions', '/dashboard', '/flags', '/questions', '/nudges', '/completions'];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PREFIXES.map((p) => [p, { target: 'http://localhost:8080', changeOrigin: true }]),
    ),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
