import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward REST calls to Express so no CORS issues in dev
      '/docs': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
})
