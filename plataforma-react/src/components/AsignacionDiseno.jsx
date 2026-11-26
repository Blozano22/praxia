import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import Titulo from './Titulo.jsx'

// «Asignación a diseño» (coordinación): cursos que los docentes enviaron a diseño; se asignan o reasignan a un diseñador, a mano o con «Asignación rápida» (el de menor carga).
const ESTADOS = { en_diseno: ['warn', 'Sin asignar'], asignado: ['ok', 'Asignado'], en_revision_docente: ['', 'En revisión del docente'] }
const FILTROS = [['todos', 'Todos'], ['sin', 'Sin asignar'], ['asignados', 'Asignados'], ['revision', 'En revisión']]
const coincide = (f, filtro) => filtro === 'todos' || (filtro === 'sin' && f.estado === 'en_diseno') || (filtro === 'asignados' && f.estado === 'asignado') || (filtro === 'revision' && f.estado === 'en_revision_docente')
const fecha = (t) => { try { return new Date(t).toLocaleDateString() } catch { return '' } }
const COLS = { display: 'grid', gridTemplateColumns: '1.6fr 1fr 1.2fr .7fr 1fr 2.4fr', gap: 10, alignItems: 'center' }

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
        <p className="lead">Cursos que los docentes enviaron a diseño. Asigne cada uno a un diseñador; la carga cuenta los cursos asignados o en revisión.</p>
      </Titulo>
      {error && <div className="msg err" role="alert">{error}</div>}
      {avisos.map((a) => (
        <div className="db2-aviso" key={a.clave} role="status">
          <span><b>Comparta la carpeta manualmente</b> con el diseñador de «{a.curso}»{a.drive && a.drive !== 'sin_configurar' ? ' (' + a.drive + ')' : ''}.{' '}
            {a.carpeta ? <a href={a.carpeta} target="_blank" rel="noreferrer">Abrir la carpeta del curso</a> : 'El curso no tiene carpeta de Drive registrada.'}</span>
          <button className="btn sm sec" onClick={() => setAvisos((x) => x.filter((y) => y !== a))}>Entendido</button>
        </div>
      ))}
      <div className="db2-progs">
        {FILTROS.map(([k, t]) => <button key={k} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{t} <span>· {(filas || []).filter((f) => coincide(f, k)).length}</span></button>)}
        <button className="btn gold sm" style={{ marginLeft: 'auto' }} disabled={!sinAsignar || ocupado === 'todos'} onClick={todos}>{ocupado === 'todos' ? 'Asignando…' : 'Asignar todos los pendientes (' + sinAsignar + ')'}</button>
      </div>
      {filas === null && !error && <p className="lead">Cargando…</p>}
      {filas && (
        <div className="db2-tabla"><div className="db2-scroll"><div className="db2-min" style={{ minWidth: 980 }}>
          <div className="db2-fila db2-cabt" style={COLS}><span>Curso</span><span>Programa</span><span>Docente</span><span>Enviado</span><span>Estado</span><span>Diseñador</span></div>
          {visibles.map((f) => {
            const [cls, txt] = ESTADOS[f.estado] || ['', f.estado]
            const k = clave(f)
            const valor = elegido[k] !== undefined ? elegido[k] : ''
            const asignado = f.estado !== 'en_diseno'
            return (
              <div className="db2-fila" key={k} style={COLS}>
                <div className="db2-nom"><b>{f.curso || f.proyecto_id}</b></div>
                <span>{f.programa || '—'}</span>
                <span title={f.docente_correo}>{f.docente}</span>
                <span>{fecha(f.enviado_en)}</span>
                <span><span className={'pill ' + cls}>{txt}</span></span>
                <div className="db2-acc" style={{ flexWrap: 'wrap' }}>
                  <select aria-label={'Diseñador para ' + (f.curso || f.proyecto_id)} value={valor} onChange={(e) => setElegido({ ...elegido, [k]: e.target.value })}>
                    <option value="">{f.disenador ? 'Actual: ' + f.disenador : 'Elegir diseñador…'}</option>
                    {disenadores.map((d) => <option key={d.id} value={d.id}>{d.nombre} ({d.carga} {d.carga === 1 ? 'curso' : 'cursos'})</option>)}
                  </select>
                  <button className="btn sm" disabled={!valor || valor === f.disenador_id || !!ocupado} onClick={() => asignar(f, false)}>{asignado ? 'Reasignar' : 'Asignar'}</button>
                  <button className="btn sm sec" disabled={!!ocupado} onClick={() => asignar(f, true)}>Asignación rápida</button>
                </div>
              </div>
            )
          })}
          {visibles.length === 0 && <div className="db2-vacio">No hay cursos en esta lista.</div>}
        </div></div></div>
      )}
    </div>
  )
}
