import { useEffect, useMemo, useRef, useState } from 'react'
import Titulo from './Titulo.jsx'
import RevisionPlantilla, { ESTADO } from './RevisionPlantilla.jsx'
import CategoriasPlantillas from './CategoriasPlantillas.jsx'
import { api } from '../lib/api.js'

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
// Las plantillas publicadas (las que descarga n8n) se llaman casi igual que los diseños de la galería: acordeon-v2 → acordeon-2.
const NOMBRE_PUBLICO = { 'estudio-casos': 'casos', 'diagrama-flujo': 'flujo', 'mapa-conceptual': 'mapa', 'linea-tiempo': 'lineatiempo' }
const nombrePublico = (k) => {
  if (k.startsWith('o-')) return '' // los HTML originales hechos a mano no se publican
  const m = /^(.*?)(?:-v(\d+))?$/.exec(k)
  const base = NOMBRE_PUBLICO[m[1]] || m[1]
  return m[2] ? base + '-' + m[2] : base
}
const corto = (g) => g.replace(/ \(.*\)$/, '')
// Hay dos clases de HTML: los recursos y las actividades de autoaprendizaje (el crucigrama, el cuestionario…). La galería muestra una clase a la vez.
const esActividad = (g) => /^(Actividades|Crucigramas)/.test(g)
const CLASES = { recurso: 'Recursos', actividad: 'Actividades' }

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

