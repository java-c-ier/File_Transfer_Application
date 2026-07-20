import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// ─────────────────────────────────────────────────────────────────────────────
// Base path resolution:
//   VITE_BASE_PATH from the active .env file drives everything —
//   Vite's `base`, the router basename (via import.meta.env.BASE_URL),
//   and the index.html %BASE_URL% placeholder all stay in sync.
//
//   Dev / UAT:  VITE_BASE_PATH=/transfer/
//   PROD:       VITE_BASE_PATH=/           (subdomain — served at root)
// ─────────────────────────────────────────────────────────────────────────────

const redirectToBase = {
  name: 'redirect-to-base',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const base = process.env.VITE_BASE_PATH || '/transfer/';
      const noSlash = base.replace(/\/$/, '');
      if (req.url === noSlash) {
        res.writeHead(301, { Location: base });
        res.end();
        return;
      }
      next();
    });
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE_PATH || '/transfer/';

  return {
    plugins: [react(), redirectToBase],
    base,

    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react';
            }
          },
        },
      },
      sourcemap: false,
      chunkSizeWarningLimit: 600,
    },

    server: {
      port: 5173,
      // No proxy — backend URL comes from public/config.js at runtime
    },
  };
});
