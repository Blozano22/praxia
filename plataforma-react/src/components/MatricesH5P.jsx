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

const I_CHECK = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
const I_ALERTA = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 6v7M12 17.5v.5" /></svg>
const I_RELOJ = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></svg>

// Una línea por recurso: generado (verde), por generar (círculo vacío), en proceso o con error.
function Fila({ r }) {
  const mal = r.sinRespuesta || r.estado === 'ERROR'
  const hecho = r.estado === 'GENERADO' && !r.sinRespuesta
  const k = hecho ? 'ok' : mal ? 'er' : r.estado === 'EN_PROCESO' ? 'en' : 'pe'
  const texto = hecho ? 'Generado' : r.sinRespuesta ? 'Sin avisos' : r.estado === 'ERROR' ? 'Con error' : r.estado === 'EN_PROCESO' ? 'Generando' : 'Por generar'
  const nota = r.estado === 'ERROR' ? r.observaciones : r.omision ? 'Se omitió: ' + motivoTexto(r.omision) : hecho ? '' : r.observaciones
  return (
    <li className={'mx4-r ' + k}>
      <span className={'mx4-pt ' + k} aria-hidden="true">{hecho ? I_CHECK : mal ? I_ALERTA : null}</span>
      <span className="mx4-cod">{r.codigo || r.id}</span>
      <span className="mx4-rt" title={r.titulo || ''}>{r.titulo || 'Sin título'}</span>
      <span className="mx4-re">{texto}</span>
      <span className="mx4-rl">
        {hecho && r.enlaceRecurso && <a href={r.enlaceRecurso} target="_blank" rel="noopener noreferrer">Recurso ↗</a>}
        {r.enlaceGuion && <a href={r.enlaceGuion} target="_blank" rel="noopener noreferrer">Guion ↗</a>}
      </span>
      {nota && <p className="mx4-nota">{nota}</p>}
    </li>
  )
}

// Tiempo transcurrido desde que se pidió algo (mm:ss), para que se note que sigue en marcha.
function Cronometro({ desde }) {
  const [, t] = useState(0)
  useEffect(() => { const i = setInterval(() => t((n) => n + 1), 1000); return () => clearInterval(i) }, [])
  const ms = new Date(desde).getTime()
  if (!ms) return null
  const seg = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  return <span className="mx3-crono">{Math.floor(seg / 60)}:{String(seg % 60).padStart(2, '0')}</span>
}

