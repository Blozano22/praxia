// Lo que un reinicio del servidor cortaría ahora: las generaciones de guiones esperan a n8n con una petición abierta.
// `consulta(texto, valores)` es sinUsuario (ruta) o el query de un cliente de pg (script): el mismo código para ambos.
import { Q } from './consultas.js'

export async function trabajosEnCurso(consulta) {
  const filas = (await consulta(Q.guionTrabajosEnCursoTodos)).rows
  const trabajos = filas.map((f) => ({ id: f.id, tipo: 'guiones', proyecto: f.proyecto, unidad: f.unidad, desde: f.creado }))
  return { total: trabajos.length, trabajos }
}

export const textoTrabajos = (r) => r.total === 0
  ? 'Se puede reiniciar: no hay generaciones en curso.'
  : `NO reinicie todavía: hay ${r.total} generación(es) en curso que se perderían:\n` +
    r.trabajos.map((t) => `  - proyecto ${t.proyecto}, unidad ${t.unidad}, desde ${new Date(t.desde).toLocaleString('es-CO')}`).join('\n')
