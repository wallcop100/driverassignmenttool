import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      // Three entries, one build. `base: './'` keeps every asset path relative,
      // so all three sit in one Pages artifact with no base-path juggling.
      //   /          the driver tool, standalone drop-two-CSVs page
      //   /api/      the driver tool, embed target for DJ 101681
      //   /lcp/api/  the LCP tool, embed target for DJ 101698 — its ONLY entry
      input: {
        main: 'index.html',
        embed: 'api/index.html',
        lcp: 'lcp/api/index.html',
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
