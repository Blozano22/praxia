// Prepara un PostgreSQL LOCAL para desarrollo: crea la base «ova», el usuario «ova_app» (sin privilegios de dueño),
// aplica las migraciones y escribe servidor/.env con la cadena de la aplicación y un JWT_SECRET aleatorio.
// La clave del dueño de PostgreSQL se pasa solo por variable de entorno y NO se guarda en ningún archivo:
//   DATABASE_URL_DUENO=postgres://postgres:CLAVE@localhost:5432/postgres npm run db:preparar
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const dueno = process.env.DATABASE_URL_DUENO
if (!dueno) {
  console.error('Falta DATABASE_URL_DUENO (por ejemplo postgres://postgres:CLAVE@localhost:5432/postgres).')
  process.exit(1)
}
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const archivoEnv = path.join(raiz, '.env')
const url = new URL(dueno)
const BASE = 'ova'

const claveApp = crypto.randomBytes(24).toString('hex')
let admin = new pg.Client({ connectionString: dueno })
await admin.connect()

if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [BASE])).rowCount) await admin.query('CREATE DATABASE ' + BASE)
const existeRol = (await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'ova_app'")).rowCount > 0
let claveFinal = claveApp
if (existeRol && fs.existsSync(archivoEnv)) {
  // Si ya hay .env, se conserva la clave de la aplicación que ya estaba en uso.
  const m = /^DATABASE_URL=postgres:\/\/ova_app:([^@]+)@/m.exec(fs.readFileSync(archivoEnv, 'utf8'))
  if (m) claveFinal = decodeURIComponent(m[1])
}
// ALTER/CREATE ROLE no admite parámetros: la clave es hexadecimal generada aquí, nunca texto de un usuario.
const sentencia = existeRol ? 'ALTER ROLE ova_app LOGIN PASSWORD ' : 'CREATE ROLE ova_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '
await admin.query(sentencia + "'" + claveFinal.replace(/'/g, "''") + "'")
await admin.end()

url.pathname = '/' + BASE
admin = new pg.Client({ connectionString: url.href })
await admin.connect()
const carpeta = path.join(raiz, 'sql')
for (const f of fs.readdirSync(carpeta).filter((x) => x.endsWith('.sql')).sort()) {
  await admin.query(fs.readFileSync(path.join(carpeta, f), 'utf8'))
  console.log('aplicado', f)
}
await admin.end()

if (!fs.existsSync(archivoEnv)) {
  const host = url.host
  fs.writeFileSync(archivoEnv,
    `DATABASE_URL=postgres://ova_app:${claveFinal}@${host}/${BASE}\nJWT_SECRET=${crypto.randomBytes(48).toString('hex')}\nPORT=3001\nHORAS_SESION=8\nCOOKIE_SEGURA=false\nCARPETA_WEB=../plataforma-react/dist\n`)
  console.log('Escribí servidor/.env (no se sube a ningún repositorio).')
} else {
  console.log('servidor/.env ya existía: no lo modifiqué.')
}
console.log('Base lista.')
