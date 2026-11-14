import { useEffect, useRef, useState } from 'react'
import { marcoPlantilla } from '../lib/vista.js'
import { verNombre } from '../lib/nombres.js'
import { api, RUTA_API } from '../lib/api.js'
import { cargarEjemplo } from '../lib/ejemplos.js'
import './categorias.css'

// Vista previa de una plantilla publicada en una ventana (popup) sin salir de la página.
// Una plantilla suelta está vacía: n8n le pone el título y el contenido de cada recurso, por eso abierta en una pestaña solo se ve el marco.
// Aquí se muestra con el ejemplo de la galería (que sí trae contenido) cuando existe; si no, tal cual, avisándolo.
const urlPlantilla = (n) => RUTA_API.replace(/\/api$/, '') + '/plantillas-html/' + n + '.html'

export default function VistaPlantilla({ nombre, categoria = null, subida = false, onCerrar }) {
  const [html, setHtml] = useState('')
  const [origen, setOrigen] = useState('') // 'ejemplo' | 'vacia'
  const [error, setError] = useState('')
  const [esc, setEsc] = useState(0.6)
  const caja = useRef(null)
  const cierre = useRef(null)

  useEffect(() => {
    let vivo = true
    setHtml(''); setError(''); setOrigen('')
    ;(async () => {
      try {
        // Una plantilla subida puede traer su propio contenido de ejemplo; una del sistema, el de la galería.
        let ej = null
        if (subida) { try { ej = (await api('GET', '/plantillas/subidas/' + encodeURIComponent(nombre) + '/ejemplo')).html } catch { ej = null } } else ej = await cargarEjemplo(nombre)
        if (!vivo) return
        if (ej) { setHtml(ej); setOrigen('ejemplo'); return }
        const r = await fetch(urlPlantilla(nombre))
        if (!r.ok) throw new Error('No se pudo cargar la plantilla.')
        const t = await r.text()
        if (!vivo) return
        // Sin contenido de ejemplo: se pone el título y un contenido vacío para que el código de la plantilla no falle.
        setHtml(t.replace('{{TITULO}}', () => nombre).replace('/*CONTENIDO*/', () => '{}')); setOrigen('vacia')
      } catch (e) { if (vivo) setError(e.message || 'No se pudo cargar la plantilla.') }
    })()
    return () => { vivo = false }
  }, [nombre, subida])

  // La plantilla se dibuja a 1280 × 720 (su tamaño real) y se escala al ancho disponible; un ancho de 0 no es una medida válida.
  useEffect(() => {
    const el = caja.current
    if (!el) return undefined
    const medir = () => { const w = el.clientWidth; if (w > 0) setEsc(w / 1280) }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [html])

  useEffect(() => {
    const f = (e) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', f)
    cierre.current && cierre.current.focus()
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', f); document.body.style.overflow = previo }
  }, [onCerrar])

  return (
    <div className="vp-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
      <div className="vp-caja" role="dialog" aria-modal="true" aria-label={'Vista previa de ' + nombre}>
        <header className="vp-cab">
          <div className="vp-tit">
            {categoria && <span className="cat-id">{categoria.id}</span>}
            <div><b>{verNombre(nombre)}</b>{categoria && <small>{categoria.nombre}</small>}</div>
          </div>
          <div className="vp-acc">
            <a className="btn sec sm" href={urlPlantilla(nombre)} target="_blank" rel="noopener noreferrer">Abrir en otra pestaña ↗</a>
            <button ref={cierre} type="button" className="btn sm" onClick={onCerrar}>Cerrar</button>
          </div>
        </header>
        {origen === 'ejemplo' && <p className="vp-nota">Se muestra con un <b>contenido de ejemplo</b>{subida ? ' que trae la propia plantilla' : ' de la galería'}. n8n le pone el contenido real de cada recurso.</p>}
        {origen === 'vacia' && <p className="vp-nota aviso">Esta plantilla <b>no tiene un ejemplo con contenido</b>: sola se ve vacía, porque n8n le pone el título y el contenido de cada recurso. Esto es la plantilla tal cual.</p>}
        <div className="vp-cuerpo">
          {error && <div className="msg bad" role="alert">{error}</div>}
          {!html && !error && <p className="help vp-carga">Cargando…</p>}
          <div className="vp-marco" ref={caja} hidden={!html}>
            {html && <iframe sandbox="allow-scripts" title={'Vista previa de ' + nombre} srcDoc={html} style={marcoPlantilla(esc)} />}
          </div>
        </div>
      </div>
    </div>
  )
}
