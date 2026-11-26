// «Curso piloto»: pruebas sin red ni base de datos (fixtures sintéticos en test/fixtures/piloto). Comando: node --test test/piloto.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { fileURLToPath } from 'node:url'

// Los módulos del servidor exigen estas variables al importarse; aquí no se abre ninguna conexión (el pool de pg es perezoso).
process.env.DATABASE_URL ||= 'postgres://prueba:prueba@127.0.0.1:1/prueba'
process.env.JWT_SECRET ||= 'p'.repeat(40)

const aqui = path.dirname(fileURLToPath(import.meta.url))
const FX = path.join(aqui, 'fixtures', 'piloto')
const { bloquesDeHtml, textoDeBloques } = await import('../src/piloto/documento.js')
const catalogo = await import('../src/piloto/catalogo.js')
const { leerSyllabus } = await import('../src/piloto/syllabus.js')
const { leerUnidad, extraerRecursos } = await import('../src/piloto/unidad.js')
const { leerGuion } = await import('../src/piloto/guion.js')
const { simularUnidad } = await import('../src/piloto/simular.js')
const { analizarCarpeta, _vaciarTrabajos } = await import('../src/piloto/analisis.js')
const { crearFuenteFixtures } = await import('../src/piloto/fuentes.js')
const google = await import('../src/piloto/google.js')
const { crearRutasPiloto } = await import('../src/piloto/rutas.js')

const html = (nombre) => fs.readFileSync(path.join(FX, nombre), 'utf8')
const bloquesDe = (rel) => bloquesDeHtml(html(rel))
const plantillasJson = JSON.parse(html('_plantillas.json'))
const catalogoDePrueba = { tipoDe: new Map(Object.entries(plantillasJson.tipoDe)), formDe: plantillasJson.formDe, variantesDe: plantillasJson.variantesDe }
const analizar = (curso, extra = {}) => analizarCarpeta({ carpetaId: 'fixturesraiz0000000000', fuente: crearFuenteFixtures(path.join(FX, curso)), plantillas: async () => catalogoDePrueba, pruebas: async () => false, ...extra })
const porNumero = (r, n) => r.unidades.find((u) => u.numero === n)
const todos = (u) => [u.presentacion, ...u.recursos, ...u.actividades].filter(Boolean)
const hoja = (nombre) => catalogo.filasConEncabezado(catalogo.leerCsv(fs.readFileSync(path.join(FX, '_catalogo', nombre), 'utf8')), nombre === 'recursos.csv' ? 'id base' : 'id de la actividad')

test('bloquesDeHtml: orden párrafo/tabla, celdas con salto de línea, tablas anidadas y colspan', () => {
  const b = bloquesDeHtml(`<html><body>
    <p>Primero</p>
    <table><tbody>
      <tr><td><p>A1</p><p>A2   con  espacios</p></td><td colspan="2"><p>B</p></td><td>C</td></tr>
      <tr><td>Fila 2</td><td><table><tbody><tr><td>n1</td><td>n2</td></tr></tbody></table></td><td></td><td></td></tr>
    </tbody></table>
    <h2>Título</h2><ul><li><p>item uno</p></li><li>item dos</li></ul><p>   </p>
  </body></html>`)
  assert.deepEqual(b.map((x) => x.tipo), ['parrafo', 'tabla', 'parrafo', 'parrafo', 'parrafo'])
  assert.equal(b[0].texto, 'Primero')
  assert.deepEqual(b[1].filas[0], ['A1\nA2 con espacios', 'B', '', 'C']) // colspan = celda vacía para conservar índices
  assert.equal(b[1].filas.length, 2) // la fila de la tabla anidada no se cuenta como fila de la externa
  assert.equal(b[1].filas[1][1], 'n1 | n2') // tabla anidada: su texto va a la celda que la contiene
  assert.deepEqual(b.slice(2).map((x) => x.texto), ['Título', 'item uno', 'item dos'])
  assert.equal(textoDeBloques(b).split('\n')[1], 'A1 A2 con espacios | B |  | C')
})

