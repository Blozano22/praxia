// Crea el «origen» de un trabajo de PRUEBA (un trabajo_id ligado a una persona y a un curso) para poder probar el receptor de avisos
// de n8n sin lanzar guiones de verdad. Imprime el trabajo_id que n8n debe usar en sus avisos de prueba.
//   node scripts/crear-origen-prueba.js <correo de la persona> <id del curso en Praxia>
// Usa la conexión de la aplicación (DATABASE_URL del .env).
import 'dotenv/config'
import crypto from 'node:crypto'
import pg from 'pg'

const [correo, proyecto] = process.argv.slice(2)
if (!correo || !proyecto || !/^[A-Za-z0-9_-]{1,64}$/.test(proyecto)) {
  console.error('Uso: node scripts/crear-origen-prueba.js <correo> <id del curso (letras, números, _ y -)>')
  process.exit(1)
}
const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cliente.connect()
try {
  const u = (await cliente.query('SELECT id FROM usuarios WHERE lower(correo) = lower($1)', [correo])).rows[0]
  if (!u) { console.error('No existe esa persona.'); process.exit(1) }
  const trabajoId = crypto.randomUUID()
  await cliente.query("INSERT INTO pipeline_origen (trabajo_id, propietario_id, proyecto_id, etapa) VALUES ($1, $2, $3, 'guiones')", [trabajoId, u.id, proyecto])
  console.log('trabajo_id de prueba: ' + trabajoId + '  (persona: ' + correo + ', curso: ' + proyecto + ')')
} finally { await cliente.end() }
