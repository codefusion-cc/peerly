import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { prePaintTheme } from '@codefusion-cc/theme/vite'
import { buildDefines } from './build-info.mjs'
import { themeConfig } from './src/themeConfig.ts'

export default defineConfig({
  define: buildDefines(),
  plugins: [react(), tailwindcss(), prePaintTheme(themeConfig)],
  build: {
    sourcemap: true,
    // The heavy, rarely used parts (calls, the image screen) load when first needed.
    chunkSizeWarningLimit: 700,
  },
  server: {
    // `npm run dev` runs the Worker beside Vite (scripts/dev.mjs) and sets its port here.
    proxy: process.env.PEERLY_API_PORT
      ? { '/api': { target: `http://127.0.0.1:${process.env.PEERLY_API_PORT}`, ws: true } }
      : undefined,
  },
})
