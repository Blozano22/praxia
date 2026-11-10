import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import EnlaceDoc from './EnlaceDoc.jsx'
import { mensajeDeError } from '../lib/syllabus.js'
import { descartarError, iniciarGuiones, useTrabajoGuiones } from '../lib/trabajosGuiones.js'
import { guionAPendiente } from '../lib/guionJson.js'

function Contenido({ a }) {
  const g = a.guion || {}
  const rs = [g.presentacion, ...(g.recursos || [])].filter(Boolean)
  if (!rs.length) return <p className="help">Este guion no trae recursos.</p>
  return (
    <div>
      {rs.map((r, i) => (
        <div key={i} style={{ margin: '8px 0 12px' }}>
          <div className="row"><span className="tipo">{r.id}</span><span className="pill">{r.formato}</span></div>
          <b>{r.titulo}</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: '.9rem' }}>
            {(r.contenido || []).map((c, k) => <li key={k}><b>{c.rotulo}</b>{c.rotulo ? ': ' : ''}{c.texto}</li>)}
          </ul>
          {r.actividad && <p className="help" style={{ margin: '4px 0 0' }}><b>Actividad: </b>{typeof r.actividad === 'string' ? r.actividad : JSON.stringify(r.actividad)}</p>}
        </div>
      ))}
    </div>
  )
}

function Ico({ d, s = 15 }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
}
const I_CARPETA = <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
const I_CAPAS = <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>
const I_RELOJ = <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
const I_VISTO = <path d="M5 12.5l4.5 4.5L19 7.5" />
const I_FLECHA = <path d="M6 9l6 6 6-6" />
const I_BLANCO = <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" /></>

function Guion({ a, n, activo, abierto, onAlternar, onVisto, onAprobar, onDesaprobar }) {
  const bloqueado = !a.aprobado && !activo
  const resumen = (() => { try { return guionAPendiente(a).recursos.length } catch (e) { return 0 } })()
  const estado = a.aprobado ? ['ok', I_VISTO, 'Aprobado'] : activo ? ['warn', I_RELOJ, 'En revisión'] : ['', I_RELOJ, 'Pendiente']
  const titulo = a.nombre_tema ? a.nombre_tema : (a.tema != null ? 'Tema ' + a.tema : a.nombre)
  return (
    <article className={'gu-it' + (a.aprobado ? ' aprobado' : '') + (activo ? ' activo' : '') + (bloqueado ? ' bloq' : '') + (abierto ? ' abierto' : '')}>
      <button type="button" className="gu-it-cab" aria-expanded={abierto} onClick={onAlternar}>
        <span className="gu-it-n" aria-hidden="true">{a.aprobado ? <Ico d={I_VISTO} s={18} /> : (a.tema != null ? a.tema : n)}</span>
        <span className="gu-it-tit">
          <b>{titulo}</b>
          <span className="gu-it-meta">
            <span className="gu-mini"><Ico d={I_CARPETA} s={13} />{a.nombre}</span>
            <span className="gu-mini"><Ico d={I_CAPAS} s={13} />{resumen} recursos</span>
          </span>
        </span>
        <span className={'gu-est ' + estado[0]}><Ico d={estado[1]} s={15} />{estado[2]}</span>
        <span className="gu-chev" aria-hidden="true"><Ico d={I_FLECHA} s={20} /></span>
      </button>
      {abierto && (
        <div className={'gu-it-cu' + (activo ? ' con-acc' : '')}>
          <div className="gu-it-izq">
            {a.url && <EnlaceDoc compacto titulo={'Guion ' + (a.tema != null ? 'del tema ' + a.tema : a.nombre)} url={a.url} onVisto={activo ? onVisto : undefined} />}
            {a.advertencias.length > 0 && (
              <details className="dt">
                <summary>Notas del generador ({a.advertencias.length}) · solo informativas</summary>
                <p className="help" style={{ margin: '4px 0' }}>Observaciones que dejó n8n al escribir el guion. No cambian el guion ni bloquean nada: los recursos se crean tal como está.</p>
                {a.advertencias.map((t, k) => <div key={k} className="msg info" style={{ margin: '4px 0', padding: '6px 10px' }}>{t}</div>)}
              </details>
            )}
            {!bloqueado && (
              <details className="dt" onToggle={(e) => { if (e.target.open && activo) onVisto() }}>
                <summary>Ver el contenido del guion</summary>
                {a.guion ? <Contenido a={a} /> : <p className="help">n8n no envió el contenido de este guion; ábralo en Drive.</p>}
              </details>
            )}
            {(a.aprobado || bloqueado) && (
              <div className="dr-pie">
                {a.aprobado && <button className="btn sec sm" onClick={onDesaprobar}>Quitar aprobación</button>}
                {bloqueado && <span className="help">Se habilita cuando apruebe el guion anterior.</span>}
              </div>
            )}
          </div>
          {activo && (
            <aside className="gu-acc">
              <h4><Ico d={I_BLANCO} s={17} />Siguiente acción</h4>
              <ol>
                <li><i>1</i><p><b>Revíselo.</b> Abra la vista previa o el documento en Drive, o despliegue «Ver el contenido del guion».</p></li>
                <li><i>2</i><p><b>Apruébelo.</b> Si está bien, apruébelo para pasar al siguiente.</p></li>
              </ol>
              <button className="btn gold" disabled={!a.visto} onClick={onAprobar}><Ico d={I_VISTO} s={18} />Aprobar este guion</button>
              {!a.visto && <p className="help">Se habilita después de abrir el contenido o el documento.</p>}
            </aside>
          )}
        </div>
      )}
    </article>
  )
}

