import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BACKEND_WS controls the WebSocket URL used by backend.js.
// The proxy here lets you skip the env var in dev — just run the Python
// backend on localhost:8000 and Vite will forward /ws and /api for you.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
});
