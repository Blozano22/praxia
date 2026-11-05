import { useEffect, useMemo, useState } from 'react'

// Plantillas HTML (carpeta /ejemplos): se cargan solo al abrirlas para no pesar al inicio.
// Todos los recursos usan la misma paleta DIEPO; «originales» son los HTML hechos a mano, tal cual.
const ARCHIVOS = import.meta.glob('../../../ejemplos/*.html', { query: '?raw', import: 'default' })
const ORIGINALES = import.meta.glob('../../../ejemplos/originales/*.html', { query: '?raw', import: 'default' })

// Familias del menú: [título, [[clave, nombre]...]]
const GRUPOS = [
  ['Contenido', [['presentacion', 'Presentación'], ['lectura', 'Lectura diagramada'], ['estudio-casos', 'Estudio de casos']]],
  ['Acordeones', [['acordeon', 'Diseño 1'], ['acordeon-v2', 'Diseño 2'], ['acordeon-v3', 'Diseño 3']]],
  ['Actividades (van en cualquier recurso)', [['acordeon-clasificacion', 'Clasificación'], ['acordeon-cuestionario', 'Cuestionario'], ['acordeon-emparejamiento', 'Emparejamiento'], ['acordeon-laboratorio', 'Laboratorio'], ['acordeon-tarea', 'Tarea']]],
  ['Líneas de tiempo', [['linea-tiempo', 'Diseño 1'], ['linea-tiempo-v2', 'Diseño 2'], ['linea-tiempo-v3', 'Diseño 3']]],
  ['Crucigramas', [['crucigrama', 'Diseño 1'], ['crucigrama-v2', 'Diseño 2'], ['crucigrama-v3', 'Diseño 3']]],
  ['Infografías', [['infografia-hex', 'Hexagonal'], ['infografia-pines', 'Con pines'], ['infografia-radial', 'Radial']]],
  ['Esquemas', [['diagrama-flujo', 'Diagrama de flujo'], ['mapa-conceptual', 'Mapa conceptual']]],
  ['Mis HTML originales', [['o-linea-de-tiempo-v1', 'Línea de tiempo · v1'], ['o-linea-de-tiempo-v3', 'Línea de tiempo · v3'], ['o-infografia-v1', 'Infografía · v1'], ['o-infografia-v2', 'Infografía · v2'],
    ['o-linea-de-tiempo-anterior-carrusel', 'Línea de tiempo · anterior (carrusel)'], ['o-linea-de-tiempo-anterior-original', 'Línea de tiempo · anterior (original)'], ['o-linea-de-tiempo-anterior-por-formacion', 'Línea de tiempo · anterior (por formación)']]]
]

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
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')

  const ruta = CATALOGO[tipo] && Object.values(CATALOGO[tipo])[0]

  useEffect(() => {
    if (!ruta) return
    let vivo = true
    setHtml(''); setError('')
    CARGA[ruta]().then((t) => { if (vivo) setHtml(t) }).catch(() => { if (vivo) setError('No se pudo cargar la plantilla.') })
    return () => { vivo = false }
  }, [ruta])

  const nombre = tipo.replace(/^o-/, '') + '.html'
  const titulo = (grupos.flatMap(([, l]) => l).find(([k]) => k === tipo) || [])[1] || tipo
  const grupoDe = (grupos.find(([, l]) => l.some(([k]) => k === tipo)) || [])[0]
  const abrir = () => { const u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60000) }
  const bajar = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })); a.download = nombre; document.body.append(a); a.click(); a.remove() }

  return (
    <div className="wrapx fade">
      <h1>Plantillas HTML</h1>
      <p className="lead">Así se ven los recursos que genera la plataforma. Elija el tipo; puede abrirlos en una pestaña o descargarlos. «Mis HTML originales» son los archivos hechos a mano, sin cambios.</p>
      <div className="pl-grid">
        <div className="pl-lista" role="listbox" aria-label="Tipo de plantilla">
          {grupos.map(([g, l]) => (
            <div key={g} className="pl-grupo"><h4>{g}</h4>
              {l.map(([k, n]) => <button key={k} role="option" aria-selected={k === tipo} className={k === tipo ? 'on' : ''} onClick={() => setTipo(k)}>{n}</button>)}
            </div>
          ))}
        </div>
        <div>
          <div className="row" style={{ marginBottom: 10, alignItems: 'center' }}>
            <b style={{ marginRight: 6 }}>{grupoDe} · {titulo}</b>
            <div className="sp" />
            <button className="btn sec sm" disabled={!html} onClick={abrir}>Abrir en pestaña</button>
            <button className="btn sec sm" disabled={!html} onClick={bajar}>Descargar</button>
          </div>
          {error && <div className="msg bad" role="alert">{error}</div>}
          <div className="pl-vista">
            {!html && !error && <p className="help" style={{ padding: 18 }}>Cargando…</p>}
            {html && <iframe sandbox="allow-scripts" title={'Plantilla ' + titulo} srcDoc={html} />}
          </div>
        </div>
      </div>
    </div>
  )
}