export default function Plantillas({ puedeRevisar = false, puedeCorregir = false, yo = null, aviso }) {
  const gruposTodos = useMemo(() => GRUPOS.map(([g, l]) => [g, l.filter(([k]) => CATALOGO[k])]).filter(([, l]) => l.length), [])
  const [clase, setClase] = useState('recurso') // qué clase de HTML se ve en la galería: recurso | actividad
  const grupos = useMemo(() => gruposTodos.filter(([g]) => (esActividad(g) ? 'actividad' : 'recurso') === clase), [gruposTodos, clase])
  const [vista, setVista] = useState('galeria') // galeria | categorias (las categorías que usa n8n)
  const [tipo, setTipo] = useState(() => (gruposTodos.find(([g]) => !esActividad(g)) || gruposTodos[0])[1][0][0])
  const [q, setQ] = useState('')
  const [full, setFull] = useState(false)
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')
  const [esc, setEsc] = useState(0.6)
  const caja = useRef(null)
  const [cats, setCats] = useState(null) // categorías (ID del catálogo) y a cuál pertenece cada plantilla publicada
  useEffect(() => { if (vista === 'galeria') api('GET', '/plantillas/categorias').then(setCats).catch(() => {}) }, [vista])
  const [revisiones, setRevisiones] = useState([]) // de la más nueva a la más antigua
  useEffect(() => { api('GET', '/plantillas/revisiones').then(setRevisiones).catch(() => {}) }, [])
  const deTipo = (k) => revisiones.filter((r) => r.plantilla === k)

  const ruta = CATALOGO[tipo] && Object.values(CATALOGO[tipo])[0]
  // Código del recurso (ID del catálogo, p. ej. G-12) del diseño: el de su plantilla publicada o, si no se publica (un HTML original) y
  // todos los diseños con código de su familia comparten el mismo, ese.
  const codigoDe = (k) => {
    if (!cats) return null
    let id = cats.asignaciones[nombrePublico(k)]
    if (!id) {
      const g = gruposTodos.find(([, l]) => l.some(([x]) => x === k))
      const ids = g ? new Set(g[1].map(([x]) => cats.asignaciones[nombrePublico(x)]).filter(Boolean)) : new Set()
      if (ids.size === 1) id = [...ids][0]
    }
    return id ? (cats.categorias.find((c) => c.id === id) || { id, nombre: '', tipo: '' }) : null
  }
  const seaPublica = (k) => !!cats && cats.plantillas.includes(nombrePublico(k))
  const codigoActual = codigoDe(tipo)

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
    // Un ancho de 0 (la galería oculta o desmontada) no es una medida válida: dejaría la vista previa a escala 0, en blanco.
    const medir = () => { const w = el.clientWidth; if (w > 0) setEsc(w / 1280) }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [full, vista])

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

  const conmutador = (
    <div className="pl2-vistas" role="tablist" aria-label="Qué ver">
      <button role="tab" aria-selected={vista === 'galeria'} className={vista === 'galeria' ? 'on' : ''} onClick={() => setVista('galeria')}>Galería de diseños</button>
      <button role="tab" aria-selected={vista === 'categorias'} className={vista === 'categorias' ? 'on' : ''} onClick={() => setVista('categorias')}>Categorías para n8n</button>
    </div>
  )
  if (vista === 'categorias') {
    return (
      <div className="wrapx fade">
        <div className="pl2-cab">
          <Titulo icono="codigo"><h1>Plantillas HTML</h1></Titulo>
        </div>
        {conmutador}
        <CategoriasPlantillas puedeCambiar={puedeRevisar} aviso={aviso} />
      </div>
    )
  }

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

      {conmutador}
      <div className="pl2-vistas pl2-clases" role="tablist" aria-label="Clase de HTML">
        {['recurso', 'actividad'].map((c) => {
          const g = gruposTodos.filter(([n]) => (esActividad(n) ? 'actividad' : 'recurso') === c)
          const total = g.reduce((a, [, l]) => a + l.length, 0)
          return <button key={c} role="tab" aria-selected={clase === c} className={clase === c ? 'on' : ''} disabled={!g.length} onClick={() => { setClase(c); setQ(''); if (g.length) setTipo(g[0][1][0][0]) }}>{CLASES[c]} <span>· {total}</span></button>
        })}
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
          {!full && <RevisionPlantilla key={tipo} plantilla={tipo} titulo={titulo} historial={deTipo(tipo)} puedeRevisar={puedeRevisar} puedeCorregir={puedeCorregir} yo={yo} aviso={aviso} onNueva={(r) => setRevisiones((l) => [r, ...l])} onEditada={(r) => setRevisiones((l) => l.map((x) => (x.id === r.id ? r : x)))} />}
        </section>

        <aside className="pl2-lado">
          <div className="card pl2-lista">
            <h4>{res ? `Resultados (${res.length})` : 'Diseños de ' + corto(grupoNombre).toLowerCase()}</h4>
            <p className="help">{res ? `Coinciden con «${q.trim()}».` : NOTAS[corto(grupoNombre)]}</p>
            {(res || lista.map(([k, n]) => ({ k, n, g: '' }))).map((t, i) => (
              <button key={t.k} className={t.k === tipo ? 'on' : ''} onClick={() => elegir(t.k)}>
                <span className="pl2-n">{res ? '•' : i + 1}</span>
                <span><b>{t.n}</b>{res && <small>{t.g}</small>}</span>
                {codigoDe(t.k) && <span className="pl2-cod" title={codigoDe(t.k).nombre}>{codigoDe(t.k).id}</span>}
                {deTipo(t.k)[0] && <span className={'pill rv-mini ' + ESTADO[deTipo(t.k)[0].estado].clase}>{ESTADO[deTipo(t.k)[0].estado].texto}</span>}
              </button>
            ))}
            {res && res.length === 0 && <p className="help">No hay plantillas con esa palabra. Pruebe con «acordeón» o «tiempo».</p>}
          </div>
          <div className="card pl2-uso">
            <h4>Usar esta plantilla</h4>
            <div className={'pl2-codigo' + (codigoActual ? '' : ' sin')}>
              <span>Código del recurso</span>
              {codigoActual ? <><b>{codigoActual.id}</b><small>{codigoActual.nombre}</small></> : <small>{seaPublica(tipo) ? 'Sin categoría todavía (se asigna en «Categorías para n8n»)' : 'Este diseño no se publica para n8n'}</small>}
            </div>
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
