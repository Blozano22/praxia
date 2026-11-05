import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'

// Etapa más avanzada que alcanzó el curso: syllabus → unidades → guiones → recursos.
const ETAPAS = [
  ['syllabus', 'Solo syllabus'],
  ['unidades', 'Hasta unidades'],
  ['guiones', 'Hasta guiones'],
  ['recursos', 'Con recursos']
]
const etapaDe = (f) => (f.recursos > 0 ? 'recursos' : (f.unidades_con_guion > 0 || f.guiones_cargados > 0) ? 'guiones' : f.unidades > 0 ? 'unidades' : 'syllabus')

const fecha = (t) => { try { return new Date(t).toLocaleDateString() } catch { return '' } }

function Pasos({ etapa }) {
  const n = ETAPAS.findIndex(([k]) => k === etapa)
  return (
    <span className="sg-pasos" aria-label={'Etapa: ' + ETAPAS[n][1]}>
      {ETAPAS.map(([k, t], i) => <i key={k} className={i <= n ? 'on' : ''} title={t} />)}
    </span>
  )
}

// Vista de la coordinación: en qué va cada curso, de todas las personas. Solo lectura y solo cifras.
export default function Seguimiento() {
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState('')
  const [etapa, setEtapa] = useState('todas')
  const [responsable, setResponsable] = useState('todos')
  const [programa, setPrograma] = useState('todos')
  const [buscar, setBuscar] = useState('')

  useEffect(() => {
    api('GET', '/seguimiento').then(setFilas).catch((e) => setError(e.message || 'No se pudo cargar el seguimiento.'))
  }, [])

  const conEtapa = useMemo(() => (filas || []).map((f) => ({ ...f, etapa: etapaDe(f) })), [filas])
  const responsables = useMemo(() => [...new Set(conEtapa.map((f) => f.responsable))].sort((a, b) => a.localeCompare(b)), [conEtapa])
  const programas = useMemo(() => [...new Set(conEtapa.map((f) => f.programa))].sort((a, b) => a.localeCompare(b)), [conEtapa])
  const visibles = conEtapa.filter((f) =>
    (etapa === 'todas' || f.etapa === etapa) && (responsable === 'todos' || f.responsable === responsable) &&
    (programa === 'todos' || f.programa === programa) && (!buscar.trim() || (f.curso + ' ' + f.programa).toLowerCase().includes(buscar.trim().toLowerCase())))
  const cuenta = (k) => conEtapa.filter((f) => f.etapa === k).length

  return (
    <div className="wrapx fade">
      <h1>Seguimiento de cursos</h1>
      <p className="lead">En qué etapa va cada curso de la facultad: solo syllabus, hasta las unidades, hasta los guiones o ya con recursos. Es de consulta: para trabajar un curso hay que ser quien lo creó.</p>
      {error && <div className="msg bad" role="alert">{error}</div>}
      {!filas && !error && <p className="help">Cargando…</p>}
      {filas && (
        <>
          <div className="stats">
            <div className="card st"><b>{conEtapa.length}</b><span>Cursos</span></div>
            {ETAPAS.map(([k, t]) => <button key={k} className={'card st sg-filtro' + (etapa === k ? ' on' : '')} onClick={() => setEtapa(etapa === k ? 'todas' : k)}><b>{cuenta(k)}</b><span>{t}</span></button>)}
          </div>
          <div className="row" style={{ margin: '14px 0', alignItems: 'center' }}>
            <input type="text" aria-label="Buscar curso o programa" placeholder="Buscar curso o programa" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <select aria-label="Responsable" value={responsable} onChange={(e) => setResponsable(e.target.value)} style={{ width: 'auto' }}>
              <option value="todos">Todas las personas</option>
              {responsables.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select aria-label="Programa" value={programa} onChange={(e) => setPrograma(e.target.value)} style={{ width: 'auto' }}>
              <option value="todos">Todos los programas</option>
              {programas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {visibles.length === 0 ? <div className="drop"><p>No hay cursos con esos filtros.</p></div> : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="sg-tabla">
                <thead><tr><th>Curso</th><th>Responsable</th><th>Etapa</th><th>Unidades</th><th>Guiones</th><th>Recursos</th><th>Actualizado</th></tr></thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr key={f.propietario_id + f.id}>
                      <td><b>{f.curso}</b><br /><small>{f.programa}</small></td>
                      <td>{f.responsable}<br /><small>{f.correo}</small></td>
                      <td><Pasos etapa={f.etapa} /><br /><small>{ETAPAS.find(([k]) => k === f.etapa)[1]}</small></td>
                      <td>{f.unidades ? f.unidades_aprobadas + ' de ' + f.unidades + ' aprobadas' : '—'}</td>
                      <td>{f.unidades_con_guion ? f.unidades_con_guion + (f.unidades ? ' de ' + f.unidades : '') + ' unidades' : f.guiones_cargados ? f.guiones_cargados + ' cargados' : '—'}</td>
                      <td>{f.recursos || '—'}</td>
                      <td>{fecha(f.actualizado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
