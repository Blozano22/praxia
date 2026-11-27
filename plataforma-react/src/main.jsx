import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/plataforma/app.css'
import './extra.css'
import './premium.css'
import './controles.css'
import './usuarios.css'
import './marco.css'
import './lineagrafica.css'
import './bibliografia.css'
import './guiones.css'
import AvisoVersion from './components/AvisoVersion.jsx'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <AvisoVersion />
    </ErrorBoundary>
  </StrictMode>
)
