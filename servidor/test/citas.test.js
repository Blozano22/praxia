// Regresión: una fuente solo queda citada en un recurso si el sustento trae una cita textual comprobable en el
// extracto de ESA fuente, de ESTA unidad. Casos reales: la ejecución 372267 de producción (citas por título) y
// textos públicos de la Ley 906 de 2004. No usa red ni base de datos.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const leer = (f) => JSON.parse(fs.readFileSync(path.join(aqui, 'fixtures', f), 'utf8'))
// El snippet es código plano para un nodo Code de n8n: se evalúa tal cual, sin imports.
const fuente = fs.readFileSync(path.join(aqui, '..', '..', 'n8n', 'guiones', 'verificar-citas.js'), 'utf8')
const { verificarCitas, normalizarTexto } = new Function(fuente + '\nreturn { verificarCitas, normalizarTexto }')()

const real = leer('ejecucion-372267.json')
const penal = leer('fuentes-derecho-penal-u2.json')
const ley906 = penal.entradas.find((e) => e.id === 'U2-B1').extractos[0].texto
const calderon = penal.entradas.find((e) => e.id === 'U2-C3').extractos[0].texto

const CITA_LEY = 'la cadena de custodia se aplicará teniendo en cuenta los siguientes factores: identidad, estado original, condiciones de recolección, preservación, embalaje y envío'

// ---------- Caso real: la ejecución 372267 ----------
test('caso real 372267: el fixture conserva Syllabus, unidad y fuentes de la Unidad 2 de Fundamentos de Administración', () => {
  assert.match(real.entrada.syllabus_url, /1nmsiSTUe4RQfOaVTDhWB5IihLDyyCHdcrhF9hx0Mf70/)
  assert.match(real.entrada.unidad_url, /1GEWR93I5kIQpJHxdbqIFBJkpzlpJxqyMv-exK6Y4S9I/)
  assert.equal(real.unidad, 2)
  assert.deepEqual(real.bibliografia_entregada.map((e) => e.id), ['U2-B1', 'U2-B2', 'U2-B3', 'U2-C1', 'U2-C2', 'U2-C3'])
  assert.equal(real.generar_guion.recursos.length, 6)
})

test('caso real 372267: las 12 citas por título (6 recursos × 2 fuentes) ya no se asignan: quedan pendientes', () => {
  // En esa ejecución n8n no recibió texto de las fuentes: ninguna entrada trae extractos.
  const entradas = real.bibliografia_entregada.map((e) => ({ ...e, extractos: [] }))
  let citasDeclaradas = 0
  for (const r of real.generar_guion.recursos) {
    const v = verificarCitas({ ids: r.fuentes_ids, sustento: r.sustento, entradas, unidad: real.unidad })
    citasDeclaradas += r.fuentes_ids.length
    assert.deepEqual(v.ids, [], 'Recurso ' + r.posicion + ' no debe conservar fuentes sin texto que las respalde')
    assert.equal(v.pendiente, true)
    assert.ok(v.descartadas.every((d) => d.motivo === 'fuente_sin_texto'))
  }
  assert.equal(citasDeclaradas, 12)
})

test('caso real 372267: aun con texto disponible, un sustento «por título» se rechaza', () => {
  const entradas = real.bibliografia_entregada.map((e) => ({ ...e, extractos: [{ pagina: 3, texto: 'Texto cualquiera de la fuente que habla de otros asuntos distintos al pedido por el recurso, con varias frases largas.' }] }))
  const r1 = real.generar_guion.recursos[0]
  assert.match(r1.sustento, /El título de/)
  const v = verificarCitas({ ids: r1.fuentes_ids, sustento: r1.sustento, entradas, unidad: real.unidad })
  assert.deepEqual(v.ids, [])
  assert.deepEqual(v.descartadas.map((d) => d.motivo), ['sin_cita_textual', 'sin_cita_textual'])
  assert.match(v.descartadas[0].detalle, /título/)
})

