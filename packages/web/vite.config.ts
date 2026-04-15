import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'src/embed/index.ts'),
      },
      output: {
        entryFileNames(chunk) {
          return chunk.name === 'embed' ? 'embed.js' : 'assets/[name]-[hash].js'
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4000',
      '/ws': {
        target: 'http://localhost:4000',
        ws: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
})
