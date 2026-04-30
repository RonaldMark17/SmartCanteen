import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const localInstallHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const canUseLocalServiceWorker = localInstallHosts.has(window.location.hostname)

if ((import.meta.env.PROD || canUseLocalServiceWorker) && 'serviceWorker' in navigator) {
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
