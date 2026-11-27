import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'
import './asignacion-diseno.css'

// «Asignación a diseño» (coordinación): cursos que los docentes enviaron a diseño; se asignan o reasignan a un diseñador, a mano o con «Asignación rápida» (el de menor carga).
const ESTADOS = { en_diseno: ['warn', 'Sin asignar'], asignado: ['ok', 'Asignado'], en_revision_docente: ['info', 'En revisión del docente'] }
const FILTROS = [['todos', 'Todos'], ['sin', 'Sin asignar'], ['asignados', 'Asignados'], ['revision', 'En revisión']]
const coincide = (f, filtro) => filtro === 'todos' || (filtro === 'sin' && f.estado === 'en_diseno') || (filtro === 'asignados' && f.estado === 'asignado') || (filtro === 'revision' && f.estado === 'en_revision_docente')
const fecha = (t) => { try { return new Date(t).toLocaleDateString() } catch { return '' } }
const RAYO = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>

export default function AsignacionDiseno() {
  const [filas, setFilas] = useState(null)
  const [disenadores, setDisenadores] = useState([])
  const [filtro, setFiltro] = useState('sin')
  const [elegido, setElegido] = useState({}) // clave del curso → id del diseñador elegido
  const [ocupado, setOcupado] = useState('')
  const [error, setError] = useState('')
  const [avisos, setAvisos] = useState([]) // resultados de Drive por revisar: { clave, curso, drive, carpeta }

  const cargar = () => Promise.all([api('GET', '/diseno/bandeja'), api('GET', '/diseno/disenadores')])
    .then(([b, d]) => { setFilas(b); setDisenadores(d) })
    .catch((e) => setError(e.message || 'No se pudo cargar la bandeja.'))
  useEffect(() => { cargar() }, [])

  const clave = (f) => f.propietario_id + '/' + f.proyecto_id
  const visibles = useMemo(() => (filas || []).filter((f) => coincide(f, filtro)), [filas, filtro])
  const sinAsignar = (filas || []).filter((f) => f.estado === 'en_diseno' && !f.disenador_id).length

  const registrarAviso = (f, r) => {
    if (r.drive_compartido === 'ok') return
    setAvisos((a) => [...a.filter((x) => x.clave !== clave(f)), { clave: clave(f), curso: f.curso || f.proyecto_id, drive: r.drive_compartido, carpeta: r.carpeta || f.carpeta }])
  }
  const asignar = async (f, rapido) => {
    const id = elegido[clave(f)]
    if (!rapido && !id) return
    setOcupado(clave(f) + (rapido ? '/r' : '')); setError('')
    try {
      const r = rapido ? await api('POST', '/diseno/asignar-rapido', { propietarioId: f.propietario_id, proyectoId: f.proyecto_id })
        : await api('POST', '/diseno/asignar', { propietarioId: f.propietario_id, proyectoId: f.proyecto_id, disenadorId: id })
      registrarAviso(f, r)
      setElegido((e) => { const n = { ...e }; delete n[clave(f)]; return n })
      await cargar()
    } catch (e) { setError(e.message || 'No se pudo asignar.') }
    setOcupado('')
  }
  const todos = async () => {
    setOcupado('todos'); setError('')
    try {
      const r = await api('POST', '/diseno/asignar-rapido-todos', {})
      setAvisos((a) => [...a, ...r.hechos.filter((h) => h.drive_compartido !== 'ok').map((h) => ({ clave: 'h/' + h.proyecto_id, curso: h.proyecto_id, drive: h.drive_compartido, carpeta: h.carpeta }))])
      if (r.fallos.length) setError(r.fallos.length + ' no se pudieron asignar: ' + r.fallos[0].error)
      await cargar()
    } catch (e) { setError(e.message || 'No se pudo asignar.') }
    setOcupado('')
  }

  return (
    <div className="wrapx fade">
      <Titulo icono="inicio">
        <h1>Asignación a diseño</h1>
        <p className="lead">Cursos enviados a diseño por los docentes. Asigne cada uno a un diseñador.</p>
      </Titulo>
      {error && <div className="msg err" role="alert">{error}</div>}
      {avisos.map((a) => (
        <div className="db2-aviso" key={a.clave} role="status">
          <span><b>Comparta la carpeta manualmente</b> con el diseñador de «{a.curso}»{a.drive && a.drive !== 'sin_configurar' ? ' (' + a.drive + ')' : ''}.{' '}
            {a.carpeta ? <a href={a.carpeta} target="_blank" rel="noreferrer">Abrir la carpeta del curso</a> : 'El curso no tiene carpeta de Drive registrada.'}</span>
          <button className="btn sm sec" onClick={() => setAvisos((x) => x.filter((y) => y !== a))}>Entendido</button>
        </div>
      ))}
      {filas && (
        <div className="ad-resumen">
          <div className="ad-cifra warn"><b>{sinAsignar}</b> sin asignar</div>
          <div className="ad-cifra ok"><b>{filas.filter((f) => f.estado === 'asignado').length}</b> asignados</div>
          <div className="ad-cifra"><b>{filas.filter((f) => f.estado === 'en_revision_docente').length}</b> en revisión</div>
        </div>
      )}
      <div className="ad-barra">
        <div className="ad-tabs" role="group" aria-label="Filtrar cursos">
          {FILTROS.map(([k, t]) => <button key={k} className={filtro === k ? 'on' : ''} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{t} <span>{(filas || []).filter((f) => coincide(f, k)).length}</span></button>)}
        </div>
        {sinAsignar > 0 && <button className="btn gold sm ad-todos" disabled={ocupado === 'todos'} onClick={todos}>{RAYO}{ocupado === 'todos' ? 'Asignando…' : 'Asignar todos los pendientes (' + sinAsignar + ')'}</button>}
      </div>
      {filas === null && !error && <p className="lead">Cargando…</p>}
      {filas && visibles.length === 0 && (
        <div className="ad-vacio">
          <span className="ad-vacio-ico"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg></span>
          <b>No hay cursos en esta lista</b>
          <span>Cuando un docente envíe un curso a diseño aparecerá aquí.</span>
        </div>
      )}
      {filas && visibles.length > 0 && (
        <div className="ad-lista">
          <div className="ad-fila ad-cab"><span>Curso</span><span>Docente</span><span>Enviado</span><span>Estado</span><span>Diseñador</span></div>
          {visibles.map((f) => {
            const [cls, txt] = ESTADOS[f.estado] || ['', f.estado]
            const k = clave(f)
            const valor = elegido[k] !== undefined ? elegido[k] : ''
            const asignado = f.estado !== 'en_diseno'
            return (
              <div className="ad-fila" key={k}>
                <div className="ad-nom"><b>{f.curso || f.proyecto_id}</b>{f.programa && <small>{f.programa}</small>}</div>
                <div className="ad-doc" title={f.docente_correo}><span className="ad-lbl">Docente</span>{f.docente}</div>
                <div className="ad-fecha"><span className="ad-lbl">Enviado</span>{fecha(f.enviado_en)}</div>
                <div className="ad-est"><span className="ad-lbl">Estado</span><span className={'pill ' + cls}>{txt}</span></div>
                <div className="ad-acc">
                  <select aria-label={'Diseñador para ' + (f.curso || f.proyecto_id)} value={valor} onChange={(e) => setElegido({ ...elegido, [k]: e.target.value })}>
                    <option value="">{f.disenador ? 'Actual: ' + f.disenador : 'Elegir diseñador…'}</option>
                    {disenadores.map((d) => <option key={d.id} value={d.id}>{d.nombre} ({d.carga} {d.carga === 1 ? 'curso' : 'cursos'})</option>)}
                  </select>
                  <button className="btn sm" disabled={!valor || valor === f.disenador_id || !!ocupado} onClick={() => asignar(f, false)}>{asignado ? 'Reasignar' : 'Asignar'}</button>
                  <button className="btn sm sec" disabled={!!ocupado} onClick={() => asignar(f, true)}>{RAYO}Asignación rápida</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
