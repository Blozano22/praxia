import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import './solicitudes-diseno.css'

// Fase 4 (docente): «Cursos aprobados» (los que envió a diseño) y «Solicitudes de revisión» (lo que el diseñador pide corregir en los guiones).
const ESTADO_CURSO = { en_diseno: 'En diseño, sin asignar', asignado: 'Asignado' }
const ESTADO_CORR = { abierta: 'Pendiente', corregida: 'Corregida' }

function Solicitud({ c, onCambio }) {
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const hacer = async (fn) => {
    setOcupado(true); setError('')
    try { await fn(); setTexto(''); await onCambio() } catch (e) { setError(e.message || 'No se pudo completar la acción.') } finally { setOcupado(false) }
  }
  return (
    <li className="sd-corr">
      <div className="sd-corr-cab"><b>{c.codigo || c.recurso_id}</b><span>{c.titulo || ''}</span><span className={'pill ' + (c.estado === 'abierta' ? 'warn' : 'ok')}>{ESTADO_CORR[c.estado] || c.estado}</span></div>
      <ul className="sd-hilo">{c.mensajes.map((m) => <li key={m.id} className={m.rol}><small>{m.rol === 'docente' ? 'Usted' : 'Diseñador'}{m.autor && m.rol !== 'docente' ? ' · ' + m.autor : ''} · {new Date(m.creado_en).toLocaleString()}</small><p>{m.texto}</p></li>)}</ul>
      <textarea rows={2} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribir una respuesta" aria-label="Respuesta al diseñador" />
      <div className="sd-bt">
        <button type="button" className="btn sm" disabled={ocupado || !texto.trim()} onClick={() => hacer(() => api('POST', '/diseno/correcciones/' + c.id + '/mensajes', { texto: texto.trim() }))}>Responder</button>
        {c.estado === 'abierta' && <button type="button" className="btn sm gold" disabled={ocupado} onClick={() => hacer(() => api('POST', '/diseno/correcciones/' + c.id + '/corregida', texto.trim() ? { mensaje: texto.trim() } : {}))}>Marcar como corregido</button>}
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}
    </li>
  )
}

export default function SolicitudesDiseno({ lista, diseno, onAbrir, onCambio }) {
  const [corr, setCorr] = useState([])
  const [error, setError] = useState('')
  const cargar = useCallback(async () => {
    try { setCorr(((await api('GET', '/diseno/correcciones')) || {}).correcciones || []) } catch { /* sin datos: no se muestra */ }
    onCambio && onCambio()
  }, [onCambio])
  useEffect(() => { cargar() }, [cargar, lista.length])

  const conSolicitud = (s) => diseno[s.id] && (diseno[s.id].estado === 'en_revision_docente' || corr.some((c) => c.proyecto_id === s.id)) // el curso sigue «asignado»: solo se bloquea el recurso
  const aprobados = lista.filter((s) => diseno[s.id] && ['en_diseno', 'asignado'].includes(diseno[s.id].estado) && !conSolicitud(s))
  const revision = lista.filter(conSolicitud)
  if (!aprobados.length && !revision.length) return null
  return (
    <>
      {aprobados.length > 0 && (
        <section className="sd-sec" aria-label="Cursos aprobados">
          <h2>Cursos aprobados</h2>
          <ul className="sd-lista">
            {aprobados.map((s) => (
              <li key={s.id}><b>{s.curso}</b><span>{s.programa}</span><span className="pill">{ESTADO_CURSO[diseno[s.id].estado]}</span>{diseno[s.id].disenador && <small>Diseñador: {diseno[s.id].disenador}</small>}</li>
            ))}
          </ul>
        </section>
      )}
      {revision.length > 0 && (
        <section className="sd-sec" aria-label="Solicitudes de revisión">
          <h2>Solicitudes de revisión</h2>
          {error && <div className="msg err" role="alert">{error}</div>}
          {revision.map((s) => {
            const mias = corr.filter((c) => c.proyecto_id === s.id)
            const abiertas = mias.filter((c) => c.estado === 'abierta').length
            return (
              <div className="sd-curso" key={s.id}>
                <div className="sd-curso-cab">
                  <b>{s.curso}</b>{diseno[s.id].disenador && <small>Diseñador: {diseno[s.id].disenador}</small>}
                  <button type="button" className="btn sm sd-izq" onClick={() => onAbrir(s.id)} title="Abrir el curso para corregir los guiones">Abrir el curso</button>
                </div>
                {abiertas > 0 && <small>{abiertas} {abiertas === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}: corrija el guion y márquela como corregida.</small>}
                <ul className="sd-lista-corr">{mias.map((c) => <Solicitud key={c.id} c={c} onCambio={cargar} />)}</ul>
              </div>
            )
          })}
        </section>
      )}
    </>
  )
}