test('catálogo: fidelidad con n8n (normCat, claveCat, baseIdPorPalabras, índice por hoja)', () => {
  assert.equal(catalogo.normCat('  Línea de TIEMPO: ¡ya! '), 'linea de tiempo ya')
  assert.equal(catalogo.claveCat('Acordeones'), 'acordeon')
  assert.equal(catalogo.claveCat('Infografías interactivas'), 'infografia interactiva')
  const casos = [['Acordeones', 'G-09'], ['Infografía interactiva', 'G-02'], ['Infografía', 'G-01'], ['Línea de tiempo', 'G-12'], ['Presentación de la asignatura', 'G-00'],
    ['Mapa conceptual', 'G-04'], ['Video', 'G-05'], ['Podcast', 'G-07'], ['Cuadro comparativo', 'PRE-05'], ['Microlección', 'POS-05'], ['Galería de imágenes', 'G-10'], ['Algo desconocido', null], ['', null]]
  for (const [nombre, esperado] of casos) assert.equal(catalogo.baseIdPorPalabras(nombre), esperado, nombre)
  const idx = catalogo.indiceRecursos(hoja('recursos.csv'))
  assert.equal(idx.tamano > 0, true)
  assert.equal(idx.baseId('Acordeones'), 'G-09') // por alias, sin plural
  assert.equal(idx.baseId('Acordeón desplegable'), 'G-09')
  assert.equal(idx.baseId('Infografía'), 'G-01') // exacta antes que contención
  assert.equal(idx.baseId('Cuadro comparativo'), 'PRE-05')
  assert.equal(idx.baseId('Otro formato'), null)
  assert.equal(idx.tipoProduccion('G-05'), 'Video')
  assert.equal(idx.tipoProduccion('G-09'), 'HTML')
  assert.equal(catalogo.categoriaPresentacion('Infografía de presentación'), 'G-14')
  assert.equal(catalogo.categoriaPresentacion('Pantalla interactiva'), 'G-15')
  assert.equal(catalogo.categoriaPresentacion('Presentación en diapositivas'), 'G-13')
  const m = catalogo.leerCsv('a,"b,c","d ""e""\nf"\r\n1,2,3\n')
  assert.deepEqual(m, [['a', 'b,c', 'd "e"\nf'], ['1', '2', '3']])
})

test('leerSyllabus (curso-ejemplo): 3 unidades con nombre y formación tecnológica', () => {
  const s = leerSyllabus(bloquesDe('curso-ejemplo/Syllabus Seguridad.html'), 'Syllabus Seguridad')
  assert.deepEqual(s.unidades, [{ numero: 1, nombre: 'Fundamentos' }, { numero: 2, nombre: 'Gestión del riesgo' }, { numero: 3, nombre: 'Respuesta' }])
  assert.equal(s.formacion, 'tecnologico')
  assert.equal(s.curso, 'Seguridad')
  assert.equal(leerSyllabus(bloquesDe('curso-sin-formacion/Syllabus.html')).formacion, null)
})

test('leerUnidad + extraerRecursos (U1): códigos, categorías, calificable y presentación', () => {
  const u = leerUnidad(bloquesDe('curso-ejemplo/Guiones U1 - Fundamentos - 2026-11-20 10-00/Unidad 1 - Estructura metodológica.html'))
  assert.equal(u.numero, 1)
  assert.equal(u.nombre, 'Fundamentos')
  assert.equal(u.temas.length, 2)
  assert.equal(u.formacionTexto, 'Tecnológico')
  const ex = extraerRecursos(u, 1, { indiceRec: catalogo.indiceRecursos(hoja('recursos.csv')), indiceAct: catalogo.indiceActividades(hoja('actividades.csv'), 'tecnologico'), formacion: 'tecnologico' })
  assert.deepEqual(ex.recursos.map((r) => r.codigo), ['U1-T1-R1', 'U1-T1-R2', 'U1-T1-R3', 'U1-T2-R1', 'U1-T2-R2'])
  assert.deepEqual(ex.recursos.map((r) => r.id_catalogo), ['G-09-A', 'G-05-C', 'G-01-A', 'PRE-05-A', 'G-11-C'])
  assert.deepEqual(ex.actividades.map((a) => a.codigo), ['U1-T1-A1', 'U1-T1-A3', 'U1-T2-A1'])
  assert.deepEqual(ex.actividades.map((a) => a.categoria), ['ACT-G-02', 'ACT-E-11-TEC', 'ACT-E-05-TEC'])
  assert.deepEqual(ex.actividades.filter((a) => a.calificable === true).map((a) => a.codigo), ['U1-T2-A1']) // una sola calificable
  assert.equal(ex.actividades.every((a) => typeof a.calificable === 'boolean'), true)
  assert.equal(ex.presentacion.codigo, 'U1-PRES')
  assert.equal(ex.presentacion.categoria, 'G-13')
  assert.equal(ex.presentacion.id_catalogo, 'G-13-C')
  assert.equal(ex.problemas.length, 0)
})

