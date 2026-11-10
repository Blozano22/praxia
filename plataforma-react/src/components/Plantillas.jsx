import { useEffect, useMemo, useRef, useState } from 'react'
import Titulo from './Titulo.jsx'

// Plantillas HTML (carpeta /ejemplos): se cargan solo al abrirlas para no pesar al inicio.
// Los recursos usan la misma paleta DIEPO; los que empiezan por «o-» son HTML hechos a mano, tal cual, repartidos en sus familias.
const ARCHIVOS = import.meta.glob('../../../ejemplos/*.html', { query: '?raw', import: 'default' })
const ORIGINALES = import.meta.glob('../../../ejemplos/originales/*.html', { query: '?raw', import: 'default' })

// Familias del menú: [título, [[clave, nombre]...]]
const GRUPOS = [
  ['Contenido', [['presentacion', 'Presentación'], ['lectura', 'Lectura diagramada'], ['estudio-casos', 'Estudio de casos']]],
  ['Acordeones', [['acordeon', 'Diseño 1'], ['acordeon-v2', 'Diseño 2'], ['acordeon-v3', 'Diseño 3'], ['o-infografia-v2', 'Diseño 4']]],
  ['Actividades (van en cualquier recurso)', [['acordeon-clasificacion', 'Clasificación'], ['acordeon-cuestionario', 'Cuestionario'], ['acordeon-emparejamiento', 'Emparejamiento'], ['acordeon-laboratorio', 'Laboratorio'], ['acordeon-tarea', 'Tarea']]],
  ['Líneas de tiempo', [['o-linea-de-tiempo-v1', 'Diseño 1'], ['linea-tiempo-v2', 'Diseño 2'], ['o-linea-de-tiempo-v3', 'Diseño 3'], ['o-linea-de-tiempo-anterior-carrusel', 'Diseño 4']]],
  ['Crucigramas', [['crucigrama', 'Diseño 1'], ['crucigrama-v2', 'Diseño 2'], ['crucigrama-v3', 'Diseño 3']]],
  ['Infografías', [['infografia-hex', 'Hexagonal'], ['infografia-pines', 'Con pines'], ['infografia-radial', 'Radial'], ['o-infografia-v1', 'Diseño 4']]],
  ['Esquemas', [['diagrama-flujo', 'Diagrama de flujo'], ['mapa-conceptual', 'Mapa conceptual']]]
]

// Nota breve de cada familia (se muestra sobre la lista de diseños).
const NOTAS = {
  Contenido: 'Para presentar el tema de la unidad.',
  Acordeones: 'Cuatro diseños para desplegar contenido por secciones.',
  Actividades: 'Van en cualquier recurso: se insertan dentro de la presentación, la lectura u otro.',
  'Líneas de tiempo': 'Cuatro diseños para ordenar hechos o etapas.',
  Crucigramas: 'Tres diseños de crucigrama.',
  Infografías: 'Cuatro diseños para resumir ideas de forma visual.',
  Esquemas: 'Para mostrar procesos y relaciones.',
}
const corto = (g) => g.replace(/ \(.*\)$/, '')

// { clave: { nivel | 'unico': ruta } }
const CATALOGO = (() => {
  const c = {}
  Object.keys(ARCHIVOS).forEach((ruta) => {
    const m = /\/([a-z0-9-]+?)-(diepo)\.html$/.exec(ruta)
    if (m) (c[m[1]] = c[m[1]] || {})[m[2]] = ruta
  })
  Object.keys(ORIGINALES).forEach((ruta) => {
    const m = /\/([a-z0-9-]+)\.html$/.exec(ruta)
    if (m) c['o-' + m[1]] = { unico: ruta }
  })
  return c
})()
const CARGA = { ...ARCHIVOS, ...ORIGINALES }

