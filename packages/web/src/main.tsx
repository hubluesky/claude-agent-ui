import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

// Apply saved theme before first render to avoid flash
try {
  const saved = JSON.parse(localStorage.getItem('claude-agent-ui-settings') ?? '{}')
  if (saved.theme) document.documentElement.setAttribute('data-theme', saved.theme)
} catch { /* ignore */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
