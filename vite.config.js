import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: true,
    proxy: {
      // The geodata cache, served same-origin so the browser never has to
      // deal with CORS. When the cache server is not running this fails
      // fast, the client treats it as a miss, and data comes live from
      // Overpass and Overture exactly as it did before.
      '/api/cache': {
        target: 'http://localhost:8788',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cache/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
  },
});
