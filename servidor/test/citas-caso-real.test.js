// Caso real: «Derecho Penal y Actuaciones de Policía Judicial», Unidad 2, Tema 1 (evidencia física y cadena de custodia).
// Recorrido que se comprueba: Syllabus → bibliografía de la unidad → extractos enviados al modelo → citas → recurso del guion.
// Lo que falló en producción (Guion_U2_T1, 26-nov-2026): la Ley 906/2004 nunca llegó a la bibliografía de la unidad 2 y los seis
// recursos citaron artículos sobre prueba documental, digital e inteligencia artificial. Sin red ni base de datos.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extraerEntradas } from '../src/bibliografia/entrada.js'
import { tipoDeContenido } from '../src/bibliografia/tipo.js'
import { decodificar } from '../src/bibliografia/decodificar.js'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const real = JSON.parse(fs.readFileSync(path.join(aqui, 'fixtures', 'derecho-penal-u2-t1-real.json'), 'utf8'))
const fuente = fs.readFileSync(path.join(aqui, '..', '..', 'n8n', 'guiones', 'verificar-citas.js'), 'utf8')
const { verificarCitas } = new Function(fuente + '\nreturn { verificarCitas }')()

const recurso = (codigo) => real.recursos_t1.find((r) => r.codigo === codigo)
const subtemas = (codigo) => [recurso(codigo).subtema]
const antes = real.antes.entradas
const despues = real.despues.entradas
const idDe = (entradas, nombre) => entradas.find((e) => e.texto.includes(nombre)).id

// Pasajes reales (copiados de los extractos del fixture)
const Q_LEY906_ART254 = 'la cadena de custodia se aplicará teniendo en cuenta los siguientes factores: identidad, estado original, condiciones de recolección, preservación, embalaje y envío'
const Q_PEREZ_P19 = 'La cadena de custodia se iniciará en el lugar donde se descubran, recauden o encuentren los elementos materiales probatorios y evidencia física, y finaliza por orden de autoridad competente'
const Q_BUJOSA_P3 = 'la gestión de búsqueda, identificación, fijación, recolección, embalaje, custodia y análisis de la información'
const Q_CALDERON_P1 = 'un experto en el tema quien garantice la cadena de custodia de la partícula digital y explique el funcionamiento de los algoritmos inteligentes'

// ---------- 1. Syllabus → bibliografía de la unidad ----------
test('Syllabus → unidad: la Ley 906 y la Ley 2477 que el Syllabus lista en la unidad 2 llegan a la bibliografía de la unidad 2', () => {
  const e = extraerEntradas(real.syllabus_bibliografia)
  const u2 = e.filter((x) => x.unidad === 2)
  assert.equal(u2.filter((x) => x.categoria === 'basica').length, 4, 'la unidad 2 tiene 4 básicas en el Syllabus')
  assert.equal(u2.filter((x) => x.categoria === 'complementaria').length, 3)
  assert.ok(u2.some((x) => /Ley 906 de 2004/.test(x.entrada_cruda)), 'Ley 906 en la unidad 2')
  assert.ok(u2.some((x) => /Ley 2477 de 2025/.test(x.entrada_cruda)), 'Ley 2477 en la unidad 2')
  // y la unidad 1 no pierde las suyas
  assert.equal(e.filter((x) => x.unidad === 1).length, 8)
  assert.ok(e.filter((x) => x.unidad === 1).some((x) => /Ley 906 de 2004/.test(x.entrada_cruda)))
})

test('una misma fuente repetida DENTRO de la misma unidad se sigue leyendo una sola vez', () => {
  const txt = 'Bibliografía básica Unidad Nro. 1\n- Pérez, J. (2020). Teorías. https://x.org/a\n- Pérez, J. (2020). Teorías. https://x.org/a\nBibliografía complementaria Unidad Nro. 1\n- Pérez, J. (2020). Teorías. https://x.org/a\n'
  assert.equal(extraerEntradas(txt).length, 1)
})

