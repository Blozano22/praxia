// Formaciones de los recursos y su paleta (color base y color oscuro). Las plantillas leen la formación del JSON (nivel) o de window.__NIVEL;
// la vista previa inyecta __NIVEL en la plantilla para ver cómo queda con los colores de cada formación.
export const FORMACIONES = [
  { id: 'tecnologico', nivel: 'tecnologia', nombre: 'Tecnológico', base: '#00665F', oscuro: '#142749' },
  { id: 'profesional', nivel: 'profesional', nombre: 'Profesional', base: '#1C45B4', oscuro: '#151B3B' },
  { id: 'especializacion', nivel: 'especializacion', nombre: 'Especialización', base: '#08A6CB', oscuro: '#151B3B' },
  { id: 'doctorado', nivel: 'doctorado', nombre: 'Doctorado', base: '#22335D', oscuro: '#151B3B' }
]
export const NOMBRE_FORMACION = Object.fromEntries(FORMACIONES.map((f) => [f.id, f.nombre]))
export const PRIORIDAD = { P: 'Prioritaria', C: 'Complementaria' }

// Devuelve el HTML de una plantilla con la formación fijada (id de FORMACIONES, p. ej. 'doctorado'); sin formación, igual que llegó.
export function conFormacion(html, formacionId) {
  const f = FORMACIONES.find((x) => x.id === formacionId)
  if (!f || !html) return html
  const marca = '<script>window.__NIVEL=' + JSON.stringify(f.nivel) + '</script>'
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + marca) : marca + html
}
