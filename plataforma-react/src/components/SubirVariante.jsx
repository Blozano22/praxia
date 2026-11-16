import { useEffect, useRef, useState } from 'react'
import { marcoPlantilla } from '../lib/vista.js'
import { api } from '../lib/api.js'
import { ListaCategorias, kb, MAX_BYTES } from './CategoriasPlantillas.jsx'
import { verNombre } from '../lib/nombres.js'
import { NOMBRE_FORMACION, conFormacion } from '../lib/formaciones.js'
import DetalleCampos from './DetalleCampos.jsx'

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
export default function SubirVariante({ cats, clase = '', formacion = '', categoriaInicial = '', puedeRevisar = false, onCerrar, onSubida }) {
  // Con una formación elegida en la galería, solo se ofrecen las categorías que la sirven (con su prioridad P / C); «Ver todas» quita el filtro.
  const [soloFormacion, setSoloFormacion] = useState(!!formacion)
  const prioridad = (c) => { const f = ((cats.formaciones || {})[c.id] || []).find((x) => x.formacion === formacion); return f ? f.prioridad : '' }
  const sirve = (c) => !!prioridad(c)
  // Con una clase elegida en la galería (recursos o actividades) solo se ofrecen las categorías de esa clase.
  const deLaClase = clase ? cats.categorias.filter((c) => c.tipo === clase) : cats.categorias
  const visibles = soloFormacion && formacion ? deLaClase.filter(sirve) : deLaClase
  const [categoria, setCategoria] = useState(() => {
    const inicial = deLaClase.find((c) => c.id === categoriaInicial) || { id: '' }
    const ok = !!inicial.id && (!formacion || sirve(inicial))
    return ok ? categoriaInicial : ''
  })

  // En una categoría que sirve a varias formaciones, cada formación tiene sus propios campos: hay que elegir a cuál pertenece el grupo que se sube.
  // Se preselecciona la formación elegida en la galería; si no, la que diga la ficha del primer archivo.
  const [formSel, setFormSel] = useState(formacion || '')
  const [formManual, setFormManual] = useState(false) // true cuando la persona eligió la formación: ya no se cambia sola
  const formsDe = (id) => ((cats.formaciones || {})[id] || []).map((x) => x.formacion)
  const formsCat = categoria ? formsDe(categoria) : []
  const compartida = formsCat.length >= 2
  const formUsada = compartida && formsCat.includes(formSel) ? formSel : '' // lo que se envía al servidor
  // Categorías de ACTIVIDAD: además de la formación hay que elegir si el grupo es de actividades calificables o prácticas (cada tipo tiene sus propios campos y su propia numeración).
  const esActividad = !!categoria && ((cats.categorias.find((c) => c.id === categoria) || {}).tipo === 'actividad')
  const [tipoSel, setTipoSel] = useState('') // '' | 'c' (calificable) | 'p' (práctica)
  const [tipoManual, setTipoManual] = useState(false) // true cuando la persona eligió el tipo: ya no se cambia solo
  const calUsada = esActividad && tipoSel ? tipoSel === 'c' : null // lo que se envía al servidor
  const claveTipo = calUsada === null ? '' : calUsada ? 'c' : 'p'
  const [items, setItems] = useState([]) // archivos en el orden en que se eligieron: { id, nombre, bytes, html, errorLocal }
  const [revs, setRevs] = useState({}) // revisión de cada uno: { fase: 'revisando'|'ok'|'aviso'|'error', conEjemplo, html, nombre, mensaje }
  const [envio, setEnvio] = useState({}) // estado de la subida de cada uno: { fase: 'subiendo'|'subido'|'no_subido', real, mensaje }
  const [fase, setFase] = useState('edicion') // edicion | subiendo | terminado
  const [avance, setAvance] = useState({ n: 0, total: 0 })
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState('') // id del archivo cuya vista previa está abierta
  const [fichaCat, setFichaCat] = useState('') // categoría que se preseleccionó porque la ficha del archivo la decía
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
    setRevs(Object.fromEntries(lista.map((i) => [i.id, cache.current.get(categoria + '|' + claveTipo + '|' + i.id) || { fase: 'revisando' }])))
    ;(async () => {
      for (const i of lista) {
        const k = categoria + '|' + claveTipo + '|' + i.id
        if (cache.current.has(k)) continue
        let res
        try {
          const r = await api('POST', '/plantillas/subidas/previa', { html: i.html, ...(categoria ? { categoria } : {}), ...(calUsada !== null ? { calificable: calUsada } : {}) }) // sin formación: la respuesta trae la comparación de cada formación y no hay que volver a pedirla al cambiar
          res = { fase: 'ok', conEjemplo: !!r.conEjemplo, html: r.html || '', nombre: r.nombre || null, nombres: r.nombres || {}, esquema: r.esquema || null, esquemas: r.esquemas || {}, ficha: r.ficha || null, avisos: Array.isArray(r.avisos) ? r.avisos : [], requiereFormacion: !!r.requiereFormacion, requiereTipo: !!r.requiereTipo }
        } catch (e) { res = { fase: 'error', mensaje: e.message || 'No se pudo revisar el archivo.' } }
        if (!vigente) return
        cache.current.set(k, res)
        setRevs((p) => ({ ...p, [i.id]: res }))
      }
    })()
    return () => { vigente = false }
  }, [items, categoria, calUsada])

  // Formación del grupo: la de la galería si la categoría la sirve; si no, la que diga la ficha del primer archivo que la traiga (nunca se cambia una elegida a mano).
  useEffect(() => {
    if (!compartida || formManual) return
    const deFicha = items.map((i) => revs[i.id] && revs[i.id].ficha && revs[i.id].ficha.formacion).find((f) => f && formsCat.includes(f))
    const nueva = formsCat.includes(formacion) ? formacion : (deFicha || '')
    if (nueva !== formSel) setFormSel(nueva)
  }, [categoria, revs, items]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tipo del grupo (actividades): el que diga la ficha del primer archivo que lo traiga, salvo que la persona lo haya elegido.
  useEffect(() => {
    if (!esActividad || tipoManual) return
    const d = items.map((i) => revs[i.id] && revs[i.id].ficha && revs[i.id].ficha.calificable).find((x) => typeof x === 'boolean')
    const nuevo = typeof d === 'boolean' ? (d ? 'c' : 'p') : ''
    if (nuevo !== tipoSel) setTipoSel(nuevo)
  }, [categoria, revs, items]) // eslint-disable-line react-hooks/exhaustive-deps

  // Si no hay categoría elegida y el primer archivo con ficha trae «Categoría Praxia», se preselecciona (nunca se cambia una ya elegida).
  useEffect(() => {
    if (categoria || fichaCat) return
    const con = items.find((i) => revs[i.id] && revs[i.id].fase === 'ok' && revs[i.id].ficha && revs[i.id].ficha.categoria)
    if (!con) return
    const id = revs[con.id].ficha.categoria
    const c = cats.categorias.find((x) => x.id === id)
    if (!c) return
    if (soloFormacion && formacion && !sirve(c)) setSoloFormacion(false)
    setCategoria(id); setFichaCat(id)
  }, [revs]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Comparación de campos que vale: en una categoría compartida, la de la formación elegida (sin formación no se compara); si no, la de la categoría.
  const esquemaDe = (rv) => (!rv || rv.fase !== 'ok' ? null : compartida ? ((rv.esquemas || {})[formUsada] || null) : rv.esquema)
  const distinto = (i) => { const e = esquemaDe(revs[i.id]); return !!e && !e.coincide }
  const validos = items.filter((i) => !i.errorLocal && revs[i.id] && revs[i.id].fase === 'ok' && !distinto(i))
  const revisando = items.some((i) => !i.errorLocal && (!revs[i.id] || revs[i.id].fase === 'revisando'))
  // nombre que anuncia la revisión: en una categoría compartida, el de la formación elegida (cada formación numera las suyas: G-09-TEC-V01…)
  const nombreDe = (rv) => (compartida ? ((rv.nombres || {})[formUsada] || null) : rv.nombre)
  const primero = validos.length ? nombreDe(revs[validos[0].id]) : null
  // Sin categoría elegida se puede subir si todos los archivos válidos la traen en su ficha (el servidor usa esa).
  const categoriaPorFicha = !categoria && validos.length > 0 && validos.every((i) => revs[i.id].ficha && revs[i.id].ficha.categoria)
  const anunciado = (i) => { const k = validos.indexOf(i); return k < 0 ? null : nombreEn(primero, k) }

  // Sube UNO TRAS OTRO, en el orden de la lista y esperando cada respuesta (así los números salen en orden). Una que falla no detiene las demás.
  const faltaFormacion = compartida && !formUsada // categoría compartida sin formación elegida
  const faltaTipo = esActividad && calUsada === null // categoría de actividades sin decir si es calificable o práctica
  const subirTodo = async (e) => {
    e.preventDefault()
    if ((!categoria && !categoriaPorFicha) || !validos.length || revisando || ocupado || fase === 'terminado' || faltaFormacion || faltaTipo) return
    setFase('subiendo'); setError(''); setAbierto('')
    const lista = [...validos]
    let hechos = 0
    for (let n = 0; n < lista.length; n++) {
      const i = lista[n]
      setAvance({ n: n + 1, total: lista.length })
      setEnvio((p) => ({ ...p, [i.id]: { fase: 'subiendo' } }))
      try {
        const r = await api('POST', '/plantillas/subidas', { html: i.html, ...(categoria ? { categoria } : {}), ...(formUsada ? { formacion: formUsada } : {}), ...(calUsada !== null ? { calificable: calUsada } : {}) })
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
  const conErrores = items.filter((i) => i.errorLocal || (revs[i.id] && revs[i.id].fase === 'error') || distinto(i)).length
  const etiquetaSubir = validos.length > 1 ? 'Subir ' + validos.length + ' archivos' : 'Subir variante'

  const estadoDe = (i) => {
    const en = envio[i.id]
    if (en) return en.fase === 'subiendo' ? { k: 'subiendo', t: 'Subiendo…' } : en.fase === 'subido' ? { k: 'subido', t: 'Subido' } : { k: 'error', t: 'No subido', m: en.mensaje }
    if (i.errorLocal) return { k: 'error', t: 'Error', m: i.errorLocal }
    const rv = revs[i.id]
    if (!rv || rv.fase === 'revisando') return { k: 'revisando', t: 'Revisando…' }
    if (rv.fase === 'error') return { k: 'error', t: 'Error', m: rv.mensaje }
    if (faltaFormacion) return { k: 'campos', t: 'Falta la formación', m: 'Elija arriba la formación del grupo.' }
    if (faltaTipo) return { k: 'campos', t: 'Falta el tipo', m: 'Elija arriba si el grupo es de actividades calificables o prácticas.' }
    if (distinto(i)) {
      return { k: 'error', t: 'Campos distintos', m: 'No usa los mismos campos que las demás de ' + (categoria || 'la categoría') + (formUsada ? ' en ' + NOMBRE_FORMACION[formUsada] : '') + '. Ajuste los campos del archivo a los de esa formación: no se puede subir.', esq: esquemaDe(rv) }
    }
    return { k: 'listo', t: 'Listo' }
  }

  return (
    <div className="sv-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onCerrar() }}>
      <form className="sv-ventana" role="dialog" aria-modal="true" aria-label={'Subir variante' + (clase ? ' de ' + (clase === 'actividad' ? 'actividad' : 'recurso') : '')} onSubmit={subirTodo}>
        <header className="sv-cab">
          <span className="sv-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg></span>
          <h2>Subir variante{clase ? ' de ' + (clase === 'actividad' ? 'actividad' : 'recurso') : ''}</h2>
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
            {fichaCat && categoria === fichaCat && <small className="sv-ficha">La ficha del archivo dice {fichaCat}.</small>}
            <small>{compartida ? 'Todas las variantes de una misma formación usan los mismos campos; solo cambia el diseño.' : 'Todas las variantes de una categoría usan los mismos campos; solo cambia el diseño.'}</small>
          </div>
          {compartida && (
            <div className="sv-campo">
              <span className="sv-lbl" id="sv-form-lbl">Formación</span>
              <div className="sv-formas" role="radiogroup" aria-labelledby="sv-form-lbl">
                {formsCat.map((f) => (
                  <button key={f} type="button" role="radio" aria-checked={formUsada === f} className={'sv-forma' + (formUsada === f ? ' on' : '')} disabled={ocupado || fase === 'terminado'} onClick={() => { setFormSel(f); setFormManual(true) }}>{NOMBRE_FORMACION[f] || f}</button>
                ))}
              </div>
              <small className={faltaFormacion ? 'sv-form-falta' : undefined}>{faltaFormacion ? categoria + ' sirve para varias formaciones: elija a cuál pertenece este grupo. Cada formación tiene sus propios campos.' : 'Todo el grupo se sube como ' + NOMBRE_FORMACION[formUsada] + ' y se compara solo con las variantes de esa formación.'}</small>
            </div>
          )}

          {esActividad && (
            <div className="sv-campo">
              <span className="sv-lbl" id="sv-tipo-lbl">Tipo de actividad</span>
              <div className="sv-formas" role="radiogroup" aria-labelledby="sv-tipo-lbl">
                {[['c', 'Calificable'], ['p', 'Práctica']].map(([k, t]) => (
                  <button key={k} type="button" role="radio" aria-checked={tipoSel === k} className={'sv-forma' + (tipoSel === k ? ' on' : '')} disabled={ocupado || fase === 'terminado'} onClick={() => { setTipoSel(k); setTipoManual(true) }}>{t}</button>
                ))}
              </div>
              <small className={faltaTipo ? 'sv-form-falta' : undefined}>{faltaTipo ? categoria + ' es una categoría de actividades: elija si este grupo es calificable o práctica. Cada tipo tiene sus propios campos y su propia numeración (…-C-V1, …-P-V1).' : 'Todo el grupo se sube como ' + (calUsada ? 'calificable' : 'práctica') + ' y se compara solo con las variantes de ese tipo.'}</small>
            </div>
          )}

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
                      <b title={i.nombre}>{i.nombre}{rv && rv.ficha && rv.ficha.formacion && <em className="sv-form" title="Formación que dice la ficha del archivo">{NOMBRE_FORMACION[rv.ficha.formacion] || rv.ficha.formacion}</em>}</b>
                      <small>{kb(i.bytes)}{nombre ? (envio[i.id] && envio[i.id].fase === 'subido' ? ' · guardado como ' : ' · se guardará como ') : ''}{nombre && <strong>{verNombre(nombre)}</strong>}</small>
                      {st.m && <span className={'sv-fila-err' + (st.k === 'campos' ? ' amb' : '')}>{st.m}</span>}
                      {rv && rv.fase === 'ok' && !envio[i.id] && [...(rv.avisos || []), ...(formUsada && rv.ficha && rv.ficha.formacion && rv.ficha.formacion !== formUsada ? ['La ficha dice formación ' + rv.ficha.formacion + ' y la vas a subir como ' + formUsada + '.'] : [])].map((a, k) => <span key={k} className="sv-fila-aviso">{a}</span>)}
                      {st.esq && <DetalleCampos faltan={st.esq.faltan} sobran={st.esq.sobran} referencia={st.esq.referencia} />}
                    </div>
                    <span className={'sv-est ' + st.k}>{st.k === 'revisando' || st.k === 'subiendo' ? <span className="sv-giro" aria-hidden="true" /> : null}{st.t}</span>
                    {puedeVer && <button type="button" className="sv-ver" aria-expanded={abierto === i.id} onClick={() => setAbierto(abierto === i.id ? '' : i.id)}>{abierto === i.id ? 'Ocultar' : 'Ver'}</button>}
                    {fase === 'edicion' && <button type="button" className="sv-quitar" aria-label={'Quitar ' + i.nombre + ' de la lista'} title="Quitar de la lista" onClick={() => quitar(i.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg><span>Quitar</span></button>}
                    {abierto === i.id && puedeVer && (
                      <div className="sv-prev">
                        <p className={'sv-nota' + (rv.conEjemplo ? '' : ' aviso')}>{rv.conEjemplo ? 'Se muestra con el contenido de ejemplo que trae el archivo.' : 'No trae contenido de ejemplo: se verá vacía en la galería.'}</p>
                        <div className="sv-marco" ref={marco}>
                          <iframe sandbox="allow-scripts" title={'Vista previa de ' + i.nombre} srcDoc={conFormacion(rv.html, formUsada || formacion)} style={marcoPlantilla(esc)} />
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
              <button type="submit" className="btn" disabled={ocupado || (!categoria && !categoriaPorFicha) || !validos.length || revisando || faltaFormacion || faltaTipo}>{ocupado ? 'Subiendo ' + avance.n + ' de ' + avance.total + '…' : etiquetaSubir}</button>
            </>}
        </footer>
      </form>
    </div>
  )
}
