import { Fragment, useMemo, useState } from 'react'
import { E } from '../lib/engine.js'
import { NOMBRES, UNIDAD, temaBase } from '../lib/render.js'
import { ubicar } from '../lib/ubicar.js'
import { uid } from '../lib/util.js'
import Titulo from './Titulo.jsx'

function Resumen({ r, info }) {
  const d = E.datosDe(r, info)
  const n = (d.diapositivas || d.nodos || d.escenas || d.bloques || d.secciones || d.apartados || d.etiquetas || d.palabras || d.eventos || d.ramas || d.evidencias || []).length
  return <span className="pill">{n} {UNIDAD[r.tipo]}{r.actividad ? ' · con actividad' : ''}</span>
}

// Revisión del guion: muestra qué recursos se encontraron y a qué unidad y tema van (se deduce del código).
// Nota: en cada recurso, «numTema» es el número de tema del guion y «tema» es su diseño visual.
export default function Revision({ pend, destino, unidades = [], unidadPorDefecto = null, onCancelar, onCrear }) {
  const { info } = pend
  const existe = (u) => unidades.some((x) => x.unidad === u)
  const [recs, setRecs] = useState(() => pend.recursos.map((r) => {
    const u = ubicar(r.codigo)
    return { ...r, unidad: unidadPorDefecto != null ? unidadPorDefecto : (existe(u.unidad) ? u.unidad : null), numTema: u.tema, indicada: u.unidad }
  }))
  const [sel, setSel] = useState(() => pend.recursos.map(() => true))
  const kv = useMemo(() => Object.keys(info).filter((k) => k !== 'titulo_guion').map((k) => [k.replace(/_/g, ' '), info[k]]), [info])
  const n = sel.filter(Boolean).length
  const cambiar = (i, c) => setRecs(recs.map((x, k) => (k === i ? { ...x, ...c } : x)))

  const crear = () => {
    const elegidos = recs.filter((_, i) => sel[i])
    const temas = []
    elegidos.forEach((r) => {
      if (r.unidad != null && r.numTema != null && !temas.some((t) => t.unidad === r.unidad && t.numTema === r.numTema)) {
        temas.push({
          unidad: r.unidad, numTema: r.numTema,
          info: {
            resultado: info.resultado_de_aprendizaje || '',
            indicadores: info.indicadores_de_logro_del_tema || info.indicador_del_tema || info.indicadores_de_logro || '',
            horas: info.horas_estimadas_del_tema || '',
            guion: pend.nombre
          }
        })
      }
    })
    onCrear(elegidos.map((r) => ({
      id: uid(), tipo: r.tipo, codigo: r.codigo, clase: r.clase, nombre: r.nombre, unidad: r.unidad, numTema: r.numTema,
      datos: E.datosDe(r, info), tema: temaBase(), avisos: r.avisos, sinUbicar: r.sinUbicar, tecnica: r.tecnica.texto, actividadOculta: false
    })), temas)
  }

  return (
    <div className="wrapx fade">
      <Titulo icono="revision">
        <h1>Esto fue lo que encontramos en el guion</h1>
        {destino && <p className="lead">Los recursos se agregarán a «{destino}»; cada uno se ubica en su tema según su código.</p>}
      </Titulo>
      <div className="msg info">La plataforma solo usa texto que está en el guion. Revise a qué tema va cada recurso: se deduce del código (por ejemplo U2-T1-OVA1 es el Tema 1 de la Unidad 2) y puede cambiarlo.</div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Información general del guion</h3>
        {kv.length ? <div className="kv">{kv.map(([k, v]) => <Fragment key={k}><b>{k}</b><span>{v}</span></Fragment>)}</div> : <p className="help">El guion no trae una tabla de información general.</p>}
      </div>
      <h2>{recs.length} recursos detectados</h2>
      <div className="rev">
        {recs.map((r, i) => (
          <div className="card rv" key={r.id}>
            <input type="checkbox" checked={sel[i]} aria-label="Crear este recurso" onChange={(e) => setSel(sel.map((v, k) => (k === i ? e.target.checked : v)))} />
            <div>
              <div className="row"><span className="tipo">{r.codigo}</span><span className="pill">{r.clase || '—'}</span><Resumen r={r} info={info} /></div>
              <h3 style={{ marginTop: 6 }}>{r.titulo || r.nombre}</h3>
              <p className="help" style={{ margin: '2px 0' }}>{r.nombre}</p>
              <div className="row" style={{ margin: '6px 0' }}>
                <span className="help">Se armará como:</span>
                <select style={{ width: 'auto' }} value={r.tipo} onChange={(e) => cambiar(i, { tipo: e.target.value })}>
                  {Object.keys(NOMBRES).map((k) => <option key={k} value={k}>{NOMBRES[k]}</option>)}
                </select>
              </div>
              <div className="row" style={{ margin: '6px 0' }}>
                <span className="help">Va en:</span>
                <select style={{ width: 'auto' }} value={r.unidad == null ? '' : r.unidad} onChange={(e) => cambiar(i, { unidad: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">Sin unidad asignada</option>
                  {unidades.map((u) => <option key={u.unidad} value={u.unidad}>Unidad {u.unidad} · {u.nombre.slice(0, 40)}</option>)}
                </select>
                <select style={{ width: 'auto' }} value={r.numTema == null ? '' : r.numTema} onChange={(e) => cambiar(i, { numTema: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">Introducción de la unidad</option>
                  {Array.from({ length: 12 }, (_, k) => k + 1).map((t) => <option key={t} value={t}>Tema {t}</option>)}
                </select>
              </div>
              {r.indicada != null && r.indicada !== r.unidad && <div className="msg warn" style={{ margin: '6px 0', padding: '8px 12px' }}>El código indica la Unidad {r.indicada}, pero este recurso se agregará a {r.unidad == null ? 'ninguna unidad' : 'la Unidad ' + r.unidad}. Puede cambiarlo aquí abajo.</div>}
              {r.avisos.map((a, k) => <div key={k} className="msg warn" style={{ margin: '6px 0', padding: '8px 12px' }}>{a}</div>)}
              {r.sinUbicar.length > 0 && (
                <details className="dt"><summary>Texto del guion que no se pudo ubicar ({r.sinUbicar.length})</summary>{r.sinUbicar.map((t, k) => <p key={k} className="help">{t}</p>)}</details>
              )}
              {r.avisos.length === 0 && r.sinUbicar.length === 0 && <span className="pill ok">Todo el texto de este recurso fue ubicado</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn gold" disabled={!n} onClick={crear}>Crear {n} recursos</button>
        <button className="btn sec" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}
