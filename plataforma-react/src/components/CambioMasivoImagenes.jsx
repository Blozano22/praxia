import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { marcoPlantilla } from '../lib/vista.js'
import { verNombre } from '../lib/nombres.js'
import Titulo from './Titulo.jsx'
import './plantillas-imagenes.css'

// «Cambio masivo» de «Plantillas con imágenes»: a un lado las plantillas; al otro, las imágenes (URL únicas) con las plantillas que las usan. Se escribe una URL nueva
// en una fila (o en varias) y se aplica a todas las plantillas que la usan, a las que se puede quitar de la lista antes de confirmar. Todo en una sola operación.

const RE_HTTP = /^https?:\/\/[^\s"'`<>()\\]{1,2000}$/
const ESTADO = {
  valida: ['ok', 'Válida'], no_responde: ['bad', 'No responde'], no_es_imagen: ['bad', 'No es una imagen'], bloqueada: ['bad', 'URL no permitida'],
  sin_validar: ['', 'Sin validar'], validando: ['warn', 'Validando…']
}
const DONDE = { script: 'en el código (script)', fondo: 'como imagen de fondo', srcset: 'en una imagen adaptable (srcset)', etiqueta: 'en una imagen de la página' }
const LUGAR = (l) => (l === 'script' ? 'script' : l.startsWith('fondo') ? 'fondo' : /srcset/.test(l) ? 'srcset' : 'etiqueta')

function Mini({ url, grande }) {
  const [falla, setFalla] = useState(false)
  useEffect(() => { setFalla(false) }, [url])
  const cl = 'pi-mini' + (grande ? ' grande' : '')
  if (!RE_HTTP.test(url || '') || falla) return <span className={cl + ' sin'} title={falla ? 'No se pudo mostrar esta imagen' : 'Sin vista previa'}>{falla ? 'Sin vista' : '—'}</span>
  return <a className={cl} href={url} target="_blank" rel="noopener noreferrer" title="Abrir la imagen en otra pestaña"><img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFalla(true)} /></a>
}

