import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Loaded before index.css so our Leaflet overrides there always win the
// cascade at equal specificity, regardless of which component imports it.
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.tsx'

// §2's offline promise rests on Cache Storage and IndexedDB, which the browser
// may clear under storage pressure unless the origin is marked persistent.
// Only asked when installed: Chrome and Safari decide silently for an
// installed app, whereas Firefox in a tab would show a permission prompt.
const installed =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true
if (installed) {
  navigator.storage?.persisted?.().then((already) => {
    if (!already) return navigator.storage.persist()
  }).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
