// Crea una COPIA del flujo «syllabus-a-plantilla» que trabaja con la bibliografía que envía la plataforma (leída y citada),
// en lugar de la que el modelo "conoce". NO toca n8n: lee un archivo JSON y escribe otro.
//
// Uso:  node n8n/bibliografia/aplicar-parche.mjs <flujo-original.json> [salida.json]
//   1) En n8n: abra el flujo → menú ⋯ → Download (o seleccione todo, copie y guarde el JSON en un archivo).
//   2) Ejecute el comando. Si alguna modificación no encuentra su punto de anclaje, lo dice y NO la aplica.
//   3) En n8n: Import from file → la copia nueva. Es un flujo aparte (webhook «syllabus-a-plantilla-bibliografia»).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const entrada = process.argv[2]
if (!entrada || !fs.existsSync(entrada)) { console.error('Uso: node aplicar-parche.mjs <flujo-original.json> [salida.json]'); process.exit(1) }
const salida = process.argv[3] || path.join(path.dirname(entrada), path.basename(entrada, '.json') + '-con-bibliografia.json')
const wf = JSON.parse(fs.readFileSync(entrada, 'utf8'))
const resumen = []
const ok = (m) => resumen.push('  ✔ ' + m)
const fallo = (m) => resumen.push('  ✖ ' + m)
const nodo = (nombre) => wf.nodes.find((n) => n.name === nombre)
const uuid = () => crypto.randomUUID()

// ---------- 1) webhook propio y sin datos de prueba fijados
const hook = nodo('Webhook Syllabus1')
if (hook) { hook.parameters.path = 'syllabus-a-plantilla-bibliografia'; hook.webhookId = uuid(); ok('Webhook nuevo: /webhook/syllabus-a-plantilla-bibliografia (el original no se toca)') } else fallo('No encontré «Webhook Syllabus1»')
wf.pinData = {}
wf.name = 'Syllabus a plantilla (bibliografía leída, sin IA)'
ok('Sin datos fijados (pinData) para que el modelo no responda con ejemplos viejos')

// ---------- 2) nodo nuevo entre «Extraer Syllabus1» y «Asignar actividades autoaprendizaje1»
const extraer = nodo('Extraer Syllabus1')
const asignar = nodo('Asignar actividades autoaprendizaje1')
if (extraer && asignar) {
  const nuevo = {
    parameters: { jsCode: fs.readFileSync(path.join(aqui, 'preparar-bibliografia-recibida.js'), 'utf8').replace('__METODOLOGIAS__', () => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(aqui, 'catalogos-nivel.json'), 'utf8'))).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, v.met])))) },
    id: uuid(), name: 'Preparar bibliografía recibida', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [(extraer.position[0] + asignar.position[0]) / 2, extraer.position[1] + 140]
  }
  wf.nodes.push(nuevo)
  wf.connections['Extraer Syllabus1'] = { main: [[{ node: nuevo.name, type: 'main', index: 0 }]] }
  wf.connections[nuevo.name] = { main: [[{ node: 'Asignar actividades autoaprendizaje1', type: 'main', index: 0 }]] }
  ok('Nodo «Preparar bibliografía recibida»: usa la bibliografía enviada y elige extractos por subtema (con ID y página)')
} else fallo('No encontré «Extraer Syllabus1» o «Asignar actividades autoaprendizaje1»')

// ---------- 3) SIN IA: se elimina el modelo y el contenido se arma con el Syllabus y los extractos de la bibliografía
const gen = nodo('Generar contenido1')
if (gen && asignar) {
  const quitar = new Set(['Generar contenido1', 'OpenAI Chat Model1', 'Esquema de salida1'])
  const eliminados = wf.nodes.filter((n) => quitar.has(n.name)).map((n) => n.name)
  wf.nodes = wf.nodes.filter((n) => !quitar.has(n.name))
  for (const k of quitar) delete wf.connections[k]
  const nuevo2 = {
    parameters: { jsCode: fs.readFileSync(path.join(aqui, 'armar-contenido-sin-ia.js'), 'utf8') },
    id: uuid(), name: 'Armar contenido desde la bibliografia', type: 'n8n-nodes-base.code', typeVersion: 2, position: gen.position
  }
  wf.nodes.push(nuevo2)
  wf.connections['Asignar actividades autoaprendizaje1'] = { main: [[{ node: nuevo2.name, type: 'main', index: 0 }]] }
  wf.connections[nuevo2.name] = { main: [[{ node: 'Armar salida1', type: 'main', index: 0 }]] }
  ok('SIN IA: se quitaron ' + eliminados.join(', ') + '; el contenido sale del Syllabus y de los extractos citados (fuente + página)')
} else fallo('No encontré «Generar contenido1» o «Asignar actividades autoaprendizaje1»: el modelo sigue en el flujo')