export default function CambioMasivoImagenes({ aviso, pestanas }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')
  const [selPlantilla, setSelPlantilla] = useState('')
  const [selUrl, setSelUrl] = useState('')
  const [q, setQ] = useState('')
  const [edic, setEdic] = useState({}) // url actual → url nueva escrita (regla para todas las apariciones)
  const [edicUso, setEdicUso] = useState({}) // «plantilla\nposición» → url nueva de ESE uso suelto
  const [abiertas, setAbiertas] = useState(new Set()) // URL con la lista de usos desplegada
  const [res, setRes] = useState({}) // url → { estado, detalle } (validadas en esta sesión)
  const [validando, setValidando] = useState(new Set())
  const [confirmar, setConfirmar] = useState(null) // { filas: [{ url, nueva, excluidas:Set }], ... }
  const vivo = useRef(true)
  const [html, setHtml] = useState('')
  const [errorVista, setErrorVista] = useState('')
  const [esc, setEsc] = useState(0.5)
  const caja = useRef(null)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  const cargar = useCallback(() => api('GET', '/plantillas-imagenes/masivo').then((d) => { if (vivo.current) { setDatos(d); setError('') } }).catch((e) => { if (vivo.current) setError(e.message || 'No se pudo cargar.') }), [])
  useEffect(() => { cargar() }, [cargar])

  // vista previa de la plantilla elegida (la primera al entrar): así se ve qué trae
  useEffect(() => { if (datos && !selPlantilla && !selUrl && datos.plantillas.length) setSelPlantilla(datos.plantillas[0].nombre) }, [datos]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selPlantilla) { setHtml(''); return undefined }
    let ok = true
    setHtml(''); setErrorVista('')
    api('POST', '/plantillas-imagenes/' + encodeURIComponent(selPlantilla) + '/vista', {}).then((d) => { if (ok) setHtml(d.html) }).catch((e) => { if (ok) setErrorVista(e.message || 'No se pudo armar la vista previa.') })
    return () => { ok = false }
  }, [selPlantilla])
  useEffect(() => {
    const el = caja.current
    if (!el) return undefined
    const medir = () => { const w = el.clientWidth; if (w > 0) setEsc(w / 1280) }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [selPlantilla, !!datos])

  const plantillaPor = useMemo(() => new Map((datos ? datos.plantillas : []).map((p) => [p.nombre, p])), [datos])
  const estadoDe = (url) => (validando.has(url) ? 'validando' : res[url] ? res[url].estado : (datos && datos.urls.find((u) => u.url === url) || {}).estado || 'sin_validar')
  const detalleDe = (url) => (res[url] ? res[url].detalle : (datos && datos.urls.find((u) => u.url === url) || {}).detalle || '')

  // relación en ambos sentidos
  const usaDe = (nombre) => new Set((plantillaPor.get(nombre) || { urls: [] }).urls)
  const urlsDeSel = selPlantilla ? usaDe(selPlantilla) : null
  const plantillasDeSel = useMemo(() => { const u = selUrl && datos ? datos.urls.find((x) => x.url === selUrl) : null; return u ? new Set(u.plantillas.map((p) => p.nombre)) : null }, [selUrl, datos])

  const t = q.trim().toLowerCase()
  const urls = useMemo(() => (datos ? datos.urls : []).filter((u) => !t || (u.url + ' ' + u.plantillas.map((p) => p.nombre + ' ' + (p.categoria ? p.categoria.id : '')).join(' ')).toLowerCase().includes(t)), [datos, t])
  const plantillas = useMemo(() => (datos ? datos.plantillas : []).filter((p) => !t || (p.nombre + ' ' + (p.categoria ? p.categoria.id + ' ' + p.categoria.nombre : '')).toLowerCase().includes(t)), [datos, t])

  const elegirPlantilla = (n) => { setSelUrl(''); setSelPlantilla(selPlantilla === n ? '' : n) }
  const elegirUrl = (u) => { setSelPlantilla(''); setSelUrl(selUrl === u ? '' : u) }

  const validar = async (lista) => {
    const buenas = [...new Set(lista)].filter((u) => RE_HTTP.test(u))
    lista.filter((u) => !RE_HTTP.test(u)).forEach((u) => setRes((r) => ({ ...r, [u]: { estado: 'bloqueada', detalle: 'Debe empezar por http:// o https:// y no llevar espacios.' } })))
    if (!buenas.length) return {}
    setValidando((s) => new Set([...s, ...buenas]))
    const out = {}
    try {
      for (let k = 0; k < buenas.length; k += 40) {
        const d = await api('POST', '/plantillas-imagenes/masivo/validar', { urls: buenas.slice(k, k + 40) })
        Object.assign(out, d.resultados)
        if (vivo.current) setRes((r) => ({ ...r, ...d.resultados }))
      }
    } catch (e) { if (aviso) aviso(e.message || 'No se pudo validar.') } finally {
      if (vivo.current) setValidando((s) => { const n = new Set(s); buenas.forEach((u) => n.delete(u)); return n })
    }
    return out
  }

  const editadas = Object.entries(edic).filter(([u, n]) => n && n !== u)
  const claveUso = (plantilla, indice) => plantilla + '\n' + indice
  // usos sueltos con URL nueva: { plantilla, indice, lugar, contexto, antes, nueva, url (la actual de la fila) }
  const sueltas = useMemo(() => {
    const out = []
    for (const u of datos ? datos.urls : []) for (const p of u.plantillas) for (const x of p.usos || []) {
      const n = edicUso[claveUso(p.nombre, x.indice)]
      if (n && n !== u.url) out.push({ plantilla: p.nombre, indice: x.indice, lugar: x.lugar, contexto: x.contexto, antes: u.url, nueva: n })
    }
    return out
  }, [datos, edicUso])
  const nCambios = editadas.length + sueltas.length
  const hayMala = editadas.some(([, n]) => !RE_HTTP.test(n)) || sueltas.some((x) => !RE_HTTP.test(x.nueva))
  const alternarAbierta = (url) => setAbiertas((a) => { const n = new Set(a); if (n.has(url)) n.delete(url); else n.add(url); return n })
  const escribirUso = (plantilla, indice, v) => setEdicUso((x) => { const n = { ...x }; const k = claveUso(plantilla, indice); if (v) n[k] = v; else delete n[k]; return n })
  const nUsa = (u) => ((datos.urls.find((x) => x.url === u) || { plantillas: [] }).plantillas.length)

  // abre la confirmación para una fila (o para todas las editadas) y valida las URL nuevas
  const abrirConfirmacion = async (lista, usosSueltos = []) => {
    const filas = lista.map(([url, nueva]) => ({ url, nueva }))
    setConfirmar({ filas, sueltas: usosSueltos, excluidas: new Set(), forzar: false, aplicando: false, error: '', resultado: null })
    await validar([...filas.map((f) => f.nueva), ...usosSueltos.map((x) => x.nueva)])
  }
  const alternarExcluida = (nombre) => setConfirmar((c) => { const e = new Set(c.excluidas); if (e.has(nombre)) e.delete(nombre); else e.add(nombre); return { ...c, excluidas: e } })
  // lo que se va a cambiar, plantilla por plantilla y posición por posición (antes → después); el uso suelto manda sobre la regla de su URL
  const cambiosDe = (c) => {
    const porP = new Map()
    const poner = (nombre, indice, lugar, contexto, antes, despues) => { const l = porP.get(nombre) || new Map(); l.set(indice, { indice, lugar, contexto, antes, despues }); porP.set(nombre, l) }
    for (const f of c.filas) for (const p of (datos.urls.find((u) => u.url === f.url) || { plantillas: [] }).plantillas) for (const x of p.usos || []) poner(p.nombre, x.indice, x.lugar, x.contexto, f.url, f.nueva)
    for (const x of c.sueltas) poner(x.plantilla, x.indice, x.lugar, x.contexto, x.antes, x.nueva)
    return [...porP].map(([nombre, m]) => ({ nombre, cambios: [...m.values()].sort((a, b) => a.indice - b.indice) })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }

  const aplicar = async () => {
    setConfirmar((c) => ({ ...c, aplicando: true, error: '' }))
    try {
      const exc = confirmar.excluidas
      const reemplazos = confirmar.filas.map((f) => ({
        anterior: f.url, nueva: f.nueva,
        plantillas: datos.urls.find((u) => u.url === f.url).plantillas.filter((p) => !exc.has(p.nombre)).map((p) => ({ nombre: p.nombre, actualizado: plantillaPor.get(p.nombre).actualizado }))
      })).filter((r) => r.plantillas.length)
      const usos = confirmar.sueltas.filter((x) => !exc.has(x.plantilla)).map((x) => ({ plantilla: x.plantilla, actualizado: plantillaPor.get(x.plantilla).actualizado, indice: x.indice, url: x.nueva }))
      const d = await api('POST', '/plantillas-imagenes/masivo/aplicar', { reemplazos, ...(usos.length ? { usos } : {}), ...(confirmar.forzar ? { confirmarInvalida: true } : {}) })
      setConfirmar((c) => ({ ...c, aplicando: false, resultado: d }))
      setEdic((e) => { const n = { ...e }; confirmar.filas.forEach((f) => { delete n[f.url] }); return n })
      setEdicUso((e) => { const n = { ...e }; confirmar.sueltas.forEach((x) => { delete n[claveUso(x.plantilla, x.indice)] }); return n })
      setRes({})
      cargar()
      if (aviso) aviso(d.cambiadas.length + (d.cambiadas.length === 1 ? ' plantilla actualizada' : ' plantillas actualizadas') + (d.saltadas.length ? ', ' + d.saltadas.length + ' omitidas' : ''))
    } catch (e) { setConfirmar((c) => ({ ...c, aplicando: false, error: e.message || 'No se pudo aplicar.' })) }
  }

  // ---- confirmación
  const conf = confirmar
  const estadoNuevas = conf ? [...conf.filas.map((f) => estadoDe(f.nueva)), ...conf.sueltas.map((x) => estadoDe(x.nueva))] : []
  const porPlantillaConf = conf ? cambiosDe(conf) : []
  const nuevasConf = conf ? [...new Set([...conf.filas.map((f) => f.nueva), ...conf.sueltas.map((x) => x.nueva)])] : []
  const hayBloqueada = estadoNuevas.includes('bloqueada')
  const hayInvalida = estadoNuevas.some((e) => ['no_responde', 'no_es_imagen'].includes(e))
  const cargandoVal = estadoNuevas.includes('validando') || estadoNuevas.includes('sin_validar')
  const totalAplicar = conf ? porPlantillaConf.filter((x) => !conf.excluidas.has(x.nombre)).length : 0
  const totalImagenes = conf ? porPlantillaConf.filter((x) => !conf.excluidas.has(x.nombre)).reduce((n, x) => n + x.cambios.length, 0) : 0

  return (
    <div className="wrapx fade pi pi-mas">
      <div className="pi-mas-cab">
        <Titulo icono="codigo">
          <h1>Plantillas con imágenes</h1>
          <p className="lead">Elija una imagen, escriba su URL nueva y aplíquela a todas las plantillas que la usan, o cambie cada uso por su cuenta.</p>
        </Titulo>
        <div className="pi-mas-tabs">{pestanas}</div>
      </div>

      <div className="card pi-mas-barra">
        <label className="pg-busca pi-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input aria-label="Buscar" placeholder="Buscar una URL o una plantilla" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="help">{datos ? datos.urls.length + ' imágenes distintas · ' + datos.plantillas.length + ' plantillas' : ''}</span>
        <span className="sp" />
        {nCambios > 0 && <span className="pi-sin-aplicar">{nCambios} {nCambios === 1 ? 'cambio sin aplicar' : 'cambios sin aplicar'}</span>}
        <button type="button" className="btn sm" disabled={!nCambios || hayMala} onClick={() => abrirConfirmacion(editadas, sueltas)}>
          {nCambios > 1 ? 'Aplicar ' + nCambios + ' cambios a la vez' : 'Aplicar cambio'}
        </button>
        {nCambios > 0 && <button type="button" className="btn sec sm" onClick={() => { setEdic({}); setEdicUso({}) }}>Descartar</button>}
      </div>

      {error && <div className="msg bad" role="alert">{error}</div>}
      {!datos && !error && <p className="help">Cargando imágenes…</p>}
      {datos && !datos.urls.length && <div className="card pg-vacio"><b>Ninguna plantilla subida trae imágenes todavía.</b></div>}

      {datos && datos.urls.length > 0 && (
        <div className="pi-mas-cuerpo">
          <section className="pi-mas-imgs" aria-label="Imágenes">
            {urls.map((u) => {
              const nueva = edic[u.url]
              const cambiada = nueva !== undefined && nueva !== '' && nueva !== u.url
              const e = estadoDe(u.url)
              const [cl, tx] = ESTADO[e] || ESTADO.sin_validar
              const malaNueva = cambiada && !RE_HTTP.test(nueva)
              const rel = urlsDeSel && urlsDeSel.has(u.url)
              const sueltasU = sueltas.filter((x) => x.antes === u.url)
              const nUsos = u.plantillas.reduce((n, p) => n + ((p.usos && p.usos.length) || p.veces || 0), 0)
              const abierta = abiertas.has(u.url)
              return (
                <div key={u.url} className={'card pi-fila-img' + (selUrl === u.url ? ' on' : '') + (rel ? ' rel' : '') + (cambiada || sueltasU.length ? ' cambiada' : '')} onClick={() => elegirUrl(u.url)}>
                  <div className="pi-foto">
                    <Mini url={u.url} grande />
                    <span className={'pill pi-badge ' + cl} title={detalleDe(u.url)}>{tx}{detalleDe(u.url) && e === 'valida' ? ' · ' + detalleDe(u.url) : ''}</span>
                    <span className="pi-badge uso">{u.plantillas.length} {u.plantillas.length === 1 ? 'plantilla' : 'plantillas'}</span>
                  </div>
                  <div className="pi-datos" onClick={(ev) => ev.stopPropagation()}>
                    <div className="pi-fila">
                      <code className="pi-url-act" title={u.url}>{u.url}</code>
                      <button type="button" className="btn sec sm" disabled={validando.has(u.url)} onClick={() => validar([u.url])}>Validar</button>
                    </div>
                    {detalleDe(u.url) && e !== 'valida' && <small className="pi-det">{detalleDe(u.url)}</small>}
                    <input className={'pi-url' + (malaNueva ? ' err' : '')} aria-label="URL nueva" placeholder={nUsos > 1 ? 'URL nueva para todos los usos (http:// o https://)' : 'URL nueva (http:// o https://)'} value={nueva || ''} spellCheck={false} maxLength={2000} onChange={(ev) => { const v = ev.target.value.trim(); setEdic((x) => { const n = { ...x }; if (v) n[u.url] = v; else delete n[u.url]; return n }) }} />
                    {malaNueva && <small className="pi-err">Debe empezar por http:// o https:// y no llevar espacios ni comillas.</small>}
                    <div className="pi-usa">
                      <span className="pi-usa-t">Plantillas que usan esta imagen</span>
                      <ul>
                        {u.plantillas.slice(0, 4).map((p) => (
                          <li key={p.nombre} className={selPlantilla === p.nombre ? 'on' : ''} title="Ver esta plantilla" onClick={() => elegirPlantilla(p.nombre)}>
                            <b>{verNombre(p.nombre)}</b>
                            <span>{p.categoria ? p.categoria.id + (p.categoria.nombre ? ' · ' + p.categoria.nombre : '') : 'Sin categoría'}</span>
                            <i>{[...new Set(p.lugares.map(LUGAR))].map((x) => DONDE[x]).join(', ')}{p.veces > 1 ? ' (' + p.veces + ' veces)' : ''}</i>
                          </li>
                        ))}
                      </ul>
                      {u.plantillas.length > 4 && <small>y {u.plantillas.length - 4} más</small>}
                    </div>
                    {nUsos > 1 && (
                      <button type="button" className="pi-lnk pi-ver-usos" aria-expanded={abierta} onClick={() => alternarAbierta(u.url)}>
                        {abierta ? 'Ocultar los ' + nUsos + ' usos' : 'Ver los ' + nUsos + ' usos y cambiarlos uno por uno'}{sueltasU.length > 0 && !abierta ? ' (' + sueltasU.length + ' con cambio)' : ''}
                      </button>
                    )}
                    {abierta && (
                      <ul className="pi-usos">
                        {u.plantillas.flatMap((p) => (p.usos || []).map((x) => {
                          const k = claveUso(p.nombre, x.indice)
                          const v = edicUso[k]
                          const mal = v && v !== u.url && !RE_HTTP.test(v)
                          const efectiva = v && v !== u.url ? v : (cambiada ? nueva : '')
                          return (
                            <li key={k} className={v ? 'cambiada' : ''}>
                              <Mini url={efectiva || u.url} />
                              <div>
                                <div className="pi-uso-t"><b>{verNombre(p.nombre)}</b> <span>imagen {x.indice + 1} · {DONDE[LUGAR(x.lugar)]}</span></div>
                                {x.contexto && <small className="pi-ctx" title={x.contexto}>{x.contexto}</small>}
                                <input className={'pi-url' + (mal ? ' err' : '')} aria-label={'URL nueva de la imagen ' + (x.indice + 1) + ' de ' + p.nombre} placeholder={cambiada ? 'Igual que arriba; escriba otra para este uso' : 'URL nueva solo para este uso'} value={v || ''} spellCheck={false} maxLength={2000} onChange={(ev) => escribirUso(p.nombre, x.indice, ev.target.value.trim())} />
                                {mal && <small className="pi-err">Debe empezar por http:// o https:// y no llevar espacios ni comillas.</small>}
                              </div>
                            </li>
                          )
                        }))}
                      </ul>
                    )}
                    {(cambiada || sueltasU.length > 0) && (
                      <div className="pi-fila"><button type="button" className="btn pi-aplicar" disabled={malaNueva || sueltasU.some((x) => !RE_HTTP.test(x.nueva))} onClick={() => abrirConfirmacion(cambiada ? [[u.url, nueva]] : [], sueltasU)}>
                        {cambiada ? 'Aplicar a ' + nUsa(u.url) + (nUsa(u.url) === 1 ? ' plantilla' : ' plantillas') + (sueltasU.length ? ' + ' + sueltasU.length + (sueltasU.length === 1 ? ' uso suelto' : ' usos sueltos') : '') : 'Aplicar ' + sueltasU.length + (sueltasU.length === 1 ? ' cambio de esta imagen' : ' cambios de esta imagen')}
                      </button></div>
                    )}
                  </div>
                </div>
              )
            })}
            {!urls.length && <p className="help">Ninguna imagen coincide con la búsqueda.</p>}
          </section>

          <div className="pi-mas-der">
          <aside className="card pi-mas-lado">
            <h4>Plantillas ({plantillas.length})</h4>
            <p className="help">{selUrl ? 'Resaltadas: las que usan la imagen elegida.' : 'Elija una plantilla para resaltar sus imágenes.'}</p>
            <div className="pi-mas-lista">
              {plantillas.map((p) => (
                <button key={p.nombre} type="button" className={(selPlantilla === p.nombre ? 'on ' : '') + (plantillasDeSel && plantillasDeSel.has(p.nombre) ? 'rel' : '')} onClick={() => elegirPlantilla(p.nombre)}>
                  <b>{verNombre(p.nombre)}</b>
                  <small>{p.categoria ? p.categoria.id + ' · ' + (p.categoria.nombre || '') : 'Sin categoría'} · {p.urls.length} {p.urls.length === 1 ? 'imagen' : 'imágenes'}</small>
                </button>
              ))}
              {!plantillas.length && <p className="help">Ninguna plantilla coincide.</p>}
            </div>
          </aside>
            {selPlantilla && plantillaPor.get(selPlantilla) && (
              <div className="card pi-mas-prev">
                <div className="pi-mas-prev-cab">
                  <div>
                    <small>Vista previa de la plantilla</small>
                    <b>{verNombre(selPlantilla)}</b>
                    <span>{plantillaPor.get(selPlantilla).categoria ? plantillaPor.get(selPlantilla).categoria.id + ' · ' + (plantillaPor.get(selPlantilla).categoria.nombre || '') : 'Sin categoría'} · {plantillaPor.get(selPlantilla).urls.length} {plantillaPor.get(selPlantilla).urls.length === 1 ? 'imagen' : 'imágenes'} (resaltadas abajo)</span>
                  </div>
                  <button type="button" className="btn sec sm" onClick={() => setSelPlantilla('')}>Ocultar vista previa</button>
                </div>
                {errorVista && <div className="msg bad" role="alert">{errorVista}</div>}
                <div className="pl2-caja" ref={caja}>
                  {!html && !errorVista && <p className="help" style={{ padding: 18 }}>Cargando…</p>}
                  {html && <iframe sandbox="allow-scripts" title={'Plantilla ' + verNombre(selPlantilla)} srcDoc={html} style={marcoPlantilla(esc)} />}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {conf && (
        <div className="pi-modal" role="dialog" aria-modal="true" aria-label="Confirmar cambio masivo">
          <div className="pi-modal-caja">
            {conf.resultado ? (
              <>
                <h3>Listo</h3>
                <p>{conf.resultado.cambiadas.length} {conf.resultado.cambiadas.length === 1 ? 'plantilla actualizada' : 'plantillas actualizadas'}.</p>
                {conf.resultado.saltadas.length > 0 && (
                  <div className="msg warn">
                    <b>Omitidas ({conf.resultado.saltadas.length}):</b>
                    <ul>{conf.resultado.saltadas.map((s) => <li key={s.nombre}>{verNombre(s.nombre)}: {s.motivo === 'modificada' ? 'otra persona la modificó mientras tanto; no se tocó' : s.motivo === 'sin_cambios' ? 'ya no tenía esa imagen' : 'ya no existe'}</li>)}</ul>
                  </div>
                )}
                <div className="pi-modal-pie"><button type="button" className="btn" onClick={() => setConfirmar(null)}>Cerrar</button></div>
              </>
            ) : (
              <>
                <h3>Confirmar el cambio</h3>
                <p className="help">Se cambia la dirección de {totalImagenes} {totalImagenes === 1 ? 'imagen' : 'imágenes'} en {totalAplicar} {totalAplicar === 1 ? 'plantilla' : 'plantillas'}. Quite la marca a las plantillas que no quiera tocar; el resto de cada plantilla queda igual.</p>
                <div className="pi-modal-cuerpo">
                  <div className="pi-conf-fila">
                    {nuevasConf.map((n) => {
                      const en = estadoDe(n)
                      const [cl2, tx2] = ESTADO[en] || ESTADO.sin_validar
                      const antes = [...new Set(porPlantillaConf.flatMap((x) => x.cambios.filter((c) => c.despues === n).map((c) => c.antes)))]
                      return (
                        <div key={n} className="pi-conf-par">
                          <div><small>Actual</small><Mini url={antes[0]} grande /></div>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                          <div><small>Nueva</small><Mini url={n} grande /></div>
                          <div className="pi-conf-urls"><code title={antes.join(' · ')}>{antes.length > 1 ? antes.length + ' URL distintas' : antes[0]}</code><code title={n}>{n}</code><span><span className={'pill ' + cl2}>{tx2}</span> {detalleDe(n) && <small>{detalleDe(n)}</small>}</span></div>
                        </div>
                      )
                    })}
                  </div>
                  {porPlantillaConf.map((x) => (
                    <div key={x.nombre} className={'pi-conf-fila' + (conf.excluidas.has(x.nombre) ? ' excl' : '')}>
                      <label className="pi-conf-pt"><input type="checkbox" checked={!conf.excluidas.has(x.nombre)} onChange={() => alternarExcluida(x.nombre)} /> <b>{verNombre(x.nombre)}</b> <small>{(plantillaPor.get(x.nombre) || {}).categoria ? plantillaPor.get(x.nombre).categoria.id + ' · ' : ''}{x.cambios.length} {x.cambios.length === 1 ? 'imagen' : 'imágenes'}</small></label>
                      <ul className="pi-conf-pl">
                        {x.cambios.map((c) => (
                          <li key={c.indice}><span className="pl2-n">{c.indice + 1}</span><span className="pi-conf-c"><i>{DONDE[LUGAR(c.lugar)]}</i><code title={c.antes}>{c.antes}</code><code title={c.despues}>→ {c.despues}</code></span></li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                {hayBloqueada && <div className="msg bad">Una URL nueva no está permitida (interna o con formato no válido). No se puede aplicar.</div>}
                {hayInvalida && !hayBloqueada && (
                  <label className="msg warn pi-forzar"><input type="checkbox" checked={conf.forzar} onChange={(e) => setConfirmar((c) => ({ ...c, forzar: e.target.checked }))} /> La URL nueva no responde o no es una imagen. Quiero aplicarla de todos modos.</label>
                )}
                {conf.error && <div className="msg bad" role="alert">{conf.error}</div>}
                <div className="pi-modal-pie">
                  <button type="button" className="btn sec" disabled={conf.aplicando} onClick={() => setConfirmar(null)}>Cancelar</button>
                  <button type="button" className="btn" disabled={conf.aplicando || cargandoVal || hayBloqueada || (hayInvalida && !conf.forzar) || totalAplicar === 0} onClick={aplicar}>
                    {conf.aplicando ? 'Aplicando…' : cargandoVal ? 'Validando la URL nueva…' : 'Aplicar ' + totalImagenes + (totalImagenes === 1 ? ' cambio' : ' cambios') + ' en ' + totalAplicar + (totalAplicar === 1 ? ' plantilla' : ' plantillas')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
