// Levanta un PostgreSQL TEMPORAL (se borra al cerrar) con el servidor y usuarios de prueba, para probar la
// plataforma sin instalar nada. NO es para producción.  Uso: npm run demo
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const PUERTO_PG = Number(process.env.PG_PORT) || 54330
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ova-demo-'))
const motor = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'duenio', port: PUERTO_PG, persistent: false })
await motor.initialise()
await motor.start()
await motor.createDatabase('ova')

const duenio = new pg.Client({ connectionString: `postgres://postgres:duenio@localhost:${PUERTO_PG}/ova` })
await duenio.connect()
await duenio.query("CREATE ROLE ova_app LOGIN PASSWORD 'appclave' NOSUPERUSER NOBYPASSRLS")
for (const f of ['001_esquema.sql', '002_bibliografia.sql']) await duenio.query(fs.readFileSync(path.join(aqui, '..', 'sql', f), 'utf8'))
await duenio.end()

process.env.DATABASE_URL = `postgres://ova_app:appclave@localhost:${PUERTO_PG}/ova`
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex')
process.env.PORT = process.env.PORT || '3001'
// Secreto de DEMO para el receptor de avisos de n8n (solo este demo temporal; en producción va en el .env del servidor).
process.env.N8N_EVENTOS_SECRETO = process.env.N8N_EVENTOS_SECRETO || 'secreto-solo-para-el-demo-local-0123456789'
const { pool } = await import('../src/db.js')
const { hashClave } = await import('../src/seguridad.js')
const { Q } = await import('../src/consultas.js')
const clave = 'ClaveDemo2026'
for (const [n, c, r] of [['Administradora', 'admin@demo.co', 'admin'], ['Ana Docente', 'ana@demo.co', 'docente'], ['Beto Coordinador', 'beto@demo.co', 'coordinador'], ['Dani Diseñador', 'dani@demo.co', 'disenador'], ['Edi Editor', 'edi@demo.co', 'editor_html'], ['Edu Editor', 'edu@demo.co', 'editor_html']]) {
  await pool.query(Q.usuarioCrear, [n, c, await hashClave(clave), [r]])
}
const { crearApp } = await import('../src/app.js')
crearApp().listen(Number(process.env.PORT), () => {
  console.log('DEMO lista en http://127.0.0.1:' + process.env.PORT + '  (usuarios admin@demo.co, ana@demo.co, beto@demo.co · clave ' + clave + ')')
})
const cerrar = async () => { await pool.end(); await motor.stop(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0) }
process.on('SIGINT', cerrar)
process.on('SIGTERM', cerrar)