test('extraerRecursos: sin fila de autoaprendizaje en EVALUACIONES ninguna actividad se asigna; códigos de tema repetidos no se asignan', () => {
  const u = leerUnidad(bloquesDe('curso-ejemplo/Guiones U1 - Fundamentos - 2026-11-20 10-00/Unidad 1 - Estructura metodológica.html'))
  const base = { indiceRec: catalogo.indiceRecursos(hoja('recursos.csv')), indiceAct: catalogo.indiceActividades(hoja('actividades.csv'), 'tecnologico'), formacion: 'tecnologico' }
  const sin = extraerRecursos({ ...u, evaluacion: null }, 1, base)
  assert.equal(sin.actividades.every((a) => a.estado === 'sin_asignar' && a.motivo === 'calificable_indeterminada'), true)
  assert.equal(sin.problemas.length, 1)
  const dup = extraerRecursos({ ...u, temas: [...u.temas, { ...u.temas[0] }] }, 1, base)
  assert.equal(dup.problemas.some((p) => p.tipo === 'ambiguo' && /número de tema 1/.test(p.mensaje)), true)
  assert.equal(dup.recursos.filter((r) => r.tema === 1).every((r) => r.motivo === 'codigo_repetido'), true)
})

test('leerGuion: nombre, códigos con su ID, presentación y actividades', () => {
  const g = leerGuion(bloquesDe('curso-ejemplo/Guiones U1 - Fundamentos - 2026-11-20 10-00/Guion_U1_T1.html'), 'Guion_U1_T1')
  assert.equal(g.unidad, 1)
  assert.equal(g.tema, 1)
  assert.deepEqual(g.codigos, [{ codigo: 'U1-T1-R1', id_en_guion: 'G-09-A' }, { codigo: 'U1-T1-R2', id_en_guion: 'G-05-C' }, { codigo: 'U1-T1-R3', id_en_guion: 'G-01-A' }])
  assert.equal(g.tiene_presentacion, true)
  assert.equal(g.actividades, 2)
  assert.deepEqual(g.discrepancias, [])
  const raro = leerGuion(bloquesDe('curso-ejemplo/Guiones U2/Guion_U2_T1.html'), 'Guion_U3_T1')
  assert.equal(raro.discrepancias.length > 0, true) // el nombre dice U3 y los códigos son de U2
})

test('analizarCarpeta (curso-ejemplo): Syllabus, unidades, discrepancias y variantes', async () => {
  const r = await analizar('curso-ejemplo')
  assert.equal(r.syllabus.estado, 'encontrado')
  assert.equal(r.syllabus.unidades.length, 3)
  assert.deepEqual(r.formacion, { valor: 'tecnologico', texto: 'Tecnológico', fuente: 'syllabus' })
  assert.deepEqual(r.catalogo.recursos.fuente, 'hoja')
  const u1 = porNumero(r, 1)
  assert.equal(u1.estado, 'completa')
  assert.equal(u1.documento_unidad.origen, 'carpeta')
  assert.deepEqual(u1.guiones.map((g) => g.tema), [1, 2])
  assert.deepEqual(u1.temas.map((t) => !!t.guion_id), [true, true])
  const por = Object.fromEntries(todos(u1).map((i) => [i.codigo, i]))
  assert.equal(por['U1-T1-R1'].variante.plantilla, 'acordeon-tec-01') // la primera aprobada por orden de subida
  assert.equal(por['U1-T1-R1'].id_en_guion, 'G-09-A')
  assert.equal(por['U1-T1-R2'].estado, 'no_html') // G-05 es video
  assert.equal(por['U1-T2-R1'].motivo, 'sin_variantes_aprobadas') // PRE-05 solo en revisión
  assert.equal(por['U1-T2-A1'].variante.plantilla, 'escenarios-tec-cal') // la única calificable
  assert.equal(por['U1-PRES'].variante.plantilla, 'presentacion-tec-01')
  assert.equal(por['U1-T1-A1'].variante.url_ver, '/plantillas-html/ver/decision-p1')
  assert.equal(por['U1-T1-A1'].variante.regla, 'primera_libre_determinista')
  // U2: documento en la raíz; el guion dice otro ID (G-01 vs G-09) → no se asigna
  const u2 = porNumero(r, 2)
  assert.equal(u2.documento_unidad.origen, 'raiz')
  assert.equal(u2.estado, 'incompleta')
  const r1 = u2.recursos.find((x) => x.codigo === 'U2-T1-R1')
  assert.equal(r1.motivo, 'id_discrepante')
  assert.equal(r1.variante, null)
  assert.equal(u2.problemas.some((p) => p.tipo === 'discrepancia' && p.codigo === 'U2-T1-R1'), true)
  assert.equal(u2.presentacion.motivo, 'presentacion_no_indicada')
  // U3: sin carpeta ni documento
  const u3 = porNumero(r, 3)
  assert.equal(u3.estado, 'sin_carpeta')
  assert.equal(u3.problemas.some((p) => p.tipo === 'falta'), true)
  // U4: carpeta sobrante, sin documento de unidad: recursos detectados en el guion y sin asignar
  assert.deepEqual(r.carpetas_sobrantes.map((c) => c.numero), [4])
  const u4 = porNumero(r, 4)
  assert.equal(u4.estado, 'sin_documento_unidad')
  assert.equal(u4.en_syllabus, false)
  assert.equal(u4.recursos[0].detectado_en, 'guion')
  assert.equal(u4.recursos[0].motivo, 'falta_documento_unidad')
  assert.deepEqual(r.raiz_no_reconocidos.map((d) => d.nombre), ['Notas'])
  assert.equal(r.resumen.unidades_syllabus, 3)
  assert.equal(r.resumen.unidades_encontradas, 2)
  assert.equal(typeof r.resumen.problemas, 'number')
  assert.equal(r.diferencias_con_sistema_real.length > 0, true)
  // nada de contenido de documentos en el resultado
  assert.equal(JSON.stringify(r).includes('Aplicar lo aprendido'), false)
})

