import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './confirmar.css'

const Svg = ({ children, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
export const IconoEnviar = <Svg size={26}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></Svg>
export const IconoAviso = <Svg size={26}><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><path d="M12 9v4M12 17h.01" /></Svg>
export const IconoCheck = <Svg size={16}><path d="M5 12.5l4.5 4.5L19 7" /></Svg>
export const IconoOjo = <Svg size={16}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></Svg>
export const IconoCandado = <Svg size={16}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></Svg>
export const IconoEditar = <Svg size={16}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></Svg>

const FOCO = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Diálogo de confirmación. tono: 'normal' | 'aviso' (ámbar) | 'peligro' (rojo).
// accion (opcional): función async que se ejecuta al confirmar; el diálogo queda abierto con «Enviando…» y muestra el error si falla.
export default function Confirmar({ titulo, texto, items = [], icono, tono = 'normal', textoConfirmar = 'Aceptar', textoOcupado = 'Enviando…', textoCancelar = 'Cancelar', textoSecundario, accion, onConfirmar, onCancelar }) {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const caja = useRef(null)
  const principal = useRef(null)
  const ocupadoRef = useRef(false)
  ocupadoRef.current = ocupado
  const cancelarRef = useRef(onCancelar)
  cancelarRef.current = onCancelar

  useEffect(() => {
    const previo = document.activeElement
    if (principal.current) principal.current.focus()
    const tecla = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (!ocupadoRef.current) cancelarRef.current() ; return }
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

  const aceptar = async () => {
    if (ocupado) return
    if (!accion) { onConfirmar(); return }
    setOcupado(true); setError('')
    try { await accion(); onConfirmar() } catch (e) { setError((e && e.message) || 'No se pudo completar la acción.'); setOcupado(false) }
  }

  return createPortal(
    <div className="cf-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onCancelar() }}>
      <div className={'cf-caja cf-' + tono} ref={caja} role="dialog" aria-modal="true" aria-labelledby="cf-titulo" aria-describedby="cf-texto">
        <div className="cf-icono">{icono || IconoAviso}</div>
        <h2 id="cf-titulo" className="cf-titulo">{titulo}</h2>
        <div id="cf-texto" className="cf-texto">{String(texto || '').split('\n').map((p, i) => <p key={i}>{p}</p>)}</div>
        {items.length > 0 && (
          <ul className="cf-lista">
            {items.map((it, i) => { const o = typeof it === 'string' ? { texto: it } : it; return <li key={i}><span className="cf-li-ic">{o.icono || IconoCheck}</span><span>{o.texto}</span></li> })}
          </ul>
        )}
        {error && <div className="cf-error" role="alert">{error}</div>}
        <div className="cf-pie">
          <button type="button" className="cf-btn cf-sec" onClick={onCancelar} disabled={ocupado}>{textoCancelar}</button>
          {textoSecundario && <button type="button" className="cf-btn cf-peli" onClick={() => onConfirmar('otro')} disabled={ocupado}>{textoSecundario}</button>}
          <button type="button" className="cf-btn cf-pri" ref={principal} onClick={aceptar} disabled={ocupado}>{ocupado ? textoOcupado : textoConfirmar}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Uso: const [confirmar, dialogo] = useConfirmar(); ... if (!(await confirmar({ titulo, texto, ... }))) return; ... y render {dialogo}.
export function useConfirmar() {
  const [cfg, setCfg] = useState(null)
  const res = useRef(null)
  const confirmar = useCallback((opts) => new Promise((resolver) => { res.current = resolver; setCfg(opts) }), [])
  const cerrar = (v) => { const r = res.current; res.current = null; setCfg(null); if (r) r(v) }
  const dialogo = cfg ? <Confirmar {...cfg} onConfirmar={(v) => cerrar(v === 'otro' ? 'otro' : true)} onCancelar={() => cerrar(false)} /> : null
  return [confirmar, dialogo]
}
