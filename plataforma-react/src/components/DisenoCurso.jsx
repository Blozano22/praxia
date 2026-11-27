import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'
import MatricesH5P from './MatricesH5P.jsx'

import './diseno-curso.css'

const Ico = ({ children }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>

// Fase 3: vista de diseño de un curso asignado. Datos del curso en solo lectura y el paso «Matrices y H5P» completo, operado en nombre del docente dueño.
export default function DisenoCurso({ propietario, proyecto, onVolver }) {
  const [c, setC] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setC(null); setError('')
    api('GET', '/diseno/cursos/' + encodeURIComponent(propietario) + '/' + encodeURIComponent(proyecto)).then(setC).catch((e) => setError(e.message || 'No se pudo cargar el curso.'))
  }, [propietario, proyecto])
  const revision = c && c.estado === 'en_revision_docente'
  const datos = c && c.datos ? { ...c.datos, id: c.datos.id || c.id } : null
  const docs = (datos && datos.syllabus && datos.syllabus.documentos) || []
  const aprobadas = docs.filter((d) => d.aprobado).length
  const info = (datos && datos.info) || {}
  return (
    <div className="wrapx fade">
      <div className="crumbs">
        <button className="lnk" onClick={onVolver}>Cursos asignados</button> › <b>{(c && (c.curso || c.id)) || 'Curso'}</b>
      </div>
      <div className="dc-cab-curso">
        <Titulo icono="inicio">
          <h1>{(c && (c.curso || c.id)) || 'Curso'}</h1>
          <p className="lead">{c ? c.programa + ' · Docente: ' + c.docente : 'Cargando…'}</p>
        </Titulo>
        <button className="btn sec" onClick={onVolver}>← Volver a cursos asignados</button>
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}
      {revision && <div className="msg" role="status"><b>En revisión del docente:</b> espere la corrección. Las acciones están deshabilitadas.</div>}
      {datos && (
        <>
          <section className="dc-resumen" aria-label="Resumen del curso">
            <div className="dc-datos">
              <div className="dc-dato">
                <span className="dc-dato-ico"><Ico><path d="M2 9l10-5 10 5-10 5L2 9z" /><path d="M6 11.5V16c0 1.2 2.7 3 6 3s6-1.8 6-3v-4.5" /></Ico></span>
                <div><small>Formación</small><b>{info.nivel || info.nivel_de_formacion || '—'}</b></div>
              </div>
              <div className="dc-dato">
                <span className="dc-dato-ico"><Ico><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4zM5 17a3 3 0 013-3h11" /></Ico></span>
                <div><small>Unidades aprobadas</small><b>{aprobadas} de {docs.length}{docs.length > 0 && aprobadas === docs.length && <span className="pill ok">Completo</span>}</b></div>
              </div>
              <div className="dc-dato">
                <span className="dc-dato-ico"><Ico><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></Ico></span>
                <div><small>Docente</small><b>{(c && c.docente) || '—'}</b></div>
              </div>
            </div>
            {datos.carpetaUrl && <a className="btn sec" href={datos.carpetaUrl} target="_blank" rel="noreferrer"><Ico><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></Ico>Abrir carpeta de Drive</a>}
          </section>
          <fieldset disabled={revision} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <MatricesH5P s={{ ...datos, syllabus: datos.syllabus || { documentos: [] } }} propietario={propietario} />
          </fieldset>
        </>
      )}
    </div>
  )
}