test('analizarCarpeta (curso-ambiguo): nada ambiguo se asigna ni se elige al azar', async () => {
  const r = await analizar('curso-ambiguo')
  assert.equal(r.syllabus.estado, 'ambiguo')
  assert.equal(r.syllabus.candidatos.length, 2)
  assert.equal(r.syllabus.documento, null)
  const u1 = porNumero(r, 1)
  assert.equal(u1.estado, 'ambigua')
  assert.equal(u1.carpetas_candidatas.length, 2)
  const u2 = porNumero(r, 2)
  assert.equal(u2.estado, 'ambigua')
  assert.equal(u2.documento_unidad_candidatos.length, 2)
  for (const u of [u1, u2]) assert.equal(todos(u).filter((i) => i.variante).length, 0)
  assert.equal(r.problemas.some((p) => p.tipo === 'ambiguo' && p.candidatos.length === 2), true)
  const u3 = porNumero(r, 3)
  const ambigua = u3.actividades.find((a) => a.nombre === 'Simulaciones de caso')
  assert.equal(ambigua.motivo, 'actividad_ambigua')
  assert.deepEqual(ambigua.candidatos, ['ACT-G-04', 'ACT-G-05'])
  assert.equal(ambigua.variante, null)
  assert.equal(r.formacion.fuente, 'unidad') // el Syllabus es ambiguo: la formación sale de los documentos de unidad
})

test('analizarCarpeta (curso-sin-formacion): sin formación no se asigna nada, pero se listan categorías', async () => {
  const r = await analizar('curso-sin-formacion')
  assert.equal(r.formacion.valor, null)
  assert.equal(r.problemas.some((p) => p.tipo === 'formacion'), true)
  assert.equal(r.resumen.asignadas, 0)
  const u1 = porNumero(r, 1)
  assert.deepEqual(u1.recursos.map((x) => x.categoria), ['G-09', 'G-11'])
  assert.equal(u1.recursos.every((x) => x.estado === 'sin_asignar' && x.motivo === 'formacion_desconocida'), true)
  assert.equal(u1.actividades[0].categoria, null) // la hoja de actividades depende del nivel
})

test('analizarCarpeta: catálogo ilegible usa el respaldo marcado y las actividades no se asignan', async () => {
  const fuente = crearFuenteFixtures(path.join(FX, 'curso-ejemplo'))
  const r = await analizarCarpeta({ carpetaId: 'fixturesraiz0000000000', fuente: { ...fuente, leerCatalogoRecursos: async () => null, leerCatalogoActividades: async () => null }, plantillas: async () => catalogoDePrueba, pruebas: async () => false })
  assert.equal(r.catalogo.recursos.fuente, 'respaldo_palabras')
  assert.equal(r.catalogo.actividades.fuente, 'no_disponible')
  assert.equal(porNumero(r, 1).recursos[0].fuente_categoria, 'respaldo_palabras')
  assert.equal(porNumero(r, 1).actividades.every((a) => a.motivo === 'catalogo_actividades_no_disponible'), true)
  assert.equal(r.problemas.filter((p) => p.tipo === 'catalogo').length, 2)
})

