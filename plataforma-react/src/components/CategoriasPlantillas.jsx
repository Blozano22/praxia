import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { verNombre } from '../lib/nombres.js'
import { api } from '../lib/api.js'
import { FORMACIONES, NOMBRE_FORMACION, PRIORIDAD } from '../lib/formaciones.js'
import VistaPlantilla from './VistaPlantilla.jsx'
import './categorias.css'

// Categorías de las plantillas publicadas (las que n8n descarga). Cada categoría es un tipo de HTML del catálogo (ID + nombre) y es un
// «recurso» o una «actividad de autoaprendizaje». Aquí solo se ve CUÁNTAS variantes tiene cada una; quien revisa las plantillas puede crear
// categorías y subir variantes nuevas (HTML) sin esperar a un despliegue.
const RE_ID = /^[A-Z]{1,4}-[0-9]{2,3}$/
export const MAX_BYTES = 1536 * 1024
const TIPOS = { recurso: ['Recursos', 'Recurso'], actividad: ['Actividades', 'Actividad de autoaprendizaje'] }
export const kb = (b) => (b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1024 / 1024).toFixed(1) + ' MB')

// Etiquetas de las formaciones a las que sirve una categoría (con P / C: prioritaria o complementaria).
export function EtiquetasFormacion({ lista, vacio = true }) {
  if (!lista || !lista.length) return vacio ? <div className="cat-forms"><span className="cat-form-ninguna">Sin formaciones asignadas</span></div> : null
  return (
    <div className="cat-forms" aria-label="Formaciones de la categoría">
      {lista.map((f) => {
        const info = FORMACIONES.find((x) => x.id === f.formacion)
        return (
          <span key={f.formacion} className="cat-form-et" title={NOMBRE_FORMACION[f.formacion] + ' · ' + (PRIORIDAD[f.prioridad] || f.prioridad)}>
            <i style={{ background: info ? info.base : '#8590a8' }} aria-hidden="true" />
            {NOMBRE_FORMACION[f.formacion] || f.formacion}
            <b className={'cat-form-pc ' + f.prioridad}>{f.prioridad}</b>
          </span>
        )
      })}
    </div>
  )
}

// Casillas de formación con su prioridad (para editar una categoría).
function EditorFormaciones({ valor, onChange }) {
  return (
    <fieldset className="cat-ren-formaciones">
      <legend>Formaciones a las que sirve</legend>
      {FORMACIONES.map((f) => {
        const on = !!valor[f.id]
        return (
          <div key={f.id} className={'cat-ef' + (on ? ' on' : '')}>
            <label>
              <input type="checkbox" checked={on} onChange={(e) => { const n = { ...valor }; if (e.target.checked) n[f.id] = 'P'; else delete n[f.id]; onChange(n) }} />
              <i style={{ background: f.base }} aria-hidden="true" />
              <span>{f.nombre}</span>
            </label>
            <div className="cs-seg chico" role="radiogroup" aria-label={'Prioridad en ' + f.nombre}>
              {['P', 'C'].map((pr) => <button key={pr} type="button" role="radio" aria-checked={valor[f.id] === pr} disabled={!on} className={valor[f.id] === pr ? 'on' : ''} title={PRIORIDAD[pr]} onClick={() => onChange({ ...valor, [f.id]: pr })}>{pr}</button>)}
            </div>
          </div>
        )
      })}
    </fieldset>
  )
}

// Fila compacta de «Sin categoría»: nombre · Ver | categoría · Ocultar (una sola línea).
const I_ETQ = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1" /></svg>
const I_CH = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
const I_BASURA = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
const I_SUBIR = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
const I_OK = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
const I_X = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
const I_OJO_X = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 20c-6 0-10-8-10-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.6 9.6 0 0 1 12 4c6 0 10 8 10 8a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22M14.1 14.1a3 3 0 1 1-4.2-4.2" /></svg>
const I_OJO = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></svg>

const I_CHECK_OP = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>

// Interruptor de dos o más opciones (reemplaza al «select» de tipo).
function Seg({ valor, onChange, opciones, etiqueta, chico }) {
  return (
    <div className={'cs-seg' + (chico ? ' chico' : '')} role="radiogroup" aria-label={etiqueta}>
      {opciones.map(([v, t]) => <button key={v} type="button" role="radio" aria-checked={valor === v} className={valor === v ? 'on' : ''} onClick={() => onChange(v)}>{t}</button>)}
    </div>
  )
}

