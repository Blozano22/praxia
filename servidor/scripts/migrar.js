// Ejecuta los archivos de servidor/sql en orden. Usar la cadena del DUEÑO de la base (DATABASE_URL_DUENO).
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const url = process.env.DATABASE_URL_DUENO
if (!url) {
  console.error('Falta DATABASE_URL_DUENO (usuario dueño de la base, no el de la aplicación).')
  process.exit(1)
}
const carpeta = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sql')
const cliente = new pg.Client({ connectionString: url })
await cliente.connect()
for (const f of fs.readdirSync(carpeta).filter((x) => x.endsWith('.sql')).sort()) {
  await cliente.query(fs.readFileSync(path.join(carpeta, f), 'utf8'))
  console.log('aplicado', f)
}
await cliente.end()
