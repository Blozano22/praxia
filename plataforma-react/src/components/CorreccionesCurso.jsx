import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import './solicitudes-diseno.css'
import './correcciones-curso.css'

// El docente, dentro de su curso: las correcciones que le pidió el diseñador, en un panel lateral (hilo, respuesta y «Marcar como corregido»).
// Mismas llamadas que «Solicitudes de revisión» del Dashboard (SolicitudesDiseno.jsx).
const ESTADO_CORR = { abierta: 'Pendiente', corregida: 'Corregida' }

function Correccion({ c, onCambio }) {
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const hacer = async (fn) => {
    setOcupado(true); setError('')
    try { await fn(); setTexto(''); await onCambio() } catch (e) { setError(e.message || 'No se pudo completar la acción.') } finally { setOcupado(false) }
  }
  return (
    <li className="sd-corr cc-item">
      <div className="cc-cab"><b>{c.codigo || c.recurso_id}</b><span>{c.titulo || ''}</span><span className={'pill ' + (c.estado === 'abierta' ? 'warn' : 'ok')}>{ESTADO_CORR[c.estado] || c.estado}</span></div>
      <ul className="sd-hilo">{c.mensajes.map((m) => <li key={m.id} className={m.rol}><small>{m.rol === 'docente' ? 'Usted' : 'Diseñador'}{m.autor && m.rol !== 'docente' ? ' · ' + m.autor : ''} · {new Date(m.creado_en).toLocaleString()}</small><p>{m.texto}</p></li>)}</ul>
      <textarea rows={2} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribir una respuesta" aria-label={'Respuesta al diseñador sobre ' + (c.codigo || c.recurso_id)} />
      <div className="sd-bt">
        <button type="button" className="btn sm" disabled={ocupado || !texto.trim()} onClick={() => hacer(() => api('POST', '/diseno/correcciones/' + c.id + '/mensajes', { texto: texto.trim() }))}>Responder</button>
        {c.estado === 'abierta' && <button type="button" className="btn sm gold" disabled={ocupado} onClick={() => hacer(() => api('POST', '/diseno/correcciones/' + c.id + '/corregida', texto.trim() ? { mensaje: texto.trim() } : {}))}>Marcar como corregido</button>}
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}
    </li>
  )
}

// Botón «Correcciones (N)» + panel lateral. Solo se muestra si el curso tiene correcciones.
export default function CorreccionesCurso({ proyecto, refrescar = 0, onCambio }) {
  const [lista, setLista] = useState([])
  const [abierto, setAbierto] = useState(false)
  const cierre = useRef(null)
  const cargar = useCallback(async () => {
    try { setLista(((await api('GET', '/diseno/correcciones?proyecto=' + encodeURIComponent(proyecto))) || {}).correcciones || []) } catch { /* sin datos: no se muestra */ }
  }, [proyecto])
  useEffect(() => { cargar() }, [cargar, refrescar])
  useEffect(() => { if (abierto && cierre.current) cierre.current.focus() }, [abierto])
  if (!lista.length) return null
  const abiertas = lista.filter((c) => c.estado === 'abierta').length
  const alCambiar = async () => { await cargar(); onCambio && onCambio() }
  return (
    <>
      <button type="button" className="btn sm sec cc-btn" aria-haspopup="dialog" onClick={() => setAbierto(true)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
        Correcciones ({abiertas})
      </button>
      {abierto && (
        <div className="cc-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) setAbierto(false) }}>
          <aside className="cc-drw" role="dialog" aria-modal="true" aria-label="Correcciones del curso" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAbierto(false) } }}>
            <header className="cc-drw-cab">
              <div><b>Correcciones del curso</b><small>{abiertas === 0 ? 'No hay correcciones pendientes' : abiertas + (abiertas === 1 ? ' pendiente' : ' pendientes')}</small></div>
              <button ref={cierre} type="button" className="cc-x" onClick={() => setAbierto(false)} aria-label="Cerrar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </header>
            <ul className="cc-lista">{lista.map((c) => <Correccion key={c.id} c={c} onCambio={alCambiar} />)}</ul>
          </aside>
        </div>
      )}
    </>
  )
}
