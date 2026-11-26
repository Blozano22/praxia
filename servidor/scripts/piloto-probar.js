// «Curso piloto»: prueba manual del análisis sin levantar la API.
//   node scripts/piloto-probar.js <url-carpeta-de-drive>                       carpeta pública real (lee de internet; el catálogo de plantillas, de la base)
//   node scripts/piloto-probar.js --fixtures <dir>                             carpeta local que imita Drive (ver test/fixtures/piloto)
//   ... --sin-base <plantillas.json>                                           lee tipoDe/formDe/variantesDe de un JSON local en vez de la base (no toca la base)
//   ... --pruebas                                                              simula con el modo de pruebas de plantillas encendido
// Imprime el resultado (esquema del diseño, §6) en JSON. No escribe nada en la base de datos.
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const tomar = (bandera) => { const i = args.indexOf(bandera); if (i < 0) return null; const v = args[i + 1]; args.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true }
const dirFixtures = tomar('--fixtures')
const sinBase = tomar('--sin-base')
const pruebas = tomar('--pruebas')
const url = args.find((a) => !a.startsWith('--'))
if (!dirFixtures && !url) { console.error('Uso: node scripts/piloto-probar.js <url-carpeta | --fixtures <dir>> [--sin-base <plantillas.json>] [--pruebas]'); process.exit(2) }

// Sin base de datos no hace falta una configuración real (el módulo de configuración exige estas variables al importarse).
if (sinBase) { process.env.DATABASE_URL ||= 'postgres://sin-base:sin-base@127.0.0.1:1/sin-base'; process.env.JWT_SECRET ||= 'x'.repeat(40) }

const { analizarCarpeta } = await import('../src/piloto/analisis.js')
const { crearFuenteFixtures, crearFuentePublica } = await import('../src/piloto/fuentes.js')

let fuente; let carpetaId
if (dirFixtures) { fuente = crearFuenteFixtures(String(dirFixtures)); carpetaId = 'fixturesraiz0000000000' } else {
  const m = /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,100})/.exec(url)
  if (!m) { console.error('Pegue el enlace de una carpeta de Google Drive'); process.exit(2) }
  fuente = crearFuentePublica(); carpetaId = m[1]
}
const opciones = { carpetaId, resourcekey: url ? new URL(url).searchParams.get('resourcekey') || undefined : undefined, fuente, alAvanzar: ({ paso, hechos, total }) => console.error('· ' + paso + ' (' + hechos + '/' + total + ')') }
if (sinBase) {
  const j = JSON.parse(fs.readFileSync(path.resolve(String(sinBase)), 'utf8'))
  opciones.plantillas = async () => ({ tipoDe: new Map(Object.entries(j.tipoDe)), formDe: j.formDe, variantesDe: j.variantesDe })
  opciones.pruebas = async () => !!pruebas
} else if (pruebas) opciones.pruebas = async () => true
try {
  const r = await analizarCarpeta(opciones)
  console.log(JSON.stringify(r, null, 2))
  process.exit(0)
} catch (e) { console.error('Error: ' + (e && e.codigo ? e.codigo : e && e.message)); process.exit(1) }
