import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'

// Etapa más avanzada que alcanzó el curso: syllabus → unidades → guiones → recursos.
const ETAPAS = [
  ['syllabus', 'Solo syllabus'],
  ['unidades', 'Hasta unidades'],
  ['guiones', 'Hasta guiones'],
  ['recursos', 'Con recursos']
]
const etapaDe = (f) => (f.recursos > 0 ? 'recursos' : (f.unidades_con_guion > 0 || f.guiones_cargados > 0) ? 'guiones' : f.unidades > 0 ? 'unidades' : 'syllabus')

const fecha = (t) => { try { return new Date(t).toLocaleDateString() } catch { return '' } }
// «hoy», «ayer», «hace 3 días»… y la fecha completa al pasar el cursor.
const relativa = (t) => {
  const d = new Date(t)
  if (isNaN(d)) return ''
  const dias = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  if (dias <= 0) return 'Hoy'
  if (dias === 1) return 'Ayer'
  if (dias < 30) return 'Hace ' + dias + ' días'
  return d.toLocaleDateString()
}
const iniciales = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('')

function Pasos({ etapa }) {
  const n = ETAPAS.findIndex(([k]) => k === etapa)
  return (
    <span className="sg-pasos" aria-hidden="true">
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
  const [orden, setOrden] = useState({ k: 'actualizado', d: -1 })

  useEffect(() => {
    api('GET', '/seguimiento').then(setFilas).catch((e) => setError(e.message || 'No se pudo cargar el seguimiento.'))
  }, [])

  const conEtapa = useMemo(() => (filas || []).map((f) => ({ ...f, etapa: etapaDe(f) })), [filas])
  const responsables = useMemo(() => [...new Set(conEtapa.map((f) => f.responsable))].sort((a, b) => a.localeCompare(b)), [conEtapa])
  const programas = useMemo(() => [...new Set(conEtapa.map((f) => f.programa))].sort((a, b) => a.localeCompare(b)), [conEtapa])
  const visibles = conEtapa.filter((f) =>
    (etapa === 'todas' || f.etapa === etapa) && (responsable === 'todos' || f.responsable === responsable) &&
    (programa === 'todos' || f.programa === programa) && (!buscar.trim() || (f.curso + ' ' + f.programa).toLowerCase().includes(buscar.trim().toLowerCase())))
    .sort((a, b) => {
      const v = orden.k === 'curso' ? a.curso.localeCompare(b.curso)
        : orden.k === 'etapa' ? ETAPAS.findIndex(([k]) => k === a.etapa) - ETAPAS.findIndex(([k]) => k === b.etapa)
        : new Date(a.actualizado) - new Date(b.actualizado)
      return v * orden.d
    })
  const cuenta = (k) => conEtapa.filter((f) => f.etapa === k).length
  const hayFiltros = etapa !== 'todas' || responsable !== 'todos' || programa !== 'todos' || buscar.trim() !== ''
  const limpiar = () => { setEtapa('todas'); setResponsable('todos'); setPrograma('todos'); setBuscar('') }
  const ordenar = (k) => setOrden((o) => (o.k === k ? { k, d: -o.d } : { k, d: k === 'actualizado' ? -1 : 1 }))
  const Th = ({ k, children }) => (
    <th aria-sort={orden.k === k ? (orden.d === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className={'sg2-th' + (orden.k === k ? ' on' : '')} onClick={() => ordenar(k)}>{children}<span aria-hidden="true">{orden.k === k ? (orden.d === 1 ? '↑' : '↓') : '↕'}</span></button>
    </th>
  )

  return (
    <div className="wrapx fade">
      <Titulo icono="seguimiento">
        <h1>Seguimiento de cursos</h1>
        <p className="lead">En qué etapa va cada curso de la facultad. Es de consulta: para trabajar un curso hay que ser quien lo creó.</p>
      </Titulo>
      {error && <div className="msg bad" role="alert">{error}</div>}
      {!filas && !error && <p className="help">Cargando…</p>}
      {filas && (
        <>
          <section className="sg2-resumen" aria-label="Resumen por etapa">
            <div className="sg2-total"><b>{conEtapa.length}</b><span>Cursos</span></div>
            <div className="sg2-embudo">
              <div className="sg2-barra" role="img" aria-label={ETAPAS.map(([k, t]) => cuenta(k) + ' ' + t.toLowerCase()).join(', ')}>
                {conEtapa.length === 0 ? <i className="vacia" style={{ flexGrow: 1 }} /> : ETAPAS.map(([k], i) => cuenta(k) > 0 && <i key={k} className={'e' + i} style={{ flexGrow: cuenta(k) }} />)}
              </div>
              <div className="sg2-leyenda">
                {ETAPAS.map(([k, t], i) => (
                  <button key={k} className={'sg2-f e' + i + (etapa === k ? ' on' : '')} aria-pressed={etapa === k} onClick={() => setEtapa(etapa === k ? 'todas' : k)}>
                    <i /><b>{cuenta(k)}</b><span>{t}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="sg2-filtros">
            <label className="pl2-busca">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <input aria-label="Buscar curso o programa" placeholder="Buscar curso o programa" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            </label>
            <select aria-label="Responsable" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
              <option value="todos">Todas las personas</option>
              {responsables.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select aria-label="Programa" value={programa} onChange={(e) => setPrograma(e.target.value)}>
              <option value="todos">Todos los programas</option>
              {programas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {hayFiltros && <button className="btn sec sm" onClick={limpiar}>Limpiar filtros</button>}
          </div>
          <p className="help sg2-cuenta" role="status">{visibles.length === conEtapa.length ? conEtapa.length + ' cursos' : visibles.length + ' de ' + conEtapa.length + ' cursos'}</p>

          {visibles.length === 0 ? (
            <div className="drop"><p>No hay cursos con esos filtros.</p><div className="row center"><button className="btn sec sm" onClick={limpiar}>Quitar los filtros</button></div></div>
          ) : (
            <div className="card sg2-caja">
              <table className="sg-tabla sg2-tabla">
                <thead><tr><Th k="curso">Curso</Th><th>Responsable</th><Th k="etapa">Etapa</Th><th>Unidades</th><th>Guiones</th><th>Recursos</th><Th k="actualizado">Actualizado</Th></tr></thead>
                <tbody>
                  {visibles.map((f) => {
                    const i = ETAPAS.findIndex(([k]) => k === f.etapa)
                    return (
                      <tr key={f.propietario_id + f.id}>
                        <td><b>{f.curso}</b><small>{f.programa}</small></td>
                        <td><div className="sg2-resp"><span className="sg2-av" aria-hidden="true">{iniciales(f.responsable)}</span><div><span>{f.responsable}</span><small>{f.correo}</small></div></div></td>
                        <td><span className={'sg2-etapa e' + i}><Pasos etapa={f.etapa} />{ETAPAS[i][1]}</span></td>
                        <td>{f.unidades ? <div className="sg2-prog"><span>{f.unidades_aprobadas} de {f.unidades} aprobadas</span><i><b style={{ width: (f.unidades_aprobadas / f.unidades * 100) + '%' }} /></i></div> : <span className="sg2-no">—</span>}</td>
                        <td>{f.unidades_con_guion ? f.unidades_con_guion + (f.unidades ? ' de ' + f.unidades : '') + ' unidades' : f.guiones_cargados ? f.guiones_cargados + ' cargados' : <span className="sg2-no">—</span>}</td>
                        <td>{f.recursos ? <b>{f.recursos}</b> : <span className="sg2-no">—</span>}</td>
                        <td title={fecha(f.actualizado)}>{relativa(f.actualizado)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
