import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SpikePage } from './SpikePage.tsx'

const isSpike = new URLSearchParams(window.location.search).has('spike')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSpike ? <SpikePage /> : <App />}
  </StrictMode>,
)
