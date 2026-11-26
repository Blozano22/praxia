// ZIP mínimo sin dependencias: deflate (zlib) + CRC32, nombres en UTF-8, fecha DOS; los directorios son implícitos (van en las rutas).
import zlib from 'node:zlib'

const TABLA = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
export function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
function fechaDos(d) {
  const y = Math.max(1980, d.getFullYear())
  return { hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dia: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }
}
// entradas: [{ ruta: 'A/b.html', datos: Buffer|string, fecha?: Date }] → Buffer del ZIP.
export function crearZip(entradas, ahora = new Date()) {
  const partes = []
  const central = []
  let pos = 0
  for (const e of entradas) {
    const nombre = Buffer.from(e.ruta, 'utf8')
    const datos = Buffer.isBuffer(e.datos) ? e.datos : Buffer.from(e.datos, 'utf8')
    const comp = zlib.deflateRawSync(datos)
    const usarDeflate = comp.length < datos.length
    const cuerpo = usarDeflate ? comp : datos
    const metodo = usarDeflate ? 8 : 0
    const { hora, dia } = fechaDos(e.fecha || ahora)
    const crc = crc32(datos)
    const loc = Buffer.alloc(30)
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(metodo, 8)
    loc.writeUInt16LE(hora, 10); loc.writeUInt16LE(dia, 12); loc.writeUInt32LE(crc, 14)
    loc.writeUInt32LE(cuerpo.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(nombre.length, 26); loc.writeUInt16LE(0, 28)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(metodo, 10)
    cen.writeUInt16LE(hora, 12); cen.writeUInt16LE(dia, 14); cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(cuerpo.length, 20); cen.writeUInt32LE(datos.length, 24); cen.writeUInt16LE(nombre.length, 28)
    cen.writeUInt32LE(pos, 42)
    central.push(cen, nombre)
    partes.push(loc, nombre, cuerpo)
    pos += 30 + nombre.length + cuerpo.length
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10)
  fin.writeUInt32LE(tamCentral, 12); fin.writeUInt32LE(pos, 16)
  return Buffer.concat([...partes, ...central, fin])
}

// Nombre seguro para carpeta o archivo: sin / \ : * ? " < > | ni controles, sin puntos/espacios al borde, longitud acotada.
export function sanear(s, max = 80) {
  const t = String(s ?? '').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+|[. ]+$/g, '').slice(0, max).trim()
  return t || '_'
}
// Lector mínimo (para pruebas): { ruta: Buffer }.
export function leerZip(buf) {
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const n = buf.readUInt16LE(fin + 10)
  let p = buf.readUInt32LE(fin + 16)
  const out = {}
  for (let i = 0; i < n; i++) {
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42)
    const nombre = buf.toString('utf8', p + 46, p + 46 + nl)
    const ini = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28)
    const cuerpo = buf.subarray(ini, ini + tam)
    const datos = metodo === 8 ? zlib.inflateRawSync(cuerpo) : Buffer.from(cuerpo)
    if (crc32(datos) !== buf.readUInt32LE(p + 16)) throw new Error('CRC incorrecto: ' + nombre)
    out[nombre] = datos
    p += 46 + nl + el + cl
  }
  return out
}
