import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'
import DisenoCurso from './DisenoCurso.jsx'
import { leerHash, ponerHash } from '../lib/hashEstado.js'
import './diseno-curso.css'

const IcoCarpeta = ({ size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>

// Inicio del diseñador: los cursos que la coordinación le asignó; cada uno abre su vista de diseño (matrices y H5P).
const ESTADOS = { asignado: 'Asignado', en_revision_docente: 'En revisión del docente', en_diseno: 'Sin asignar' }

export default function MisCursosDiseno() {
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState('')
  // El curso abierto queda en la dirección (?p=<dueño>&c=<curso>): al recargar la página se vuelve a abrir (y DisenoCurso/MatricesH5P restauran el editor).
  const [abierto, setAbierto] = useState(() => (leerHash('p') && leerHash('c') ? { propietario_id: leerHash('p'), proyecto_id: leerHash('c') } : null))
  useEffect(() => { ponerHash(abierto ? { p: abierto.propietario_id, c: abierto.proyecto_id } : { p: '', c: '', r: '', parte: '' }) }, [abierto])
  useEffect(() => { api('GET', '/diseno/mios').then(setFilas).catch((e) => setError(e.message || 'No se pudo cargar.')) }, [])
  if (abierto) return <DisenoCurso propietario={abierto.propietario_id} proyecto={abierto.proyecto_id} onVolver={() => setAbierto(null)} />
  return (
    <div className="wrapx fade">
      <Titulo icono="inicio">
        <h1>Cursos asignados a mí</h1>
        <p className="lead">Cursos que la coordinación le asignó para diseñar.</p>
      </Titulo>
      {error && <div className="msg err" role="alert">{error}</div>}
      {filas && filas.length === 0 && (
        <div className="dc-vacio">
          <span className="dc-vacio-ico" aria-hidden="true"><IcoCarpeta size={28} /></span>
          <h2>Aún no tiene cursos asignados</h2>
          <p>Cuando la coordinación le asigne un curso, aparecerá aquí.</p>
        </div>
      )}
      {filas && filas.length > 0 && (
        <div className="dc-lista" role="list">
          <div className="dc-fila dc-cab" aria-hidden="true"><span>Curso</span><span>Docente</span><span>Estado</span><span>Acciones</span></div>
          {filas.map((f) => (
            <div className="dc-fila" role="listitem" key={f.propietario_id + '/' + f.proyecto_id}>
              <div className="dc-nom"><b>{f.curso || f.proyecto_id}</b><small>{f.programa}</small></div>
              <div className="dc-doc"><span className="dc-lbl">Docente</span>{f.docente}</div>
              <div>
                <span className="dc-lbl">Estado</span>
                <div className="dc-est">
                  <span className={'pill ' + (f.estado === 'en_revision_docente' ? 'warn' : 'ok')}>{ESTADOS[f.estado] || f.estado}</span>
                  {f.correcciones_listas > 0 && <span className="pill ok">{f.correcciones_listas} {f.correcciones_listas === 1 ? 'corrección lista' : 'correcciones listas'} para revisar</span>}
                </div>
              </div>
              <div className="dc-acc">
                {f.carpeta && <a className="btn sec sm" href={f.carpeta} target="_blank" rel="noreferrer"><IcoCarpeta />Carpeta de Drive</a>}
                <button className="btn sm" onClick={() => setAbierto(f)}>Abrir</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
