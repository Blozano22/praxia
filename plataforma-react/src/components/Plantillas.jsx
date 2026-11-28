import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { marcoPlantilla } from '../lib/vista.js'
import { verNombre } from '../lib/nombres.js'
import Titulo from './Titulo.jsx'
import RevisionPlantilla, { ESTADO } from './RevisionPlantilla.jsx'
import BancoIconos from './BancoIconos.jsx'
import CategoriasPlantillas from './CategoriasPlantillas.jsx'
import SubirVariante from './SubirVariante.jsx'
import ReemplazoMasivo from './ReemplazoMasivo.jsx'
import PlantillaPropia from './PlantillaPropia.jsx'
import RevisionResumen from './RevisionResumen.jsx'
import { FORMACIONES, NOMBRE_FORMACION, conFormacion } from '../lib/formaciones.js'
import { api, RUTA_API } from '../lib/api.js'
import { CARGA, CATALOGO, ejemploDe, nombrePublico } from '../lib/ejemplos.js'


// Familias del menú: [título, [[clave, nombre]...]]
const GRUPOS = [
  ['Contenido', [['presentacion', 'Presentación'], ['lectura', 'Lectura diagramada'], ['estudio-casos', 'Estudio de casos']]],
  ['Acordeones', [['acordeon', 'Diseño 1'], ['acordeon-v2', 'Diseño 2'], ['acordeon-v3', 'Diseño 3']]],
  ['Actividades (van en cualquier recurso)', [['acordeon-clasificacion', 'Clasificación'], ['acordeon-cuestionario', 'Cuestionario'], ['acordeon-emparejamiento', 'Emparejamiento'], ['acordeon-laboratorio', 'Laboratorio'], ['acordeon-tarea', 'Tarea']]],
  ['Líneas de tiempo', [['linea-tiempo-v2', 'Diseño 2']]],
  ['Crucigramas', [['crucigrama', 'Diseño 1'], ['crucigrama-v2', 'Diseño 2'], ['crucigrama-v3', 'Diseño 3']]],
  ['Infografías', [['infografia-hex', 'Hexagonal'], ['infografia-pines', 'Con pines'], ['infografia-radial', 'Radial']]],
  ['Esquemas', [['diagrama-flujo', 'Diagrama de flujo'], ['mapa-conceptual', 'Mapa conceptual']]]
]

// Nota breve de cada familia (se muestra sobre la lista de diseños).
const NOTAS = {
  Contenido: 'Para presentar el tema de la unidad.',
  Acordeones: 'Diseños para desplegar contenido por secciones.',
  Actividades: 'Van en cualquier recurso: se insertan dentro de la presentación, la lectura u otro.',
  'Líneas de tiempo': 'Diseños para ordenar hechos o etapas.',
  Crucigramas: 'Tres diseños de crucigrama.',
  Infografías: 'Diseños para resumir ideas de forma visual.',
  Esquemas: 'Para mostrar procesos y relaciones.',
}
const corto = (g) => g.replace(/ \(.*\)$/, '')
// Hay dos clases de HTML: los recursos y las actividades de autoaprendizaje (el crucigrama, el cuestionario…). La galería muestra una clase a la vez.
const esActividad = (g) => /^(Actividades|Crucigramas)/.test(g)
const CLASES = { recurso: 'Recursos', actividad: 'Actividades', bibliografia: 'Bibliografía' }


// Flecha de los selectores (categoría / diseño): icono grande dentro de un botón redondo.
function IcoFlecha({ izq }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {izq ? <path d="M19 12H5M11 6l-6 6 6 6" /> : <path d="M5 12h14M13 6l6 6-6 6" />}
    </svg>
  )
}

// Estado de revisión de una categoría: «Revisada» si todos sus diseños están aprobados; si no, cuántos faltan.
function ChipRevision({ c, grande }) {
  const texto = c.completa ? 'Revisada' : 'Faltan ' + c.pend
  return (
    <span className={'pg-chip ' + (c.completa ? 'ok' : 'pend') + (grande ? ' grande' : '')} title={c.completa ? 'Todos los diseños están aprobados' : c.pend + (c.pend === 1 ? ' diseño sin aprobar' : ' diseños sin aprobar')}>
      {c.completa
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></svg>}
      {texto}
    </span>
  )
}

