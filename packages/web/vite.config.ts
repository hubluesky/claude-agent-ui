import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4000',
      '/ws': {
        target: 'http://localhost:4000',
        ws: true,
        // Prevent proxy from closing idle WebSocket connections.
        // Default timeout (~120s) kills connections even though the app
        // has its own heartbeat (JSON ping/pong every 30s), because
        // http-proxy only recognises WebSocket-level ping frames.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
})