test('analizarCarpeta: un documento ilegible no detiene el análisis; la raíz ilegible sí', async () => {
  const fuente = crearFuenteFixtures(path.join(FX, 'curso-ejemplo'))
  const r = await analizarCarpeta({ carpetaId: 'fixturesraiz0000000000', fuente: { ...fuente, leerDocHtml: async (e) => { if (/Notas/.test(e.nombre)) { const x = new Error('no_publico'); x.codigo = 'no_publico'; throw x } return fuente.leerDocHtml(e) } }, plantillas: async () => catalogoDePrueba, pruebas: async () => false })
  const notas = r.raiz_no_reconocidos.find((d) => d.nombre === 'Notas')
  assert.equal(notas.estado, 'ilegible')
  assert.equal(notas.motivo, 'no_publico')
  await assert.rejects(analizarCarpeta({ carpetaId: 'x'.repeat(12), fuente: { ...fuente, listar: async () => { const e = new Error('carpeta_no_publica'); e.codigo = 'carpeta_no_publica'; throw e } } }), /carpeta_no_publica/)
})

test('simularUnidad: variantes, no_html, repeticiones, determinismo y modo de pruebas', () => {
  const it = (o) => ({ codigo: 'X', clase: 'recurso', calificable: null, categoria: null, tipo_produccion: null, estado: null, motivo: null, aviso: null, variante: null, ...o })
  const contexto = { formacion: 'tecnologico', pruebas: false, ...catalogoDePrueba }
  const items = [
    it({ codigo: 'R1', categoria: 'G-09' }), it({ codigo: 'R2', categoria: 'G-09' }), it({ codigo: 'R3', categoria: 'G-09' }),
    it({ codigo: 'R4', categoria: 'G-05', tipo_produccion: 'Video' }), it({ codigo: 'R5', categoria: 'PRE-05' }), it({ codigo: 'R6', categoria: 'G-99' }),
    it({ codigo: 'A1', clase: 'actividad', categoria: 'ACT-E-05-TEC', calificable: true }),
    ...[1, 2, 3, 4, 5].map((n) => it({ codigo: 'P' + n, clase: 'actividad', categoria: 'ACT-G-02', calificable: false })),
    it({ codigo: 'A9', clase: 'actividad', categoria: 'ACT-G-02', calificable: null }),
    it({ codigo: 'A10', clase: 'actividad', categoria: 'ACT-E-05-TEC', calificable: false })
  ]
  const s = simularUnidad(items, contexto)
  const de = Object.fromEntries(s.map((x) => [x.codigo, x]))
  assert.equal(de.R1.variante.plantilla, 'acordeon-tec-01')
  assert.equal(de.R2.variante.plantilla, 'acordeon-tec-02')
  assert.equal(de.R3.estado, 'sin_asignar')
  assert.equal(de.R3.motivo, 'variantes_agotadas') // las recursos nunca se repiten dentro de la unidad
  assert.equal(de.R4.estado, 'no_html')
  assert.equal(de.R5.motivo, 'sin_variantes_aprobadas')
  assert.equal(de.R6.motivo, 'categoria_inexistente')
  assert.equal(de.A1.variante.plantilla, 'escenarios-tec-cal')
  assert.deepEqual(['P1', 'P2', 'P3'].map((c) => de[c].variante.plantilla), ['decision-p1', 'decision-p2', 'decision-p3'])
  assert.equal(de.P4.estado, 'repetida')
  assert.equal(de.P4.motivo, 'variante_repetida')
  assert.match(de.P4.aviso, /Variante repetida: ya se usaron todas las de ese tipo en ACT-G-02/)
  assert.equal(de.P4.variante.plantilla, 'decision-p1') // la primera de las menos usadas
  assert.equal(de.P5.variante.plantilla, 'decision-p2') // y se reparte
  assert.equal(de.A9.motivo, 'falta_calificable')
  assert.equal(de.A10.motivo, 'categoria_sin_practicas')
  assert.deepEqual(simularUnidad(items, contexto), s) // determinista: misma entrada, mismo resultado
  assert.equal(items[0].estado, null) // no modifica la entrada
  // calificable repetida: sin aviso
  const cal = simularUnidad([it({ codigo: 'C1', clase: 'actividad', categoria: 'ACT-E-05-TEC', calificable: true }), it({ codigo: 'C2', clase: 'actividad', categoria: 'ACT-E-05-TEC', calificable: true })], contexto)
  assert.equal(cal[1].estado, 'repetida'); assert.equal(cal[1].motivo, 'calificable_repetida'); assert.equal(cal[1].aviso, null)
  // modo de pruebas: se asignan las de revisión y las de la formación van primero
  const p = simularUnidad([1, 2, 3, 4, 5].map((n) => it({ codigo: 'Q' + n, categoria: 'G-09' })).concat([it({ codigo: 'Q6', categoria: 'PRE-05' })]), { ...contexto, pruebas: true })
  assert.deepEqual(p.slice(0, 4).map((x) => x.variante.plantilla), ['acordeon-tec-01', 'acordeon-tec-02', 'acordeon-tec-03', 'acordeon-prof-01'])
  assert.equal(p[4].motivo, 'variantes_agotadas')
  assert.equal(p[5].variante.plantilla, 'cuadro-tec-01')
})

