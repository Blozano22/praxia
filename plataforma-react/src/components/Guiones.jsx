import { useState } from 'react'
import { generarGuiones, mensajeDeError } from '../lib/syllabus.js'
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

function Guion({ a, activo, onVisto, onAprobar, onDesaprobar }) {
  const bloqueado = !a.aprobado && !activo
  const resumen = (() => { try { return guionAPendiente(a).recursos.length } catch (e) { return 0 } })()
  return (
    <article className={'card doc' + (a.aprobado ? ' aprobado' : '') + (activo ? ' activo' : '') + (bloqueado ? ' bloq' : '')}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{a.nombre_tema ? a.nombre_tema : (a.tema != null ? 'Tema ' + a.tema : a.nombre)}</b>
        {a.aprobado ? <span className="pill ok">✔ Aprobado</span> : activo ? <span className="pill warn">En revisión</span> : <span className="pill">Pendiente</span>}
      </div>
      <div className="row"><span className="pill">{a.nombre}</span><span className="pill">{resumen} recursos</span></div>
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
      {activo && (
        <div className="paso-rev">
          <p><b>1.</b> Revise el contenido del guion{a.url ? ' (también puede abrirlo en Drive)' : ''}.</p>
          <div className="row">{a.url && <a className="btn sec sm" style={{ textDecoration: 'none' }} href={a.url} target="_blank" rel="noopener noreferrer" onClick={onVisto}>Abrir en Drive</a>}</div>
          <p style={{ marginTop: 10 }}><b>2.</b> Si está bien, apruébelo para pasar al siguiente.</p>
          <button className="btn gold sm" disabled={!a.visto} onClick={onAprobar}>Aprobar este guion</button>
          {!a.visto && <p className="help">Se habilita después de abrir el contenido o el documento.</p>}
        </div>
      )}
      {a.aprobado && <div className="row"><button className="btn sec sm" onClick={onDesaprobar}>Quitar aprobación</button></div>}
      {bloqueado && <p className="help">Se habilita cuando apruebe el guion anterior.</p>}
    </article>
  )
}

// «Creemos los guiones»: n8n escribe un guion por tema a partir del documento de la unidad; se revisan, se aprueban
// uno por uno y entonces se habilita «Crear los recursos».
export default function Guiones({ s, unidad, doc, onCambio, onCrear }) {
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const data = (s.guionesUnidad || {})[unidad]
  const archivos = (data && data.archivos) || []
  const aprobados = archivos.filter((a) => a.aprobado).length
  const activoIdx = archivos.findIndex((a) => !a.aprobado)
  const sinContenido = archivos.filter((a) => !a.guion).length
  const todos = archivos.length > 0 && aprobados === archivos.length && sinContenido === 0
  const poner = (nuevos) => onCambio({ ...s, guionesUnidad: { ...(s.guionesUnidad || {}), [unidad]: { ...(data || {}), fecha: (data && data.fecha) || Date.now(), archivos: nuevos } } })
  const cambiar = (i, c) => poner(archivos.map((a, k) => (k === i ? { ...a, ...c } : a)))

  const generar = async () => {
    if (data && archivos.length && !confirm('Ya hay guiones generados para esta unidad. ¿Generar de nuevo? Se perderán las aprobaciones.')) return
    setCargando(true); setError('')
    try {
      const nuevos = await generarGuiones({ unidadUrl: doc.url, syllabusUrl: s.syllabusUrl })
      onCambio({ ...s, guionesUnidad: { ...(s.guionesUnidad || {}), [unidad]: { fecha: Date.now(), archivos: nuevos.map((a) => ({ ...a, aprobado: false, visto: false })) } } })
    } catch (e) {
      setError(e.code === 'SIN_GUIONES' ? 'El flujo terminó, pero no devolvió guiones. Revise el documento de la unidad (que tenga temas) y la carpeta de Drive.' : mensajeDeError(e))
    }
    setCargando(false)
  }

  return (
    <section className="card guiones" style={{ margin: '14px 0' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <span className="tipo">Paso 1 de la unidad</span>
          <h3 style={{ margin: '2px 0' }}>Creemos los guiones</h3>
          <p className="help" style={{ margin: 0 }}>n8n lee el documento de la unidad y escribe un guion por cada tema. Los revisa y los aprueba uno por uno; al terminar se habilita «Crear los recursos».</p>
        </div>
        {archivos.length > 0 && <div style={{ minWidth: 170 }}><b>{aprobados} de {archivos.length} aprobados</b><div className="bar" style={{ marginTop: 6 }}><i style={{ width: (aprobados / archivos.length * 100) + '%' }} /></div></div>}
      </div>

      {!archivos.length && !cargando && (
        <div style={{ marginTop: 10 }}>
          {doc && doc.url ? <button className="btn gold" onClick={generar}>Crear los guiones de la Unidad {unidad}</button>
            : <div className="msg warn">Esta unidad no tiene enlace del documento: agréguelo en el paso 1 para poder crear sus guiones.</div>}
        </div>
      )}
      {cargando && <div className="msg info" style={{ marginTop: 10 }}><b>Escribiendo los guiones… </b>n8n está leyendo la unidad y generando un guion por tema. Puede tardar varios minutos; no cierre esta página.</div>}
      {error && <div className="msg warn" style={{ marginTop: 10 }}>{error} <button className="btn sec sm" onClick={generar}>Reintentar</button></div>}

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
              <Guion key={a.nombre + i} a={a} activo={i === activoIdx}
                onVisto={() => { if (!a.visto) cambiar(i, { visto: true }) }}
                onAprobar={() => cambiar(i, { aprobado: true, visto: true })}
                onDesaprobar={() => cambiar(i, { aprobado: false })} />
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn gold" disabled={!todos} onClick={() => onCrear(archivos)}>Crear los recursos →</button>
            {!todos && sinContenido === 0 && <span className="help">Faltan {archivos.length - aprobados} guion{archivos.length - aprobados === 1 ? '' : 'es'} por aprobar.</span>}
            <button className="btn sec sm" disabled={cargando} onClick={generar}>Generar de nuevo</button>
          </div>
        </>
      )}
    </section>
  )
}
