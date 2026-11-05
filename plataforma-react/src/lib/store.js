// Syllabus (y todo lo que cuelga de ellos) guardados en el navegador (IndexedDB).
const abrir = () =>
  new Promise((res, rej) => {
    try {
      const r = indexedDB.open('ova-plataforma', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('proyectos', { keyPath: 'id' })
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    } catch (e) {
      rej(e)
    }
  })

const tx = async (modo, fn) => {
  const d = await abrir()
  return new Promise((res, rej) => {
    const t = d.transaction('proyectos', modo)
    const q = fn(t.objectStore('proyectos'))
    t.oncomplete = () => res(q && q.result)
    t.onerror = () => rej(t.error)
  })
}

import { ubicar } from './ubicar.js'
import { api } from './api.js'

// Los proyectos creados antes de existir los syllabus se convierten en un syllabus «sin generar».
export function normalizar(p) {
  const info = p.info || {}
  return {
    ...p,
    programa: p.programa || info.programa || 'Sin programa',
    curso: p.curso || info.nombre_de_la_asignatura || p.nombre || 'Sin nombre',
    syllabusUrl: p.syllabusUrl || '',
    carpetaUrl: p.carpetaUrl || '',
    syllabus: p.syllabus || { estado: 'sin', documentos: [], mensaje: '' },
    recursos: (p.recursos || []).map((r) => (r.unidad === undefined ? { ...r, unidad: ubicar(r.codigo).unidad, numTema: ubicar(r.codigo).tema } : r)),
    guiones: p.guiones || [],
    temas: p.temas || {},
    guionesUnidad: p.guionesUnidad || {}
  }
}

// Los syllabus viven en la base de datos del servidor y cada usuario solo recibe los que creó.
export const todos = async () => (await api('GET', '/proyectos')).map(normalizar)
export const guardar = (p) => api('PUT', '/proyectos/' + encodeURIComponent(p.id), p)
export const borrar = (id) => api('DELETE', '/proyectos/' + encodeURIComponent(id))

// Syllabus que quedaron guardados en este navegador antes de existir la base de datos (para importarlos una vez).
export const locales = async () => {
  try { return (await tx('readonly', (s) => s.getAll())).map(normalizar) } catch { return [] }
}
export const borrarLocal = (id) => tx('readwrite', (s) => s.delete(id))