test('descargarGoogle: solo hosts de Google, sin sesión, tope de tamaño y redirecciones revisadas en cada salto', async () => {
  const validar = async (u) => new URL(u)
  const visitado = []
  const respuesta = (cuerpo, { estado = 200, tipo = 'text/html', ubicacion, largo } = {}) => new Response(cuerpo, { status: estado, headers: { 'content-type': tipo, ...(ubicacion ? { location: ubicacion } : {}), ...(largo ? { 'content-length': String(largo) } : {}) } })
  const con = (mapa) => ({ validar, fetch: async (u) => { visitado.push(String(u)); const f = mapa[new URL(u).hostname]; return f ? f(u) : respuesta('x') } })
  const bueno = 'https://docs.google.com/document/d/AAAAAAAAAAAA/export?format=html'
  await assert.rejects(google.descargarGoogle('http://127.0.0.1/x'), (e) => e.codigo === 'host_no_permitido')
  await assert.rejects(google.descargarGoogle('https://127.0.0.1/x'), (e) => e.codigo === 'host_no_permitido')
  await assert.rejects(google.descargarGoogle('https://evil.com/x'), (e) => e.codigo === 'host_no_permitido')
  await assert.rejects(google.descargarGoogle('https://docs.google.com.evil.com/x'), (e) => e.codigo === 'host_no_permitido')
  await assert.rejects(google.descargarGoogle('https://usuario:clave@docs.google.com/x', {}, con({})), (e) => e.codigo === 'host_no_permitido')
  assert.deepEqual(visitado, []) // ni una petición a esos destinos
  // redirección a accounts.google.com = documento privado
  await assert.rejects(google.descargarGoogle(bueno, {}, con({ 'docs.google.com': () => respuesta('', { estado: 302, ubicacion: 'https://accounts.google.com/ServiceLogin?x=1' }) })), (e) => e.codigo === 'no_publico')
  assert.equal(visitado.some((v) => v.includes('accounts.google.com')), false)
  // redirección a un host ajeno
  visitado.length = 0
  await assert.rejects(google.descargarGoogle(bueno, {}, con({ 'docs.google.com': () => respuesta('', { estado: 307, ubicacion: 'https://evil.com/robo' }) })), (e) => e.codigo === 'host_no_permitido')
  assert.equal(visitado.some((v) => v.includes('evil.com')), false)
  // redirección a una dirección interna (la valida validarDestino real en cada salto)
  await assert.rejects(google.descargarGoogle(bueno, {}, { fetch: async () => respuesta('', { estado: 307, ubicacion: 'https://127.0.0.1/interno' }) }), (e) => e.codigo === 'host_no_permitido')
  // validarDestino que rechaza un host permitido (p. ej. resuelve a una IP privada)
  await assert.rejects(google.descargarGoogle(bueno, {}, { validar: async () => { throw new Error('Dirección interna no permitida') }, fetch: async () => respuesta('x') }), (e) => e.codigo === 'host_no_permitido')
  // redirección legítima a googleusercontent
  const ok = await google.descargarGoogle(bueno, {}, con({ 'docs.google.com': () => respuesta('', { estado: 307, ubicacion: 'https://doc-0g-ab-docs.googleusercontent.com/export/x' }), 'doc-0g-ab-docs.googleusercontent.com': () => respuesta('<p>hola</p>') }))
  assert.equal(ok.estado, 200); assert.equal(ok.datos.toString(), '<p>hola</p>')
  // bucle de redirecciones
  await assert.rejects(google.descargarGoogle(bueno, {}, { validar, fetch: async () => respuesta('', { estado: 302, ubicacion: bueno }) }), (e) => e.codigo === 'demasiadas_redirecciones')
  // tope de tamaño: por cabecera y por bytes leídos
  await assert.rejects(google.descargarGoogle(bueno, { maxBytes: 10 }, { validar, fetch: async () => respuesta('x', { largo: 999 }) }), (e) => e.codigo === 'demasiado_grande')
  await assert.rejects(google.descargarGoogle(bueno, { maxBytes: 10 }, { validar, fetch: async () => respuesta('x'.repeat(100)) }), (e) => e.codigo === 'demasiado_grande')
  // tiempo
  await assert.rejects(google.descargarGoogle(bueno, {}, { validar, fetch: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e } }), (e) => e.codigo === 'tiempo')
})

