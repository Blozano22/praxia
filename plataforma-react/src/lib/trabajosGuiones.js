// Generaciones de guiones en curso. Viven fuera de los componentes: si la persona sale de la unidad o cambia de pantalla,
// la petición a n8n sigue, el aviso «generando» se conserva y, al terminar, el resultado se guarda en el proyecto.
// Una unidad tiene a lo sumo una generación a la vez (no se puede enviar dos veces).
import { useSyncExternalStore } from 'react'
import { generarGuiones } from './syllabus.js'

const trabajos = new Map() // clave -> { desde, error }
const oyentes = new Set()
let version = 0
let anfitrion = { obtener: () => null, guardar: () => {} } // lo fija App: da el proyecto más reciente y lo guarda

const clave = (id, unidad) => id + '|' + unidad
const avisar = () => { version++; oyentes.forEach((f) => f()) }
const suscribir = (f) => { oyentes.add(f); return () => oyentes.delete(f) }

export const fijarAnfitrion = (a) => { anfitrion = a }

// Estado de una unidad: { generando, desde, error, sinBib }
export function useTrabajoGuiones(id, unidad) {
  useSyncExternalStore(suscribir, () => version)
  const t = trabajos.get(clave(id, unidad))
  return { generando: !!t && !t.error, desde: t ? t.desde : 0, error: t && t.error ? t.error : null, sinBib: !!(t && t.sinBib) }
}
export function useUnidadesGenerando(id) {
  useSyncExternalStore(suscribir, () => version)
  return [...trabajos.entries()].filter(([k, t]) => k.startsWith(id + '|') && !t.error).map(([k]) => Number(k.split('|')[1]))
}

export const descartarError = (id, unidad) => { const t = trabajos.get(clave(id, unidad)); if (t && t.error) { trabajos.delete(clave(id, unidad)); avisar() } }

// Lanza la generación. Devuelve false si ya había una en curso para esa unidad.
export function iniciarGuiones({ id, unidad, params, bibliografiaId }) {
  const k = clave(id, unidad)
  const previo = trabajos.get(k)
  if (previo && !previo.error) return false
  trabajos.set(k, { desde: Date.now(), error: null })
  avisar()
  generarGuiones(params).then((nuevos) => {
    const s = anfitrion.obtener(id) // proyecto más reciente (puede haber cambiado mientras esperaba)
    if (s) anfitrion.guardar({ ...s, bibliografiaId: bibliografiaId || s.bibliografiaId || '', guionesUnidad: { ...(s.guionesUnidad || {}), [unidad]: { fecha: Date.now(), archivos: nuevos.map((a) => ({ ...a, aprobado: false, visto: false })) } } })
    trabajos.delete(k)
    avisar()
  }).catch((e) => {
    trabajos.set(k, { desde: 0, error: e, sinBib: !bibliografiaId }) // el error se conserva hasta que se reintente o se descarte
    avisar()
  })
  return true
}
