// Las variantes que nombra el servidor (g-08-v01, pre-04-v02, g-09-tec-v01…) se muestran siempre en mayúscula: G-08-V01, G-09-TEC-V01.
// El nombre real del archivo no cambia; el resto de nombres (acordeon-2, lineatiempo…) se dejan como están.
const RE_CODIGO = /^[a-z]{1,4}-\d{2,3}(-(tec|pre|esp|doc))?-v\d+$/i
export const verNombre = (n) => (typeof n === 'string' && RE_CODIGO.test(n) ? n.toUpperCase() : n)
