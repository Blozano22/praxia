// Estado de pantalla guardado en la parte «?» de la dirección (#/ruta?clave=valor&…), para que recargar la página no saque de donde se estaba.
// La ruta (antes del «?») la maneja App.jsx; aquí solo se leen y cambian claves sueltas sin tocar la ruta ni las demás claves.
const partes = () => { const h = location.hash || ''; const i = h.indexOf('?'); return [i < 0 ? h : h.slice(0, i), new URLSearchParams(i < 0 ? '' : h.slice(i + 1))] }

export const leerHash = (clave) => partes()[1].get(clave) || ''

// Cambia las claves dadas (un valor vacío o null la quita) y deja el resto igual.
export function ponerHash(cambios) {
  const [ruta, q] = partes()
  for (const [k, v] of Object.entries(cambios)) { if (v) q.set(k, String(v)); else q.delete(k) }
  const s = q.toString()
  const nuevo = ruta + (s ? '?' + s : '')
  if (nuevo !== location.hash) history.replaceState(null, '', nuevo)
}
