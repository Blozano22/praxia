import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'

// Fase 4: correcciones del guion que el diseñador le pide al docente, por recurso. Aquí el diseñador pide, conversa, cierra o reabre.
export const textoCorreccion = (c) => (c ? (c.estado === 'abierta' ? 'Corrección pedida' : 'Corregido por el docente: regenere el recurso') : '')

export default function PanelCorreccion({ proyecto, propietario, recurso, onCambio }) {
  const corr = recurso.correccion || null
  const [hilo, setHilo] = useState(null)
  const [texto, setTexto] = useState('')
  const [pidiendo, setPidiendo] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

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

  if (!corr) {
    return (
      <div className="er-corr">
        {!pidiendo && <button type="button" className="er-b" onClick={() => { setTexto(recurso.alertaActividad || ''); setPidiendo(true) }} title="El problema depende del guion: se lo envía al docente y este recurso queda bloqueado hasta que lo resuelva">Pedir corrección al docente</button>}
        {pidiendo && (
          <div className="er-corr-form" role="dialog" aria-label="Pedir corrección al docente">
            <b>Pedir corrección al docente</b>
            <small>Este recurso no se podrá aprobar ni publicar hasta que el docente corrija el guion y usted cierre la solicitud.</small>
            <textarea rows={4} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="¿Qué debe corregir el docente en el guion?" />
            <div className="er-corr-bt">
              <button type="button" className="er-b pri" disabled={ocupado || !texto.trim()} onClick={pedir}>{ocupado ? 'Enviando…' : 'Enviar al docente'}</button>
              <button type="button" className="er-b" disabled={ocupado} onClick={() => setPidiendo(false)}>Cancelar</button>
            </div>
          </div>
        )}
        {error && <p className="er-msg bad" role="alert"><span>{error}</span></p>}
      </div>
    )
  }
  return (
    <div className={'er-corr ' + corr.estado}>
      <b>Corrección · {textoCorreccion(corr)}</b>
      <ul className="er-corr-hilo">
        {(hilo ? hilo.mensajes : []).map((m) => <li key={m.id} className={m.rol}><small>{m.rol === 'docente' ? 'Docente' : 'Diseñador'}{m.autor ? ' · ' + m.autor : ''} · {new Date(m.creado_en).toLocaleString()}</small><p>{m.texto}</p></li>)}
      </ul>
      <textarea rows={2} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={corr.estado === 'corregida' ? 'Mensaje (obligatorio para reabrir)' : 'Escribir una respuesta'} />
      <div className="er-corr-bt">
        <button type="button" className="er-b" disabled={ocupado || !texto.trim()} onClick={responder}>Responder</button>
        {corr.estado === 'corregida' && <button type="button" className="er-b ok" disabled={ocupado} onClick={cerrar} title="La corrección quedó bien: se desbloquea el recurso">Cerrar</button>}
        {corr.estado === 'corregida' && <button type="button" className="er-b" disabled={ocupado || !texto.trim()} onClick={reabrir} title="No quedó bien: vuelve al docente con su mensaje">Reabrir</button>}
      </div>
      {corr.estado === 'abierta' && <small>Esperando al docente. El curso está en su revisión: usted solo puede leer.</small>}
      {error && <p className="er-msg bad" role="alert"><span>{error}</span></p>}
    </div>
  )
}
