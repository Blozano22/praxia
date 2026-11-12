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

// Recurso que necesita atención: con error, pendiente o en proceso.
function Atencion({ r }) {
  const mal = r.sinRespuesta || r.estado === 'ERROR'
  const texto = r.sinRespuesta ? 'Sin avisos' : (RECURSO[r.estado] || ['', r.estado])[1]
  const nota = r.estado === 'ERROR' ? r.observaciones : r.omision ? 'Se omitió: ' + motivoTexto(r.omision) : r.observaciones
  return (
    <li className={'mx2-at ' + (mal ? 'mal' : 'aviso')}>
      <div className="mx2-at-cab">
        <span className="mx2-ic" aria-hidden="true">{mal ? I_ALERTA : I_RELOJ}</span>
        <span className="mx2-cod">{r.codigo || r.id}</span>
        <b className="mx2-tit">{r.titulo || 'Sin título'}</b>
        <span className="mx2-est">{texto}</span>
      </div>
      {nota && <p className="mx2-nota">{nota}</p>}
      {r.enlaceGuion && <div className="mx2-acc"><a className="btn sec sm" href={r.enlaceGuion} target="_blank" rel="noopener noreferrer">Abrir guion ↗</a></div>}
    </li>
  )
}

function Unidad({ unidad, nombre, matriz, recursos, puede, ocupado, lanzar }) {
  const [todos, setTodos] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const conteo = useMemo(() => {
    const c = { total: recursos.length, PENDIENTE: 0, EN_PROCESO: 0, GENERADO: 0, ERROR: 0, h5p: 0, otros: 0 }
    recursos.forEach((r) => { c[r.estado] = (c[r.estado] || 0) + 1; if (String(r.generador || '').toUpperCase() === 'H5P') c.h5p++; else c.otros++ })
    return c
  }, [recursos])
  const clase = !matriz ? 'sin' : matriz.estado === 'error' || matriz.sinRespuesta ? 'bad' : matriz.estado === 'generando' || conteo.EN_PROCESO ? 'en' : conteo.total && conteo.GENERADO === conteo.total ? 'ok' : 'pe'
  const atencion = recursos.filter((r) => r.estado !== 'GENERADO' || r.sinRespuesta).sort((a, b) => (b.estado === 'ERROR') - (a.estado === 'ERROR'))
  const generados = recursos.filter((r) => r.estado === 'GENERADO' && !r.sinRespuesta)
  const visibles = todos ? generados : generados.slice(0, 3)
  const porGenerar = conteo.PENDIENTE + conteo.EN_PROCESO
  return (
    <article className={'card mx-uni mx-' + clase}>
      <header className="mx-uni-cab">
        <span className="mx-n">{unidad}</span>
        <div className="mx-uni-tit">
          <h3>Unidad {unidad}</h3>
          {nombre && <small>{nombre}</small>}
        </div>
        <Pill par={matriz ? (matriz.sinRespuesta ? SIN_RESPUESTA : MATRIZ[matriz.estado]) : ['', 'Sin matriz']} />
      </header>

      {!matriz && <p className="mx-vacio">Todavía no hay una matriz registrada para esta unidad. Puede generarla desde aquí; apenas n8n avise, aparecerá en esta pantalla.</p>}

      {matriz && (
        <div className="mx2-meta">
          {matriz.formacion && <span>{matriz.formacion}</span>}
          {matriz.formacion && <i aria-hidden="true" />}
          <span>Actualizada {hace(matriz.actualizadoEn)}</span>
          {matriz.matrizUrl && <a href={matriz.matrizUrl} target="_blank" rel="noopener noreferrer" title={matriz.matrizNombre || ''}>Abrir matriz ↗</a>}
        </div>
      )}
      {matriz && matriz.sinRespuesta && <p className="mx-detalle mal">n8n empezó a generar esta matriz {hace(matriz.actualizadoEn)} y no ha vuelto a avisar. Puede haberse interrumpido.</p>}
      {matriz && matriz.detalle && <p className={matriz.estado === 'error' ? 'mx-detalle mal' : 'mx2-info'}>{matriz.detalle}</p>}

      {puede && (!matriz || matriz.estado === 'error' || matriz.sinRespuesta) && (
        <div className="mx-gen">
          <button type="button" className="btn sm" disabled={ocupado} onClick={() => lanzar([unidad], false)}>{matriz ? 'Reintentar la matriz' : 'Generar matriz'}</button>
        </div>
      )}
      {puede && matriz && !matriz.sinRespuesta && ['creada', 'omitida', 'reemplazada'].includes(matriz.estado) && (
        confirmar ? (
          <div className="mx-conf" role="alertdialog" aria-label="Confirmar nueva generación">
            <p><b>¿Volver a generar la matriz de la Unidad {unidad}?</b> La actual irá a la papelera de Drive y se perderán los cambios hechos a mano en ella.</p>
            <div className="mx-gen">
              <button type="button" className="btn sm danger" disabled={ocupado} onClick={() => { setConfirmar(false); lanzar([unidad], true) }}>Sí, volver a generar</button>
              <button type="button" className="btn sec sm" onClick={() => setConfirmar(false)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <div className="mx-gen"><button type="button" className="btn sec sm" disabled={ocupado} onClick={() => setConfirmar(true)}>Volver a generar la matriz</button></div>
        )
      )}

      {conteo.total > 0 && (
        <>
          <div className="mx2-prog">
            <div className="mx2-grande"><b>{conteo.GENERADO}</b><span>de {conteo.total} recursos generados</span></div>
            <div className="mx2-seg" role="img" aria-label={conteo.GENERADO + ' generados, ' + porGenerar + ' por generar, ' + conteo.ERROR + ' con error'}>
              {conteo.GENERADO > 0 && <i className="ok" style={{ flex: conteo.GENERADO }} />}
              {porGenerar > 0 && <i className="pe" style={{ flex: porGenerar }} />}
              {conteo.ERROR > 0 && <i className="er" style={{ flex: conteo.ERROR }} />}
            </div>
            <ul className="mx2-ley">
              {conteo.GENERADO > 0 && <li className="ok">{conteo.GENERADO} generados</li>}
              {porGenerar > 0 && <li className="pe">{porGenerar} por generar</li>}
              {conteo.ERROR > 0 && <li className="er">{conteo.ERROR} con error</li>}
              <li className="mx2-tipo">H5P {conteo.h5p}{conteo.otros ? ' · otros ' + conteo.otros : ''}</li>
            </ul>
          </div>

          {atencion.length > 0 && (
            <section aria-label="Requieren atención">
              <h4 className="mx2-h">Requieren atención <span className="mal">{atencion.length}</span></h4>
              <ul className="mx2-lista">{atencion.map((r) => <Atencion key={r.id} r={r} />)}</ul>
            </section>
          )}

          {generados.length > 0 && (
            <section aria-label="Generados">
              <h4 className="mx2-h">Generados <span className="bien">{generados.length}</span></h4>
              <ul className="mx2-gen">
                {visibles.map((r) => (
                  <li key={r.id}>
                    <span className="mx2-ok" aria-hidden="true">{I_CHECK}</span>
                    <span className="mx2-cod">{r.codigo || r.id}</span>
                    <span className="mx2-nom">{r.titulo || 'Sin título'}</span>
                    {r.generador && <span className="mx2-chip">{r.generador}</span>}
                    {r.enlaceGuion && <a href={r.enlaceGuion} target="_blank" rel="noopener noreferrer">Guion ↗</a>}
                    {r.enlaceRecurso && <a href={r.enlaceRecurso} target="_blank" rel="noopener noreferrer">Recurso ↗</a>}
                  </li>
                ))}
              </ul>
              {generados.length > 3 && <button type="button" className="mx2-mas" aria-expanded={todos} onClick={() => setTodos(!todos)}>{todos ? 'Ver menos' : 'Ver ' + (generados.length - 3) + (generados.length - 3 === 1 ? ' recurso más' : ' recursos más')}</button>}
            </section>
          )}
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
  const [lanzando, setLanzando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [lanzadoEn, setLanzadoEn] = useState(0) // hasta que n8n avise del inicio pasan unos segundos: mientras tanto se sigue refrescando

  const cargar = useCallback(async () => {
    setCargando(true)
    try { setD(await api('GET', '/proyectos/' + encodeURIComponent(s.id) + '/pipeline')); setError('') } catch (e) { setError(e.message || 'No se pudo cargar') }
    setCargando(false)
  }, [s.id])
  useEffect(() => { cargar() }, [cargar])

  const lanzadoReciente = lanzadoEn > 0 && Date.now() - lanzadoEn < 120000
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
      setLanzadoEn(Date.now())
      setAviso((forzar ? 'Se pidió volver a generar' : 'Se pidió generar') + (nums.length === 1 ? ' la matriz de la Unidad ' + nums[0] : ' las matrices de las unidades ' + nums.join(', ')) + '. n8n la está preparando; esta pantalla se actualiza sola.')
      await cargar()
    } catch (e) { setError(e.message || 'No se pudo lanzar la generación') }
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
  const aprobadas = new Set((s.syllabus.documentos || []).filter((x) => x.aprobado).map((x) => x.unidad))
  const faltan = d ? unidades.map((u) => u.unidad).filter((n) => aprobadas.has(n) && (() => { const m = d.matrices.find((x) => x.unidad === n); return !m || m.estado === 'error' || m.sinRespuesta })()) : []

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
      {aviso && !error && <div className="msg ok" role="status" style={{ marginTop: 12 }}>{aviso}</div>}
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

      {d && puede && faltan.length > 0 && (
        <div className="mx-faltan card">
          <div><b>{faltan.length === 1 ? 'Falta la matriz de 1 unidad' : 'Faltan las matrices de ' + faltan.length + ' unidades'}</b><span>Unidades {faltan.join(', ')}. Las que ya existen no se tocan.</span></div>
          <button type="button" className="btn sm" disabled={ocupado} onClick={() => lanzar(faltan, false)}>{lanzando ? 'Enviando…' : 'Generar las que faltan'}</button>
        </div>
      )}
      {d && !puede && <p className="help" style={{ marginTop: 10 }}>La generación de matrices desde Praxia todavía no está activada en este servidor.</p>}

      {ultimaH5P && <Corrida e={ultimaH5P} />}

      {d && (
        <div className="mx-grid">
          {unidades.map((u) => (
            <Unidad key={u.unidad} unidad={u.unidad} nombre={u.nombre} matriz={d.matrices.find((m) => m.unidad === u.unidad)} recursos={d.recursos.filter((r) => r.unidad === u.unidad)} puede={puede} ocupado={ocupado} lanzar={lanzar} />
          ))}
        </div>
      )}
    </div>
  )
}
