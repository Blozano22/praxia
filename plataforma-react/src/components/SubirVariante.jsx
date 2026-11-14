import { useEffect, useRef, useState } from 'react'
import { marcoPlantilla } from '../lib/vista.js'
import { api } from '../lib/api.js'
import { ListaCategorias, kb, MAX_BYTES } from './CategoriasPlantillas.jsx'
import { verNombre } from '../lib/nombres.js'
import { NOMBRE_FORMACION, conFormacion } from '../lib/formaciones.js'

const MAX_ARCHIVOS = 20

// Nombre que tendrá el archivo que ocupa el lugar «k» entre los válidos: el que anuncia la revisión del primero + su posición
// (g-09-v03, g-09-v04…). Los que fallan no consumen número. El servidor manda la verdad al subir; esto es solo el anuncio.
function nombreEn(primero, k) {
  if (!primero) return null
  const m = /^(.*-v)(\d+)$/i.exec(primero)
  if (!m) return k === 0 ? primero : null
  return m[1] + String(Number(m[2]) + k).padStart(m[2].length, '0')
}

// Ventana «Subir variante»: una o varias plantillas HTML (hasta 20) a la MISMA categoría. El nombre de cada una lo genera el servidor
// (ID de la categoría + orden: g-08-v01…). Se revisan una por una, sin guardarlas, y se suben UNA TRAS OTRA en el orden de la lista.
export default function SubirVariante({ cats, formacion = '', categoriaInicial = '', onCerrar, onSubida }) {
  // Con una formación elegida en la galería, solo se ofrecen las categorías que la sirven (con su prioridad P / C); «Ver todas» quita el filtro.
  const [soloFormacion, setSoloFormacion] = useState(!!formacion)
  const prioridad = (c) => { const f = ((cats.formaciones || {})[c.id] || []).find((x) => x.formacion === formacion); return f ? f.prioridad : '' }
  const sirve = (c) => !!prioridad(c)
  const visibles = soloFormacion && formacion ? cats.categorias.filter(sirve) : cats.categorias
  const [categoria, setCategoria] = useState(() => {
    const ok = !formacion || sirve(cats.categorias.find((c) => c.id === categoriaInicial) || { id: '' })
    return ok ? categoriaInicial : ''
  })

  const [items, setItems] = useState([]) // archivos en el orden en que se eligieron: { id, nombre, bytes, html, errorLocal }
  const [revs, setRevs] = useState({}) // revisión de cada uno: { fase: 'revisando'|'ok'|'aviso'|'error', conEjemplo, html, nombre, mensaje }
  const [envio, setEnvio] = useState({}) // estado de la subida de cada uno: { fase: 'subiendo'|'subido'|'no_subido', real, mensaje }
  const [fase, setFase] = useState('edicion') // edicion | subiendo | terminado
  const [avance, setAvance] = useState({ n: 0, total: 0 })
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState('') // id del archivo cuya vista previa está abierta
  const [arrastrando, setArrastrando] = useState(false)
  const [esc, setEsc] = useState(0.4)
  const entrada = useRef(null)
  const marco = useRef(null)
  const cache = useRef(new Map()) // «categoría|id» → revisión (para no repetir pedidos al agregar archivos)
  const ocupado = fase === 'subiendo'

  // Revisión en el servidor, una por archivo y en orden; si cambia la lista o la categoría, la respuesta vieja se ignora.
  useEffect(() => {
    let vigente = true
    const lista = items.filter((i) => !i.errorLocal)
    setRevs(Object.fromEntries(lista.map((i) => [i.id, cache.current.get(categoria + '|' + i.id) || { fase: 'revisando' }])))
    ;(async () => {
      for (const i of lista) {
        const k = categoria + '|' + i.id
        if (cache.current.has(k)) continue
        let res
        try {
          const r = await api('POST', '/plantillas/subidas/previa', { html: i.html, ...(categoria ? { categoria } : {}) })
          res = { fase: 'ok', conEjemplo: !!r.conEjemplo, html: r.html || '', nombre: r.nombre || null }
        } catch (e) { res = { fase: 'error', mensaje: e.message || 'No se pudo revisar el archivo.' } }
        if (!vigente) return
        cache.current.set(k, res)
        setRevs((p) => ({ ...p, [i.id]: res }))
      }
    })()
    return () => { vigente = false }
  }, [items, categoria])

  useEffect(() => {
    const el = marco.current
    if (!el) return undefined
    const medir = () => { const w = el.clientWidth; if (w > 0) setEsc(w / 1280) }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [abierto])

  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape' && !ocupado) onCerrar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ocupado, onCerrar])

  // Archivos elegidos: máximo 20 (se toman los primeros) y 1,5 MB cada uno (el que pasa queda marcado y no se envía).
  const elegir = async (archivos) => {
    const todos = Array.from(archivos || [])
    if (!todos.length || ocupado) return
    const tomados = todos.slice(0, MAX_ARCHIVOS)
    setAviso(todos.length > MAX_ARCHIVOS ? 'Máximo ' + MAX_ARCHIVOS + ' archivos por cargue: se tomaron los ' + MAX_ARCHIVOS + ' primeros.' : '')
    setError(''); setEnvio({}); setFase('edicion'); setAbierto('')
    const marca = Date.now()
    const leidos = []
    for (let n = 0; n < tomados.length; n++) {
      const f = tomados[n]
      const base = { id: marca + '-' + n, nombre: f.name, bytes: f.size, html: '' }
      if (f.size > MAX_BYTES) { leidos.push({ ...base, errorLocal: 'Pesa ' + kb(f.size) + ' y el máximo es 1,5 MB.' }); continue }
      try { leidos.push({ ...base, html: await f.text() }) } catch { leidos.push({ ...base, errorLocal: 'No se pudo leer el archivo.' }) }
    }
    setItems(leidos)
  }

  // Quitar un archivo de la lista antes de subir (se elige mal, o ya no se quiere): los demás se renumeran solos.
  const quitar = (id) => {
    if (ocupado || fase !== 'edicion') return
    setItems((p) => p.filter((i) => i.id !== id))
    setAbierto((p) => (p === id ? '' : p)); setAviso('')
  }

  const validos = items.filter((i) => !i.errorLocal && revs[i.id] && revs[i.id].fase === 'ok')
  const revisando = items.some((i) => !i.errorLocal && (!revs[i.id] || revs[i.id].fase === 'revisando'))
  const primero = validos.length ? revs[validos[0].id].nombre : null
  const anunciado = (i) => { const k = validos.indexOf(i); return k < 0 ? null : nombreEn(primero, k) }

  // Sube UNO TRAS OTRO, en el orden de la lista y esperando cada respuesta (así los números salen en orden). Una que falla no detiene las demás.
  const subirTodo = async (e) => {
    e.preventDefault()
    if (!categoria || !validos.length || revisando || ocupado || fase === 'terminado') return
    setFase('subiendo'); setError(''); setAbierto('')
    const lista = [...validos]
    let hechos = 0
    for (let n = 0; n < lista.length; n++) {
      const i = lista[n]
      setAvance({ n: n + 1, total: lista.length })
      setEnvio((p) => ({ ...p, [i.id]: { fase: 'subiendo' } }))
      try {
        const r = await api('POST', '/plantillas/subidas', { html: i.html, categoria })
        hechos++
        setEnvio((p) => ({ ...p, [i.id]: { fase: 'subido', real: (r && r.nombre) || anunciado(i) } }))
      } catch (err) {
        setEnvio((p) => ({ ...p, [i.id]: { fase: 'no_subido', mensaje: err.message || 'No se pudo subir la plantilla.' } }))
      }
    }
    setFase('terminado')
    const reales = lista.map((i) => i.id)
    await onSubida({ ids: reales, subidos: hechos, errores: lista.length - hechos })
    if (lista.length === 1 && hechos === 1) onCerrar() // un solo archivo, como siempre: al subirlo se cierra
  }

  const subidos = items.filter((i) => envio[i.id] && envio[i.id].fase === 'subido')
  const fallidos = items.filter((i) => envio[i.id] && envio[i.id].fase === 'no_subido')
  const conErrores = items.filter((i) => i.errorLocal || (revs[i.id] && revs[i.id].fase === 'error')).length
  const etiquetaSubir = validos.length > 1 ? 'Subir ' + validos.length + ' archivos' : 'Subir variante'

  const estadoDe = (i) => {
    const en = envio[i.id]
    if (en) return en.fase === 'subiendo' ? { k: 'subiendo', t: 'Subiendo…' } : en.fase === 'subido' ? { k: 'subido', t: 'Subido' } : { k: 'error', t: 'No subido', m: en.mensaje }
    if (i.errorLocal) return { k: 'error', t: 'Error', m: i.errorLocal }
    const rv = revs[i.id]
    if (!rv || rv.fase === 'revisando') return { k: 'revisando', t: 'Revisando…' }
    if (rv.fase === 'error') return { k: 'error', t: 'Error', m: rv.mensaje }
    return { k: 'listo', t: 'Listo' }
  }

  return (
    <div className="sv-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onCerrar() }}>
      <form className="sv-ventana" role="dialog" aria-modal="true" aria-label="Subir variante" onSubmit={subirTodo}>
        <header className="sv-cab">
          <span className="sv-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg></span>
          <h2>Subir variante</h2>
          <button type="button" className="sv-x" aria-label="Cerrar" onClick={onCerrar} disabled={ocupado} title={ocupado ? 'Espere a que termine la subida' : 'Cerrar'}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </header>
        <div className="sv-cuerpo">
          {error && <div className="msg bad" role="alert">{error}</div>}
          {aviso && <div className="msg warn" role="status">{aviso}</div>}
          <div className="sv-campo">
            <span className="sv-lbl">Categoría</span>
            <ListaCategorias valor={categoria} categorias={visibles} ocupado={ocupado || fase === 'terminado'} onChange={setCategoria} etiqueta="Categoría" vacio="Elegir categoría…" insignia={soloFormacion && formacion ? prioridad : undefined} />
            {soloFormacion && formacion && (
              <p className="sv-filtro">Solo categorías de {NOMBRE_FORMACION[formacion]}{visibles.length === 0 ? ': ninguna todavía' : ''}. <button type="button" className="sv-enlace" onClick={() => setSoloFormacion(false)} disabled={ocupado}>Ver todas</button></p>
            )}
            <small>{categoria ? 'El nombre se genera solo: ' + categoria.toLowerCase() + '-v01, -v02… según el orden de subida. Todos los archivos van a esta categoría.' : 'El nombre se genera solo con el ID de la categoría: G-08-V01…'}</small>
          </div>

          <input ref={entrada} type="file" multiple accept=".html,.htm,text/html" hidden onChange={(e) => { const f = Array.from(e.target.files) /* se copia antes de vaciar el campo */; e.target.value = ''; elegir(f) }} />
          <button type="button" className={'sv-zona' + (arrastrando ? ' sobre' : '') + (items.length ? ' lleno' : '')} disabled={ocupado} onClick={() => entrada.current.click()}
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }} onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files) }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
            {items.length
              ? <><b>{items.length === 1 ? items[0].nombre : items.length + ' archivos elegidos'}</b><span>pulse para elegir otros</span></>
              : <><b>Elegir archivos HTML</b><span>o arrástrelos aquí · hasta {MAX_ARCHIVOS} archivos de 1,5 MB</span></>}
          </button>

          {items.length > 0 && (
            <ul className="sv-lista" aria-label="Archivos elegidos, en el orden en que se subirán">
              {items.map((i, n) => {
                const st = estadoDe(i)
                const rv = revs[i.id]
                const nombre = envio[i.id] && envio[i.id].real ? envio[i.id].real : anunciado(i)
                const puedeVer = rv && rv.fase === 'ok' && !i.errorLocal && !envio[i.id]
                return (
                  <li key={i.id} className={'sv-fila ' + st.k}>
                    <span className="sv-n">{n + 1}</span>
                    <div className="sv-fila-tx">
                      <b title={i.nombre}>{i.nombre}</b>
                      <small>{kb(i.bytes)}{nombre ? (envio[i.id] && envio[i.id].fase === 'subido' ? ' · guardado como ' : ' · se guardará como ') : ''}{nombre && <strong>{verNombre(nombre)}</strong>}</small>
                      {st.m && <span className="sv-fila-err">{st.m}</span>}
                    </div>
                    <span className={'sv-est ' + st.k}>{st.k === 'revisando' || st.k === 'subiendo' ? <span className="sv-giro" aria-hidden="true" /> : null}{st.t}</span>
                    {puedeVer && <button type="button" className="sv-ver" aria-expanded={abierto === i.id} onClick={() => setAbierto(abierto === i.id ? '' : i.id)}>{abierto === i.id ? 'Ocultar' : 'Ver'}</button>}
                    {fase === 'edicion' && <button type="button" className="sv-quitar" aria-label={'Quitar ' + i.nombre + ' de la lista'} title="Quitar de la lista" onClick={() => quitar(i.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg><span>Quitar</span></button>}
                    {abierto === i.id && puedeVer && (
                      <div className="sv-prev">
                        <p className={'sv-nota' + (rv.conEjemplo ? '' : ' aviso')}>{rv.conEjemplo ? 'Se muestra con el contenido de ejemplo que trae el archivo.' : 'No trae contenido de ejemplo: se verá vacía en la galería.'}</p>
                        <div className="sv-marco" ref={marco}>
                          <iframe sandbox="allow-scripts" title={'Vista previa de ' + i.nombre} srcDoc={conFormacion(rv.html, formacion)} style={marcoPlantilla(esc)} />
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {ocupado && <p className="sv-revisando" role="status"><span className="sv-giro" aria-hidden="true" />Subiendo {avance.n} de {avance.total}…</p>}
          {fase === 'terminado' && (
            <div className={'sv-resumen' + (fallidos.length + conErrores ? ' mal' : '')} role="status">
              <b>{subidos.length} {subidos.length === 1 ? 'subido' : 'subidos'}{fallidos.length + conErrores ? ', ' + (fallidos.length + conErrores) + ' con error' : ''}</b>
              {subidos.length > 0 && <span>{subidos.map((i) => verNombre(envio[i.id].real)).join(' · ')}</span>}
            </div>
          )}
          {fase === 'edicion' && items.length > 0 && !ocupado && conErrores > 0 && <p className="sv-filtro" style={{ color: '#8c2620' }}>{conErrores} {conErrores === 1 ? 'archivo tiene un error y no se enviará' : 'archivos tienen un error y no se enviarán'}.</p>}

          <details className="sv-reglas">
            <summary>Reglas del archivo</summary>
            <p>Página HTML completa con <b>una sola</b> marca <code>{'{{TITULO}}'}</code> y <b>una sola</b> <code>{'/*CONTENIDO*/'}</code>: ahí pone n8n el título y el contenido. Hasta 1,5 MB por archivo y 20 por cargue. Si usa <code>{'/*CSS*/'}</code> o <code>{'/*LIB*/'}</code>, el sistema incrusta los estilos y el código comunes, igual que en las demás plantillas.</p>
          </details>
        </div>
        <footer className="sv-pie">
          {fase === 'terminado'
            ? <button type="button" className="btn" onClick={onCerrar}>Cerrar</button>
            : <>
              <button type="button" className="btn sec" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
              <button type="submit" className="btn" disabled={ocupado || !categoria || !validos.length || revisando}>{ocupado ? 'Subiendo ' + avance.n + ' de ' + avance.total + '…' : etiquetaSubir}</button>
            </>}
        </footer>
      </form>
    </div>
  )
}
