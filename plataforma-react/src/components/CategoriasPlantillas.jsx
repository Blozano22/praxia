import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, RUTA_API } from '../lib/api.js'
import './categorias.css'

// Categorías de las plantillas publicadas (las que n8n descarga): cada categoría es un tipo de recurso del catálogo (ID + nombre) y reúne
// las variantes que n8n puede elegir. Cualquiera que vea las plantillas la consulta; quien las revisa puede crear y asignar.
const RE_ID = /^[A-Z]{1,4}-[0-9]{2,3}$/
const urlPlantilla = (n) => RUTA_API.replace(/\/api$/, '') + '/plantillas-html/' + n + '.html'

function Variante({ nombre, categorias, actual, puedeCambiar, ocupado, onAsignar }) {
  return (
    <li className="cat-var">
      <span className="cat-var-n">{nombre}</span>
      <a href={urlPlantilla(nombre)} target="_blank" rel="noopener noreferrer" className="cat-var-ver">Ver ↗</a>
      {puedeCambiar && (
        <select aria-label={'Categoría de ' + nombre} value={actual || ''} disabled={ocupado} onChange={(e) => onAsignar(nombre, e.target.value || null)}>
          <option value="">Sin categoría</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.nombre}</option>)}
        </select>
      )}
    </li>
  )
}

export default function CategoriasPlantillas({ puedeCambiar = false, aviso }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [nueva, setNueva] = useState(null) // { id, nombre } mientras se crea una
  const [edit, setEdit] = useState(null) // { id, nombre } mientras se renombra una
  const [borrar, setBorrar] = useState('') // id con la confirmación a la vista

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
  const idValido = nueva ? RE_ID.test(nueva.id.trim().toUpperCase()) : false
  const idRepetido = nueva && d ? d.categorias.some((c) => c.id === nueva.id.trim().toUpperCase()) : false

  return (
    <div className="cat">
      <p className="lead cat-lead">Cada categoría es un tipo de recurso del catálogo, con su ID, y reúne las variantes (plantillas) que n8n puede elegir al generar. {puedeCambiar ? 'Cree categorías y asigne cada plantilla a la suya.' : 'Solo quien revisa las plantillas puede cambiarlas.'}</p>
      {error && <div className="msg bad" role="alert">{error}</div>}
      {!d && !error && <p className="help">Cargando…</p>}
      {d && d.plantillas.length === 0 && <div className="msg info">No se encontraron las plantillas publicadas. Aparecen cuando el servidor se compila con «npm run build».</div>}

      {d && (
        <>
          {puedeCambiar && (
            <div className="cat-nueva">
              {!nueva ? (
                <button className="btn" onClick={() => setNueva({ id: '', nombre: '' })}>+ Nueva categoría</button>
              ) : (
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
                        <button className="btn sec sm" onClick={() => setEdit({ id: c.id, nombre: c.nombre })}>Renombrar</button>
                        {borrar === c.id
                          ? <><button className="btn danger sm" disabled={ocupado} onClick={() => quitar(c.id)}>Sí, eliminar</button><button className="btn sec sm" onClick={() => setBorrar('')}>No</button></>
                          : <button className="btn danger sm" onClick={() => setBorrar(c.id)}>Eliminar</button>}
                      </span>
                    )}
                  </header>
                  {borrar === c.id && <p className="help cat-aviso">Sus {vars.length} plantillas quedarán «sin categoría». Las plantillas no se borran.</p>}
                  {vars.length > 0
                    ? <ul className="cat-vars">{vars.map((n) => <Variante key={n} nombre={n} categorias={d.categorias} actual={c.id} puedeCambiar={puedeCambiar} ocupado={ocupado} onAsignar={asignar} />)}</ul>
                    : <p className="help cat-vacia">Todavía sin plantillas. {puedeCambiar ? 'Asígnele una desde «Sin categoría» o desde la lista de otra categoría.' : ''}</p>}
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
                ? <ul className="cat-vars">{sin.map((n) => <Variante key={n} nombre={n} categorias={d.categorias} actual="" puedeCambiar={puedeCambiar} ocupado={ocupado} onAsignar={asignar} />)}</ul>
                : <p className="help cat-vacia">Todas las plantillas tienen categoría.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
