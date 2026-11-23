// Descarga segura de direcciones que escribe una persona (SSRF): solo http/https, puertos normales, nunca
// direcciones privadas o locales, cada redirección se vuelve a validar, con tope de tamaño y de tiempo.
import dns from 'node:dns/promises'
import net from 'node:net'
import tls from 'node:tls'
import { X509Certificate } from 'node:crypto'
import { Agent } from 'undici'

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

// ---- Certificados intermedios que el sitio no envía --------------------------------------------------------------------------
// Muchos sitios del Estado (funcionpublica, dnp, sic…) mandan solo su certificado y no el de la entidad que lo firmó. Los navegadores
// lo completan solos con la dirección «AIA» del propio certificado; Node no, y la descarga falla con UNABLE_TO_VERIFY_LEAF_SIGNATURE.
// Aquí se hace lo mismo que el navegador SIN saltarse la verificación: se baja el intermedio desde esa dirección (revisada como cualquier
// otra), se comprueba que de verdad firmó el certificado del sitio y que su cadena llega a una raíz de confianza, y solo entonces se usa.
const ERRORES_CADENA = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT'])
const RAICES = tls.rootCertificates.map((p) => new X509Certificate(p))
const intermedios = new Map() // huella → X509Certificate (ya verificado hasta una raíz)
let agenteConIntermedios = null

const certDe = (buf) => { try { return new X509Certificate(buf) } catch { return null } }
async function certificadoDeEmisor(hoja) {
  const m = /CA Issuers - URI:(\S+)/.exec(hoja.infoAccess || '')
  if (!m) return null
  const u = await validarDestino(m[1]) // misma revisión que cualquier dirección: nada interno ni raro
  const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'user-agent': UA } })
  if (!r.ok) return null
  const datos = Buffer.from(await r.arrayBuffer())
  if (datos.length > 100 * 1024) return null
  return certDe(datos)
}

// Pide el certificado del sitio (sin enviar ni recibir datos) y completa la cadena. true si quedó un intermedio nuevo verificado.
async function aprenderIntermedios(host, puerto) {
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address)
  if (!ips.length || ips.some(esIpPrivada)) return false
  const crudo = await new Promise((resuelve, rechaza) => {
    const s = tls.connect({ host: ips[0], port: Number(puerto) || 443, servername: host, rejectUnauthorized: false, timeout: 10000 }, () => {
      const c = s.getPeerCertificate(false)
      s.end()
      resuelve(c && c.raw ? Buffer.from(c.raw) : null)
    })
    s.on('error', rechaza)
    s.on('timeout', () => { s.destroy(); rechaza(new Error('tiempo agotado')) })
  })
  const hoja = crudo && certDe(crudo)
  if (!hoja) return false
  let actual = hoja
  const nuevos = []
  for (let paso = 0; paso < 4; paso++) {
    if (RAICES.some((r) => actual.checkIssued(r) && actual.verify(r.publicKey))) break
    const emisor = await certificadoDeEmisor(actual)
    if (!emisor || !actual.checkIssued(emisor) || !actual.verify(emisor.publicKey)) return false
    nuevos.push(emisor)
    actual = emisor
  }
  if (!nuevos.length) return false
  // Solo se confía en la cadena si termina en una raíz de la lista de confianza de Node.
  const ultimo = nuevos[nuevos.length - 1]
  if (!RAICES.some((r) => ultimo.checkIssued(r) && ultimo.verify(r.publicKey))) return false
  let alguno = false
  for (const c of nuevos) if (!intermedios.has(c.fingerprint256)) { intermedios.set(c.fingerprint256, c); alguno = true }
  if (alguno) agenteConIntermedios = null
  return true
}
const agente = () => {
  if (!agenteConIntermedios) agenteConIntermedios = new Agent({ connect: { ca: [...tls.rootCertificates, ...[...intermedios.values()].map((c) => c.toString())] } })
  return agenteConIntermedios
}

// fetch normal; si falla por cadena incompleta, completa los intermedios y reintenta una vez (con la verificación activa).
async function pedir(u, opciones, tiempoMs = 25000) {
  const usaIntermedios = intermedios.size > 0
  try {
    return await fetch(u, usaIntermedios ? { ...opciones, dispatcher: agente() } : opciones)
  } catch (e) {
    const codigo = e && e.cause && e.cause.code
    if (u.protocol !== 'https:' || !ERRORES_CADENA.has(codigo)) throw e
    let ok = false
    try { ok = await aprenderIntermedios(u.hostname.replace(/^\[|\]$/g, ''), u.port) } catch { ok = false }
    if (!ok && !usaIntermedios) throw e
    return fetch(u, { ...opciones, dispatcher: agente(), signal: AbortSignal.timeout(tiempoMs) })
  }
}

// Devuelve { url (final), estado, tipo, datos (Buffer) }. Lanza Error con un mensaje claro si no se puede.
export async function descargar(texto, { maxBytes = MAX_BYTES, tiempoMs = 90000, aceptar = '*/*' } = {}) {
  let url = texto
  for (let salto = 0; salto < 5; salto++) {
    const u = await validarDestino(url)
    const r = await pedir(u, { redirect: 'manual', signal: AbortSignal.timeout(tiempoMs), headers: { 'user-agent': UA, accept: aceptar, 'accept-language': 'es,en;q=0.8' } }, tiempoMs)
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