// ---------- Fuente del Syllabus correcto y pertinente ----------
test('fuente del Syllabus y la unidad correctos, con cita textual comprobada: se asigna', () => {
  const sustento = 'U2-B1, p. 98: «' + CITA_LEY + '», que respalda el subtema «Registro de cadena de custodia».'
  const v = verificarCitas({ ids: ['U2-B1'], sustento, entradas: penal.entradas, unidad: 2 })
  assert.deepEqual(v.ids, ['U2-B1'])
  assert.equal(v.pendiente, false)
  assert.equal(v.aceptadas[0].pagina, 98)
  assert.deepEqual(v.descartadas, [])
})

test('la cita se comprueba sin importar tildes, mayúsculas ni signos, y con cortes «[…]»', () => {
  const sustento = 'U2-B1, p. 98: «LA CADENA DE CUSTODIA SE APLICARA teniendo en cuenta los siguientes factores […] condiciones de recoleccion, preservacion, embalaje y envio»'
  const v = verificarCitas({ ids: ['U2-B1'], sustento, entradas: penal.entradas, unidad: 2 })
  assert.deepEqual(v.ids, ['U2-B1'])
  assert.ok(normalizarTexto('Recolección, ¡embalaje!') === 'recoleccion embalaje')
})

// ---------- Referencia de otra unidad o curso ----------
test('referencia de otra unidad: se descarta aunque exista y la cita sea literal', () => {
  const sustento = 'U1-B1, p. 98: «' + CITA_LEY + '»'
  const conU1 = [...penal.entradas, { id: 'U1-B1', extractos: penal.entradas[0].extractos }]
  const v = verificarCitas({ ids: ['U1-B1'], sustento, entradas: conU1, unidad: 2 })
  assert.deepEqual(v.ids, [])
  assert.equal(v.descartadas[0].motivo, 'otra_unidad')
})

test('referencia de otro curso (ID que no está en la bibliografía enviada para la unidad): se descarta', () => {
  const sustento = 'U2-B9, p. 4: «' + CITA_LEY + '»'
  const v = verificarCitas({ ids: ['U2-B9'], sustento, entradas: penal.entradas, unidad: 2 })
  assert.deepEqual(v.ids, [])
  assert.equal(v.descartadas[0].motivo, 'id_inexistente')
})

// ---------- Fuente no pertinente ----------
test('fuente no pertinente: la cita no está en el extracto de la fuente que se cita', () => {
  // Cita tomada de Calderón-Ortega (U2-C3) pero atribuida a la Ley 906 (U2-B1).
  const cita = 'reglas probatorias para la producci n de la prueba por inteligencia artificial dentro del proceso judicial colombiano'
  assert.ok(normalizarTexto(calderon).includes(normalizarTexto(cita)))
  const v = verificarCitas({ ids: ['U2-B1'], sustento: 'U2-B1, p. 98: «' + cita + '»', entradas: penal.entradas, unidad: 2 })
  assert.deepEqual(v.ids, [])
  assert.equal(v.descartadas[0].motivo, 'cita_no_encontrada')
})

test('página inventada o cita demasiado corta: no se asigna', () => {
  const pag = verificarCitas({ ids: ['U2-B1'], sustento: 'U2-B1, p. 7: «' + CITA_LEY + '»', entradas: penal.entradas, unidad: 2 })
  assert.equal(pag.descartadas[0].motivo, 'pagina_no_entregada')
  const corta = verificarCitas({ ids: ['U2-B1'], sustento: 'U2-B1, p. 98: «cadena de custodia»', entradas: penal.entradas, unidad: 2 })
  assert.equal(corta.descartadas[0].motivo, 'cita_corta')
  const sinPag = verificarCitas({ ids: ['U2-B1'], sustento: 'U2-B1: «' + CITA_LEY + '»', entradas: penal.entradas, unidad: 2 })
  assert.equal(sinPag.descartadas[0].motivo, 'sin_pagina')
})

