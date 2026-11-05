import { useState } from 'react'
import { descargar } from '../lib/render.js'
import { etiquetaTema } from '../lib/ubicar.js'
import { clone, uid } from '../lib/util.js'
import { Tarjeta } from './Galeria.jsx'
import Guiones from './Guiones.jsx'

// Un tema existe si tiene recursos, si se guardó con nombre/información o si n8n lo devolvió dentro de la unidad.
export function temasDe(s, unidad) {
  const doc = s.syllabus.documentos.find((d) => d.unidad === unidad)
  const n = new Set()
  s.recursos.forEach((r) => { if (r.unidad === unidad && r.numTema != null) n.add(r.numTema) })
  Object.entries((s.temas || {})[unidad] || {}).forEach(([k, v]) => { if ((v && v.nombre && v.nombre.trim()) || (v && v.info && Object.values(v.info).some(Boolean))) n.add(Number(k)) })
  ;((doc && doc.temas) || []).forEach((t) => n.add(t.n))
  return [...n].sort((a, b) => a - b)
}

// Una tarjeta por cada unidad que devolvió n8n.
export function Unidades({ s, onAbrir }) {
  const docs = s.syllabus.documentos.slice().sort((a, b) => a.unidad - b.unidad)
  return (
    <div>
      <div className="pj">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ margin: 0 }}>Guiones por unidad de «{s.curso}»</h2>
          <p className="help" style={{ margin: '2px 0 0' }}>Abra una unidad para ver sus temas y cargar el guion de sus recursos.</p>
        </div>
      </div>
      {docs.length === 0 && <div className="msg warn" style={{ marginTop: 14 }}>Este syllabus no tiene unidades. Vuelva al paso 2 (Unidades) y genere o agregue los documentos por unidad.</div>}
      <div className="grid" style={{ marginTop: 14 }}>
        {docs.map((d) => {
          const rs = s.recursos.filter((r) => r.unidad === d.unidad)
          const temas = temasDe(s, d.unidad)
          return (
            <div className="card ud fade" key={d.unidad}>
              <span className="tipo">Unidad {d.unidad}</span>
              <h3>{d.nombre}</h3>
              <div className="row" style={{ margin: '6px 0' }}>
                <span className={'pill ' + (d.aprobado ? 'ok' : 'warn')}>{d.aprobado ? '✔ Documento aprobado' : 'Documento sin aprobar'}</span>
                <span className="pill">{temas.length} {temas.length === 1 ? 'tema' : 'temas'}</span>
                <span className="pill">{rs.length} recursos</span>
              </div>
              {temas.length > 0 && <p className="help" style={{ margin: 0 }}>{temas.map((t) => 'Tema ' + t).join(' · ')}</p>}
              <div className="row" style={{ marginTop: 'auto', paddingTop: 10 }}>
                <button className="btn sm" onClick={() => onAbrir(d.unidad)}>Abrir unidad</button>
                {d.url && <a className="btn sec sm" style={{ textDecoration: 'none' }} href={d.url} target="_blank" rel="noopener noreferrer">Ver documento</a>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Paso «Recursos»: unidades → temas → recursos (misma estructura que el paso «Unidades»).
// sel = { u: unidad | 'sin' | null, t: undefined (lista de temas) | null (introducción) | número de tema }
export function Recursos({ s, sel, setSel, onCambio, onEditar, aviso }) {
  const docs = s.syllabus.documentos.slice().sort((a, b) => a.unidad - b.unidad)
  const sinUnidad = s.recursos.some((r) => r.unidad == null)
  const { u, t } = sel
  const unidad = u
  const sin = u === 'sin'
  const doc = u == null || sin ? null : docs.find((d) => d.unidad === u)
  const enUnidad = u == null ? [] : s.recursos.filter((r) => (sin ? r.unidad == null : r.unidad === u))
  const temas = u == null || sin ? [] : temasDe(s, u)
  const info = (n) => (u == null ? null : ((s.temas || {})[u] || {})[n]) || { nombre: '', info: {} }
  const n8nNombre = (n) => ((doc && doc.temas) || []).find((x) => x.n === n)?.nombre || ''
  const nombreTema = (n) => info(n).nombre || n8nNombre(n) || ''
  const poner = (n, c) => onCambio({ ...s, temas: { ...s.temas, [u]: { ...((s.temas || {})[u] || {}), [n]: { ...info(n), ...c } } } })
  const reemplazar = (id, fn) => onCambio({ ...s, recursos: s.recursos.flatMap((r) => (r.id === id ? fn(r) : [r])) })
  const ir = (nuevo) => { setSel(nuevo); window.scrollTo({ top: 0 }) }
  const Pills = ({ rs, n }) => <div className="row" style={{ margin: '6px 0' }}><span className="pill">{rs} {rs === 1 ? 'recurso' : 'recursos'}</span>{n != null && <span className="pill">{n} {n === 1 ? 'tema' : 'temas'}</span>}</div>

  // 1) Lista de unidades
  if (u == null) {
    return (
      <div>
        <div className="pj"><div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ margin: 0 }}>Recursos de «{s.curso}»</h2>
          <p className="help" style={{ margin: '2px 0 0' }}>Abra una unidad para ver sus temas y los recursos de cada uno. Los recursos se crean en el paso «Unidades», al aprobar los guiones.</p>
        </div></div>
        {docs.length === 0 && <div className="msg warn" style={{ marginTop: 14 }}>Este syllabus no tiene unidades todavía.</div>}
        <div className="grid" style={{ marginTop: 14 }}>
          {docs.map((d) => {
            const rs = s.recursos.filter((r) => r.unidad === d.unidad)
            return (
              <div className="card ud fade" key={d.unidad}>
                <span className="tipo">Unidad {d.unidad}</span>
                <h3>{d.nombre}</h3>
                <Pills rs={rs.length} n={temasDe(s, d.unidad).length} />
                <div className="row" style={{ marginTop: 'auto', paddingTop: 10 }}>
                  <button className="btn sm" onClick={() => ir({ u: d.unidad, t: undefined })}>Abrir unidad</button>
                </div>
              </div>
            )
          })}
          {sinUnidad && (
            <div className="card ud fade">
              <span className="tipo">Sin unidad</span>
              <h3>Recursos sin unidad asignada</h3>
              <Pills rs={s.recursos.filter((r) => r.unidad == null).length} />
              <div className="row" style={{ marginTop: 'auto', paddingTop: 10 }}><button className="btn sm" onClick={() => ir({ u: 'sin', t: null })}>Abrir</button></div>
            </div>
          )}
        </div>
      </div>
    )
  }

  const tituloUnidad = sin ? 'Recursos sin unidad asignada' : 'Unidad ' + unidad + ' · ' + (doc ? doc.nombre : '')
  const crumbsBase = <><button className="lnk" onClick={() => ir({ u: null })}>Unidades</button> › </>

  // 3) Recursos de un tema (o de la introducción)
  if (t !== undefined) {
    const rs = enUnidad.filter((r) => (t == null ? r.numTema == null : r.numTema === t))
    const inf = t == null ? { nombre: '', info: {} } : info(t)
    return (
      <div className="fade">
        <div className="crumbs">{crumbsBase}{sin ? <b>Sin unidad</b> : <><button className="lnk" onClick={() => ir({ u, t: undefined })}>Unidad {unidad}</button> › <b>{t == null ? 'Introducción' : 'Tema ' + t}</b></>}</div>
        <div className="pj" style={{ marginTop: 6 }}>
          <div>
            <h2 style={{ margin: 0 }}>{sin ? tituloUnidad : (t == null ? 'Introducción de la unidad ' + unidad : 'Tema ' + t + (nombreTema(t) ? ' · ' + nombreTema(t) : ''))}</h2>
            <p className="help" style={{ margin: '2px 0 0' }}>{rs.length} {rs.length === 1 ? 'recurso' : 'recursos'}</p>
          </div>
        </div>
        {t != null && (
          <div className="row" style={{ margin: '12px 0' }}>
            <label className="help" htmlFor={'nt' + t}>Nombre del tema</label>
            <input id={'nt' + t} type="text" style={{ flex: 1, minWidth: 220, maxWidth: 520 }} placeholder={n8nNombre(t) || 'Nombre del tema (opcional)'} value={inf.nombre || ''} onChange={(e) => poner(t, { nombre: e.target.value })} />
          </div>
        )}
        {t != null && (inf.info?.indicadores || inf.info?.resultado || inf.info?.guion) && (
          <details className="dt" style={{ margin: '4px 0 12px' }}>
            <summary>Información del guion de este tema</summary>
            {inf.info.guion && <p className="help">Guion: {inf.info.guion}{inf.info.horas ? ' · ' + inf.info.horas + ' horas estimadas' : ''}</p>}
            {inf.info.resultado && <p style={{ fontSize: '.9rem' }}><b>Resultado de aprendizaje: </b>{inf.info.resultado}</p>}
            {inf.info.indicadores && <p style={{ fontSize: '.9rem' }}><b>Indicadores de logro: </b>{inf.info.indicadores}</p>}
          </details>
        )}
        {rs.length === 0 ? (
          <div className="msg info" style={{ marginTop: 12 }}>Este tema todavía no tiene recursos. Se crean desde «Unidades», al aprobar sus guiones.</div>
        ) : (
          <div className="grid" style={{ marginTop: 12 }}>
            {rs.map((r) => (
              <Tarjeta key={r.id} r={r}
                onAbrir={() => onEditar(r.id)}
                onDescargar={() => { descargar(r); aviso('Descargando…') }}
                onDuplicar={() => reemplazar(r.id, (x) => { const c = clone(x); c.id = uid(); c.datos.titulo += ' (copia)'; return [x, c] })}
                onEliminar={() => { if (confirm('¿Eliminar este recurso?')) reemplazar(r.id, () => []) }} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // 2) Temas de una unidad
  const intro = enUnidad.filter((r) => r.numTema == null)
  return (
    <div className="fade">
      <div className="crumbs">{crumbsBase}<b>Unidad {unidad}</b></div>
      <div className="pj" style={{ marginTop: 6 }}>
        <div>
          <h2 style={{ margin: 0 }}>{tituloUnidad}</h2>
          <p className="help" style={{ margin: '2px 0 0' }}>{enUnidad.length} recursos · {temas.length} {temas.length === 1 ? 'tema' : 'temas'}</p>
        </div>
      </div>
      {enUnidad.length === 0 && temas.length === 0 && <div className="msg info" style={{ marginTop: 14 }}>Aún no hay recursos en esta unidad. Se crean en el paso «Unidades», al aprobar los guiones.</div>}
      <div className="grid" style={{ marginTop: 14 }}>
        {intro.length > 0 && (
          <div className="card ud fade">
            <span className="tipo">Introducción</span>
            <h3>Presentación de la unidad</h3>
            <Pills rs={intro.length} />
            <div className="row" style={{ marginTop: 'auto', paddingTop: 10 }}><button className="btn sm" onClick={() => ir({ u, t: null })}>Ver recursos</button></div>
          </div>
        )}
        {temas.map((n) => {
          const rs = enUnidad.filter((r) => r.numTema === n)
          return (
            <div className="card ud fade" key={n}>
              <span className="tipo">Tema {n}</span>
              <h3>{nombreTema(n) || 'Tema sin nombre'}</h3>
              <Pills rs={rs.length} />
              <div className="row" style={{ marginTop: 'auto', paddingTop: 10 }}><button className="btn sm" onClick={() => ir({ u, t: n })}>Ver recursos</button></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Dentro de una unidad: se crean sus guiones, se aprueban y de ahí salen los recursos.
export function UnidadVista({ s, unidad, onCambio, onVolver, onCargar, onCrearDeGuiones }) {
  const doc = s.syllabus.documentos.find((d) => d.unidad === unidad)
  const enUnidad = s.recursos.filter((r) => r.unidad === unidad)
  const temas = temasDe(s, unidad)
  return (
    <div className="fade">
      <div className="crumbs"><button className="lnk" onClick={onVolver}>Unidades</button> › <b>Unidad {unidad}</b></div>
      <div className="pj" style={{ marginTop: 6 }}>
        <div>
          <h2 style={{ margin: 0 }}>Unidad {unidad} · {doc ? doc.nombre : ''}</h2>
          <p className="help" style={{ margin: '2px 0 0' }}>{enUnidad.length} recursos · {temas.length} {temas.length === 1 ? 'tema' : 'temas'}</p>
        </div>
        <div className="row">
          {doc && doc.url && <a className="btn sec sm" style={{ textDecoration: 'none' }} href={doc.url} target="_blank" rel="noopener noreferrer">Ver documento de la unidad</a>}
          <button className="btn sec sm" onClick={onCargar}>Cargar un guion (Word) a mano</button>
        </div>
      </div>
      <Guiones s={s} unidad={unidad} doc={doc} onCambio={onCambio} onCrear={(a) => onCrearDeGuiones(unidad, a)} />
    </div>
  )
}
