import { useMemo, useState } from 'react'
import Titulo from './Titulo.jsx'

const ESTADOS = {
  listo: ['ok', 'Documentos generados'],
  error: ['warn', 'Con error al generar'],
  pendiente: ['warn', 'Pendiente de generar'],
  sin: ['', 'Sin syllabus generado']
}

// Avance de un syllabus en tres pasos: enviado, documentos por unidad generados, recursos creados.
const PASOS = ['Syllabus enviado', 'Documentos generados', 'Recursos creados']
const avance = (s) => {
  const n = 1 + (s.syllabus.estado === 'listo' && s.syllabus.documentos.length ? 1 : 0) + (s.recursos.length ? 1 : 0)
  return n
}

export default function Dashboard({ lista, onNuevo, onAbrir, onEliminar }) {
  const [prog, setProg] = useState('todos')
  const [q, setQ] = useState('')
  const [seguro, setSeguro] = useState('') // id del syllabus que espera la segunda pulsación para eliminarse

  const programas = useMemo(() => {
    const m = new Map()
    lista.forEach((s) => m.set(s.programa, (m.get(s.programa) || 0) + 1))
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [lista])
  const busca = q.trim().toLowerCase()
  const visibles = lista.filter((s) => (prog === 'todos' || s.programa === prog) && (!busca || (s.curso + ' ' + s.programa).toLowerCase().includes(busca)))
  const porRevisar = lista.find((s) => s.syllabus.estado === 'error' || s.syllabus.estado === 'pendiente')

  const tot = (f) => visibles.reduce((a, s) => a + f(s), 0)
  const resumen = [
    visibles.length + (visibles.length === 1 ? ' syllabus' : ' syllabus'),
    new Set(visibles.map((s) => s.programa)).size + ' programas',
    tot((s) => s.syllabus.documentos.length) + ' documentos por unidad',
    tot((s) => s.recursos.length) + ' recursos creados'
  ].join(' · ')

  const eliminar = (s) => {
    if (seguro !== s.id) { setSeguro(s.id); setTimeout(() => setSeguro((v) => (v === s.id ? '' : v)), 3000); return }
    setSeguro('')
    onEliminar(s)
  }

  return (
    <div className="wrapx fade">
      <div className="db2-cab">
        <Titulo icono="inicio">
          <h1>{prog === 'todos' ? 'Mis syllabus' : prog}</h1>
          <p className="lead">{resumen}</p>
        </Titulo>
        <label className="pl2-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input aria-label="Buscar un syllabus" placeholder="Buscar un syllabus" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className="btn gold db2-nuevo" onClick={onNuevo}>＋ Nuevo curso</button>
      </div>

      {porRevisar && (
        <div className="db2-aviso">
          <span><b>Le falta un paso:</b> «{porRevisar.curso}» {porRevisar.syllabus.estado === 'error' ? 'terminó con error al generar.' : 'está pendiente de generar.'}</span>
          <button className="btn sm" onClick={() => onAbrir(porRevisar.id)}>Continuar donde quedó</button>
        </div>
      )}

      <div className="db2-progs">
        <button className={prog === 'todos' ? 'on' : ''} onClick={() => setProg('todos')}>Todos <span>· {lista.length}</span></button>
        {programas.map(([p, n]) => <button key={p} className={prog === p ? 'on' : ''} onClick={() => setProg(p)}>{p} <span>· {n}</span></button>)}
      </div>


      {lista.length === 0 && (
        <div className="drop" style={{ marginTop: 18 }}>
          <h2>Aún no hay cursos</h2>
          <p>Pulse «Nuevo curso» para empezar: puede crear las unidades desde el syllabus o continuar con unidades que ya existen.</p>
        </div>
      )}

      {lista.length > 0 && (
        <div className="db2-tabla">
          <div className="db2-scroll"><div className="db2-min">
            <div className="db2-fila db2-cabt"><span>Syllabus</span><span>Avance</span><span>Estado</span><span>Acciones</span></div>
            {visibles.map((s) => {
              const [cls, txt] = ESTADOS[s.syllabus.estado] || ESTADOS.sin
              const n = avance(s)
              const listo = n === 3
              return (
                <div className="db2-fila" key={s.id}>
                  <div className="db2-nom"><b>{s.curso}</b><small>{s.programa} · {new Date(s.creado).toLocaleDateString()}</small></div>
                  <div className="db2-av">
                    <div className="db2-seg">{PASOS.map((p, i) => <i key={p} className={i < n ? 'on' : ''} />)}</div>
                    <small>{listo ? 'Todo listo' : `Paso ${n} de 3 · ${PASOS[n - 1]}`}{s.syllabus.documentos.length ? ` · ${s.syllabus.documentos.length} unidades` : ''}</small>
                  </div>
                  <span><span className={'pill ' + cls}>{txt}</span></span>
                  <div className="db2-acc">
                    <button className="btn sm" onClick={() => onAbrir(s.id)}>{listo ? 'Abrir' : 'Continuar'}</button>
                    <button className={'btn danger sm' + (seguro === s.id ? ' sure' : '')} aria-label={'Eliminar ' + s.curso} onClick={() => eliminar(s)}>{seguro === s.id ? '¿Seguro?' : 'Eliminar'}</button>
                  </div>
                </div>
              )
            })}
            {visibles.length === 0 && <div className="db2-vacio">No hay syllabus con esa búsqueda. Pruebe con otra palabra o elija «Todos».</div>}
          </div></div>
        </div>
      )}
    </div>
  )
}
