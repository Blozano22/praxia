// La plataforma puede estar en la raíz del sitio o en una subcarpeta (p. ej. /praxia/): la API siempre cuelga de la misma carpeta que la página.
export const RUTA_API = location.pathname.replace(/\/[^/]*$/, '') + '/api'

// Cliente de la API. La sesión viaja en una cookie httpOnly (el código de la página nunca ve el token).
export class ErrorApi extends Error {
  constructor(estado, mensaje, datos = null) {
    super(mensaje)
    this.estado = estado
    this.datos = datos // cuerpo de la respuesta de error, por si trae más datos (p. ej. el id de un trabajo ya en curso)
  }
}

export async function api(metodo, ruta, cuerpo) {
  const r = await fetch(RUTA_API + ruta, {
    method: metodo,
    credentials: 'same-origin',
    headers: { 'x-ova': '1', ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
  })
  let datos = null
  try { datos = await r.json() } catch { /* sin cuerpo */ }
  if (!r.ok) throw new ErrorApi(r.status, (datos && datos.error) || 'Error ' + r.status, datos)
  return datos
}

// Descarga un archivo (p. ej. un Google Doc convertido a Word por el servidor) y devuelve su contenido binario.
export async function apiArchivo(ruta, cuerpo) {
  const r = await fetch(RUTA_API + ruta, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'x-ova': '1', 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo)
  })
  if (!r.ok) {
    let d = null
    try { d = await r.json() } catch { /* sin cuerpo */ }
    throw new ErrorApi(r.status, r.status === 400 ? 'Pegue un enlace válido de Google Docs.' : (d && d.error) || 'Error ' + r.status)
  }
  return r.arrayBuffer()
}
