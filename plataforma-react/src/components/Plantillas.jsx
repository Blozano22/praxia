import { useEffect, useMemo, useRef, useState } from 'react'
import Titulo from './Titulo.jsx'
import RevisionPlantilla, { ESTADO } from './RevisionPlantilla.jsx'
import CategoriasPlantillas from './CategoriasPlantillas.jsx'
import { api, RUTA_API } from '../lib/api.js'
import { CARGA, CATALOGO, ejemploDe, nombrePublico } from '../lib/ejemplos.js'


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
// Hay dos clases de HTML: los recursos y las actividades de autoaprendizaje (el crucigrama, el cuestionario…). La galería muestra una clase a la vez.
const esActividad = (g) => /^(Actividades|Crucigramas)/.test(g)
const CLASES = { recurso: 'Recursos', actividad: 'Actividades' }


export default function Plantillas({ puedeRevisar = false, puedeCorregir = false, yo = null, aviso }) {
  const gruposTodos = useMemo(() => GRUPOS.map(([g, l]) => [g, l.filter(([k]) => CATALOGO[k])]).filter(([, l]) => l.length), [])
  const [clase, setClase] = useState('recurso') // qué clase de HTML se ve en la galería: recurso | actividad
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
  // Código del recurso (ID del catálogo, p. ej. G-12) del diseño. Cuenta solo la plantilla publicada que sigue ACTIVA para n8n (existe y no está
  // «quitada de n8n»): es la misma regla que el número de variantes de «Categorías para n8n». Si el diseño no se publica (un HTML original
  // hecho a mano) y todos los diseños con código de su familia comparten el mismo, hereda ese.
  const activas = useMemo(() => new Set(cats ? cats.plantillas.filter((n) => !(cats.ocultas || []).includes(n)) : []), [cats])
  const directo = (k) => { const n = nombrePublico(k); return n && activas.has(n) ? cats.asignaciones[n] || null : null }
  const codigoDe = (k) => {
    if (!cats) return null
    let id = directo(k)
    // Solo los originales hechos a mano (que no se publican) heredan la categoría de su familia. Un diseño que SÍ es una plantilla publicada
    // y no tiene categoría (o está quitada de n8n) no la hereda: se queda sin categoría hasta que se le asigne una.
    if (!id && !nombrePublico(k)) {
      const g = gruposTodos.find(([, l]) => l.some(([x]) => x === k))
      const ids = g ? new Set(g[1].map(([x]) => directo(x)).filter(Boolean)) : new Set()
      if (ids.size === 1) id = [...ids][0]
    }
    return id ? (cats.categorias.find((c) => c.id === id) || { id, nombre: '', tipo: '' }) : null
  }
  const seaPublica = (k) => !!cats && activas.has(nombrePublico(k))
  const estaQuitada = (k) => !!cats && (cats.ocultas || []).includes(nombrePublico(k))
  const codigoActual = codigoDe(tipo)

  // Las pestañas son las CATEGORÍAS de «Categorías para n8n» (ID + nombre) y solo salen las que tienen diseños; los diseños que aún no tienen
  // categoría van en «Sin categoría». Las revisiones y observaciones de cada diseño siguen atadas a su clave (no cambia al reagrupar).
  // Mientras no se conocen las categorías se muestran las familias de siempre.
  const gruposPorClase = useMemo(() => {
    const res = { recurso: [], actividad: [] }
    const claseFija = (g) => (esActividad(g) ? 'actividad' : 'recurso')
    if (!cats) { gruposTodos.forEach(([g, l]) => res[claseFija(g)].push([g, l])); return res }
    const porCat = new Map()
    const sin = { recurso: [], actividad: [] }
    gruposTodos.forEach(([g, l]) => l.forEach(([k, n]) => {
      const c = codigoDe(k)
      if (c) { if (!porCat.has(c.id)) porCat.set(c.id, { c, items: [] }); porCat.get(c.id).items.push([k, n, !!directo(k)]) }
      // Sin categoría no se muestra, salvo que el diseño ya tenga una revisión u observación: así no se pierde de vista.
      else if (revisiones.some((r) => r.plantilla === k)) sin[claseFija(g)].push([k, /^Diseño \d+$/.test(n) ? corto(g) + ' · ' + n : n])
    }))
    // Toda variante ACTIVA con categoría aparece, aunque la galería no la liste o no tenga un ejemplo con contenido (lineatiempo, podcast, portada…):
    // si hay un ejemplo en /ejemplos se usa; si no, se muestra la plantilla tal cual con la etiqueta «sin ejemplo».
    const representadas = new Set(gruposTodos.flatMap(([, l]) => l.map(([k]) => nombrePublico(k))).filter(Boolean))
    cats.plantillas.filter((n) => activas.has(n) && cats.asignaciones[n] && !representadas.has(n)).forEach((n) => {
      const c = cats.categorias.find((x) => x.id === cats.asignaciones[n])
      if (!c) return
      const ej = ejemploDe(n)
      if (!porCat.has(c.id)) porCat.set(c.id, { c, items: [] })
      porCat.get(c.id).items.push([ej || 'pub-' + n, n, true, !ej])
    })
    ;[...porCat.values()].sort((x, y) => x.c.id.localeCompare(y.c.id)).forEach(({ c, items }) => res[c.tipo === 'actividad' ? 'actividad' : 'recurso'].push([c.nombre || c.id, items]))
    ;['recurso', 'actividad'].forEach((t) => { if (sin[t].length) res[t].push(['Sin categoría', sin[t]]) })
    return res
  }, [cats, activas, gruposTodos, revisiones])
  const grupos = gruposPorClase[clase]
  // si el diseño elegido ya no está en lo que se muestra (cambió la clase o llegaron las categorías), se elige el primero
  useEffect(() => { if (grupos.length && !grupos.some(([, l]) => l.some(([k]) => k === tipo))) setTipo(grupos[0][1][0][0]) }, [grupos]) // eslint-disable-line react-hooks/exhaustive-deps

  const publica = tipo.startsWith('pub-') ? tipo.slice(4) : '' // variante activa sin ejemplo: se carga la plantilla publicada tal cual
  useEffect(() => {
    if (!publica) return undefined
    let vivo = true
    setHtml(''); setError('')
    fetch(RUTA_API.replace(/\/api$/, '') + '/plantillas-html/' + publica + '.html')
      .then((r) => { if (!r.ok) throw new Error('x'); return r.text() })
      .then((t) => { if (vivo) setHtml(t.replace('{{TITULO}}', () => publica).replace('/*CONTENIDO*/', () => '{}')) })
      .catch(() => { if (vivo) setError('No se pudo cargar la plantilla.') })
    return () => { vivo = false }
  }, [publica])
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
  const [grupoNombre, lista] = grupos[gi] || ['', []]
  const pos = lista.findIndex(([k]) => k === tipo)
  const titulo = (lista[pos] || [])[1] || tipo
  const nombre = (publica || tipo.replace(/^o-/, '')) + '.html'
  const mover = (d) => { if (lista.length) setTipo(lista[(pos + d + lista.length) % lista.length][0]) }
  const todos = useMemo(() => grupos.flatMap(([g, l]) => l.map(([k, n, , sinEj]) => ({ k, n, g, sinEj }))), [grupos])
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
          const g = gruposPorClase[c]
          const total = g.reduce((a, [, l]) => a + l.length, 0)
          return <button key={c} role="tab" aria-selected={clase === c} className={clase === c ? 'on' : ''} disabled={!g.length} onClick={() => { setClase(c); setQ('') }}>{CLASES[c]} <span>· {total}</span></button>
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
          {publica && html && <p className="vp-nota aviso">Esta variante <b>no tiene un ejemplo con contenido</b>: sola se ve vacía, porque n8n le pone el título y el contenido de cada recurso. Esto es la plantilla tal cual.</p>}
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
            {!res && (
              <div className={'pl2-codigo' + (codigoActual ? '' : ' sin')}>
                <span>Código del recurso</span>
                {codigoActual ? <><b>{codigoActual.id}</b><small>{codigoActual.nombre}</small></> : <small>{estaQuitada(tipo) ? 'Esta plantilla está quitada de n8n (se vuelve a mostrar en «Categorías para n8n»)' : seaPublica(tipo) ? 'Sin categoría todavía (se asigna en «Categorías para n8n»)' : 'Este diseño no se publica para n8n'}</small>}
              </div>
            )}
            <p className="help">{res ? `Coinciden con «${q.trim()}».` : NOTAS[corto(grupoNombre)] || (cats && grupoNombre === 'Sin categoría' ? 'Sin categoría, pero con una revisión u observación pendiente. Se le asigna una en «Categorías para n8n».' : lista.length + (lista.length === 1 ? ' diseño' : ' diseños') + ' de esta categoría' + (cats && lista.some((x) => x[2]) ? ' · ' + lista.filter((x) => x[2]).length + (lista.filter((x) => x[2]).length === 1 ? ' activo' : ' activos') + ' para n8n' + (lista.some((x) => !x[2]) ? ', ' + lista.filter((x) => !x[2]).length + ' original' + (lista.filter((x) => !x[2]).length === 1 ? '' : 'es') + ' hechos a mano (no se publican)' : '') : '') + '.')}</p>
            {(res || lista.map(([k, n, , sinEj]) => ({ k, n, g: '', sinEj }))).map((t, i) => (
              <button key={t.k} className={t.k === tipo ? 'on' : ''} onClick={() => elegir(t.k)}>
                <span className="pl2-n">{res ? '•' : i + 1}</span>
                <span><b>{t.n}</b>{res && <small>{t.g}</small>}</span>
                {t.sinEj && <span className="pl2-sinej" title="No hay un diseño de ejemplo con contenido para esta plantilla">sin ejemplo</span>}
                {deTipo(t.k)[0] && <span className={'pill rv-mini ' + ESTADO[deTipo(t.k)[0].estado].clase}>{ESTADO[deTipo(t.k)[0].estado].texto}</span>}
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
