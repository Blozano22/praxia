import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, RUTA_API } from '../lib/api.js'
import './categorias.css'

// Categorías de las plantillas publicadas (las que n8n descarga): cada categoría es un tipo de recurso del catálogo (ID + nombre) y reúne
// las variantes que n8n puede elegir. Cualquiera que vea las plantillas la consulta; quien las revisa puede crear categorías, asignar
// plantillas y SUBIR plantillas nuevas (HTML) sin esperar a un despliegue.
const RE_ID = /^[A-Z]{1,4}-[0-9]{2,3}$/
const RE_NOMBRE = /^[a-z0-9-]{1,80}$/
const MAX_BYTES = 1536 * 1024
const urlPlantilla = (n) => RUTA_API.replace(/\/api$/, '') + '/plantillas-html/' + n + '.html'
const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.html?$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
const kb = (b) => (b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1024 / 1024).toFixed(1) + ' MB')

// n8n deduce la variante del nombre del archivo: «lineatiempo» es la 1, «lineatiempo-2» la 2… Se propone el siguiente nombre de la categoría.
function sugerirNombre(variantes) {
  if (!variantes.length) return ''
  const base = variantes[0].replace(/-\d+$/, '')
  const nums = variantes.filter((n) => n === base || new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d+$').test(n)).map((n) => (n === base ? 1 : Number(n.slice(base.length + 1))))
  return base + '-' + (Math.max(1, ...nums) + 1)
}

function Variante({ nombre, categorias, actual, puedeCambiar, ocupado, onAsignar, subida, onReemplazar, onEliminar, confirmando, setConfirmando }) {
  const archivo = useRef(null)
  return (
    <li className={'cat-var' + (subida && puedeCambiar ? ' con-sub' : '')}>
      <span className="cat-var-n">{nombre}{subida && <em className="cat-sub" title={'Subida por ' + (subida.por || 'alguien')}>subida</em>}</span>
      <a href={urlPlantilla(nombre)} target="_blank" rel="noopener noreferrer" className="cat-var-ver">Ver ↗</a>
      {puedeCambiar && (
        <select aria-label={'Categoría de ' + nombre} value={actual || ''} disabled={ocupado} onChange={(e) => onAsignar(nombre, e.target.value || null)}>
          <option value="">Sin categoría</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.nombre}</option>)}
        </select>
      )}
      {puedeCambiar && subida && (
        <span className="cat-var-sub">
          <input ref={archivo} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onReemplazar(nombre, f) }} />
          <button type="button" className="btn sec sm" disabled={ocupado} onClick={() => archivo.current.click()}>Reemplazar archivo</button>
          {confirmando === nombre
            ? <><button type="button" className="btn danger sm" disabled={ocupado} onClick={() => onEliminar(nombre)}>Sí, eliminar</button><button type="button" className="btn sec sm" onClick={() => setConfirmando('')}>No</button></>
            : <button type="button" className="btn danger sm" onClick={() => setConfirmando(nombre)}>Eliminar</button>}
        </span>
      )}
    </li>
  )
}

