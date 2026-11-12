// Emite un aviso de PRUEBA firmado al receptor de Praxia (POST /api/n8n/eventos), igual que lo hará el subflujo «Avisar a Praxia» de n8n.
// Sirve para probar el receptor (local o en el servidor) y para comparar la firma de n8n con la de referencia.
//
//   Vector de firma (no usa secretos reales):   node scripts/emitir-aviso-prueba.js --vector
//   Enviar un aviso de ejemplo:                 N8N_EVENTOS_SECRETO=… node scripts/emitir-aviso-prueba.js <url> <tipo> <trabajo_id>
//     tipo: matrices_inicio | matrices_fin | h5p_inicio | h5p_recurso | h5p_fin | guiones_terminados
//     <trabajo_id>: el de un trabajo que ya exista en Praxia (o uno creado con scripts/crear-origen-prueba.js)
// El secreto se lee SIEMPRE del entorno (o del .env); nunca se pasa como argumento ni se imprime.
import 'dotenv/config'
import crypto from 'node:crypto'

const firma = (secreto, fecha, cuerpo) => crypto.createHmac('sha256', secreto).update(fecha + '.' + cuerpo).digest('hex')

if (process.argv[2] === '--vector') {
  // Vector de referencia con un secreto de ejemplo: n8n debe obtener exactamente esta firma para estos mismos bytes.
  const secreto = 'secreto-de-prueba'
  const fecha = '1700000000'
  const cuerpo = '{"evento_id":"prueba-0001"}'
  console.log(JSON.stringify({ algoritmo: 'HMAC-SHA256 en hexadecimal', secreto_de_ejemplo: secreto, X_Praxia_Fecha: fecha, cuerpo_exacto: cuerpo, texto_firmado: fecha + '.' + cuerpo, X_Praxia_Firma: firma(secreto, fecha, cuerpo) }, null, 2))
  process.exit(0)
}

const [url, tipo, trabajoId] = process.argv.slice(2)
const secreto = process.env.N8N_EVENTOS_SECRETO
if (!url || !tipo || !trabajoId || !secreto) {
  console.error('Uso: N8N_EVENTOS_SECRETO=… node scripts/emitir-aviso-prueba.js <url> <tipo> <trabajo_id>   (o --vector)')
  process.exit(1)
}
const ahora = new Date().toISOString()
const base = { evento_id: 'prueba-' + crypto.randomUUID(), evento: tipo, trabajo_id: trabajoId, ejecucion_id: 'prueba-' + Date.now(), secuencia: 1, fecha_evento: ahora }
const EJEMPLOS = {
  guiones_terminados: { etapa: 'guiones', unidad: 1, formacion: 'Tecnológico', resultado: 'ok', guiones: [{ tema: 1, nombre: 'Guion de prueba', url: 'https://docs.google.com/document/d/prueba' }] },
  matrices_inicio: { etapa: 'matrices', unidades: [1], forzar: false },
  matrices_fin: { etapa: 'matrices', resultados: [{ unidad: 1, formacion: 'Tecnológico', resultado: 'creada', matriz: { id: 'prueba', url: 'https://docs.google.com/spreadsheets/d/prueba', nombre: 'Matriz de recursos - Tecnológico - Unidad 1' },
    filas: [{ id: 'prueba-1', codigo: 'U1-T1-OVA1', formato: 'Línea de tiempo', titulo: 'Recurso de prueba', generador: 'H5P', estado: 'PENDIENTE' }] }] },
  h5p_inicio: { etapa: 'h5p', maximo: 5, plan: { a_generar: [{ id: 'prueba-1', codigo: 'U1-T1-OVA1' }], omitidas: [] } },
  h5p_recurso: { etapa: 'h5p', unidad: 1, id: 'prueba-1', codigo: 'U1-T1-OVA1', estado: 'GENERADO', enlace_recurso: 'https://drive.google.com/file/d/prueba/view' },
  h5p_fin: { etapa: 'h5p', resumen: { generados: 1, errores: 0, omitidos: 0, pendientes_restantes: 0 } }
}
if (!EJEMPLOS[tipo]) { console.error('Tipo desconocido: ' + tipo); process.exit(1) }
const cuerpo = JSON.stringify({ ...base, ...EJEMPLOS[tipo] })
const fecha = String(Math.floor(Date.now() / 1000))
const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-praxia-fecha': fecha, 'x-praxia-firma': firma(secreto, fecha, cuerpo) }, body: cuerpo })
console.log(r.status, await r.text())
