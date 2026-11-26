import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'
import MatricesH5P from './MatricesH5P.jsx'

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
  const info = (datos && datos.info) || {}
  return (
    <div className="wrapx fade">
      <Titulo icono="inicio">
        <h1>{(c && (c.curso || c.id)) || 'Curso'}</h1>
        <p className="lead">{c ? c.programa + ' · Docente: ' + c.docente : 'Cargando…'}</p>
      </Titulo>
      <p><button className="btn" onClick={onVolver}>Volver a cursos asignados</button></p>
      {error && <div className="msg err" role="alert">{error}</div>}
      {revision && <div className="msg" role="status"><b>En revisión del docente:</b> espere la corrección. Las acciones están deshabilitadas.</div>}
      {datos && (
        <>
          <div className="drop" style={{ textAlign: 'left' }}>
            <p><b>Formación:</b> {info.nivel || info.nivel_de_formacion || '—'}</p>
            <p><b>Unidades aprobadas:</b> {((datos.syllabus && datos.syllabus.documentos) || []).filter((d) => d.aprobado).length} de {((datos.syllabus && datos.syllabus.documentos) || []).length}</p>
            {datos.carpetaUrl && <p><a href={datos.carpetaUrl} target="_blank" rel="noreferrer">Carpeta de Drive del curso</a></p>}
          </div>
          <fieldset disabled={revision} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <MatricesH5P s={{ ...datos, syllabus: datos.syllabus || { documentos: [] } }} propietario={propietario} />
          </fieldset>
        </>
      )}
    </div>
  )
}