export default function CategoriasPlantillas({ puedeCambiar = false, aviso }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [nueva, setNueva] = useState(null) // { id, nombre } mientras se crea una categoría
  const [edit, setEdit] = useState(null) // { id, nombre } mientras se renombra una
  const [borrar, setBorrar] = useState('') // id de categoría con la confirmación a la vista
  const [borrarSub, setBorrarSub] = useState('') // nombre de plantilla subida con la confirmación a la vista
  const [subida, setSubida] = useState(null) // { categoria, nombre, archivo, bytes, html } mientras se sube una plantilla
  const archivoNuevo = useRef(null)

  const cargar = useCallback(async () => {
    try { setD(await api('GET', '/plantillas/categorias')); setError('') } catch (e) { setError(e.message || 'No se pudieron cargar las categorías.') }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const hacer = async (fn, ok) => {
    setOcupado(true); setError('')
    try { await fn(); await cargar(); if (ok && aviso) aviso(ok) } catch (e) { setError(e.message || 'No se pudo guardar.') }
    setOcupado(false)
  }
  const asignar = (plantilla, categoria) => hacer(() => api('PUT', '/plantillas/asignacion/' + encodeURIComponent(plantilla), { categoria }))
  const crear = () => hacer(async () => { await api('POST', '/plantillas/categorias', { id: nueva.id.trim().toUpperCase(), nombre: nueva.nombre.trim() }); setNueva(null) }, 'Categoría creada')
  const renombrar = () => hacer(async () => { await api('PUT', '/plantillas/categorias/' + edit.id, { nombre: edit.nombre.trim() }); setEdit(null) }, 'Nombre guardado')
  const quitar = (id) => hacer(async () => { await api('DELETE', '/plantillas/categorias/' + id); setBorrar('') }, 'Categoría eliminada')

  const porCategoria = useMemo(() => {
    if (!d) return {}
    const m = {}
    d.plantillas.forEach((n) => { const c = d.asignaciones[n]; if (c) (m[c] = m[c] || []).push(n) })
    return m
  }, [d])
  const sin = d ? d.plantillas.filter((n) => !d.asignaciones[n]) : []

  // ---- subir una plantilla (HTML)
  const leerArchivo = async (f) => {
    if (!f) return null
    if (f.size > MAX_BYTES) { setError('El archivo pesa ' + kb(f.size) + ' y el máximo es 1,5 MB.'); return null }
    try { return await f.text() } catch { setError('No se pudo leer el archivo.'); return null }
  }
  const abrirSubida = (categoria = '') => { setError(''); setSubida({ categoria, nombre: sugerirNombre(porCategoria[categoria] || []), archivo: '', bytes: 0, html: '' }) }
  const elegirCategoria = (categoria) => setSubida((s) => ({ ...s, categoria, nombre: s.nombreEditado ? s.nombre : sugerirNombre(porCategoria[categoria] || []) }))
  const elegirArchivo = async (f) => {
    const html = await leerArchivo(f)
    if (html === null) return
    setError('')
    setSubida((s) => ({ ...s, archivo: f.name, bytes: f.size, html, nombre: s.nombre || (s.categoria ? sugerirNombre(porCategoria[s.categoria] || []) : '') || slug(f.name) }))
  }
  const nombreOk = subida && RE_NOMBRE.test(subida.nombre) && !(d && d.plantillas.includes(subida.nombre))
  const subir = () => hacer(async () => {
    await api('POST', '/plantillas/subidas', { nombre: subida.nombre, html: subida.html, ...(subida.categoria ? { categoria: subida.categoria } : {}) })
    setSubida(null)
  }, 'Plantilla subida')
  const reemplazar = async (nombre, f) => {
    const html = await leerArchivo(f)
    if (html !== null) hacer(() => api('PUT', '/plantillas/subidas/' + encodeURIComponent(nombre), { html }), 'Plantilla reemplazada')
  }
  const eliminar = (nombre) => hacer(async () => { await api('DELETE', '/plantillas/subidas/' + encodeURIComponent(nombre)); setBorrarSub('') }, 'Plantilla eliminada')

  const idValido = nueva ? RE_ID.test(nueva.id.trim().toUpperCase()) : false
  const idRepetido = nueva && d ? d.categorias.some((c) => c.id === nueva.id.trim().toUpperCase()) : false
  const propsVar = { categorias: d ? d.categorias : [], puedeCambiar, ocupado, onAsignar: asignar, onReemplazar: reemplazar, onEliminar: eliminar, confirmando: borrarSub, setConfirmando: setBorrarSub }

  return (
    <div className="cat">
      <p className="lead cat-lead">Cada categoría es un tipo de recurso del catálogo, con su ID, y reúne las variantes (plantillas) que n8n puede elegir al generar. {puedeCambiar ? 'Cree categorías, asigne cada plantilla a la suya o suba plantillas nuevas.' : 'Solo quien revisa las plantillas puede cambiarlas.'}</p>
      {error && <div className="msg bad" role="alert">{error}</div>}
      {!d && !error && <p className="help">Cargando…</p>}
      {d && d.plantillas.length === 0 && <div className="msg info">Todavía no hay plantillas publicadas. Las del sistema aparecen al compilar con «npm run build»; también puede subir las suyas.</div>}

      {d && (
        <>
          {puedeCambiar && (
            <div className="cat-barra">
              {!nueva && !subida && (
                <>
                  <button className="btn" onClick={() => { setSubida(null); setNueva({ id: '', nombre: '' }) }}>+ Nueva categoría</button>
                  <button className="btn sec" onClick={() => { setNueva(null); abrirSubida() }}>↑ Subir plantilla</button>
                </>
              )}
              {nueva && (
                <form className="card cat-form" onSubmit={(e) => { e.preventDefault(); if (idValido && !idRepetido && nueva.nombre.trim()) crear() }}>
                  <label>ID del catálogo
                    <input value={nueva.id} onChange={(e) => setNueva({ ...nueva, id: e.target.value })} placeholder="G-13" maxLength={7} aria-invalid={!!nueva.id && (!idValido || idRepetido)} />
                    <small className={nueva.id && (!idValido || idRepetido) ? 'mal' : ''}>{idRepetido ? 'Ya existe una categoría con ese ID.' : 'Letras y número del catálogo: G-13, PRE-10, POS-15…'}</small>
                  </label>
                  <label>Nombre del recurso
                    <input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder="Tarjetas de repaso" maxLength={120} />
                  </label>
                  <div className="cat-form-acc">
                    <button className="btn" type="submit" disabled={ocupado || !idValido || idRepetido || !nueva.nombre.trim()}>Crear</button>
                    <button className="btn sec" type="button" onClick={() => setNueva(null)}>Cancelar</button>
                  </div>
                </form>
              )}
              {subida && (
                <form className="card cat-form cat-subir" onSubmit={(e) => { e.preventDefault(); if (nombreOk && subida.html) subir() }}>
                  <label>Categoría
                    <select value={subida.categoria} onChange={(e) => elegirCategoria(e.target.value)}>
                      <option value="">Sin categoría por ahora</option>
                      {d.categorias.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.nombre}</option>)}
                    </select>
                    <small>Es el tipo de recurso al que pertenece esta variante.</small>
                  </label>
                  <label>Nombre de la plantilla
                    <input value={subida.nombre} onChange={(e) => setSubida({ ...subida, nombre: e.target.value.toLowerCase(), nombreEditado: true })} placeholder="lineatiempo-4" maxLength={80} aria-invalid={!!subida.nombre && !nombreOk} />
                    <small className={subida.nombre && !nombreOk ? 'mal' : ''}>
                      {subida.nombre && d.plantillas.includes(subida.nombre) ? 'Ya hay una plantilla con ese nombre.' : subida.nombre && !RE_NOMBRE.test(subida.nombre) ? 'Solo minúsculas, números y guiones.' : 'n8n deduce la variante del nombre: «tipo» es la 1, «tipo-2» la 2, «tipo-3» la 3…'}
                    </small>
                  </label>
                  <div className="cat-archivo">
                    <input ref={archivoNuevo} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; elegirArchivo(f) }} />
                    <button type="button" className="btn sec" onClick={() => archivoNuevo.current.click()}>{subida.archivo ? 'Cambiar archivo' : 'Elegir archivo HTML'}</button>
                    <span className="cat-archivo-n">{subida.archivo ? subida.archivo + ' · ' + kb(subida.bytes) : 'Ninguno elegido'}</span>
                  </div>
                  <p className="help cat-regla">El archivo debe ser una página HTML completa con <b>una sola</b> marca <code>{'{{TITULO}}'}</code> y <b>una sola</b> <code>{'/*CONTENIDO*/'}</code>: ahí pone n8n el título y el contenido del recurso. Hasta 1,5 MB. Si usa <code>{'/*CSS*/'}</code> o <code>{'/*LIB*/'}</code>, el sistema incrusta los estilos y el código comunes, igual que en las demás plantillas.</p>
                  <div className="cat-form-acc">
                    <button className="btn" type="submit" disabled={ocupado || !nombreOk || !subida.html}>{ocupado ? 'Subiendo…' : 'Subir plantilla'}</button>
                    <button className="btn sec" type="button" onClick={() => setSubida(null)}>Cancelar</button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="cat-lista">
            {d.categorias.map((c) => {
              const vars = porCategoria[c.id] || []
              return (
                <section key={c.id} className={'card cat-card' + (vars.length ? '' : ' vacia')}>
                  <header className="cat-cab">
                    <span className="cat-id">{c.id}</span>
                    {edit && edit.id === c.id ? (
                      <form className="cat-ren" onSubmit={(e) => { e.preventDefault(); if (edit.nombre.trim()) renombrar() }}>
                        <input aria-label="Nombre de la categoría" value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} maxLength={120} autoFocus />
                        <button className="btn sm" type="submit" disabled={ocupado || !edit.nombre.trim()}>Guardar</button>
                        <button className="btn sec sm" type="button" onClick={() => setEdit(null)}>Cancelar</button>
                      </form>
                    ) : (
                      <h3>{c.nombre}</h3>
                    )}
                    <span className="cat-n">{vars.length} {vars.length === 1 ? 'variante' : 'variantes'}</span>
                    {puedeCambiar && !(edit && edit.id === c.id) && (
                      <span className="cat-acc">
                        <button className="btn sec sm" onClick={() => { setNueva(null); abrirSubida(c.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>↑ Subir variante</button>
                        <button className="btn sec sm" onClick={() => setEdit({ id: c.id, nombre: c.nombre })}>Renombrar</button>
                        {borrar === c.id
                          ? <><button className="btn danger sm" disabled={ocupado} onClick={() => quitar(c.id)}>Sí, eliminar</button><button className="btn sec sm" onClick={() => setBorrar('')}>No</button></>
                          : <button className="btn danger sm" onClick={() => setBorrar(c.id)}>Eliminar</button>}
                      </span>
                    )}
                  </header>
                  {borrar === c.id && <p className="help cat-aviso">Sus {vars.length} plantillas quedarán «sin categoría». Las plantillas no se borran.</p>}
                  {vars.length > 0
                    ? <ul className="cat-vars">{vars.map((n) => <Variante key={n} nombre={n} actual={c.id} subida={d.subidas && d.subidas[n]} {...propsVar} />)}</ul>
                    : <p className="help cat-vacia">Todavía sin plantillas. {puedeCambiar ? 'Suba una con «Subir variante» o asígnele una desde «Sin categoría».' : ''}</p>}
                </section>
              )
            })}

            <section className={'card cat-card cat-sin' + (sin.length ? ' hay' : '')}>
              <header className="cat-cab">
                <span className="cat-id sin">—</span>
                <h3>Sin categoría</h3>
                <span className="cat-n">{sin.length} {sin.length === 1 ? 'plantilla' : 'plantillas'}</span>
              </header>
              <p className="help cat-aviso">n8n no usa estas plantillas hasta que tengan categoría.</p>
              {sin.length > 0
                ? <ul className="cat-vars">{sin.map((n) => <Variante key={n} nombre={n} actual="" subida={d.subidas && d.subidas[n]} {...propsVar} />)}</ul>
                : <p className="help cat-vacia">Todas las plantillas tienen categoría.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
