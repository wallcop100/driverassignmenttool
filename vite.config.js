import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      // two entries, one app: / is the standalone drop-two-CSVs page,
      // /api/ is the embed target the host iframes.
      input: { main: 'index.html', embed: 'api/index.html' },
    },
  },
  server: { port: 5173, strictPort: true },
});
