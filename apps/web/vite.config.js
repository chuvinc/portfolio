import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to the Node service during local dev.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
