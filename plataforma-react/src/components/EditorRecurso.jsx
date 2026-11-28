import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CargaRecurso from './CargaRecurso.jsx'
import { api as apiBase, conPropietario, RUTA_API } from '../lib/api.js'
import { tokensDe, costoDe, imagenesDe, usd, miles, esUrlImagen } from '../lib/consumo.js'
import codigoEditor from '../lib/editor-campos.js?raw'
import PanelCorreccion from './PanelCorreccion.jsx'
import { useConfirmar } from './Confirmar.jsx'
import './editor-recurso.css'

// Editor de un recurso H5P ya generado: se pinta la plantilla con el contenido (JSON) que guardó el flujo, dentro de un iframe aislado (sandbox sin
// allow-same-origin: sus scripts no pueden usar la sesión de Praxia), y con un clic en un texto se edita ese campo del JSON. Solo se cambian textos:
// el servidor rechaza cualquier cambio de estructura. «Descargar .h5p» lo arma el servidor con el servicio de plantillas (la clave no llega al navegador).
// El módulo del iframe (src/lib/editor-campos.js) viene del servicio de H5P; habla con esta pantalla por postMessage ({ fuente: 'praxia-editor', … }).

const NIVEL = { tecnologico: 'tecnologia', profesional: 'profesional', especializacion: 'especializacion', doctorado: 'doctorado' }
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const json = (o) => JSON.stringify(o).replace(/<\//g, '<\\/') // dentro de un <script>

function ponerRuta(obj, ruta, valor) {
  const ks = ruta.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let a = obj
  for (let i = 0; i < ks.length - 1; i++) { a = a == null ? a : a[ks[i]]; if (a == null) return false }
  if (a == null) return false
  a[ks[ks.length - 1]] = valor
  return true
}

// La página de la plantilla con el contenido puesto (igual que la vista de ejemplo) y el editor inyectado.
// IMAGEN_EJEMPLO: la plantilla declara la imagen principal en una constante; en el .h5p final la librería la reemplaza por imagen_url. Aquí se hace igual.
const RE_IMG = /(IMAGEN_EJEMPLO\s*=\s*)(?:'([^']*)'|"([^"]*)")/
// Mapa exacto de textos: el módulo del editor se evalúa aquí (sin tocar la página) solo para marcar el contenido con centinelas invisibles.
let moduloEditor
function editorMarcas() {
  if (moduloEditor === undefined) {
    try { const g = {}; new Function('window', codigoEditor)(g); moduloEditor = g.PraxiaEditor || null } catch { moduloEditor = null }
  }
  return moduloEditor
}
// marcado: { rutas } → página para el iframe oculto (contenido ya marcado); calcula el mapa ruta → posición en el DOM y lo envía al padre.
function armarPagina(esqueleto, contenido, titulo, formacion, activo, imagenUrl, marcado) {
  const marca = NIVEL[formacion] ? '<script>window.__NIVEL=' + JSON.stringify(NIVEL[formacion]) + '</script>' : ''
  let h = esqueleto.replace('{{TITULO}}', () => esc(titulo || 'Recurso')).replace('/*CONTENIDO*/', () => json(contenido))
  const original = (RE_IMG.exec(h) || [])[2] ?? (RE_IMG.exec(h) || [])[3]
  const usar = esUrlImagen(imagenUrl) ? imagenUrl : ''
  if (usar && original !== undefined) h = h.replace(RE_IMG, (_m, pre) => pre + JSON.stringify(usar))
  const imagenes = [usar, original].filter((u) => u)
  { const leyendas = '<style>figure figcaption{display:none!important}</style>'; h = /<head(?:\s[^>]*)?>/i.test(h) ? h.replace(/<head(?:\s[^>]*)?>/i, (m) => m + leyendas) : leyendas + h } // las leyendas no se ven (igual que en la librería H5P)
  if (usar && original !== undefined) { const est = '<style>.figura-marca{display:none !important}</style>'; h = /<\/head>/i.test(h) ? h.replace(/<\/head>/i,() => est + '</head>') : est + h } // con imagen reemplazada no se muestra el rótulo «Imagen de ejemplo»
  if (marca) h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => m + marca) : marca + h
  if (marcado) {
    const err = '<script>window.__praxiaErr=0;window.addEventListener("error",function(){window.__praxiaErr++});window.addEventListener("unhandledrejection",function(){window.__praxiaErr++})</script>'
    h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => m + err) : err + h
    const mapeo = '<script>' + codigoEditor + '</script><script>PraxiaEditor.mapear({ rutas: ' + json(marcado.rutas) + ' })</script>'
    return /<\/body>/i.test(h) ? h.replace(/<\/body>/i, () => mapeo + '</body>') : h + mapeo
  }
  const editor = '<script>' + codigoEditor + '</script><script>PraxiaEditor.iniciar({ contenido: ' + json(contenido) + ', activo: ' + (activo ? 'true' : 'false') + ', imagenes: ' + json(imagenes) + ', imagenNueva: ' + json(usar) + ', imagenOriginal: ' + json(original || '') + ' })</script>'
  return /<\/body>/i.test(h) ? h.replace(/<\/body>/i, () => editor + '</body>') : h + editor
}

// Lista de recursos del curso (lado izquierdo del editor): los generados, los que se están generando y los que esperan revisión, agrupados por unidad,
// con un botón rápido para aprobar cada uno y otro para aprobar todos los de una unidad. Solo lee `recursos` (ya vienen de la pantalla de Matrices y H5P).
// Tema de un recurso: el que avisó n8n o, si falta, el del código («U1-T4-R6» → 4). 0 = sin tema.
const temaDe = (r) => { if (r.tema != null && Number.isFinite(Number(r.tema))) return Number(r.tema); const m = /-T(\d+)-/i.exec(r.codigo || ''); return m ? Number(m[1]) : 0 }
// El guion (Google Doc) se muestra incrustado en modo de solo lectura (/preview) para leerlo y compararlo con el recurso; si no es un Doc de Google no se incrusta.
const vistaGuion = (url, editar) => { const m = /^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/.exec(String(url || '')); return m ? 'https://docs.google.com/document/d/' + m[1] + (editar ? '/edit?rm=minimal' : '/preview') : '' }
const CLAVE_MODO_GUION = 'praxia.guion.modo'
const ORDEN_ESTADO = { POR_REVISAR: 0, ERROR: 1, EN_PROCESO: 2, GENERADO: 3, PENDIENTE: 4 }
const TEXTO_ESTADO = { POR_REVISAR: 'Por revisar', ERROR: 'Con error', EN_PROCESO: 'Generando', GENERADO: 'Generado', PENDIENTE: 'Por generar' }