// ---------- 2. Lectura de la fuente ----------
test('lectura: el PDF oficial de la Ley 906 empieza con «\\t\\n%PDF» y debe reconocerse como PDF (antes: «formato no admitido»)', () => {
  const cabecera = Buffer.from([0x09, 0x0a, 0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]) // primeros bytes reales de norma_pdf.php?i=14787
  assert.equal(tipoDeContenido('application/pdf', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma_pdf.php?i=14787', cabecera), 'pdf')
  assert.equal(tipoDeContenido('application/pdf', 'https://x.org/a.pdf', Buffer.from('<html>no es pdf</html>')), null)
  assert.equal(tipoDeContenido('text/html', 'https://x.org/a', Buffer.from('<html></html>')), 'html')
})

test('lectura: una página declarada ISO-8859-1 (Pérez Alarcón, Redalyc) conserva sus tildes', () => {
  const html = '<html><head><META http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"></head><body><p>La cadena de custodia se iniciará en el lugar donde se descubran los elementos materiales probatorios y evidencia física.</p></body></html>'
  const bytes = Buffer.from(html, 'latin1')
  assert.ok(decodificar(bytes, 'text/html').includes('se iniciará en el lugar'))
  assert.ok(decodificar(bytes, 'text/html; charset=ISO-8859-1').includes('evidencia física'))
  assert.ok(!decodificar(bytes, 'text/html').includes('�'))
  // UTF-8 real y sin declaración siguen igual
  assert.ok(decodificar(Buffer.from('<p>Evidencia física</p>', 'utf8'), 'text/html').includes('física'))
})

// ---------- 3. Extractos enviados al modelo ----------
test('extractos: antes no existía ningún pasaje de la Ley 906; ahora el modelo recibe los artículos sobre cadena de custodia', () => {
  assert.ok(!antes.some((e) => /Ley 906/.test(e.texto)))
  const ley = despues.find((e) => /Ley 906/.test(e.texto))
  assert.ok(ley, 'la Ley 906 está en el paquete de la unidad 2')
  const texto = ley.extractos.map((x) => x.texto).join(' ')
  assert.match(texto, /la cadena de custodia se aplicará teniendo en cuenta los siguientes factores/)
  assert.match(texto, /embalar/)
})

// ---------- 4. Citas → recurso ----------
test('error original: los 6 recursos de Guion_U2_T1 justificaban las tres fuentes por su título; ninguna se asigna', () => {
  const ids = [idDe(antes, 'Pérez'), idDe(antes, 'Bujosa'), idDe(antes, 'Calderón')]
  const sustento = ids.map((id) => id + ': el título trata de la prueba y es relevante para el recurso').join('; ')
  for (const r of real.recursos_t1.filter((x) => x.codigo !== 'U2-PRES')) {
    const v = verificarCitas({ ids, sustento, entradas: antes, unidad: 2, subtemas: [r.subtema] })
    assert.deepEqual(v.ids, [], r.codigo)
    assert.equal(v.pendiente, true)
    assert.ok(v.descartadas.every((d) => d.motivo === 'sin_cita_textual'))
  }
})

test('con los extractos de entonces (sin Ley 906), el recurso de «técnicas de fijación, recolección, embalaje y preservación» queda PENDIENTE: ningún pasaje de los tres artículos trata ese subtema', () => {
  const perez = idDe(antes, 'Pérez'), bujosa = idDe(antes, 'Bujosa'), calderon = idDe(antes, 'Calderón')
  const sustento = `${perez}, p. 19: «${Q_PEREZ_P19}». ${bujosa}, p. 3: «${Q_BUJOSA_P3}». ${calderon}, p. 1: «${Q_CALDERON_P1}».`
  for (const codigo of ['U2-T1-R3', 'U2-T1-R4']) {
    const v = verificarCitas({ ids: [perez, bujosa, calderon], sustento, entradas: antes, unidad: 2, subtemas: subtemas(codigo) })
    assert.deepEqual(v.ids, [], codigo + ': no se asigna ninguna fuente')
    assert.equal(v.pendiente, true)
    assert.ok(v.descartadas.every((d) => d.motivo === 'sin_correspondencia_tematica'), JSON.stringify(v.descartadas.map((d) => d.motivo)))
  }
})

test('cita literal pero de otro asunto: la cadena de custodia de la prueba DIGITAL no respalda un recurso sobre evidencia FÍSICA', () => {
  const bujosa = idDe(antes, 'Bujosa')
  const v = verificarCitas({ ids: [bujosa], sustento: `${bujosa}, p. 3: «${Q_BUJOSA_P3}»`, entradas: antes, unidad: 2, subtemas: subtemas('U2-T1-R2') })
  assert.deepEqual(v.ids, [])
  assert.equal(v.descartadas[0].motivo, 'sin_correspondencia_tematica')
  assert.match(v.descartadas[0].detalle, /Elementos materiales probatorios y evidencia física/)
})

test('con la Ley 906 en la bibliografía, su artículo 254 se asigna al recurso de «registro de cadena de custodia» y al de técnicas de embalaje, como «por confirmar»', () => {
  const ley = idDe(despues, 'Ley 906')
  const sustento = `${ley}, p. 52: «${Q_LEY906_ART254}»`
  for (const codigo of ['U2-T1-R5', 'U2-T1-R3']) {
    const v = verificarCitas({ ids: [ley], sustento, entradas: despues, unidad: 2, subtemas: subtemas(codigo) })
    assert.deepEqual(v.ids, [ley], codigo)
    assert.equal(v.aceptadas[0].estado, 'por_confirmar', 'nunca «válida»: una persona confirma que respalda el recurso')
    assert.equal(v.aceptadas[0].pagina, 52)
    assert.equal(v.confirmacion_humana, true)
  }
})

test('el mismo artículo 254 no se asigna a un recurso de otro subtema que no trata (p. ej. admisibilidad)', () => {
  const ley = idDe(despues, 'Ley 906')
  const v = verificarCitas({ ids: [ley], sustento: `${ley}, p. 52: «${Q_LEY906_ART254}»`, entradas: despues, unidad: 2, subtemas: ['Requisitos de admisibilidad y legalidad de la prueba'] })
  assert.deepEqual(v.ids, [])
  assert.equal(v.descartadas[0].motivo, 'sin_correspondencia_tematica')
})

test('referencia de otra unidad: la Ley 906 de la unidad 1 no se cita en la unidad 2', () => {
  const v = verificarCitas({ ids: ['U1-B4'], sustento: `U1-B4, p. 52: «${Q_LEY906_ART254}»`, entradas: despues, unidad: 2, subtemas: subtemas('U2-T1-R5') })
  assert.deepEqual(v.ids, [])
  assert.equal(v.descartadas[0].motivo, 'otra_unidad')
})

test('límite documentado: un pasaje que menciona el concepto pero en otro contexto (cadena de custodia digital) pasa la correspondencia léxica y queda solo «por confirmar»', () => {
  const calderon = idDe(antes, 'Calderón')
  const v = verificarCitas({ ids: [calderon], sustento: `${calderon}, p. 1: «${Q_CALDERON_P1}»`, entradas: antes, unidad: 2, subtemas: subtemas('U2-T1-R5') })
  assert.deepEqual(v.ids, [calderon])
  assert.equal(v.aceptadas[0].estado, 'por_confirmar')
  assert.equal(v.confirmacion_humana, true)
})
