import { useEffect, useRef, useState } from 'react'
import './avisoversion.css'

const CARGADA = typeof __VERSION_BUILD__ !== 'undefined' ? __VERSION_BUILD__ : null
const CADA = 5 * 60 * 1000

// Avisa cuando el servidor ya tiene un build distinto al que cargó esta página. «Más tarde» lo oculta hasta que salga otra versión.
export default function AvisoVersion() {
  const [nueva, setNueva] = useState(null)
  const cerrada = useRef(null)

  useEffect(() => {
    if (!CARGADA) return undefined
    let vivo = true
    const revisar = async () => {
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        if (!r.ok) return
        const { version } = await r.json()
        if (vivo && version && version !== 'dev' && version !== CARGADA && version !== cerrada.current) setNueva(version)
      } catch { /* sin red: se reintenta luego */ }
    }
    const alVolver = () => { if (document.visibilityState === 'visible') revisar() }
    revisar()
    const t = setInterval(revisar, CADA)
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [])

  if (!nueva) return null

  // Se navega a la misma URL con ?v=<versión> (conserva el hash): el navegador no puede reutilizar la página guardada.
  // Si hay cambios sin guardar, el aviso beforeunload de la pantalla pregunta antes de salir.
  const actualizar = () => {
    const u = new URL(location.href)
    u.searchParams.set('v', nueva)
    location.replace(u.toString())
  }

  return (
    <div className="aviso-version" role="status" aria-live="polite">
      <span className="aviso-version-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
      </span>
      <div className="aviso-version-cuerpo">
        <p className="aviso-version-tit">Hay una versión nueva de Praxia</p>
        <p className="aviso-version-tx">Actualice para ver los cambios.</p>
        <div className="aviso-version-acc">
          <button className="btn sm" onClick={actualizar}>Actualizar</button>
          <button className="btn sec sm" onClick={() => { cerrada.current = nueva; setNueva(null) }}>Más tarde</button>
        </div>
      </div>
    </div>
  )
}