function ListaRecursos({ recursos, actualId, puedePublicar, sucio, onElegir, onAprobar }) {
  const [filtro, setFiltro] = useState(() => (recursos.some((r) => r.estado !== 'PENDIENTE' || r.enCola) ? 'con' : 'todos')) // con = los que ya tienen algo que ver; revisar; todos
  const [confirmar, dialogo] = useConfirmar()
  const [cerradas, setCerradas] = useState({})
  const [ocupados, setOcupados] = useState({}) // id → true mientras se aprueba
  const [unidadBusy, setUnidadBusy] = useState(null)
  const [aviso, setAviso] = useState(null) // { tipo, texto }
  const conteo = useMemo(() => {
    const c = { total: recursos.length, revisar: 0, generando: 0, generados: 0, errores: 0, pendientes: 0, enCola: 0 }
    recursos.forEach((r) => {
      if (r.estado === 'POR_REVISAR') c.revisar++
      else if (r.estado === 'EN_PROCESO') c.generando++
      else if (r.estado === 'GENERADO') c.generados++
      else if (r.estado === 'ERROR') c.errores++
      else if (r.enCola) c.enCola++
      else c.pendientes++
    })
    return c
  }, [recursos])
  const pasa = (r) => (filtro === 'todos' ? true : filtro === 'revisar' ? r.estado === 'POR_REVISAR' : r.estado !== 'PENDIENTE' || !!r.enCola)
  const grupos = useMemo(() => {
    const m = new Map()
    recursos.filter(pasa).forEach((r) => { const u = r.unidad == null ? 0 : r.unidad; const t = temaDe(r); if (!m.has(u)) m.set(u, new Map()); const mt = m.get(u); if (!mt.has(t)) mt.set(t, []); mt.get(t).push(r) })
    const orden = (a, b) => (ORDEN_ESTADO[a.estado] ?? 9) - (ORDEN_ESTADO[b.estado] ?? 9) || String(a.codigo || a.id).localeCompare(String(b.codigo || b.id), undefined, { numeric: true })
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([u, mt]) => [u, [...mt.entries()].sort((a, b) => a[0] - b[0]).map(([t, l]) => [t, l.sort(orden)])])
  }, [recursos, filtro]) // eslint-disable-line react-hooks/exhaustive-deps
  const aprobable = (r) => puedePublicar && onAprobar && !r.correccion && r.conContenido && !r.publicando && !r.enCola && (r.estado === 'POR_REVISAR' || r.estado === 'ERROR')

  const aprobarUno = async (r) => {
    if (sucio && r.id === actualId) { setAviso({ tipo: 'warn', texto: 'Guarde o descarte los cambios del recurso abierto antes de aprobarlo.' }); return }
    setOcupados((o) => ({ ...o, [r.id]: true })); setAviso(null)
    try { await onAprobar(r) } catch (e) { setAviso({ tipo: 'bad', texto: (r.codigo || r.id) + ': ' + (e.message || 'No se pudo aprobar.') }) }
    setOcupados((o) => { const n = { ...o }; delete n[r.id]; return n })
  }
  const aprobarUnidad = async (u, lista) => {
    const por = lista.filter((r) => aprobable(r) && r.estado === 'POR_REVISAR')
    if (!por.length) return
    if (sucio && por.some((r) => r.id === actualId)) { setAviso({ tipo: 'warn', texto: 'Guarde o descarte los cambios del recurso abierto antes de aprobar la unidad.' }); return }
    const conAlerta = por.filter((r) => r.alertaActividad)
    if (conAlerta.length) {
      const sinAlerta = por.length - conAlerta.length
      const dec = await confirmar({ titulo: 'Hay recursos con alerta de actividad', texto: conAlerta.length + (conAlerta.length === 1 ? ' recurso tiene alerta de actividad: se publicará sin actividad.' : ' recursos tienen alerta de actividad: se publicarán sin actividad.') + '\nLos que tienen alerta: ' + conAlerta.map((r) => r.codigo || r.id).join(', ') + '.', tono: 'aviso', textoConfirmar: sinAlerta ? 'Aprobar solo los que no tienen alerta (' + sinAlerta + ')' : 'Aprobar todos', textoSecundario: sinAlerta ? 'Aprobar todos (' + por.length + ')' : undefined })
      if (!dec) return
      if (dec === true && sinAlerta) por.splice(0, por.length, ...por.filter((r) => !r.alertaActividad))
    } else if (!(await confirmar({ titulo: '¿Aprobar y publicar la unidad?', texto: 'Se aprobarán y publicarán ' + por.length + (por.length === 1 ? ' recurso' : ' recursos') + ' de la Unidad ' + u + '.', textoConfirmar: 'Aprobar y publicar' }))) return
    setUnidadBusy(u); setAviso(null)
    let hechos = 0
    const fallos = []
    for (const r of por) {
      try { const ok = await onAprobar(r); if (ok !== false) hechos++ } catch (e) { fallos.push((r.codigo || r.id) + ' (' + (e.message || 'error') + ')') }
    }
    setUnidadBusy(null)
    setAviso(fallos.length ? { tipo: 'warn', texto: 'Se aprobaron ' + hechos + ' de ' + por.length + '. Con problema: ' + fallos.join('; ') } : { tipo: 'ok', texto: 'Se aprobaron los ' + hechos + ' de la Unidad ' + u + '. n8n los está publicando en Drive.' })
  }

  const filtros = [['con', 'Disponibles', conteo.total - conteo.pendientes], ['revisar', 'Por revisar', conteo.revisar], ['todos', 'Todos', conteo.total]]
  return (
    <nav className="er-nav" aria-label="Recursos del curso">
      {dialogo}
      <div className="er-nav-cab">
        <b>Recursos del curso</b>
        <span>{conteo.revisar > 0 ? conteo.revisar + (conteo.revisar === 1 ? ' por revisar' : ' por revisar') : 'Nada por revisar'} · {conteo.generando} generándose{conteo.enCola > 0 ? ' · ' + conteo.enCola + ' en cola' : ''} · {conteo.generados} publicados</span>
      </div>
      <div className="er-nav-filtros" role="tablist" aria-label="Filtrar">
        {filtros.map(([k, t, n]) => <button key={k} type="button" role="tab" aria-selected={filtro === k} className={(filtro === k ? 'on ' : '') + (k === 'revisar' && n > 0 ? 'prev' : '')} onClick={() => setFiltro(k)}>{t} <b>{n}</b></button>)}
      </div>
      {aviso && <p className={'er-nav-aviso ' + aviso.tipo} role="status">{aviso.texto}<button type="button" aria-label="Cerrar aviso" onClick={() => setAviso(null)}>×</button></p>}
      <div className="er-nav-lista">
        {grupos.length === 0 && <p className="er-vacio">{filtro === 'revisar' ? 'No hay recursos por revisar.' : 'Todavía no hay recursos con contenido.'}</p>}
        {grupos.map(([u, temas]) => {
          const lista = temas.flatMap(([, l]) => l)
          const nRev = lista.filter((r) => r.estado === 'POR_REVISAR' && aprobable(r)).length
          const cerrada = !!cerradas[u]
          return (
            <section key={u} className="er-un">
              <header className="er-un-cab">
                <button type="button" className="er-un-t" aria-expanded={!cerrada} onClick={() => setCerradas((c) => ({ ...c, [u]: !c[u] }))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: cerrada ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>
                  <b>{u === 0 ? 'Sin unidad' : 'Unidad ' + u}</b>
                  <span>{lista.length}</span>
                </button>
                {puedePublicar && nRev > 0 && (
                  <button type="button" className="er-un-ok" disabled={unidadBusy !== null} onClick={() => aprobarUnidad(u, lista)} title={'Aprobar y publicar los ' + nRev + ' recursos por revisar de esta unidad'}>
                    {unidadBusy === u ? <><i className="er-gira" aria-hidden="true" />Aprobando…</> : <>Aprobar la unidad <em>{nRev}</em></>}
                  </button>
                )}
              </header>
              {!cerrada && temas.map(([t, sub]) => {
                const kT = u + ':' + t
                const cT = !!cerradas[kT]
                const nRevT = sub.filter((x) => x.estado === 'POR_REVISAR').length
                return (
                <div key={kT} className="er-tm">
                  <button type="button" className="er-tm-t" aria-expanded={!cT} onClick={() => setCerradas((c) => ({ ...c, [kT]: !c[kT] }))}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: cT ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>
                    <b>{t === 0 ? 'Sin tema' : 'Tema ' + t}</b><span>{sub.length}</span>{nRevT > 0 && <em>{nRevT} por revisar</em>}
                  </button>
                  {!cT && (
                <ul>
                  {sub.map((r) => {
                    const pub = !!r.publicando && !r.publicandoSinRespuesta
                    const sin = !!r.sinRespuesta && !pub // lleva mucho sin avisos: no es «generando», es un aviso que no llegó
                    const cr = !!r.enColaRegenerar && !pub
                    const k = cr ? 'en' : sin ? 'er' : pub || r.estado === 'EN_PROCESO' ? 'en' : r.estado === 'POR_REVISAR' ? 'prev' : r.estado === 'GENERADO' ? 'ok' : r.estado === 'ERROR' ? 'er' : 'pe'
                    return (
                      <li key={r.id} className={'er-rec ' + k + (r.id === actualId ? ' on' : '')}>
                        <button type="button" className="er-rec-btn" disabled={!r.conContenido && r.id !== actualId} aria-current={r.id === actualId ? 'true' : undefined} onClick={() => onElegir(r)}>
                          <span className={'er-rec-ic ' + k} aria-hidden="true">{cr ? '⏳' : k === 'en' ? <i className="er-gira" /> : k === 'ok' ? '✓' : k === 'er' ? '!' : ''}</span>
                          <span className="er-rec-tx"><b>{r.codigo || r.id}</b><small>{r.titulo || 'Sin título'}</small>{(r.tieneActividad || r.tieneBibliografia) && <small className="er-rec-partes">{[r.tieneActividad && 'Con actividad', r.tieneBibliografia && 'Con bibliografía'].filter(Boolean).join(' · ')}</small>}{r.alertaActividad && <small className="er-rec-alerta" title={r.alertaActividad}>Alerta de actividad</small>}</span>
                          <span className={'er-rec-et ' + k}>{pub ? 'Publicando…' : cr ? 'En cola para regenerar' : sin ? 'Sin avisos' : r.enCola ? (r.regenera ? 'Se regenerará' : 'En cola') : TEXTO_ESTADO[r.estado] || r.estado}</span>
                        </button>
                        {aprobable(r) && (
                          <button type="button" className="er-rec-ok" disabled={!!ocupados[r.id] || unidadBusy !== null} onClick={() => aprobarUno(r)} aria-label={'Aprobar y publicar ' + (r.codigo || r.id)} title="Aprobar y publicar">
                            {ocupados[r.id] ? <i className="er-gira" aria-hidden="true" /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
                  )}
                </div>
                )
              })}
            </section>
          )
        })}
      </div>
      <p className="er-nav-pie">{conteo.pendientes > 0 ? conteo.pendientes + (conteo.pendientes === 1 ? ' recurso espera' : ' recursos esperan') + ' su generación.' : 'Todos los recursos ya se generaron.'}</p>
    </nav>
  )
}

// «Más acciones ⋮»: menú desplegable con teclado (flechas, Inicio/Fin, Esc, Tab) y cierre al hacer clic fuera.
function MenuAcciones({ items }) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef(null)
  const boton = useRef(null)
  const lista = useRef(null)
  const enfocar = (i) => { const l = lista.current ? [...lista.current.querySelectorAll('[role="menuitem"]:not(:disabled)')] : []; if (l.length) l[(i + l.length) % l.length].focus() }
  useEffect(() => {
    if (!abierto) return undefined
    enfocar(0)
    const fuera = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])
  const teclas = (e) => {
    const l = lista.current ? [...lista.current.querySelectorAll('[role="menuitem"]:not(:disabled)')] : []
    const i = l.indexOf(document.activeElement)
    if (e.key === 'Escape' && abierto) { e.preventDefault(); e.stopPropagation(); setAbierto(false); boton.current && boton.current.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (!abierto) setAbierto(true); else enfocar(i + 1) }
    else if (e.key === 'ArrowUp' && abierto) { e.preventDefault(); enfocar(i <= 0 ? -1 : i - 1) }
    else if (e.key === 'Home' && abierto) { e.preventDefault(); enfocar(0) }
    else if (e.key === 'End' && abierto) { e.preventDefault(); enfocar(-1) }
    else if (e.key === 'Tab' && abierto) setAbierto(false)
  }
  if (!items.length) return null
  return (
    <div className="er-mas" ref={raiz} onKeyDown={teclas}>
      <button ref={boton} type="button" className={'er-b er-mas-btn' + (abierto ? ' on' : '')} aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
        <span>Más acciones</span>
      </button>
      {abierto && (
        <div className="er-mas-lista" role="menu" aria-label="Más acciones" ref={lista}>
          {items.map((it) => (
            <button key={it.k} type="button" role="menuitem" disabled={it.deshab} title={it.titulo} onClick={() => { setAbierto(false); it.onClick() }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={it.icono} /></svg>{it.texto}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function EditorRecurso({ proyecto, propietario, soloLectura = false, recurso, recursos = [], puedePublicar, onAprobar, onRegenerar, parteInicial = '', onParte, onElegir, onCerrar, onActualizar }) {
  const [confirmar, dialogo] = useConfirmar()
  const [veGestion, setVeGestion] = useState(false) // quien ve «Plantillas HTML» abre la plantilla ahí; el resto, la vista pública
  useEffect(() => { apiBase('GET', '/auth/yo').then((y) => setVeGestion(!!(y && y.permisos && y.permisos.includes('plantillas.ver')))).catch(() => {}) }, [])
  const api = useCallback((metodo, ruta, cuerpo) => apiBase(metodo, conPropietario(ruta, propietario), cuerpo), [propietario])
  const [estado, setEstado] = useState('cargando') // cargando | listo | error
  const [error, setError] = useState('')
  const [pagina, setPagina] = useState('')
  const [activo, setActivo] = useState(!soloLectura)
  const [sucio, setSucio] = useState(false)
  const [msg, setMsg] = useState(null) // { tipo: 'ok' | 'bad' | 'warn', texto }
  const [ocupado, setOcupado] = useState('')
  const [navAbierta, setNavAbierta] = useState(() => typeof window === 'undefined' || window.innerWidth > 860) // en pantallas angostas la lista de recursos se abre a demanda
  const [parte, setParte] = useState('recurso') // parte abierta: recurso | actividad | bibliografia
  const [partesDisp, setPartesDisp] = useState(['recurso'])
  // partes: por cada una { contenido, esqueleto, titulo }; sucias: las partes con cambios sin guardar
  const ref = useRef({ partes: {}, parte: 'recurso', formacion: null, activo: !soloLectura, sucias: new Set() })
  const marco = useRef(null)
  const marcoMapa = useRef(null) // iframe oculto con el contenido marcado
  const [marcada, setMarcada] = useState(null) // { parte, html } de la página marcada que se está mapeando
  const parteDeseada = useRef(parteInicial) // parte a abrir al terminar de cargar (la de la dirección, o la que se tenía al recargar la versión nueva)
  const versionCargada = useRef('') // «actualizadoEn» del recurso que se cargó (para detectar una regeneración nueva)
  const [recarga, setRecarga] = useState(0)
  const [hayNueva, setHayNueva] = useState(false) // hay una versión nueva del recurso y la persona tiene cambios sin guardar
  const imgUrlRef = useRef('') // imagen guardada del recurso (la vista previa la usa en lugar de IMAGEN_EJEMPLO)
  const pintadaImg = useRef('')
  const [imgHayNueva, setImgHayNueva] = useState(false)
  const [imgEstado, setImgEstado0] = useState(null)
  const setImgEstado = (items, hay) => { setImgEstado0(items); if (hay !== undefined) setImgHayNueva(hay) }
  // // items que reporta la vista previa sobre la carga de sus imágenes (null = aún sin reporte)
  const [dlgImg, setDlgImg] = useState(null) // null = cerrado; texto = enlace que se está escribiendo
  const ruta = '/proyectos/' + encodeURIComponent(proyecto) + '/pipeline/recursos/' + encodeURIComponent(recurso.id) + '/contenido'

  const pintar = useCallback((activoAhora) => {
    const r = ref.current
    const p = r.partes[r.parte]
    const url = r.parte === 'recurso' ? imgUrlRef.current : p.imagenUrl
    pintadaImg.current = imgUrlRef.current
    setImgEstado(null)
    setPagina(armarPagina(p.esqueleto, p.contenido, p.titulo, r.formacion, activoAhora, url))
    if (!r.mapas) r.mapas = {}
    if (r.mapas[r.parte] === undefined) { // una sola vez por parte: el mapa no cambia al editar textos
      r.mapas[r.parte] = null
      try {
        const mk = editorMarcas() && editorMarcas().marcar(p.contenido)
        if (mk && mk.rutas.length) setMarcada({ parte: r.parte, html: armarPagina(p.esqueleto, mk.contenido, p.titulo, r.formacion, false, url, { rutas: mk.rutas }) })
      } catch { /* sin mapa: queda la comparación por texto */ }
    }
  }, [])

  useEffect(() => {
    let vivo = true
    setEstado('cargando'); setError(''); setSucio(false); setMsg(null); setPagina(''); setParte('recurso'); setPartesDisp(['recurso']); setHayNueva(false)
    if (recurso.conContenido === false) { setEstado('sinContenido'); return () => { vivo = false } }
    ;(async () => {
      try {
        const c = await api('GET', ruta)
        if (!c.plantilla) throw new Error('Este recurso no tiene plantilla registrada.')
        const r = await fetch(RUTA_API.replace(/\/api$/, '') + '/plantillas-html/' + encodeURIComponent(c.plantilla) + '.html')
        if (!r.ok) throw new Error('No se encontró la plantilla ' + c.plantilla.toUpperCase() + '.')
        const esqueleto = await r.text()
        if (!vivo) return
        const partes = { recurso: { contenido: c.contenido, esqueleto, titulo: (c.contenido && c.contenido.titulo) || c.titulo } }
        const faltan = []
        for (const k of ['actividad', 'bibliografia']) {
          const x = c[k]
          if (!x || !x.plantilla || !x.contenido) continue
          try {
            const rp = await fetch(RUTA_API.replace(/\/api$/, '') + '/plantillas-html/' + encodeURIComponent(x.plantilla) + '.html')
            if (!rp.ok) throw new Error('sin plantilla')
            partes[k] = { contenido: x.contenido, imagenUrl: typeof x.imagen_url === 'string' ? x.imagen_url : (x.contenido && x.contenido.imagen_url) || '', esqueleto: await rp.text(), titulo: (x.contenido && x.contenido.titulo) || c.titulo }
          } catch { faltan.push(k === 'actividad' ? 'la actividad' : 'la bibliografía') }
        }
        if (!vivo) return
        const deseada = partes[parteDeseada.current] ? parteDeseada.current : 'recurso'
        parteDeseada.current = ''
        versionCargada.current = String(c.actualizadoEn || '')
        ref.current = { mapas: {}, partes, parte: deseada, formacion: c.formacion || null, activo: soloLectura ? false : ref.current.activo, sucias: new Set() } // conserva «Editar con clic» al cambiar de recurso
        setParte(deseada); if (onParte) onParte(deseada)
        setPartesDisp(['recurso', 'actividad', 'bibliografia'].filter((k) => partes[k]))
        if (faltan.length) setMsg({ tipo: 'warn', texto: 'No se encontró la plantilla de ' + faltan.join(' ni de ') + ': esa parte no se puede editar aquí.' })
        pintar(ref.current.activo)
        setEstado('listo')
      } catch (e) { if (vivo) { setError(e.message || 'No se pudo abrir el editor'); setEstado('error') } }
    })()
    return () => { vivo = false }
  }, [ruta, pintar, recurso.conContenido, recarga]) // eslint-disable-line react-hooks/exhaustive-deps

  const marcadaRef = useRef(null)
  marcadaRef.current = marcada
  const enviarMapa = () => {
    const m = ref.current.mapas && ref.current.mapas[ref.current.parte]
    if (m) try { marco.current && marco.current.contentWindow.postMessage({ fuente: 'praxia-editor', tipo: 'mapa', entradas: m }, '*') } catch { /* iframe aún sin cargar */ }
  }
  // Mensajes del módulo del iframe
  useEffect(() => {
    const alMensaje = (e) => {
      const d = e.data
      if (marcoMapa.current && e.source === marcoMapa.current.contentWindow) { // el iframe oculto terminó de mapear
        if (!d || d.fuente !== 'praxia-editor' || d.tipo !== 'mapa') return
        const r = ref.current, k = marcadaRef.current && marcadaRef.current.parte
        if (!k || !r.mapas) return
        r.mapas[k] = d.error || !Array.isArray(d.entradas) ? null : d.entradas
        setMarcada(null)
        if (r.mapas[k] && k === r.parte) enviarMapa()
        return
      }
      if (!marco.current || e.source !== marco.current.contentWindow) return
      if (!d || d.fuente !== 'praxia-editor') return
      if (d.tipo === 'listo') { enviarMapa(); return }
      if (soloLectura && (d.tipo === 'campo' || d.tipo === 'imagen_clic')) return
      if (d.tipo === 'campo' && typeof d.ruta === 'string' && typeof d.valor === 'string') {
        if (!ponerRuta(ref.current.partes[ref.current.parte].contenido, d.ruta, d.valor)) return
        ref.current.sucias.add(ref.current.parte)
        setSucio(true); setMsg(null)
        if (!d.parchado) pintar(ref.current.activo) // el texto no se pudo cambiar en pantalla: se vuelve a pintar con el JSON nuevo
      } else if (d.tipo === 'imagenes_estado') {
        setImgEstado(Array.isArray(d.items) ? d.items.slice(0, 20).map((x) => ({ src: String((x && x.src) || ''), ok: !!(x && x.ok), error: !!(x && x.error), esEjemplo: !!(x && x.esEjemplo) })) : [], !!d.hayNueva)
      } else if (d.tipo === 'imagen_clic') {
        const p = ref.current.parte
        if (p === 'bibliografia') setMsg({ tipo: 'warn', texto: 'La bibliografía no tiene imagen que cambiar.' })
        else setDlgImg(p === 'actividad' ? (ref.current.partes.actividad.imagenUrl || '') : imgUrlRef.current || '')
      } else if (d.tipo === 'sin_campo') setMsg({ tipo: 'warn', texto: 'Ese texto no viene de un campo que se pueda editar por clic.' })
    }
    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [pintar, soloLectura])

  const cambiarParte = (k) => { if (k === ref.current.parte || !ref.current.partes[k]) return; ref.current.parte = k; setParte(k); if (onParte) onParte(k); pintar(ref.current.activo) }
  const cambiarModo = (v) => {
    ref.current.activo = v; setActivo(v)
    try { marco.current && marco.current.contentWindow.postMessage({ fuente: 'praxia-editor', tipo: 'modo', activo: v }, '*') } catch { /* iframe aún sin cargar */ }
  }


  const guardar = async () => {
    setOcupado('guardar'); setMsg(null)
    try {
      for (const k of [...ref.current.sucias]) { await api('PUT', ruta, { contenido: ref.current.partes[k].contenido, ...(k === 'recurso' ? {} : { parte: k }) }); ref.current.sucias.delete(k) }
      setSucio(false); setMsg({ tipo: 'ok', texto: 'Cambios guardados.' }); return true }
    catch (e) { setMsg({ tipo: 'bad', texto: e.message || 'No se pudo guardar.' }); return false }
    finally { setOcupado('') }
  }

  const descargar = async () => {
    if (sucio && !(await guardar())) return
    setOcupado('h5p'); setMsg(null)
    try {
      const r = await fetch(RUTA_API + conPropietario('/proyectos/' + encodeURIComponent(proyecto) + '/pipeline/recursos/' + encodeURIComponent(recurso.id) + '/h5p', propietario), { method: 'POST', credentials: 'same-origin', headers: { 'x-ova': '1' } })
      if (!r.ok) { let d = null; try { d = await r.json() } catch { /* sin cuerpo */ } throw new Error((d && d.error) || 'No se pudo armar el H5P (' + r.status + ').') }
      const sin = r.headers.get('x-iconos-sin-resolver')
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url; a.download = ((recurso.codigo || recurso.id) + '').replace(/[^A-Za-z0-9_-]+/g, '_') + '.h5p'
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000)
      setMsg(sin ? { tipo: 'warn', texto: 'Descargado, pero no se pudieron resolver estos íconos: ' + sin } : { tipo: 'ok', texto: 'H5P descargado con los cambios.' })
    } catch (e) { setMsg({ tipo: 'bad', texto: e.message || 'No se pudo armar el H5P.' }) }
    finally { setOcupado('') }
  }

  // Aprobar y publicar: guarda lo editado, pide la publicación (el componente de arriba confirma si hay que reemplazar un archivo ya publicado) y cierra.
  const [senalCorr, setSenalCorr] = useState(0)
  const [alertaVer, setAlertaVer] = useState(null) // id del recurso cuya alerta de actividad se muestra completa
  const pedirCorr = () => setSenalCorr((n) => n + 1)
  const aprobarYPublicar = async () => {
    if (actual.alertaActividad) {
      const dec = await confirmar({ titulo: 'Este recurso tiene una alerta', texto: actual.alertaActividad + '\nSi lo aprueba ahora, se publicará sin actividad. Lo recomendable es pedir la corrección al docente.', tono: 'aviso', textoConfirmar: puedePedirCorr ? 'Pedir corrección al docente' : 'Aprobar de todas formas', textoSecundario: puedePedirCorr ? 'Aprobar de todas formas' : undefined })
      if (!dec) return
      if (dec === true && puedePedirCorr) { pedirCorr(); return }
    }
    if (sucio && !(await guardar())) return
    setOcupado('aprobar'); setMsg(null)
    try { const hecho = await onAprobar(actual); if (hecho) setMsg({ tipo: 'ok', texto: 'Enviado a publicar. Puede seguir revisando otros recursos mientras se publica.' }) }
    catch (e) { setMsg({ tipo: 'bad', texto: e.message || 'No se pudo aprobar el recurso.' }) }
    finally { setOcupado('') }
  }

  const regenerarEste = async () => {
    setOcupado('regenerar'); setMsg(null)
    try { const hecho = await onRegenerar(actual); if (hecho) { setMsg({ tipo: 'ok', texto: 'Regenerando… el borrador nuevo aparecerá como «Por revisar».' }) } }
    catch (e) { setMsg({ tipo: 'bad', texto: e.message || 'No se pudo regenerar el recurso.' }) }
    finally { setOcupado('') }
  }

  const cerrar = async () => { if (sucio && !(await confirmar({ titulo: '¿Cerrar sin guardar?', texto: 'Hay cambios sin guardar. Si cierra ahora se perderán.', tono: 'aviso', textoConfirmar: 'Cerrar sin guardar' }))) return; onCerrar() }
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape' && !sucio) onCerrar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [sucio, onCerrar])


  // ---- Distribución de la pantalla (solo aspecto): dividida, panel flotante o solo recurso. El iframe NO cambia de sitio en el árbol: solo cambian clases y medidas,
  // así no se recarga ni pierde su estado.
  const [modo, setModo] = useState('dividida') // dividida | flotante | recurso
  const [orient, setOrient] = useState('h') // h = lado a lado, v = arriba/abajo
  const [invertido, setInvertido] = useState(false) // el panel de textos va primero
  const [frac, setFrac] = useState(0.7) // parte del espacio para la vista del recurso
  const [flota, setFlota] = useState({ x: 40, y: 20, w: 360, h: 420, min: false })
  const [arrastre, setArrastre] = useState(null)
  const cuerpo = useRef(null)
  // Arrastre con pointer events: el elemento captura el puntero, así no se pierde al salir del área ni sobre el iframe, y siempre se suelta.
  const empezar = (tipo, e) => {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* sin captura */ }
    const r = cuerpo.current ? cuerpo.current.getBoundingClientRect() : { width: 900, height: 600 }
    setArrastre({ tipo, x0: e.clientX, y0: e.clientY, w: r.width, h: r.height, frac, flota: { ...flota } })
  }
  const mover = (e) => {
    if (!arrastre) return
    const dx = e.clientX - arrastre.x0, dy = e.clientY - arrastre.y0
    if (arrastre.tipo === 'divisor') {
      const total = (orient === 'h' ? arrastre.w : arrastre.h) - 12
      const base = invertido ? 1 - arrastre.frac : arrastre.frac
      const nf = Math.min(0.85, Math.max(0.2, base + (orient === 'h' ? dx : dy) / total))
      setFrac(invertido ? 1 - nf : nf)
    } else if (arrastre.tipo === 'mover') {
      setFlota((f) => ({ ...f, x: Math.min(arrastre.w - 120, Math.max(0, arrastre.flota.x + dx)), y: Math.min(arrastre.h - 44, Math.max(0, arrastre.flota.y + dy)) }))
    } else if (arrastre.tipo === 'redim') {
      setFlota((f) => ({ ...f, w: Math.min(arrastre.w - f.x, Math.max(280, arrastre.flota.w + dx)), h: Math.min(arrastre.h - f.y, Math.max(200, arrastre.flota.h + dy)) }))
    }
  }
  const soltar = (e) => { try { if (e && e.currentTarget && e.currentTarget.hasPointerCapture && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ya soltado */ } setArrastre(null) }
  useEffect(() => {
    if (!arrastre) return undefined
    const fin = () => setArrastre(null)
    window.addEventListener('pointerup', fin); window.addEventListener('pointercancel', fin); window.addEventListener('blur', fin)
    return () => { window.removeEventListener('pointerup', fin); window.removeEventListener('pointercancel', fin); window.removeEventListener('blur', fin) }
  }, [arrastre])
  const ptr = { onPointerMove: mover, onPointerUp: soltar, onPointerCancel: soltar, onLostPointerCapture: () => setArrastre(null) }
  const pesos = [['Vista 30%', 0.3], ['50 / 50', 0.5], ['Vista 70%', 0.7]]
  const estiloLado = modo === 'flotante' ? { left: flota.x, top: flota.y, width: flota.w, height: flota.min ? 64 : flota.h } : undefined
  const actual = recursos.find((x) => x.id === recurso.id) || recurso
  const puedePedirCorr = !!propietario && !actual.correccion
  const [guionEdita, setGuionEdita] = useState(() => { try { return localStorage.getItem(CLAVE_MODO_GUION) === 'editar' } catch { return false } })
  const cambiarModoGuion = (v) => { setGuionEdita(v); try { localStorage.setItem(CLAVE_MODO_GUION, v ? 'editar' : 'leer') } catch { /* sin almacenamiento */ } }
  const urlGuion = vistaGuion(actual.enlaceGuion, guionEdita)
  // Si el recurso se regeneró (la lista del curso trae una fecha nueva y ya no está en proceso): sin cambios sin guardar se recarga solo; con cambios se avisa.
  const nuevaVersion = estado === 'listo' && !!versionCargada.current && !!actual.actualizadoEn && actual.estado !== 'EN_PROCESO' && String(actual.actualizadoEn) !== versionCargada.current
  const cargarNueva = () => { parteDeseada.current = ref.current.parte; setRecarga((n) => n + 1) }
  useEffect(() => {
    if (!nuevaVersion) return
    if (sucio) setHayNueva(true)
    else cargarNueva()
  }, [nuevaVersion, actual.actualizadoEn]) // eslint-disable-line react-hooks/exhaustive-deps
  const publicandoAhora = !!actual.publicando && !actual.publicandoSinRespuesta
  // Imagen del recurso: se cambia con un clic sobre ella en la vista previa (enlace https; cadena vacía = quitarla).
  const [imgGuardada, setImgGuardada] = useState({}) // id → URL guardada en esta sesión (hasta que la lista del curso se refresque)
  const imgActual = actual.id in imgGuardada ? imgGuardada[actual.id] : actual.imagenUrl || ''
  const imgDlgValida = dlgImg !== null && (dlgImg.trim() === '' || esUrlImagen(dlgImg.trim()))
  imgUrlRef.current = esUrlImagen(imgActual) ? imgActual : ''
  const guardarImagen = async (valor) => {
    const v = (valor || '').trim()
    setOcupado('imagen'); setMsg(null)
    try {
      await api('PUT', '/proyectos/' + encodeURIComponent(proyecto) + '/pipeline/recursos/imagen', { recursoId: actual.id, imagenUrl: v, parte: ref.current.parte === 'actividad' ? 'actividad' : 'recurso' })
      if (ref.current.parte === 'actividad') { ref.current.partes.actividad.imagenUrl = v; pintar(ref.current.activo) } else setImgGuardada((g) => ({ ...g, [actual.id]: v })); setDlgImg(null); setMsg({ tipo: 'ok', texto: v ? 'Imagen guardada. Se usará al publicar.' : 'Imagen quitada.' })
    } catch (e) { setMsg({ tipo: 'bad', texto: e.message || 'No se pudo guardar la imagen.' }) }
    finally { setOcupado('') }
  }
  // Al guardar otro enlace, la vista previa se vuelve a armar con la imagen nueva (el texto editado sin guardar se conserva en memoria).
  useEffect(() => { if (estado === 'listo' && pintadaImg.current !== imgUrlRef.current) pintar(ref.current.activo) }, [imgActual, estado, pintar])
  useEffect(() => { setDlgImg(null) }, [recurso.id])
  const elegirRecurso = async (r) => {
    if (r.id === recurso.id || !onElegir) return
    if (sucio && !(await confirmar({ titulo: '¿Pasar a otro recurso?', texto: 'Hay cambios sin guardar en este recurso. Si pasa a otro se perderán.', tono: 'aviso', textoConfirmar: 'Pasar sin guardar' }))) return
    onElegir(r)
    if (typeof window !== 'undefined' && window.innerWidth <= 860) setNavAbierta(false)
  }
  // Página completa: el resto de la pantalla no se desplaza detrás
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } }, [])

  // Se pinta en <body>: así ocupa toda la ventana aunque la pantalla de abajo tenga transformaciones o se haya desplazado
  return createPortal(
    <div className="er-fondo" role="dialog" aria-modal="true" aria-label={'Editar ' + (recurso.codigo || recurso.id)}>
      {dialogo}
      <div className="er-caja">
        <header className="er-cab">
          <button type="button" className="er-volver" onClick={cerrar} aria-label="Volver a Matrices y H5P"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>Volver</button>
          {recursos.length > 0 && <button type="button" className={'er-navbtn' + (navAbierta ? ' on' : '')} aria-expanded={navAbierta} onClick={() => setNavAbierta(!navAbierta)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>Recursos</button>}
          <div className="er-tt"><b>{recurso.codigo || recurso.id}</b><span>{recurso.titulo || 'Sin título'}</span>{estado === 'listo' && imgEstado && (() => {
            const ok = imgEstado.some((x) => x.ok), mal = imgEstado.filter((x) => x.error)
            if (!imgEstado.length) return <small className="er-cons" style={{ color: '#6b7280' }}>Esta plantilla no muestra imagen</small>
            const ej = imgEstado.find((x) => x.esEjemplo), src = (ej || imgEstado[0]).src
            if (ok) return ej && imgHayNueva
              ? <small className="er-cons" style={{ color: '#b45309' }} title={src}>Imagen: cargó · es la IMAGEN DE EJEMPLO (no se reemplazó)</small>
              : <small className="er-cons" style={{ color: '#15803d' }} title={src}>Imagen: cargó · {ej ? 'es la imagen de ejemplo' : 'es la imagen del recurso/actividad'}</small>
            if (mal.length) { const u = mal[0].src; return <small className="er-cons" style={{ color: '#b45309' }} title={u}>Imagen: no cargó — haga clic en la imagen para revisar el enlace ({u.length > 60 ? u.slice(0, 57) + '…' : u})</small> }
            return null
          })()}{actual.consumo && /* el servidor solo envía el consumo a administradores */ <small className="er-cons" title="Consumo de la generación de este recurso">{miles(tokensDe(actual.consumo))} tokens · {imagenesDe(actual.consumo)} img · {usd(costoDe(actual.consumo))}{actual.consumo.costo_parcial ? ' (parcial)' : ''}</small>}</div>
          {estado === 'listo' && (
            <div className="er-cab-acc">
              {!soloLectura && sucio && <button type="button" className="er-b pri" onClick={guardar} disabled={!!ocupado}>{ocupado === 'guardar' ? <><i className="er-gira" aria-hidden="true" />Guardando…</> : 'Guardar cambios'}</button>}
              {puedePublicar && onAprobar && !actual.correccion && ['POR_REVISAR', 'GENERADO', 'ERROR'].includes(actual.estado) && <button type="button" className="er-b ok" onClick={aprobarYPublicar} disabled={!!ocupado || publicandoAhora} title="Aprobar este contenido: n8n arma el H5P y lo sube a Drive">{ocupado === 'aprobar' ? 'Enviando…' : publicandoAhora ? 'Publicando…' : actual.estado === 'GENERADO' ? 'Aprobar y volver a publicar' : 'Aprobar y publicar'}</button>}
              <MenuAcciones items={[
                puedePublicar && onRegenerar && (['POR_REVISAR', 'GENERADO', 'ERROR'].includes(actual.estado) || actual.sinRespuesta) && { k: 'reg', texto: ocupado === 'regenerar' ? 'Regenerando…' : actual.enColaRegenerar ? 'En cola para regenerar' : 'Regenerar', icono: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7', onClick: regenerarEste, deshab: !!ocupado || publicandoAhora || !!actual.enColaRegenerar || (actual.correccion && actual.correccion.estado === 'abierta'), titulo: 'Crear de nuevo con la misma plantilla' },
                puedePedirCorr && !actual.alertaActividad && { k: 'corr', texto: 'Pedir corrección al docente', icono: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z', onClick: pedirCorr, deshab: !!ocupado, titulo: 'El problema depende del guion: se lo envía al docente y este recurso queda bloqueado hasta que lo resuelva' },
                actual.plantilla && { k: 'plant', texto: 'Abrir la plantilla usada', icono: 'M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5', onClick: () => { const v = String(actual.plantilla).toLowerCase(); const m = v.match(/^([a-z]-\d+)/i); window.open(veGestion ? location.origin + location.pathname + location.search + '#/plantillas?' + (m ? 'categoria=' + encodeURIComponent(m[1].toUpperCase()) + '&' : '') + 'variante=' + encodeURIComponent(v) : RUTA_API.replace(/[/]api$/, '') + '/plantillas-html/ver/' + encodeURIComponent(actual.plantilla), '_blank', 'noopener') }, titulo: 'Abre en otra pestaña la variante con la que se generó este recurso' },
                { k: 'h5p', texto: ocupado === 'h5p' ? 'Armando el H5P…' : 'Descargar .h5p', icono: 'M12 4v11M7 11l5 5 5-5M4 20h16', onClick: descargar, deshab: !!ocupado }
              ].filter(Boolean)} />
            </div>
          )}
        </header>

        <div className={'er-cols' + (navAbierta ? ' nav' : '')}>
        {recursos.length > 0 && navAbierta && <ListaRecursos recursos={recursos} actualId={recurso.id} puedePublicar={puedePublicar} sucio={sucio} onElegir={elegirRecurso} onAprobar={onAprobar} />}
        <div className="er-main">
        {msg && <p className={'er-msg ' + msg.tipo} role="status"><i className="er-msg-ic" aria-hidden="true">{msg.tipo === 'ok' ? '✓' : msg.tipo === 'bad' ? '!' : '!'}</i><span>{msg.texto}</span></p>}
        {publicandoAhora && <p className="er-msg info" role="status"><i className="er-gira" aria-hidden="true" /><span>Publicando en Drive. Este aviso se quita solo cuando n8n termina; puede seguir revisando otros recursos mientras tanto.</span></p>}
        {hayNueva && sucio && <p className="er-msg warn" role="status"><span>Hay una versión nueva de este recurso. </span><button type="button" className="er-b" onClick={cargarNueva}>Cargar la versión nueva</button><span> (se perderán los cambios sin guardar)</span></p>}
        {ocupado === 'h5p' && <p className="er-msg info" role="status"><i className="er-gira" aria-hidden="true" /><span>Armando el H5P con los cambios. Suele tardar unos 3 segundos; en algunos casos hasta 90. No cierre esta ventana.</span></p>}

        {propietario && <PanelCorreccion proyecto={proyecto} propietario={propietario} recurso={actual} onCambio={onActualizar} senal={senalCorr} />}
        {actual.alertaActividad && (() => {
          const ver = alertaVer === actual.id
          return (
            <div className={'er-alerta-act' + (ver ? ' ver' : '')} role="alert">
              <div className="er-alerta-fila">
                <svg className="er-alerta-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l10 18H2zM12 10v5M12 18v.01" /></svg>
                <b>Alerta de actividad</b>
                <span className="er-alerta-res" title={ver ? undefined : actual.alertaActividad}>{actual.alertaActividad}</span>
                <button type="button" className="er-alerta-mas" aria-expanded={ver} onClick={() => setAlertaVer(ver ? null : actual.id)}>{ver ? 'ver menos' : 'ver más'}</button>
                {puedePedirCorr && <button type="button" className="er-alerta-btn" onClick={pedirCorr} title="El problema depende del guion: se lo envía al docente y este recurso queda bloqueado hasta que lo resuelva">Pedir corrección al docente</button>}
              </div>
              {ver && <small className="er-alerta-pie">Corrija el guion o la tabla de tipos de actividad y use «Regenerar» en este recurso</small>}
            </div>
          )
        })()}

        {estado === 'listo' && partesDisp.length > 1 && (
          <div className="er-partes" role="tablist" aria-label="Partes del recurso">
            {partesDisp.map((k) => <button key={k} type="button" role="tab" aria-selected={parte === k} className={parte === k ? 'on' : ''} onClick={() => cambiarParte(k)}>{{ recurso: 'Recurso', actividad: 'Actividad', bibliografia: 'Bibliografía' }[k]}</button>)}
          </div>
        )}

        {estado === 'listo' && (
          <div className="er-barra">
              <div className="er-modos" role="tablist" aria-label="Distribución">
                {[['dividida', 'Dividida', 'M3 5h18v14H3zM12 5v14'], ['flotante', 'Panel flotante', 'M3 5h18v14H3zM11 11h8v6h-8z'], ['recurso', 'Solo recurso', 'M4 5h16v14H4zM4 9h16']].map(([k, t, d]) => (
                  <button key={k} type="button" role="tab" aria-selected={modo === k} className={modo === k ? 'on' : ''} onClick={() => setModo(k)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>{t}
                  </button>
                ))}
              </div>
              {modo === 'dividida' && (
                <div className="er-opc">
                  <div className="er-pesos" role="group" aria-label="Proporción">
                    {pesos.map(([t, v]) => <button key={t} type="button" className={Math.abs(frac - v) < 0.02 ? 'on' : ''} onClick={() => setFrac(v)}>{t}</button>)}
                  </div>
                  <button type="button" className="er-op" onClick={() => setOrient(orient === 'h' ? 'v' : 'h')} title="Cambiar entre lado a lado y arriba/abajo">{orient === 'h' ? 'Arriba / abajo' : 'Lado a lado'}</button>
                  <button type="button" className="er-op" onClick={() => setInvertido(!invertido)} title="Intercambiar de lado">Intercambiar</button>
                </div>
              )}
              {modo === 'flotante' && <span className="er-ayuda">Arrastre el panel del guion desde su título; cambie su tamaño desde la esquina.</span>}
              {modo === 'recurso' && <span className="er-ayuda">Haga clic en cualquier texto del recurso para editarlo.</span>}
              {!soloLectura && <label className={'er-modo er-modo-barra' + (activo ? ' on' : '')} title="Con esto activo, un clic en cualquier texto del recurso lo abre para editarlo">
                <input type="checkbox" checked={activo} onChange={(e) => cambiarModo(e.target.checked)} />
                <i className="er-sw" aria-hidden="true" />
                Editar con clic
              </label>}
            </div>
        )}

            <div ref={cuerpo} className={'er-cuerpo er-m-' + modo + ' er-o-' + orient + (invertido ? ' er-inv' : '')} style={{ '--f': frac }}>
              <div className="er-vista">
                {estado === 'listo' && marcada && <iframe key={marcada.parte} ref={marcoMapa} title="Mapa de textos" aria-hidden="true" tabIndex={-1} sandbox="allow-scripts" srcDoc={marcada.html} style={{ position: 'absolute', left: -10000, top: 0, width: 1024, height: 768, border: 0, visibility: 'hidden', pointerEvents: 'none' }} />}
                {estado === 'listo' && <iframe ref={marco} className="er-marco" title="Vista del recurso" sandbox="allow-scripts" srcDoc={pagina} />}
                {estado === 'sinContenido' && <div className="er-estado">{actual.esperando || actual.estado === 'EN_PROCESO' || actual.publicando ? <CargaRecurso tam="grande" /> : <i className="er-estado-ic info" aria-hidden="true">{actual.estado === 'PENDIENTE' ? '…' : 'i'}</i>}<b>{actual.esperando ? 'Los recursos se están generando' : actual.publicando ? 'Este recurso se está publicando' : actual.estado === 'EN_PROCESO' ? 'Este recurso se está generando' : actual.estado === 'PENDIENTE' ? 'Este recurso todavía no se genera' : 'Este recurso no se puede editar aquí'}</b><span>{actual.esperando ? 'Se irán habilitando en la lista a medida que se generen; el primero se abrirá solo.' : actual.publicando ? 'n8n está armando el H5P y subiéndolo a Drive. Cuando termine, el recurso aparecerá como «Generado».' : actual.estado === 'EN_PROCESO' || actual.estado === 'PENDIENTE' ? 'Cuando n8n termine, aparecerá en la lista como «Por revisar» y podrá abrirlo para corregir sus textos.' : 'Se generó antes de que Praxia guardara su contenido, así que sus textos no se pueden corregir desde esta pantalla.'}</span></div>}
                {estado === 'cargando' && <div className="er-estado"><CargaRecurso tam="grande" etiqueta="Abriendo el recurso" /><b>Abriendo el recurso…</b><span>Se está preparando la plantilla con su contenido.</span></div>}
                {estado === 'error' && <div className="er-estado mal" role="alert"><i className="er-estado-ic" aria-hidden="true">!</i><b>No se pudo abrir el editor</b><span>{error}</span></div>}
              </div>
              <div className={'er-asa' + (arrastre && arrastre.tipo === 'divisor' ? ' act' : '')} role="separator" aria-label="Repartir el espacio entre la vista y el guion" onPointerDown={(e) => empezar('divisor', e)} {...ptr}><i /></div>
              <aside className={'er-lado' + (flota.min && modo === 'flotante' ? ' min' : '')} style={estiloLado} aria-label="Guion del recurso">
                <div className="er-lado-cab" onPointerDown={modo === 'flotante' ? (e) => { if (!e.target.closest('button') && !e.target.closest('a')) empezar('mover', e) } : undefined} {...(modo === 'flotante' ? ptr : {})}>
                  <div className="er-lado-tt">
                    <b>Guion del recurso</b>
                    <span>{urlGuion ? 'Para leerlo y compararlo con el recurso' : 'Sin guion para mostrar'}</span>
                  </div>
                  {urlGuion && <div className="er-guion-modo" role="group" aria-label="Modo del guion">
                    <button type="button" className={guionEdita ? '' : 'on'} aria-pressed={!guionEdita} onClick={() => cambiarModoGuion(false)}>Solo lectura</button>
                    <button type="button" className={guionEdita ? 'on' : ''} aria-pressed={guionEdita} onClick={() => cambiarModoGuion(true)}>Editar</button>
                  </div>}
                  {actual.enlaceGuion && <a className="er-link" href={actual.enlaceGuion} target="_blank" rel="noopener noreferrer">Abrir en otra pestaña ↗</a>}
                  {modo === 'flotante' && <button type="button" className="er-mini" aria-label={flota.min ? 'Expandir el panel' : 'Minimizar el panel'} onClick={() => setFlota((f) => ({ ...f, min: !f.min }))}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d={flota.min ? 'M5 12h14M12 5v14' : 'M5 12h14'} /></svg></button>}
                </div>
                {urlGuion && guionEdita && <p className="er-guion-nota">Edita el documento original. Necesita sesión de Google con permiso de edición.</p>}
                <div className="er-lado-cuerpo guion">
                  {urlGuion
                    ? <iframe key={guionEdita ? 'e' : 'l'} className="er-guion-marco" title="Guion del recurso" src={urlGuion} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" />
                    : <p className="er-vacio">{actual.enlaceGuion ? 'El guion de este recurso no es un documento de Google que se pueda mostrar aquí. Ábralo con el enlace de arriba.' : 'Este recurso no tiene enlace al guion todavía.'}</p>}
                </div>
                {modo === 'flotante' && !flota.min && <span className="er-redim" aria-hidden="true" onPointerDown={(e) => empezar('redim', e)} {...ptr}><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 1L1 11M11 6L6 11" /></svg></span>}
              </aside>
              {arrastre && <div className={'er-capa ' + arrastre.tipo} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar} />}
            </div>

        {estado === 'listo' && (
            <footer className={'er-estadobar' + (sucio ? ' sucio' : '')}>
              <span className="er-punto" aria-hidden="true" />
              <b>{sucio ? 'Cambios sin guardar' : msg && msg.tipo === 'ok' ? 'Guardado' : 'Sin cambios pendientes'}</b>
              <span className="er-sp" />
              <span className="er-ayuda">Clic en un texto para editarlo · Enter confirma · Esc cierra si no hay cambios</span>
            </footer>
        )}
        </div>
        </div>
      </div>
      {dlgImg !== null && (
        <div className="er-dlg-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) setDlgImg(null) }}>
          <form className="er-dlg" role="dialog" aria-modal="true" aria-label="Enlace de la imagen" onSubmit={(e) => { e.preventDefault(); if (imgDlgValida && !ocupado) guardarImagen(dlgImg) }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setDlgImg(null) } }}>
            <b>Enlace de la imagen (https)</b>
            <input type="url" autoFocus value={dlgImg} maxLength={500} placeholder="https://…" onChange={(e) => setDlgImg(e.target.value)} aria-invalid={!imgDlgValida} />
            {!imgDlgValida && <small className="mal">Debe empezar con https:// y no llevar espacios ni comillas.</small>}
            <div className="er-dlg-acc">
              <button type="button" className="er-b" onClick={() => guardarImagen('')} disabled={!!ocupado || !imgActual}>Quitar imagen</button>
              <span className="er-sp" />
              <button type="button" className="er-b" onClick={() => setDlgImg(null)} disabled={!!ocupado}>Cancelar</button>
              <button type="submit" className="er-b pri" disabled={!!ocupado || !imgDlgValida}>{ocupado === 'imagen' ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </form>
        </div>
      )}
    </div>,
    document.body
  )
}
