import { useState } from 'react'
import EnlaceDoc from './EnlaceDoc.jsx'

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
    <article className={'card doc dr' + (d.aprobado ? ' aprobado' : '') + (activo ? ' activo' : '') + (bloqueado ? ' bloq' : '')}>
      <span className="dr-n" aria-hidden="true">{d.aprobado ? '✓' : d.unidad}</span>
      <div className="dr-cuerpo">
        <div className="dr-cab">
          <b>Unidad {d.unidad} · {d.nombre}</b>
          <Estado d={d} activo={activo} />
        </div>
        {d.url && <EnlaceDoc compacto titulo={'Documento de la unidad ' + d.unidad} url={d.url} onVisto={activo ? onVisto : undefined} />}
        {!d.url && <p className="help">No se recibió el enlace de este documento.</p>}

        {activo && (
          <div className="paso-rev dr-rev">
            <div>
              <p><b>1. Revíselo.</b> Abra la vista previa o el documento en Google y compruebe contenido, formato y que esté completo.</p>
              {d.url && <button className="btn sec sm" onClick={copiar}>{copiado ? 'Ruta copiada' : 'Copiar ruta'}</button>}
            </div>
            <div>
              <p><b>2. Apruébelo.</b> Si está bien, apruébelo para pasar al siguiente.</p>
              <button className="btn gold" disabled={d.url && !d.visto} onClick={onAprobar}>Aprobar este documento</button>
              {d.url && !d.visto && <p className="help">Se habilita después de abrir el documento.</p>}
            </div>
          </div>
        )}
        {(d.aprobado || bloqueado || (!d.aprobado && onQuitar)) && (
          <div className="dr-pie">
            {d.aprobado && <button className="btn sec sm" onClick={onDesaprobar}>Quitar aprobación</button>}
            {bloqueado && <span className="help">Se habilita cuando apruebe el documento anterior.</span>}
            {!d.aprobado && onQuitar && <button className="btn danger sm" onClick={onQuitar}>Quitar de la lista</button>}
          </div>
        )}
      </div>
    </article>
  )
}

export default function Documentos({ s, onCambio }) {
  const docs = s.syllabus.documentos
  const aprobados = docs.filter((d) => d.aprobado).length
  const activoIdx = docs.findIndex((d) => !d.aprobado)
  const poner = (documentos) => onCambio({ ...s, syllabus: { ...s.syllabus, documentos, estado: documentos.length ? 'listo' : s.syllabus.estado } })
  const cambiar = (i, cambio) => poner(docs.map((d, k) => (k === i ? { ...d, ...cambio } : d)))
  return (
    <div>
      {s.syllabus.mensaje && s.syllabus.estado !== 'listo' && <div className="msg warn"><b>Sin documentos generados. </b>{s.syllabus.mensaje}</div>}
      {docs.length === 0 && (
        <div className="msg warn">
          <b>n8n terminó, pero no devolvió los enlaces de los documentos. </b>
          Revise la carpeta de Drive. Para que los enlaces lleguen solos y se puedan revisar y aprobar aquí, el flujo de n8n debe responder con la lista de documentos generados; puede volver a generar los documentos desde el paso Syllabus.
        </div>
      )}
      {docs.length > 0 && (
        <div className="card revhead">
          <div><b>Revisión de documentos</b><p className="help" style={{ margin: 0 }}>Uno por uno: revise y apruebe. Con todos aprobados se habilitan los guiones.</p></div>
          <div style={{ minWidth: 220, flex: '0 1 320px' }}>
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
    </div>
  )
}
