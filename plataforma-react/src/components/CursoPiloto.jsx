import { useCallback, useEffect, useRef, useState } from 'react'
import { api, RUTA_API } from '../lib/api.js'
import { RE_CARPETA } from '../lib/syllabus.js'
import Titulo from './Titulo.jsx'
import './curso-piloto.css'

// «Curso piloto»: analiza una carpeta de curso en Drive (Syllabus, carpetas «Guiones U…») y SIMULA qué variante HTML recibiría cada recurso y actividad.
// No guarda nada ni cambia ningún curso. El servidor trabaja en segundo plano: POST /piloto/analisis → id; GET /piloto/analisis/:id cada 2 s hasta «listo» o «error».

const MOTIVO = {
  variantes_agotadas: 'ya no quedan variantes libres de su categoría en la unidad', sin_variantes_aprobadas: 'no hay variantes aprobadas', sin_variantes_de_la_formacion: 'no hay variantes de la formación del curso',
  categoria_sin_variantes: 'la categoría no tiene variantes', categoria_no_es_de_la_formacion: 'la categoría no es de la formación del curso', categoria_inexistente: 'la categoría no existe en el catálogo de Praxia',
  categoria_sin_calificables: 'la categoría no tiene variante calificable', categoria_sin_practicas: 'la categoría no tiene variantes de práctica', falta_calificable: 'no se sabe si es la actividad calificable',
  calificable_repetida: 'variante calificable repetida (es lo normal)', variante_repetida: 'variante repetida',
  documento_sin_plantilla: 'el guion no trae el enlace de plantilla de este recurso', plantilla_no_corresponde: 'la plantilla del guion no es una variante de la categoría del recurso', plantilla_no_esta_en_praxia: 'la plantilla del guion no está subida en esta base de Praxia',
  formacion_desconocida: 'no se pudo saber la formación del curso', formato_fuera_de_catalogo: 'el formato no está en el catálogo de IDs', actividad_fuera_de_catalogo: 'la actividad no está en la hoja de actividades',
  actividad_ambigua: 'el nombre de la actividad está en varias categorías', catalogo_actividades_no_disponible: 'la hoja de actividades no se pudo leer', calificable_indeterminada: 'EVALUACIONES no identifica la actividad calificable',
  id_discrepante: 'el guion y el documento de la unidad dicen IDs distintos', codigo_repetido: 'el código se repite en el documento de la unidad', falta_documento_unidad: 'falta el documento de la unidad',
  unidad_ambigua: 'la unidad es ambigua', presentacion_no_indicada: 'el documento de la unidad no indica la presentación', fila_sin_recurso: 'la fila no dice el formato del recurso'
}
const motivoTexto = (m) => MOTIVO[m] || String(m || 'sin variante').replace(/_/g, ' ')
const ESTADO_UNIDAD = { completa: ['ok', 'Completa'], incompleta: ['warn', 'Incompleta'], ambigua: ['bad', 'Ambigua'], sin_documento_unidad: ['bad', 'Sin documento de unidad'], sin_carpeta: ['bad', 'Sin carpeta'] }
const GRAVES = new Set(['falta', 'ambiguo', 'discrepancia', 'ilegible'])
const FINALES = new Set(['listo', 'error'])
const CLAVE = 'cp-ultimo'