// ---------- 4) «Armar salida1»: valida las páginas citadas y arma la bibliografía APA con lo enviado
const armar = nodo('Armar salida1')
if (armar) {
  let c = armar.parameters.jsCode
  const cambiar = (nombre, a, b, veces = 1) => {
    const n = c.split(a).length - 1
    if (n !== veces) { fallo('Armar salida: «' + nombre + '» (se esperaban ' + veces + ' coincidencia(s), hay ' + n + '); no se aplicó'); return }
    c = c.split(a).join(b)
    ok('Armar salida: ' + nombre)
  }
  cambiar('valida que cada página citada exista entre los extractos enviados',
    "const delSyllabus = (clave, valor, ubicacion) => {",
    `// Páginas que la plataforma realmente envió por fuente: solo esas se pueden citar.
  const paginasValidas = {};
  (unidad.temas || []).forEach(t => (t.subtemas || []).forEach(s => (s.extractos || []).forEach(x => {
    (paginasValidas[x.id] = paginasValidas[x.id] || new Set()).add(Number(x.pagina));
  })));
  const verificarCitas = (citas, clave, ids) => {
    const buenas = [];
    (Array.isArray(citas) ? citas : []).forEach(cx => {
      const id = String((cx && cx.id) || '').trim();
      const pg = Number(cx && cx.pagina);
      if (!porId[id]) { advertencias.push('<<' + clave + '>> citó ' + id + ', que no existe en la bibliografía de la unidad: se descartó.'); return; }
      if (!paginasValidas[id] || !paginasValidas[id].has(pg)) { advertencias.push('<<' + clave + '>> citó ' + id + ', p. ' + pg + ', que no estaba entre los extractos enviados: se descartó.'); return; }
      const base = String(porId[id].cita_apa || '');
      buenas.push({ id, pagina: pg, cita: base ? base.replace(/\\)$/, ', p. ' + pg + ')') : id + ', p. ' + pg });
    });
    if (ids.length && !buenas.length) advertencias.push('<<' + clave + '>> no cita ninguna página de los extractos enviados.');
    return buenas;
  };

  const delSyllabus = (clave, valor, ubicacion) => {`)
  cambiar('registra las citas con página en la trazabilidad (1/3)',
    "ids.forEach(id => usos[id].push('<<' + clave + '>>'));",
    "ids.forEach(id => usos[id].push('<<' + clave + '>>'));\n    const citasOk = verificarCitas(opc.citas, clave, ids);")
  cambiar('registra las citas con página en la trazabilidad (2/3)',
    "sustento: opc.sustento ? String(opc.sustento).trim() : null",
    "sustento: opc.sustento ? String(opc.sustento).trim() : null,\n      citas: citasOk")
  cambiar('pasa las citas de la descripción', 'fuentes: desc.fuentes_ids,', 'fuentes: desc.fuentes_ids,\n    citas: desc.citas,')
  cambiar('pasa las citas de cada recurso y actividad', 'fuentes: r.fuentes_ids,', 'fuentes: r.fuentes_ids,\n        citas: r.citas,', 2)
  cambiar('escribe la bibliografía APA 7 de la unidad con lo enviado (marcadores <<Bibliografia_Basica>> y <<Bibliografia_Complementaria>>)',
    '// ---- registro de fuentes ----',
    `// ---- Bibliografía de la unidad en APA 7: sale de lo que envió la plataforma, nunca del modelo ----
  const apaTexto = lista => lista.map(e => String(e.referencia_apa || e.texto || '').replace(/\\*/g, '')).sort((a, b) => a.localeCompare(b, 'es')).join('\\n\\n');
  [['Bibliografia_Basica', unidad.bibliografia.basica.entradas], ['Bibliografia_Complementaria', unidad.bibliografia.complementaria.entradas]].forEach(([k, lista]) => {
    asignar(k, apaTexto(lista));
    traza.push({ marcador: '<<' + k + '>>', origen: 'plataforma (bibliografía leída y citada en APA 7)', ubicacion: 'Unidad ' + N + ' > ' + k.replace('Bibliografia_', 'Bibliografía '), fuentes_ids: lista.map(e => e.id), sustento: null });
  });
  (base.avisos_extraccion || []).forEach(a => advertencias.push(a));
  if (base.subtemas_sin_extractos && base.subtemas_sin_extractos.length) advertencias.push('Subtemas sin extractos en la bibliografía enviada (sin sustento en las fuentes): ' + base.subtemas_sin_extractos.join('; '));

  // ---- registro de fuentes ----`)
  cambiar('muestra las páginas citadas en el registro de fuentes',
    "(t.fuentes_ids.join(', ') || '—')",
    "(t.fuentes_ids.map(id => { const pg = (t.citas || []).filter(x => x.id === id).map(x => 'p. ' + x.pagina).join(', '); return id + (pg ? ' (' + pg + ')' : ''); }).join(', ') || '—')")
  armar.parameters.jsCode = c
} else fallo('No encontré «Armar salida1»')