export default function Plantillas() {
  const grupos = useMemo(() => GRUPOS.map(([g, l]) => [g, l.filter(([k]) => CATALOGO[k])]).filter(([, l]) => l.length), [])
  const [tipo, setTipo] = useState(grupos[0][1][0][0])
  const [q, setQ] = useState('')
  const [full, setFull] = useState(false)
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const [esc, setEsc] = useState(0.6)
  const caja = useRef(null)

  const ruta = CATALOGO[tipo] && Object.values(CATALOGO[tipo])[0]

  useEffect(() => {
    if (!ruta) return
    let vivo = true
    setHtml(''); setError('')
    CARGA[ruta]().then((t) => { if (vivo) setHtml(t) }).catch(() => { if (vivo) setError('No se pudo cargar la plantilla.') })
    return () => { vivo = false }
  }, [ruta])

  // La plantilla se dibuja a 1280 × 720 (su tamaño real) y se escala al ancho disponible.
  useEffect(() => {
    const el = caja.current
    if (!el) return
    const medir = () => setEsc(el.clientWidth / 1280)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [full])

  useEffect(() => {
    if (!full) return
    const f = (e) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [full])

  const gi = Math.max(0, grupos.findIndex(([, l]) => l.some(([k]) => k === tipo)))
  const [grupoNombre, lista] = grupos[gi]
  const pos = lista.findIndex(([k]) => k === tipo)
  const titulo = (lista[pos] || [])[1] || tipo
  const nombre = tipo.replace(/^o-/, '') + '.html'
  const mover = (d) => setTipo(lista[(pos + d + lista.length) % lista.length][0])
  const todos = useMemo(() => grupos.flatMap(([g, l]) => l.map(([k, n]) => ({ k, n, g }))), [grupos])
  const busca = q.trim().toLowerCase()
  const res = busca ? todos.filter((t) => (t.n + ' ' + t.g).toLowerCase().includes(busca)) : null
  const elegir = (k) => { setTipo(k); setQ('') }

  const abrir = () => { const u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60000) }
  const bajar = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })); a.download = nombre; document.body.append(a); a.click(); a.remove() }

  return (
    <div className="wrapx fade">
      <div className="pl2-cab">
        <Titulo icono="codigo">
          <h1>Plantillas HTML</h1>
          <p className="lead">Así se ven los recursos que genera la plataforma. Elija el tipo y el diseño; puede abrirlo en una pestaña o descargarlo. «Mis HTML originales» son los archivos hechos a mano, sin cambios.</p>
        </Titulo>
        <label className="pl2-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input aria-label="Buscar una plantilla" placeholder="Buscar una plantilla" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <div className="pl2-tabs" role="tablist" aria-label="Tipo de plantilla">
        {grupos.map(([g, l], i) => (
          <button key={g} role="tab" aria-selected={i === gi && !res} className={i === gi && !res ? 'on' : ''} onClick={() => { setQ(''); setTipo(l[0][0]) }}>
            {corto(g)} <span>· {l.length}</span>
          </button>
        ))}
      </div>

      <div className="pl2-cuerpo">
        <section className={'pl2-prev' + (full ? ' full' : '')} aria-label="Vista previa">
          <div className="pl2-barra">
            <div className="pl2-tit"><small>{corto(grupoNombre)}</small><b>{titulo}</b></div>
            <button className="btn sec sm pl2-ic" aria-label="Diseño anterior" onClick={() => mover(-1)}>‹</button>
            <span className="pl2-pos">{pos + 1} / {lista.length}</span>
            <button className="btn sec sm pl2-ic" aria-label="Diseño siguiente" onClick={() => mover(1)}>›</button>
            <button className="btn sec sm" onClick={() => setFull(!full)}>{full ? 'Cerrar pantalla completa' : 'Pantalla completa'}</button>
          </div>
          {error && <div className="msg bad" role="alert">{error}</div>}
          <div className="pl2-caja" ref={caja} style={full ? { maxWidth: 'calc((100vh - 130px) * 16 / 9)' } : undefined}>
            {!html && !error && <p className="help" style={{ padding: 18 }}>Cargando…</p>}
            {html && <iframe sandbox="allow-scripts" title={'Plantilla ' + titulo} srcDoc={html} style={{ width: 1280, height: 720, transform: `scale(${esc})` }} />}
          </div>
          {!full && <p className="help pl2-pie">Se ve a 1280 × 720, sin barras de desplazamiento, con la paleta de la institución.</p>}
        </section>

        <aside className="pl2-lado">
          <div className="card pl2-lista">
            <h4>{res ? `Resultados (${res.length})` : 'Diseños de ' + corto(grupoNombre).toLowerCase()}</h4>
            <p className="help">{res ? `Coinciden con «${q.trim()}».` : NOTAS[corto(grupoNombre)]}</p>
            {(res || lista.map(([k, n]) => ({ k, n, g: '' }))).map((t, i) => (
              <button key={t.k} className={t.k === tipo ? 'on' : ''} onClick={() => elegir(t.k)}>
                <span className="pl2-n">{res ? '•' : i + 1}</span>
                <span><b>{t.n}</b>{res && <small>{t.g}</small>}</span>
              </button>
            ))}
            {res && res.length === 0 && <p className="help">No hay plantillas con esa palabra. Pruebe con «acordeón» o «tiempo».</p>}
          </div>
          <div className="card pl2-uso">
            <h4>Usar esta plantilla</h4>
            <button className="btn" disabled={!html} onClick={abrir}>Abrir en pestaña</button>
            <button className="btn sec" disabled={!html} onClick={bajar}>Descargar</button>
            <ul>
              <li>Cabe en 1280 × 720 sin desplazamiento</li>
              <li>Compatible con SCORM 1.2</li>
              <li>{corto(grupoNombre) === 'Actividades' ? 'Va en cualquier recurso' : (tipo.startsWith('o-') ? 'Archivo original, sin cambios' : 'Misma paleta de la institución')}</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}
