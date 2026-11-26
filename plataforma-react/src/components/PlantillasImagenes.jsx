import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marcoPlantilla } from '../lib/vista.js'
import { verNombre } from '../lib/nombres.js'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'
import CambioMasivoImagenes from './CambioMasivoImagenes.jsx'
import './plantillas-imagenes.css'

// «Plantillas con imágenes»: las plantillas HTML subidas que traen imágenes, con el mismo orden y presentación que «Plantillas HTML» (clase → categoría → diseño).
// Al abrir una: la vista previa tal cual y, debajo, sus imágenes en el orden en que aparecen, con miniatura, URL editable y validación. La vista previa se actualiza
// al escribir una URL (antes de guardar). Al guardar, el servidor cambia solo el texto de esas URL: no toca el resto de la plantilla.

const CLASES = { recurso: 'Recursos', actividad: 'Actividades' }
const ESTADO = {
  valida: ['ok', 'Válida'], no_responde: ['bad', 'No responde'], no_es_imagen: ['bad', 'No es una imagen'], bloqueada: ['bad', 'URL no permitida'],
  sin_validar: ['', 'Sin validar'], cambiada: ['warn', 'Cambiada, sin validar'], validando: ['warn', 'Validando…']
}
const REV = { aprobada: ['ok', 'Aprobada'], rechazada: ['bad', 'Rechazada'], revision: ['warn', 'En revisión'], corregida: ['warn', 'Corregida'] }
const RE_HTTP = /^https?:\/\/[^\s"'`<>()\\]{1,2000}$/
const claseDe = (p) => (p.categoria && p.categoria.tipo === 'actividad' ? 'actividad' : 'recurso')
const fecha = (t) => { try { return new Date(t).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) } catch { return '' } }

function IcoFlecha({ izq }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {izq ? <path d="M19 12H5M11 6l-6 6 6 6" /> : <path d="M5 12h14M13 6l6 6-6 6" />}
    </svg>
  )
}

function Miniatura({ url }) {
  const [falla, setFalla] = useState(false)
  useEffect(() => { setFalla(false) }, [url])
  if (!RE_HTTP.test(url) || falla) return <span className="pi-mini sin" title={falla ? 'No se pudo mostrar esta imagen' : 'Sin vista previa'}>{falla ? 'Sin vista' : '—'}</span>
  return <a className="pi-mini" href={url} target="_blank" rel="noopener noreferrer" title="Abrir la imagen en otra pestaña"><img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFalla(true)} /></a>
}

