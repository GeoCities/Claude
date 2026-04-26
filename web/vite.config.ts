import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Relative base so the build works under any IPFS path
  // (e.g. /ipfs/<cid>/) without rewriting asset URLs.
  base: './',
  define: {
    global: 'globalThis',
  },
});
