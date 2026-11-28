// Lo que un reinicio del servidor cortaría o afectaría ahora. `consulta(texto, valores)` es sinUsuario (ruta) o el query de un cliente de pg (script).
//  - BLOQUEAN: viven en el proceso de Praxia o Praxia espera a n8n con una petición abierta (guiones, unidades, bibliografía, «Preparar el curso»).
//  - AVISAN: n8n sigue trabajando y avisará a Praxia después (matrices, H5P, publicación, cola de regenerar): durante el reinicio se pueden perder avisos.
//  - COLGADOS: llevan demasiado sin respuesta (mismos plazos que usa el código para darlos por vencidos): se muestran aparte y no bloquean.
// No se detectan (solo viven en memoria, sin rastro en la base): las rúbricas, el auditor de guiones y la compartición de carpeta con el diseñador.
const N8N_MIN = Number(process.env.N8N_MINUTOS_MAXIMO || 45)
const VENCE_N8N = N8N_MIN + 5 // minutos: guiones y unidades (igual que guionTrabajosCaducar / unidadTrabajosCaducar)
const VENCE_PREPARACION = Math.min(20, N8N_MIN) // minutos: la espera máxima de la llamada de preparación
const VENCE_BIB = N8N_MIN // minutos sin actualizar una lectura de bibliografía
const VENCE_CORRIDA = 15 // minutos sin avisos de una corrida de n8n (pipeEnCurso)
const VENCE_PUBLICAR = 30 // minutos de un recurso EN_PROCESO (aprobar/publicar)

const mins = (n) => `now() - (${Number(n)} * interval '1 minute')`
// Cada consulta devuelve: id, proyecto, unidad, desde, vencido (boolean).
const SQL = {
  guiones: `SELECT id::text, proyecto_id AS proyecto, unidad, creado AS desde, creado < ${mins(VENCE_N8N)} AS vencido
              FROM guiones_trabajos WHERE estado = 'en_curso' ORDER BY creado`,
  unidades: `SELECT id::text, coalesce(proyecto_id, curso) AS proyecto, NULL::text AS unidad, creado AS desde, creado < ${mins(VENCE_N8N)} AS vencido
              FROM unidades_trabajos WHERE estado = 'en_curso' ORDER BY creado`,
  bibliografia: `SELECT id::text, proyecto_id AS proyecto, NULL::text AS unidad, creado AS desde, coalesce(actualizado, creado) < ${mins(VENCE_BIB)} AS vencido
              FROM bib_trabajos WHERE estado IN ('pendiente','procesando') ORDER BY creado`,
  // «Preparar el curso» no tiene estado propio: su rastro es el origen 'preparacion' (se crea al llamar a n8n y la llamada dura como máximo VENCE_PREPARACION minutos).
  // Pasado ese plazo ya no cuenta (terminó o falló): no se muestra como colgado porque no hay forma de distinguirlo.
  preparacion: `SELECT trabajo_id::text AS id, proyecto_id AS proyecto, unidad::text AS unidad, creado AS desde, false AS vencido
              FROM pipeline_origen WHERE etapa = 'preparacion' AND creado >= ${mins(VENCE_PREPARACION)} ORDER BY creado`,
  corridas: `SELECT ejecucion_id AS id, proyecto_id AS proyecto, etapa AS unidad, coalesce(iniciado_en, ultimo_evento_en) AS desde, ultimo_evento_en < ${mins(VENCE_CORRIDA)} AS vencido
              FROM pipeline_ejecuciones WHERE estado = 'en_curso' ORDER BY 4`,
  matrices: `SELECT proyecto_id || ':' || unidad AS id, proyecto_id AS proyecto, unidad::text AS unidad, actualizado_en AS desde, actualizado_en < ${mins(VENCE_CORRIDA)} AS vencido
              FROM pipeline_matrices WHERE estado = 'generando' ORDER BY actualizado_en`,
  recursos: `SELECT id, proyecto_id AS proyecto, unidad::text AS unidad, actualizado_en AS desde, actualizado_en < ${mins(VENCE_PUBLICAR)} AS vencido
              FROM pipeline_recursos WHERE estado = 'EN_PROCESO' ORDER BY actualizado_en`,
  cola: `SELECT codigo AS id, proyecto_id AS proyecto, NULL::text AS unidad, pedido_en AS desde, false AS vencido
              FROM regenerar_cola ORDER BY pedido_en`,
}
export const ROTULOS = {
  guiones: 'Generaciones de guiones', unidades: 'Creación de unidades', bibliografia: 'Lecturas de bibliografía', preparacion: 'Preparar el curso (variantes)',
  corridas: 'Corridas de matrices/H5P en n8n', matrices: 'Matrices generándose', recursos: 'Recursos H5P en proceso o publicándose', cola: 'Cola de regenerar pendiente',
}
const BLOQUEAN = ['guiones', 'unidades', 'bibliografia', 'preparacion']
const AVISAN = ['corridas', 'matrices', 'recursos', 'cola']

export async function trabajosEnCurso(consulta) {
  const trabajos = [], avisos = [], colgados = []
  for (const tipo of [...BLOQUEAN, ...AVISAN]) {
    const filas = (await consulta(SQL[tipo])).rows
    for (const f of filas) {
      const t = { id: f.id, tipo, proyecto: f.proyecto, unidad: f.unidad, desde: f.desde }
      if (f.vencido) colgados.push(t)
      else (BLOQUEAN.includes(tipo) ? trabajos : avisos).push(t)
    }
  }
  return { total: trabajos.length, trabajos, avisos, colgados }
}

const hora = (d) => new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota' })
const grupo = (lista) => {
  const por = {}
  for (const t of lista) (por[t.tipo] ||= []).push(t)
  return Object.entries(por).map(([tipo, l]) => `  ${ROTULOS[tipo]}:\n` +
    l.map((t) => `    - proyecto ${t.proyecto || '-'}${t.unidad ? ', unidad/etapa ' + t.unidad : ''}${tipo === 'cola' ? ', código ' + t.id : ''}, desde ${hora(t.desde)}`).join('\n')).join('\n')
}

export function textoTrabajos(r) {
  const partes = []
  partes.push(r.total === 0 ? 'Se puede reiniciar: no hay trabajos que se perderían.' : `NO reinicie todavía: hay ${r.total} trabajo(s) en curso que se perderían:\n` + grupo(r.trabajos))
  if (r.avisos && r.avisos.length) partes.push(`Atención: ${r.avisos.length} trabajo(s) siguen en n8n; se pueden perder avisos que lleguen durante el reinicio (luego revise esos cursos):\n` + grupo(r.avisos))
  if (r.colgados && r.colgados.length) partes.push('Colgados (sin respuesta hace tiempo; no bloquean):\n' + grupo(r.colgados))
  return partes.join('\n')
}
