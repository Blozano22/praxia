import { useState } from 'react'

// Revisión de los documentos por unidad: se revisan uno por uno y cada uno se aprueba antes de pasar al siguiente.
function Estado({ d, activo }) {
  if (d.aprobado) return <span className="pill ok">✔ Aprobado</span>
  if (activo) return <span className="pill warn">En revisión</span>
  return <span className="pill">Pendiente</span>
}

function Doc({ d, activo, onVisto, onAprobar, onDesaprobar, onQuitar }) {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(d.url)
      else {
        const t = document.createElement('textarea')
        t.value = d.url; t.style.position = 'fixed'; t.style.opacity = '0'
        document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
      }
      setCopiado(true); setTimeout(() => setCopiado(false), 1800)
    } catch (e) { /* sin portapapeles */ }
  }
  const bloqueado = !d.aprobado && !activo
  return (
    <article className={'card doc' + (d.aprobado ? ' aprobado' : '') + (activo ? ' activo' : '') + (bloqueado ? ' bloq' : '')}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>Unidad {d.unidad} · {d.nombre}</b>
        <Estado d={d} activo={activo} />
      </div>
      {d.url && <a className="docurl" href={d.url} target="_blank" rel="noopener noreferrer">{d.url}</a>}
      {!d.url && <p className="help">No se recibió el enlace de este documento.</p>}

      {activo && (
        <div className="paso-rev">
          <p><b>1.</b> Abra el documento y revíselo: contenido, formato y que esté completo.</p>
          <div className="row">
            {d.url && <a className="btn sm" style={{ textDecoration: 'none' }} href={d.url} target="_blank" rel="noopener noreferrer" onClick={onVisto}>Abrir documento</a>}
            {d.url && <button className="btn sec sm" onClick={copiar}>{copiado ? 'Ruta copiada' : 'Copiar ruta'}</button>}
          </div>
          <p style={{ marginTop: 10 }}><b>2.</b> Si está bien, apruébelo para pasar al siguiente.</p>
          <button className="btn gold sm" disabled={d.url && !d.visto} onClick={onAprobar}>Aprobar este documento</button>
          {d.url && !d.visto && <p className="help">Se habilita después de abrir el documento.</p>}
        </div>
      )}
      {d.aprobado && (
        <div className="row">
          {d.url && <a className="btn sec sm" style={{ textDecoration: 'none' }} href={d.url} target="_blank" rel="noopener noreferrer">Abrir de nuevo</a>}
          <button className="btn sec sm" onClick={onDesaprobar}>Quitar aprobación</button>
        </div>
      )}
      {bloqueado && <p className="help">Se habilita cuando apruebe el documento anterior.</p>}
      {!d.aprobado && onQuitar && <button className="btn danger sm" style={{ alignSelf: 'flex-start' }} onClick={onQuitar}>Quitar de la lista</button>}
    </article>
  )
}

export default function Documentos({ s, onCambio }) {
  const docs = s.syllabus.documentos
  const aprobados = docs.filter((d) => d.aprobado).length
  const activoIdx = docs.findIndex((d) => !d.aprobado)
  const [nuevo, setNuevo] = useState({ unidad: docs.length + 1, nombre: '', url: '' })
  const [abrir, setAbrir] = useState(false)
  const poner = (documentos) => onCambio({ ...s, syllabus: { ...s.syllabus, documentos, estado: documentos.length ? 'listo' : s.syllabus.estado } })
  const cambiar = (i, cambio) => poner(docs.map((d, k) => (k === i ? { ...d, ...cambio } : d)))
  const agregar = () => {
    let href = ''
    try { const u = new URL(nuevo.url.trim()); if (u.protocol === 'https:') href = u.href } catch (e) { /* inválido */ }
    if (!href) { alert('Pegue un enlace válido (https://…).'); return }
    poner([...docs, { unidad: Number(nuevo.unidad) || docs.length + 1, nombre: nuevo.nombre.trim() || 'Unidad ' + nuevo.unidad, url: href }].sort((a, b) => a.unidad - b.unidad))
    setNuevo({ unidad: docs.length + 2, nombre: '', url: '' }); setAbrir(false)
  }
  return (
    <div>
      {s.syllabus.mensaje && s.syllabus.estado !== 'listo' && <div className="msg warn"><b>Sin documentos generados. </b>{s.syllabus.mensaje}</div>}
      {docs.length === 0 && (
        <div className="msg warn">
          <b>n8n terminó, pero no devolvió los enlaces de los documentos. </b>
          Revise la carpeta de Drive y agregue los enlaces a mano para poder revisarlos y aprobarlos aquí. (Para que lleguen solos, el flujo de n8n debe responder con la lista de documentos generados.)
        </div>
      )}
      {docs.length > 0 && (
        <div className="card revhead">
          <div><b>Revisión de documentos</b><p className="help" style={{ margin: 0 }}>Revise cada documento y apruébelo, uno por uno. Al aprobarlos todos se habilitan los recursos.</p></div>
          <div style={{ minWidth: 180 }}>
            <b>{aprobados} de {docs.length} aprobados</b>
            <div className="bar" style={{ marginTop: 6 }}><i style={{ width: (aprobados / docs.length * 100) + '%' }} /></div>
          </div>
        </div>
      )}
      <div className="docs">
        {docs.map((d, i) => (
          <Doc key={i} d={d} activo={i === activoIdx}
            onVisto={() => { if (!d.visto) cambiar(i, { visto: true }) }}
            onAprobar={() => cambiar(i, { aprobado: true, visto: true })}
            onDesaprobar={() => cambiar(i, { aprobado: false })}
            onQuitar={() => poner(docs.filter((_, k) => k !== i))} />
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        {!abrir ? <button className="btn sec sm" onClick={() => setAbrir(true)}>＋ Agregar un documento a mano</button> : (
          <div className="card" style={{ maxWidth: 640 }}>
            <div className="row">
              <div style={{ width: 90 }}><label className="l" style={{ marginTop: 0 }}>Unidad</label><input type="text" value={nuevo.unidad} onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })} /></div>
              <div style={{ flex: 1, minWidth: 200 }}><label className="l" style={{ marginTop: 0 }}>Nombre de la unidad</label><input type="text" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
            </div>
            <label className="l">Enlace del documento</label>
            <input type="text" value={nuevo.url} placeholder="https://docs.google.com/document/d/..." onChange={(e) => setNuevo({ ...nuevo, url: e.target.value })} />
            <div className="row" style={{ marginTop: 10 }}><button className="btn sm" onClick={agregar}>Agregar</button><button className="btn sec sm" onClick={() => setAbrir(false)}>Cancelar</button></div>
          </div>
        )}
      </div>
    </div>
  )
}
