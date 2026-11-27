import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'

// Fase 4: correcciones del guion que el diseñador le pide al docente, por recurso. Aquí el diseñador pide, conversa, cierra o reabre.
// Diseño compacto: una franja delgada (estado + último mensaje + «Ver conversación») y el hilo completo en un panel lateral.
export const textoCorreccion = (c) => (c ? (c.estado === 'abierta' ? 'Corrección pedida' : 'Corregido por el docente: regenere el recurso') : '')
const chipCorr = (c) => (c.estado === 'abierta' ? 'Corrección pedida' : 'Corregido por el docente')

export default function PanelCorreccion({ proyecto, propietario, recurso, onCambio, senal = 0 }) {
  const corr = recurso.correccion || null
  const [hilo, setHilo] = useState(null)
  const [texto, setTexto] = useState('')
  const [pidiendo, setPidiendo] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState(false) // conversación abierta en el panel lateral

  // `senal`: el padre la incrementa para abrir el formulario (los botones de pedir viven en la cabecera y en el aviso de alerta).
  useEffect(() => { if (senal > 0) { setTexto(recurso.alertaActividad || ''); setPidiendo(true) } }, [senal])

  const cargar = useCallback(async () => {
    if (!corr) { setHilo(null); return }
    try {
      const r = await api('GET', '/diseno/correcciones?propietario=' + encodeURIComponent(propietario) + '&proyecto=' + encodeURIComponent(proyecto))
      setHilo((r.correcciones || []).find((x) => x.id === corr.id) || null)
    } catch (e) { setError(e.message || 'No se pudo cargar la corrección.') }
  }, [corr && corr.id, corr && corr.estado, proyecto, propietario])
  useEffect(() => { cargar() }, [cargar])

  const hacer = async (fn, despues) => {
    setOcupado(true); setError('')
    try { await fn(); setTexto(''); despues && despues(); onCambio && (await onCambio()); await cargar() }
    catch (e) { setError(e.message || 'No se pudo completar la acción.') }
    finally { setOcupado(false) }
  }
  const pedir = () => hacer(() => api('POST', '/diseno/correcciones', { propietario, proyecto, recursoId: recurso.id, mensaje: texto.trim() }), () => setPidiendo(false))
  const responder = () => hacer(() => api('POST', '/diseno/correcciones/' + corr.id + '/mensajes', { texto: texto.trim() }))
  const cerrar = () => hacer(() => api('POST', '/diseno/correcciones/' + corr.id + '/cerrar'))
  const reabrir = () => hacer(() => api('POST', '/diseno/correcciones/' + corr.id + '/reabrir', { mensaje: texto.trim() }))

  const msgs = hilo ? hilo.mensajes : []
  const ultimo = msgs.length ? msgs[msgs.length - 1] : null
  const rolDe = (m) => (m.rol === 'docente' ? 'Docente' : 'Diseñador')

  if (!corr) {
    if (!pidiendo && !error) return null
    return (
      <>
        {pidiendo && (
          <CajonLateral titulo="Pedir corrección al docente" onCerrar={() => setPidiendo(false)}>
            <div className="er-corr-form">
              <small className="er-corr-nota">Este recurso no se podrá aprobar ni publicar hasta que el docente corrija el guion y usted cierre la solicitud.</small>
              <textarea rows={6} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Qué debe corregir el docente" placeholder="¿Qué debe corregir el docente en el guion?" />
              {error && <p className="er-msg bad" role="alert"><span>{error}</span></p>}
              <div className="er-corr-bt">
                <button type="button" className="er-b pri" disabled={ocupado || !texto.trim()} onClick={pedir}>{ocupado ? 'Enviando…' : 'Enviar al docente'}</button>
                <button type="button" className="er-b" disabled={ocupado} onClick={() => setPidiendo(false)}>Cancelar</button>
              </div>
            </div>
          </CajonLateral>
        )}
        {error && !pidiendo && <p className="er-msg bad" role="alert"><span>{error}</span></p>}
      </>
    )
  }
  return (
    <>
      <div className={'er-corr ' + corr.estado}>
        <span className={'er-corr-chip ' + corr.estado} title={textoCorreccion(corr)}>{chipCorr(corr)}</span>
        <span className="er-corr-res" title={ultimo ? ultimo.texto : undefined}>{ultimo ? <><b>{rolDe(ultimo)}:</b> {ultimo.texto}</> : 'Sin mensajes todavía'}</span>
        <button type="button" className="er-b er-b-s" onClick={() => setAbierto(true)} aria-haspopup="dialog">Ver conversación ({msgs.length})</button>
      </div>
      {abierto && (
        <CajonLateral titulo="Conversación con el docente" chip={<span className={'er-corr-chip ' + corr.estado}>{chipCorr(corr)}</span>} onCerrar={() => setAbierto(false)}>
          <ul className="er-corr-hilo">
            {msgs.length === 0 && <li className="vacio"><p>Todavía no hay mensajes.</p></li>}
            {msgs.map((m) => <li key={m.id} className={m.rol}><small>{rolDe(m)}{m.autor ? ' · ' + m.autor : ''} · {new Date(m.creado_en).toLocaleString()}</small><p>{m.texto}</p></li>)}
          </ul>
          {corr.estado === 'abierta' && <small className="er-corr-nota">Esperando al docente. El curso está en su revisión: usted solo puede leer.</small>}
          {corr.estado === 'corregida' && <small className="er-corr-nota">El docente marcó la corrección: cierre la solicitud o reábrala con un mensaje, y regenere el recurso.</small>}
          <textarea rows={3} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Mensaje" placeholder={corr.estado === 'corregida' ? 'Mensaje (obligatorio para reabrir)' : 'Escribir una respuesta'} />
          {error && <p className="er-msg bad" role="alert"><span>{error}</span></p>}
          <div className="er-corr-bt">
            <button type="button" className="er-b" disabled={ocupado || !texto.trim()} onClick={responder}>Responder</button>
            {corr.estado === 'corregida' && <button type="button" className="er-b ok" disabled={ocupado} onClick={cerrar} title="La corrección quedó bien: se desbloquea el recurso">Cerrar</button>}
            {corr.estado === 'corregida' && <button type="button" className="er-b" disabled={ocupado || !texto.trim()} onClick={reabrir} title="No quedó bien: vuelve al docente con su mensaje">Reabrir</button>}
          </div>
        </CajonLateral>
      )}
    </>
  )
}

// Panel lateral deslizable (a la derecha, sobre la vista): se cierra con la X, con Esc o con un clic fuera. Esc no cierra el editor.
function CajonLateral({ titulo, chip, onCerrar, children }) {
  const cierre = useRef(null)
  useEffect(() => { cierre.current && cierre.current.focus() }, [])
  return (
    <div className="er-drw-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
      <aside className="er-drw" role="dialog" aria-modal="true" aria-label={titulo} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCerrar() } }}>
        <header className="er-drw-cab">
          <div className="er-drw-tt"><b>{titulo}</b>{chip}</div>
          <button ref={cierre} type="button" className="er-x" onClick={onCerrar} aria-label="Cerrar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </header>
        <div className="er-drw-cuerpo">{children}</div>
      </aside>
    </div>
  )
}
