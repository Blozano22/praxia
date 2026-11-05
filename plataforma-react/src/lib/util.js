export const uid = () => 'x' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3)
export const clone = (o) => JSON.parse(JSON.stringify(o))
export const getIn = (o, path) => path.reduce((a, k) => (a == null ? a : a[k]), o)

// Actualiza una ruta copiando solo lo necesario (rápido aunque haya imágenes grandes).
export function setIn(o, path, val) {
  if (!path.length) return val
  const [k, ...rest] = path
  const base = Array.isArray(o) ? o.slice() : { ...(o || {}) }
  base[k] = setIn(o == null ? undefined : o[k], rest, val)
  return base
}

export function leerImagen(file, max, cb) {
  const fr = new FileReader()
  fr.onload = () => {
    const im = new Image()
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height))
      const c = document.createElement('canvas')
      c.width = Math.round(im.width * k)
      c.height = Math.round(im.height * k)
      const x = c.getContext('2d')
      const png = /png/i.test(file.type)
      if (!png) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height) }
      x.drawImage(im, 0, 0, c.width, c.height)
      cb(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.82))
    }
    im.src = fr.result
  }
  fr.readAsDataURL(file)
}