test('listarCarpetaPublica / exportarDocHtml: parseo del HTML de embeddedfolderview y errores', async () => {
  const validar = async (u) => new URL(u)
  const embedded = html('embedded.html')
  const pedidos = []
  const deps = { validar, fetch: async (u) => { pedidos.push(String(u)); return new Response(embedded, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) } }
  const c = await google.listarCarpetaPublica('AAAAAAAAAAAA', 'rk_12', deps)
  assert.equal(c.nombre, 'Curso de ejemplo')
  assert.deepEqual(c.entradas.map((e) => e.tipo), ['carpeta', 'doc', 'hoja', 'docx'])
  assert.equal(c.entradas[0].nombre, 'Guiones U1')
  assert.equal(c.entradas[1].id, '1AbCdEfGhIjKlMnOpQrStUvWxYz0002')
  assert.match(pedidos[0], /^https:\/\/drive\.google\.com\/embeddedfolderview\?id=AAAAAAAAAAAA&resourcekey=rk_12$/)
  await assert.rejects(google.listarCarpetaPublica('AAAAAAAAAAAA', null, { validar, fetch: async () => new Response('no', { status: 404 }) }), (e) => e.codigo === 'carpeta_no_publica')
  await assert.rejects(google.listarCarpetaPublica('corto'), (e) => e.codigo === 'carpeta_no_publica') // el ID se valida antes de armar la URL
  await assert.rejects(google.listarCarpetaPublica('../../etc/passwd'), (e) => e.codigo === 'carpeta_no_publica')
  const mucho = '<html><body>' + Array.from({ length: 501 }, (_, i) => `<div class="flip-entry" id="entry-ID${String(i).padStart(12, '0')}"><a href="https://docs.google.com/document/d/x/edit"><div class="flip-entry-title">d${i}</div></a></div>`).join('') + '</body></html>'
  await assert.rejects(google.listarCarpetaPublica('AAAAAAAAAAAA', null, { validar, fetch: async () => new Response(mucho, { status: 200, headers: { 'content-type': 'text/html' } }) }), (e) => e.codigo === 'carpeta_demasiado_grande')
  assert.equal(await google.exportarDocHtml('AAAAAAAAAAAA', { validar, fetch: async () => new Response('<p>x</p>', { status: 200, headers: { 'content-type': 'text/html' } }) }), '<p>x</p>')
  await assert.rejects(google.exportarDocHtml('AAAAAAAAAAAA', { validar, fetch: async () => new Response('login', { status: 200, headers: { 'content-type': 'text/plain' } }) }), (e) => e.codigo === 'no_publico')
})

// ---- Rutas ----------------------------------------------------------------------------------------------------------------
async function levantar(opciones = {}) {
  const app = express()
  app.use(express.json())
  app.use('/api/piloto', crearRutasPiloto({
    antes: [(req, _res, next) => { req.usuario = { id: req.get('x-prueba-usuario') }; next() }],
    fuente: () => crearFuenteFixtures(path.join(FX, 'curso-ejemplo')), plantillas: async () => catalogoDePrueba, pruebas: async () => false, ...opciones
  }))
  const srv = http.createServer(app)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/piloto'
  const pedir = (metodo, ruta, usuario, cuerpo) => fetch(base + ruta, { method: metodo, headers: { 'x-prueba-usuario': usuario, 'content-type': 'application/json' }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })
  return { srv, pedir }
}
const sondear = async (pedir, id, usuario) => {
  for (let i = 0; i < 200; i++) { const j = await (await pedir('GET', '/analisis/' + id, usuario)).json(); if (j.estado === 'listo' || j.estado === 'error') return j; await new Promise((r) => setTimeout(r, 25)) }
  throw new Error('el análisis no terminó')
}
const URL_OK = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0001?usp=sharing'

