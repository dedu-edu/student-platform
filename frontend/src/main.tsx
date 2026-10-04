import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import MatrixRain from './MatrixRain.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <MatrixRain />
  </StrictMode>,
)
