import { useState } from 'react'
import Documentos from './Documentos.jsx'
import PortalSyllabus from './PortalSyllabus.jsx'
import CargarGuion from './CargarGuion.jsx'
import Revision from './Revision.jsx'
import { Recursos, Unidades, UnidadVista } from './Unidades.jsx'
import { recursosDeGuion } from '../lib/guionJson.js'
import { temaBase } from '../lib/render.js'
import { uid } from '../lib/util.js'

const ESTADOS = { listo: ['ok', 'Documentos generados'], error: ['warn', 'Con error'], pendiente: ['warn', 'Pendiente de generar'], sin: ['', 'Sin generar'] }

// Espacio de trabajo de UN syllabus: 1) documentos por unidad (se revisan y aprueban), 2) unidades con sus temas y recursos.
export default function Workspace({ s, tab, setTab, unidadSel, setUnidadSel, recSel, setRecSel, onCambio, onVolver, onEditar, aviso, pendInicial }) {
  const [regenerar, setRegenerar] = useState(false)
  const [modo, setModo] = useState(pendInicial ? 'revision' : 'lista') // lista | cargar | revision
  const [pend, setPend] = useState(pendInicial ? pendInicial[0].pend : null)
  const [cola, setCola] = useState(pendInicial ? pendInicial.slice(1) : []) // guiones que siguen por revisar
  const [cls, txt] = ESTADOS[s.syllabus.estado] || ESTADOS.sin

  const docs = s.syllabus.documentos
  const aprobados = docs.filter((d) => d.aprobado).length
  const faltan = docs.length > 0 && aprobados < docs.length // las unidades se habilitan al aprobar todos los documentos
  const pasos = [
    ['syllabus', '1', 'Syllabus', s.syllabusUrl ? 'Documento base del curso' : 'Sin enlace'],
    ['docs', '2', 'Unidades', docs.length ? aprobados + ' de ' + docs.length + ' documentos aprobados' : 'Sin documentos'],
    ['unidades', '3', 'Guiones', faltan ? 'Apruebe las unidades' : s.guiones.length + ' guiones cargados'],
    ['recursos', '4', 'Recursos', faltan ? 'Apruebe las unidades' : s.recursos.length + ' recursos por tema']
  ]
  if (faltan && (tab === 'unidades' || tab === 'recursos')) setTimeout(() => setTab('docs'), 0)
  const irA = (k) => { setTab(k); setModo('lista'); if (k !== 'unidades') setUnidadSel(null); if (k === 'recursos') setRecSel({ u: null }) }
  const unidadesLista = docs.map((d) => ({ unidad: d.unidad, nombre: d.nombre }))

  const crearRecursos = (recursos, temas) => {
    const info = Object.keys(s.info || {}).length ? s.info : pend.info
    const t = { ...(s.temas || {}) }
    temas.forEach((x) => {
      t[x.unidad] = { ...(t[x.unidad] || {}) }
      t[x.unidad][x.numTema] = { nombre: (t[x.unidad][x.numTema] || {}).nombre || '', info: x.info }
    })
    onCambio({ ...s, info, temas: t, recursos: [...s.recursos, ...recursos], guiones: [...s.guiones, { nombre: pend.nombre, fecha: Date.now(), recursos: recursos.length }] })
    const u = [...new Set(recursos.map((r) => r.unidad))].filter((x) => x != null)
    if (cola.length) { // quedan guiones de otras unidades: se pasa al siguiente
      setPend(cola[0].pend); setUnidadSel(cola[0].unidad); setCola(cola.slice(1)); window.scrollTo({ top: 0 })
      aviso(recursos.length + ' recursos ubicados. Sigue el guion de la Unidad ' + cola[0].unidad)
      return
    }
    setPend(null); setModo('lista')
    setRecSel(u.length === 1 ? { u: u[0], t: undefined } : { u: null }); setUnidadSel(null); setTab('recursos'); window.scrollTo({ top: 0 })
    aviso(recursos.length + ' recursos ubicados' + (u.length ? ' en ' + u.map((x) => 'Unidad ' + x).join(', ') : ''))
  }

  // Con los guiones aprobados se crean los recursos de la unidad, cada uno en su tema, y se muestra la vista de recursos.
  const crearDeGuiones = (unidad, archivos) => {
    let recursos = []
    const t = { ...(s.temas || {}) }
    let info = s.info || {}
    archivos.forEach((a) => {
      const r = recursosDeGuion(a, unidad, uid, temaBase)
      recursos = recursos.concat(r.recursos)
      if (!Object.keys(info).length) info = r.info
      if (r.tema) {
        t[unidad] = { ...(t[unidad] || {}) }
        const previo = t[unidad][r.tema.numTema] || {}
        t[unidad][r.tema.numTema] = { nombre: previo.nombre || r.nombreTema, info: r.tema.info }
      }
    })
    const origenes = new Set(archivos.map((a) => a.nombre))
    const conservar = s.recursos.filter((r) => !(r.unidad === unidad && r.guionOrigen && origenes.has(r.guionOrigen)))
    onCambio({ ...s, info, temas: t, recursos: [...conservar, ...recursos], guiones: [...s.guiones, { nombre: 'Guiones de la Unidad ' + unidad + ' (n8n)', fecha: Date.now(), recursos: recursos.length }] })
    setRecSel({ u: unidad, t: undefined }); setUnidadSel(null); setModo('lista'); setTab('recursos'); window.scrollTo({ top: 0 })
    aviso(recursos.length + ' recursos creados en la Unidad ' + unidad)
  }

  return (
    <div className="wrapx fade">
      <div className="crumbs">
        <button className="lnk" onClick={onVolver}>Dashboard</button> › <span>{s.programa}</span> › <b>{s.curso}</b>
      </div>
      <div className="pj" style={{ marginTop: 6 }}>
        <div>
          <input type="text" aria-label="Curso" value={s.curso} onChange={(e) => onCambio({ ...s, curso: e.target.value })} style={{ fontSize: '1.7rem', fontWeight: 700, borderColor: 'transparent', background: 'transparent', padding: '2px 6px', color: 'var(--g2)' }} />
          <div className="row" style={{ marginTop: 4 }}>
            <input type="text" aria-label="Programa" value={s.programa === 'Sin programa' ? '' : s.programa} placeholder="Escriba el programa (para agrupar en el dashboard)" onChange={(e) => onCambio({ ...s, programa: e.target.value || 'Sin programa' })} style={{ width: 340, padding: '4px 8px', fontSize: '.9rem' }} />
            <span className={'pill ' + cls}>{txt}</span>
          </div>
        </div>
        <div className="row">
          {s.syllabusUrl && <a className="btn sec sm" style={{ textDecoration: 'none' }} href={s.syllabusUrl} target="_blank" rel="noopener noreferrer">Abrir syllabus en Google Docs</a>}
          {s.carpetaUrl && <a className="btn sec sm" style={{ textDecoration: 'none' }} href={s.carpetaUrl} target="_blank" rel="noopener noreferrer">Abrir carpeta de Drive</a>}
        </div>
      </div>

      <div className="stepper2" role="tablist">
        {pasos.map(([k, n, t, sub]) => (
          <button key={k} role="tab" className={tab === k ? 'on' : ''} disabled={k === 'integracion' || ((k === 'unidades' || k === 'recursos') && faltan)}
            title={k === 'integracion' ? 'La integración con el syllabus se habilitará más adelante' : ((k === 'unidades' || k === 'recursos') && faltan ? 'Apruebe todas las unidades para habilitar este paso' : '')}
            onClick={() => irA(k)}>
            <i>{n}</i><span><b>{t}</b><small>{sub}</small></span>
          </button>
        ))}
      </div>

      {tab === 'syllabus' && (
        <div>
          <h2>Syllabus</h2>
          {regenerar ? (
            <div>
              <PortalSyllabus modo="regenerar" inicial={{ syllabusUrl: s.syllabusUrl, carpetaUrl: s.carpetaUrl }}
                onResultado={(d) => { onCambio({ ...s, syllabusUrl: d.syllabusUrl, carpetaUrl: d.carpetaUrl, syllabus: { estado: d.estado, documentos: d.documentos.length ? d.documentos : s.syllabus.documentos, mensaje: d.mensaje } }); aviso('Resultado guardado en el syllabus'); return s.id }} />
              <div className="row" style={{ marginTop: 12 }}><button className="btn sec" onClick={() => setRegenerar(false)}>Volver al syllabus</button></div>
            </div>
          ) : (
            <>
              <div className="card kvc">
                <div><b>Programa</b><span>{s.programa}</span></div>
                <div><b>Curso</b><span>{s.curso}</span></div>
                <div><b>Syllabus</b><span>{s.syllabusUrl || 'Sin enlace'}</span></div>
                <div><b>Carpeta de destino</b><span>{s.carpetaUrl || 'Sin enlace'}</span></div>
              </div>
              <div className="row" style={{ margin: '12px 0' }}>
                <button className="btn sm" onClick={() => setRegenerar(true)}>{docs.length ? 'Volver a generar documentos' : 'Generar documentos'}</button>
              </div>
              <div className="row" style={{ marginTop: 18 }}>
                <button className="btn gold" onClick={() => irA('docs')}>Continuar a las unidades →</button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'docs' && (
        <div>
          <h2>Unidades del syllabus</h2>
          <p className="help">Revise el documento de cada unidad y apruébelo. Al aprobarlas todas se habilitan los guiones.</p>
          <Documentos s={s} onCambio={onCambio} />
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn gold" disabled={faltan} onClick={() => irA('unidades')}>Continuar a los guiones →</button>
            {faltan && <span className="help">Faltan {docs.length - aprobados} documento{docs.length - aprobados === 1 ? '' : 's'} por aprobar.</span>}
          </div>
        </div>
      )}

      {tab === 'unidades' && (
        <div>
          {modo === 'revision' && pend ? (
            <Revision pend={pend} destino={'Unidad ' + unidadSel + ' · ' + s.curso} unidades={unidadesLista} unidadPorDefecto={typeof unidadSel === 'number' ? unidadSel : null}
              onCancelar={() => { setPend(null); setModo('lista') }} onCrear={crearRecursos} />
          ) : modo === 'cargar' ? (
            <div>
              <h2>Cargar el guion de la Unidad {unidadSel}</h2>
              <p className="help">Los recursos se agregan a esta unidad y cada uno se ubica solo en su tema según su código (por ejemplo U{unidadSel}-T1-OVA1 va en el Tema 1).</p>
              <CargarGuion onAnalizado={(p) => { setPend(p); setModo('revision') }} onCancelar={() => setModo('lista')} />
            </div>
          ) : unidadSel != null ? (
            <UnidadVista s={s} unidad={unidadSel} onCambio={onCambio} onVolver={() => setUnidadSel(null)} onCargar={() => setModo('cargar')} onCrearDeGuiones={crearDeGuiones} aviso={aviso} />
          ) : (
            <Unidades s={s} onAbrir={setUnidadSel} />
          )}
        </div>
      )}

      {tab === 'recursos' && <Recursos s={s} sel={recSel} setSel={setRecSel} onCambio={onCambio} onEditar={onEditar} aviso={aviso} />}
    </div>
  )
}