function Unidad({ unidad, nombre, matriz, recursos, puede, ocupado, lanzar, enviada, desdeEnvio }) {
  const [todos, setTodos] = useState(false)
  const [filtro, setFiltro] = useState('todos')
  const [confirmar, setConfirmar] = useState(false)
  const conteo = useMemo(() => {
    const c = { total: recursos.length, PENDIENTE: 0, EN_PROCESO: 0, GENERADO: 0, ERROR: 0, h5p: 0, otros: 0 }
    recursos.forEach((r) => { c[r.estado] = (c[r.estado] || 0) + 1; if (String(r.generador || '').toUpperCase() === 'H5P') c.h5p++; else c.otros++ })
    return c
  }, [recursos])
  const esHecho = (r) => r.estado === 'GENERADO' && !r.sinRespuesta
  const filas = recursos.filter((r) => (filtro === 'generados' ? esHecho(r) : filtro === 'pendientes' ? !esHecho(r) : true)).sort((a, b) => esHecho(b) - esHecho(a) || (b.estado === 'ERROR') - (a.estado === 'ERROR'))
  const porGenerar = conteo.PENDIENTE + conteo.EN_PROCESO
  const matrizMal = !!matriz && (matriz.estado === 'error' || !!matriz.sinRespuesta)
  const completa = conteo.total > 0 && conteo.GENERADO === conteo.total
  const estadoU = matrizMal || conteo.ERROR > 0 ? 'bad' : completa ? 'ok' : conteo.GENERADO === 0 ? 'vacia' : 'en'
  const chipU = matrizMal ? 'Matriz con error' : completa ? 'Completa' : conteo.total === 0 ? 'Sin recursos' : conteo.ERROR > 0 ? 'Con errores' : conteo.GENERADO === 0 ? 'Por generar' : conteo.EN_PROCESO > 0 ? 'Generando' : 'En progreso'
  const resumenU = matrizMal ? 'Hay que reintentar la matriz' : completa ? 'Matriz y recursos listos' : conteo.total === 0 ? 'Matriz lista · sin recursos todavía' : conteo.GENERADO === 0 ? 'Matriz lista · recursos H5P sin generar' : 'Matriz lista · faltan ' + (conteo.total - conteo.GENERADO) + ' recursos'
  const generandoMat = (!!matriz && matriz.estado === 'generando' && !matriz.sinRespuesta) || (!matriz && !!enviada)
  // Sin matriz (o generándose sin recursos aún): una fila simple, sin tarjeta con datos vacíos.
  if (!matriz || (generandoMat && conteo.total === 0)) {
    return (
      <article className={'mx3-fila' + (generandoMat ? ' gen' : '')}>
        <div className="mx3-fila-in">
          <span className="mx3-n">{unidad}</span>
          <div className="mx3-fila-tx">
            <b>Unidad {unidad}</b>
            {generandoMat
              ? <span className="mx3-gen-tx"><span className="mx3-gira chico" aria-hidden="true" />Generando la matriz… <Cronometro desde={matriz ? matriz.actualizadoEn : desdeEnvio} /></span>
              : <span className="mx3-sin">{nombre && nombre !== 'Unidad ' + unidad ? nombre + ' · ' : ''}Sin matriz</span>}
          </div>
          {generandoMat
            ? <button type="button" className="btn sm" disabled>En proceso</button>
            : puede && <button type="button" className="btn sec sm mx3-bt" disabled={ocupado} onClick={() => lanzar([unidad], false)}>Generar matriz</button>}
        </div>
        {generandoMat && <div className="mx3-barra chica" aria-hidden="true"><i /></div>}
      </article>
    )
  }
  return (
    <article className={'mx4-card ' + estadoU}>
      <header className="mx4-cab">
        <span className="mx4-n">{unidad}</span>
        <div className="mx4-tit">
          <h3>Unidad {unidad}</h3>
          <small>{resumenU}</small>
        </div>
        <span className="mx4-chip">{completa && I_CHECK}{chipU}</span>
      </header>

      <div className="mx4-paso">
        <span className={'mx4-ic ' + (matrizMal ? 'er' : 'ok')} aria-hidden="true">{matrizMal ? I_ALERTA : I_CHECK}</span>
        <div className="mx4-paso-tx">
          <b>{matrizMal ? 'La matriz no se generó' : 'Matriz lista'}</b>
          <span>{matriz.formacion ? ' · ' + matriz.formacion : ''} · actualizada {hace(matriz.actualizadoEn)}</span>
        </div>
        {matriz.matrizUrl && <a className="mx4-lk" href={matriz.matrizUrl} target="_blank" rel="noopener noreferrer" title={matriz.matrizNombre || ''}>Abrir matriz ↗</a>}
        {puede && matrizMal && <button type="button" className="btn sm" disabled={ocupado} onClick={() => lanzar([unidad], false)}>Reintentar la matriz</button>}
        {puede && !matrizMal && ['creada', 'omitida', 'reemplazada'].includes(matriz.estado) && !confirmar && (
          <button type="button" className="mx4-q" disabled={ocupado} onClick={() => setConfirmar(true)} aria-label={'Volver a generar la matriz de la Unidad ' + unidad}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
            Volver a generar
          </button>
        )}
      </div>
      {matriz.sinRespuesta && <p className="mx-detalle mal">n8n empezó a generar esta matriz {hace(matriz.actualizadoEn)} y no ha vuelto a avisar. Puede haberse interrumpido.</p>}
      {matriz.detalle && matriz.estado === 'error' && <p className="mx-detalle mal">{matriz.detalle}</p>}
      {confirmar && (
        <div className="mx4-conf" role="alertdialog" aria-label="Confirmar nueva generación">
          <p><b>¿Volver a generar la matriz de la Unidad {unidad}?</b> La actual irá a la papelera de Drive y se perderán los cambios hechos a mano en ella.</p>
          <button type="button" className="btn sm danger" disabled={ocupado} onClick={() => { setConfirmar(false); lanzar([unidad], true) }}>Sí, volver a generar</button>
          <button type="button" className="btn sec sm" onClick={() => setConfirmar(false)}>Cancelar</button>
        </div>
      )}

      {conteo.total > 0 && (
        <div className="mx4-paso mx4-rec">
          <div className="mx4-fila-h5p">
            <span className={'mx4-ic ' + (completa ? 'ok' : 'n')} aria-hidden="true">2</span>
            <div className="mx4-paso-tx">
              <b>Recursos H5P</b>
              <span className="mx4-cifra"><strong>{conteo.GENERADO}</strong> de {conteo.total} generados{conteo.ERROR > 0 ? ' · ' + conteo.ERROR + ' con error' : ''}</span>
            </div>
            <button type="button" className="mx4-ver" aria-expanded={todos} onClick={() => setTodos(!todos)}>
              {todos ? 'Ocultar recursos' : 'Ver los ' + conteo.total + ' recursos'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: todos ? 'rotate(180deg)' : 'none' }}><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </div>
          <div className="mx4-barra" role="img" aria-label={conteo.GENERADO + ' generados de ' + conteo.total}>
            <i className="ok" style={{ width: (conteo.GENERADO / conteo.total) * 100 + '%' }} />
            {conteo.ERROR > 0 && <i className="er" style={{ width: (conteo.ERROR / conteo.total) * 100 + '%' }} />}
          </div>
          {todos && (
            <div className="mx4-lista-w">
              <div className="mx4-filtros" role="tablist" aria-label="Filtrar recursos">
                {[['todos', 'Todos', conteo.total], ['generados', 'Generados', conteo.GENERADO], ['pendientes', 'Por generar', conteo.total - conteo.GENERADO]].map(([k, t, n]) => (
                  <button key={k} type="button" role="tab" aria-selected={filtro === k} className={'mx4-f ' + k + (filtro === k ? ' on' : '')} onClick={() => setFiltro(k)}>{t} <b>{n}</b></button>
                ))}
              </div>
              <ul className="mx4-lista">{filas.map((r) => <Fila key={r.id} r={r} />)}</ul>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export default function MatricesH5P({ s }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [, tic] = useState(0)
  const [lanzando, setLanzando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [faseSel, setFaseSel] = useState(null) // fase elegida a mano (1 = Matrices, 2 = Recursos H5P); null = la que corresponde al estado
  const [yaEnCurso, setYaEnCurso] = useState(0) // el servidor dijo que ya hay una generación en marcha
  const [enviadas, setEnviadas] = useState([]) // unidades cuya matriz se pidió hace poco
  const [lanzadoEn, setLanzadoEn] = useState(0) // hasta que n8n avise del inicio pasan unos segundos: mientras tanto se sigue refrescando

  const cargar = useCallback(async () => {
    setCargando(true)
    try { setD(await api('GET', '/proyectos/' + encodeURIComponent(s.id) + '/pipeline')); setError('') } catch (e) { setError(e.message || 'No se pudo cargar') }
    setCargando(false)
  }, [s.id])
  useEffect(() => { cargar() }, [cargar])

  const lanzadoReciente = (lanzadoEn > 0 && Date.now() - lanzadoEn < 120000) || (yaEnCurso > 0 && Date.now() - yaEnCurso < 600000)
  const enProgreso = lanzadoReciente || !!d && (d.matrices.some((m) => m.estado === 'generando' && !m.sinRespuesta) || d.ejecuciones.some((e) => e.estado === 'en_curso' && !e.sinRespuesta) || d.recursos.some((r) => r.estado === 'EN_PROCESO' && !r.sinRespuesta))
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

  const lanzar = useCallback(async (nums, forzar) => {
    setLanzando(true); setError(''); setAviso('')
    try {
      await api('POST', '/proyectos/' + encodeURIComponent(s.id) + '/pipeline/matrices', { unidades: nums, forzar })
      setLanzadoEn(Date.now()); setYaEnCurso(0); setEnviadas(nums); setFaseSel(1)
      setAviso((forzar ? 'Se pidió volver a generar' : 'Se pidió generar') + (nums.length === 1 ? ' la matriz de la Unidad ' + nums[0] : ' las matrices de las unidades ' + nums.join(', ')) + '. n8n la está preparando; esta pantalla se actualiza sola.')
      await cargar()
    } catch (e) {
      if (e && (e.estado === 409 || /ya se est/i.test(e.message || ''))) { setYaEnCurso(Date.now()); setEnviadas(nums); setLanzadoEn(Date.now()) } // no es un fallo: ya hay una en marcha
      else setError(e.message || 'No se pudo lanzar la generación')
    }
    setLanzando(false)
  }, [s.id, cargar])

  const lanzarH5p = useCallback(async (reintentar) => {
    setLanzando(true); setError(''); setAviso('')
    try {
      await api('POST', '/proyectos/' + encodeURIComponent(s.id) + '/pipeline/h5p', { reintentarErrores: reintentar })
      setLanzadoEn(Date.now()); setYaEnCurso(0); setEnviadas([]); setFaseSel(2)
      setAviso((reintentar ? 'Se pidió reintentar los recursos con error.' : 'Se pidió generar los recursos H5P.') + ' n8n está planificando la corrida; el avance aparece aquí y se actualiza solo.')
      await cargar()
    } catch (e) { setError(e.message || 'No se pudo lanzar la generación de H5P') }
    setLanzando(false)
  }, [s.id, cargar])

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
  const puede = !!(d && d.puedeGenerarMatrices)
  const ocupado = lanzando || lanzadoReciente || !!(d && (d.matrices.some((m) => m.estado === 'generando' && !m.sinRespuesta) || d.ejecuciones.some((e) => e.etapa === 'matrices' && e.estado === 'en_curso' && !e.sinRespuesta)))
  const puedeH5p = !!(d && d.puedeGenerarH5p)
  const listas = d ? d.matrices.filter((m) => ['creada', 'omitida', 'reemplazada'].includes(m.estado) && !m.sinRespuesta).length : 0
  const h5pOcupado = lanzando || lanzadoReciente || !!(d && d.ejecuciones.some((e) => e.etapa === 'h5p' && e.estado === 'en_curso' && !e.sinRespuesta))
  const conError = d ? d.recursos.filter((r) => r.estado === 'ERROR').length : 0
  const pendientes = d ? d.recursos.filter((r) => r.estado === 'PENDIENTE' && String(r.generador || '').toUpperCase() === 'H5P').length : 0
  const aprobadas = new Set((s.syllabus.documentos || []).filter((x) => x.aprobado).map((x) => x.unidad))
  const faltan = d ? unidades.map((u) => u.unidad).filter((n) => aprobadas.has(n) && (() => { const m = d.matrices.find((x) => x.unidad === n); return !m || m.estado === 'error' || m.sinRespuesta })()) : []

  const enCursoMat = d ? d.matrices.filter((m) => m.estado === 'generando' && !m.sinRespuesta) : []
  const corridaH5p = ultimaH5P && ultimaH5P.estado === 'en_curso' && !ultimaH5P.sinRespuesta ? ultimaH5P : null
  const soloEnviado = lanzadoReciente && !enCursoMat.length && !corridaH5p
  const nombres = (l) => (l.length === 1 ? 'la matriz de la Unidad ' + l[0].unidad : 'las matrices de las unidades ' + l.map((m) => m.unidad).join(', '))
  const desdeMat = enCursoMat.map((m) => new Date(m.actualizadoEn).getTime()).filter(Boolean).sort((a, b) => a - b)[0]
  const todoAlDia = !!d && unidades.length > 0 && listas === unidades.length && resumen && resumen.h5p > 0 && pendientes === 0 && conError === 0
  const fase1Activa = enCursoMat.length > 0 || faltan.length > 0 || (soloEnviado && enviadas.length > 0)
  useEffect(() => { if (yaEnCurso && (enCursoMat.length > 0 || (d && faltan.length === 0))) setYaEnCurso(0) }, [yaEnCurso, enCursoMat.length, d, faltan.length])
  const faseAuto = fase1Activa || listas === 0 ? 1 : 2
  const fase = listas === 0 ? 1 : (faseSel || faseAuto) // la fase 2 no se abre sin una matriz lista
  const subFase2 = listas === 0 ? 'Se habilita cuando haya una matriz lista' : resumen && resumen.h5p ? resumen.generados + ' de ' + resumen.h5p + ' generados' : 'Aún sin recursos generados'

  return (
    <div className="mx">
      <div className="mx3-cab">
        <div>
          <h2>Matrices y H5P</h2>
          <p className="help">Cada unidad necesita su matriz; con ella se generan los recursos H5P.</p>
        </div>
        <div className="mx-act">
          <span className="help">{enProgreso ? 'Se actualiza sola' : d ? 'Actualizado ' + hace(d.generado) : ''}</span>
          <button className="btn sec sm" onClick={cargar} disabled={cargando}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>
        </div>
      </div>

      {error && <div className="msg warn" role="alert" style={{ marginTop: 12 }}>{error}</div>}
      {!d && !error && <p className="help" style={{ marginTop: 14 }}>Cargando…</p>}

      {d && resumen && (
        <div className="mx3-fases" role="tablist" aria-label="Fases del paso">
          <button type="button" role="tab" aria-selected={fase === 1} className={'mx3-fase' + (fase === 1 ? ' on' : listas > 0 && faltan.length === 0 ? ' hecha' : '')} onClick={() => setFaseSel(1)}>
            <i>{!fase1Activa && listas > 0 && faltan.length === 0 ? I_CHECK : '1'}</i>
            <span><b>Matrices</b><small>{listas} de {unidades.length} listas{enCursoMat.length ? ' · ' + enCursoMat.length + ' generándose' : ''}</small></span>
          </button>
          <button type="button" role="tab" aria-selected={fase === 2} disabled={listas === 0} className={'mx3-fase' + (listas === 0 ? ' bloq' : fase === 2 ? ' on' : '')} onClick={() => setFaseSel(2)}>
            <i>{listas === 0 ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg> : '2'}</i>
            <span><b>Recursos H5P</b><small>{subFase2}</small></span>
          </button>
        </div>
      )}

      {d && (enCursoMat.length > 0 || corridaH5p || soloEnviado) && (
        <section className="mx3-ahora proceso" aria-live="polite">
          <div className="mx3-ahora-fila">
            <span className="mx3-anillo" aria-hidden="true"><span className="mx3-gira" /></span>
            <div className="mx3-ahora-tx">
              <span className="mx3-etq">EN PROCESO</span>
              <h3>{enCursoMat.length ? 'Generando ' + nombres(enCursoMat) : corridaH5p ? 'Generando los recursos H5P' : yaEnCurso ? 'Ya se están generando las matrices de este curso' : enviadas.length ? 'Generando ' + (enviadas.length === 1 ? 'la matriz de la Unidad ' + enviadas[0] : 'las matrices de las unidades ' + enviadas.join(', ')) : 'Orden enviada a n8n'}</h3>
              <p>{enCursoMat.length ? 'n8n la está preparando. Puede tardar unos minutos: deje esta pantalla abierta, el resultado aparece aquí solo.' : corridaH5p ? (corridaH5p.plan ? corridaH5p.resumen ? (corridaH5p.resumen.generados ?? 0) + ' de ' + corridaH5p.plan.aGenerar + ' recursos listos. ' : corridaH5p.plan.aGenerar + ' recursos por generar. ' : 'n8n está planificando la corrida. ') + 'El avance se actualiza solo.' : yaEnCurso ? 'Ya se pidió: no hace falta repetirlo. Espere a que termine; el resultado aparece aquí solo.' : 'n8n está empezando a trabajar. Puede tardar unos minutos: deje esta pantalla abierta, el resultado aparece aquí solo.'}</p>
            </div>
            {(desdeMat || (soloEnviado && !yaEnCurso)) && <div className="mx3-tiempo"><Cronometro desde={desdeMat || lanzadoEn} /><span>desde que se pidió</span></div>}
          </div>
          {corridaH5p && corridaH5p.plan && corridaH5p.plan.aGenerar > 0 && corridaH5p.resumen
            ? <div className="mx3-barra det" role="progressbar" aria-valuemin="0" aria-valuemax={corridaH5p.plan.aGenerar} aria-valuenow={corridaH5p.resumen.generados ?? 0}><i style={{ width: Math.min(100, Math.round(((corridaH5p.resumen.generados ?? 0) / corridaH5p.plan.aGenerar) * 100)) + '%' }} /></div>
            : <div className="mx3-barra" aria-hidden="true"><i /></div>}
        </section>
      )}

      {d && fase === 1 && !(enCursoMat.length > 0 || corridaH5p || soloEnviado) && puede && faltan.length > 0 && (
        <section className="mx3-ahora paso">
          <div className="mx3-ahora-fila">
            <span className="mx3-ico" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></svg></span>
            <div className="mx3-ahora-tx">
              <span className="mx3-etq">SIGUIENTE PASO</span>
              <h3>{faltan.length === 1 ? 'Genere la matriz de la Unidad ' + faltan[0] : 'Genere las matrices de ' + (faltan.length === unidades.length ? 'las ' + faltan.length + ' unidades' : 'las unidades ' + faltan.join(', '))}</h3>
              <p>{faltan.length === unidades.length ? 'Ninguna unidad tiene matriz todavía.' : 'Estas unidades aún no tienen matriz.'} Puede crear {faltan.length === 1 ? 'esta' : 'todas'} de una vez{faltan.length > 1 ? ' o una por una desde la lista' : ''}. Las que ya existen no se tocan.</p>
            </div>
            <button type="button" className="mx3-gran" disabled={ocupado} onClick={() => lanzar(faltan, false)}>{lanzando ? 'Enviando…' : faltan.length === 1 ? 'Generar la matriz' : 'Generar ' + (faltan.length === unidades.length ? 'las ' + faltan.length + ' matrices' : 'las ' + faltan.length + ' que faltan')}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
          </div>
        </section>
      )}
      {d && !puede && <p className="help" style={{ marginTop: 10 }}>La generación de matrices desde Praxia todavía no está activada en este servidor.</p>}
      {d && fase === 1 && !(enCursoMat.length > 0 || corridaH5p || soloEnviado) && faltan.length === 0 && listas > 0 && (
        <section className="mx3-ahora listo" aria-label="Matrices listas">
          <div className="mx3-ahora-fila">
            <span className="mx3-ico ok" aria-hidden="true">{I_CHECK}</span>
            <div className="mx3-ahora-tx">
              <span className="mx3-etq">MATRICES LISTAS</span>
              <h3>{listas === 1 ? 'La matriz está lista' : 'Las ' + listas + ' matrices están listas'}</h3>
              <p>Si necesita rehacer una, use «Volver a generar la matriz» en su unidad (la anterior va a la papelera de Drive).</p>
            </div>
            {puedeH5p && <button type="button" className="mx3-gran" onClick={() => setFaseSel(2)}>Ir a los recursos H5P</button>}
          </div>
        </section>
      )}

      {d && fase === 2 && !(enCursoMat.length > 0 || corridaH5p || soloEnviado) && puedeH5p && listas > 0 && !todoAlDia && (
        <section className="mx5-h5p" aria-label="Generar recursos H5P">
          <div className="mx5-num">
            <span className="mx5-etq">PASO 2 · RECURSOS H5P</span>
            <div className="mx5-cifra"><b>{pendientes || '—'}</b><span>{pendientes === 1 ? 'recurso por generar' : 'recursos por generar'}</span></div>
            <ul className="mx5-por">
              {unidades.map((u) => {
                const rs = d.recursos.filter((r) => r.unidad === u.unidad)
                const hechos = rs.filter((r) => r.estado === 'GENERADO' && !r.sinRespuesta).length
                return <li key={u.unidad}><i>U{u.unidad}</i>{hechos}/{rs.length}</li>
              })}
            </ul>
          </div>
          <div className="mx5-acc">
            <h3>Cree los recursos interactivos</h3>
            <p>n8n toma cada guion de las matrices listas y arma su recurso H5P. Lo que no se pueda generar queda como «omitido», con su motivo.</p>
            <div className="mx5-btns">
              <button type="button" className="mx5-gen" disabled={h5pOcupado} onClick={() => lanzarH5p(false)}>{lanzando ? 'Enviando…' : 'Generar los recursos H5P'}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14" /></svg></button>
              {conError > 0 && <button type="button" className="mx5-re" disabled={h5pOcupado} onClick={() => lanzarH5p(true)}>Reintentar los {conError} con error</button>}
            </div>
          </div>
        </section>
      )}
      {d && !puedeH5p && listas > 0 && <p className="help" style={{ marginTop: 10 }}>La generación de H5P desde Praxia todavía no está activada en este servidor.</p>}

      {d && fase === 2 && todoAlDia && !(enCursoMat.length > 0 || corridaH5p || soloEnviado) && (
        <section className="mx3-ahora listo">
          <div className="mx3-ahora-fila">
            <span className="mx3-ico ok" aria-hidden="true">{I_CHECK}</span>
            <div className="mx3-ahora-tx"><span className="mx3-etq">TODO AL DÍA</span><h3>Las matrices y los recursos H5P están listos</h3></div>
          </div>
        </section>
      )}

      {fase === 2 && ultimaH5P && !corridaH5p && <Corrida e={ultimaH5P} />}

      {d && (
        <>
          <h4 className="mx2-h mx3-h">Unidades</h4>
          <div className="mx-grid mx3-lista">
            {unidades.map((u) => (
              <Unidad key={u.unidad} unidad={u.unidad} nombre={u.nombre} matriz={d.matrices.find((m) => m.unidad === u.unidad)} recursos={d.recursos.filter((r) => r.unidad === u.unidad)} puede={puede} ocupado={ocupado} lanzar={lanzar} enviada={lanzadoReciente && enviadas.includes(u.unidad)} desdeEnvio={yaEnCurso ? 0 : lanzadoEn} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
