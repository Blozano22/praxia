// Avisos temporales de las plantillas HTML («Dani aprobó G-01-PRE-V07»). NO se guardan en la base de datos ni en ningún archivo: viven unos minutos en la
// memoria del servidor, en el «buzón» de la persona a quien le importan, hasta que su navegador los recoge (entonces se borran) o se vencen.
// Si el servidor se reinicia, los que no se recogieron se pierden: son avisos del momento, no un historial (el historial de la plantilla es otra cosa).
import crypto from 'node:crypto'

export const VIDA_MS = 3 * 60 * 1000 // un aviso que nadie recoge en 3 minutos se descarta
const MAX_POR_PERSONA = 20
const buzones = new Map() // id de la persona → lista de avisos

const vigentes = (lista, ahora) => lista.filter((a) => ahora - a.creado < VIDA_MS)

export function publicarAviso(usuarioId, aviso) {
  if (!usuarioId) return null
  const ahora = Date.now()
  const completo = { id: crypto.randomUUID(), creado: ahora, ...aviso }
  const lista = vigentes(buzones.get(usuarioId) || [], ahora)
  lista.push(completo)
  buzones.set(usuarioId, lista.slice(-MAX_POR_PERSONA))
  return completo
}

// Devuelve los avisos vigentes de la persona y los borra del buzón.
export function tomarAvisos(usuarioId) {
  const lista = vigentes(buzones.get(usuarioId) || [], Date.now())
  buzones.delete(usuarioId)
  return lista
}

// Limpieza de buzones olvidados (personas que no volvieron a entrar). No impide que el proceso termine.
const limpieza = setInterval(() => {
  const ahora = Date.now()
  for (const [id, lista] of buzones) { const v = vigentes(lista, ahora); if (v.length) buzones.set(id, v); else buzones.delete(id) }
}, 60 * 1000)
limpieza.unref()

export const _vaciarAvisos = () => buzones.clear() // solo para las pruebas
