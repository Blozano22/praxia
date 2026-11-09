// Descarga segura de direcciones que escribe una persona (SSRF): solo http/https, puertos normales, nunca
// direcciones privadas o locales, cada redirección se vuelve a validar, con tope de tamaño y de tiempo.
import dns from 'node:dns/promises'
import net from 'node:net'

const PUERTOS = new Set(['', '80', '443', '8080', '8443'])
export const MAX_BYTES = 40 * 1024 * 1024
const UA = 'Mozilla/5.0 (compatible; PraxiaBibliografia/1.0; +lectura de fuentes del syllabus)'

export function esIpPrivada(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase()
    if (x === '::1' || x === '::') return true
    if (x.startsWith('::ffff:')) return esIpPrivada(x.slice(7))
    return /^(fc|fd|fe[89ab])/.test(x)
  }
  return true
}

export async function validarDestino(texto) {
  let u
  try { u = new URL(texto) } catch { throw new Error('Dirección no válida') }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Solo se permiten direcciones http o https')
  if (u.username || u.password) throw new Error('La dirección no puede llevar usuario ni clave')
  if (!PUERTOS.has(u.port)) throw new Error('Puerto no permitido')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Dirección interna no permitida')
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address)
  if (!ips.length || ips.some(esIpPrivada)) throw new Error('Dirección interna no permitida')
  return u
}

// Devuelve { url (final), estado, tipo, datos (Buffer) }. Lanza Error con un mensaje claro si no se puede.
export async function descargar(texto, { maxBytes = MAX_BYTES, tiempoMs = 25000, aceptar = '*/*' } = {}) {
  let url = texto
  for (let salto = 0; salto < 5; salto++) {
    const u = await validarDestino(url)
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(tiempoMs), headers: { 'user-agent': UA, accept: aceptar, 'accept-language': 'es,en;q=0.8' } })
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), u).href; continue }
    const largo = Number(r.headers.get('content-length') || 0)
    if (largo > maxBytes) throw new Error('El archivo es demasiado grande')
    const partes = []; let total = 0
    for await (const trozo of r.body) {
      total += trozo.length
      if (total > maxBytes) throw new Error('El archivo es demasiado grande')
      partes.push(trozo)
    }
    return { url: u.href, estado: r.status, tipo: (r.headers.get('content-type') || '').toLowerCase(), datos: Buffer.concat(partes) }
  }
  throw new Error('Demasiadas redirecciones')
}
