// Nodo Code: «Preparar bibliografía recibida» · Modo: Run Once for All Items
// Va entre «Extraer Syllabus» y «Asignar actividades autoaprendizaje».
//
// La bibliografía YA NO sale del Word ni del conocimiento del modelo: la plataforma la leyó (cada fuente, completa, con su
// texto por página y su cita APA 7) y la manda en body.bibliografia.fuentes. Aquí se hace lo siguiente:
//  1) Si no llegó la bibliografía, el flujo se detiene (nunca se inventa).
//  2) Las referencias de cada unidad se reemplazan por las recibidas (mismos IDs: U1-B1, U1-C2…).
//  3) Para cada subtema se eligen los extractos más pertinentes (con ID de fuente y número de página) entre las fuentes
//     de su unidad. El modelo solo puede apoyarse en esos extractos.

const cuerpo = ($('Webhook Syllabus1').first().json.body) || {};
const paquete = cuerpo.bibliografia;
if (!paquete || !Array.isArray(paquete.fuentes) || !paquete.fuentes.length) {
  throw new Error('Falta la bibliografía leída: el cuerpo de la petición debe traer bibliografia.fuentes (la plataforma la envía cuando todas las fuentes están leídas).');
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
const PARADAS = new Set('para como entre sobre desde hasta cada otros otras este esta estos estas pero porque cuando donde segun mediante durante tambien ademas aquellos aquellas'.split(' '));
const claves = texto => [...new Set(norm(texto).split(' ').filter(w => w.length > 3 && !PARADAS.has(w)))];
const limpio = s => String(s || '').replace(/\s+/g, ' ').trim();
const minus = s => { const t = limpio(s); return t.length > 1 && t !== t.toUpperCase() ? t.charAt(0).toLocaleLowerCase('es') + t.slice(1) : t; };
// Metodologías activas del nivel (con prioridad): de aquí salen las que completan una metodología distinta por tema.
const MET_NIVEL = __METODOLOGIAS__;
const usoMet = new Map(); // veces que se usó cada una; el conteo vale para todas las unidades de la petición
const nivelDeTexto = v => { const n = norm(v); if (/doctor/.test(n)) return 'Doctorado'; if (/especial/.test(n)) return 'Especialización'; if (/tecnol|tecnic/.test(n)) return 'Tecnológico'; return 'Licenciatura'; };
const AFINIDAD_MET = [[/simulaci/, /simul|escenario|decision|emergenc|crisis/], [/caso/, /caso|situacion|incidente/], [/proyecto/, /proyecto|plan|dise|program/], [/retos/, /reto|desaf|competenc/], [/problemas|abp/, /problema|riesgo|prevenc|causa/], [/evidencias/, /evidenc|valoraci|evaluaci|medici|resultado/], [/observacion/, /observ|identific|reconoc|analisis/], [/juegos/, /juego|motivaci|habito/], [/descubrimiento/, /explor|descubr|concepto|fundamento/], [/aula invertida/, /fundamento|concepto|teori/], [/colaborativo/, /equipo|comunidad|colabor|particip/], [/pensamiento de dise/, /dise|innov|propuesta/], [/adaptativo/, /nivel|ritmo|individual/], [/experimental/, /experiment|prueba|laborator/]];
const sinCursiva = s => String(s || '').replace(/\*/g, '').trim();

// Puntaje de una página: apariciones de las palabras del tema/subtema (cada palabra cuenta hasta 3 veces).
function puntaje(textoNorm, palabras) {
  let p = 0;
  for (const w of palabras) {
    let n = 0, i = textoNorm.indexOf(w);
    while (i !== -1 && n < 3) { n++; i = textoNorm.indexOf(w, i + w.length); }
    p += n;
  }
  return p;
}

// Prepara una sola vez el texto normalizado de cada página.
const fuentes = paquete.fuentes.map(f => ({
  ...f,
  paginas: (f.paginas || []).map(p => ({ numero: Number(p.numero), texto: String(p.texto || ''), norm: norm(p.texto) }))
}));

function mejoresExtractos(delaUnidad, palabras, cuantos, max) {
  const candidatos = [];
  for (const f of delaUnidad) {
    for (const p of f.paginas) {
      const s = puntaje(p.norm, palabras);
      if (s > 0) candidatos.push({ f, p, s: s + (f.categoria === 'basica' ? 0.5 : 0) });
    }
  }
  candidatos.sort((a, b) => b.s - a.s);
  // Reparte entre fuentes: como mucho dos extractos por fuente para no depender de una sola.
  const porFuente = {};
  const elegidos = [];
  for (const c of candidatos) {
    if ((porFuente[c.f.id] || 0) >= 2) continue;
    porFuente[c.f.id] = (porFuente[c.f.id] || 0) + 1;
    elegidos.push({ id: c.f.id, pagina: c.p.numero, texto: c.p.texto.slice(0, max) });
    if (elegidos.length >= cuantos) break;
  }
  return elegidos;
}

return $input.all().map((item, i) => {
  const j = item.json;
  const unidad = j.unidad;
  const N = Number(unidad.numero);
  const delaUnidad = fuentes.filter(f => Number(f.unidad) === N);
  if (!delaUnidad.length) {
    throw new Error('La bibliografía enviada no trae fuentes de la unidad ' + N + '. Unidades con fuentes: ' + [...new Set(fuentes.map(f => f.unidad))].join(', '));
  }
  const aEntrada = f => ({
    id: f.id,
    tipo: f.categoria === 'complementaria' ? 'complementaria' : 'basica',
    texto: sinCursiva(f.referencia_apa) || sinCursiva(f.entrada_syllabus),
    referencia_apa: f.referencia_apa || '',
    cita_apa: f.cita_apa || '',
    titulo: f.titulo || '',
    anio: Number(f.anio) || null,
    doi: f.doi || null,
    url: f.url || null,
    paginas_leidas: f.paginas.length
  });
  const basica = delaUnidad.filter(f => f.categoria !== 'complementaria').map(aEntrada);
  const complementaria = delaUnidad.filter(f => f.categoria === 'complementaria').map(aEntrada);

  const temas = (unidad.temas || []).map(t => ({
    ...t,
    subtemas: (t.subtemas || []).map(s => ({
      ...s,
      extractos: mejoresExtractos(delaUnidad, claves((t.nombre || '') + ' ' + (s.nombre || '')), 3, 1600)
    }))
  }));
  // ---- Metodologías activas, EXPLICADAS PARA CADA TEMA ----
  // El Syllabus trae las metodologías una sola vez para toda la unidad (con o sin descripción). En el documento cada tema
  // debe llevar su explicación: la frase se arma con el nombre del tema y sus subtemas, así que cambia de un tema a otro.
  // Si el Syllabus ya asigna metodologías propias a un tema (celda por tema), se respetan tal cual.
  const avisos = [];
  const lista = t => limpio(t).split(/(?:^|\s)-(?=[A-ZÁÉÍÓÚÑ¿¡])/).map(x => limpio(x).replace(/[.;,]+$/, '')).filter(Boolean);
  let ensenanza = unidad.ensenanza || { metodologias: [], tecnicas: [] };
  if (!(ensenanza.metodologias || []).length && limpio(unidad.estrategias_ensenanza)) {
    const nombres = lista(unidad.estrategias_ensenanza);
    if (nombres.length) ensenanza = { ...ensenanza, metodologias: nombres.map(n => ({ nombre: n, descripcion: '' })) };
  }
  const PLANTILLAS = [
    [/aula invertida/, (T, S) => 'Antes de cada sesión del ' + T + ', el estudiante estudia por su cuenta los contenidos de ' + S + '; el tiempo de clase se dedica a aplicarlos, discutirlos y resolver dudas con el docente.'],
    [/problemas|abp/, (T, S) => 'En el ' + T + ', el estudiante parte de un problema que integra ' + S + ' y lo analiza para construir los conocimientos necesarios y proponer una solución.'],
    [/retos/, (T, S) => 'En el ' + T + ', el estudiante enfrenta un reto concreto relacionado con ' + S + ' y lo supera integrando lo aprendido en una solución propia.'],
    [/proyectos/, (T, S) => 'En el ' + T + ', el estudiante planifica y desarrolla un proyecto que articula ' + S + ' y lo presenta como producto final.'],
    [/estudios? de caso|metodo de casos/, (T, S) => 'En el ' + T + ', el estudiante analiza casos reales o simulados sobre ' + S + ' para identificar problemas, valorar alternativas y fundamentar decisiones.'],
    [/juegos|gamific|ludific/, (T, S) => 'En el ' + T + ', los contenidos de ' + S + ' se trabajan con dinámicas de juego (retos, reglas y retroalimentación inmediata) que motivan y consolidan el aprendizaje.'],
    [/observacion/, (T, S) => 'En el ' + T + ', el estudiante observa y analiza sistemáticamente situaciones y desempeños relacionados con ' + S + '.'],
    [/evidencias/, (T, S) => 'En el ' + T + ', el estudiante interpreta información y evidencia sobre ' + S + ' y fundamenta en ella sus decisiones, conclusiones y propuestas.'],
    [/adaptativo/, (T, S) => 'En el ' + T + ', las actividades sobre ' + S + ' se ajustan al ritmo y al nivel de cada estudiante.'],
    [/pensamiento de dise/, (T, S) => 'En el ' + T + ', el estudiante aplica el ciclo del diseño (comprender, idear, prototipar y probar) para resolver situaciones relacionadas con ' + S + '.'],
    [/basado en pensamiento/, (T, S) => 'En el ' + T + ', el estudiante desarrolla el pensamiento crítico sobre ' + S + ' mediante preguntas, argumentación y rutinas de reflexión.'],
    [/colaborativo internacional/, (T, S) => 'En el ' + T + ', equipos de distintos contextos trabajan en línea para construir conocimiento conjunto sobre ' + S + '.'],
    [/colaborativo/, (T, S) => 'En el ' + T + ', el estudiante construye en equipo, con roles y metas compartidas, el conocimiento de ' + S + '.'],
    [/descubrimiento/, (T, S) => 'En el ' + T + ', el estudiante explora y descubre por sí mismo conceptos y relaciones de ' + S + ', con la guía del docente.'],
    [/simulacion/, (T, S) => 'En el ' + T + ', el estudiante practica decisiones y procedimientos de ' + S + ' en escenarios simulados del ejercicio profesional.'],
    [/experimental/, (T, S) => 'En el ' + T + ', el estudiante pone a prueba ideas y procedimientos de ' + S + ' y analiza los resultados.']
  ];
  const explicar = (n, T, S) => { const k = norm(n); const p = PLANTILLAS.find(([rx]) => rx.test(k)); return p ? p[1](T, S) : 'En el ' + T + ', se aplica en ' + S + '.'; };
  const enLista = a => (a.length > 1 ? a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1] : a.join(''));
  // Una metodología DISTINTA por tema: las que declara el Syllabus van primero (tema 1, tema 2…); si declara menos que temas,
  // los demás temas toman otra del catálogo del nivel (Prioritarias primero), sin repetirse en la unidad ni entre unidades.
  // Si el Syllabus declara tantas o más que temas, cada tema las muestra todas (explicadas para ese tema).
  const declaradas = (ensenanza.metodologias || []).map(m => m.nombre);
  const nivelMet = nivelDeTexto(j.general && j.general.nivel_formacion);
  const delCatalogo = (MET_NIVEL[nivelMet] || []).filter(([n]) => !declaradas.some(d => norm(d) === norm(n)));
  const completadas = [];
  const elegirMetodologias = (ti, T, S) => {
    if (declaradas.length >= temas.length) return ensenanza.metodologias.map(m => ({ nombre: m.nombre, descripcion: explicar(m.nombre, T, S) }));
    if (ti < declaradas.length) return [{ nombre: declaradas[ti], descripcion: explicar(declaradas[ti], T, S) }];
    const texto = norm(T + ' ' + S);
    const afin = n => { const k = norm(n); const a = AFINIDAD_MET.find(([rx]) => rx.test(k)); return a && a[1].test(texto) ? 1 : 0; };
    const elegida = delCatalogo.slice().sort((a, b) =>
      (usoMet.get(a[0]) || 0) - (usoMet.get(b[0]) || 0) || (a[1] === 'P' ? 0 : 1) - (b[1] === 'P' ? 0 : 1) || afin(b[0]) - afin(a[0]))[0];
    if (!elegida) return declaradas.length ? [{ nombre: declaradas[0], descripcion: explicar(declaradas[0], T, S) }] : [];
    usoMet.set(elegida[0], (usoMet.get(elegida[0]) || 0) + 1);
    completadas.push('tema ' + (ti + 1) + ': ' + elegida[0]);
    return [{ nombre: elegida[0], descripcion: explicar(elegida[0], T, S) }];
  };
  if ((ensenanza.metodologias || []).length || delCatalogo.length) {
    let propias = 0;
    temas.forEach((t, ti) => {
      if (t.ensenanza && (t.ensenanza.metodologias || []).length) { propias++; return; }
      const nombreTema = limpio(t.nombre).replace(/^\d+\s*[.)\-–]?\s*/, '');
      const T = 'Tema ' + (ti + 1) + ': ' + nombreTema;
      const S = enLista((t.subtemas || []).map(x => '«' + limpio(x.nombre).replace(/^\d+(?:\.\d+)*\s*[.)\-–]?\s*/, '').replace(/[.;,]+$/, '') + '»'));
      t.ensenanza = { metodologias: elegirMetodologias(ti, T, S), tecnicas: ensenanza.tecnicas || [] };
    });
    if (propias < temas.length) {
      avisos.push('Metodologías activas: el Syllabus declara ' + (declaradas.length ? declaradas.join('; ') : 'ninguna') + ' para la unidad. ' + (declaradas.length >= temas.length ? 'Cada tema las muestra todas, explicadas con su nombre y sus subtemas.' : 'Cada tema lleva una distinta: las declaradas primero y, para los demás temas, del catálogo del nivel (' + completadas.join('; ') + ').') + ' Las frases modelo de cada explicación las trae el flujo, no el Syllabus.');
      const conDescripcion = ensenanza.metodologias.filter(m => limpio(m.descripcion));
      if (conDescripcion.length) avisos.push('Descripción de la unidad en el Syllabus (no se repite en los temas): ' + conDescripcion.map(m => m.nombre + ': ' + limpio(m.descripcion)).join(' | '));
    }
  }

  let evaluacion = unidad.evaluacion_syllabus || { formativas: [], sumativas: [] };
  if (!(evaluacion.formativas || []).length && !(evaluacion.sumativas || []).length && limpio(unidad.estrategias_evaluativas)) {
    const nombres = lista(unidad.estrategias_evaluativas);
    if (nombres.length >= 2) {
      // La sumativa es la estrategia de producto (tarea, proyecto, informe, caso…); las demás, en su orden, son las formativas.
      let iS = nombres.findIndex(n => /tarea|proyecto|informe|producto|portafolio/i.test(n));
      if (iS < 0) iS = nombres.length - 1;
      const sumativa = nombres[iS];
      const formativas = nombres.filter((_, i) => i !== iS).slice(0, 2);
      const inds = (unidad.indicadores_logro || []).map(x => limpio(x).replace(/^Indicador de Logro\s*\d+\s*:\s*/i, ''));
      const mitad = Math.ceil(inds.length / 2);
      const objetivo = (grupo, estrategia) => 'Verificar que el estudiante ' + grupo.map(minus).join('; ').replace(/\.\s*;/g, ';').replace(/\.$/, '') + ', mediante ' + minus(estrategia);
      evaluacion = {
        formativas: formativas.map((n, k) => ({ estrategia: n, mecanismo: n, descripcion: objetivo(k === 0 ? inds.slice(0, mitad) : inds.slice(mitad), n), indicadores: [] })),
        sumativas: [{ estrategia: sumativa, mecanismo: sumativa, descripcion: objetivo(inds, sumativa), indicadores: [] }]
      };
      avisos.push('Estrategias evaluativas: el Syllabus las lista sin estrategia/mecanismo/descripción; formativas = ' + formativas.join(' y ') + '; sumativa = ' + sumativa + '. El mecanismo repite el nombre de la estrategia y el objetivo sale de los indicadores de logro.');
    }
  }

  const sinExtractos = temas.flatMap((t, ti) => t.subtemas.filter(s => !s.extractos.length).map(s => 'tema ' + (ti + 1) + ': ' + s.nombre));

  return {
    json: {
      ...j,
      bibliografia_origen: 'plataforma (leída y verificada)',
      subtemas_sin_extractos: sinExtractos,
      avisos_extraccion: avisos,
      unidad: {
        ...unidad,
        temas,
        ensenanza,
        evaluacion_syllabus: evaluacion,
        bibliografia: {
          basica: { raw: '(enviada por la plataforma)', entradas: basica },
          complementaria: { raw: '(enviada por la plataforma)', entradas: complementaria }
        }
      }
    },
    pairedItem: { item: i }
  };
});
