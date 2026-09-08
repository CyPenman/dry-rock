import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Loaded before index.css so our Leaflet overrides there always win the
// cascade at equal specificity, regardless of which component imports it.
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
