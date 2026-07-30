import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const localInstallHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const canUseLocalServiceWorker = localInstallHosts.has(window.location.hostname)

if (canUseLocalServiceWorker && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const registrationsPromise = navigator.serviceWorker.getRegistrations?.()
    if (registrationsPromise) {
      registrationsPromise.then((registrations) => {
        registrations.forEach((registration) => registration.unregister())
      })
    }

    const cacheKeysPromise = window.caches?.keys?.()
    if (cacheKeysPromise) {
      cacheKeysPromise.then((keys) => {
        keys
          .filter((key) => key.startsWith('smartcanteen-'))
          .forEach((key) => window.caches.delete(key))
      })
    }
  })
} else if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Keep the app functional even if the service worker registration fails.
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
