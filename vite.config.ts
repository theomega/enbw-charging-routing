import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // The EnBW API rejects any Origin other than https://www.enbw.com, so the
    // charger calls must go through the Worker. `pnpm dev:worker` serves it.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
    },
  },
})