test('rutas: 400, 202 + sondeo hasta listo, 404 para otra persona y borrado', async () => {
  _vaciarTrabajos()
  const { srv, pedir } = await levantar()
  try {
    for (const malo of [{}, { carpeta_url: 'https://evil.com/drive/folders/AAAAAAAAAAAA' }, { carpeta_url: 'http://drive.google.com/drive/folders/AAAAAAAAAAAA' }, { carpeta_url: 'https://drive.google.com/drive/folders/corto' }, { carpeta_url: URL_OK, otro: 1 }, { carpeta_url: 'https://drive.google.com/drive/folders/' + 'A'.repeat(600) }]) {
      assert.equal((await pedir('POST', '/analisis', 'ana-malos', malo)).status, 400, JSON.stringify(malo).slice(0, 80))
    }
    const r = await pedir('POST', '/analisis', 'ana', { carpeta_url: URL_OK })
    assert.equal(r.status, 202)
    const { id } = await r.json()
    assert.match(id, /^[0-9a-f-]{36}$/)
    const fin = await sondear(pedir, id, 'ana')
    assert.equal(fin.estado, 'listo')
    assert.equal(fin.error, null)
    assert.equal(fin.resultado.version, 1)
    assert.equal(fin.resultado.fuente, 'fixtures')
    assert.equal(fin.resultado.resumen.unidades_encontradas, 2)
    assert.equal(fin.resultado.carpeta.id, '1AbCdEfGhIjKlMnOpQrStUvWxYz0001')
    assert.equal(fin.resultado.unidades.length, 4)
    assert.equal((await pedir('GET', '/analisis/' + id, 'beto')).status, 404) // de otra persona
    assert.equal((await pedir('DELETE', '/analisis/' + id, 'beto')).status, 404)
    assert.equal((await pedir('GET', '/analisis/no-es-uuid', 'ana')).status, 404)
    assert.equal((await pedir('DELETE', '/analisis/' + id, 'ana')).status, 204)
    assert.equal((await pedir('GET', '/analisis/' + id, 'ana')).status, 404)
  } finally { srv.close() }
})

test('rutas: 429 con un segundo análisis de la misma persona en curso y con 3 en total; error amable si la carpeta no es pública', async () => {
  _vaciarTrabajos()
  let abrir
  const puerta = new Promise((r) => { abrir = r })
  const { srv, pedir } = await levantar({ plantillas: async () => { await puerta; return catalogoDePrueba } })
  try {
    const a = await pedir('POST', '/analisis', 'carla', { carpeta_url: URL_OK })
    assert.equal(a.status, 202)
    const { id } = await a.json()
    const otra = await pedir('POST', '/analisis', 'carla', { carpeta_url: URL_OK })
    assert.equal(otra.status, 429)
    assert.match((await otra.json()).error, /Ya tiene un análisis en curso/)
    const en = await (await pedir('GET', '/analisis/' + id, 'carla')).json()
    assert.equal(['leyendo', 'analizando'].includes(en.estado), true)
    assert.equal(en.resultado, null)
    assert.equal((await pedir('POST', '/analisis', 'dani', { carpeta_url: URL_OK })).status, 202)
    assert.equal((await pedir('POST', '/analisis', 'eva', { carpeta_url: URL_OK })).status, 202)
    const lleno = await pedir('POST', '/analisis', 'fer', { carpeta_url: URL_OK })
    assert.equal(lleno.status, 429)
    assert.match((await lleno.json()).error, /ocupado/)
    abrir()
    assert.equal((await sondear(pedir, id, 'carla')).estado, 'listo')
  } finally { srv.close() }
  _vaciarTrabajos()
  const s2 = await levantar({ fuente: () => ({ ...crearFuenteFixtures(path.join(FX, 'curso-ejemplo')), listar: async () => { const e = new Error('carpeta_no_publica'); e.codigo = 'carpeta_no_publica'; throw e } }) })
  try {
    const { id } = await (await s2.pedir('POST', '/analisis', 'gus', { carpeta_url: URL_OK })).json()
    const fin = await sondear(s2.pedir, id, 'gus')
    assert.equal(fin.estado, 'error')
    assert.match(fin.error, /Cualquier persona con el enlace/)
  } finally { s2.srv.close() }
})
