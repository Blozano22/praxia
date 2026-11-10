// Crea un usuario con los roles indicados (por defecto, administrador). La clave NO se guarda en ningún archivo:
//   ADMIN_CORREO, ADMIN_NOMBRE, ADMIN_CLAVE y opcionalmente ADMIN_ROLES=admin,docente, y luego: npm run usuario:crear-admin
import 'dotenv/config'
import { pool } from '../src/db.js'
import { Q } from '../src/consultas.js'
import { claveValida, hashClave } from '../src/seguridad.js'

const { ADMIN_CORREO: correo, ADMIN_NOMBRE: nombre, ADMIN_CLAVE: clave } = process.env
const roles = (process.env.ADMIN_ROLES || 'admin').split(',').map((r) => r.trim()).filter(Boolean)
if (!roles.length || roles.some((r) => !['admin', 'coordinador', 'docente', 'disenador'].includes(r))) {
  console.error('ADMIN_ROLES solo admite: admin, coordinador, docente, disenador (separados por coma).')
  process.exit(1)
}
if (!correo || !nombre || !claveValida(clave)) {
  console.error('Faltan ADMIN_CORREO, ADMIN_NOMBRE o ADMIN_CLAVE (mínimo 10 caracteres con mayúscula, minúscula y número).')
  process.exit(1)
}
try {
  const f = (await pool.query(Q.usuarioCrear, [nombre, correo.toLowerCase(), await hashClave(clave), roles])).rows[0]
  console.log('Usuario creado:', f.correo, '· roles:', roles.join(', '))
} catch (e) {
  console.error(e.code === '23505' ? 'Ese correo ya existe.' : 'No se pudo crear: ' + e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
