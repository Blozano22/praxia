import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CargaRecurso from './CargaRecurso.jsx'
import { api, RUTA_API } from '../lib/api.js'
import codigoEditor from '../lib/editor-campos.js?raw'
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
function armarPagina(esqueleto, contenido, titulo, formacion, activo) {
  const marca = NIVEL[formacion] ? '<script>window.__NIVEL=' + JSON.stringify(NIVEL[formacion]) + '</script>' : ''
  let h = esqueleto.replace('{{TITULO}}', () => esc(titulo || 'Recurso')).replace('/*CONTENIDO*/', () => json(contenido))
  if (marca) h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, (m) => m + marca) : marca + h
  const editor = '<script>' + codigoEditor + '</script><script>PraxiaEditor.iniciar({ contenido: ' + json(contenido) + ', activo: ' + (activo ? 'true' : 'false') + ' })</script>'
  return /<\/body>/i.test(h) ? h.replace(/<\/body>/i, () => editor + '</body>') : h + editor
}

// Lista de recursos del curso (lado izquierdo del editor): los generados, los que se están generando y los que esperan revisión, agrupados por unidad,
// con un botón rápido para aprobar cada uno y otro para aprobar todos los de una unidad. Solo lee `recursos` (ya vienen de la pantalla de Matrices y H5P).
const ORDEN_ESTADO = { POR_REVISAR: 0, ERROR: 1, EN_PROCESO: 2, GENERADO: 3, PENDIENTE: 4 }
const TEXTO_ESTADO = { POR_REVISAR: 'Por revisar', ERROR: 'Con error', EN_PROCESO: 'Generando', GENERADO: 'Generado', PENDIENTE: 'Por generar' }

