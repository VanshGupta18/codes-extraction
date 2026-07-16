import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // base: serve from /hsn-review-workbench/ sub-path when CAP hosts the built dist/
  base: './',
  server: {
    proxy: {
      // In dev, forward OData calls to the local CAP server to avoid CORS
      '/odata': {
        target: 'http://localhost:4004',
        changeOrigin: true,
      },
      // Forward /api calls to FastAPI backend
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
