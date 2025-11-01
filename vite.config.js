import { defineConfig } from 'vite';

export default defineConfig({
  // Keep "public" folder as Vite's public dir
  publicDir: 'public',
  server: {
    port: 5173,
    open: false
  }
});
