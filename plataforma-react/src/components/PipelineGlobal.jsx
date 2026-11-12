import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'
import './matrices.css'

// Vista de coordinación/administración del pipeline guiones → matrices → H5P: en qué va cada curso de todas las personas y qué avisos de
// n8n no se pudieron atribuir. Solo lectura; lee de Praxia (no consulta a n8n).
const MOTIVO = { sin_trabajo: 'No corresponde a ningún trabajo de Praxia', proyecto_distinto: 'El curso del aviso no coincide con el del trabajo' }
const FILTROS = [['todos', 'Todos'], ['enCurso', 'En curso'], ['atencion', 'Requieren atención'], ['sinRespuesta', 'Sin respuesta']]
const hace = (c) => {
  if (!c) return 'sin actividad'
  const s = Math.max(0, Math.round((Date.now() - new Date(c).getTime()) / 1000))
  if (s < 60) return 'hace unos segundos'
  if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min'
  if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h'
  return 'hace ' + Math.round(s / 86400) + ' d'
}
const necesitaAtencion = (f) => f.sinRespuesta > 0 || f.matricesError > 0 || f.errores > 0

function Estado({ f }) {
  if (f.sinRespuesta > 0) return <span className="pill bad">Sin respuesta de n8n</span>
  if (f.matricesError > 0 || f.errores > 0) return <span className="pill bad">Con errores</span>
  if (f.enCurso > 0) return <span className="pill warn">En curso</span>
  if (f.recursos > 0 && f.generados === f.recursos) return <span className="pill ok">Completo</span>
  return <span className="pill">En reposo</span>
}

export default function PipelineGlobal() {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [buscar, setBuscar] = useState('')
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try { setD(await api('GET', '/pipeline/resumen')); setError('') } catch (e) { setError(e.message || 'No se pudo cargar el pipeline.') }
    setCargando(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { const i = setInterval(cargar, 30000); return () => clearInterval(i) }, [cargar])

  const cursos = d ? d.cursos : []
  const cuenta = useMemo(() => ({
    todos: cursos.length,
    enCurso: cursos.filter((f) => f.enCurso > 0).length,
    atencion: cursos.filter(necesitaAtencion).length,
    sinRespuesta: cursos.filter((f) => f.sinRespuesta > 0).length
  }), [cursos])
  const visibles = cursos.filter((f) =>
    (filtro === 'todos' || (filtro === 'enCurso' && f.enCurso > 0) || (filtro === 'atencion' && necesitaAtencion(f)) || (filtro === 'sinRespuesta' && f.sinRespuesta > 0)) &&
    (!buscar.trim() || ((f.curso || f.id) + ' ' + (f.responsable || '') + ' ' + (f.programa || '')).toLowerCase().includes(buscar.trim().toLowerCase())))
  const a = d && d.avisos24h

  return (
    <div className="wrapx fade">
      <Titulo icono="seguimiento">
        <h1>Pipeline de matrices y H5P</h1>
        <p className="lead">Cómo va, en todos los cursos, lo que n8n avisa a Praxia. Es de consulta: para generar hay que abrir el curso desde la cuenta de quien lo creó.</p>
      </Titulo>
      {error && <div className="msg bad" role="alert">{error}</div>}
      {!d && !error && <p className="help">Cargando…</p>}
      {d && (
        <>
          {!d.secretoConfigurado && <div className="msg warn" role="status"><b>Falta el secreto de los avisos.</b> Mientras <code>N8N_EVENTOS_SECRETO</code> no esté en el servidor, Praxia rechaza todo lo que n8n envíe (responde 503).</div>}
          <section className="card mxg-res" aria-label="Resumen">
            <div className="mx-cifras">
              <div><b>{cuenta.todos}</b><span>cursos con datos</span></div>
              <div><b>{cuenta.enCurso}</b><span>en curso</span></div>
              <div className={cuenta.atencion ? 'r' : ''}><b>{cuenta.atencion}</b><span>requieren atención</span></div>
              <div className={a.huerfanos + a.rechazados ? 'r' : ''}><b>{a.huerfanos + a.rechazados}</b><span>avisos sin atribuir (24 h)</span></div>
            </div>
            <button className="btn sec sm" onClick={cargar} disabled={cargando}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>
            <p className="help mxg-ult">{a.ultimoAviso ? 'Último aviso de n8n ' + hace(a.ultimoAviso) + ' · ' + a.aplicados + ' aplicados en las últimas 24 h' : 'n8n no ha enviado avisos en las últimas 24 h.'}</p>
          </section>

          <div className="sg2-filtros">
            <label className="pl2-busca">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <input aria-label="Buscar curso o persona" placeholder="Buscar curso o persona" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            </label>
            <div className="mxg-chips" role="group" aria-label="Filtrar por estado">
              {FILTROS.map(([k, t]) => <button key={k} type="button" className={'btn sm ' + (filtro === k ? '' : 'sec')} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{t} <b>{cuenta[k]}</b></button>)}
            </div>
          </div>

          {visibles.length === 0 ? (
            <div className="drop"><p>{cursos.length ? 'No hay cursos con ese filtro.' : 'Todavía no hay cursos con avisos de n8n.'}</p></div>
          ) : (
            <div className="card sg2-caja">
              <table className="sg-tabla sg2-tabla">
                <thead><tr><th>Curso</th><th>Responsable</th><th>Matrices</th><th>Recursos</th><th>Estado</th><th>Actividad</th></tr></thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr key={f.propietario_id + f.id}>
                      <td><b>{f.curso || f.id}</b><small>{f.programa || (f.curso ? '' : 'El curso ya no existe')}</small></td>
                      <td><span>{f.responsable}</span><small>{f.correo}</small></td>
                      <td>{f.matricesListas} listas{f.matricesError > 0 && <small className="mxg-mal">{f.matricesError} con error</small>}</td>
                      <td>{f.recursos ? <div className="sg2-prog"><span>{f.generados} de {f.recursos} generados{f.errores > 0 ? ' · ' + f.errores + ' con error' : ''}</span><i><b style={{ width: (f.generados / f.recursos * 100) + '%' }} /></i></div> : <span className="sg2-no">—</span>}</td>
                      <td><Estado f={f} /></td>
                      <td>{hace(f.actividad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <section className="card mxg-av" aria-label="Avisos sin atribuir">
            <h3>Avisos que no se pudieron atribuir ({d.avisosProblema.length})</h3>
            <p className="help">n8n envió estos avisos, pero no corresponden a un trabajo de Praxia (o dicen otro curso). No se guardó nada de ellos en ningún curso. Suelen indicar una orden lanzada fuera de Praxia o un identificador mal pasado en n8n.</p>
            {d.avisosProblema.length === 0 ? <p className="mx-vacio">Ninguno. Todo lo recibido se atribuyó a su curso.</p> : (
              <ul className="mxg-lista">
                {d.avisosProblema.map((x) => (
                  <li key={x.eventoId}><b>{x.tipo}</b><span>{MOTIVO[x.motivo] || x.motivo || x.resultado}</span><small>{x.proyectoId ? 'curso ' + x.proyectoId + ' · ' : ''}{hace(x.recibido)}</small></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