// ---------- 5) Estructura metodológica por nivel: RED, actividades generales y actividades ESPECÍFICAS
const asig = nodo('Asignar actividades autoaprendizaje1')
if (asig) {
  let c = asig.parameters.jsCode
  const cambiar = (nombre, a, b) => {
    const n = c.split(a).length - 1
    if (n !== 1) { fallo('Estructura por nivel: «' + nombre + '» (se esperaba 1 coincidencia, hay ' + n + '); no se aplicó'); return }
    c = c.replace(a, () => b)
    ok('Estructura por nivel: ' + nombre)
  }
  const catalogos = fs.readFileSync(path.join(aqui, 'catalogos-nivel.json'), 'utf8')
  const bloqueNivel = fs.readFileSync(path.join(aqui, 'asignar-estructura-nivel.js'), 'utf8').replace('__CATALOGOS__', () => JSON.stringify(JSON.parse(catalogos)))
  cambiar('catálogos de RED y actividades generales del nivel (Tecnológico, Licenciatura, Especialización, Doctorado)',
    'const items = $input.all();', 'const items = $input.all();\n' + bloqueNivel)
  cambiar('la familia pedagógica de cada RED sale del catálogo del nivel',
    'function tipoDeRed(red) {\n  const f = normalizar(red);',
    'function tipoDeRed(red) {\n  if (typeof FAMILIA_POR_RED !== "undefined" && FAMILIA_POR_RED[red] && KIND_POR_FAMILIA[FAMILIA_POR_RED[red]]) return KIND_POR_FAMILIA[FAMILIA_POR_RED[red]];\n  const f = normalizar(red);')
  cambiar('las actividades de las técnicas se buscan por nombre aunque el catálogo las escriba en singular o plural',
    'return red ? CATALOGO.find(c => c.red === red) : null;',
    'return red ? (CATALOGO.find(c => c.red === red) || CATALOGO.find(c => normalizar(c.red).slice(0, 8) === normalizar(red).slice(0, 8))) : null;')
  cambiar('una SOLA actividad por OVA: primero las específicas del nivel; cuando se agotan, las generales, alternando y sin repetir entre unidades',
    'const temasPlan = temas.map((tema, i) => ({',
    fs.readFileSync(path.join(aqui, 'asignar-especificas.js'), 'utf8') + '  const temasPlan = temas.map((tema, i) => ({')
  asig.parameters.jsCode = c
} else fallo('No encontré «Asignar actividades autoaprendizaje1»')

fs.writeFileSync(salida, JSON.stringify(wf, null, 2))
console.log('Copia escrita en: ' + salida + '\n' + resumen.join('\n'))
if (resumen.some((r) => r.includes('✖'))) { console.log('\nHay modificaciones sin aplicar (✖). Avíseme cuáles para ajustarlas.'); process.exitCode = 2 }