// Segundos transcurridos desde que empezó la generación (para que se vea que sigue trabajando).
function useSegundos(desde, activo) {
  const [, tic] = useState(0)
  useEffect(() => { if (!activo) return; const i = setInterval(() => tic((n) => n + 1), 1000); return () => clearInterval(i) }, [activo])
  const t = activo && desde ? Math.max(0, Math.floor((Date.now() - desde) / 1000)) : 0
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0')
}

// «Creemos los guiones»: n8n escribe un guion por tema a partir del documento de la unidad; se revisan, se aprueban
// uno por uno y entonces se habilita «Crear los recursos».
export default function Guiones({ s, unidad, doc, onCambio, onCrear }) {
  const [error, setError] = useState('')
  const data = (s.guionesUnidad || {})[unidad]
  const archivos = (data && data.archivos) || []
  const aprobados = archivos.filter((a) => a.aprobado).length
  const activoIdx = archivos.findIndex((a) => !a.aprobado)
  const sinContenido = archivos.filter((a) => !a.guion).length
  const todos = archivos.length > 0 && aprobados === archivos.length && sinContenido === 0
  const poner = (nuevos) => onCambio({ ...s, guionesUnidad: { ...(s.guionesUnidad || {}), [unidad]: { ...(data || {}), fecha: (data && data.fecha) || Date.now(), archivos: nuevos } } })
  const cambiar = (i, c) => poner(archivos.map((a, k) => (k === i ? { ...a, ...c } : a)))

  // Syllabus creados antes de guardar su lectura de bibliografía: se elige aquí cuál es (sin volver a crear las unidades).
  const [lecturas, setLecturas] = useState(null)
  const proponerLecturas = async () => {
    try {
      const l = (await api('GET', '/bibliografia/trabajos')).filter((x) => x.estado === 'listo')
      const cerca = (x) => Math.abs(new Date(x.creado).getTime() - (s.creado || 0))
      const mejor = l.slice().sort((a, b) => cerca(a) - cerca(b))[0]
      setLecturas(l.map((x) => ({ ...x, sugerida: mejor && x.id === mejor.id })))
    } catch (e) { setError(e.message || 'No se pudieron cargar las lecturas de bibliografía.') }
  }

  // La generación vive fuera de este componente (lib/trabajosGuiones): sigue aunque se salga de la unidad y no se puede lanzar dos veces.
  const trabajo = useTrabajoGuiones(s.id, unidad)
  const cargando = trabajo.generando
  const segundos = useSegundos(trabajo.desde, cargando)
  const e = trabajo.error
  useEffect(() => {
    if (!e) return
    if (e.code === 'SIN_BIBLIOGRAFIA' && trabajo.sinBib) proponerLecturas()
    else setError(e.code === 'SIN_GUIONES' ? 'El flujo terminó, pero no devolvió guiones. Revise el documento de la unidad (que tenga temas) y la carpeta de Drive.' : mensajeDeError(e))
    descartarError(s.id, unidad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e])

  const generar = (bibId) => {
    if (cargando) return
    const idBib = typeof bibId === 'string' ? bibId : s.bibliografiaId
    if (data && archivos.length && !confirm('Ya hay guiones generados para esta unidad. ¿Generar de nuevo? Se perderán las aprobaciones.')) return
    setError(''); setLecturas(null)
    iniciarGuiones({ id: s.id, unidad, bibliografiaId: idBib, params: { unidadUrl: doc.url, syllabusUrl: s.syllabusUrl, bibliografiaId: idBib, unidad: doc.unidad || unidad } })
  }

  const [abierto, setAbierto] = useState(null)
  const efectivo = abierto === null ? activoIdx : abierto

  return (
    <section className={'card guiones gu-hero' + (archivos.length ? ' gu-con' : '')} style={{ margin: '14px 0' }}>
      {archivos.length > 0 && (
        <div className="gu-banda">
          <svg className="gu-banda-ilus" viewBox="0 0 120 100" aria-hidden="true">
            <path d="M14 58C4 34 22 10 52 8C86 6 112 26 108 58C104 86 66 98 38 90C26 86 18 74 14 58Z" fill="#dff5e8" />
            <g transform="rotate(-6 54 49)">
              <rect x="26" y="14" width="56" height="70" rx="8" fill="#fff" stroke="#d3dcea" strokeWidth="2" />
              <rect x="34" y="26" width="38" height="5" rx="2.5" fill="#cfd8e6" /><rect x="34" y="38" width="30" height="5" rx="2.5" fill="#cfd8e6" /><rect x="34" y="50" width="34" height="5" rx="2.5" fill="#cfd8e6" />
            </g>
            <path d="M10 50l16 6-4 26-14-8z" fill="#7fd4a6" />
            <circle cx="84" cy="74" r="17" fill="#2da56a" /><path d="M76 74l6 6 11-12" stroke="#fff" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="gu-tx">
            <span className="tipo">Paso 1 de la unidad</span>
            <h3>Creemos los guiones</h3>
            <p className="help">n8n lee el documento de la unidad y escribe un guion por cada tema. Los revisa y los aprueba uno por uno.</p>
          </div>
          <div className="gu-prog">
            <b>{aprobados} de {archivos.length} aprobados</b>
            <div className="gu-prog-fila"><div className="bar"><i style={{ width: (aprobados / archivos.length * 100) + '%' }} /></div><span>{Math.round(aprobados / archivos.length * 100)}%</span></div>
          </div>
        </div>
      )}
      {!archivos.length && <div className="gu-cab">
        <div className="gu-tx">
          <span className="tipo">Paso 1 de la unidad</span>
          <h3>Creemos los guiones</h3>
          <p className="help">n8n lee el documento de la unidad y escribe un guion por cada tema. Los revisa y los aprueba uno por uno.</p>
          {!archivos.length && (
            <ul className="gu-chips">
              <li className={'gu-chip' + (cargando ? ' on' : doc && doc.url ? ' ok' : '')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
                {cargando ? 'Generando…' : doc && doc.url ? 'Listo para iniciar' : 'Falta el enlace'}
              </li>
              <li className="gu-chip">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>
                Un guion por cada tema
              </li>
              <li className="gu-chip">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8 16.5l8-9M18 8.5v7" /></svg>
                Automatizado por n8n
              </li>
            </ul>
          )}
        </div>
        {!archivos.length && (
          <svg className="gu-ilus" viewBox="24 12 360 312" aria-hidden="true">
            <defs>
              <linearGradient id="gu-gv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e9f9ee" /><stop offset="1" stopColor="#cdeedb" /></linearGradient>
              <linearGradient id="gu-gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f4fdf7" /><stop offset="1" stopColor="#d6f3e2" /></linearGradient>
              <linearGradient id="gu-gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#eef3fa" /><stop offset="1" stopColor="#dde6f2" /></linearGradient>
              <filter id="gu-sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#13235b" floodOpacity=".18" /></filter>
              <filter id="gu-sh2" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0a6b5c" floodOpacity=".22" /></filter>
            </defs>
            <path d="M62 168C34 112 66 52 126 38C178 26 214 8 262 30C318 54 372 76 372 140C372 206 336 262 266 296C206 326 120 318 84 268C74 254 68 212 62 168Z" fill="url(#gu-gv)" />
            <g transform="rotate(-4 200 190)">
              <rect x="116" y="50" width="176" height="244" rx="18" fill="#dbe5f1" transform="translate(10 12)" />
              <rect x="116" y="50" width="176" height="244" rx="18" fill="#fff" stroke="#e3eaf3" filter="url(#gu-sh)" />
              <rect x="132" y="68" width="144" height="112" rx="12" fill="url(#gu-gp)" />
              <circle cx="150" cy="82" r="3" fill="#c3d0e2" /><circle cx="161" cy="82" r="3" fill="#c3d0e2" />
              <g transform="translate(166 100)">
                <rect x="0" y="22" width="84" height="50" rx="6" fill="#fff" stroke="#13235b" strokeWidth="3.5" />
                <g transform="rotate(-14 2 22)">
                  <rect x="0" y="6" width="84" height="15" rx="4" fill="#13235b" />
                  <path d="M12 6l-8 15M32 6l-8 15M52 6l-8 15M72 6l-8 15" stroke="#fff" strokeWidth="5" />
                </g>
                <path d="M34 36l22 12-22 12z" fill="#13235b" stroke="#13235b" strokeWidth="3" strokeLinejoin="round" />
              </g>
              <rect x="132" y="200" width="104" height="8" rx="4" fill="#d3dcea" />
              <rect x="132" y="219" width="80" height="8" rx="4" fill="#d3dcea" />
              <rect x="132" y="238" width="92" height="8" rx="4" fill="#d3dcea" />
              <rect x="132" y="257" width="56" height="8" rx="4" fill="#d3dcea" />
            </g>
            <g transform="rotate(5 322 208)" filter="url(#gu-sh2)">
              <rect x="262" y="132" width="120" height="152" rx="16" fill="url(#gu-gc)" stroke="#b6e3c9" strokeWidth="1.5" />
              <g fill="#2da56a">
                <circle cx="288" cy="170" r="10" /><circle cx="288" cy="208" r="10" /><circle cx="288" cy="246" r="10" />
                <rect x="306" y="166" width="58" height="8" rx="4" /><rect x="306" y="204" width="58" height="8" rx="4" /><rect x="306" y="242" width="46" height="8" rx="4" />
              </g>
              <g fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M283 170l4 4 7-8" /><path d="M283 208l4 4 7-8" /><path d="M283 246l4 4 7-8" />
              </g>
            </g>
            <g filter="url(#gu-sh2)">
              <rect x="34" y="176" width="92" height="84" rx="18" fill="#fff" stroke="#b6e3c9" strokeWidth="1.5" />
              <path d="M54 232l22-22 22-14" fill="none" stroke="#0a6b5c" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" transform="translate(-2 -2)" />
              <circle cx="52" cy="232" r="8" fill="#fff" stroke="#0a6b5c" strokeWidth="4" />
              <circle cx="76" cy="208" r="5" fill="#0a6b5c" />
              <circle cx="102" cy="194" r="9" fill="#fff" stroke="#0a6b5c" strokeWidth="4" />
            </g>
            <path d="M80 176C80 140 84 118 108 108" fill="none" stroke="#2da56a" strokeWidth="4" strokeLinecap="round" />
            <path d="M100 99l10 8-12 6" fill="none" stroke="#2da56a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <g stroke="#d7ff1e" strokeWidth="5" strokeLinecap="round"><path d="M330 28l6 14" /><path d="M352 38l12 10" /><path d="M366 64l14 4" /></g>
          </svg>
        )}
      </div>}

      {!archivos.length && !cargando && (
        <div style={{ marginTop: 18 }}>
          {doc && doc.url ? <button className="btn gold gu-ir" onClick={() => generar()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg>Crear los guiones de la Unidad {unidad}</button>
            : <div className="msg warn">Esta unidad no tiene enlace del documento: agréguelo en el paso 1 para poder crear sus guiones.</div>}
        </div>
      )}
      {cargando && (
        <div className="msg info gv-generando" role="status" aria-live="polite" style={{ marginTop: 10 }}>
          <span className="gv-spin" aria-hidden="true" />
          <div><b>Generando los guiones de la Unidad {unidad}… ({segundos}) </b>n8n está leyendo la unidad y escribiendo un guion por tema. Puede tardar varios minutos. Puede salir de esta unidad: seguirá trabajando y no hace falta pulsar de nuevo.</div>
        </div>
      )}
      {error && <div className="msg warn" style={{ marginTop: 10 }}>{error} <button className="btn sec sm" onClick={() => generar()}>Reintentar</button></div>}
      {lecturas && (
        <div className="msg warn gv-vincular" style={{ marginTop: 10 }} role="status">
          <b>Falta enlazar la bibliografía de este syllabus.</b>
          <p style={{ margin: '4px 0 10px' }}>Este syllabus se creó antes de guardar qué lectura de bibliografía le corresponde. Elija la suya: los guiones se escribirán con las fuentes de esa lectura. No se vuelven a crear las unidades.</p>
          {lecturas.length === 0 && <p>No hay lecturas de bibliografía completas. Léala primero en «Bibliografía».</p>}
          <ul>
            {lecturas.map((l) => (
              <li key={l.id}>
                <span><b>{new Date(l.creado).toLocaleString()}</b> · {l.total} fuentes{l.sugerida && <em className="gv-sug">Sugerida: la más cercana a la creación de este syllabus</em>}</span>
                <button className="btn sm" onClick={() => { onCambio({ ...s, bibliografiaId: l.id }); generar(l.id) }}>Usar esta lectura</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sinContenido > 0 && (
        <div className="msg warn" style={{ marginTop: 10 }}>
          <b>n8n no envió el contenido de {sinContenido === archivos.length ? 'los guiones' : sinContenido + ' guion(es)'}. </b>
          Sin el texto no se pueden crear los recursos. En n8n revise que el último nodo antes de «Responder JSON4» sea «preparar-respuesta-con-enlaces2-guiones» (el de este proyecto) y que no haya otro nodo en medio ni nodos desconectados. Luego pulse «Generar de nuevo».
        </div>
      )}

      {archivos.length > 0 && (
        <>
          <div className="docs" style={{ marginTop: 10 }}>
            {archivos.map((a, i) => (
              <Guion key={a.nombre + i} a={a} n={i + 1} activo={i === activoIdx} abierto={i === efectivo}
                onAlternar={() => setAbierto(i === efectivo ? -2 : i)}
                onVisto={() => { if (!a.visto) cambiar(i, { visto: true }) }}
                onAprobar={() => cambiar(i, { aprobado: true, visto: true })}
                onDesaprobar={() => cambiar(i, { aprobado: false })} />
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            {!todos && sinContenido === 0 && <span className="help">Faltan {archivos.length - aprobados} guion{archivos.length - aprobados === 1 ? '' : 'es'} por aprobar.</span>}
            {todos && <span className="pill ok">✔ Todos los guiones de la unidad están aprobados</span>}
            <button className="btn sec sm" disabled={cargando} onClick={() => generar()}>Generar de nuevo</button>
          </div>
        </>
      )}
    </section>
  )
}