function ListaRecursos({ recursos, actualId, puedePublicar, sucio, onElegir, onAprobar }) {
  const [filtro, setFiltro] = useState('con') // con = los que ya tienen algo que ver; revisar; todos
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
    recursos.filter(pasa).forEach((r) => { const u = r.unidad == null ? 0 : r.unidad; if (!m.has(u)) m.set(u, []); m.get(u).push(r) })
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([u, l]) => [u, l.sort((a, b) => (ORDEN_ESTADO[a.estado] ?? 9) - (ORDEN_ESTADO[b.estado] ?? 9) || String(a.codigo || a.id).localeCompare(String(b.codigo || b.id)))])
  }, [recursos, filtro]) // eslint-disable-line react-hooks/exhaustive-deps
  const aprobable = (r) => puedePublicar && onAprobar && r.conContenido && !r.publicando && !r.enCola && (r.estado === 'POR_REVISAR' || r.estado === 'ERROR')

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
    if (!window.confirm('Se aprobarán y publicarán ' + por.length + (por.length === 1 ? ' recurso' : ' recursos') + ' de la Unidad ' + u + '. ¿Continuar?')) return
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
        {grupos.map(([u, lista]) => {
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
              {!cerrada && (
                <ul>
                  {lista.map((r) => {
                    const pub = !!r.publicando && !r.publicandoSinRespuesta
                    const sin = !!r.sinRespuesta && !pub // lleva mucho sin avisos: no es «generando», es un aviso que no llegó
                    const k = sin ? 'er' : pub || r.estado === 'EN_PROCESO' ? 'en' : r.estado === 'POR_REVISAR' ? 'prev' : r.estado === 'GENERADO' ? 'ok' : r.estado === 'ERROR' ? 'er' : 'pe'
                    return (
                      <li key={r.id} className={'er-rec ' + k + (r.id === actualId ? ' on' : '')}>
                        <button type="button" className="er-rec-btn" aria-current={r.id === actualId ? 'true' : undefined} onClick={() => onElegir(r)}>
                          <span className={'er-rec-ic ' + k} aria-hidden="true">{k === 'en' ? <i className="er-gira" /> : k === 'ok' ? '✓' : k === 'er' ? '!' : ''}</span>
                          <span className="er-rec-tx"><b>{r.codigo || r.id}</b><small>{r.titulo || 'Sin título'}</small></span>
                          <span className={'er-rec-et ' + k}>{pub ? 'Publicando…' : sin ? 'Sin avisos' : r.enCola ? (r.regenera ? 'Se regenerará' : 'En cola') : TEXTO_ESTADO[r.estado] || r.estado}</span>
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
            </section>
          )
        })}
      </div>
      <p className="er-nav-pie">{conteo.pendientes > 0 ? conteo.pendientes + (conteo.pendientes === 1 ? ' recurso espera' : ' recursos esperan') + ' su generación.' : 'Todos los recursos ya se generaron.'}</p>
    </nav>
  )
}

export default function EditorRecurso({ proyecto, recurso, recursos = [], puedePublicar, onAprobar, onElegir, onCerrar }) {
  const [estado, setEstado] = useState('cargando') // cargando | listo | error
  const [error, setError] = useState('')
  const [pagina, setPagina] = useState('')
  const [campos, setCampos] = useState([])
  const [activo, setActivo] = useState(true)
  const [sucio, setSucio] = useState(false)
  const [msg, setMsg] = useState(null) // { tipo: 'ok' | 'bad' | 'warn', texto }
  const [ocupado, setOcupado] = useState('')
  const [verTodos, setVerTodos] = useState(false)
  const [navAbierta, setNavAbierta] = useState(() => typeof window === 'undefined' || window.innerWidth > 860) // en pantallas angostas la lista de recursos se abre a demanda
  const ref = useRef({ contenido: null, esqueleto: '', titulo: '', formacion: null, activo: true })
  const marco = useRef(null)
  const ruta = '/proyectos/' + encodeURIComponent(proyecto) + '/pipeline/recursos/' + encodeURIComponent(recurso.id) + '/contenido'

  const pintar = useCallback((activoAhora) => {
    const r = ref.current
    setPagina(armarPagina(r.esqueleto, r.contenido, r.titulo, r.formacion, activoAhora))
  }, [])

  useEffect(() => {
    let vivo = true
    setEstado('cargando'); setError(''); setCampos([]); setSucio(false); setMsg(null); setVerTodos(false); setPagina('')
    if (recurso.conContenido === false) { setEstado('sinContenido'); return () => { vivo = false } }
    ;(async () => {
      try {
        const c = await api('GET', ruta)
        if (!c.plantilla) throw new Error('Este recurso no tiene plantilla registrada.')
        const r = await fetch(RUTA_API.replace(/\/api$/, '') + '/plantillas-html/' + encodeURIComponent(c.plantilla) + '.html')
        if (!r.ok) throw new Error('No se encontró la plantilla ' + c.plantilla.toUpperCase() + '.')
        const esqueleto = await r.text()
        if (!vivo) return
        ref.current = { contenido: c.contenido, esqueleto, titulo: (c.contenido && c.contenido.titulo) || c.titulo, formacion: c.formacion || null, activo: true }
        pintar(true)
        setEstado('listo')
      } catch (e) { if (vivo) { setError(e.message || 'No se pudo abrir el editor'); setEstado('error') } }
    })()
    return () => { vivo = false }
  }, [ruta, pintar, recurso.conContenido])

  // Mensajes del módulo del iframe
  useEffect(() => {
    const alMensaje = (e) => {
      if (!marco.current || e.source !== marco.current.contentWindow) return
      const d = e.data
      if (!d || d.fuente !== 'praxia-editor') return
      if (d.tipo === 'listo' || d.tipo === 'lista') setCampos(Array.isArray(d.campos) ? d.campos : [])
      else if (d.tipo === 'campo' && typeof d.ruta === 'string' && typeof d.valor === 'string') {
        if (!ponerRuta(ref.current.contenido, d.ruta, d.valor)) return
        setSucio(true); setMsg(null)
        setCampos((cs) => cs.map((c) => (c.ruta === d.ruta ? { ...c, valor: d.valor } : c)))
        if (!d.parchado) pintar(ref.current.activo) // el texto no se pudo cambiar en pantalla: se vuelve a pintar con el JSON nuevo
      } else if (d.tipo === 'sin_campo') setMsg({ tipo: 'warn', texto: 'Ese texto no viene de un campo que se pueda editar por clic. Búscalo en la lista de textos de la derecha.' })
    }
    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [pintar])

  const cambiarModo = (v) => {
    ref.current.activo = v; setActivo(v)
    try { marco.current && marco.current.contentWindow.postMessage({ fuente: 'praxia-editor', tipo: 'modo', activo: v }, '*') } catch { /* iframe aún sin cargar */ }
  }

  const editarLista = (c, valor) => {
    if (valor === c.valor) return
    if (!ponerRuta(ref.current.contenido, c.ruta, valor)) return
    setSucio(true); setMsg(null)
    setCampos((cs) => cs.map((x) => (x.ruta === c.ruta ? { ...x, valor } : x)))
    pintar(ref.current.activo)
  }

  const guardar = async () => {
    setOcupado('guardar'); setMsg(null)
    try { await api('PUT', ruta, { contenido: ref.current.contenido }); setSucio(false); setMsg({ tipo: 'ok', texto: 'Cambios guardados.' }); return true }
    catch (e) { setMsg({ tipo: 'bad', texto: e.message || 'No se pudo guardar.' }); return false }
    finally { setOcupado('') }
  }

  const descargar = async () => {
    if (sucio && !(await guardar())) return
    setOcupado('h5p'); setMsg(null)
    try {
      const r = await fetch(RUTA_API + '/proyectos/' + encodeURIComponent(proyecto) + '/pipeline/recursos/' + encodeURIComponent(recurso.id) + '/h5p', { method: 'POST', credentials: 'same-origin', headers: { 'x-ova': '1' } })
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
  const aprobarYPublicar = async () => {
    if (sucio && !(await guardar())) return
    setOcupado('aprobar'); setMsg(null)
    try { const hecho = await onAprobar(actual); if (hecho) setMsg({ tipo: 'ok', texto: 'Enviado a publicar. Puede seguir revisando otros recursos mientras se publica.' }) }
    catch (e) { setMsg({ tipo: 'bad', texto: e.message || 'No se pudo aprobar el recurso.' }) }
    finally { setOcupado('') }
  }

  const cerrar = () => { if (sucio && !window.confirm('Hay cambios sin guardar. ¿Cerrar sin guardarlos?')) return; onCerrar() }
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape' && !sucio) onCerrar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [sucio, onCerrar])

  const sinPantalla = useMemo(() => campos.filter((c) => !c.enPantalla), [campos])
  const lista = verTodos ? campos : sinPantalla

  // ---- Distribución de la pantalla (solo aspecto): dividida, panel flotante o solo recurso. El iframe NO cambia de sitio en el árbol: solo cambian clases y medidas,
  // así no se recarga ni pierde su estado.
  const [modo, setModo] = useState('dividida') // dividida | flotante | recurso
  const [orient, setOrient] = useState('h') // h = lado a lado, v = arriba/abajo
  const [invertido, setInvertido] = useState(false) // el panel de textos va primero
  const [frac, setFrac] = useState(0.7) // parte del espacio para la vista del recurso
  const [flota, setFlota] = useState({ x: 40, y: 20, w: 360, h: 420, min: false })
  const [arrastre, setArrastre] = useState(null)
  const cuerpo = useRef(null)
  const empezar = (tipo, e) => {
    e.preventDefault()
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
  const pesos = [['Vista 30%', 0.3], ['50 / 50', 0.5], ['Vista 70%', 0.7]]
  const estiloLado = modo === 'flotante' ? { left: flota.x, top: flota.y, width: flota.w, height: flota.min ? 46 : flota.h } : undefined
  const nCampos = campos.length
  const actual = recursos.find((x) => x.id === recurso.id) || recurso
  const publicandoAhora = !!actual.publicando && !actual.publicandoSinRespuesta
  const elegirRecurso = (r) => {
    if (r.id === recurso.id || !onElegir) return
    if (sucio && !window.confirm('Hay cambios sin guardar en este recurso. ¿Pasar a otro sin guardarlos?')) return
    onElegir(r)
    if (typeof window !== 'undefined' && window.innerWidth <= 860) setNavAbierta(false)
  }
  // Página completa: el resto de la pantalla no se desplaza detrás
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } }, [])

  // Se pinta en <body>: así ocupa toda la ventana aunque la pantalla de abajo tenga transformaciones o se haya desplazado
  return createPortal(
    <div className="er-fondo" role="dialog" aria-modal="true" aria-label={'Editar ' + (recurso.codigo || recurso.id)}>
      <div className="er-caja">
        <header className="er-cab">
          <button type="button" className="er-volver" onClick={cerrar} aria-label="Volver a Matrices y H5P"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>Volver</button>
          {recursos.length > 0 && <button type="button" className={'er-navbtn' + (navAbierta ? ' on' : '')} aria-expanded={navAbierta} onClick={() => setNavAbierta(!navAbierta)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>Recursos</button>}
          <div className="er-tt"><b>{recurso.codigo || recurso.id}</b><span>{recurso.titulo || 'Sin título'}</span></div>
          {estado === 'listo' && <label className={'er-modo' + (activo ? ' on' : '')} title="Con esto activo, un clic en cualquier texto del recurso lo abre para editarlo">
            <input type="checkbox" checked={activo} onChange={(e) => cambiarModo(e.target.checked)} />
            <i className="er-sw" aria-hidden="true" />
            Editar con clic
          </label>}
          {estado === 'listo' && puedePublicar && onAprobar && ['POR_REVISAR', 'GENERADO', 'ERROR'].includes(actual.estado) && <button type="button" className="er-b ok" onClick={aprobarYPublicar} disabled={!!ocupado || publicandoAhora} title="Aprobar este contenido: n8n arma el H5P y lo sube a Drive">{ocupado === 'aprobar' ? 'Enviando…' : publicandoAhora ? 'Publicando…' : actual.estado === 'GENERADO' ? 'Aprobar y volver a publicar' : 'Aprobar y publicar'}</button>}
          {estado === 'listo' && <button type="button" className="er-b" onClick={guardar} disabled={!sucio || !!ocupado}>{ocupado === 'guardar' ? <><i className="er-gira" aria-hidden="true" />Guardando…</> : 'Guardar cambios'}</button>}
          {estado === 'listo' && <button type="button" className="er-b pri" onClick={descargar} disabled={!!ocupado}>{ocupado === 'h5p' ? <><i className="er-gira" aria-hidden="true" />Armando el H5P…</> : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M4 20h16" /></svg>Descargar .h5p</>}</button>}
        </header>

        <div className={'er-cols' + (navAbierta ? ' nav' : '')}>
        {recursos.length > 0 && navAbierta && <ListaRecursos recursos={recursos} actualId={recurso.id} puedePublicar={puedePublicar} sucio={sucio} onElegir={elegirRecurso} onAprobar={onAprobar} />}
        <div className="er-main">
        {msg && <p className={'er-msg ' + msg.tipo} role="status"><i className="er-msg-ic" aria-hidden="true">{msg.tipo === 'ok' ? '✓' : msg.tipo === 'bad' ? '!' : '!'}</i><span>{msg.texto}</span></p>}
        {publicandoAhora && <p className="er-msg info" role="status"><i className="er-gira" aria-hidden="true" /><span>Publicando en Drive. Este aviso se quita solo cuando n8n termina; puede seguir revisando otros recursos mientras tanto.</span></p>}
        {ocupado === 'h5p' && <p className="er-msg info" role="status"><i className="er-gira" aria-hidden="true" /><span>Armando el H5P con los cambios. Suele tardar unos 3 segundos; en algunos casos hasta 90. No cierre esta ventana.</span></p>}

        {estado === 'sinContenido' && <div className="er-estado">{actual.estado === 'EN_PROCESO' || actual.publicando ? <CargaRecurso tam="grande" /> : <i className="er-estado-ic info" aria-hidden="true">{actual.estado === 'PENDIENTE' ? '…' : 'i'}</i>}<b>{actual.publicando ? 'Este recurso se está publicando' : actual.estado === 'EN_PROCESO' ? 'Este recurso se está generando' : actual.estado === 'PENDIENTE' ? 'Este recurso todavía no se genera' : 'Este recurso no se puede editar aquí'}</b><span>{actual.publicando ? 'n8n está armando el H5P y subiéndolo a Drive. Cuando termine, el recurso aparecerá como «Generado».' : actual.estado === 'EN_PROCESO' || actual.estado === 'PENDIENTE' ? 'Cuando n8n termine, aparecerá en la lista como «Por revisar» y podrá abrirlo para corregir sus textos.' : 'Se generó antes de que Praxia guardara su contenido, así que sus textos no se pueden corregir desde esta pantalla.'}</span></div>}
        {estado === 'cargando' && <div className="er-estado"><CargaRecurso tam="grande" etiqueta="Abriendo el recurso" /><b>Abriendo el recurso…</b><span>Se está preparando la plantilla con su contenido.</span></div>}
        {estado === 'error' && <div className="er-estado mal" role="alert"><i className="er-estado-ic" aria-hidden="true">!</i><b>No se pudo abrir el editor</b><span>{error}</span></div>}

        {estado === 'listo' && (
          <>
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
              {modo === 'flotante' && <span className="er-ayuda">Arrastre el panel de textos desde su título; cambie su tamaño desde la esquina.</span>}
              {modo === 'recurso' && <span className="er-ayuda">Haga clic en cualquier texto del recurso para editarlo.</span>}
            </div>

            <div ref={cuerpo} className={'er-cuerpo er-m-' + modo + ' er-o-' + orient + (invertido ? ' er-inv' : '')} style={{ '--f': frac }}>
              <div className="er-vista">
                <iframe ref={marco} className="er-marco" title="Vista del recurso" sandbox="allow-scripts" srcDoc={pagina} />
              </div>
              <div className={'er-asa' + (arrastre && arrastre.tipo === 'divisor' ? ' act' : '')} role="separator" aria-label="Repartir el espacio entre la vista y los textos" onMouseDown={(e) => empezar('divisor', e)}><i /></div>
              <aside className={'er-lado' + (flota.min && modo === 'flotante' ? ' min' : '')} style={estiloLado} aria-label="Lista de textos">
                <div className="er-lado-cab" onMouseDown={modo === 'flotante' ? (e) => { if (!e.target.closest('button')) empezar('mover', e) } : undefined}>
                  <div className="er-lado-tt">
                    <b>{verTodos ? 'Todos los textos' : 'Textos que no se editan por clic'}</b>
                    <span>{verTodos ? nCampos + ' en total' : sinPantalla.length + ' de ' + nCampos}</span>
                  </div>
                  <button type="button" className="er-link" onClick={() => setVerTodos((v) => !v)}>{verTodos ? 'Ver solo los de respaldo' : 'Ver todos (' + nCampos + ')'}</button>
                  {modo === 'flotante' && <button type="button" className="er-mini" aria-label={flota.min ? 'Expandir el panel' : 'Minimizar el panel'} onClick={() => setFlota((f) => ({ ...f, min: !f.min }))}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d={flota.min ? 'M5 12h14M12 5v14' : 'M5 12h14'} /></svg></button>}
                </div>
                <div className="er-lado-cuerpo">
                  {!lista.length && <p className="er-vacio">{verTodos ? 'No hay textos.' : 'Todos los textos se pueden editar con un clic.'}</p>}
                  <ul>
                    {lista.map((c) => (
                      <li key={c.ruta}>
                        <label>
                          <span>{c.etiqueta}</span>
                          {c.largo
                            ? <textarea defaultValue={c.valor} key={c.ruta + '|' + c.valor} rows={4} onBlur={(e) => editarLista(c, e.target.value)} />
                            : <input type="text" defaultValue={c.valor} key={c.ruta + '|' + c.valor} onBlur={(e) => editarLista(c, e.target.value)} />}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="er-pie">Solo se cambian textos. Los íconos y valores fijos (encabezado, tipo…) no se editan aquí.</p>
                </div>
                {modo === 'flotante' && !flota.min && <span className="er-redim" aria-hidden="true" onMouseDown={(e) => empezar('redim', e)}><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 1L1 11M11 6L6 11" /></svg></span>}
              </aside>
              {arrastre && <div className={'er-capa ' + arrastre.tipo} onMouseMove={mover} onMouseUp={() => setArrastre(null)} />}
            </div>

            <footer className={'er-estadobar' + (sucio ? ' sucio' : '')}>
              <span className="er-punto" aria-hidden="true" />
              <b>{sucio ? 'Cambios sin guardar' : msg && msg.tipo === 'ok' ? 'Guardado' : 'Sin cambios pendientes'}</b>
              <span className="er-sp" />
              <span className="er-ayuda">Clic en un texto para editarlo · Enter confirma · Esc cierra si no hay cambios</span>
            </footer>
          </>
        )}
        </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
