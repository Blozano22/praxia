import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { esUrlImagen } from '../lib/consumo.js'
import { IconoAviso } from './Confirmar.jsx'
import './confirmar.css'
import './regenerar-partes.css'

const FOCO = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
const RE_CLAVE_IMG = /(^|_)(url|src|imagen|image)$|(Url|Src)$/

// Recorre un contenido y devuelve las imágenes https con la ruta exacta del campo (a.b[2].c). «prefijo»: 'actividad:' para las de la actividad.
export function imagenesDelContenido(contenido, prefijo = '', excluir = '') {
  const salida = []
  const ir = (v, ruta, clave, prof) => {
    if (prof > 12 || salida.length >= 50) return
    if (typeof v === 'string') { if (ruta && RE_CLAVE_IMG.test(clave) && esUrlImagen(v) && v !== excluir) salida.push({ ruta: prefijo + ruta, url: v }); return }
    if (Array.isArray(v)) { v.forEach((x, i) => ir(x, ruta + '[' + i + ']', clave, prof + 1)); return }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) ir(v[k], ruta ? ruta + '.' + k : k, k, prof + 1)
  }
  ir(contenido, '', '', 0)
  return salida
}

// Lo que el docente puede elegir regenerar del recurso, según lo vigente: contenido (c.contenido), actividad y bibliografía (con su contenido) y la imagen principal.
export function imagenesDelRecurso(c) {
  const lista = []
  const principal = c && esUrlImagen(c.imagenUrl) ? c.imagenUrl : ''
  if (principal) lista.push({ ruta: 'IMAGEN_EJEMPLO', url: principal, etiqueta: 'Imagen principal' })
  if (c && c.contenido) lista.push(...imagenesDelContenido(c.contenido, '', principal).map((x, i) => ({ ...x, etiqueta: 'Imagen del recurso ' + (i + 1) })))
  if (c && c.actividad && c.actividad.contenido) lista.push(...imagenesDelContenido(c.actividad.contenido, 'actividad:').map((x, i) => ({ ...x, etiqueta: 'Imagen de la actividad ' + (i + 1) })))
  return lista
}

