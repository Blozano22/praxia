import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { verNombre } from '../lib/nombres.js'
import './avisos.css'

// Avisos temporales sobre las plantillas HTML: «Dani aprobó la plantilla G-01-PRE-V07». No se guardan en ningún lado: el servidor los tiene unos minutos en memoria
// hasta que esta pantalla los recoge (cada pocos segundos, solo con la pestaña a la vista) y aquí duran unos segundos, con una barra que se va vaciando.
// Se cierran con la X, desaparecen solos al terminar la barra (se detiene mientras el cursor está encima) y, si se pulsa el aviso, llevan a la plantilla.
const CADA_MS = 8000
const DURA_S = 10
const MAX_VISIBLES = 4

const ICONO = {
  aprobada: 'M5 12.5l4.5 4.5L19 7',
  rechazada: 'M6 6l12 12M18 6L6 18',
  revision: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  corregida: 'M3 12.5l4 4L15 8M10 16.5l1 1L21 8'
}
function Texto({ a }) {
  const cod = <b>{verNombre(a.nombre)}</b>
  const quien = <b>{a.quien}</b>
  if (a.tipo === 'aprobada') return <>{quien} aprobó la plantilla {cod}</>
  if (a.tipo === 'rechazada') return <>{quien} rechazó la plantilla {cod}</>
  if (a.tipo === 'revision') return <>{quien} pidió cambios en la plantilla {cod}</>
  return <>{quien} notificó el cambio de la plantilla {cod} y pide una nueva revisión</>
}

export default function AvisosPlantillas({ onAbrir, onNuevos }) {
  const [lista, setLista] = useState([])
  const vistos = useRef(new Set())
  const quitar = useCallback((id) => setLista((l) => l.filter((x) => x.id !== id)), [])

  useEffect(() => {
    let vivo = true
    const recoger = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await api('GET', '/plantillas/avisos')
        const nuevos = ((r && r.avisos) || []).filter((a) => a && a.id && !vistos.current.has(a.id))
        if (!vivo || !nuevos.length) return
        nuevos.forEach((a) => vistos.current.add(a.id))
        setLista((l) => [...l, ...nuevos].slice(-MAX_VISIBLES))
        onNuevos && onNuevos()
      } catch { /* sin conexión o sesión vencida: se intenta en el siguiente ciclo */ }
    }
    recoger()
    const t = setInterval(recoger, CADA_MS)
    const alVolver = () => { if (document.visibilityState === 'visible') recoger() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [])

  if (!lista.length) return null
  return (
    <div className="avp-lista" role="region" aria-label="Avisos de plantillas" aria-live="polite">
      {lista.map((a) => (
        <div key={a.id} className={'avp ' + a.tipo}>
          <button type="button" className="avp-cuerpo" onClick={() => { quitar(a.id); onAbrir && onAbrir(a.plantilla) }} title="Ir a la plantilla">
            <span className="avp-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={ICONO[a.tipo] || ICONO.corregida} /></svg></span>
            <span className="avp-tx"><Texto a={a} /><small>Pulse para verla</small></span>
          </button>
          <button type="button" className="avp-x" aria-label="Quitar este aviso" title="Quitar" onClick={() => quitar(a.id)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <span className="avp-barra" aria-hidden="true"><i style={{ animationDuration: DURA_S + 's' }} onAnimationEnd={() => quitar(a.id)} /></span>
        </div>
      ))}
    </div>
  )
}