function VistaPorPlantilla({ aviso, pestanas }) {
  const [lista, setLista] = useState(null) // plantillas con imágenes, en el orden de «Plantillas HTML»
  const [errorLista, setErrorLista] = useState('')
  const [clase, setClase] = useState('recurso')
  const [catSel, setCatSel] = useState('') // id de categoría ('' = sin categoría) elegida
  const [q, setQ] = useState('')
  const [nombre, setNombre] = useState('')
  const [det, setDet] = useState(null)
  const [errorDet, setErrorDet] = useState('')
  const [cambios, setCambios] = useState({}) // { indice: urlNueva } (solo lo que difiere de lo guardado)
  const [resultados, setResultados] = useState({}) // url → { estado, detalle } validadas en esta sesión
  const [validando, setValidando] = useState(new Set())
  const [guardando, setGuardando] = useState(false)
  const [errorGuardar, setErrorGuardar] = useState('')
  const [html, setHtml] = useState('')
  const [errorVista, setErrorVista] = useState('')
  const [esc, setEsc] = useState(0.6)
  const [full, setFull] = useState(false)
  const [sinVista, setSinVista] = useState(false) // «Ocultar vista previa»
  const caja = useRef(null)
  const vivo = useRef(true)
  // vivo se vuelve a poner en true al montar: en desarrollo (StrictMode) React monta, desmonta y vuelve a montar, y sin esto la lista nunca se pintaba.
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  const recargarLista = useCallback(() => api('GET', '/plantillas-imagenes').then((d) => { if (vivo.current) { setLista(d.plantillas); setErrorLista('') } }).catch((e) => { if (vivo.current) setErrorLista(e.message || 'No se pudo cargar la lista.') }), [])
  useEffect(() => { recargarLista() }, [recargarLista])

  // ---- lista: clase → categoría → diseño (igual que «Plantillas HTML»)
  const total = useMemo(() => ({ recurso: (lista || []).filter((p) => claseDe(p) === 'recurso').length, actividad: (lista || []).filter((p) => claseDe(p) === 'actividad').length }), [lista])
  const grupos = useMemo(() => {
    const t = q.trim().toLowerCase()
    const m = new Map()
    ;(lista || []).filter((p) => claseDe(p) === clase && (!t || (p.nombre + ' ' + (p.categoria ? p.categoria.id + ' ' + p.categoria.nombre : 'sin categoría')).toLowerCase().includes(t))).forEach((p) => {
      const id = p.categoria ? p.categoria.id : ''
      if (!m.has(id)) m.set(id, { id, titulo: p.categoria ? (p.categoria.nombre || p.categoria.id) : 'Sin categoría', items: [] })
      m.get(id).items.push(p)
    })
    return [...m.values()]
  }, [lista, clase, q])
  const grupo = grupos.find((g) => g.id === catSel) || grupos[0] || null
  const gi = grupo ? grupos.indexOf(grupo) : 0
  useEffect(() => { if (grupo && grupo.id !== catSel) setCatSel(grupo.id) }, [grupo, catSel])
  const pos = grupo ? grupo.items.findIndex((p) => p.nombre === nombre) : -1
  useEffect(() => { if (grupo && pos < 0 && !nombre) elegir(grupo.items[0].nombre, true) }, [grupo]) // eslint-disable-line react-hooks/exhaustive-deps

  const hayCambios = Object.keys(cambios).length > 0
  const elegir = (n, sinPreguntar) => {
    if (n === nombre) return
    if (!sinPreguntar && hayCambios && !window.confirm('Hay cambios sin guardar en esta plantilla. ¿Descartarlos?')) return
    setNombre(n)
  }
  const mover = (d) => { if (grupo && grupo.items.length) elegir(grupo.items[(Math.max(0, pos) + d + grupo.items.length) % grupo.items.length].nombre) }
  const irACategoria = (i) => { if (!grupos.length) return; const g = grupos[(i + grupos.length) % grupos.length]; if (g.items.some((p) => p.nombre === nombre)) { setCatSel(g.id); return } if (hayCambios && !window.confirm('Hay cambios sin guardar en esta plantilla. ¿Descartarlos?')) return; setCatSel(g.id); setNombre(g.items[0].nombre) }

  // ---- detalle de la plantilla elegida
  useEffect(() => {
    if (!nombre) return undefined
    let ok = true
    setDet(null); setErrorDet(''); setCambios({}); setResultados({}); setErrorGuardar(''); setHtml(''); setErrorVista('')
    api('GET', '/plantillas-imagenes/' + encodeURIComponent(nombre)).then((d) => { if (ok) setDet(d) }).catch((e) => { if (ok) setErrorDet(e.message || 'No se pudo abrir la plantilla.') })
    return () => { ok = false }
  }, [nombre])

  // ---- vista previa: la plantilla tal cual; al escribir una URL nueva se pide de nuevo con esas URL puestas (sin guardar)
  const clave = JSON.stringify(cambios)
  useEffect(() => {
    if (!nombre || !det) return undefined
    let ok = true
    const t = setTimeout(() => {
      api('POST', '/plantillas-imagenes/' + encodeURIComponent(nombre) + '/vista', { cambios }).then((d) => { if (ok) { setHtml(d.html); setErrorVista('') } }).catch((e) => { if (ok) setErrorVista(e.message || 'No se pudo armar la vista previa.') })
    }, html ? 600 : 0)
    return () => { ok = false; clearTimeout(t) }
  }, [nombre, det, clave]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = caja.current
    if (!el) return undefined
    const medir = () => { const w = el.clientWidth; if (w > 0) setEsc(w / 1280) }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [full, !!det])
  useEffect(() => {
    if (!full) return undefined
    const f = (e) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [full])

  // ---- imágenes
  const imagenes = det ? det.imagenes : []
  const actual = (i) => (cambios[i.indice] !== undefined ? cambios[i.indice] : i.url)
  const repetidas = useMemo(() => { const c = {}; imagenes.forEach((i) => { c[i.url] = (c[i.url] || 0) + 1 }); return c }, [imagenes])
  const estadoDe = (i) => {
    const u = actual(i)
    if (validando.has(u)) return 'validando'
    if (resultados[u]) return resultados[u].estado
    if (cambios[i.indice] !== undefined) return 'cambiada'
    return i.estado
  }
  const detalleDe = (i) => { const u = actual(i); return resultados[u] ? resultados[u].detalle : (cambios[i.indice] === undefined ? i.detalle : '') }
  const escribir = (i, valor) => {
    setErrorGuardar('')
    setCambios((c) => { const n = { ...c }; if (valor === i.url) delete n[i.indice]; else n[i.indice] = valor; return n })
  }
  const aRepetidas = (i) => setCambios((c) => { const n = { ...c }; const v = actual(i); imagenes.forEach((x) => { if (x.url === i.url) { if (v === x.url) delete n[x.indice]; else n[x.indice] = v } }); return n })
  const urlMala = (i) => { const u = actual(i); return u !== i.url && !RE_HTTP.test(u) }

  const validar = async (urls) => {
    const buenas = [...new Set(urls)].filter((u) => RE_HTTP.test(u))
    const malas = urls.filter((u) => !RE_HTTP.test(u))
    if (malas.length) setResultados((r) => { const n = { ...r }; malas.forEach((u) => { n[u] = { estado: 'bloqueada', detalle: 'Debe empezar por http:// o https:// y no llevar espacios.' } }); return n })
    if (!buenas.length) return
    setValidando((s) => new Set([...s, ...buenas]))
    try {
      for (let k = 0; k < buenas.length; k += 40) {
        const trozo = buenas.slice(k, k + 40)
        const d = await api('POST', '/plantillas-imagenes/' + encodeURIComponent(nombre) + '/validar', { urls: trozo })
        if (!vivo.current) return
        setResultados((r) => ({ ...r, ...d.resultados }))
      }
    } catch (e) { if (aviso) aviso(e.message || 'No se pudo validar.') } finally {
      if (vivo.current) setValidando((s) => { const n = new Set(s); buenas.forEach((u) => n.delete(u)); return n })
    }
  }
  const validarTodas = () => validar(imagenes.map(actual))

  const guardar = async () => {
    setGuardando(true); setErrorGuardar('')
    try {
      const d = await api('PUT', '/plantillas-imagenes/' + encodeURIComponent(nombre), { base: det.base, cambios: Object.entries(cambios).map(([indice, url]) => ({ indice: Number(indice), url })) })
      setDet((x) => ({ ...x, base: d.base, imagenes: d.imagenes, historial: d.historial })); setCambios({}); setResultados({})
      if (aviso) aviso(d.cambiadas === 1 ? 'Imagen actualizada en la plantilla' : d.cambiadas + ' imágenes actualizadas en la plantilla')
      recargarLista()
    } catch (e) { setErrorGuardar(e.message || 'No se pudo guardar.') } finally { setGuardando(false) }
  }
  const recargar = () => { const n = nombre; setNombre(''); setTimeout(() => setNombre(n), 0) }

  const pendientes = imagenes.filter((i) => ['sin_validar', 'cambiada'].includes(estadoDe(i))).length
  const conProblema = imagenes.filter((i) => ['no_responde', 'no_es_imagen', 'bloqueada'].includes(estadoDe(i))).length
  const sel = lista && lista.find((p) => p.nombre === nombre)

  return (
    <div className="wrapx fade pi pi-mas">
      <div className="pi-mas-cab">
        <Titulo icono="codigo">
          <h1>Plantillas con imágenes</h1>
          <p className="lead">Las plantillas HTML que traen imágenes. Vea cada una, compruebe que sus imágenes cargan y corrija sus direcciones (URL) sin tocar lo demás de la plantilla.</p>
        </Titulo>
        <div className="pi-mas-tabs">{pestanas}</div>
      </div>

      <div className="card pi-mas-barra">
        <div>
          <span className="pg-lb">Clase de HTML</span>
          <div className="pg-seg" role="tablist" aria-label="Clase de HTML">
            {['recurso', 'actividad'].map((c) => (
              <button key={c} type="button" role="tab" aria-selected={clase === c} className={clase === c ? 'on' : ''} onClick={() => { if (c !== clase) { setClase(c); setQ(''); setCatSel(''); setNombre('') } }}>{CLASES[c]} <span>· {total[c]}</span></button>
            ))}
          </div>
        </div>
        <div className="pg-cat">
          <span className="pg-lb">Categoría</span>
          <div className="pg-cat-fila">
            <button type="button" className="pg-flecha" aria-label="Categoría anterior" disabled={grupos.length < 2} onClick={() => irACategoria(gi - 1)}><IcoFlecha izq /></button>
            <select className="pi-sel" aria-label="Categoría" value={grupo ? grupo.id : ''} disabled={!grupos.length} onChange={(e) => irACategoria(grupos.findIndex((g) => g.id === e.target.value))}>
              {grupos.map((g) => <option key={g.id} value={g.id}>{(g.id ? g.id + ' · ' : '') + g.titulo + ' (' + g.items.length + ')'}</option>)}
            </select>
            <button type="button" className="pg-flecha" aria-label="Categoría siguiente" disabled={grupos.length < 2} onClick={() => irACategoria(gi + 1)}><IcoFlecha /></button>
          </div>
        </div>
        <label className="pg-busca pi-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input aria-label="Buscar una plantilla" placeholder="Buscar una plantilla" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>


      {errorLista && <div className="msg bad" role="alert">{errorLista}</div>}
      {!lista && !errorLista && <p className="help">Cargando plantillas…</p>}
      {lista && !grupo && (
        <div className="card pg-vacio">
          <b>{q.trim() ? 'Ninguna plantilla coincide con la búsqueda.' : lista.length ? 'No hay plantillas con imágenes en esta clase.' : 'Ninguna plantilla subida trae imágenes todavía.'}</b>
          <span>Aquí solo salen las plantillas que tienen imágenes (&lt;img&gt;, srcset o imagen de fondo).</span>
        </div>
      )}

      {grupo && (
        <div className="pi-mas-cuerpo pi-por-cuerpo">
          <section className="pi-mas-imgs" aria-label="Imágenes">
            {errorDet && <div className="msg bad" role="alert">{errorDet}</div>}
            {!det && !errorDet && <p className="help">Cargando imágenes…</p>}
              {det && <div className="card pi-panel pi-panel-sola">
                <div className="pi-cab">
                  <div>
                    <h4>Imágenes de la plantilla</h4>
                    <span className="help">{imagenes.length} {imagenes.length === 1 ? 'imagen' : 'imágenes'}, en el orden en que aparecen{conProblema ? ' · ' + conProblema + ' con problema' : ''}{pendientes ? ' · ' + pendientes + ' sin validar' : ''}</span>
                  </div>
                  <div className="pi-acciones">
                    <button type="button" className="btn sec sm" disabled={!imagenes.length || validando.size > 0} onClick={validarTodas}>{validando.size ? 'Validando…' : 'Validar todas'}</button>
                    {hayCambios && <button type="button" className="btn sec sm" disabled={guardando} onClick={() => { setCambios({}); setErrorGuardar('') }}>Descartar cambios</button>}
                    <button type="button" className="btn sm" disabled={!hayCambios || guardando || imagenes.some(urlMala)} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar cambios' + (hayCambios ? ' (' + Object.keys(cambios).length + ')' : '')}</button>
                  </div>
                </div>
                {errorGuardar && <div className="msg bad" role="alert">{errorGuardar} {/desactualiz|mientras la editaba/i.test(errorGuardar) && <button type="button" className="btn sec sm" onClick={recargar}>Recargar</button>}</div>}
                <ol className="pi-lista">
                  {imagenes.map((i) => {
                    const u = actual(i)
                    const e = estadoDe(i)
                    const [cl, tx] = ESTADO[e] || ESTADO.sin_validar
                    return (
                      <li key={i.indice} className={'pi-img' + (cambios[i.indice] !== undefined ? ' cambiada' : '')}>
                        <span className="pl2-n">{i.indice + 1}</span>
                        <Miniatura url={u} />
                        <div className="pi-datos">
                          <div className="pi-meta">
                            <span className="pi-lugar">{i.lugar}</span>
                            {i.alt !== null && <span title="Texto alternativo">alt: «{i.alt || '(vacío)'}»</span>}
                            {(i.ancho || i.alto) && <span>{i.ancho || '?'} × {i.alto || '?'}</span>}
                            {repetidas[i.url] > 1 && <span className="pi-rep" title="La misma URL aparece más de una vez en la plantilla">repetida ×{repetidas[i.url]}</span>}
                          </div>
                          {i.contexto && <small className="pi-ctx">Cerca de: {i.contexto}</small>}
                          <input className={'pi-url' + (urlMala(i) ? ' err' : '')} aria-label={'URL de la imagen ' + (i.indice + 1)} value={u} spellCheck={false} maxLength={2000} onChange={(ev) => escribir(i, ev.target.value.trim())} />
                          {urlMala(i) && <small className="pi-err">Debe empezar por http:// o https:// y no llevar espacios ni comillas.</small>}
                          <div className="pi-fila">
                            <span className={'pill ' + cl}>{tx}</span>
                            {detalleDe(i) && <small className="pi-det">{detalleDe(i)}</small>}
                            <span className="sp" />
                            {cambios[i.indice] !== undefined && repetidas[i.url] > 1 && <button type="button" className="pi-lnk" onClick={() => aRepetidas(i)}>Aplicar a las repetidas</button>}
                            {cambios[i.indice] !== undefined && <button type="button" className="pi-lnk" onClick={() => escribir(i, i.url)}>Deshacer</button>}
                            <button type="button" className="btn sec sm" disabled={validando.has(u)} onClick={() => validar([u])}>Validar</button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
                {!imagenes.length && <p className="help">Esta plantilla ya no tiene imágenes.</p>}
              </div>}
          </section>

          <div className="pi-mas-der">
            <aside className="card pi-mas-lado pi-por-lista">
              <h4>Diseños de {grupo.titulo.toLowerCase()}</h4>
              <p className="help">{grupo.items.length} {grupo.items.length === 1 ? 'diseño' : 'diseños'} con imágenes en esta categoría.</p>
              {grupo.items.map((p, k) => {
                const r = p.revision ? REV[p.revision] : null
                return (
                  <button key={p.nombre} type="button" className={p.nombre === nombre ? 'on' : ''} onClick={() => elegir(p.nombre)}>
                    <span className="pl2-n">{k + 1}</span>
                    <span><b>{verNombre(p.nombre)}</b><small>{p.imagenes} {p.imagenes === 1 ? 'imagen' : 'imágenes'}{p.conProblema ? ' · ' + p.conProblema + ' con problema' : p.sinValidar ? ' · ' + p.sinValidar + ' sin validar' : ' · todas válidas'}</small></span>
                    <span className="pg-etqs">{r ? <span className={'pill rv-mini ' + r[0]}>{r[1]}</span> : <span className="pill rv-mini pg-sinrev">Sin revisar</span>}</span>
                  </button>
                )
              })}
            </aside>
            <div className={'card pi-mas-prev' + (full ? ' pl2-prev full' : '')} aria-label="Vista previa">
            <div className="pl2-barra">
              <div className="pl2-tit"><small>{grupo.titulo}</small><b>{verNombre(nombre || grupo.items[0].nombre)}</b></div>
              <button type="button" className="pg-flecha chica" aria-label="Diseño anterior" onClick={() => mover(-1)}><IcoFlecha izq /></button>
              <span className="pl2-pos">{Math.max(0, pos) + 1} / {grupo.items.length}</span>
              <button type="button" className="pg-flecha chica" aria-label="Diseño siguiente" onClick={() => mover(1)}><IcoFlecha /></button>
              {!sinVista && <button className="btn sec sm" onClick={() => setFull(!full)}>{full ? 'Cerrar pantalla completa' : 'Pantalla completa'}</button>}
              {!full && <button type="button" className="btn sec sm" onClick={() => setSinVista(!sinVista)}>{sinVista ? 'Mostrar vista previa' : 'Ocultar vista previa'}</button>}
            </div>
            {(errorDet || errorVista) && <div className="msg bad" role="alert">{errorDet || errorVista}</div>}
            {!sinVista && <div className="pl2-caja" ref={caja} style={full ? { maxWidth: 'calc((100vh - 130px) * 16 / 9)' } : undefined}>
              {!html && !errorVista && !errorDet && <p className="help" style={{ padding: 18 }}>Cargando…</p>}
              {html && <iframe sandbox="allow-scripts" title={'Plantilla ' + verNombre(nombre)} srcDoc={html} style={marcoPlantilla(esc)} />}
            </div>}
            {!full && !sinVista && <p className="help pl2-pie">{hayCambios ? 'La vista previa ya muestra las URL que escribió; todavía no están guardadas.' : 'Se ve a 1280 × 720, con el ejemplo de la plantilla.'} Las imágenes que cargan por http (sin la «s») no se ven aquí.</p>}
            </div>
            {det && det.historial && det.historial.length > 0 && (
              <div className="card pi-hist">
                <h4>Cambios de imágenes</h4>
                <ul>
                  {det.historial.map((h) => (
                    <li key={h.id}>
                      <b>{h.usuario}</b> <small>{fecha(h.creado)}</small>
                      <span>{h.cambios.some((c) => c.masivo) ? 'Cambio masivo: ' : ''}{h.cambios.length === 1 ? 'Cambió la imagen ' : 'Cambió las imágenes '}{h.cambios.map((c) => c.indice + 1).join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {sel && <p className="help pi-nota">Solo cambia las direcciones de las imágenes. La plantilla no se sube, revisa ni elimina desde aquí.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// Dos modos: por plantilla (la vista de siempre) y cambio masivo (por imagen, en todas las plantillas).
export default function PlantillasImagenes({ aviso }) {
  const [modo, setModo] = useState('plantilla')
  const pestanas = (
    <div className="pg-fila-tabs">
      <div className="pg-tabs" role="tablist" aria-label="Modo">
        <button type="button" role="tab" aria-selected={modo === 'plantilla'} className={modo === 'plantilla' ? 'on' : ''} onClick={() => setModo('plantilla')}>Por plantilla</button>
        <button type="button" role="tab" aria-selected={modo === 'masivo'} className={modo === 'masivo' ? 'on' : ''} onClick={() => setModo('masivo')}>Cambio masivo</button>
      </div>
    </div>
  )
  return modo === 'masivo' ? <CambioMasivoImagenes aviso={aviso} pestanas={pestanas} /> : <VistaPorPlantilla aviso={aviso} pestanas={pestanas} />
}
