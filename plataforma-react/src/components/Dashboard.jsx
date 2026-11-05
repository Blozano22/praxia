import { useMemo, useState } from 'react'
import { guardarWebhook, guardarWebhookGuiones, leerWebhook, leerWebhookGuiones, WEBHOOK_GUIONES_POR_DEFECTO, WEBHOOK_POR_DEFECTO } from '../lib/syllabus.js'

const ESTADOS = {
  listo: ['ok', 'Documentos generados'],
  error: ['warn', 'Con error al generar'],
  pendiente: ['warn', 'Pendiente de generar'],
  sin: ['', 'Sin syllabus generado']
}

export default function Dashboard({ lista, onNuevo, onAbrir, onEliminar }) {
  const [prog, setProg] = useState('todos')
  const [conf, setConf] = useState(false)
  const [url, setUrl] = useState(leerWebhook())
  const [urlG, setUrlG] = useState(leerWebhookGuiones())

  const programas = useMemo(() => {
    const m = new Map()
    lista.forEach((s) => m.set(s.programa, (m.get(s.programa) || 0) + 1))
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [lista])
  const visibles = lista.filter((s) => prog === 'todos' || s.programa === prog)
  const grupos = useMemo(() => {
    const m = new Map()
    visibles.forEach((s) => { if (!m.has(s.programa)) m.set(s.programa, []); m.get(s.programa).push(s) })
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [visibles])

  const tot = (f) => visibles.reduce((a, s) => a + f(s), 0)
  const stats = [
    ['Programas', new Set(visibles.map((s) => s.programa)).size],
    ['Syllabus', visibles.length],
    ['Documentos por unidad', tot((s) => s.syllabus.documentos.length)],
    ['Recursos creados', tot((s) => s.recursos.length)]
  ]

  return (
    <div className="dash fade">
      <aside className="side">
        <button className="btn gold" style={{ width: '100%' }} onClick={onNuevo}>＋ Crear unidades</button>
        <h4>Programas</h4>
        <button className={'sd' + (prog === 'todos' ? ' on' : '')} onClick={() => setProg('todos')}><span>Todos</span><b>{lista.length}</b></button>
        {programas.map(([p, n]) => (
          <button key={p} className={'sd' + (prog === p ? ' on' : '')} onClick={() => setProg(p)}><span>{p}</span><b>{n}</b></button>
        ))}
        {location.hash === '#config' && <div style={{ marginTop: 22 }}>
          <button className="btn sec sm" style={{ width: '100%' }} onClick={() => setConf(!conf)}>Conexión con n8n</button>
          {conf && (
            <div className="card" style={{ marginTop: 8, padding: 12 }}>
              <label className="l" style={{ marginTop: 0 }}>Dirección (webhook) que genera los documentos</label>
              <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
              <label className="l">Dirección (webhook) que crea los guiones de una unidad</label>
              <input type="text" value={urlG} onChange={(e) => setUrlG(e.target.value)} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={() => {
                  guardarWebhook(url.trim() === WEBHOOK_POR_DEFECTO ? '' : url.trim())
                  guardarWebhookGuiones(urlG.trim() === WEBHOOK_GUIONES_POR_DEFECTO ? '' : urlG.trim())
                  setConf(false)
                }}>Guardar</button>
                <button className="btn sec sm" onClick={() => { setUrl(WEBHOOK_POR_DEFECTO); setUrlG(WEBHOOK_GUIONES_POR_DEFECTO); guardarWebhook(''); guardarWebhookGuiones('') }}>Valores originales</button>
              </div>
            </div>
          )}
        </div>}
      </aside>
      <main className="dmain">
        <h1>{prog === 'todos' ? 'Todos los syllabus' : prog}</h1>
        <p className="lead">Cada syllabus tiene su propio espacio de trabajo: primero se generan sus documentos por unidad y, dentro de él, se crean sus recursos.</p>
        <div className="stats">
          {stats.map(([n, v]) => <div className="card st" key={n}><b>{v}</b><span>{n}</span></div>)}
        </div>
        {lista.length === 0 && (
          <div className="drop" style={{ marginTop: 18 }}>
            <h2>Aún no hay unidades</h2>
            <p>Pegue el enlace del syllabus y la carpeta de Drive: la plataforma genera los documentos de cada unidad.</p>
            <div className="row center" style={{ marginTop: 10 }}><button className="btn" onClick={onNuevo}>＋ Crear unidades desde el syllabus</button></div>
          </div>
        )}
        {grupos.map(([programa, items]) => (
          <section key={programa}>
            <h2>{programa} <span className="pill">{items.length}</span></h2>
            <div className="grid">
              {items.map((s) => {
                const [cls, txt] = ESTADOS[s.syllabus.estado] || ESTADOS.sin
                return (
                  <div className="card sy" key={s.id}>
                    <h3>{s.curso}</h3>
                    <p className="help" style={{ margin: 0 }}>{programa} · {new Date(s.creado).toLocaleDateString()}</p>
                    <div className="row" style={{ margin: '8px 0' }}>
                      <span className={'pill ' + cls}>{txt}{s.syllabus.documentos.length ? ' · ' + s.syllabus.documentos.length + ' unidades' : ''}</span>
                      <span className="pill">{s.recursos.length} recursos</span>
                    </div>
                    <div className="row" style={{ marginTop: 'auto' }}>
                      <button className="btn sm" onClick={() => onAbrir(s.id)}>Abrir</button>
                      <button className="btn danger sm" onClick={() => { if (confirm('¿Eliminar el syllabus «' + s.curso + '» con todo lo que contiene?')) onEliminar(s) }}>Eliminar</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
