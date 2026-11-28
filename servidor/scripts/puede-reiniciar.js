// Dice si se puede reiniciar el servidor sin cortar generaciones en curso. Exit 0 = sí, 1 = no (o no se pudo comprobar).
import 'dotenv/config'
import pg from 'pg'
import { trabajosEnCurso, textoTrabajos } from '../src/trabajos-en-curso.js'

const url = process.env.DATABASE_URL_DUENO || process.env.DATABASE_URL
if (!url) {
  console.error('Falta DATABASE_URL (o DATABASE_URL_DUENO).')
  process.exit(1)
}
const cliente = new pg.Client({ connectionString: url })
try {
  await cliente.connect()
  await cliente.query("SELECT set_config('app.ver_todos', 'on', false)") // con el usuario de la app, sin esto la base oculta las lecturas de bibliografía de otros
  const r = await trabajosEnCurso((t, v) => cliente.query(t, v))
  console.log(textoTrabajos(r))
  await cliente.end()
  process.exit(r.total === 0 ? 0 : 1)
} catch (e) {
  console.error('No se pudo comprobar (' + e.message + '). NO reinicie todavía.')
  process.exit(1)
}
