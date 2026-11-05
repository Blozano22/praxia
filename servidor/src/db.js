import pg from 'pg'
import { config } from './config.js'

export const pool = new pg.Pool({ connectionString: config.baseDatos, max: 10, idleTimeoutMillis: 30000 })

// Todo lo que toca proyectos o enlaces corre aquí: dentro de una transacción donde la base de datos
// recibe QUIÉN es el usuario (app.usuario_id) y la política de filas (RLS) decide qué puede ver o escribir.
export async function conUsuario(usuario, trabajo) {
  const cliente = await pool.connect()
  try {
    await cliente.query('BEGIN')
    await cliente.query("SELECT set_config('app.usuario_id', $1, true), set_config('app.ver_todos', $2, true)", [
      usuario.id,
      usuario.permisos.has('proyectos.ver_todos') ? 'on' : 'off'
    ])
    const r = await trabajo(cliente)
    await cliente.query('COMMIT')
    return r
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    cliente.release()
  }
}

// Varias consultas de administración que deben quedar juntas o no quedar.
export async function conTransaccion(trabajo) {
  const cliente = await pool.connect()
  try {
    await cliente.query('BEGIN')
    const r = await trabajo(cliente)
    await cliente.query('COMMIT')
    return r
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    cliente.release()
  }
}

// Consultas que no dependen de un usuario con sesión (login, verificación de sesión).
export const sinUsuario = (texto, valores) => pool.query(texto, valores)
