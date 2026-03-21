import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3002,
    proxy: {
      '/backend-api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/backend-api/, '/api')
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  }
});