// Lista desplegable de categorías con búsqueda; cada una muestra su ID, cuántos diseños tiene y si ya está revisada.
function SelectorCategoria({ opciones, actual, onElegir, deshabilitado }) {
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const caja = useRef(null)
  useEffect(() => {
    if (!abierto) return undefined
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    const tecla = (e) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla) }
  }, [abierto])
  const o = opciones[actual] || { id: '', nombre: '—', n: 0, c: { completa: false, pend: 0, total: 0 } }
  const t = q.trim().toLowerCase()
  const lista = opciones.filter((x) => !t || (x.id + ' ' + x.nombre).toLowerCase().includes(t))
  const nd = (n) => n + (n === 1 ? ' diseño' : ' diseños')
  return (
    <div className="pg-dd" ref={caja}>
      <button type="button" className="pg-dd-btn" aria-haspopup="listbox" aria-expanded={abierto} disabled={deshabilitado} onClick={() => setAbierto(!abierto)}>
        {o.id && <span className="pg-id">{o.id}</span>}
        <span className="pg-dd-n">{o.nombre}</span>
        {o.pc && <span className={'pg-pc ' + o.pc} title={o.pc === 'P' ? 'Prioritaria para esta formación' : 'Complementaria para esta formación'}>{o.pc}</span>}
        <span className="pg-dd-v">{nd(o.n)}</span>
        {o.c.total > 0 && <ChipRevision c={o.c} />}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {abierto && (
        <div className="pg-dd-panel">
          <input autoFocus type="search" placeholder="Buscar categoría por ID o nombre…" aria-label="Buscar categoría" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="pg-dd-lista" role="listbox" aria-label="Categorías">
            {lista.map((x) => (
              <button key={x.i} type="button" role="option" aria-selected={x.i === actual} className={'pg-op' + (x.i === actual ? ' sel' : '')} onClick={() => { onElegir(x.i); setAbierto(false); setQ('') }}>
                {x.id && <span className="pg-id">{x.id}</span>}
                <span className="pg-op-n">{x.nombre}</span>
                {x.pc && <span className={'pg-pc ' + x.pc} title={x.pc === 'P' ? 'Prioritaria para esta formación' : 'Complementaria para esta formación'}>{x.pc}</span>}
                <span className="pg-op-v">{nd(x.n)}</span>
                <ChipRevision c={x.c} />
              </button>
            ))}
            {lista.length === 0 && <div className="pg-dd-nada">Ninguna categoría coincide.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Plantillas({ puedeRevisar = false, puedeCorregir = false, puedeCategorias = false, puedeSubirVariante = false, yo = null, aviso, abrirPlantilla = '', enlace = null, pulsoAvisos = 0, onAbierto }) {
  const gruposTodos = useMemo(() => GRUPOS.map(([g, l]) => [g, l.filter(([k]) => CATALOGO[k])]).filter(([, l]) => l.length), [])
  const [clase, setClase] = useState('recurso') // qué clase de HTML se ve en la galería: recurso | actividad
  const [ejSubido, setEjSubido] = useState(false) // la variante publicada que se ve trae su propio contenido de ejemplo (plantilla subida)
  const [vista, setVista] = useState(enlace ? 'categorias' : 'galeria') // galeria | categorias (las categorías que usa n8n)
  useEffect(() => { if (enlace) setVista('categorias') }, [enlace]) // el enlace llega tras el primer render (la pantalla ya estaba montada)
  const [tipo, setTipo] = useState(() => (gruposTodos.find(([g]) => !esActividad(g)) || gruposTodos[0])[1][0][0])
  const [q, setQ] = useState('')
  const [formacion, setFormacion] = useState('') // '' = todas; si no, el id de la formación (tecnologico, profesional…): filtra las categorías y colorea la vista previa
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
    const res = { recurso: [], actividad: [], bibliografia: [] }
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
      const ejSub = !!(cats.subidas && cats.subidas[n] && cats.subidas[n].ejemplo) // una plantilla subida puede traer su propio contenido de ejemplo
      if (!porCat.has(c.id)) porCat.set(c.id, { c, items: [] })
      porCat.get(c.id).items.push([ej || 'pub-' + n, n, true, !ej && !ejSub])
    })
    ;[...porCat.values()].sort((x, y) => x.c.id.localeCompare(y.c.id)).forEach(({ c, items }) => res[c.tipo === 'actividad' || c.tipo === 'bibliografia' ? c.tipo : 'recurso'].push([c.nombre || c.id, items, c.id]))
    ;['recurso', 'actividad'].forEach((t) => { if (sin[t].length) res[t].push(['Sin categoría', sin[t]]) })
    return res
  }, [cats, activas, gruposTodos, revisiones])
  // Con una formación elegida solo salen las categorías que la sirven (las sin categoría no aplican a ninguna).
  const gruposClase = useMemo(() => {
    if (!formacion || !cats) return gruposPorClase
    const deCat = (id) => (cats.formaciones || {})[id] || []
    const sirve = (id) => !!id && deCat(id).some((f) => f.formacion === formacion)
    // En una categoría compartida (sirve a 2 o más formaciones) cada formación tiene sus propias variantes y su propia numeración (G-09-TEC-V01…):
    // solo salen las de la formación elegida. Las subidas sin formación (anteriores a esta regla) salen en todas.
    const deFormacion = (id, items) => (deCat(id).length < 2 ? items : items.filter(([k]) => {
      const n = k.startsWith('pub-') ? k.slice(4) : nombrePublico(k)
      const f = n && cats.subidas && cats.subidas[n] ? cats.subidas[n].formacion : null
      return !f || f === formacion
    }))
    const filtra = (l) => l.filter(([, , id]) => sirve(id)).map(([g, items, id]) => [g, deFormacion(id, items), id]).filter(([, items]) => items.length)
    return { recurso: filtra(gruposPorClase.recurso), actividad: filtra(gruposPorClase.actividad), bibliografia: filtra(gruposPorClase.bibliografia) }
  }, [gruposPorClase, formacion, cats])
  const prioridadEn = (id) => { const f = formacion && cats ? ((cats.formaciones || {})[id] || []).find((x) => x.formacion === formacion) : null; return f ? f.prioridad : '' }
  const grupos = gruposClase[clase]
  // si el diseño elegido ya no está en lo que se muestra (cambió la clase o llegaron las categorías), se elige el primero
  useEffect(() => { if (grupos.length && !grupos.some(([, l]) => l.some(([k]) => k === tipo))) setTipo(grupos[0][1][0][0]) }, [grupos]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enlace corto y público para ver la variante con su ejemplo (para ponerlo en los guiones): sin «praxia» en la dirección (lo atiende el nginx).
  const [copiado, setCopiado] = useState(false)
  const copiarEnlace = async (nombre) => {
    const url = location.origin + '/plantillas/ver/' + nombre
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(url)
      else { const t = document.createElement('textarea'); t.value = url; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove() }
      setCopiado(true); setTimeout(() => setCopiado(false), 1800)
      if (aviso) aviso('Enlace copiado: ' + url)
    } catch { if (aviso) aviso('No se pudo copiar el enlace.') }
  }
  const publica = tipo.startsWith('pub-') ? tipo.slice(4) : '' // variante activa sin ejemplo: se carga la plantilla publicada tal cual
  useEffect(() => {
    if (!publica) return undefined
    let vivo = true
    setHtml(''); setError(''); setEjSubido(false)
    if (cats && cats.subidas && cats.subidas[publica] && cats.subidas[publica].ejemplo) {
      api('GET', '/plantillas/subidas/' + encodeURIComponent(publica) + '/ejemplo')
        .then((d) => { if (vivo) { if (d && d.html) { setHtml(d.html); setEjSubido(true) } else setError('No se pudo cargar el ejemplo.') } })
        .catch(() => { if (vivo) setError('No se pudo cargar el ejemplo.') })
      return () => { vivo = false }
    }
    fetch(RUTA_API.replace(/\/api$/, '') + '/plantillas-html/' + publica + '.html')
      .then((r) => { if (!r.ok) throw new Error('x'); return r.text() })
      .then((t) => { if (vivo) setHtml(t.replace('{{TITULO}}', () => publica).replace('/*CONTENIDO*/', () => '{}')) })
      .catch(() => { if (vivo) setError('No se pudo cargar la plantilla.') })
    return () => { vivo = false }
  }, [publica, cats])
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
  // Todas las plantillas de la galería con su estado de revisión (para el botón «Revisión»: conteo, «mis plantillas» y «general»).
  const itemsRev = useMemo(() => {
    const out = []
    ;['recurso', 'actividad', 'bibliografia'].forEach((cl) => gruposPorClase[cl].forEach(([g, l, id]) => l.forEach(([k, n]) => {
      const nom = k.startsWith('pub-') ? k.slice(4) : (nombrePublico(k) || '')
      const info = cats && cats.subidas && nom ? cats.subidas[nom] : null
      const r = revisiones.find((x) => x.plantilla === k) // la más nueva
      // Para quien revisa: ¿decidió algo sobre esta plantilla (pidió cambios, rechazó o aprobó)? y, si ya la marcaron como corregida, ¿atiende una solicitud suya?
      const miRevision = !!yo && revisiones.some((x) => x.plantilla === k && x.usuarioId === yo.id && x.estado !== 'corregida')
      const atendida = r && r.estado === 'corregida' && r.referencia ? revisiones.find((x) => String(x.id) === String(r.referencia)) : null
      const espera = !!(yo && atendida && atendida.usuarioId === yo.id)
      out.push({ k, codigo: verNombre(n), clase: cl, cat: id || '', catNombre: corto(g), por: info ? info.por : '', propia: !!(info && info.propia), miRevision, espera, estado: r ? r.estado : 'nada', rev: r || {} })
    })))
    return out
  }, [gruposPorClase, revisiones, cats, yo])
  // La revisión sigue la clase de la vista: en «Recursos» solo cuenta y lista los recursos; en «Actividades», solo las actividades.
  const itemsClase = useMemo(() => itemsRev.filter((i) => i.clase === clase), [itemsRev, clase])
  const [slotRev, setSlotRev] = useState(null) // hueco del encabezado donde va el botón «Revisión»
  useEffect(() => { setSlotRev(document.getElementById('slot-revision')) }, [])
  const irADiseno = (i) => { setVista('galeria'); setClase(i.clase); setFormacion(''); setQ(''); setTipo(i.k) }
  // Cuando llega un aviso temporal, lo que se ve en la galería (estados de revisión, categorías) ya cambió: se recarga para que no quede desactualizado.
  useEffect(() => {
    if (!pulsoAvisos) return
    api('GET', '/plantillas/revisiones').then(setRevisiones).catch(() => {})
    recargarCats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulsoAvisos])
  // Al pulsar un aviso temporal se abre la plantilla de la que habla (cuando ya están cargadas las categorías); si ya no existe, se descarta.
  useEffect(() => {
    if (!abrirPlantilla) return
    const it = itemsRev.find((i) => i.k === abrirPlantilla)
    if (it) { irADiseno(it); onAbierto && onAbierto() } else if (cats) onAbierto && onAbierto()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirPlantilla, itemsRev, cats])
  const busca = q.trim().toLowerCase()
  const res = busca ? todos.filter((t) => (t.n + ' ' + t.g).toLowerCase().includes(busca)) : null
  const elegir = (k) => { setTipo(k); setQ('') }

  const abrir = () => { const u = URL.createObjectURL(new Blob([conFormacion(html, formacion)], { type: 'text/html;charset=utf-8' })); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60000) }
  const bajar = async () => {
    let blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    if (publica) { // plantilla subida: se entrega el archivo original tal cual se subió
      try {
        const r = await fetch(RUTA_API + '/plantillas/subidas/' + encodeURIComponent(publica) + '/original', { credentials: 'same-origin', headers: { 'x-ova': '1' } })
        if (!r.ok) throw new Error('x')
        blob = new Blob([await r.arrayBuffer()], { type: 'text/html;charset=utf-8' })
      } catch { if (aviso) aviso('No se pudo descargar el archivo original.'); return }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.append(a); a.click(); a.remove()
  }

  // ---- Estado de revisión de cada categoría: qué diseños ya se revisaron (aprobados) y cuáles faltan.
  const resumenDe = (items) => {
    const c = { total: items.length, aprobada: 0, rechazada: 0, revision: 0, corregida: 0, nada: 0 }
    items.forEach(([k]) => { const v = deTipo(k)[0]; if (v) c[v.estado] = (c[v.estado] || 0) + 1; else c.nada++ })
    c.pend = c.total - c.aprobada
    c.completa = c.total > 0 && c.pend === 0
    return c
  }
  // Detalle de lo que falta, sin repetir lo que ya dicen la etiqueta («Faltan N») y «X de N aprobadas»: solo se muestra si hay algo más que contar
  // (diseños en revisión, corregidos o rechazados); si lo único que falta es revisar, no se escribe otra vez.
  const detalleRev = (c) => {
    const otros = [
      c.revision && c.revision + ' en revisión',
      c.corregida && c.corregida + (c.corregida === 1 ? ' corregida' : ' corregidas'),
      c.rechazada && c.rechazada + (c.rechazada === 1 ? ' rechazada' : ' rechazadas')
    ].filter(Boolean)
    if (!otros.length) return ''
    return [...otros, c.nada && c.nada + ' sin revisar'].filter(Boolean).join(' · ')
  }
  const resumenCat = resumenDe(lista)
  const opcionesCat = grupos.map(([g, l, id], i) => ({ i, id: id || '', nombre: corto(g), n: l.length, c: resumenDe(l), pc: id ? prioridadEn(id) : '' }))
  const irACategoria = (i) => { const [, l] = grupos[(i + grupos.length) % grupos.length]; setQ(''); setTipo(l[0][0]) }
  const [subiendo, setSubiendo] = useState(false)
  const [masivo, setMasivo] = useState(false)
  const recargarCats = () => api('GET', '/plantillas/categorias').then(setCats).catch(() => {})
  // Plantilla SUBIDA que se está viendo (la propia, o cualquiera si se revisa): se puede mover, reemplazar o eliminar. Las del sistema no.
  const nSub = publica || nombrePublico(tipo) || ''
  const infoSub = cats && nSub && cats.subidas ? cats.subidas[nSub] : null
  const puedeGestionarSub = !!infoSub && (infoSub.propia || puedeRevisar)
  const alCambiarSub = async ({ tipo: accion, nuevo, mensaje }) => {
    const siguiente = lista.length > 1 ? lista[(pos + 1) % lista.length][0] : null // para dejar seleccionado el diseño que sigue si se elimina
    await recargarCats()
    api('GET', '/plantillas/revisiones').then(setRevisiones).catch(() => {}) // mover traslada el historial de revisión
    if (accion === 'mover' && nuevo) setTipo('pub-' + nuevo)
    if (accion === 'eliminar' && siguiente) setTipo(siguiente)
    if (aviso && mensaje) aviso(mensaje)
  }
  const puedeIconos = puedeCategorias || puedeRevisar || puedeSubirVariante // ver el banco de íconos (quien trabaja con las variantes)
  const puedeSubir = (puedeRevisar || puedeSubirVariante) && !!cats // quien revisa o quien tiene el rol de editor HTML

  const pestanas = (
    <div className="pg-tabs" role="tablist" aria-label="Qué ver">
      <button type="button" role="tab" aria-selected={vista === 'galeria'} className={vista === 'galeria' ? 'on' : ''} onClick={() => setVista('galeria')}>Galería de diseños</button>
      {puedeCategorias && <button type="button" role="tab" aria-selected={vista === 'categorias'} className={vista === 'categorias' ? 'on' : ''} onClick={() => setVista('categorias')}>Categorías para n8n</button>}
      {puedeIconos && <button type="button" role="tab" aria-selected={vista === 'iconos'} className={vista === 'iconos' ? 'on' : ''} onClick={() => setVista('iconos')}>Banco de íconos</button>}
    </div>
  )
  if (vista === 'iconos' && puedeIconos) {
    return (
      <div className="wrapx fade">
        <div className="pl2-cab">
          <Titulo icono="codigo"><h1>Plantillas HTML</h1></Titulo>
        </div>
        <div className="pg-fila-tabs">{pestanas}</div>
        <BancoIconos puedeGestionar={puedeRevisar || puedeSubirVariante} aviso={aviso} />
      </div>
    )
  }
  if (vista === 'categorias' && puedeCategorias) {
    return (
      <div className="wrapx fade">
        <div className="pl2-cab">
          <Titulo icono="codigo"><h1>Plantillas HTML</h1></Titulo>
        </div>
        <div className="pg-fila-tabs">{pestanas}</div>
        <CategoriasPlantillas enlace={enlace} puedeCambiar={puedeRevisar} esAdmin={!!(yo && yo.permisos && yo.permisos.includes('usuarios.gestionar'))} aviso={aviso} />
      </div>
    )
  }

  return (
    <div className="wrapx fade">
      <div className="pg-cab">
        <Titulo icono="codigo">
          <h1>Plantillas HTML</h1>
          <p className="lead">Así se ven los recursos que genera la plataforma. Elija la categoría y el diseño; puede abrirlo en una pestaña o descargarlo.</p>
        </Titulo>
        {itemsClase.length > 0 && (slotRev ? createPortal(<RevisionResumen key={clase} clase={clase} enHeader items={itemsClase} puedeRevisar={puedeRevisar} onIr={irADiseno} />, slotRev) : <RevisionResumen key={clase} clase={clase} items={itemsClase} puedeRevisar={puedeRevisar} onIr={irADiseno} />)}
        <div className="pg-acc">
        {puedeSubir && (
          <button type="button" className="btn pg-subir" onClick={() => setSubiendo(true)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
            Subir variante
          </button>
        )}
        <a className="btn pg-zip" href={RUTA_API + '/plantillas/subidas/descarga-masiva.zip?tipo=' + clase} download title={'Descarga un ZIP solo con las plantillas que se han subido de ' + CLASES[clase].toLowerCase() + ', agrupadas por categoría'}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>ZIP de {CLASES[clase].toLowerCase()}</a>
        <a className="btn pg-zip" href={RUTA_API + '/plantillas/subidas/descarga-masiva.zip'} download title="Descarga un ZIP con todas las plantillas subidas: recursos, actividades y bibliografía"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>ZIP de todas las clases</a>
        </div>
      </div>

      <div className="pg-fila-tabs">
        {pestanas}
        <label className="pg-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input aria-label="Buscar una plantilla" placeholder="Buscar una plantilla" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <div className="card pg-filtro">
        <div>
          <span className="pg-lb">Clase de HTML</span>
          <div className="pg-seg" role="tablist" aria-label="Clase de HTML">
            {['recurso', 'actividad', 'bibliografia'].map((c) => {
              const g = gruposClase[c]
              const total = g.reduce((a, [, l]) => a + l.length, 0)
              return <button key={c} type="button" role="tab" aria-selected={clase === c} className={clase === c ? 'on' : ''} onClick={() => { setClase(c); setQ('') }}>{CLASES[c]} <span>· {total}</span></button>
            })}
          </div>
        </div>
        <div className="pg-forma">
          <span className="pg-lb">Formación</span>
          <div className="pg-chips" role="radiogroup" aria-label="Formación">
            <button type="button" role="radio" aria-checked={!formacion} className={'pg-chipf' + (!formacion ? ' on' : '')} onClick={() => setFormacion('')}>Todas</button>
            {FORMACIONES.map((f) => {
              const on = formacion === f.id
              return (
                <button key={f.id} type="button" role="radio" aria-checked={on} className={'pg-chipf' + (on ? ' on' : '')} style={on ? { background: f.base, borderColor: f.base } : undefined} onClick={() => { setFormacion(f.id); setQ('') }}>
                  {on ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg> : <i style={{ background: f.base }} aria-hidden="true" />}
                  {f.nombre}
                </button>
              )
            })}
          </div>
        </div>
        <div className="pg-cat">
          <span className="pg-lb">Categoría</span>
          <div className="pg-cat-fila">
            <button type="button" className="pg-flecha" aria-label="Categoría anterior" disabled={grupos.length < 2} onClick={() => irACategoria(gi - 1)}><IcoFlecha izq /></button>
            <SelectorCategoria opciones={opcionesCat} actual={gi} deshabilitado={!!res} onElegir={irACategoria} />
            <button type="button" className="pg-flecha" aria-label="Categoría siguiente" disabled={grupos.length < 2} onClick={() => irACategoria(gi + 1)}><IcoFlecha /></button>
          </div>
        </div>
      </div>

      {grupos.length === 0 ? (
        <div className="card pg-vacio">
          <b>{formacion ? 'Ninguna categoría de ' + CLASES[clase].toLowerCase() + ' sirve a ' + (NOMBRE_FORMACION[formacion] || 'esta formación') + ' todavía.' : 'Todavía no hay diseños en esta clase.'}</b>
          <span>{formacion ? 'Pruebe con otra formación o con «Todas». Quien administra las categorías puede asignarlas en «Categorías para n8n».' : (puedeSubir ? 'Suba la primera con «Subir variante»: aquí solo se ofrecen las categorías de ' + CLASES[clase].toLowerCase() + '.' : '')}</span>
        </div>
      ) : (
      <div className="pl2-cuerpo">
        <section className={'pl2-prev' + (full ? ' full' : '')} aria-label="Vista previa">
          <div className="pl2-barra">
            <div className="pl2-tit"><small>{corto(grupoNombre)}</small><b>{verNombre(titulo)}</b></div>
            <button type="button" className="pg-flecha chica" aria-label="Diseño anterior" onClick={() => mover(-1)}><IcoFlecha izq /></button>
            <span className="pl2-pos">{pos + 1} / {lista.length}</span>
            <button type="button" className="pg-flecha chica" aria-label="Diseño siguiente" onClick={() => mover(1)}><IcoFlecha /></button>
            {publica && ejSubido && <button type="button" className="btn sec sm" onClick={() => copiarEnlace(publica)} title={location.origin + '/plantillas/ver/' + publica}>{copiado ? '¡Enlace copiado!' : 'Copiar enlace'}</button>}
            <button className="btn sec sm" onClick={() => setFull(!full)}>{full ? 'Cerrar pantalla completa' : 'Pantalla completa'}</button>
          </div>
          {error && <div className="msg bad" role="alert">{error}</div>}
          {publica && html && !ejSubido && <p className="vp-nota aviso">Esta variante <b>no tiene un ejemplo con contenido</b>: sola se ve vacía, porque n8n le pone el título y el contenido de cada recurso. Esto es la plantilla tal cual.</p>}
          <div className="pl2-caja" ref={caja} style={full ? { maxWidth: 'calc((100vh - 130px) * 16 / 9)' } : undefined}>
            {!html && !error && <p className="help" style={{ padding: 18 }}>Cargando…</p>}
            {html && <iframe sandbox="allow-scripts" title={'Plantilla ' + verNombre(titulo)} srcDoc={conFormacion(html, formacion)} style={marcoPlantilla(esc)} />}
          </div>
          {!full && <p className="help pl2-pie">{formacion ? 'Se ve con los colores de ' + NOMBRE_FORMACION[formacion] + '. Los diseños antiguos, que traen su propio ejemplo fijo, no cambian de color.' : 'Se ve a 1280 × 720, sin barras de desplazamiento, con la paleta de la institución.'}</p>}
          {!full && <RevisionPlantilla key={tipo} plantilla={tipo} titulo={verNombre(titulo)} historial={deTipo(tipo)} puedeRevisar={puedeRevisar} puedeCorregir={puedeCorregir || (puedeSubirVariante && !!(tipo.startsWith('pub-') && cats && cats.subidas && cats.subidas[tipo.slice(4)] && cats.subidas[tipo.slice(4)].propia))} yo={yo} aviso={aviso} onNueva={(r) => setRevisiones((l) => [r, ...l])} onEditada={(r) => setRevisiones((l) => l.map((x) => (x.id === r.id ? r : x)))} />}
        </section>

        <aside className="pl2-lado">
          <div className="card pl2-lista">
            <h4>{res ? `Resultados (${res.length})` : 'Diseños de ' + corto(grupoNombre).toLowerCase()}</h4>
            {!res && lista.length > 0 && (
              <div className={'pg-rev' + (resumenCat.completa ? ' ok' : '')}>
                <div className="pg-rev-cab">
                  <ChipRevision c={resumenCat} grande />
                  <span>{resumenCat.aprobada} de {resumenCat.total} aprobadas</span>
                </div>
                <div className="pg-rev-barra" role="img" aria-label={resumenCat.aprobada + ' de ' + resumenCat.total + ' aprobadas'}><i style={{ width: (resumenCat.total ? (resumenCat.aprobada / resumenCat.total) * 100 : 0) + '%' }} /></div>
                {detalleRev(resumenCat) && <small>{detalleRev(resumenCat)}</small>}
              </div>
            )}
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
                <span><b>{verNombre(t.n)}</b>{res && <small>{t.g}</small>}</span>
                <span className="pg-etqs">
                  {cats && cats.subidas && cats.subidas[t.k.startsWith('pub-') ? t.k.slice(4) : nombrePublico(t.k)] && cats.subidas[t.k.startsWith('pub-') ? t.k.slice(4) : nombrePublico(t.k)].esquemaOk === false && <span className="pg-campos" title="No usa los mismos campos que las demás de su categoría">Campos distintos</span>}
                  {t.sinEj && <span className="pl2-sinej" title="No hay un diseño de ejemplo con contenido para esta plantilla">sin ejemplo</span>}
                  {deTipo(t.k)[0]
                    ? <span className={'pill rv-mini ' + ESTADO[deTipo(t.k)[0].estado].clase}>{ESTADO[deTipo(t.k)[0].estado].texto}</span>
                    : <span className="pill rv-mini pg-sinrev">Sin revisar</span>}
                </span>
              </button>
            ))}
            {res && res.length === 0 && <p className="help">No hay plantillas con esa palabra. Pruebe con «acordeón» o «tiempo».</p>}
            {puedeSubir && !res && (
              <button type="button" className="pg-subir-aqui" onClick={() => setSubiendo(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                Subir variante a esta categoría
              </button>
            )}
            {puedeSubir && !res && codigoActual && (
              <button type="button" className="pg-subir-aqui" onClick={() => setMasivo(true)} title="Reemplazar varias variantes de esta categoría a la vez (todas o ninguna)">
                Reemplazar en masa
              </button>
            )}
          </div>
          {puedeGestionarSub && <PlantillaPropia puedeRevisar={puedeRevisar} nombre={nSub} info={infoSub} cats={cats} categoriaActual={codigoActual ? codigoActual.id : ''} formacion={formacion} onCambio={alCambiarSub} />}
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
      )}
      {masivo && cats && codigoActual && <ReemplazoMasivo categoria={codigoActual.id} formacion={formacion} cats={cats} onCerrar={() => setMasivo(false)} onHecho={async (n) => { await recargarCats(); if (aviso) aviso(n + ' variantes reemplazadas') }} />}
      {subiendo && cats && <SubirVariante cats={cats} clase={clase} formacion={formacion} puedeRevisar={puedeRevisar} categoriaInicial={codigoActual ? codigoActual.id : ''} onCerrar={() => setSubiendo(false)} onSubida={async (r) => { await recargarCats(); if (aviso && r) aviso(r.subidos === 1 && !r.errores ? 'Plantilla subida' : r.subidos + (r.subidos === 1 ? ' plantilla subida' : ' plantillas subidas') + (r.errores ? ', ' + r.errores + ' con error' : '')) }} />}
    </div>
  )
}