// Lista desplegable propia para elegir una categoría: con búsqueda, grupos (Recursos / Actividades) y el ID de cada una.
export function ListaCategorias({ valor, categorias, onChange, etiqueta, vacio, conVacio, ocupado, insignia }) {
  const [abierta, setAbierta] = useState(false)
  const [q, setQ] = useState('')
  const caja = useRef(null)
  useEffect(() => {
    if (!abierta) return undefined
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierta(false) }
    const tecla = (e) => { if (e.key === 'Escape') setAbierta(false) }
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla) }
  }, [abierta])
  const actual = categorias.find((c) => c.id === valor)
  const t = q.trim().toLowerCase()
  const elegir = (id) => { onChange(id); setAbierta(false); setQ('') }
  return (
    <div className="cs-dd" ref={caja}>
      <button type="button" className={'cs-dd-btn' + (actual ? ' lista' : '')} aria-haspopup="listbox" aria-expanded={abierta} aria-label={etiqueta} disabled={ocupado} onClick={() => setAbierta(!abierta)}>
        <span className="cs-dd-i">{I_ETQ}</span>
        <span className="cs-dd-t">{actual ? actual.id + ' · ' + actual.nombre : vacio}</span>
        <span className="cs-dd-c">{I_CH}</span>
      </button>
      {abierta && (
        <div className="cs-dd-panel">
          <div className="cs-dd-bus">
            <input autoFocus type="search" placeholder="Buscar por ID o nombre…" aria-label="Buscar categoría" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="cs-dd-lista" role="listbox" aria-label={etiqueta}>
            {conVacio && !t && <button type="button" role="option" aria-selected={!valor} className={'cs-op' + (!valor ? ' sel' : '')} onClick={() => elegir('')}><span className="cs-op-n">{vacio}</span></button>}
            {['recurso', 'actividad'].map((tp) => {
              const lista = categorias.filter((c) => c.tipo === tp && (!t || (c.id + ' ' + c.nombre).toLowerCase().includes(t)))
              if (!lista.length) return null
              return (
                <div key={tp}>
                  <div className="cs-dd-g">{TIPOS[tp][0].toUpperCase()} · {lista.length}</div>
                  {lista.map((c) => (
                    <button key={c.id} type="button" role="option" aria-selected={c.id === valor} className={'cs-op' + (c.id === valor ? ' sel' : '')} onClick={() => elegir(c.id)}>
                      <span className="cs-op-id">{c.id}</span>
                      <span className="cs-op-n">{c.nombre}</span>
                      {insignia && insignia(c) && <span className={'pg-pc ' + insignia(c)} title={insignia(c) === 'P' ? 'Prioritaria para esta formación' : 'Complementaria para esta formación'}>{insignia(c)}</span>}
                      {c.id === valor && I_CHECK_OP}
                    </button>
                  ))}
                </div>
              )
            })}
            {t && !categorias.some((c) => (c.id + ' ' + c.nombre).toLowerCase().includes(t)) && <div className="cs-dd-nada">Ninguna categoría coincide.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function SelectCategoria({ valor, categorias, ocupado, onChange, etiqueta, vacio }) {
  return (
    <label className="cs-cw">
      <span className="cs-ic">{I_ETQ}</span>
      <select className={'cs-sel' + (valor ? ' lista' : '')} aria-label={etiqueta} value={valor} disabled={ocupado} onChange={(e) => onChange(e.target.value)}>
        <option value="">{vacio}</option>
        {['recurso', 'actividad'].map((t) => (
          <optgroup key={t} label={TIPOS[t][0]}>{categorias.filter((c) => c.tipo === t).map((c) => <option key={c.id} value={c.id}>{c.id} · {c.nombre}</option>)}</optgroup>
        ))}
      </select>
      <span className="cs-ch">{I_CH}</span>
    </label>
  )
}

function FilaSin({ nombre, actual = '', compacta, categorias, puedeCambiar, ocupado, onAsignar, subida, oculta, onReemplazar, onEliminar, onOcultar, onVer, confirmando, setConfirmando }) {
  const archivo = useRef(null)
  return (
    <li className={'cs-fila' + (compacta ? ' compacta' : '') + (oculta ? ' oculta' : '') + (puedeCambiar ? '' : ' sin-sel')}>
      <span className="cat-var-n" title={verNombre(nombre)}>{verNombre(nombre)}{subida && <em className="cat-sub" title={'Subida por ' + (subida.por || 'alguien')}>subida</em>}{oculta && <em className="cat-ocu" title="Oculta para n8n: no sale en el índice ni se descarga">oculta</em>}</span>
      <button type="button" className="cat-var-ver" onClick={() => onVer(nombre)}>Ver</button>
      {puedeCambiar && <span className="cs-sep" aria-hidden="true" />}
      {puedeCambiar && <SelectCategoria valor={actual} categorias={categorias} ocupado={ocupado} onChange={(v) => v !== actual && onAsignar(nombre, v || null)} etiqueta={'Categoría de ' + nombre} vacio="Sin categoría" />}
      {puedeCambiar && (
        subida ? (
          <span className="cs-acc">
            <input ref={archivo} type="file" accept=".html,.htm,text/html" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onReemplazar(nombre, f) }} />
            <button type="button" className="cs-oc" disabled={ocupado} aria-label={'Reemplazar el archivo de ' + nombre} title="Reemplazar el archivo" onClick={() => archivo.current.click()}>{I_SUBIR}</button>
            {confirmando === nombre
              ? <><button type="button" className="cs-oc confirma" disabled={ocupado} aria-label={'Sí, eliminar ' + nombre} title="Sí, eliminar" onClick={() => onEliminar(nombre)}>{I_OK}</button><button type="button" className="cs-oc" aria-label="No eliminar" title="No eliminar" onClick={() => setConfirmando('')}>{I_X}</button></>
              : <button type="button" className="cs-oc peligro" aria-label={'Eliminar ' + nombre} title="Eliminar" onClick={() => setConfirmando(nombre)}>{I_BASURA}</button>}
          </span>
        ) : (
          <span className="cs-acc">
            {oculta ? (
              <button type="button" className="cs-oc" disabled={ocupado} aria-label={'Volver a mostrar ' + nombre + ' a n8n'} title="Vuelve a ofrecerse a n8n" onClick={() => onOcultar(nombre, false)}>{I_OJO}</button>
            ) : (
              <button type="button" className="cs-oc" disabled={ocupado} aria-label={'Ocultar ' + nombre + ' de n8n'} title="n8n deja de ver esta plantilla; no se borra y se puede volver a mostrar" onClick={() => onOcultar(nombre, true)}>{I_OJO_X}</button>
            )}
            {confirmando === nombre
              ? <><button type="button" className="cs-oc confirma" disabled={ocupado} aria-label={'Sí, eliminar ' + nombre} title="Sí, eliminar: sale de la pantalla y de n8n; desde aquí no se puede deshacer" onClick={() => onEliminar(nombre, true)}>{I_OK}</button><button type="button" className="cs-oc" aria-label="No eliminar" title="No eliminar" onClick={() => setConfirmando('')}>{I_X}</button></>
              : <button type="button" className="cs-oc peligro" disabled={ocupado} aria-label={'Eliminar ' + nombre} title="Eliminar" onClick={() => setConfirmando(nombre)}>{I_BASURA}</button>}
          </span>
        )
      )}
    </li>
  )
}

export default function CategoriasPlantillas({ puedeCambiar = false, aviso }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [ver, setVer] = useState('recurso') // qué tipo de categorías se ven: recurso | actividad
  const [nueva, setNueva] = useState(null) // { id, nombre, tipo } mientras se crea una categoría
  const [edit, setEdit] = useState(null) // { id, nombre, tipo } mientras se edita una
  const [borrar, setBorrar] = useState('') // id de categoría con la confirmación a la vista
  const [borrarSub, setBorrarSub] = useState('') // nombre de plantilla subida con la confirmación a la vista
  const [gestionando, setGestionando] = useState('') // id de la categoría cuya lista de variantes está abierta para gestionarla
  const [sinAbierta, setSinAbierta] = useState(true) // la tarjeta «Sin categoría» se puede plegar
  const [paraTodas, setParaTodas] = useState('') // categoría elegida para asignar a todas las de «Sin categoría»
  const [viendo, setViendo] = useState('') // nombre de la plantilla cuya vista previa está abierta

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
  const asignarTodas = () => hacer(async () => { for (const n of sin) await api('PUT', '/plantillas/asignacion/' + encodeURIComponent(n), { categoria: paraTodas }); setParaTodas('') }, 'Categoría asignada a ' + sin.length + (sin.length === 1 ? ' plantilla' : ' plantillas'))
  const crear = () => hacer(async () => { await api('POST', '/plantillas/categorias', { id: nueva.id.trim().toUpperCase(), nombre: nueva.nombre.trim(), tipo: nueva.tipo }); setVer(nueva.tipo); setNueva(null) }, 'Categoría creada')
  const guardarEdicion = () => hacer(async () => {
    await api('PUT', '/plantillas/categorias/' + edit.id, { nombre: edit.nombre.trim(), tipo: edit.tipo })
    await api('PUT', '/plantillas/categorias/' + edit.id + '/formaciones', { formaciones: FORMACIONES.filter((f) => edit.formaciones && edit.formaciones[f.id]).map((f) => ({ formacion: f.id, prioridad: edit.formaciones[f.id] })) })
    if (edit.tipo !== ver) setVer(edit.tipo)
    setEdit(null)
  }, 'Cambios guardados')
  const quitar = (id) => hacer(async () => { await api('DELETE', '/plantillas/categorias/' + id); setBorrar('') }, 'Categoría eliminada')

  const ocultas = useMemo(() => new Set(d ? d.ocultas || [] : []), [d])
  // todasPorCategoria: todas las variantes de cada categoría (para gestionarlas y para proponer el nombre siguiente);
  // porCategoria: solo las que n8n ve (las quitadas de n8n no cuentan).
  const todasPorCategoria = useMemo(() => {
    if (!d) return {}
    const m = {}
    d.plantillas.forEach((n) => { const c = d.asignaciones[n]; if (c) (m[c] = m[c] || []).push(n) })
    return m
  }, [d])
  const porCategoria = useMemo(() => Object.fromEntries(Object.entries(todasPorCategoria).map(([c, l]) => [c, l.filter((n) => !ocultas.has(n))])), [todasPorCategoria, ocultas])
  const sin = d ? d.plantillas.filter((n) => !d.asignaciones[n]) : []
  const cuantas = (t) => (d ? d.categorias.filter((c) => c.tipo === t).length : 0)
  const visibles = d ? d.categorias.filter((c) => c.tipo === ver) : []

  // ---- subir una plantilla (HTML)
  const leerArchivo = async (f) => {
    if (!f) return null
    if (f.size > MAX_BYTES) { setError('El archivo pesa ' + kb(f.size) + ' y el máximo es 1,5 MB.'); return null }
    try { return await f.text() } catch { setError('No se pudo leer el archivo.'); return null }
  }
  const reemplazar = async (nombre, f) => {
    const html = await leerArchivo(f)
    if (html !== null) hacer(() => api('PUT', '/plantillas/subidas/' + encodeURIComponent(nombre), { html }), 'Plantilla reemplazada')
  }
  const ocultar = (nombre, oculta) => hacer(() => api('PUT', '/plantillas/ocultas/' + encodeURIComponent(nombre), { oculta }), oculta ? 'Quitada de n8n' : 'Vuelve a ofrecerse a n8n')
  const eliminar = (nombre, delSistema = false) => hacer(async () => { await api('DELETE', (delSistema ? '/plantillas/sistema/' : '/plantillas/subidas/') + encodeURIComponent(nombre)); setBorrarSub('') }, 'Plantilla eliminada')

  const idValido = nueva ? RE_ID.test(nueva.id.trim().toUpperCase()) : false
  const idRepetido = nueva && d ? d.categorias.some((c) => c.id === nueva.id.trim().toUpperCase()) : false
  const propsFila = { categorias: d ? d.categorias : [], puedeCambiar, ocupado, onAsignar: asignar, onReemplazar: reemplazar, onEliminar: eliminar, onOcultar: ocultar, onVer: setViendo, confirmando: borrarSub, setConfirmando: setBorrarSub }
  const OPC_TIPO = [['recurso', 'Recurso'], ['actividad', 'Actividad']]

  return (
    <div className="cat">
      <p className="lead cat-lead">Cada categoría es un tipo de HTML del catálogo, con su ID, y puede ser un <b>recurso</b> o una <b>actividad de autoaprendizaje</b> (como un crucigrama). Reúne las variantes que n8n puede elegir al generar. {puedeCambiar ? 'Cree categorías y suba variantes nuevas.' : 'Solo quien revisa las plantillas puede cambiarlas.'}</p>
      {error && <div className="msg bad" role="alert">{error}</div>}
      {!d && !error && <p className="help">Cargando…</p>}

      {d && (
        <>
          <div className="cat-tipos" role="tablist" aria-label="Tipo de HTML">
            {['recurso', 'actividad'].map((t) => (
              <button key={t} role="tab" aria-selected={ver === t} className={ver === t ? 'on' : ''} onClick={() => setVer(t)}>{TIPOS[t][0]} <span>· {cuantas(t)}</span></button>
            ))}
          </div>

          {puedeCambiar && (
            <div className="cat-barra">
              {!nueva && (
                <>
                  <button className="btn" onClick={() => setNueva({ id: '', nombre: '', tipo: ver })}>+ Nueva categoría</button>
                </>
              )}
              {nueva && (
                <form className="card cat-form" onSubmit={(e) => { e.preventDefault(); if (idValido && !idRepetido && nueva.nombre.trim()) crear() }}>
                  <div className="cat-campo"><span className="cat-lbl">¿Qué es?</span><Seg valor={nueva.tipo} onChange={(tipo) => setNueva({ ...nueva, tipo })} opciones={OPC_TIPO} etiqueta="¿Qué es?" /><small>{nueva.tipo === 'actividad' ? 'Una actividad de autoaprendizaje (como un crucigrama).' : 'Un tipo de HTML que n8n elige para mostrar contenido.'}</small></div>
                  <label>ID del catálogo
                    <input value={nueva.id} onChange={(e) => setNueva({ ...nueva, id: e.target.value })} placeholder={nueva.tipo === 'actividad' ? 'ACT-01' : 'G-13'} maxLength={7} aria-invalid={!!nueva.id && (!idValido || idRepetido)} />
                    <small className={nueva.id && (!idValido || idRepetido) ? 'mal' : ''}>{idRepetido ? 'Ya existe una categoría con ese ID.' : 'Letras y número: G-13, PRE-10, ACT-01…'}</small>
                  </label>
                  <label>Nombre
                    <input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} placeholder={nueva.tipo === 'actividad' ? 'Crucigrama' : 'Tarjetas de repaso'} maxLength={120} />
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
            {visibles.map((c) => {
              const n = (porCategoria[c.id] || []).length
              return (
                <section key={c.id} className={'card cat-card cat-res' + (n ? '' : ' vacia') + (edit && edit.id === c.id ? ' editando' : '')}>
                  <header className="cat-cab">
                    <span className="cat-id">{c.id}</span>
                    {edit && edit.id === c.id ? (
                      <form className="cat-ren" onSubmit={(e) => { e.preventDefault(); if (edit.nombre.trim()) guardarEdicion() }}>
                        <input aria-label="Nombre de la categoría" value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} maxLength={120} autoFocus />
                        <div className="cat-ren-acc">
                          <Seg chico valor={edit.tipo} onChange={(tipo) => setEdit({ ...edit, tipo })} opciones={OPC_TIPO} etiqueta="Tipo" />
                          <button className="btn sm" type="submit" disabled={ocupado || !edit.nombre.trim()}>Guardar</button>
                          <button className="btn sec sm" type="button" onClick={() => setEdit(null)}>Cancelar</button>
                        </div>
                        <EditorFormaciones valor={edit.formaciones || {}} onChange={(formaciones) => setEdit({ ...edit, formaciones })} />
                      </form>
                    ) : (
                      <h3>{c.nombre}</h3>
                    )}
                    {!(edit && edit.id === c.id) && <span className="cat-cuenta" title={n + (n === 1 ? ' variante' : ' variantes')}><b>{n}</b><small>{n === 1 ? 'variante' : 'variantes'}</small></span>}
                  </header>
                  {!(edit && edit.id === c.id) && <EtiquetasFormacion lista={(d.formaciones || {})[c.id]} />}
                  {puedeCambiar && !(edit && edit.id === c.id) && (
                    <div className="cat-acc">
                      <button className="btn sec sm" aria-expanded={gestionando === c.id} onClick={() => setGestionando(gestionando === c.id ? '' : c.id)}>{gestionando === c.id ? 'Cerrar variantes' : 'Gestionar variantes'}</button>
                      <button className="btn sec sm" onClick={() => setEdit({ id: c.id, nombre: c.nombre, tipo: c.tipo, formaciones: Object.fromEntries(((d.formaciones || {})[c.id] || []).map((f) => [f.formacion, f.prioridad])) })}>Editar</button>
                      {borrar === c.id
                        ? <><button className="btn danger sm" disabled={ocupado} onClick={() => quitar(c.id)}>Sí, eliminar</button><button className="btn sec sm" onClick={() => setBorrar('')}>No</button></>
                        : <button className="btn danger sm" onClick={() => setBorrar(c.id)}>Eliminar</button>}
                    </div>
                  )}
                  {borrar === c.id && <p className="help cat-aviso">Sus {(todasPorCategoria[c.id] || []).length} plantillas quedarán «sin categoría». Las plantillas no se borran.</p>}
                  {puedeCambiar && gestionando === c.id && (
                    <div className="cat-gestion">
                      <p className="cs-info"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg><span><b>Subidas por una persona:</b> se reemplazan o se eliminan. <b>Del sistema:</b> no se borran; se pueden ocultar de n8n y volver a mostrar.</span></p>
                      {(todasPorCategoria[c.id] || []).length
                        ? <ul className="cs-lista una">{todasPorCategoria[c.id].map((nom) => <FilaSin compacta key={nom} nombre={nom} actual={c.id} subida={d.subidas && d.subidas[nom]} oculta={ocultas.has(nom)} {...propsFila} />)}</ul>
                        : <p className="help cat-vacia">Esta categoría todavía no tiene variantes.</p>}
                    </div>
                  )}
                </section>
              )
            })}
            {visibles.length === 0 && <div className="cat-ninguna">No hay categorías de {TIPOS[ver][0].toLowerCase()}. {puedeCambiar ? 'Cree la primera con «+ Nueva categoría».' : ''}</div>}
          </div>

          {sin.length > 0 && (
            <section className="card cat-card cat-sin hay cs-card">
              <button type="button" className="cs-tog" aria-expanded={sinAbierta} onClick={() => setSinAbierta(!sinAbierta)}>
                <span className="cs-warn" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg></span>
                <span className="cs-tit">
                  <b>Sin categoría <em>{sin.length} {sin.length === 1 ? 'plantilla' : 'plantillas'}</em></b>
                  <small>n8n no usa estas plantillas hasta que tengan categoría.{puedeCambiar ? ' Elija la de cada una o, si no se van a usar, ocúltelas de n8n.' : ''}</small>
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: sinAbierta ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {sinAbierta && (
                <>
                  {puedeCambiar && sin.length > 1 && (
                    <div className="cs-masiva">
                      <span>Misma categoría para todas</span>
                      <ListaCategorias valor={paraTodas} categorias={d.categorias} ocupado={ocupado} onChange={setParaTodas} etiqueta="Categoría para todas" vacio="Elegir categoría…" />
                      <button type="button" className="btn sm" disabled={ocupado || !paraTodas} onClick={asignarTodas}>Aplicar a {sin.length === 2 ? 'las 2' : 'las ' + sin.length}</button>
                    </div>
                  )}
                  <ul className="cs-lista">{sin.map((n) => <FilaSin key={n} nombre={n} subida={d.subidas && d.subidas[n]} oculta={ocultas.has(n)} {...propsFila} />)}</ul>
                </>
              )}
            </section>
          )}
        </>
      )}
      {viendo && <VistaPlantilla nombre={viendo} subida={!!(d && d.subidas && d.subidas[viendo])} categoria={d ? (d.categorias.find((c) => c.id === d.asignaciones[viendo]) || null) : null} onCerrar={() => setViendo('')} />}
    </div>
  )
}
