// Genera «unidad-a-guiones-con-bibliografia.json» a partir de una copia (de solo lectura) del flujo de guiones.
// No toca n8n: produce un archivo NUEVO para importar. Uso:  node n8n/guiones/aplicar-parche-guiones.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const orig = JSON.parse(fs.readFileSync(path.join(aqui, 'unidad-a-guiones-original.json'), 'utf8'))
const bloque = fs.readFileSync(path.join(aqui, 'bloque-bibliografia.js'), 'utf8')

// ---- 1) Solo la cadena que arranca en «Webhook Guiones» (el original trae además una copia duplicada de la cadena).
const C = orig.connections
const destinos = (n, tipo) => ((C[n] || {})[tipo] || []).flatMap((r) => (r || []).map((x) => x.node))
const guardar = new Set()
const cola = ['Webhook Guiones']
while (cola.length) {
  const n = cola.shift()
  if (guardar.has(n)) continue
  guardar.add(n)
  cola.push(...destinos(n, 'main'))
}
// Los modelos y analizadores de salida se conectan con otro tipo de enlace hacia un nodo que ya se guardó.
for (let cambio = true; cambio;) {
  cambio = false
  for (const [origen, tipos] of Object.entries(C)) {
    if (guardar.has(origen)) continue
    for (const [tipo, filas] of Object.entries(tipos)) {
      if (tipo === 'main') continue
      if ((filas || []).some((r) => (r || []).some((x) => guardar.has(x.node)))) { guardar.add(origen); cambio = true }
    }
  }
}
const nodos = JSON.parse(JSON.stringify(orig.nodes.filter((n) => guardar.has(n.name))))
const por = Object.fromEntries(nodos.map((n) => [n.name, n]))

// ---- 2) Dirección nueva (no choca con el flujo original) y nombre.
por['Webhook Guiones'].parameters.path = 'unidad-a-guiones-bibliografia'
por['Webhook Guiones'].webhookId = crypto.randomUUID()

// ---- 3) «Extraer unidad»: la bibliografía de cada tema sale de la que envía la plataforma.
{
  let c = por['Extraer unidad'].parameters.jsCode
  const anclaRetorno = 'return temas.map((t, idx) => {'
  if (!c.includes(anclaRetorno)) throw new Error('ancla «return temas.map» no encontrada')
  c = c.replace(anclaRetorno, () => bloque + anclaRetorno)
  const viejo = /bibliografia: \{\s*disponible: !!syllabus\.disponible,\s*motivo: syllabus\.motivo \|\| null,\s*entradas: syllabus\.entradas \|\| \[\]\s*\},/
  if (!viejo.test(c)) throw new Error('bloque «bibliografia:» no encontrado')
  c = c.replace(viejo, () => 'bibliografia: bibliografiaDelTema(t),')
  // El Syllabus ya no aporta la bibliografía: su ausencia deja de ser una advertencia sobre bibliografía.
  c = c.replace("'No se envió el Syllabus: los guiones se generarán SIN respaldo bibliográfico y las horas por tema serán una estimación.'", () => "'No se envió el Syllabus: las horas por tema serán una estimación (la bibliografía llega leída desde la plataforma).'")
  por['Extraer unidad'].parameters.jsCode = c
}

// ---- 4) «Generar guion»: el modelo escribe con los fragmentos leídos, no de memoria.
{
  const m = por['Generar guion'].parameters.messages.messageValues
  const i = m.findIndex((x) => String(x.message).includes('## REGLA DE FUENTES (obligatoria)'))
  if (i < 0) throw new Error('«REGLA DE FUENTES» no encontrada')
  const texto = m[i].message
  const ini = texto.indexOf('## REGLA DE FUENTES (obligatoria)')
  const fin = texto.indexOf('\n## ', ini + 10)
  const nueva = `## REGLA DE FUENTES (obligatoria)
- \`bibliografia.entradas\` trae las fuentes de la unidad ya LEÍDAS por la plataforma: cada una con \`id\`, \`texto\` (referencia APA 7) y \`extractos\` (fragmentos reales del texto de la fuente, cada uno con su página).
- El contenido de cada recurso se construye SOLO con lo que dicen esos \`extractos\` y con el subtema. Parafrasea; no copies párrafos largos. Nunca atribuyas a una fuente cifras, citas textuales, definiciones ni conclusiones que no estén en sus extractos.
- Si ningún extracto cubre una idea del subtema, no la inventes: desarrolla solo lo que sí está respaldado y dilo en \`sustento\` ("Los extractos no cubren: …").
- Solo puedes citar IDs que existan en \`bibliografia.entradas\`, en \`fuentes_ids\` o entre corchetes en un apartado de Referencias, por ejemplo [U1-B2]. Nunca escribas autores, años, títulos ni DOI de memoria.
- \`sustento\`: una frase que diga qué extracto respalda el recurso, por ejemplo "U2-B1, p. 14: define X, que corresponde al subtema Y".
- Cada recurso cita al menos una fuente si \`bibliografia.disponible\` es true (prefiere las básicas y las que traen extractos sobre el tema). Si es false: \`fuentes_ids\` vacío y \`sustento\` = "Sin bibliografía disponible".
- No inventes cifras, fechas, normas, nombres propios ni estudios. Los ejemplos con datos se presentan como hipotéticos ("imaginemos…").
`
  m[i].message = texto.slice(0, ini) + nueva + (fin >= 0 ? texto.slice(fin) : '')
}

// ---- 5) Nombre y archivo de salida.
const salida = {
  name: 'Unidad a guiones · con bibliografía leída (copia)',
  nodes: nodos,
  connections: Object.fromEntries(Object.entries(C).filter(([k]) => guardar.has(k)).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([tipo, filas]) => [tipo, (filas || []).map((r) => (r || []).filter((x) => guardar.has(x.node)))]))])),
  settings: orig.settings || { executionOrder: 'v1' },
  pinData: {}
}

// ---- 6) Comprobaciones: sintaxis de cada nodo Code y enlaces sin destino roto.
let errores = 0
for (const n of salida.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
  try { new Function('return (async()=>{' + n.parameters.jsCode + '})') } catch (e) { errores++; console.error('SINTAXIS en', n.name, e.message) }
}
const nombres = new Set(salida.nodes.map((n) => n.name))
for (const [o, tipos] of Object.entries(salida.connections)) for (const filas of Object.values(tipos)) for (const r of filas) for (const x of r) if (!nombres.has(x.node)) { errores++; console.error('enlace roto', o, '→', x.node) }
if (errores) process.exit(1)
const destino = path.join(aqui, '..', 'unidad-a-guiones-con-bibliografia.json')
fs.writeFileSync(destino, JSON.stringify(salida, null, 2))
console.log('nodos:', salida.nodes.length, '| webhook:', por['Webhook Guiones'].parameters.path, '| escrito:', path.relative(process.cwd(), destino))
