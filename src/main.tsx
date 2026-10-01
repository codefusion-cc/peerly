import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.ts'
import './index.css'
import { App } from './App.tsx'
import { I18nProvider } from './I18nProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)

// The app shell works offline once loaded (public/sw.js): workspaces and messages live on the device.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}
