import { useState } from 'react'
import { api } from '../lib/api.js'
import { RE_DOC } from '../lib/syllabus.js'
import './revisionPlantillas.css'

export const ESTADO = {
  aprobada: { texto: 'Aprobada', clase: 'ok' },
  rechazada: { texto: 'Rechazada', clase: 'bad' },
  revision: { texto: 'En revisión', clase: 'warn' }
}
const fecha = (c) => new Date(c).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

const ACCIONES = [
  ['aprobada', 'Aprobar', 'M5 12.5l4.5 4.5L19 7'],
  ['rechazada', 'Rechazar', 'M6 6l12 12M18 6L6 18'],
  ['revision', 'Mandar a revisión', 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4']
]
const AYUDA = {
  aprobada: 'La plantilla queda aprobada. La observación es opcional.',
  rechazada: 'Explique por qué se rechaza la plantilla.',
  revision: 'Describa qué desea cambiar y pegue el enlace del documento de Google Docs donde detalla los cambios, para que podamos revisarlos.'
}

// Estado de revisión de una plantilla y, para quien puede decidir, los tres botones: aprobar, rechazar o mandar a revisión.
export default function RevisionPlantilla({ plantilla, titulo, historial, puedeRevisar, onNueva, aviso }) {
  const [accion, setAccion] = useState(null)
  const [obs, setObs] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const vigente = historial[0] || null
  const previas = historial.slice(1)

  const abrir = (a) => { setAccion(a); setError('') }
  const cerrar = () => { setAccion(null); setObs(''); setUrl(''); setError('') }

  const enviar = async (e) => {
    e.preventDefault()
    setError('')
    if (accion !== 'aprobada' && obs.trim().length < 3) return setError('Escriba la observación.')
    if (accion === 'revision' && !RE_DOC.test(url.trim())) return setError('Pegue el enlace de un documento de Google Docs con los cambios que desea.')
    setOcupado(true)
    try {
      const r = await api('POST', '/plantillas/revisiones', { plantilla, estado: accion, observacion: obs.trim(), ...(accion === 'revision' ? { docUrl: url.trim() } : {}) })
      onNueva(r)
      aviso && aviso(accion === 'aprobada' ? 'Plantilla aprobada' : accion === 'rechazada' ? 'Plantilla rechazada' : 'Plantilla enviada a revisión')
      cerrar()
    } catch (err) { setError(err.message || 'No se pudo guardar.') }
    setOcupado(false)
  }

  const est = vigente ? vigente.estado : 'nada'
  const ICO = { aprobada: 'M5 12.5l4.5 4.5L19 7', rechazada: 'M6 6l12 12M18 6L6 18', revision: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4', nada: 'M12 8v5M12 16.5v.5' }
  return (
    <section className={'card rv rv-' + est} aria-label="Aprobación de la plantilla">
      <header className="rv-cab">
        <span className="rv-ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={ICO[est]} /></svg></span>
        <div className="rv-cab-tx">
          <h4>Aprobación de la plantilla</h4>
          <p>{vigente ? <>Decisión más reciente sobre «{titulo}»</> : <>Todavía nadie ha revisado «{titulo}»</>}</p>
        </div>
        <span className={'rv-estado-pill ' + est} aria-live="polite">{vigente ? ESTADO[vigente.estado].texto : 'Sin revisar'}</span>
      </header>

      <div className={'rv-cuerpo' + (puedeRevisar && !accion ? ' con-acc' : '')}>
        <div className="rv-info">
          {vigente && <p className="rv-quien"><b>{vigente.usuario}</b><span>{fecha(vigente.creado)}</span></p>}
          {vigente && vigente.observacion && <p className="rv-obs">{vigente.observacion}</p>}
          {vigente && vigente.docUrl && <a className="rv-doc" href={vigente.docUrl} target="_blank" rel="noopener noreferrer">Ver el documento de cambios ↗</a>}
          {!vigente && <p className="rv-vacio">Revise la vista previa y decida si la plantilla se aprueba, se rechaza o necesita cambios.</p>}
        </div>

        {puedeRevisar && !accion && (
          <div className="rv-acciones" role="group" aria-label={'Decidir sobre ' + titulo}>
            {ACCIONES.map(([a, t, d]) => (
              <button key={a} type="button" className={'rv-b ' + a} onClick={() => abrir(a)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>{t}
              </button>
            ))}
          </div>
        )}
      </div>

      {puedeRevisar && accion && (
        <form className="rv-form" onSubmit={enviar} noValidate>
          <b className={'rv-tit ' + accion}>{ACCIONES.find(([a]) => a === accion)[1]}</b>
          <p className="help">{AYUDA[accion]}</p>
          <label className="l" htmlFor="rv-obs">Observación{accion === 'aprobada' ? ' (opcional)' : ''}</label>
          <textarea id="rv-obs" rows={4} maxLength={2000} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Escriba aquí su observación sobre la plantilla" autoFocus />
          {accion === 'revision' && (
            <>
              <label className="l" htmlFor="rv-url">Documento de Google Docs con los cambios</label>
              <input id="rv-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/document/d/..." autoComplete="off" />
              <p className="help">Compártalo para que cualquiera con el enlace pueda verlo.</p>
            </>
          )}
          {error && <div className="msg bad" role="alert">{error}</div>}
          <div className="rv-pie">
            <button className="btn" type="submit" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Confirmar'}</button>
            <button className="btn sec" type="button" onClick={cerrar} disabled={ocupado}>Cancelar</button>
          </div>
        </form>
      )}

      {previas.length > 0 && (
        <details className="rv-hist">
          <summary>Historial ({previas.length})</summary>
          <ul>
            {previas.map((h) => (
              <li key={h.id}>
                <span className={'pill ' + ESTADO[h.estado].clase}>{ESTADO[h.estado].texto}</span> <small>{h.usuario} · {fecha(h.creado)}</small>
                {h.observacion && <p>{h.observacion}</p>}
                {h.docUrl && <a href={h.docUrl} target="_blank" rel="noopener noreferrer">Documento de cambios ↗</a>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
