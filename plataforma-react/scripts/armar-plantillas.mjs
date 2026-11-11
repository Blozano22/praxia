// Arma las plantillas HTML de los recursos para publicarlas en solo lectura (las descarga un flujo externo de n8n).
// Cada archivo sale con estilos, código común, tema (paleta DIEPO) y fuente ya incluidos; solo quedan sin reemplazar
// {{TITULO}} y /*CONTENIDO*/. Se ejecuta solo en cada «npm run build» (plugin de vite.config.js) y también a mano:
//   node scripts/armar-plantillas.mjs [carpeta de salida]      (por defecto dist/plantillas-html)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { aplicarTema, incrustar, MARCA_CONTENIDO, MARCA_TITULO, MARCAS_INTERNAS, temaBase } from '../src/lib/armado.js'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const proyecto = path.resolve(aqui, '..')   // plataforma-react/
const fuentes = path.resolve(proyecto, '..', 'src') // src/ de la raíz del repositorio (estilos, lib.js y plantillas)

const leer = (rel) => fs.readFileSync(path.join(fuentes, rel), 'utf8')
const cuenta = (texto, marca) => texto.split(marca).length - 1

// Devuelve la lista de plantillas armadas { nombre, html }. Falla si alguna queda mal armada.
export function armarPlantillas() {
  const css = leer('base.css') + '\n' + leer('plataforma/tec.css')
  const lib = leer('lib.js') + '\n' + leer('plataforma/lib-extra.js')
  const carpeta = path.join(fuentes, 'plataforma', 'plantillas')
  const nombres = fs.readdirSync(carpeta).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort()
  if (!nombres.length) throw new Error('No hay plantillas en ' + carpeta)

  return nombres.map((nombre) => {
    const cruda = fs.readFileSync(path.join(carpeta, nombre + '.html'), 'utf8')
    // Mismo armado que render.js (construirHtml), con el tema por defecto y sin libre (con bloqueo) como las plantillas de ejemplo.
    const html = aplicarTema(incrustar(cruda, css, lib), temaBase(), false)
    for (const marca of [MARCA_TITULO, MARCA_CONTENIDO]) {
      if (cuenta(html, marca) !== 1) throw new Error(`Plantilla «${nombre}»: debe tener exactamente una marca ${marca} y tiene ${cuenta(html, marca)}.`)
    }
    for (const marca of MARCAS_INTERNAS) {
      if (html.includes(marca)) throw new Error(`Plantilla «${nombre}»: quedó sin reemplazar ${marca}.`)
    }
    return { nombre, html }
  })
}

// Escribe las plantillas y plantillas.json en la carpeta de salida (la vacía antes, para que no queden restos de plantillas borradas).
export function escribirPlantillas(salida) {
  const lista = armarPlantillas()
  fs.rmSync(salida, { recursive: true, force: true })
  fs.mkdirSync(salida, { recursive: true })
  for (const p of lista) fs.writeFileSync(path.join(salida, p.nombre + '.html'), p.html)
  const indice = {
    marcas: { titulo: MARCA_TITULO, contenido: MARCA_CONTENIDO },
    total: lista.length,
    plantillas: lista.map((p) => ({ nombre: p.nombre, archivo: p.nombre + '.html' }))
  }
  fs.writeFileSync(path.join(salida, 'plantillas.json'), JSON.stringify(indice, null, 2) + '\n')
  return lista.length
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const salida = path.resolve(process.argv[2] || path.join(proyecto, 'dist', 'plantillas-html'))
  console.log('Plantillas armadas: ' + escribirPlantillas(salida) + ' → ' + salida)
}
