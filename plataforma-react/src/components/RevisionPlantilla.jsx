import { useState } from 'react'
import { api } from '../lib/api.js'
import { RE_DOC } from '../lib/syllabus.js'
import './revisionPlantillas.css'

export const ESTADO = {
  aprobada: { texto: 'Aprobada', clase: 'ok' },
  rechazada: { texto: 'Rechazada', clase: 'bad' },
  revision: { texto: 'En revisión', clase: 'warn' },
  corregida: { texto: 'Corregida', clase: 'info' }
}
const fecha = (c) => new Date(c).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })

const ACCIONES = [
  ['aprobada', 'Aprobar', 'M5 12.5l4.5 4.5L19 7'],
  ['rechazada', 'Rechazar', 'M6 6l12 12M18 6L6 18'],
  ['revision', 'Mandar a revisión', 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4']
]
const ACCION_CORREGIDA = ['corregida', 'Marcar como corregida', 'M3 12.5l4 4L15 8M10 16.5l1 1L21 8']
const ACCION_EDITAR = ['editar', 'Editar mi envío', 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4']
const TITULO_FORM = { aprobada: 'Aprobar', rechazada: 'Rechazar', revision: 'Mandar a revisión', corregida: 'Marcar como corregida', editar: 'Editar mi envío' }
const AYUDA = {
  aprobada: 'La plantilla queda aprobada. La observación es opcional.',
  rechazada: 'Explique por qué se rechaza la plantilla.',
  revision: 'Describa qué desea cambiar y pegue el enlace del documento de Google Docs donde detalla los cambios, para que podamos revisarlos.',
  corregida: 'Indica que los cambios pedidos ya están hechos: el diseñador volverá a revisar la plantilla. Puede contar qué se corrigió (opcional).',
  editar: 'Corrija lo que envió. Quedará marcado como editado, con su nombre y la hora de la última edición.'
}
const VERBO = { revision: 'envió la solicitud de revisión', corregida: 'marcó como corregida', aprobada: 'aprobó', rechazada: 'rechazó' }
const SUBTITULO = {
  nada: (t) => <>Todavía nadie ha revisado «{t}»</>,
  revision: (t) => <>Cambios solicitados sobre «{t}»: falta que el administrador los corrija</>,
  corregida: (t) => <>«{t}» fue corregida: el diseñador debe verificar los cambios</>,
  aprobada: (t) => <>Decisión más reciente sobre «{t}»</>,
  rechazada: (t) => <>Decisión más reciente sobre «{t}»</>
}
const ICO = { aprobada: 'M5 12.5l4.5 4.5L19 7', rechazada: 'M6 6l12 12M18 6L6 18', revision: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4', corregida: ACCION_CORREGIDA[2], nada: 'M12 8v5M12 16.5v.5' }

// Quién hizo el paso, en calidad de qué y cuándo; si se editó, quién lo editó y cuándo fue la última edición.
function Autoria({ h, clase = 'rv-quien' }) {
  return (
    <>
      <p className={clase}>
        <b>{h.usuario}</b> {VERBO[h.estado]}
        {h.estado !== 'corregida' && h.rol === 'administrador' && <em className="rv-rol" title="Esta decisión corresponde al diseñador; la tomó un administrador">como administrador</em>}
        <span>{fecha(h.creado)}</span>
      </p>
      {h.editadoEn && <p className="rv-editada"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>Editada por <b>{h.editadoPor}</b> · última edición {fecha(h.editadoEn)}</p>}
    </>
  )
}

// Estado de revisión de una plantilla y el ciclo diseñador ↔ administrador:
//  el diseñador aprueba, rechaza o manda a revisión (y puede editar lo que envió); el administrador marca como corregida la solicitud
//  para que el diseñador la verifique; y así hasta que el diseñador la aprueba. Hay alertas al cambiar una decisión ya tomada y cuando
//  un administrador toma una decisión que corresponde al diseñador.
export default function RevisionPlantilla({ plantilla, titulo, historial, puedeRevisar, puedeCorregir, yo, onNueva, onEditada, aviso }) {
  const [accion, setAccion] = useState(null) // aprobada | rechazada | revision | corregida | editar
  const [obs, setObs] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [forzar, setForzar] = useState({ admin: false, cambio: false }) // el servidor pidió una confirmación que la pantalla no había mostrado
  const vigente = historial[0] || null
  const previas = historial.slice(1)
  const est = vigente ? vigente.estado : 'nada'

  // En calidad de qué actúa esta persona: diseñador si tiene ese rol; si no, administrador.
  const comoAdmin = !(yo && yo.roles && yo.roles.includes('disenador'))
  const esMia = !!(vigente && yo && vigente.usuarioId === yo.id)
  const puedeEditar = esMia && ((vigente.estado === 'revision' && puedeRevisar) || (vigente.estado === 'corregida' && puedeCorregir))
  const puedeMarcar = puedeCorregir && est === 'revision'

  const decide = ['aprobada', 'rechazada', 'revision'].includes(accion)
  const avisoAdmin = decide && comoAdmin
  const avisoCambio = decide && vigente && (vigente.estado === 'aprobada' || vigente.estado === 'rechazada')

  const abrir = (a) => {
    setAccion(a); setError(''); setForzar({ admin: false, cambio: false })
    if (a === 'editar') { setObs(vigente.observacion || ''); setUrl(vigente.docUrl || '') } else { setObs(''); setUrl('') }
  }
  const cerrar = () => { setAccion(null); setObs(''); setUrl(''); setError(''); setForzar({ admin: false, cambio: false }) }

  const enviar = async (e) => {
    e.preventDefault()
    setError('')
    const necesitaObs = accion === 'rechazada' || accion === 'revision' || (accion === 'editar' && vigente.estado === 'revision')
    const necesitaDoc = accion === 'revision' || (accion === 'editar' && vigente.estado === 'revision')
    if (necesitaObs && obs.trim().length < 3) return setError('Escriba la observación.')
    if (necesitaDoc && !RE_DOC.test(url.trim())) return setError('Pegue el enlace de un documento de Google Docs con los cambios que desea.')
    setOcupado(true)
    try {
      if (accion === 'editar') {
        const r = await api('PATCH', '/plantillas/revisiones/' + vigente.id, { observacion: obs.trim(), ...(vigente.estado === 'revision' ? { docUrl: url.trim() } : {}) })
        onEditada(r)
        aviso && aviso('Cambios guardados: quedó marcada como editada')
      } else {
        const r = await api('POST', '/plantillas/revisiones', {
          plantilla, estado: accion, observacion: obs.trim(), ...(accion === 'revision' ? { docUrl: url.trim() } : {}),
          ...(avisoAdmin || forzar.admin ? { confirmadoAdmin: true } : {}), ...(avisoCambio || forzar.cambio ? { confirmadoCambio: true } : {})
        })
        onNueva(r)
        aviso && aviso({ aprobada: 'Plantilla aprobada', rechazada: 'Plantilla rechazada', revision: 'Plantilla enviada a revisión', corregida: 'Marcada como corregida: el diseñador la verificará' }[accion])
      }
      cerrar()
    } catch (err) {
      const pide = err && err.datos && err.datos.requiereConfirmacion // otra persona cambió algo mientras tanto: se muestra el aviso y se vuelve a confirmar
      if (pide) setForzar((f) => ({ ...f, [pide]: true }))
      setError(err.message || 'No se pudo guardar.')
    }
    setOcupado(false)
  }

  const mostrarAdmin = avisoAdmin || forzar.admin
  const mostrarCambio = avisoCambio || forzar.cambio
  const hayAvisos = mostrarAdmin || mostrarCambio
  return (
    <section className={'card rv rv-' + est} aria-label="Aprobación de la plantilla">
      <header className="rv-cab">
        <span className="rv-ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={ICO[est]} /></svg></span>
        <div className="rv-cab-tx">
          <h4>Aprobación de la plantilla</h4>
          <p>{SUBTITULO[est](titulo)}</p>
        </div>
        <span className={'rv-estado-pill ' + est} aria-live="polite">{vigente ? ESTADO[vigente.estado].texto : 'Sin revisar'}</span>
      </header>

      <div className={'rv-cuerpo' + ((puedeRevisar || puedeMarcar) && !accion ? ' con-acc' : '')}>
        <div className="rv-info">
          {vigente && <Autoria h={vigente} />}
          {vigente && vigente.observacion && <p className="rv-obs">{vigente.observacion}</p>}
          {vigente && vigente.docUrl && <a className="rv-doc" href={vigente.docUrl} target="_blank" rel="noopener noreferrer">Ver el documento de cambios ↗</a>}
          {est === 'revision' && <p className="rv-sig">Pendiente: un administrador debe aplicar los cambios y marcar la solicitud como corregida.</p>}
          {est === 'corregida' && <p className="rv-sig">Pendiente: el diseñador debe revisar los cambios. Si ya están bien, la aprueba; si falta algo, vuelve a mandarla a revisión.</p>}
          {!vigente && <p className="rv-vacio">Revise la vista previa y decida si la plantilla se aprueba, se rechaza o necesita cambios.</p>}
        </div>

        {(puedeRevisar || puedeMarcar) && !accion && (
          <div className="rv-acciones" role="group" aria-label={'Acciones sobre ' + titulo}>
            {puedeMarcar && (
              <button type="button" className="rv-b corregida" onClick={() => abrir('corregida')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ACCION_CORREGIDA[2]} /></svg>{ACCION_CORREGIDA[1]}
              </button>
            )}
            {puedeRevisar && ACCIONES.map(([a, t, d]) => (
              <button key={a} type="button" className={'rv-b ' + a} onClick={() => abrir(a)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>{t}
              </button>
            ))}
            {puedeEditar && (
              <button type="button" className="rv-b editar" onClick={() => abrir('editar')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ACCION_EDITAR[2]} /></svg>{ACCION_EDITAR[1]}
              </button>
            )}
          </div>
        )}
      </div>

      {accion && (
        <form className="rv-form" onSubmit={enviar} noValidate>
          <b className={'rv-tit ' + (accion === 'editar' ? 'revision' : accion)}>{TITULO_FORM[accion]}</b>
          <p className="help">{AYUDA[accion]}</p>
          {mostrarCambio && (
            <div className="msg warn rv-alerta" role="alert">
              <b>Esta plantilla ya está {vigente.estado === 'aprobada' ? 'aprobada' : 'rechazada'}.</b> Decidida por {vigente.usuario} el {fecha(vigente.creado)}; si continúa, cambia ese estado.
            </div>
          )}
          {mostrarAdmin && (
            <div className="msg warn rv-alerta" role="alert">
              <b>Esto lo debe hacer el diseñador.</b> Aprobar, rechazar o pedir cambios en una plantilla le corresponde al diseñador. Si continúa, quedará registrado que lo hizo usted, como administrador.
            </div>
          )}
          <label className="l" htmlFor="rv-obs">Observación{accion === 'aprobada' || accion === 'corregida' || (accion === 'editar' && vigente.estado === 'corregida') ? ' (opcional)' : ''}</label>
          <textarea id="rv-obs" rows={4} maxLength={2000} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Escriba aquí su observación sobre la plantilla" autoFocus />
          {(accion === 'revision' || (accion === 'editar' && vigente.estado === 'revision')) && (
            <>
              <label className="l" htmlFor="rv-url">Documento de Google Docs con los cambios</label>
              <input id="rv-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/document/d/..." autoComplete="off" />
              <p className="help">Compártalo para que cualquiera con el enlace pueda verlo.</p>
            </>
          )}
          {error && <div className="msg bad" role="alert">{error}</div>}
          <div className="rv-pie">
            <button className="btn" type="submit" disabled={ocupado}>{ocupado ? 'Guardando…' : hayAvisos ? 'Entiendo, continuar' : accion === 'editar' ? 'Guardar cambios' : 'Confirmar'}</button>
            <button className="btn sec" type="button" onClick={cerrar} disabled={ocupado}>Cancelar</button>
          </div>
        </form>
      )}

      {previas.length > 0 && (
        <details className="rv-hist">
          <summary>Historial de decisiones <span>{previas.length}</span></summary>
          <p className="rv-hist-nota">De la más antigua a la más reciente.</p>
          <ol className="rv-linea">
            {previas.slice().reverse().map((h, i) => (
              <li key={h.id} className={'rv-pt ' + h.estado}>
                <span className="rv-pt-dot" aria-hidden="true">{i + 1}</span>
                <div className="rv-pt-card">
                  <div className="rv-pt-cab">
                    <span className={'pill ' + ESTADO[h.estado].clase}>{ESTADO[h.estado].texto}</span>
                    <Autoria h={h} clase="rv-pt-quien" />
                  </div>
                  {h.observacion && <p className="rv-pt-obs">{h.observacion}</p>}
                  {h.docUrl && <a className="rv-pt-doc" href={h.docUrl} target="_blank" rel="noopener noreferrer">Documento de cambios ↗</a>}
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}
