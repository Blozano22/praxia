import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api as apiBase, conPropietario } from '../lib/api.js'
import { textoCorreccion } from './PanelCorreccion.jsx'
import { resumenConsumo, tokensDe, costoDe, usd, miles, esUrlImagen } from '../lib/consumo.js'
import { leerHash, ponerHash } from '../lib/hashEstado.js'
import EditorRecurso from './EditorRecurso.jsx'
import CargaRecurso from './CargaRecurso.jsx'
import { useConfirmar, IconoAviso } from './Confirmar.jsx'
import './matrices.css'

// Paso «Matrices y H5P» del curso: muestra lo que n8n AVISÓ a Praxia (la matriz de cada unidad, sus recursos y las corridas de H5P).
// Lee solo de Praxia (GET /api/proyectos/:id/pipeline); no consulta a n8n ni a Google. Se refresca solo mientras haya algo en proceso.

const MATRIZ = {
  generando: ['warn', 'Generando la matriz…'],
  creada: ['ok', 'Matriz creada'],
  omitida: ['ok', 'Matriz ya existente'],
  reemplazada: ['ok', 'Matriz regenerada'],
  actualizada: ['ok', 'Matriz actualizada'],
  error: ['bad', 'Error al crear la matriz']
}
const SIN_RESPUESTA = ['bad', 'Sin respuesta de n8n']
const RECURSO = { PENDIENTE: ['', 'Pendiente'], EN_PROCESO: ['warn', 'En proceso'], POR_REVISAR: ['warn', 'Por revisar'], GENERADO: ['ok', 'Generado'], ERROR: ['bad', 'Error'] }
// Por qué una corrida de H5P dejó fuera un recurso (lo dice n8n en el plan).
const MOTIVO = {
  sin_plantilla: 'Todavía no hay una plantilla H5P para este tipo de recurso',
  generador_no_h5p: 'Lo genera otro generador (por ejemplo, Videos), no H5P',
  estado_no_pendiente: 'Ya estaba generado o en proceso',
  sin_lector: 'Todavía no hay lector del guion para este tipo de recurso',
  sin_variante_disponible: 'No queda una variante libre de este tipo: se reintenta sola en la siguiente corrida',
  tipo_inactivo: 'Este tipo de recurso está desactivado',
  no_encontrado: 'No se encontró este recurso en las matrices',
  supera_maximo: 'Quedó fuera por el máximo de la corrida: genere de nuevo'
}
const motivoTexto = (m) => MOTIVO[m] || String(m || '').replace(/_/g, ' ')
// Tema de un recurso: el que avisó n8n o, si falta, el del código («U1-T4-R6» → 4). 0 = sin tema.
const temaDe = (r) => { if (r.tema != null && Number.isFinite(Number(r.tema))) return Number(r.tema); const x = /-T(\d+)-/i.exec(r.codigo || ''); return x ? Number(x[1]) : 0 }
const fecha = (c) => (c ? new Date(c).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const hace = (c) => {
  if (!c) return ''
  const s = Math.max(0, Math.round((Date.now() - new Date(c).getTime()) / 1000))
  if (s < 60) return 'hace unos segundos'
  if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min'
  if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h'
  return fecha(c)
}

// Recursos que quedaron sin generar por el tope de la corrida (0 si no aplica).
function pendientesPorTope(e) {
  if (!e || e.estado === 'en_curso') return 0
  const rest = e.resumen && e.resumen.pendientes_restantes != null ? Number(e.resumen.pendientes_restantes) || 0 : 0
  const om = (e.plan && e.plan.omitidas ? e.plan.omitidas : []).filter((o) => o.motivo === 'supera_maximo').length
  return Math.max(rest, om)
}
function AvisoTope({ e }) {
  const n = pendientesPorTope(e)
  if (!n) return null
  return <p className="mx-nada" role="status"><b>Quedan {n} {n === 1 ? 'recurso' : 'recursos'} sin generar</b> (n8n genera hasta un máximo por corrida). Pulse «Generar H5P» otra vez para continuar.</p>
}

function Pill({ par }) { return <span className={'pill ' + par[0]}>{par[1]}</span> }

function CorridaFranja({ e }) {
  const [abierto, setAbierto] = useState(false)
  const omitidas = e.plan ? e.plan.omitidas : []
  const r = e.resumen
  const porMotivo = Object.entries(omitidas.reduce((a, o) => { a[o.motivo] = (a[o.motivo] || 0) + 1; return a }, {})).sort((x, y) => y[1] - x[1])
  const nOmit = omitidas.length || (r ? r.omitidos ?? 0 : 0)
  const nadaQueGenerar = e.estado !== 'en_curso' && !!e.plan && e.plan.aGenerar === 0 && porMotivo.length > 0
  const total = porMotivo.reduce((a, x) => a + x[1], 0) || 1
  return (
    <div className="mx6-corr">
      <div className="mx6-corr-cab">
        <span className="mx6-corr-t"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>Última corrida</span>
        <span className="mx6-corr-f">{e.estado === 'en_curso' ? 'En curso' : fecha(e.terminadoEn || e.ultimoEventoEn)}{e.maximo ? ' · máximo ' + e.maximo + ' recursos' : ''}</span>
        {e.estado !== 'en_curso' && <span className="mx6-ok">Terminada</span>}
        <span className="mx6-sp" />
        <span className="mx6-res"><b>{r ? r.generados ?? 0 : 0}</b> generados · <b>{nOmit}</b> omitidos · <b>{r ? r.errores ?? 0 : 0}</b> con error</span>
        {(porMotivo.length > 0 || omitidas.length > 0) && (
          <button type="button" className="mx6-ver" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
            {abierto ? 'Ocultar el motivo' : 'Ver por qué se omitieron'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: abierto ? 'rotate(180deg)' : 'none' }}><path d="M6 9l6 6 6-6" /></svg>
          </button>
        )}
      </div>
      {abierto && (
        <div className="mx6-mot">
          {nadaQueGenerar && <p><b>Ningún recurso se generó:</b> n8n los revisó y los omitió. Estos son los motivos.</p>}
          <ul>
            {porMotivo.map(([m, n]) => (
              <li key={m}>
                <span className="mx6-n">{n}</span>
                <div><span>{motivoTexto(m)}</span><div className="mx6-b"><i style={{ width: (n / total) * 100 + '%' }} /></div></div>
              </li>
            ))}
          </ul>
          {omitidas.length > 0 && (
            <details className="mx-omitidas">
              <summary>Ver el listado de los {omitidas.length} omitidos</summary>
              <ul>{omitidas.map((o, i) => <li key={(o.codigo || o.id) + '-' + i}><b>{o.codigo || o.id}</b><span>{motivoTexto(o.motivo)}</span></li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function Corrida({ e }) {
  const omitidas = e.plan ? e.plan.omitidas : []
  const r = e.resumen
  const porMotivo = Object.entries(omitidas.reduce((a, o) => { a[o.motivo] = (a[o.motivo] || 0) + 1; return a }, {})).sort((x, y) => y[1] - x[1])
  const nadaQueGenerar = e.estado !== 'en_curso' && !!e.plan && e.plan.aGenerar === 0 && porMotivo.length > 0
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
      <AvisoTope e={e} />
      {nadaQueGenerar && <p className="mx-nada"><b>n8n revisó los recursos pero no generó ninguno.</b> {porMotivo.map(([m, n]) => n + ' × ' + motivoTexto(m)).join(' · ')}.</p>}
      {omitidas.length > 0 && (
        <details className="mx-omitidas">
          <summary>Qué se omitió y por qué ({omitidas.length})</summary>
          <ul>{omitidas.map((o, i) => <li key={(o.codigo || o.id) + '-' + i}><b>{o.codigo || o.id}</b><span>{motivoTexto(o.motivo)}</span></li>)}</ul>
        </details>
      )}
    </section>
  )
}

const I_CHECK = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
const I_ALERTA = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 6v7M12 17.5v.5" /></svg>
const I_RELOJ = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></svg>

// Una línea por recurso: generado (verde), por generar (círculo vacío), en proceso o con error.
function Fila({ r, editar, aprobar, regenerar, bloqueado, puedePublicar, hija, etiqueta }) {
  const mal = r.sinRespuesta || r.estado === 'ERROR'
  const hecho = r.estado === 'GENERADO' && !r.sinRespuesta
  const porRevisar = r.estado === 'POR_REVISAR' && !r.sinRespuesta
  const publicando = !!r.publicando && !r.publicandoSinRespuesta
  const k = publicando ? 'en' : hecho ? 'ok' : mal ? 'er' : porRevisar ? 'prev' : r.estado === 'EN_PROCESO' ? 'en' : 'pe'
  const texto = publicando ? 'Publicando…' : r.publicandoSinRespuesta ? 'Sin respuesta al publicar' : r.enColaRegenerar ? 'En cola para regenerar' : r.enCola && r.regenera ? 'Se regenerará' : porRevisar ? 'Por revisar' : r.enCola ? 'En cola' : hecho ? 'Generado' : r.sinRespuesta ? 'Sin avisos' : r.estado === 'ERROR' ? 'Con error' : r.estado === 'EN_PROCESO' ? (r.conContenido ? 'Regenerando…' : 'Generando') : 'Por generar'
  const nota = porRevisar ? '' : r.estado === 'ERROR' ? r.observaciones : r.omision ? 'Se omitió: ' + motivoTexto(r.omision) : hecho ? '' : r.observaciones
  return (
    <li className={'mx4-r ' + k + (hija ? ' hija' : '')}>
      <span className={'mx4-pt ' + k} aria-hidden="true">{hecho ? I_CHECK : mal ? I_ALERTA : null}</span>
      <span className="mx4-cod">{r.codigo || r.id}</span>
      {esUrlImagen(r.imagenUrl) && <a className="mx4-img" href={r.imagenUrl} target="_blank" rel="noopener noreferrer" title="Imagen del recurso (abrir)"><img src={r.imagenUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /></a>}
      {etiqueta && <span className="mx4-act">Actividad</span>}
      <span className="mx4-rt" title={r.titulo || ''}>{r.titulo || 'Sin título'}</span>
      <span className="mx4-re">{texto}</span>
      {r.alertaActividad && <span className="mx4-alerta" title={r.alertaActividad}>Alerta de actividad</span>}
      {r.correccion && <span className={'mx4-corr ' + r.correccion.estado}>{textoCorreccion(r.correccion)}</span>}
      <span className="mx4-rl">
        {r.conContenido && !publicando && !r.enCola && !r.enColaRegenerar && ['POR_REVISAR', 'GENERADO', 'ERROR'].includes(r.estado) && editar && <button type="button" className="mx4-ed" onClick={() => editar(r)} title="Corregir los textos del recurso antes de publicarlo">Editar textos</button>}
        {r.conContenido && !publicando && !r.enCola && !r.enColaRegenerar && ['POR_REVISAR', 'ERROR'].includes(r.estado) && puedePublicar && aprobar && !r.correccion && <button type="button" className="mx4-ed ok" onClick={() => aprobar(r)} title="Aprobar el contenido: n8n arma el H5P y lo sube a Drive">Aprobar y publicar</button>}
        {r.plantilla && !publicando && !r.enCola && (['POR_REVISAR', 'GENERADO', 'ERROR'].includes(r.estado) || r.sinRespuesta) && puedePublicar && regenerar && <button type="button" className="mx4-ed" disabled={!!r.enColaRegenerar || (r.correccion && r.correccion.estado === 'abierta')} onClick={() => regenerar(r)} title="Crear de nuevo con la misma plantilla">Regenerar</button>}
        {hecho && r.enlaceRecurso && <a href={r.enlaceRecurso} target="_blank" rel="noopener noreferrer">Recurso ↗</a>}
        {r.enlaceGuion && <a href={r.enlaceGuion} target="_blank" rel="noopener noreferrer">Guion ↗</a>}
        {r.consumo && <span className="mx4-cons" title="Tokens de texto y costo estimado de este recurso">{miles(tokensDe(r.consumo))} tokens · {usd(costoDe(r.consumo))}{r.consumo.costo_parcial ? ' (parcial)' : ''}</span>}
        {hecho && r.revisionPendiente > 0 && <span title="Campos que el generador dejó para revisión humana">REVISAR {r.revisionPendiente} campo{r.revisionPendiente === 1 ? '' : 's'}</span>}
        {r.plantilla && <a href={'https://proyectos.americana.edu.co/praxia/plantillas-html/ver/' + encodeURIComponent(r.plantilla)} target="_blank" rel="noopener noreferrer" title="Plantilla con la que se genera este recurso">{r.plantilla.toUpperCase()} ↗</a>}
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

// Unidades cuya lista de recursos H5P abrió la persona durante la sesión (la lista sale cerrada por defecto).
const listasAbiertas = {}
function Unidad({ clave, unidad, nombre, matriz, recursos, puede, ocupado, lanzar, enviada, desdeEnvio, editar, aprobar, regenerar, bloqueado, puedePublicar, fase }) {
  const [todos, setTodos0] = useState(() => !!listasAbiertas[clave])
  const setTodos = (v) => { listasAbiertas[clave] = !!v; setTodos0(!!v) }
  const [filtro, setFiltro] = useState('todos')
  const [confirmar, setConfirmar] = useState(false)
  const conteo = useMemo(() => {
    const c = { total: recursos.length, actividades: recursos.filter((r) => /-T\d+-A\d+$/i.test(String(r.codigo || ''))).length, PENDIENTE: 0, EN_PROCESO: 0, GENERADO: 0, ERROR: 0, enCola: 0, h5p: 0, otros: 0 }
    recursos.forEach((r) => { c[r.estado] = (c[r.estado] || 0) + 1; if (r.enCola) c.enCola++; if (String(r.generador || '').toUpperCase() === 'H5P') c.h5p++; else c.otros++ })
    return c
  }, [recursos])
  const nRev = conteo.POR_REVISAR || 0
  const esHecho = (r) => r.estado === 'GENERADO' && !r.sinRespuesta
  const filas = recursos.filter((r) => (filtro === 'generados' ? esHecho(r) : filtro === 'revisar' ? r.estado === 'POR_REVISAR' : filtro === 'pendientes' ? !esHecho(r) && r.estado !== 'POR_REVISAR' : true)).sort((a, b) => temaDe(a) - temaDe(b) || esHecho(b) - esHecho(a) || (b.estado === 'ERROR') - (a.estado === 'ERROR') || String(a.codigo || a.id).localeCompare(String(b.codigo || b.id), undefined, { numeric: true }))
  const porGenerar = conteo.PENDIENTE + conteo.EN_PROCESO
  const matrizMal = !!matriz && (matriz.estado === 'error' || !!matriz.sinRespuesta)
  const completa = conteo.total > 0 && conteo.GENERADO === conteo.total
  const estadoU = matrizMal || conteo.ERROR > 0 ? 'bad' : completa ? 'ok' : nRev > 0 ? 'prev' : conteo.GENERADO === 0 ? 'vacia' : 'en'
  const chipU = matrizMal ? 'Matriz con error' : completa ? 'Completa' : conteo.total === 0 ? 'Sin recursos' : conteo.ERROR > 0 ? 'Con errores' : conteo.POR_REVISAR > 0 ? 'Por revisar' : conteo.GENERADO === 0 ? 'Por generar' : conteo.EN_PROCESO > 0 ? 'Generando' : 'En progreso'
  const resumenU = matrizMal ? 'Hay que reintentar la matriz' : completa ? 'Matriz y recursos listos' : conteo.total === 0 ? 'Matriz lista · sin recursos todavía' : nRev > 0 ? (nRev === 1 ? '1 recurso generado, listo para revisar' : nRev + ' recursos generados, listos para revisar') + (conteo.total - conteo.GENERADO - nRev > 0 ? ' · faltan ' + (conteo.total - conteo.GENERADO - nRev) + ' por generar' : '') : conteo.GENERADO === 0 ? 'Matriz lista · recursos H5P sin generar' : 'Matriz lista · faltan ' + (conteo.total - conteo.GENERADO) + ' recursos'
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
        {matriz.matrizUrl && <a className="mx4-lk" href={matriz.matrizUrl} target="_blank" rel="noopener noreferrer" title={matriz.matrizNombre || ''} aria-label={'Abrir la matriz de la Unidad ' + unidad + ' (se abre en otra pestaña)'}>Abrir matriz<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></svg></a>}
        {puede && matrizMal && <button type="button" className="btn sm" disabled={ocupado} onClick={() => lanzar([unidad], false)}>Reintentar la matriz</button>}
        {fase === 1 && puede && !matrizMal && ['creada', 'omitida', 'reemplazada', 'actualizada'].includes(matriz.estado) && !confirmar && (
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

      {fase === 2 && nRev > 0 && (
        <div className="mx4-cta" role="status">
          <span className="mx4-cta-ic" aria-hidden="true">{I_CHECK}</span>
          <div className="mx4-cta-tx">
            <b>{nRev === 1 ? 'Hay 1 recurso listo para revisar' : 'Hay ' + nRev + ' recursos listos para revisar'}</b>
            <span>Los textos ya se generaron y están en Praxia, todavía sin publicar. Revíselos, corrija lo que haga falta con «Editar textos» y apruebe para publicarlos en Drive.</span>
          </div>
          <button type="button" className="mx4-cta-b" disabled={todos && filtro === 'revisar'} onClick={() => { setTodos(true); setFiltro('revisar') }}>{todos && filtro === 'revisar' ? 'Están aquí abajo ↓' : 'Revisar ahora'}</button>
        </div>
      )}

      {/* El avance y la lista de recursos H5P se ven en la fase «Recursos H5P»; en la de matrices no se repiten. */}
      {conteo.total > 0 && fase === 2 && (
        <div className="mx4-paso mx4-rec">
          <div className="mx4-fila-h5p">
            <span className={'mx4-ic ' + (completa ? 'ok' : 'n')} aria-hidden="true">2</span>
            <div className="mx4-paso-tx">
              <b>Recursos H5P</b>
              <span className="mx4-cifra"><strong>{conteo.GENERADO}</strong> de {conteo.total} generados{conteo.actividades > 0 && <em className="mx4-cifra-rv">{conteo.actividades} son actividades</em>}{nRev > 0 && <em className="mx4-cifra-rv">{nRev} por revisar</em>}{conteo.enCola > 0 && <em className="mx4-cifra-rv">{conteo.enCola} en cola</em>}{conteo.ERROR > 0 ? ' · ' + conteo.ERROR + ' con error' : ''}</span>
            </div>
            <button type="button" className="mx4-ver" aria-expanded={todos} onClick={() => setTodos(!todos)}>
              {todos ? 'Ocultar recursos' : 'Ver recursos (' + conteo.total + ')'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: todos ? 'rotate(180deg)' : 'none' }}><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </div>
          <div className="mx4-barra" role="img" aria-label={conteo.GENERADO + ' generados de ' + conteo.total}>
            <i className="ok" style={{ width: (conteo.GENERADO / conteo.total) * 100 + '%' }} />
            {nRev > 0 && <i className="prev" style={{ width: (nRev / conteo.total) * 100 + '%' }} />}
            {conteo.ERROR > 0 && <i className="er" style={{ width: (conteo.ERROR / conteo.total) * 100 + '%' }} />}
          </div>
          {todos && (
            <div className="mx4-lista-w">
              <div className="mx4-filtros" role="tablist" aria-label="Filtrar recursos">
                {[['todos', 'Todos', conteo.total], ['revisar', 'Por revisar', conteo.POR_REVISAR || 0], ['generados', 'Generados', conteo.GENERADO], ['pendientes', 'Por generar', conteo.total - conteo.GENERADO - (conteo.POR_REVISAR || 0)]].map(([k, t, n]) => (
                  <button key={k} type="button" role="tab" aria-selected={filtro === k} className={'mx4-f ' + k + (filtro === k ? ' on' : '')} onClick={() => setFiltro(k)}>{t} <b>{n}</b></button>
                ))}
              </div>
              <ul className="mx4-lista">{(() => {
                const cod = (r) => String(r.codigo || r.id || '')
                const pos = (r) => { const x = /-([RA])(\d+)$/i.exec(cod(r)); return x ? Number(x[2]) : Infinity }
                const esAct = (r) => /-T\d+-A\d+$/i.test(cod(r))
                const clave = (r) => cod(r).replace(/-[RA](\d+)$/i, '').toUpperCase() + '|' + pos(r)
                const mk = (r, extra) => <Fila key={r.id} r={r} editar={editar} aprobar={aprobar} regenerar={regenerar} bloqueado={bloqueado} puedePublicar={puedePublicar} {...extra} />
                const pres = filas.filter((r) => /-PRES$/i.test(cod(r)))
                const resto = filas.filter((r) => !/-PRES$/i.test(cod(r)))
                const recs = resto.filter((r) => !esAct(r))
                const acts = resto.filter(esAct)
                const dueño = new Set(recs.map(clave))
                const hijas = {}
                acts.forEach((a) => { if (dueño.has(clave(a))) (hijas[clave(a)] = hijas[clave(a)] || []).push(a) })
                // Recursos por posición numérica (R1, R2…); las actividades sueltas (sin su recurso) van como filas normales.
                const items = [...recs, ...acts.filter((a) => !dueño.has(clave(a)))].sort((a, b) => temaDe(a) - temaDe(b) || pos(a) - pos(b) || (esAct(a) - esAct(b)) || cod(a).localeCompare(cod(b), undefined, { numeric: true }))
                const out = []
                if (pres.length) out.push(<li key="pres" className="mx4-tema">Presentación de la unidad</li>, ...pres.map((r) => mk(r)))
                let ult = null
                items.forEach((r) => {
                  const t = temaDe(r)
                  if (t !== ult) { ult = t; out.push(<li key={'tema-' + t} className="mx4-tema">{t === 0 ? 'Sin tema' : 'Tema ' + t}</li>) }
                  out.push(mk(r, esAct(r) ? { etiqueta: true } : {}))
                  ;(hijas[clave(r)] || []).forEach((a) => { if (!esAct(r)) out.push(mk(a, { hija: true, etiqueta: true })) })
                })
                return out
              })()}</ul>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

// Lo que la corrida en curso planificó y todavía no empezó se muestra «en cola» desde el primer momento, para saber cuántos faltan. Si ya tenía algo generado (se puso en
// PENDIENTE en la matriz), se avisa que se regenerará.
function marcarEnCola(data) {
  const e = (data.ejecuciones || []).find((x) => x.etapa === 'h5p')
  if (!e || e.estado !== 'en_curso' || e.sinRespuesta || !e.plan || !Array.isArray(e.plan.aGenerarClaves) || !e.plan.aGenerarClaves.length) return data
  const codigos = new Set(), ids = new Set()
  e.plan.aGenerarClaves.forEach((k) => { if (k.codigo) codigos.add(k.codigo); else ids.add(k.id) })
  // Un recurso del plan que ya cambió de estado DESPUÉS de empezar la corrida ya se procesó en ella (no está en cola ni «se regenerará»).
  const inicio = Date.parse(e.iniciadoEn) || 0
  const yaHecho = (r) => r.estado !== 'PENDIENTE' && inicio && (Date.parse(r.actualizadoEn) || 0) >= inicio
  return { ...data, recursos: data.recursos.map((r) => (r.estado !== 'EN_PROCESO' && !yaHecho(r) && (codigos.has(r.codigo) || (!r.codigo && ids.has(r.id))) ? { ...r, enCola: true, regenera: r.estado !== 'PENDIENTE' } : r)) }
}

export default function MatricesH5P({ s, propietario, soloLectura = false }) {
  const [confirmar, dialogo] = useConfirmar()
  const api = (metodo, ruta, cuerpo) => apiBase(metodo, conPropietario(ruta, propietario), cuerpo) // con propietario: el diseñador actúa en nombre del dueño del curso
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [, tic] = useState(0)
  const [lanzando, setLanzando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [faseSel, setFaseSel] = useState(null) // fase elegida a mano (1 = Matrices, 2 = Recursos H5P); null = la que corresponde al estado
  const [yaEnCurso, setYaEnCurso] = useState(0) // el servidor dijo que ya hay una generación en marcha
  const [enviadas, setEnviadas] = useState([]) // unidades cuya matriz se pidió hace poco
  // Aprobar = pedir a n8n que arme el .h5p y lo suba a Drive; si ya estaba publicado, reemplaza el contenido del mismo archivo. Lanza el error para que quien llama lo muestre.
  const aprobarRecurso = async (r) => {
    if (r.estado === 'GENERADO' && !(await confirmar({ titulo: '¿Volver a publicar el recurso?', texto: 'Este recurso ya está publicado en Drive. Se reemplazará el contenido del mismo archivo (no se crea un duplicado).', tono: 'aviso', textoConfirmar: 'Aprobar y publicar' }))) return false
    await api('POST', '/proyectos/' + encodeURIComponent(s.id) + '/pipeline/recursos/' + encodeURIComponent(r.id) + '/aprobar')
    setAviso('Se aprobó ' + (r.codigo || r.id) + '. n8n está armando el H5P y subiéndolo a Drive; aparecerá como Generado en unos instantes.')
    cargar()
    return true
  }
  // Regenerar = crear de nuevo con la misma plantilla; queda un borrador «Por revisar» y publicarlo reemplaza el archivo ya publicado.
  const marcarRegenerando = (codigos, encolado) => setD((x) => x && ({ ...x, recursos: x.recursos.map((r) => (codigos.includes(r.codigo) ? (encolado ? { ...r, enColaRegenerar: true } : { ...r, estado: 'EN_PROCESO', conContenido: true, sinRespuesta: false }) : r)) }))
  const regenerarRecurso = async (r) => {
    if (!(await confirmar({ titulo: '¿Regenerar este recurso?', texto: 'Se creará de nuevo con la misma plantilla y se perderán las ediciones hechas a mano.\nSi ya estaba publicado, el archivo se reemplazará solo cuando vuelva a aprobarlo.', tono: 'peligro', icono: IconoAviso, textoConfirmar: 'Regenerar' }))) return false
    const resp = await api('POST', '/proyectos/' + encodeURIComponent(s.id) + '/pipeline/h5p', { regenerar: [r.codigo] })
    if (resp && resp.encolado) setAviso(r.codigo + ' quedó en cola para regenerar: empieza apenas termine la corrida en curso (' + resp.en_cola + (resp.en_cola === 1 ? ' recurso' : ' recursos') + ' en cola).')
    else {
      setLanzadoEn(Date.now()); setYaEnCurso(0); setEnviadas([])
      setAviso('Regenerando… ' + r.codigo + ' aparecerá como «Por revisar» cuando n8n termine.')
    }
    marcarRegenerando([r.codigo], !!(resp && resp.encolado))
    cargar()
    return true
  }
  // Regenerar todo el curso: manda los códigos desactualizados; n8n omite lo que pase de su máximo por corrida y Praxia restaura esos (AvisoTope avisa cuántos quedan).
  const regenerarDesactualizados = async () => {
    const x = d && d.desactualizados
    if (!x || !x.total) return
    const costo = x.costoEstimadoUsd == null ? null : Number(x.costoEstimadoUsd) || 0 // el servidor solo lo envía a administradores
    if (!(await confirmar({ titulo: '¿Regenerar todo el curso?', texto: 'Se regenerarán ' + x.total + (x.total === 1 ? ' recurso' : ' recursos') + ' con su actividad y su bibliografía (si la tienen).' + (costo == null ? '' : '\nCosto estimado: ≈ US$ ' + costo.toFixed(2) + ' (es una estimación).') + '\nSe perderán las ediciones hechas a mano; cada archivo .h5p publicado se reemplazará solo cuando usted vuelva a aprobarlo.', tono: 'peligro', textoConfirmar: 'Regenerar' }))) return
    try {
      const resp = await api('POST', '/proyectos/' + encodeURIComponent(s.id) + '/pipeline/h5p', { regenerar: x.codigos })
      if (resp && resp.encolado) setAviso(x.total + ' recursos quedaron en cola para regenerar: empiezan apenas termine la corrida en curso.')
      else {
        setLanzadoEn(Date.now()); setYaEnCurso(0); setEnviadas([])
        setAviso('Regenerando ' + x.total + ' recursos… aparecerán como «Por revisar» cuando n8n termine.')
      }
      marcarRegenerando(x.codigos, !!(resp && resp.encolado))
      cargar()
    } catch (e) { setError(e.message || 'No se pudo regenerar el curso.') }
  }
  const regenerarDesdeFila = async (r) => { try { await regenerarRecurso(r) } catch (e) { setError(e.message || 'No se pudo regenerar el recurso.') } }
  const aprobarDesdeFila = async (r) => {
    if (r.alertaActividad) {
      const dec = await confirmar({ titulo: 'Este recurso tiene una alerta', texto: r.alertaActividad + '\nSi lo aprueba ahora, se publicará sin actividad. Lo recomendable es pedir la corrección al docente.', tono: 'aviso', textoConfirmar: 'Abrir el recurso para pedir corrección', textoSecundario: 'Aprobar de todas formas' })
      if (!dec) return
      if (dec === true) { setEditando(r); return }
    }
    try { await aprobarRecurso(r) } catch (e) { setError(e.message || 'No se pudo aprobar el recurso.') } }
  const [editando, setEditando] = useState(null) // recurso abierto en el editor de textos
  const [parteEd, setParteEd] = useState(() => leerHash('parte')) // parte abierta en el editor (queda en la dirección)
  const hashLeido = useRef(false)
  // Recargar la página no saca del editor: la dirección guarda el recurso (?r=código) y la parte (&parte=); al llegar la lista se vuelve a abrir.
  useEffect(() => {
    if (hashLeido.current || !d) return
    hashLeido.current = true
    const k = leerHash('r')
    const r = k && d.recursos.find((x) => (x.codigo || x.id) === k && String(x.generador || '').toUpperCase() === 'H5P')
    if (r) setEditando(r); else if (k) ponerHash({ r: '', parte: '' })
  }, [d])
  useEffect(() => {
    if (!hashLeido.current && !editando) return // todavía no se leyó la dirección: no se borra
    ponerHash(editando && !editando.esperando ? { r: editando.codigo || editando.id, parte: parteEd !== 'recurso' ? parteEd : '' } : { r: '', parte: '' })
  }, [editando, parteEd])
  const [lanzadoEn, setLanzadoEn] = useState(0) // hasta que n8n avise del inicio pasan unos segundos: mientras tanto se sigue refrescando

  const cargar = useCallback(async () => {
    setCargando(true)
    try { setD(marcarEnCola(await api('GET', '/proyectos/' + encodeURIComponent(s.id) + '/pipeline'))); setError('') } catch (e) { setError(e.message || 'No se pudo cargar') }
    setCargando(false)
  }, [s.id])
  useEffect(() => { cargar() }, [cargar])

  // Las unidades pedidas ya tienen su resultado (matriz lista o con error, avisado DESPUÉS de pedirla): no hay nada más que esperar,
  // aunque no hayan pasado los 2 minutos de margen que se dan para que n8n avise del inicio.
  const pedidasTerminadas = !!d && enviadas.length > 0 && lanzadoEn > 0 && enviadas.every((n) => {
    const m = d.matrices.find((x) => x.unidad === n)
    return !!m && m.estado !== 'generando' && new Date(m.actualizadoEn).getTime() >= lanzadoEn - 15000
  })
  const lanzadoReciente = !pedidasTerminadas && ((lanzadoEn > 0 && Date.now() - lanzadoEn < 120000) || (yaEnCurso > 0 && Date.now() - yaEnCurso < 600000))
  const enProgreso = lanzadoReciente || !!d && (d.matrices.some((m) => m.estado === 'generando' && !m.sinRespuesta) || d.ejecuciones.some((e) => e.estado === 'en_curso' && !e.sinRespuesta) || d.recursos.some((r) => (r.publicando && !r.publicandoSinRespuesta) || r.estado === 'EN_PROCESO' && !r.sinRespuesta || r.enColaRegenerar))
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

  const lanzar = useCallback(async (nums, forzar, conservar) => {
    setLanzando(true); setError(''); setAviso('')
    try {
      await api('POST', '/proyectos/' + encodeURIComponent(s.id) + '/pipeline/matrices', { unidades: nums, forzar, ...(conservar ? { conservar: true } : {}) })
      setLanzadoEn(Date.now()); setYaEnCurso(0); setEnviadas(nums); setFaseSel(1)
      setAviso((conservar ? 'Se pidió agregar las actividades a' : forzar ? 'Se pidió volver a generar' : 'Se pidió generar') + (nums.length === 1 ? ' la matriz de la Unidad ' + nums[0] : ' las matrices de las unidades ' + nums.join(', ')) + '. n8n la está preparando; esta pantalla se actualiza sola.')
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
    const creadas = d.matrices.filter((m) => ['creada', 'omitida', 'reemplazada', 'actualizada'].includes(m.estado)).length
    const h5p = d.recursos.filter((r) => String(r.generador || '').toUpperCase() === 'H5P')
    return { creadas, unidades: unidades.length, h5p: h5p.length, generados: h5p.filter((r) => r.estado === 'GENERADO').length, errores: d.recursos.filter((r) => r.estado === 'ERROR').length }
  }, [d, unidades.length])
  const ultimaH5P = d && d.ejecuciones.find((e) => e.etapa === 'h5p')
  const corridaNueva = !!ultimaH5P && ultimaH5P.estado !== 'en_curso' && lanzadoEn > 0 && enviadas.length === 0 && new Date(ultimaH5P.ultimoEventoEn).getTime() >= lanzadoEn - 15000 // la corrida pedida ya terminó
  const puede = !soloLectura && !!(d && d.puedeGenerarMatrices) // el docente solo lee: las matrices y los H5P los genera el diseñador
  const ocupado = lanzando || lanzadoReciente || !!(d && (d.matrices.some((m) => m.estado === 'generando' && !m.sinRespuesta) || d.ejecuciones.some((e) => e.etapa === 'matrices' && e.estado === 'en_curso' && !e.sinRespuesta)))
  const puedeH5p = !soloLectura && !!(d && d.puedeGenerarH5p)
  const puedePublicar = !soloLectura && !!(d && d.puedePublicar)
  const listas = d ? d.matrices.filter((m) => ['creada', 'omitida', 'reemplazada', 'actualizada'].includes(m.estado) && !m.sinRespuesta).length : 0
  const h5pOcupado = lanzando || (lanzadoReciente && !corridaNueva) || !!(d && d.ejecuciones.some((e) => e.etapa === 'h5p' && e.estado === 'en_curso' && !e.sinRespuesta))
  const conError = d ? d.recursos.filter((r) => r.estado === 'ERROR').length : 0
  const porRevisarTotal = d ? d.recursos.filter((r) => r.estado === 'POR_REVISAR').length : 0
  // Recursos H5P con contenido que ya se puede abrir en el editor: primero los por revisar, luego los que dieron error y al final los publicados
  const editables = d ? d.recursos.filter((r) => String(r.generador || '').toUpperCase() === 'H5P' && r.conContenido && ['POR_REVISAR', 'ERROR', 'GENERADO'].includes(r.estado)).sort((a, b) => ({ POR_REVISAR: 0, ERROR: 1, GENERADO: 2 }[a.estado] - { POR_REVISAR: 0, ERROR: 1, GENERADO: 2 }[b.estado]) || (a.unidad || 0) - (b.unidad || 0) || String(a.codigo || a.id).localeCompare(String(b.codigo || b.id))) : []
  const h5pActivo = !!d && (lanzadoReciente || d.recursos.some((r) => String(r.generador || '').toUpperCase() === 'H5P' && (r.estado === 'EN_PROCESO' || r.enCola)))
  const ESPERA = { id: '__espera', codigo: 'Editor de recursos', titulo: 'Esperando que se genere el primero', conContenido: false, estado: 'PENDIENTE', esperando: true }
  useEffect(() => { if (editando && editando.esperando && editables.length > 0) setEditando(editables[0]) }, [editando, editables.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const pendientes = d ? d.recursos.filter((r) => r.estado === 'PENDIENTE' && String(r.generador || '').toUpperCase() === 'H5P').length : 0
  const aprobadas = new Set((s.syllabus.documentos || []).filter((x) => x.aprobado).map((x) => x.unidad))
  const faltan = d ? unidades.map((u) => u.unidad).filter((n) => aprobadas.has(n) && (() => { const m = d.matrices.find((x) => x.unidad === n); return !m || m.estado === 'error' || m.sinRespuesta })()) : []

  const enCursoMat = d ? d.matrices.filter((m) => m.estado === 'generando' && !m.sinRespuesta) : []
  const corridaH5p = ultimaH5P && ultimaH5P.estado === 'en_curso' && !ultimaH5P.sinRespuesta ? ultimaH5P : null
  const soloEnviado = lanzadoReciente && !corridaNueva && !enCursoMat.length && !corridaH5p
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
      {dialogo}
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
            <span className="mx3-anillo" aria-hidden="true"><CargaRecurso tam="medio" /></span>
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
            {(puedeH5p || soloLectura) && <button type="button" className="mx3-gran" onClick={() => setFaseSel(2)}>Ir a los recursos H5P</button>}
          </div>
        </section>
      )}

      {d && fase === 2 && (editables.length > 0 || h5pActivo) && (
        <section className={'mx7-ed' + (porRevisarTotal > 0 ? ' prev' : '')} aria-label="Editor de recursos H5P">
          <span className="mx7-ed-ic" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg></span>
          <div className="mx7-ed-tx">
            <b>Editor de recursos H5P</b>
            <span>{editables.length === 0 ? 'Los recursos se irán habilitando en el editor a medida que se generen.' : porRevisarTotal > 0 ? (porRevisarTotal === 1 ? 'Hay 1 recurso listo para revisar.' : 'Hay ' + porRevisarTotal + ' recursos listos para revisar.') : editables.length === 1 ? '1 recurso generado se puede revisar.' : editables.length + ' recursos generados se pueden revisar.'} Ábralo para ver la lista completa, corregir textos y aprobar sin desplegar cada recurso.</span>
          </div>
          <button type="button" className="mx7-ed-b" onClick={() => setEditando(editables[0] || ESPERA)}>Abrir el editor<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
        </section>
      )}

      {d && fase === 2 && !(enCursoMat.length > 0 || corridaH5p || soloEnviado) && puedeH5p && listas > 0 && !todoAlDia && (
        <section className="mx6-card" aria-label="Generar recursos H5P">
          <div className="mx6-top">
            <span className="mx6-ico" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14" /></svg></span>
            <div className="mx6-tx">
              <span className="mx6-etq">PASO 2 · RECURSOS H5P</span>
              <h3>Genere los recursos interactivos</h3>
              <p>n8n arma un recurso H5P por cada guion de las matrices listas.</p>
            </div>
            <div className="mx6-btns">
              {conError > 0 && <button type="button" className="btn sec" disabled={h5pOcupado} onClick={() => lanzarH5p(true)}>Reintentar los {conError} con error</button>}
              <button type="button" className="mx6-gen" disabled={h5pOcupado} onClick={() => lanzarH5p(false)}>{lanzando ? 'Enviando…' : 'Generar H5P'}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
            </div>
          </div>
          <AvisoTope e={ultimaH5P} />
          <div className="mx6-stats">
            {porRevisarTotal > 0 && <div className="mx6-rev"><b>{porRevisarTotal}</b><span>{porRevisarTotal === 1 ? 'recurso listo para revisar' : 'recursos listos para revisar'}</span><small>Ya están generados: ábralos abajo, en su unidad.</small></div>}
            <div className="mx6-pend"><b>{pendientes}</b><span>{pendientes === 1 ? 'recurso por generar' : 'recursos por generar'}</span></div>
            {unidades.map((u) => {
              const rs = d.recursos.filter((r) => r.unidad === u.unidad)
              const hechos = rs.filter((r) => r.estado === 'GENERADO' && !r.sinRespuesta).length
              const porRev = rs.filter((r) => r.estado === 'POR_REVISAR').length
              return (
                <div key={u.unidad} className="mx6-u">
                  <div><b>Unidad {u.unidad}</b><span><strong>{hechos}</strong> / {rs.length}{porRev > 0 && <em className="mx6-u-rv"> · {porRev} por revisar</em>}</span></div>
                  <div className="mx6-ub" role="img" aria-label={hechos + ' de ' + rs.length + ' generados' + (porRev ? ', ' + porRev + ' por revisar' : '')}><i style={{ width: (rs.length ? (hechos / rs.length) * 100 : 0) + '%' }} />{porRev > 0 && <i className="prev" style={{ width: (porRev / rs.length) * 100 + '%' }} />}</div>
                </div>
              )
            })}
          </div>
          {ultimaH5P && <CorridaFranja e={ultimaH5P} />}
        </section>
      )}
      {d && !puedeH5p && !soloLectura && listas > 0 && <p className="help" style={{ marginTop: 10 }}>La generación de H5P desde Praxia todavía no está activada en este servidor.</p>}

      {d && fase === 2 && todoAlDia && !(enCursoMat.length > 0 || corridaH5p || soloEnviado) && (
        <section className="mx3-ahora listo">
          <div className="mx3-ahora-fila">
            <span className="mx3-ico ok" aria-hidden="true">{I_CHECK}</span>
            <div className="mx3-ahora-tx"><span className="mx3-etq">TODO AL DÍA</span><h3>Las matrices y los recursos H5P están listos</h3></div>
          </div>
        </section>
      )}

      {d && fase === 2 && puedeH5p && puedePublicar && d.desactualizados && d.desactualizados.total > 0 && !(enCursoMat.length > 0 || corridaH5p || soloEnviado) && (
        <section className="mx-nada" role="status" style={{ background: '#fff7e0', border: '1px solid #e0a800', padding: '10px 14px', borderRadius: 8, margin: '10px 0' }}>
          <p style={{ margin: 0 }}><b>La matriz se actualizó con actividades.</b> {d.desactualizados.total} {d.desactualizados.total === 1 ? 'recurso ya generado no incluye' : 'recursos ya generados no incluyen'} su actividad ni su bibliografía.</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn sm" disabled={h5pOcupado} onClick={regenerarDesactualizados}>Regenerar todo el curso</button>
            <details><summary>Ver cuáles</summary><p style={{ margin: '6px 0 0' }}>{d.desactualizados.codigos.join(', ')}</p></details>
          </div>
          {todoAlDia && <AvisoTope e={ultimaH5P} />}
        </section>
      )}

      {fase === 2 && ultimaH5P && !corridaH5p && !(d && !(enCursoMat.length > 0 || corridaH5p || soloEnviado) && puedeH5p && listas > 0 && !todoAlDia) && <Corrida e={ultimaH5P} />}

      {d && (() => {
        const rs = d.recursos.filter((r) => String(r.generador || '').toUpperCase() === 'H5P')
        const c = resumenConsumo(rs)
        if (!c.conConsumo) return null
        return (
          <section className="mx4-consumo" aria-label="Consumo del curso">
            <h4 className="mx2-h mx3-h">Consumo del curso{c.parcial ? ' (parcial)' : ''}</h4>
            <div className="mx4-consumo-f">
              <span><b>{miles(c.tokens)}</b> tokens</span>
              <span><b>{c.imagenes}</b> {c.imagenes === 1 ? 'imagen' : 'imágenes'}</span>
              <span><b>{usd(c.costo)}</b> costo estimado{c.parcial ? ' (parcial)' : ''}</span>
            </div>
            {c.parcial && <small>Hay recursos sin consumo avisado o con costo parcial: el total puede ser mayor.</small>}
          </section>
        )
      })()}

      {d && (
        <>
          <h4 className="mx2-h mx3-h">Unidades</h4>
          <div className="mx-grid mx3-lista">
            {unidades.map((u) => (
              <Unidad key={u.unidad} clave={String((s && s.id) || '') + ':' + u.unidad} unidad={u.unidad} nombre={u.nombre} matriz={d.matrices.find((m) => m.unidad === u.unidad)} recursos={d.recursos.filter((r) => r.unidad === u.unidad)} puede={puede} ocupado={ocupado} lanzar={lanzar} enviada={lanzadoReciente && enviadas.includes(u.unidad)} desdeEnvio={yaEnCurso ? 0 : lanzadoEn} editar={setEditando} aprobar={aprobarDesdeFila} regenerar={regenerarDesdeFila} bloqueado={h5pOcupado} puedePublicar={puedePublicar} fase={fase} />
            ))}
          </div>
        </>
      )}
      {editando && <EditorRecurso proyecto={s.id} propietario={propietario} soloLectura={soloLectura} recurso={editando} recursos={d ? d.recursos.filter((r) => String(r.generador || '').toUpperCase() === 'H5P') : []} puedePublicar={puedePublicar} onAprobar={aprobarRecurso} onRegenerar={regenerarRecurso} parteInicial={parteEd} onParte={setParteEd} onElegir={(r) => { setParteEd('recurso'); setEditando(r) }} onActualizar={cargar} onCerrar={() => { setEditando(null); cargar() }} />}
    </div>
  )
}
