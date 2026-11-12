import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import './matrices.css'

// Paso «Matrices y H5P» del curso: muestra lo que n8n AVISÓ a Praxia (la matriz de cada unidad, sus recursos y las corridas de H5P).
// Lee solo de Praxia (GET /api/proyectos/:id/pipeline); no consulta a n8n ni a Google. Se refresca solo mientras haya algo en proceso.

const MATRIZ = {
  generando: ['warn', 'Generando la matriz…'],
  creada: ['ok', 'Matriz creada'],
  omitida: ['ok', 'Matriz ya existente'],
  reemplazada: ['ok', 'Matriz regenerada'],
  error: ['bad', 'Error al crear la matriz']
}
const SIN_RESPUESTA = ['bad', 'Sin respuesta de n8n']
const RECURSO = { PENDIENTE: ['', 'Pendiente'], EN_PROCESO: ['warn', 'En proceso'], GENERADO: ['ok', 'Generado'], ERROR: ['bad', 'Error'] }
// Por qué una corrida de H5P dejó fuera un recurso (lo dice n8n en el plan).
const MOTIVO = {
  sin_plantilla: 'Todavía no hay una plantilla H5P para este tipo de recurso',
  generador_no_h5p: 'Lo genera otro generador (por ejemplo, Videos), no H5P',
  estado_no_pendiente: 'Ya estaba generado o en proceso',
  tipo_inactivo: 'Este tipo de recurso está desactivado',
  supera_maximo: 'Superó el máximo de recursos de la corrida'
}
const motivoTexto = (m) => MOTIVO[m] || String(m || '').replace(/_/g, ' ')
const fecha = (c) => (c ? new Date(c).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const hace = (c) => {
  if (!c) return ''
  const s = Math.max(0, Math.round((Date.now() - new Date(c).getTime()) / 1000))
  if (s < 60) return 'hace unos segundos'
  if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min'
  if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h'
  return fecha(c)
}

function Pill({ par }) { return <span className={'pill ' + par[0]}>{par[1]}</span> }

function Corrida({ e }) {
  const omitidas = e.plan ? e.plan.omitidas : []
  const r = e.resumen
  return (
    <section className="card mx-corrida" aria-label="Última corrida de H5P">
      <div className="mx-corrida-cab">
        <div>
          <h3>Última corrida de H5P</h3>
          <p className="help">{e.estado === 'en_curso' ? (e.sinRespuesta ? 'n8n no avisa desde ' + hace(e.ultimoEventoEn) + ': puede haberse interrumpido' : 'En curso · último aviso ' + hace(e.ultimoEventoEn)) : 'Terminada ' + fecha(e.terminadoEn || e.ultimoEventoEn)}{e.maximo ? ' · máximo ' + e.maximo + ' recursos' : ''}</p>
        </div>
        <Pill par={e.estado === 'en_curso' ? (e.sinRespuesta ? SIN_RESPUESTA : ['warn', 'En curso']) : ['ok', 'Terminada']} />
      </div>
      <div className="mx-cifras">
        {e.plan && <div><b>{e.plan.aGenerar}</b><span>a generar</span></div>}
        {r && <div className="g"><b>{r.generados ?? 0}</b><span>generados</span></div>}
        {r && <div className={r.errores ? 'r' : ''}><b>{r.errores ?? 0}</b><span>con error</span></div>}
        <div><b>{omitidas.length || (r ? r.omitidos ?? 0 : 0)}</b><span>omitidos</span></div>
        {r && r.pendientes_restantes != null && <div><b>{r.pendientes_restantes}</b><span>pendientes</span></div>}
      </div>
      {omitidas.length > 0 && (
        <details className="mx-omitidas">
          <summary>Qué se omitió y por qué ({omitidas.length})</summary>
          <ul>{omitidas.map((o) => <li key={o.id}><b>{o.codigo || o.id}</b><span>{motivoTexto(o.motivo)}</span></li>)}</ul>
        </details>
      )}
    </section>
  )
}

function Unidad({ unidad, nombre, matriz, recursos }) {
  const conteo = useMemo(() => {
    const c = { total: recursos.length, PENDIENTE: 0, EN_PROCESO: 0, GENERADO: 0, ERROR: 0, h5p: 0, otros: 0 }
    recursos.forEach((r) => { c[r.estado] = (c[r.estado] || 0) + 1; if (String(r.generador || '').toUpperCase() === 'H5P') c.h5p++; else c.otros++ })
    return c
  }, [recursos])
  const pct = conteo.total ? Math.round((conteo.GENERADO / conteo.total) * 100) : 0
  const clase = !matriz ? 'sin' : matriz.estado === 'error' || matriz.sinRespuesta ? 'bad' : matriz.estado === 'generando' || conteo.EN_PROCESO ? 'en' : conteo.total && conteo.GENERADO === conteo.total ? 'ok' : 'pe'
  return (
    <article className={'card mx-uni mx-' + clase}>
      <header className="mx-uni-cab">
        <span className="mx-n">{unidad}</span>
        <div className="mx-uni-tit">
          <h3>Unidad {unidad}</h3>
          <small>{nombre}</small>
        </div>
        <Pill par={matriz ? (matriz.sinRespuesta ? SIN_RESPUESTA : MATRIZ[matriz.estado]) : ['', 'Sin matriz']} />
      </header>

      {!matriz && <p className="mx-vacio">Todavía no hay una matriz registrada para esta unidad. Se crea sola cuando terminan los guiones y, apenas n8n lo avise, aparecerá aquí.</p>}

      {matriz && (
        <div className="mx-matriz">
          <div className="mx-matriz-datos">
            {matriz.formacion && <span><b>Formación</b>{matriz.formacion}</span>}
            <span><b>Actualizada</b>{hace(matriz.actualizadoEn)}</span>
            {matriz.matrizNombre && <span title={matriz.matrizNombre}><b>Hoja</b>{matriz.matrizNombre}</span>}
          </div>
          {matriz.matrizUrl && <a className="btn sec sm" href={matriz.matrizUrl} target="_blank" rel="noopener noreferrer">Abrir la matriz ↗</a>}
        </div>
      )}
      {matriz && matriz.sinRespuesta && <p className="mx-detalle mal">n8n empezó a generar esta matriz {hace(matriz.actualizadoEn)} y no ha vuelto a avisar. Puede haberse interrumpido.</p>}
      {matriz && matriz.detalle && <p className={'mx-detalle' + (matriz.estado === 'error' ? ' mal' : '')}>{matriz.detalle}</p>}

      {conteo.total > 0 && (
        <>
          <div className="mx-cifras">
            <div><b>{conteo.total}</b><span>recursos</span></div>
            <div className="g"><b>{conteo.GENERADO}</b><span>generados</span></div>
            <div><b>{conteo.PENDIENTE + conteo.EN_PROCESO}</b><span>por generar</span></div>
            <div className={conteo.ERROR ? 'r' : ''}><b>{conteo.ERROR}</b><span>con error</span></div>
          </div>
          <div className="mx-barra" aria-label={pct + '% generado'}><i style={{ width: pct + '%' }} /></div>
          <details className="mx-filas-det" open={conteo.total <= 12}>
            <summary>Recursos de la matriz ({conteo.total}) · H5P {conteo.h5p}{conteo.otros ? ' · otros ' + conteo.otros : ''}</summary>
            <ul className="mx-filas">
              {recursos.map((r) => (
                <li key={r.id} className={'mx-fila ' + String(r.estado).toLowerCase()}>
                  <div className="mx-fila-cab">
                    <b>{r.codigo || r.id}</b>
                    <span className="mx-fila-tit">{r.titulo || 'Sin título'}</span>
                    <Pill par={r.sinRespuesta ? ['bad', 'Sin avisos'] : RECURSO[r.estado] || ['', r.estado]} />
                  </div>
                  <div className="mx-fila-meta">
                    {r.formato && <span>{r.formato}</span>}
                    {r.generador && <span className="mx-gen">{r.generador}</span>}
                    {r.enlaceGuion && <a href={r.enlaceGuion} target="_blank" rel="noopener noreferrer">Guion ↗</a>}
                    {r.enlaceRecurso && <a className="mx-rec" href={r.enlaceRecurso} target="_blank" rel="noopener noreferrer">Recurso ↗</a>}
                  </div>
                  {r.estado === 'ERROR' && r.observaciones && <p className="mx-fila-nota mal">{r.observaciones}</p>}
                  {r.estado !== 'ERROR' && r.observaciones && <p className="mx-fila-nota">{r.observaciones}</p>}
                  {r.omision && <p className="mx-fila-nota omit">Se omitió: {motivoTexto(r.omision)}</p>}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </article>
  )
}

export default function MatricesH5P({ s }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [, tic] = useState(0)

  const cargar = useCallback(async () => {
    setCargando(true)
    try { setD(await api('GET', '/proyectos/' + encodeURIComponent(s.id) + '/pipeline')); setError('') } catch (e) { setError(e.message || 'No se pudo cargar') }
    setCargando(false)
  }, [s.id])
  useEffect(() => { cargar() }, [cargar])

  const enProgreso = !!d && (d.matrices.some((m) => m.estado === 'generando' && !m.sinRespuesta) || d.ejecuciones.some((e) => e.estado === 'en_curso' && !e.sinRespuesta) || d.recursos.some((r) => r.estado === 'EN_PROCESO' && !r.sinRespuesta))
  // Mientras algo esté en proceso se refresca solo (consulta a Praxia, no a n8n); además, al volver a la pestaña.
  useEffect(() => {
    if (!enProgreso) return undefined
    const i = setInterval(cargar, 8000)
    return () => clearInterval(i)
  }, [enProgreso, cargar])
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    const i = setInterval(() => tic((n) => n + 1), 30000) // para que «hace X min» se mantenga al día
    return () => { document.removeEventListener('visibilitychange', alVolver); clearInterval(i) }
  }, [cargar])

  const unidades = useMemo(() => {
    const docs = (s.syllabus.documentos || []).slice().sort((a, b) => a.unidad - b.unidad)
    const nums = new Set(docs.map((x) => x.unidad))
    if (d) { d.matrices.forEach((m) => nums.add(m.unidad)); d.recursos.forEach((r) => { if (r.unidad != null) nums.add(r.unidad) }) }
    return [...nums].sort((a, b) => a - b).map((n) => ({ unidad: n, nombre: ((docs.find((x) => x.unidad === n) || {}).nombre) || '' }))
  }, [s.syllabus.documentos, d])

  const resumen = useMemo(() => {
    if (!d) return null
    const creadas = d.matrices.filter((m) => ['creada', 'omitida', 'reemplazada'].includes(m.estado)).length
    const h5p = d.recursos.filter((r) => String(r.generador || '').toUpperCase() === 'H5P')
    return { creadas, unidades: unidades.length, h5p: h5p.length, generados: h5p.filter((r) => r.estado === 'GENERADO').length, errores: d.recursos.filter((r) => r.estado === 'ERROR').length }
  }, [d, unidades.length])
  const ultimaH5P = d && d.ejecuciones.find((e) => e.etapa === 'h5p')

  return (
    <div className="mx">
      <div className="pj">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ margin: 0 }}>Matrices y H5P de «{s.curso}»</h2>
          <p className="help" style={{ margin: '2px 0 0' }}>Aquí se ve lo que n8n va avisando: la matriz de cada unidad, los recursos que contiene y cómo va la generación de H5P.</p>
        </div>
        <div className="mx-act">
          <span className="help">{d ? 'Actualizado ' + hace(d.generado) : ''}</span>
          <button className="btn sec sm" onClick={cargar} disabled={cargando}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>
        </div>
      </div>

      {error && <div className="msg warn" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      {!d && !error && <p className="help" style={{ marginTop: 14 }}>Cargando…</p>}

      {d && resumen && (
        <div className="mx-resumen card">
          <div className="mx-res-tx"><b>Avance del curso</b><span>{resumen.creadas} de {resumen.unidades} matrices listas{resumen.h5p ? ' · ' + resumen.generados + ' de ' + resumen.h5p + ' recursos H5P generados' : ''}</span></div>
          <div className="mx-cifras mx-res-c">
            <div><b>{resumen.creadas}/{resumen.unidades}</b><span>matrices</span></div>
            <div className="g"><b>{resumen.generados}</b><span>H5P generados</span></div>
            <div className={resumen.errores ? 'r' : ''}><b>{resumen.errores}</b><span>con error</span></div>
          </div>
          {enProgreso && <span className="mx-vivo"><span className="gv-spin" aria-hidden="true" />Algo está en proceso: esta pantalla se actualiza sola</span>}
        </div>
      )}

      {ultimaH5P && <Corrida e={ultimaH5P} />}

      {d && (
        <div className="mx-grid">
          {unidades.map((u) => (
            <Unidad key={u.unidad} unidad={u.unidad} nombre={u.nombre} matriz={d.matrices.find((m) => m.unidad === u.unidad)} recursos={d.recursos.filter((r) => r.unidad === u.unidad)} />
          ))}
        </div>
      )}
    </div>
  )
}