// ---------- Ausencia de fuente adecuada ----------
test('sin fuente adecuada: ninguna se asigna y el recurso queda PENDIENTE, sin inventar referencia', () => {
  const sustento = 'U2-B3, p. 1: «El título del artículo trata de la prueba documental»; U2-C3, p. 1: «reglas probatorias para la producci n de la prueba por inteligencia artificial».'
  const v = verificarCitas({ ids: ['U2-B3', 'U2-C3'], sustento, entradas: penal.entradas, unidad: 2 })
  // U2-B3 no tiene texto; U2-C3 sí tiene texto y la cita es literal, pero la verificación de pertinencia con el recurso es de una persona:
  assert.equal(v.descartadas.find((d) => d.id === 'U2-B3').motivo, 'fuente_sin_texto')
  assert.deepEqual(v.ids, ['U2-C3'])
  const solo = verificarCitas({ ids: ['U2-B3'], sustento, entradas: penal.entradas, unidad: 2 })
  assert.equal(solo.pendiente, true)
  assert.deepEqual(solo.ids, [])
  const vacio = verificarCitas({ ids: [], sustento: 'Sin bibliografía disponible', entradas: [], unidad: 2 })
  assert.equal(vacio.pendiente, true)
})

// ---------- Cada cita conserva su relación ----------
test('cada fuente aceptada conserva su ID, su página y la cita comprobada (Syllabus → unidad → recurso → guion)', () => {
  const sustento = 'U2-B1, p. 98: «' + CITA_LEY + '». U2-C3, p. 1: «reglas probatorias para la producci n de la prueba por inteligencia artificial».'
  const v = verificarCitas({ ids: ['U2-B1', 'U2-C3', 'U2-B3'], sustento, entradas: penal.entradas, unidad: 2 })
  assert.deepEqual(v.aceptadas.map((a) => [a.id, a.pagina]), [['U2-B1', 98], ['U2-C3', 1]])
  for (const a of v.aceptadas) {
    const e = penal.entradas.find((x) => x.id === a.id)
    assert.ok(e.extractos.some((x) => Number(x.pagina) === a.pagina && normalizarTexto(x.texto).includes(normalizarTexto(a.cita))), a.id + ' debe poder rastrearse a su extracto')
  }
  assert.equal(v.descartadas.length, 1)
})

// ---------- Endurecimiento (revisión independiente) ----------
test('formas de escribir la página, el ID y las comillas que no deben provocar falsos descartes', () => {
  const ok = (sustento, ids = ['U2-B1']) => verificarCitas({ ids, sustento, entradas: penal.entradas, unidad: 2 }).ids
  assert.deepEqual(ok('U2-B1, pág. 98: «' + CITA_LEY + '»'), ['U2-B1'])
  assert.deepEqual(ok('U2-B1, página 98: «' + CITA_LEY + '»'), ['U2-B1'])
  assert.deepEqual(ok('u2 - b01, p. 98: ‘' + CITA_LEY + '’'), ['U2-B1'])
})

test('varios IDs que comparten una misma cita («U2-B1 y U2-C3, p. 98: «…»»)', () => {
  const v = verificarCitas({ ids: ['U2-B1', 'U2-C3'], sustento: 'U2-B1 y U2-C3, p. 98: «' + CITA_LEY + '»', entradas: penal.entradas, unidad: 2 })
  assert.deepEqual(v.ids, ['U2-B1'], 'la cita solo está en U2-B1; U2-C3 no debe quedar citada por compartir la frase')
  assert.equal(v.descartadas[0].id, 'U2-C3')
})

test('la cita copiada con palabras cortadas por guion de fin de línea se sigue encontrando', () => {
  const entradas = [{ id: 'U2-B1', extractos: [{ pagina: 5, texto: 'La aplicación de la cadena de custo-\ndia es responsabilidad de los servidores públicos que entren en contacto con los elementos.' }] }]
  const v = verificarCitas({ ids: ['U2-B1'], sustento: 'U2-B1, p. 5: «la cadena de custodia es responsabilidad de los servidores públicos que entren en contacto»', entradas, unidad: 2 })
  assert.deepEqual(v.ids, ['U2-B1'])
})

test('una cita que cruza de una página citada a la siguiente se comprueba sobre el texto unido', () => {
  const entradas = [{ id: 'U2-B1', extractos: [{ pagina: 5, texto: 'Primera parte de la frase que termina en la cadena de' }, { pagina: 6, texto: 'custodia y continúa con la responsabilidad de los servidores públicos.' }] }]
  const v = verificarCitas({ ids: ['U2-B1'], sustento: 'U2-B1, pp. 5-6: «la cadena de custodia y continúa con la responsabilidad de los servidores»', entradas, unidad: 2 })
  assert.deepEqual(v.ids, ['U2-B1'])
})

