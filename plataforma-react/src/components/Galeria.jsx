import { useEffect, useMemo, useRef, useState } from 'react'
import { construirHtml, descargar, NOMBRES } from '../lib/render.js'
import { clone, uid } from '../lib/util.js'

// Tarjeta con vista previa en miniatura del recurso (se ajusta al ancho de la tarjeta).
export function Tarjeta({ r, onAbrir, onDescargar, onDuplicar, onEliminar }) {
  const html = useMemo(() => construirHtml(r, true), [r])
  const pv = useRef(null)
  const [esc, setEsc] = useState({ s: 0.3, h: 200 })
  useEffect(() => {
    const el = pv.current
    const f = () => { const w = el.clientWidth; if (w) setEsc({ s: w / 1100, h: Math.round(w * 680 / 1100) }) }
    f()
    const ro = new ResizeObserver(f)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const d = r.datos
  const hayAvisos = r.avisos.length > 0 || r.sinUbicar.length > 0
  return (
    <div className="card rc fade">
      <div className="pvw" ref={pv} style={{ height: esc.h }} onClick={onAbrir}>
        <iframe sandbox="allow-scripts" tabIndex={-1} aria-hidden="true" srcDoc={html} title="Vista previa" style={{ transform: `scale(${esc.s})` }} />
        <div className="ov" />
      </div>
      <div className="bd">
        <div className="row"><span className="tipo">{NOMBRES[r.tipo]}</span><span className="pill">{d.clase || ''}</span></div>
        <h3>{d.titulo || r.nombre}</h3>
        <p className="help" style={{ margin: 0 }}>{d.codigo} · {r.nombre}</p>
        {hayAvisos ? <span className="pill warn">Hay avisos del guion</span> : <span className="pill ok">Completo según el guion</span>}
        <div className="acts">
          <button className="btn sm" onClick={onAbrir}>Abrir y editar</button>
          <button className="btn sec sm" onClick={onDescargar}>Descargar</button>
          <button className="btn sec sm" onClick={onDuplicar}>Duplicar</button>
          <button className="btn danger sm" onClick={onEliminar}>Eliminar</button>
        </div>
      </div>
    </div>
  )
}

export default function Galeria({ proyecto, onAbrir, onCambio, onCargar, aviso }) {
  const p = proyecto
  const dupl = (r) => {
    const c = clone(r)
    c.id = uid()
    c.datos.titulo += ' (copia)'
    const rs = p.recursos.slice()
    rs.splice(rs.indexOf(r) + 1, 0, c)
    onCambio({ ...p, recursos: rs })
  }
  return (
    <div className="fade">
      <div className="pj">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ margin: 0 }}>Recursos de «{p.curso}»</h2>
          <p className="help" style={{ margin: '2px 0 0' }}>{p.recursos.length} recursos creados desde el guion. Toque una tarjeta para verla y editarla.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => { p.recursos.forEach((r, i) => setTimeout(() => descargar(r), i * 400)); aviso('Descargando todos…') }}>Descargar todos</button>
          <button className="btn sec" onClick={onCargar}>＋ Cargar guion</button>
        </div>
      </div>
      {p.guiones.length > 0 && <p className="help">Guiones cargados: {p.guiones.map((g) => g.nombre + ' (' + g.recursos + ')').join(' · ')}</p>}
      {p.info && p.info.resultado_de_aprendizaje && (
        <div className="msg info"><b>Resultado de aprendizaje (del guion): </b>{p.info.resultado_de_aprendizaje}</div>
      )}
      <div className="grid" style={{ marginTop: 14 }}>
        {p.recursos.map((r) => (
          <Tarjeta key={r.id} r={r}
            onAbrir={() => onAbrir(r.id)}
            onDescargar={() => { descargar(r); aviso('Descargando…') }}
            onDuplicar={() => dupl(r)}
            onEliminar={() => { if (confirm('¿Eliminar este recurso?')) onCambio({ ...p, recursos: p.recursos.filter((x) => x !== r) }) }} />
        ))}
      </div>
    </div>
  )
}
