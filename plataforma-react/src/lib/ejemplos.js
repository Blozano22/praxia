// Diseños de ejemplo de la galería (carpeta /ejemplos), con su contenido ya puesto. Se cargan solo al pedirlos para no pesar al inicio.
// Los que empiezan por «o-» son HTML hechos a mano, tal cual. Lo usan la galería de plantillas y la vista previa de «Categorías para n8n».
export const ARCHIVOS = import.meta.glob('../../../ejemplos/*.html', { query: '?raw', import: 'default' })
export const ORIGINALES = import.meta.glob('../../../ejemplos/originales/*.html', { query: '?raw', import: 'default' })

// { clave: { nivel | 'unico': ruta } }
export const CATALOGO = (() => {
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
export const CARGA = { ...ARCHIVOS, ...ORIGINALES }

// Las plantillas publicadas (las que descarga n8n) se llaman casi igual que los diseños de la galería: acordeon-v2 → acordeon-2.
const NOMBRE_PUBLICO = { 'estudio-casos': 'casos', 'diagrama-flujo': 'flujo', 'mapa-conceptual': 'mapa', 'linea-tiempo': 'lineatiempo' }
export const nombrePublico = (k) => {
  if (k.startsWith('o-')) return '' // los HTML originales hechos a mano no se publican
  const m = /^(.*?)(?:-v(\d+))?$/.exec(k)
  const base = NOMBRE_PUBLICO[m[1]] || m[1]
  return m[2] ? base + '-' + m[2] : base
}

// Clave del diseño de ejemplo que corresponde a una plantilla publicada (o null si no hay uno con contenido).
export const ejemploDe = (nombre) => Object.keys(CATALOGO).find((k) => nombrePublico(k) === nombre) || null

// HTML del ejemplo (con su contenido puesto), o null.
export async function cargarEjemplo(nombre) {
  const k = ejemploDe(nombre)
  const ruta = k && Object.values(CATALOGO[k])[0]
  return ruta && CARGA[ruta] ? CARGA[ruta]() : null
}
