import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY || 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path,
      },
    },
  },
});
