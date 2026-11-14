import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { ListaCategorias, kb, MAX_BYTES } from './CategoriasPlantillas.jsx'
import { verNombre } from '../lib/nombres.js'
import { NOMBRE_FORMACION, conFormacion } from '../lib/formaciones.js'
import { marcoPlantilla } from '../lib/vista.js'
import DetalleCampos from './DetalleCampos.jsx'

// Panel de una plantilla SUBIDA (la propia, o cualquiera si se revisa): mover a otra categoría, reemplazar el archivo y eliminarla.
// Solo se muestra para plantillas subidas; las del sistema no tienen nada de esto.
export default function PlantillaPropia({ nombre, info, cats, categoriaActual, formacion = '', puedeRevisar = false, onCambio }) {
  const [modo, setModo] = useState('') // '' | mover | reemplazar | eliminar
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [conflicto, setConflicto] = useState(null) // el servidor pidió confirmar: los campos no coinciden con los de la categoría { accion, mensaje, faltan, sobran, referencia }
  // mover
  const [destino, setDestino] = useState('')
  const [soloFormacion, setSoloFormacion] = useState(!!formacion)
  // reemplazar
  const [archivo, setArchivo] = useState(null) // { nombre, bytes, html }
  const [prev, setPrev] = useState({ estado: 'nada' }) // nada | revisando | ok | error
  const [esc, setEsc] = useState(0.2)
  const entrada = useRef(null)
  const marco = useRef(null)

  // al cambiar de plantilla el panel vuelve a su estado de reposo
  useEffect(() => { setModo(''); setError(''); setConflicto(null); setDestino(''); setArchivo(null); setPrev({ estado: 'nada' }) }, [nombre])

  const prioridad = (c) => { const f = ((cats.formaciones || {})[c.id] || []).find((x) => x.formacion === formacion); return f ? f.prioridad : '' }
  const base = cats.categorias.filter((c) => c.id !== categoriaActual)
  const visibles = soloFormacion && formacion ? base.filter((c) => !!prioridad(c)) : base
  const elegido = cats.categorias.find((c) => c.id === destino)

  useEffect(() => {
    if (!archivo) { setPrev({ estado: 'nada' }); return undefined }
    let vigente = true
    setPrev({ estado: 'revisando' })
    api('POST', '/plantillas/subidas/previa', { html: archivo.html, ...(categoriaActual ? { categoria: categoriaActual } : {}) })
      .then((r) => { if (vigente) setPrev({ estado: 'ok', conEjemplo: !!r.conEjemplo, html: r.html || '', esquema: r.esquema || null }) })
      .catch((e) => { if (vigente) setPrev({ estado: 'error', mensaje: e.message || 'No se pudo revisar el archivo.' }) })
    return () => { vigente = false }
  }, [archivo, categoriaActual])
  useEffect(() => {
    const el = marco.current
    if (!el) return undefined
    const medir = () => { const w = el.clientWidth; if (w > 0) setEsc(w / 1280) }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [prev.estado])

  const abrir = (m) => { setError(''); setConflicto(null); setModo(modo === m ? '' : m); setArchivo(null); setDestino('') }
  const cancelar = () => { setModo(''); setError(''); setConflicto(null); setArchivo(null); setDestino('') }
  const esEsquema = (e) => !!(e && e.datos && e.datos.requiereConfirmacion === 'esquema')

  const mover = async (forzar = false) => {
    if (!destino || ocupado) return
    setOcupado(true); setError(''); setConflicto(null)
    try {
      const r = await api('POST', '/plantillas/subidas/' + encodeURIComponent(nombre) + '/mover', { categoria: destino, ...(forzar ? { esquemaDistinto: true } : {}) })
      await onCambio({ tipo: 'mover', nuevo: r && r.nombre, mensaje: 'Plantilla movida' + (r && r.nombre ? ': ' + verNombre(r.nombre) : '') })
      setModo('')
    } catch (e) {
      if (esEsquema(e)) setConflicto({ accion: 'mover', mensaje: e.message, faltan: e.datos.faltan || [], sobran: e.datos.sobran || [], referencia: e.datos.referencia || '' })
      else setError(e.message || 'No se pudo mover la plantilla.')
    }
    setOcupado(false)
  }
  const elegirArchivo = async (f) => {
    if (!f) return
    if (f.size > MAX_BYTES) { setError('El archivo pesa ' + kb(f.size) + ' y el máximo es 1,5 MB.'); return }
    try { setArchivo({ nombre: f.name, bytes: f.size, html: await f.text() }); setError('') } catch { setError('No se pudo leer el archivo.') }
  }
  const distinto = prev.estado === 'ok' && !!prev.esquema && !prev.esquema.coincide
  const reemplazar = async (forzar = false) => {
    if (!archivo || prev.estado !== 'ok' || ocupado) return
    if (distinto && !(puedeRevisar && forzar)) return
    setOcupado(true); setError(''); setConflicto(null)
    try {
      await api('PUT', '/plantillas/subidas/' + encodeURIComponent(nombre), { html: archivo.html, ...(forzar ? { esquemaDistinto: true } : {}) })
      await onCambio({ tipo: 'reemplazar', mensaje: 'Plantilla reemplazada' })
      cancelar()
    } catch (e) {
      if (esEsquema(e)) setConflicto({ accion: 'reemplazar', mensaje: e.message, faltan: e.datos.faltan || [], sobran: e.datos.sobran || [], referencia: e.datos.referencia || '' })
      else setError(e.message || 'No se pudo reemplazar la plantilla.')
    }
    setOcupado(false)
  }
  const eliminar = async () => {
    if (ocupado) return
    setOcupado(true); setError('')
    try {
      await api('DELETE', '/plantillas/subidas/' + encodeURIComponent(nombre))
      await onCambio({ tipo: 'eliminar', mensaje: 'Plantilla eliminada' })
      setModo('')
    } catch (e) { setError(e.message || 'No se pudo eliminar la plantilla.') }
    setOcupado(false)
  }

  const propia = !!(info && info.propia)
  return (
    <div className="card pg-propia">
      <h4>{propia ? 'Esta plantilla la subiste tú' : 'Subida por ' + ((info && info.por) || 'otra persona')}</h4>
      <p className="help">Puedes cambiarla de categoría, reemplazar su archivo o eliminarla. <b>{verNombre(nombre)}</b></p>
      {error && <div className="msg bad" role="alert">{error}</div>}

      <div className="pg-propia-acc">
        <button type="button" className={'btn sec sm' + (modo === 'mover' ? ' act' : '')} disabled={ocupado} aria-expanded={modo === 'mover'} onClick={() => abrir('mover')}>Mover a otra categoría</button>
        <button type="button" className={'btn sec sm' + (modo === 'reemplazar' ? ' act' : '')} disabled={ocupado} aria-expanded={modo === 'reemplazar'} onClick={() => abrir('reemplazar')}>Reemplazar archivo</button>
        <button type="button" className={'btn sec sm peligro' + (modo === 'eliminar' ? ' act' : '')} disabled={ocupado} aria-expanded={modo === 'eliminar'} onClick={() => abrir('eliminar')}>Eliminar</button>
      </div>

      {conflicto && (
        <div className={'pg-conflicto' + (puedeRevisar ? ' amb' : '')} role="alert">
          <b>{puedeRevisar ? 'Los campos no coinciden con los de la categoría' : 'No se puede: los campos no coinciden'}</b>
          <span>{conflicto.mensaje}</span>
          <DetalleCampos faltan={conflicto.faltan} sobran={conflicto.sobran} referencia={conflicto.referencia} abierto />
          {puedeRevisar && <button type="button" className="btn sm" disabled={ocupado} onClick={() => (conflicto.accion === 'mover' ? mover(true) : reemplazar(true))}>Hacerlo de todos modos</button>}
        </div>
      )}

      {modo === 'mover' && (
        <div className="pg-propia-panel">
          <ListaCategorias valor={destino} categorias={visibles} ocupado={ocupado} onChange={setDestino} etiqueta="Categoría de destino" vacio="Elegir categoría…" insignia={soloFormacion && formacion ? prioridad : undefined} />
          {soloFormacion && formacion && <p className="sv-filtro">Solo categorías de {NOMBRE_FORMACION[formacion]}. <button type="button" className="sv-enlace" onClick={() => setSoloFormacion(false)} disabled={ocupado}>Ver todas</button></p>}
          {elegido && <p className="pg-aviso">Cambiará su nombre a <b>{elegido.id}-V##</b>: el número lo asigna el servidor. Su historial de revisión se traslada con ella.</p>}
          <div className="pg-propia-fin">
            <button type="button" className="btn sec sm" disabled={ocupado} onClick={cancelar}>Cancelar</button>
            <button type="button" className="btn sm" disabled={ocupado || !destino} onClick={() => mover(false)}>{ocupado ? 'Moviendo…' : 'Mover'}</button>
          </div>
        </div>
      )}

      {modo === 'reemplazar' && (
        <div className="pg-propia-panel">
          <input ref={entrada} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; elegirArchivo(f) }} />
          <button type="button" className="sv-zona" disabled={ocupado} onClick={() => entrada.current.click()}>
            <b>{archivo ? archivo.nombre : 'Elegir archivo HTML'}</b>
            <span>{archivo ? kb(archivo.bytes) + ' · pulse para cambiarlo' : 'Reemplaza el contenido de ' + verNombre(nombre) + ' · hasta 1,5 MB'}</span>
          </button>
          {prev.estado === 'revisando' && <p className="sv-revisando" role="status"><span className="sv-giro" aria-hidden="true" />Revisando…</p>}
          {prev.estado === 'error' && <div className="msg bad" role="alert">{prev.mensaje}</div>}
          {distinto && (
            <div className={'pg-conflicto' + (puedeRevisar ? ' amb' : '')} role="alert">
              <b>{puedeRevisar ? 'Campos distintos' : 'Campos distintos: no se puede reemplazar'}</b>
              <span>No usa los mismos campos que las demás de {categoriaActual || 'la categoría'}{puedeRevisar ? '. Puede reemplazarla de todos modos.' : '.'}</span>
              <DetalleCampos faltan={prev.esquema.faltan} sobran={prev.esquema.sobran} referencia={prev.esquema.referencia} />
            </div>
          )}
          {prev.estado === 'ok' && (
            <div className="sv-prev">
              <p className={'sv-nota' + (prev.conEjemplo ? '' : ' aviso')}>{prev.conEjemplo ? 'Se muestra con el contenido de ejemplo que trae el archivo.' : 'No trae contenido de ejemplo: se verá vacía en la galería.'}</p>
              <div className="sv-marco" ref={marco}>
                <iframe sandbox="allow-scripts" title="Vista previa del archivo nuevo" srcDoc={conFormacion(prev.html, formacion)} style={marcoPlantilla(esc)} />
              </div>
            </div>
          )}
          <div className="pg-propia-fin">
            <button type="button" className="btn sec sm" disabled={ocupado} onClick={cancelar}>Cancelar</button>
            <button type="button" className="btn sm" disabled={ocupado || !archivo || prev.estado !== 'ok' || (distinto && !puedeRevisar)} onClick={() => reemplazar(distinto)}>{ocupado ? 'Reemplazando…' : distinto ? 'Reemplazar de todos modos' : 'Reemplazar'}</button>
          </div>
        </div>
      )}

      {modo === 'eliminar' && (
        <div className="pg-propia-panel pel" role="alertdialog" aria-label="Confirmar eliminación">
          <p className="pg-aviso mal"><b>Se borra la plantilla; no se puede deshacer.</b> Dejará de ofrecerse a n8n.</p>
          <div className="pg-propia-fin">
            <button type="button" className="btn sec sm" disabled={ocupado} onClick={cancelar}>No</button>
            <button type="button" className="btn danger sm" disabled={ocupado} onClick={eliminar}>{ocupado ? 'Eliminando…' : 'Sí, eliminar'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