// Ventana para elegir qué regenerar: todo (por defecto) o solo partes (texto, imágenes —las que faltan o las elegidas—, actividad, bibliografía).
// «cargar»: async () => contenido vigente del recurso ({contenido, actividad, bibliografia, imagenUrl}); sirve para listar las miniaturas.
// onConfirmar recibe null (todo) o { partes, imagenes? }.
export default function RegenerarPartes({ recurso, cargar, onConfirmar, onCancelar }) {
  const [vigente, setVigente] = useState(null)
  const [errorCarga, setErrorCarga] = useState('')
  const [modo, setModo] = useState('todo')
  const [partes, setPartes] = useState({ recurso: true, imagenes: false, actividad: false, bibliografia: false })
  const [modoImg, setModoImg] = useState('faltan')
  const [elegidas, setElegidas] = useState({})
  const caja = useRef(null)
  const principal = useRef(null)
  const cancelarRef = useRef(onCancelar)
  cancelarRef.current = onCancelar

  useEffect(() => {
    let vivo = true
    ;(async () => { try { const c = await cargar(); if (vivo) setVigente(c || {}) } catch (e) { if (vivo) { setVigente({}); setErrorCarga((e && e.message) || 'No se pudo leer el contenido del recurso.') } } })()
    return () => { vivo = false }
  }, [cargar])

  useEffect(() => {
    const previo = document.activeElement
    if (principal.current) principal.current.focus()
    const tecla = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cancelarRef.current(); return }
      if (e.key !== 'Tab' || !caja.current) return
      const l = [...caja.current.querySelectorAll(FOCO)]
      if (!l.length) { e.preventDefault(); return }
      const a = document.activeElement
      if (!caja.current.contains(a)) { e.preventDefault(); l[0].focus() }
      else if (e.shiftKey && a === l[0]) { e.preventDefault(); l[l.length - 1].focus() }
      else if (!e.shiftKey && a === l[l.length - 1]) { e.preventDefault(); l[0].focus() }
    }
    document.addEventListener('keydown', tecla, true)
    return () => { document.removeEventListener('keydown', tecla, true); if (previo && previo.focus) previo.focus() }
  }, [])

  const tieneActividad = !!(vigente ? vigente.actividad : recurso.tieneActividad)
  const tieneBibliografia = !!(vigente ? vigente.bibliografia : recurso.tieneBibliografia)
  const imagenes = useMemo(() => imagenesDelRecurso(vigente), [vigente])
  const marcadas = Object.keys(elegidas).filter((k) => elegidas[k])
  const hayParte = (partes.recurso || partes.imagenes || (partes.actividad && tieneActividad) || (partes.bibliografia && tieneBibliografia))
  const faltaImagen = modo === 'partes' && partes.imagenes && modoImg === 'elegir' && !marcadas.length
  const puede = modo === 'todo' || (hayParte && !faltaImagen)

  const confirmar = () => {
    if (!puede) return
    if (modo === 'todo') { onConfirmar(null); return }
    const lista = ['recurso', 'imagenes', 'actividad', 'bibliografia'].filter((k) => partes[k] && (k !== 'actividad' || tieneActividad) && (k !== 'bibliografia' || tieneBibliografia))
    onConfirmar({ partes: lista, ...(lista.includes('imagenes') && modoImg === 'elegir' ? { imagenes: marcadas } : {}) })
  }
  const marca = (k) => (e) => setPartes((p) => ({ ...p, [k]: e.target.checked }))

  return createPortal(
    <div className="cf-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancelar() }}>
      <div className="cf-caja cf-peligro rg-caja" ref={caja} role="dialog" aria-modal="true" aria-labelledby="rg-titulo">
        <div className="cf-icono">{IconoAviso}</div>
        <h2 id="rg-titulo" className="cf-titulo">¿Qué desea regenerar?</h2>
        <div className="cf-texto"><p>{recurso.codigo ? <b>{recurso.codigo}</b> : null}{recurso.codigo && recurso.titulo ? ' · ' : ''}{recurso.titulo || ''}</p></div>
        <fieldset className="rg-grupo">
          <legend className="rg-sr">Alcance</legend>
          <label className={'rg-op' + (modo === 'todo' ? ' on' : '')}><input type="radio" name="rg-modo" ref={principal} checked={modo === 'todo'} onChange={() => setModo('todo')} /><span><b>Todo</b><small>Se crea de nuevo con la misma plantilla (texto, imágenes{tieneActividad ? ', actividad' : ''}{tieneBibliografia ? ', bibliografía' : ''}).</small></span></label>
          <label className={'rg-op' + (modo === 'partes' ? ' on' : '')}><input type="radio" name="rg-modo" checked={modo === 'partes'} onChange={() => setModo('partes')} /><span><b>Solo algunas partes</b><small>Lo demás se conserva tal como está.</small></span></label>
        </fieldset>
        {modo === 'partes' && (
          <fieldset className="rg-grupo rg-partes">
            <legend className="rg-sr">Partes</legend>
            <label className="rg-ck"><input type="checkbox" checked={partes.recurso} onChange={marca('recurso')} /><span>Texto del recurso</span></label>
            <label className="rg-ck"><input type="checkbox" checked={partes.imagenes} onChange={marca('imagenes')} /><span>Imágenes</span></label>
            {partes.imagenes && (
              <div className="rg-sub">
                <label className="rg-ck"><input type="radio" name="rg-img" checked={modoImg === 'faltan'} onChange={() => setModoImg('faltan')} /><span>Solo las que faltan</span></label>
                <label className="rg-ck"><input type="radio" name="rg-img" checked={modoImg === 'elegir'} onChange={() => setModoImg('elegir')} /><span>Elegir imágenes</span></label>
                {modoImg === 'elegir' && (vigente === null
                  ? <small className="rg-nota">Leyendo las imágenes del recurso…</small>
                  : imagenes.length === 0
                    ? <small className="rg-nota">{errorCarga || 'Este recurso no tiene imágenes con enlace para elegir. Use «Solo las que faltan».'}</small>
                    : <ul className="rg-miniaturas">
                      {imagenes.map((im) => (
                        <li key={im.ruta}>
                          <label className={'rg-mini' + (elegidas[im.ruta] ? ' on' : '')} title={im.ruta}>
                            <img src={im.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                            <span className="rg-mini-pie"><input type="checkbox" checked={!!elegidas[im.ruta]} onChange={(e) => setElegidas((x) => ({ ...x, [im.ruta]: e.target.checked }))} /><span>{im.etiqueta}</span></span>
                          </label>
                        </li>
                      ))}
                    </ul>)}
              </div>
            )}
            {tieneActividad && <label className="rg-ck"><input type="checkbox" checked={partes.actividad} onChange={marca('actividad')} /><span>Actividad</span></label>}
            {tieneBibliografia && <label className="rg-ck"><input type="checkbox" checked={partes.bibliografia} onChange={marca('bibliografia')} /><span>Bibliografía</span></label>}
          </fieldset>
        )}
        <div className="cf-texto rg-aviso">
          <p>{modo === 'todo' ? 'Se perderán las ediciones hechas a mano en todo el recurso.' : 'Se perderán las ediciones hechas a mano solo en las partes elegidas.'}</p>
          <p>Si ya estaba publicado, el archivo se reemplazará solo cuando vuelva a aprobarlo.</p>
        </div>
        <div className="cf-pie">
          <button type="button" className="cf-btn cf-sec" onClick={onCancelar}>Cancelar</button>
          <button type="button" className="cf-btn cf-pri" onClick={confirmar} disabled={!puede}>Regenerar</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Uso: const [pedir, dialogo] = usePedirRegenerar(); const sel = await pedir(recurso, cargar); if (sel === undefined) return /* canceló */; sel === null = todo.
export function usePedirRegenerar() {
  const [cfg, setCfg] = useState(null)
  const res = useRef(null)
  const pedir = useCallback((recurso, cargar) => new Promise((resolver) => { res.current = resolver; setCfg({ recurso, cargar }) }), [])
  const cerrar = (v) => { const r = res.current; res.current = null; setCfg(null); if (r) r(v) }
  const dialogo = cfg ? <RegenerarPartes recurso={cfg.recurso} cargar={cfg.cargar} onConfirmar={(v) => cerrar(v)} onCancelar={() => cerrar(undefined)} /> : null
  return [pedir, dialogo]
}

// Ítem para la orden de «regenerar»: el código solo (todo) o { codigo, partes, imagenes? }.
export const itemRegenerar = (codigo, sel) => (sel && sel.partes ? { codigo, partes: sel.partes, ...(sel.imagenes && sel.imagenes.length ? { imagenes: sel.imagenes } : {}) } : codigo)
