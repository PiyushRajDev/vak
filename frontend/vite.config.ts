import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    https: {
      key: readFileSync('./certs/key.pem'),
      cert: readFileSync('./certs/cert.pem'),
    },
    proxy: {
      // Proxy REST API calls to the backend
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Proxy WebSocket connections to the backend
      '/ws': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
