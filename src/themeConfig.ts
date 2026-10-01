import { defineTheme } from '@codefusion-cc/theme'

/** Light, dark or the system's: daisyUI's `data-theme` on <html>, shown before first paint (vite.config.ts). */
export const themeConfig = defineTheme({
  storageKey: 'peerly-theme',
  html: { attribute: 'data-theme', light: 'peerly', dark: 'peerly-dark' },
  themeColor: '--color-base-200',
})
