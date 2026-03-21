import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/backend-api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/backend-api/, '/api')
      }
    }
  }
})
