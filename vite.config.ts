import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { versionFile } from '@codefusion-cc/console/vite'
import { buildDefines } from './build-info.mjs'
import { packageSources } from './source-conditions.ts'

export default defineConfig({
  // versionFile: /version.json, the deployed commit on CodeFusion Console's Deployments page.
  plugins: [react(), tailwindcss(), versionFile(), packageSources()],
  define: buildDefines(),
  resolve: {
    dedupe: ['@trystero-p2p/core'],
  },
})
