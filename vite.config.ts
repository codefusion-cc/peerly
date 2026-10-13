import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { versionFile } from '@codefusion-cc/console/vite'
import { buildDefines } from './build-info.mjs'

export default defineConfig({
  // versionFile: /version.json, the deployed commit on CodeFusion Console's Deployments page.
  plugins: [react(), tailwindcss(), versionFile()],
  define: buildDefines(),
  resolve: {
    dedupe: ['@trystero-p2p/core'],
    // The app consumes the workspace package from source; published consumers
    // get dist/. Order matters: the subpath alias must precede the bare one.
    alias: [
      { find: '@peerly/core/react', replacement: fileURLToPath(new URL('./packages/core/src/react.ts', import.meta.url)) },
      { find: '@peerly/core', replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
    ],
  },
})
