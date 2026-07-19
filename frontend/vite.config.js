import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/transfer/',

  build: {
    // Split vendor chunks so app updates don't bust the React cache entry
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react';
          }
        },
      },
    },
    // Emit source-maps for easier debugging in production
    sourcemap: false,
    // Warn when a chunk exceeds 600 kB
    chunkSizeWarningLimit: 600,
  },

  server: {
    port: 5173,
    proxy: {
      // Proxy /api/... → Spring Boot (embedded Tomcat, dev mode) at /transfer-backend/api/...
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => `/transfer-backend${path}`,
      },
    },
  },
});
