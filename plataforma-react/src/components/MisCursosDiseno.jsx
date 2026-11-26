import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'

// Inicio del diseñador: los cursos que la coordinación le asignó. Solo lectura por ahora (operar el curso llega en la siguiente fase).
const ESTADOS = { asignado: 'Asignado', en_revision_docente: 'En revisión del docente', en_diseno: 'Sin asignar' }

export default function MisCursosDiseno() {
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api('GET', '/diseno/mios').then(setFilas).catch((e) => setError(e.message || 'No se pudo cargar.')) }, [])
  return (
    <div className="wrapx fade">
      <Titulo icono="inicio">
        <h1>Cursos asignados a mí</h1>
        <p className="lead">Cursos que la coordinación le asignó para diseñar.</p>
      </Titulo>
      {error && <div className="msg err" role="alert">{error}</div>}
      {filas && filas.length === 0 && <div className="drop"><h2>Aún no tiene cursos asignados</h2></div>}
      {filas && filas.length > 0 && (
        <div className="db2-tabla"><div className="db2-scroll"><div className="db2-min">
          <div className="db2-fila db2-cabt"><span>Curso</span><span>Docente</span><span>Estado</span><span>Acciones</span></div>
          {filas.map((f) => (
            <div className="db2-fila" key={f.propietario_id + '/' + f.proyecto_id}>
              <div className="db2-nom"><b>{f.curso || f.proyecto_id}</b><small>{f.programa}</small></div>
              <span>{f.docente}</span>
              <span><span className="pill">{ESTADOS[f.estado] || f.estado}</span></span>
              <span>{f.carpeta ? <a href={f.carpeta} target="_blank" rel="noreferrer">Carpeta de Drive</a> : ''} <small>Disponible en la siguiente fase</small></span>
            </div>
          ))}
        </div></div></div>
      )}
    </div>
  )
}