const Enlace = ({ d, children }) => (d && d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">{children || d.nombre}</a> : <span>{children || (d && d.nombre)}</span>)

function Problema({ p }) {
  return (
    <div className={'msg ' + (GRAVES.has(p.tipo) ? 'bad' : 'warn') + ' cp-prob'}>
      {p.unidad != null && <b>Unidad {p.unidad}: </b>}{p.mensaje}
      {p.candidatos && p.candidatos.length > 0 && <ul className="cp-cands">{p.candidatos.map((c) => <li key={c.id}><Enlace d={c} /></li>)}</ul>}
    </div>
  )
}

function Fila({ it, sangria }) {
  const v = it.variante
  const estado = it.estado === 'asignada' ? ['ok', 'Asignada'] : it.estado === 'repetida' ? ['warn', 'Repetida'] : it.estado === 'no_html' ? ['', 'No es HTML'] : ['bad', 'Sin asignar']
  const titulo = it.clase === 'actividad' ? it.nombre : it.clase === 'presentacion' ? 'Presentación de la unidad' + (it.formato ? ': ' + it.formato : '') : (it.formato || '—') + (it.titulo ? ' · ' + it.titulo : '')
  return (
    <tr className={sangria ? 'cp-act' : ''}>
      <td className="cp-cod">{it.codigo}</td>
      <td>
        <span className={sangria ? 'cp-sang' : ''}>{titulo}</span>
        {it.calificable === true && <span className="cp-etq">Calificable</span>}
        {it.detectado_en === 'guion' && <span className="cp-etq">Solo en el guion</span>}
      </td>
      <td>{it.categoria ? <><b>{it.categoria}</b>{it.id_catalogo && it.id_catalogo !== it.categoria ? <small className="cp-id"> {it.id_catalogo}</small> : null}</> : <small className="cp-id">{it.id_en_guion ? 'guion: ' + it.id_en_guion : '—'}</small>}
        {it.fuente_categoria === 'respaldo_palabras' && <small className="cp-id"> (respaldo)</small>}</td>
      <td>{v ? (v.url_ver ? <a href={RUTA_API.replace(/\/api$/, '') + v.url_ver} target="_blank" rel="noopener noreferrer">{v.plantilla}</a> : <b>{v.plantilla}</b>) : <span className="cp-nada">—</span>}
        {v && v.en_catalogo === false && <small className="cp-id"> (la indica el guion; no está en esta base)</small>}
        {v && v.revision && v.revision !== 'aprobada' && <small className="cp-id"> ({v.revision})</small>}
        {v && v.candidatas > 1 && <small className="cp-id"> {v.candidatas} candidatas</small>}</td>
      <td><span className={'cp-estado ' + estado[0]}>{estado[1]}</span>
        {it.estado === 'sin_asignar' && <small className="cp-mot">{motivoTexto(it.motivo)}{it.candidatos ? ': ' + it.candidatos.join(', ') : ''}</small>}
        {it.aviso && <small className="cp-mot">{it.aviso}</small>}</td>
    </tr>
  )
}

function Unidad({ u }) {
  const [clase, etiqueta] = ESTADO_UNIDAD[u.estado] || ['warn', u.estado]
  const items = []
  if (u.presentacion) items.push(<Fila key={u.presentacion.codigo} it={u.presentacion} />)
  const usadas = new Set()
  for (const r of u.recursos) {
    items.push(<Fila key={r.codigo} it={r} />)
    for (const a of u.actividades.filter((x) => x.recurso_codigo === r.codigo)) { usadas.add(a.codigo); items.push(<Fila key={a.codigo} it={a} sangria />) }
  }
  for (const a of u.actividades) if (!usadas.has(a.codigo)) items.push(<Fila key={a.codigo} it={a} sangria />)
  const c = u.conteo
  return (
    <details className="cp-unidad" open={u.problemas.length > 0}>
      <summary>
        <span className="cp-n">{u.numero}</span>
        <span className="cp-tit"><b>{u.nombre || 'Unidad ' + u.numero}</b>{!u.en_syllabus && <small> · no está en el Syllabus</small>}</span>
        <span className={'cp-estado ' + clase}>{etiqueta}</span>
        {c && <small className="cp-cuenta">{c.recursos} recursos · {c.actividades} actividades · {c.asignadas + c.repetidas} con variante</small>}
      </summary>
      <div className="cp-enlaces">
        {u.carpeta && <span>Carpeta: <Enlace d={u.carpeta} /></span>}
        {u.documento_unidad && <span>Documento de unidad: <Enlace d={u.documento_unidad} />{u.documento_unidad.origen === 'raiz' ? ' (en la raíz)' : ''}</span>}
      </div>
      {u.guiones.length > 0 && <ul className="cp-guiones">{u.guiones.map((g) => <li key={g.id}>Tema {g.tema}: <Enlace d={g} /></li>)}</ul>}
      {u.problemas.map((p, i) => <Problema key={i} p={p} />)}
      {u.avisos && u.avisos.map((a, i) => <div key={i} className="msg info cp-prob">{a}</div>)}
      {items.length > 0 && (
        <div className="cp-tabla">
          <table>
            <thead><tr><th>Código</th><th>Recurso / actividad</th><th>Categoría (ID)</th><th>Variante</th><th>Estado</th></tr></thead>
            <tbody>{items}</tbody>
          </table>
        </div>
      )}
    </details>
  )
}

export default function CursoPiloto({ onInicio, onMontar }) {
  const [url, setUrl] = useState('')
  const [id, setId] = useState(null)
  const [dato, setDato] = useState(null)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [montando, setMontando] = useState('')
  const p1 = !!id // la carpeta ya se indicó
  const vivo = useRef(true)
  // vivo se vuelve a poner en true al montar: en desarrollo (StrictMode) React monta, desmonta y vuelve a montar, y sin esto el sondeo quedaba mudo en «En cola».
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  const olvidar = () => { try { sessionStorage.removeItem(CLAVE) } catch { /* sin almacenamiento */ } }
  // Al volver a la pantalla se recupera el último análisis (si el servidor aún lo guarda).
  useEffect(() => {
    let ult = null
    try { ult = sessionStorage.getItem(CLAVE) } catch { /* sin almacenamiento */ }
    if (!ult) return
    api('GET', '/piloto/analisis/' + encodeURIComponent(ult)).then((d) => { if (vivo.current) { setId(ult); setDato(d) } }).catch(() => olvidar())
  }, [])

  // Sondeo cada 2 s mientras no termine; se detiene al desmontar o al terminar.
  const estado = dato && dato.estado
  useEffect(() => {
    if (!id || (estado && FINALES.has(estado))) return undefined
    const t = setTimeout(async () => {
      try { const d = await api('GET', '/piloto/analisis/' + encodeURIComponent(id)); if (vivo.current) setDato(d) } catch (e) { if (vivo.current) { setError(e.message); setId(null); setDato(null); olvidar() } }
    }, 2000)
    return () => clearTimeout(t)
  }, [id, estado, dato])

  const valida = RE_CARPETA.test(url.trim())
  const enCurso = enviando || (!!id && !(dato && FINALES.has(dato.estado)))
  const analizar = async (e) => {
    e.preventDefault()
    if (!valida || enCurso) return
    setError(''); setDato(null); setEnviando(true)
    try {
      const r = await api('POST', '/piloto/analisis', { carpeta_url: url.trim() })
      setId(r.id); setDato({ estado: 'en_cola', avance: { paso: 'En cola', hechos: 0, total: 0 } })
      try { sessionStorage.setItem(CLAVE, r.id) } catch { /* sin almacenamiento */ }
    } catch (err) { setError(err.message) } finally { setEnviando(false) }
  }
  const otra = useCallback(() => {
    if (id) api('DELETE', '/piloto/analisis/' + encodeURIComponent(id)).catch(() => {})
    olvidar(); setId(null); setDato(null); setError(''); setUrl('')
  }, [id])
  const descargar = () => {
    const blob = new Blob([JSON.stringify(dato.resultado, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'curso-piloto.json'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const r = dato && dato.estado === 'listo' ? dato.resultado : null
  const av = dato && dato.avance
  const leyendo = !!dato && !FINALES.has(dato.estado)
  const fallo = !!dato && dato.estado === 'error'
  const p1ok = !!id && !fallo // la carpeta ya se indicó y se está leyendo o ya se leyó
  const p2ok = !!r
  const pct = av && av.total ? Math.min(100, Math.round((av.hechos / av.total) * 100)) : 8
  const conVariante = r ? r.resumen.asignadas + r.resumen.repetidas : 0

  // Mismo camino que «Tengo los guiones · me faltan los recursos»: se crea el curso con las unidades ya aprobadas y los guiones cargados, y se sigue en
  // el flujo normal (Syllabus → Unidades → Guiones → Matrices y H5P).
  const syl = r && r.syllabus.estado === 'encontrado' ? r.syllabus.documento : null
  const unis = r ? r.unidades.filter((u) => u.documento_unidad && u.guiones.length) : []
  const puedeMontar = p2ok && !!syl && unis.length > 0
  const montar = () => {
    if (!puedeMontar || montando) return
    setError('')
    const documentos = unis.map((u) => ({ unidad: u.numero, nombre: u.nombre || 'Unidad ' + u.numero, url: u.documento_unidad.url, aprobado: true, visto: true }))
    // Los guiones se registran como los deja el flujo de n8n al generarlos (archivos con su contenido por recurso), pendientes de revisar y aprobar.
    const guionesUnidad = {}
    for (const u of unis) {
      const archivos = u.guiones.slice().sort((a, b) => (a.tema ?? 99) - (b.tema ?? 99)).map((g) => {
        const e = g.estructurado || {}
        const t = (u.temas || []).find((x) => x.numero === g.tema)
        return { id: g.id, nombre: g.nombre, url: g.url, tema: g.tema, nombre_tema: t ? t.nombre : '', info: e.info || {}, guion: { presentacion: e.presentacion || null, recursos: e.recursos || [] }, advertencias: [], aprobado: false, visto: false }
      })
      guionesUnidad[u.numero] = { fecha: Date.now(), archivos }
    }
    setMontando('Montando el curso…')
    onMontar({ programa: '', curso: syl.nombre || r.carpeta.nombre || 'Curso piloto', syllabusUrl: syl.url, carpetaUrl: r.carpeta.url, documentos, guionesUnidad }, 'unidades', null)
  }

  const bola = (ok, act, n) => <span className={'ps-bola' + (ok ? ' ok' : act ? ' act' : '')}>{ok ? '✓' : n}</span>
  const icono = <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  const siguiente = !p1ok ? 'Pegue el enlace de la carpeta raíz del curso y pulse «Leer la carpeta».'
    : fallo ? 'No se pudo leer la carpeta. Revise que esté compartida con cualquier persona con el enlace.'
    : !p2ok ? 'Se están leyendo el Syllabus, las unidades y los guiones. Espere un momento.'
    : !puedeMontar ? 'Falta el Syllabus o ninguna unidad tiene a la vez su documento y sus guiones.'
    : 'Todo está listo. Pulse «Montar el curso».'
  const items = [['Carpeta indicada', p1ok, !p1ok], ['Carpeta leída', p2ok, p1ok && !p2ok && !fallo], ['Curso montado', false, puedeMontar]]

  return (
    <div className="wrapx fade cp">
      <div className="crumbs"><button className="lnk" onClick={onInicio}>Dashboard</button> › <b>Curso piloto</b></div>
      <Titulo icono="curso">
        <h1>Curso piloto</h1>
        <p className="lead">Pegue la carpeta raíz del curso en Drive: con su Syllabus, los documentos de unidad y los guiones. Se monta el curso y sigue el flujo normal: Unidades → Guiones → Matrices y H5P.</p>
      </Titulo>

      <div className="portal ps-portal">
        <div className="ps-col">

          <section className={'card ps-paso' + (p1ok ? ' hecho' : ' activo')} aria-labelledby="cp-t1">
            <div className="ps-cab">
              {bola(p1ok, !p1ok, 1)}
              <div className="ps-tit">
                <h2 id="cp-t1">Carpeta del curso</h2>
                {p1ok && <small>{(r && r.carpeta.nombre) || 'Carpeta indicada'}</small>}
              </div>
              {p1ok && !leyendo && !montando && <button className="btn sec sm" type="button" onClick={otra}>Cambiar</button>}
            </div>
            {!p1ok && (
              <form onSubmit={analizar} noValidate>
                <p className="card-copy">Allí debe estar el Syllabus y una carpeta «Guiones U1», «Guiones U2»… por unidad, con los guiones y el documento de la unidad.</p>
                <div className="ps-campos">
                  <div>
                    <label htmlFor="cp-url">URL de la carpeta raíz</label>
                    <div className="input-wrap">
                      <svg className="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
                      <input id="cp-url" type="url" placeholder="https://drive.google.com/drive/folders/..." autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} disabled={enCurso} />
                    </div>
                    <p className="hint">{url.trim() && !valida ? <b style={{ color: '#b73d32' }}>Pegue el enlace de una carpeta de Google Drive.</b> : 'La carpeta y sus documentos deben estar compartidos como «Cualquier persona con el enlace» (lector).'}</p>
                  </div>
                </div>
                {error && <div className="msg bad" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
                <button className="submit" type="submit" disabled={!valida || enCurso}>{icono}<span>{enCurso ? 'Leyendo…' : 'Leer la carpeta'}</span></button>
              </form>
            )}
          </section>

          <section className={'card ps-paso' + (p2ok ? ' hecho' : p1ok && !fallo ? ' activo' : ' espera')} aria-label="Lectura de la carpeta">
            <div className="ps-cab">
              {bola(p2ok, p1ok && !p2ok && !fallo, 2)}
              <div className="ps-tit">
                <h2>Unidades y guiones</h2>
                <small>{!p1ok ? 'Se lee sola cuando indique la carpeta.' : fallo ? 'No se pudo leer' : p2ok ? r.resumen.unidades_encontradas + ' de ' + r.resumen.unidades_syllabus + ' unidades · ' + r.resumen.guiones + ' guiones' : (av && av.paso) || 'En cola'}</small>
              </div>
            </div>
            {leyendo && (
              <div className="cp-avance" role="status" aria-live="polite">
                <div className="cp-barra" aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
                {av && av.total > 0 && <small>{av.hechos} de {av.total} documentos</small>}
              </div>
            )}
            {fallo && (
              <div className="msg bad" role="alert" style={{ marginTop: 12 }}>{dato.error || 'No se pudo analizar la carpeta.'}{' '}
                <button className="btn sec sm" type="button" onClick={otra}>Probar otra carpeta</button></div>
            )}
            {r && (
              <>
                <div className="cp-avisos">
                  {r.formacion.valor && <div className="msg ok">Formación del curso: <b>{r.formacion.texto || r.formacion.valor}</b> (según {r.formacion.fuente === 'syllabus' ? 'el Syllabus' : 'los documentos de unidad'}).</div>}
                  {r.problemas.map((p, i) => <Problema key={i} p={p} />)}
                </div>
                <div className="cp-lista">
                  {r.unidades.map((u) => {
                    const [clase, etiqueta] = ESTADO_UNIDAD[u.estado] || ['warn', u.estado]
                    return (
                      <div className={'cp-fila-u ' + clase} key={u.numero}>
                        <span className={'cp-bola ' + clase}>{u.estado === 'completa' ? '✓' : u.numero}</span>
                        <div className="cp-fu-tx"><b>Unidad {u.numero}{u.nombre ? ' · ' + u.nombre : ''}</b>
                          <small>{u.guiones.length} {u.guiones.length === 1 ? 'guion' : 'guiones'}{u.conteo ? ' · ' + u.conteo.recursos + ' recursos · ' + u.conteo.actividades + ' actividades' : ''}{u.documento_unidad ? '' : ' · falta el documento de la unidad'}</small></div>
                        <span className={'cp-estado ' + clase}>{etiqueta}</span>
                      </div>
                    )
                  })}
                </div>
                <details className="cp-dif cp-sim"><summary>Ver cómo se asignarían las variantes (simulación · {conVariante} con variante, {r.resumen.sin_asignar} sin asignar)</summary>
                  <div className="cp-unidades">{r.unidades.map((u) => <Unidad key={u.numero} u={u} />)}</div>
                  <ul>{r.diferencias_con_sistema_real.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  <div className="row cp-pie"><button className="btn sec sm" type="button" onClick={descargar}>Descargar resumen (JSON)</button></div>
                </details>
              </>
            )}
          </section>

          <section className={'card ps-paso' + (puedeMontar ? ' activo' : ' espera')} aria-label="Montar el curso">
            <div className="ps-cab">
              {bola(false, puedeMontar, 3)}
              <div className="ps-tit">
                <h2>Montar el curso</h2>
                <small>{puedeMontar ? 'Se crea con estas unidades y guiones y sigue en «Guiones»' : 'Se activa cuando termine la lectura'}</small>
              </div>
            </div>
            {puedeMontar && (
              <>
                <p className="card-copy">Las unidades quedan aprobadas y los guiones cargados para revisarlos. Después siguen las matrices y los recursos H5P, igual que en cualquier curso.</p>
                {error && <div className="msg bad" role="alert" style={{ marginTop: 14 }}>{error}</div>}
                <button className="submit" style={{ marginTop: 16 }} type="button" disabled={!!montando} onClick={montar}>{icono}<span>{montando || 'Montar el curso'}</span></button>
              </>
            )}
          </section>
        </div>

        <aside className="ps-lado" aria-label="Qué sigue">
          <small>Qué sigue</small>
          <p>{siguiente}</p>
          <ul>
            {items.map(([t, ok, act]) => <li key={t} className={ok ? 'ok' : act ? 'act' : ''}><span>{ok ? '✓' : ''}</span>{t}</li>)}
          </ul>
          <em>Hasta que pulse «Montar el curso» no se crea nada en Praxia.</em>
        </aside>
      </div>
    </div>
  )
}
