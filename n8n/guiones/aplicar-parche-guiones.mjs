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
- Si ningún extracto cubre exactamente una idea del subtema, usa el pasaje más cercano de cualquier entrada: no la inventes y no dejes el campo vacío; indica en \`sustento\` de qué pasaje (ID y página) sale.
- Solo puedes usar en \`fuentes_ids\` y \`sustento\` IDs que existan en \`bibliografia.entradas\`. Nunca escribas autores, años, títulos ni DOI de memoria.
- \`sustento\`: una frase que diga qué extracto respalda el recurso, por ejemplo "U2-B1, p. 14: define X, que corresponde al subtema Y".
- Cada recurso cita al menos una fuente si \`bibliografia.disponible\` es true (prefiere las básicas y las que traen extractos sobre el tema). Si es false: \`fuentes_ids\` vacío y \`sustento\` = "Sin bibliografía disponible".
- SIN CITAS EN EL CONTENIDO: en ningún campo del recurso (contenido, textos en pantalla, actividad, preguntas, retroalimentación, complementos) escribas citas en el texto, (Autor, año, p. N), IDs (U1-B2), líneas "Fuentes:" ni "Referencias:", ni nombres de autores o títulos de las fuentes como atribución. El procedencia y las referencias las reúne el sistema en una tabla al final del documento.
- \`sustento\` y \`fuentes_ids\` SÍ se llenan siempre (de ahí sale esa tabla), \`sustento\` con la página: "U1-B2, p. 14: …".
- No inventes cifras, fechas, normas, nombres propios ni estudios. Los ejemplos con datos se presentan como hipotéticos ("imaginemos…").
`
  m[i].message = texto.slice(0, ini) + nueva + (fin >= 0 ? texto.slice(fin) : '')
}

// ---- 4b) «Armar guion»: cada actividad termina con las fuentes de las que salió; el nivel de verificación refleja que sí se leyó.
{
  let c = por['Armar guion'].parameters.jsCode
  const ini = c.indexOf("const textoActividad = r.tipo === 'OVA'")
  const fin = c.indexOf(": '';", ini)
  if (ini < 0 || fin < 0) throw new Error('«textoActividad» no encontrado')
  // Cita APA 7 en el texto (Autor, año, p. N) + referencia completa UNA sola vez; los IDs internos no se muestran.
  const cita = String.raw`const citaActividad = () => {
      const ids = b.fuentes || [];
      if (!ids.length) return '\nFuentes: ninguna fuente de la bibliografía respalda esta actividad.';
      const sus = String(b.sustento || '');
      // Páginas de cada fuente: el tramo del sustento que sigue a su ID, hasta el ID siguiente.
      const paginasDe = id => {
        const pos = sus.indexOf(id);
        if (pos < 0) return [];
        const resto = sus.slice(pos + id.length);
        const sig = resto.search(/U\d+-[BC]\d+/);
        const tramo = sig >= 0 ? resto.slice(0, sig) : resto;
        const m = /\bpp?\.\s*([\d\s,;y\-–p.]+)/i.exec(tramo);
        return m ? [...new Set((m[1].match(/\d+/g) || []).map(Number))] : [];
      };
      const citas = ids.map(id => {
        let c = String(porId[id].cita_apa || '').trim();
        const pg = paginasDe(id);
        if (c && pg.length) c = c.replace(/\)\s*$/, '') + ', ' + (pg.length > 1 ? 'pp. ' : 'p. ') + pg.join(', ') + ')';
        return c;
      }).filter(Boolean);
      const apoyo = sus.replace(/\[?\bU\d+-[BC]\d+\b\]?,?\s*/g, '').replace(/\bpp?\.\s*[\d\s,;y\-–]+:?\s*/gi, '').replace(/^[\s,;:.]+/, '').trim();
      return '\nFuentes: ' + (citas.length ? citas.join('; ') + '.' : '') + (apoyo ? ' ' + apoyo.charAt(0).toUpperCase() + apoyo.slice(1) : '') + '\nReferencias: ' + ids.map(id => porId[id].texto).join(' ');
    };` + '\n    '
  const cuerpo = c.slice(ini, fin).replace(".trim()\n      ", ".trim() + citaActividad()\n      ")
  if (!cuerpo.includes('+ citaActividad()')) throw new Error('no se pudo añadir la cita a la actividad')
  // Las citas ya NO van en el contenido: todo se reúne en la tabla final de procedencia y referencias.
  void cita
  const sinCita = String.raw`const citaActividad = () => '';` + '\n    '
  c = c.slice(0, ini) + sinCita + cuerpo + c.slice(fin)
  const nv = /const NIVEL_VERIFICACION =\s*'[^']*' \+\s*'[^']*';/
  if (!nv.test(c)) throw new Error('NIVEL_VERIFICACION no encontrado')
  c = c.replace(nv, () => "const NIVEL_VERIFICACION =\n  'Respaldo en texto leído: el contenido se escribió con los fragmentos de la bibliografía que leyó la plataforma. ' +\n  'Una persona debe confirmar que cada recurso refleja fielmente los extractos citados.';")
  por['Armar guion'].parameters.jsCode = c
}

// ---- 4c) «Corregir elemento individual» y «Adaptar a plantilla del nivel»: misma regla (solo los extractos; la cita de la actividad se conserva).
{
  const reglaCorregir = '\n\n## FUENTES AL CORREGIR (obligatorio)\n- Al corregir, escriba SOLO con lo que dicen los `extractos` de `contexto.bibliografia.entradas` y con el insumo; no agregue datos, definiciones ni citas de otra parte. Si un extracto no cubre exactamente la idea, use el pasaje más cercano de cualquier entrada: no deje campos vacíos ni los quite.\n- No escriba citas en el texto, IDs, ni líneas "Fuentes:"/"Referencias:" dentro del contenido: la procedencia va solo en la tabla final.\n- No cambie ni quite `fuentes_ids` válidos; si agrega contenido, cite el ID del extracto del que sale.'
  const mc = por['Corregir elemento individual'].parameters.messages.messageValues
  mc[0].message = String(mc[0].message) + reglaCorregir
  const reglaAdaptar = '\n9. Sin citas: no escriba citas en el texto (Autor, año, p. N), IDs, ni líneas "Fuentes:"/"Referencias:" en ningún campo; la procedencia va en la tabla final. No agregue contenido que no esté en el guion.'
  const ma = por['Adaptar a plantilla del nivel'].parameters.messages.messageValues
  const j = ma.findIndex((x) => String(x.message).includes('7. Actividad:'))
  if (j < 0) throw new Error('regla 7 de «Adaptar» no encontrada')
  const t = String(ma[j].message)
  const k = t.indexOf('\n8. Presentación')
  if (k < 0) throw new Error('regla 8 de «Adaptar» no encontrada')
  ma[j].message = t.slice(0, k) + reglaAdaptar + t.slice(k)
}

// ---- 4d) «Auditar borrador»: comprueba que lo escrito use de verdad la bibliografía enviada.
//  - reemplaza la regla antigua (prohibía autor-año) por la de APA 7 en el texto;
//  - exige cita (Autor, año, p. N) en el contenido cuando el recurso declara fuentes;
//  - las páginas citadas deben existir en los extractos leídos de las fuentes que el recurso declara.
{
  let c = por['Auditar borrador'].parameters.jsCode
  const ini = c.indexOf('comprobarFuentes(rec.fuentes_ids, etiqueta, true);')
  const marca = "'contenido,complementos');\n    }"
  const fin = c.indexOf(marca, ini)
  if (ini < 0 || fin < 0) throw new Error('bloque de citas de «Auditar borrador» no encontrado')
  const nuevo = String.raw`comprobarFuentes(rec.fuentes_ids, etiqueta, true);
    {
      const RE_CITA = /\([^()]{2,120}?\b(?:19|20)\d{2}[a-z]?(?:,\s*pp?\.\s*\d+(?:\s*[-–]\s*\d+)?)?\)/;
      const entradasBib = Array.isArray(biblio.entradas) ? biblio.entradas : [];
      const textoCitable = [contenido, visiblesJuntos, complementos, actividad].join(' ');
      if (false && RE_CITA && textoCitable) {   // ya no se exigen citas en el contenido
        error(tema, etiqueta + ': el contenido no trae citas APA 7 en el texto (Autor, año, p. N). Cada idea tomada de un extracto termina con la cita de su fuente (campo cita_apa de la entrada más la página del extracto), por ejemplo (OECD, 2025, p. 18).', 'contenido,actividad_desarrollo');
      }
      const permitidas = new Set();
      (rec.fuentes_ids || []).forEach(id => { const e = entradasBib.find(x => x.id === id); ((e && e.extractos) || []).forEach(x => permitidas.add(Number(x.pagina))); });
      const paginasCitadas = [];   // sin citas en el contenido, no hay páginas que comprobar
      const noLeidas = [...new Set(paginasCitadas.filter(n => permitidas.size && !permitidas.has(n)))];
      if (noLeidas.length) {
        error(tema, etiqueta + ': cita páginas que no están en los extractos leídos de sus fuentes (' + noLeidas.join(', ') + '); cite solo páginas de los extractos de contexto.bibliografia.entradas.', 'contenido,actividad_desarrollo,sustento');
      }
    }`
  c = c.slice(0, ini) + nuevo + c.slice(fin + marca.length)
  por['Auditar borrador'].parameters.jsCode = c
}

// ---- 4e) MODO EXTRACTIVO: OpenAI no redacta; solo organiza el texto que llega (extractos de la bibliografía y el insumo).
{
  const EXTRACTIVO = [
    '## MODO EXTRACTIVO (manda sobre cualquier otra instrucción de este mensaje)',
    '- Usted NO redacta contenido: solo ORGANIZA y distribuye texto que ya llega. Las únicas fuentes de texto son (1) los `extractos` de `bibliografia.entradas` y (2) el insumo (nombres, subtemas, enunciados de actividad, datos de la asignatura).',
    '- Todo texto de contenido (explicaciones, narración, párrafos, textos en pantalla, casos, ejemplos, preguntas, opciones y retroalimentación) se COPIA de los extractos, literal o con recortes mínimos (quitar palabras, unir con signos de puntuación). No parafrasee, no complete ideas y no agregue ejemplos, metáforas, casos, historias, cifras ni transiciones propias. Esto reemplaza cualquier instrucción de este mensaje que pida redactar, imaginar, inventar casos ilustrativos o escribir ejemplos.',
    '- Los rótulos y etiquetas que exige la estructura («Pregunta 1:», «Materiales:», «Título:», etc.) son marcas de organización y sí se escriben.',
    '- Los campos de indicación de producción (visual, descripción) solo describen cómo se dispone el texto ya elegido; no agregan contenido nuevo.',
    '- NINGÚN campo puede quedar vacío ni con avisos tipo «sin información». Cada campo, tabla, elemento, pregunta, opción y retroalimentación se resuelve con fragmentos de los extractos: busque en TODAS las entradas y páginas el pasaje más cercano al subtema y al rol del campo, y use ese texto. Un mismo pasaje puede usarse en varios campos con recortes distintos.',
    '- Para lo que no tiene un equivalente literal: un título sale del encabezado o de la primera oración de un pasaje; una pregunta se forma recortando una afirmación del extracto y convirtiéndola en pregunta con las mismas palabras; la opción correcta es esa misma afirmación; las opciones incorrectas son afirmaciones copiadas de OTROS pasajes de los extractos que corresponden a otro concepto; la retroalimentación es el pasaje que sustenta la respuesta. Un caso o ejemplo es un pasaje del extracto que describa una situación o aplicación.',
    '- IDIOMA: todo el guion se escribe en español. Si un extracto está en otro idioma (por ejemplo inglés), TRADÚZCALO fielmente al español, oración por oración, sin añadir, quitar ni cambiar ideas; nunca deje texto en otro idioma.',
    '- Fechas, periodos, siglos, cifras, nombres de corrientes o autores: solo los que aparezcan en los extractos. Si el formato pide una fecha o periodo y los extractos no traen uno, use como rótulo el tema o la página del pasaje (por ejemplo «Pasaje de la p. 18»), nunca un dato inventado. Los ejemplos («por ejemplo, en una comunidad rural…») son contenido: solo valen si el extracto los trae.',
    '- NO escriba citas en el texto, IDs ni líneas «Fuentes:»/«Referencias:» en el contenido: la procedencia se reúne en una tabla final. Sí llene `fuentes_ids` y, en `sustento`, por fuente: «U1-B1, p. 18, 53: …; U1-B2, p. 2: …» (ID, páginas y dos puntos).',
    '- Las cantidades y longitudes de la hoja se cumplen reutilizando y recortando pasajes de los extractos; no se acepta dejar un campo vacío por falta de texto.',
    ''
  ].join('\n')
  const EXTRACTIVO_ADAPTAR = [
    '## MODO EXTRACTIVO (manda sobre cualquier otra instrucción de este mensaje)',
    '- Usted NO redacta: solo REUBICA el texto que ya trae `contenido_generado` en los campos y tablas del bloque. No escriba oraciones nuevas, no parafrasee ni agregue datos.',
    '- Puede recortar para respetar un límite (quitar palabras) y unir fragmentos; no puede completar ideas. Esto reemplaza las reglas de este mensaje que piden redactar o completar un campo sin equivalente (por ejemplo la regla 5).',
    '- Ningún campo puede quedar vacío: si un campo no tiene equivalente exacto, resuélvalo con el fragmento más cercano del propio `contenido_generado` (recortado o repetido), nunca con texto nuevo. Los rótulos de la estructura sí se escriben.',
    ''
  ].join('\n')
  const antepone = (nodo, texto) => {
    const mv = por[nodo].parameters.messages.messageValues
    mv[0].message = texto + '\n' + String(mv[0].message)
  }
  antepone('Generar guion', EXTRACTIVO)
  antepone('Corregir elemento individual', EXTRACTIVO)
  antepone('Adaptar a plantilla del nivel', EXTRACTIVO_ADAPTAR)

  // «Auditar borrador»: el texto del recurso debe salir en su mayoría de los extractos (huellas de 5 palabras seguidas).
  let c = por['Auditar borrador'].parameters.jsCode
  const ancla = "'contenido,actividad_desarrollo,sustento');\n      }\n    }"
  const pos = c.indexOf(ancla)
  if (pos < 0) throw new Error('ancla de la auditoría de páginas no encontrada')
  const nuevo = String.raw`
    {
      const UMBRAL_LITERAL = 0.5;   // proporción mínima del texto que debe salir de los extractos
      const VENTANA = 5;            // palabras seguidas que cuentan como «copiadas»
      const nz = s => limpio(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim().split(' ').filter(Boolean);
      const entradasEx = Array.isArray(biblio.entradas) ? biblio.entradas : [];
      const declaradas = rec.fuentes_ids || [];
      const huellas = new Set();
      entradasEx.filter(e => !declaradas.length || declaradas.includes(e.id)).forEach(e => (e.extractos || []).forEach(x => {
        const w = nz(x.texto);
        for (let i = 0; i + VENTANA <= w.length; i++) huellas.add(w.slice(i, i + VENTANA).join(' '));
      }));
      const analizado = (Array.isArray(secs) ? secs.map(s => limpio(s && s.texto) + ' ' + limpio(s && s.texto_visible)).join(' ') : '') + ' ' + actividad + ' ' + complementos;
      const pal = nz(analizado);
      // Con extractos en otro idioma el guion es una traducción: la comparación palabra por palabra no aplica.
      const vacias = new Set(['de', 'la', 'que', 'el', 'en', 'los', 'las', 'por', 'con', 'para', 'una', 'del', 'se', 'y']);
      const palBase = [...entradasEx].flatMap(e => (e.extractos || []).flatMap(x => nz(x.texto)));
      const esEspanol = palBase.length ? palBase.filter(w => vacias.has(w)).length / palBase.length > 0.2 : true;
      if (esEspanol && huellas.size && pal.length >= VENTANA * 3) {
        let total = 0, copiadas = 0;
        for (let i = 0; i + VENTANA <= pal.length; i++) { total++; if (huellas.has(pal.slice(i, i + VENTANA).join(' '))) copiadas++; }
        const prop = total ? copiadas / total : 1;
        if (prop < UMBRAL_LITERAL) {
          error(tema, etiqueta + ': solo el ' + Math.round(prop * 100) + '% del texto sale de los extractos leídos (se pide al menos ' + Math.round(UMBRAL_LITERAL * 100) + '%). Reemplace lo escrito por fragmentos copiados de los extractos de contexto.bibliografia.entradas: el modelo solo organiza, no redacta. Si un campo no tiene texto exacto, use el pasaje más cercano de cualquier extracto; no lo deje vacío.', 'contenido,actividad_desarrollo');
        }
      }
    }`
  c = c.slice(0, pos + ancla.length) + nuevo + c.slice(pos + ancla.length)
  por['Auditar borrador'].parameters.jsCode = c
}

// ---- 4f) «Reunir campos de plantilla»: la línea «Fuentes / Referencias» de la actividad se escribe por código, no depende del modelo.
{
  let c = por['Reunir campos de plantilla'].parameters.jsCode
  const ancla = '  // Aviso: la actividad no debe mandar al estudiante a recursos externos'
  if (!c.includes(ancla)) throw new Error('ancla de «Reunir campos de plantilla» no encontrada')
  const nuevo = String.raw`  // La cita de la actividad (Fuentes + Referencias) la armó «Armar guion» al final de la actividad: se coloca al final del último campo
  // de actividad del bloque, y se retira de donde el modelo la haya dejado (por ejemplo pegada a la descripción).
  // Ya NO se agrega la cita al contenido: además se retira cualquier cita en el texto, ID o línea «Fuentes/Referencias» que haya quedado.
  {
    const RE_CITA_TEXTO = /\s*\((?:[^()]{2,120}?),\s*(?:19|20)\d{2}[a-z]?(?:,\s*pp?\.\s*[\d\s,;y\-–]+)?\)/g;
    for (const m of Object.keys(t.relleno.campos)) {
      if (typeof t.relleno.campos[m] !== 'string') continue;
      t.relleno.campos[m] = t.relleno.campos[m]
        .replace(/\s*(?:Fuentes?|Referencias?):[\s\S]*$/, '')
        .replace(RE_CITA_TEXTO, '')
        .replace(/\s*\[?\bU\d+-[BC]\d+\b\]?/g, '')
        .trim();
    }
  }

`
  c = c.replace(ancla, () => nuevo + ancla)
  por['Reunir campos de plantilla'].parameters.jsCode = c
}

// ---- 4g) Velocidad: las correcciones reciben una bibliografía compacta (tope por fuente), no los 40 000 caracteres completos de cada llamada.
{
  let c = por['Preparar ajustes individuales'].parameters.jsCode
  const viejo = 'const contextoBase = { programa: base.general, unidad: base.unidad, tema: base.tema, bibliografia: base.bibliografia };'
  if (!c.includes(viejo)) throw new Error('contextoBase de «Preparar ajustes individuales» no encontrado')
  const nuevo = String.raw`const MAX_CARACTERES_CORRECCION = 24000;   // tope de texto de la bibliografía en cada corrección
  const bibCompacta = bib => {
    const entradas = (bib && bib.entradas) || [];
    const porFuente = Math.floor(MAX_CARACTERES_CORRECCION / Math.max(1, entradas.length));
    return { ...bib, entradas: entradas.map(e => { let usado = 0; return { ...e, extractos: (e.extractos || []).filter(x => { const n = String(x.texto || '').length; if (usado + n > porFuente) return false; usado += n; return true; }) }; }) };
  };
  const contextoBase = { programa: base.general, unidad: base.unidad, tema: base.tema, bibliografia: bibCompacta(base.bibliografia) };`
  c = c.replace(viejo, () => nuevo)
  por['Preparar ajustes individuales'].parameters.jsCode = c
}

// ---- 4h) Recuadro final del documento: de dónde salió la información de cada recurso + referencias de la unidad.
// Se arma por código con lo que ya sabe «Armar guion» (fuentes, páginas y sustento de cada recurso): así es exacto y no gasta tiempo de OpenAI.
{
  let c = por['Preparar relleno del guion'].parameters.jsCode
  const ancla = '  // ---- anexo al final (va primero'
  if (!c.includes(ancla)) throw new Error('ancla del anexo en «Preparar relleno del guion» no encontrada')
  const nuevo = String.raw`  // ---- recuadro final: procedencia de la información por recurso + referencias de la unidad ----
  // Va antes del anexo en el código porque todo se inserta en el mismo índice (el final): lo que se inserta primero queda más abajo.
  {
    const jt = (($('Armar guion').all()[i] || {}).json) || {};
    const gu = jt.guion || {};
    const bib = ((jt.registro || {}).bibliografia) || [];
    const porIdB = Object.fromEntries(bib.map(e => [e.id, e]));
    const paginasDe = (sus, id) => {
      const pos = String(sus || '').indexOf(id);
      if (pos < 0) return [];
      const resto = String(sus).slice(pos + id.length);
      const sig = resto.search(/U\d+-[BC]\d+/);
      const m = /\bpp?\.\s*([\d\s,;y\-–p.]+)/i.exec(sig >= 0 ? resto.slice(0, sig) : resto);
      return m ? [...new Set((m[1].match(/\d+/g) || []).map(Number))] : [];
    };
    const citaDe = (id, sus) => {
      const e = porIdB[id];
      if (!e) return '';
      const pg = paginasDe(sus, id);
      const base = String(e.cita_apa || '').trim() || String(e.texto || '').split('.')[0];
      return pg.length ? base.replace(/\)\s*$/, '') + ', ' + (pg.length > 1 ? 'pp. ' : 'p. ') + pg.join(', ') + ')' : base;
    };
    const quitarMarcas = s => String(s || '').replace(/\[?\bU\d+-[BC]\d+\b\]?,?\s*/g, '').replace(/\bpp?\.\s*[\d\s,;y\-–]+:?\s*/gi, '').replace(/^[\s,;:.]+/, '').trim();
    const trazaPres = ((jt.registro || {}).trazabilidad || []).find(x => x.marcador === '<<CONTENIDO_DEL_RECURSO>>' && x.origen === 'generado');
    // Tiempo por recurso: las horas AD (acompañamiento directo) y EI (estudio independiente) de cada subtema del Syllabus se reparten entre los
    // recursos que lo cubren; el recurso con actividad pesa 1,5 veces el que no la tiene. Se redondea a 5 minutos. Lo calcula el código, no OpenAI.
    const subsT = (((($('Armar estructura RED').all()[i] || {}).json || {}).tema) || {}).horas_subtemas || [];
    const normT = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^\s*\d+(?:\.\d+)*\.?\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const PESO_T = r => (r.tipo === 'OVA' ? 1.5 : 1);
    const tiempos = {};
    subsT.forEach(s => {
      const quien = (gu.recursos || []).filter(r => (r.subtemas_que_cubre || []).some(n => normT(n) === normT(s.nombre)));
      const tot = quien.reduce((a, r) => a + PESO_T(r), 0);
      if (!tot) return;
      quien.forEach(r => { const t = tiempos[r.posicion] = tiempos[r.posicion] || { ad: 0, ei: 0 }; t.ad += s.ad * 60 * PESO_T(r) / tot; t.ei += s.ei * 60 * PESO_T(r) / tot; });
    });
    const a5 = m => (m > 0 ? Math.max(5, Math.round(m / 5) * 5) : 0);
    // La duración también va dentro de cada recurso, en la ficha (debajo del subtema), para que se vea junto al recurso.
    for (const [idB, b] of Object.entries(bloques)) {
      const t = b && b.origen === 'recurso' ? tiempos[b.posicion] : null;
      const m = 'R' + idB + '_SUBTEMA';
      if (t && typeof valores[m] === 'string') valores[m] = valores[m] + '\nDuración estimada: ' + a5(t.ad) + ' min con acompañamiento directo y ' + a5(t.ei) + ' min de estudio independiente (total ' + (a5(t.ad) + a5(t.ei)) + ' min).';
    }
    const grupos = [];
    if (gu.presentacion && trazaPres) grupos.push({ rotulo: 'Presentación', nombre: 'Presentación de la asignatura', ids: gu.presentacion.fuentes_ids || [], sus: trazaPres.sustento });
    (gu.recursos || []).forEach(r => grupos.push({ rotulo: 'Recurso ' + r.posicion, nombre: (tituloUnidad(r.posicion) || r.titulo || '') + (r.formato ? ' (' + r.formato + ')' : ''), ids: r.fuentes_ids || [], sus: r.sustento, tiempo: tiempos[r.posicion] || null }));
    const filasP = [{ campo: 'Procedencia de la información por recurso', valor: '', tipo: 'banda' }];
    grupos.forEach(g => {
      filasP.push({ campo: g.rotulo, valor: g.nombre, tipo: 'elemento' });
      if (g.tiempo) filasP.push({ campo: 'Duración estimada', valor: 'Acompañamiento directo: ' + a5(g.tiempo.ad) + ' min. Estudio independiente: ' + a5(g.tiempo.ei) + ' min. Total: ' + (a5(g.tiempo.ad) + a5(g.tiempo.ei)) + ' min.', tipo: 'campo' });
      const citas = g.ids.map(id => citaDe(id, g.sus)).filter(Boolean);
      filasP.push({ campo: 'Fuentes y páginas', valor: citas.length ? citas.join('; ') : 'Ninguna fuente de la bibliografía leída respalda este recurso.', tipo: 'campo' });
      const apoyo = quitarMarcas(g.sus);
      if (apoyo) filasP.push({ campo: 'Qué se tomó de la fuente', valor: apoyo.charAt(0).toUpperCase() + apoyo.slice(1), tipo: 'campo' });
    });
    if (subsT.length) {
      const sAd = subsT.reduce((a, s) => a + s.ad, 0), sEi = subsT.reduce((a, s) => a + s.ei, 0);
      filasP.push({ campo: 'Tiempo del tema según el Syllabus', valor: '', tipo: 'banda' });
      filasP.push({ campo: 'Total del tema', valor: 'Acompañamiento directo: ' + sAd + ' h. Estudio independiente: ' + sEi + ' h. Total: ' + (sAd + sEi) + ' h. La duración de cada recurso reparte esas horas entre los recursos de cada subtema (la actividad cuenta 1,5 veces).', tipo: 'campo' });
    }
    if (bib.length) {
      filasP.push({ campo: 'Referencias de la unidad (APA 7)', valor: '', tipo: 'banda' });
      bib.forEach((e, n) => filasP.push({ campo: 'Referencia ' + (n + 1), valor: String(e.texto || '') + '\n' + ((e.citada_en || []).length ? 'Usada en: ' + e.citada_en.join('; ') : 'No se citó en el guion de este tema.'), tipo: 'campo' }));
    }
    const p0 = contenido.length ? contenido[contenido.length - 1].endIndex - 1 : null;
    if (p0 !== null && grupos.length) {
      const tituloP = '\nProcedencia de la información y referencias';
      escribirTablaEn(primeros, filasP, p0);
      primeros.push({ insertText: { location: { index: p0 }, text: tituloP } });
      primeros.push(estilo(p0 + 1, p0 + tituloP.length, false, 10));
      primeros.push({ updateParagraphStyle: { range: { startIndex: p0 + 1, endIndex: p0 + tituloP.length }, paragraphStyle: { namedStyleType: 'HEADING_1', spaceBelow: { magnitude: 4, unit: 'PT' }, keepWithNext: true }, fields: 'namedStyleType,spaceBelow,keepWithNext' } });
      primeros.push({ updateTextStyle: { range: { startIndex: p0 + 1, endIndex: p0 + tituloP.length }, textStyle: { bold: true, foregroundColor: { color: { rgbColor: AZUL_OSCURO } }, fontSize: { magnitude: 15, unit: 'PT' }, weightedFontFamily: { fontFamily: 'Arial' } }, fields: 'bold,foregroundColor,fontSize,weightedFontFamily' } });
    }
  }

`
  c = c.replace(ancla, () => nuevo + ancla)
  por['Preparar relleno del guion'].parameters.jsCode = c
}

// ---- 4i) Sin sección «Referencias» dentro de cada recurso: todas van en la tabla final del documento.
// «Preparar estructura del guion» borra de la plantilla la banda «N. Referencias» y su fila «Referencia (APA 7)».
{
  let c = por['Preparar estructura del guion'].parameters.jsCode
  const ancla = '    filasBorradas.forEach(r => filaOps.push({ r, req: { deleteTableRow: celda(r) } }));'
  if (!c.includes(ancla)) throw new Error('ancla de filas borradas no encontrada en «Preparar estructura del guion»')
  const nuevo = String.raw`    // Las referencias no van dentro del recurso: se quitan la fila de la referencia y la banda «N. Referencias» que la antecede.
    for (const [tid, def] of Object.entries(tablas_plantilla)) {
      if (!/_REFERENCIAS$/.test(tid)) continue;
      def.columnas.forEach(mk => {
        const r = filas.findIndex(t => t.includes('<<' + mk + '>>'));
        if (r >= 0) filasBorradas.add(r);
      });
      const r0 = filas.findIndex(t => t.includes('<<' + def.columnas[0] + '>>'));
      for (let q = r0 - 1; q >= 0 && q >= r0 - 3; q--) {
        if (/^\s*(?:\d+\.\s*)?Referencias?\b/i.test(filas[q]) && !/<<R\d{2}_/.test(filas[q])) { filasBorradas.add(q); break; }
      }
    }
`
  c = c.replace(ancla, () => nuevo + ancla)
  por['Preparar estructura del guion'].parameters.jsCode = c
}

// ---- 4j) «Extraer unidad»: además de las horas por tema, se guardan las horas AD y EI de cada subtema del Syllabus.
{
  let c = por['Extraer unidad'].parameters.jsCode
  const r1 = "actual = { nombre: aplanar(c[0]), horas: 0 };"
  const r2 = "actual.horas += (parseFloat(aplanar(c[2])) || 0) + (parseFloat(aplanar(c[3])) || 0);"
  const r3 = "        horas_nota: horasNota,\n"
  for (const x of [r1, r2, r3]) if (!c.includes(x)) throw new Error('no se halló en «Extraer unidad»: ' + x)
  c = c.replace(r1, () => "actual = { nombre: aplanar(c[0]), horas: 0, subs: [] };")
  c = c.replace(r2, () => r2 + "\n      actual.subs.push({ nombre: aplanar(c[1]), ad: parseFloat(aplanar(c[2])) || 0, ei: parseFloat(aplanar(c[3])) || 0 });")
  c = c.replace(r3, () => r3 + "        horas_subtemas: ((((syllabus.horas_temas || []).find(x => norm(x.nombre) === norm(t.nombre))) || (syllabus.horas_temas || [])[idx] || {}).subs) || [],\n")
  por['Extraer unidad'].parameters.jsCode = c
}

// ---- 5) Nombre y archivo de salida.
const salida = {
  name: 'Unidad a guiones · con bibliografía leída (copia)',
  nodes: nodos,
  connections: Object.fromEntries(Object.entries(C).filter(([k]) => guardar.has(k)).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([tipo, filas]) => [tipo, (filas || []).map((r) => (r || []).filter((x) => guardar.has(x.node)))]))])),
  settings: orig.settings || { executionOrder: 'v1' },
  pinData: {}
}

// ---- 5b) Sin agente «Corregir»: el ciclo de corrección se apaga (cero rondas) y se quitan sus 4 nodos.
// Lo que la auditoría no apruebe sale como «pendiente»; la longitud la sigue ajustando el subflujo.
{
  for (const nombre of ['Auditar borrador', 'Auditar gancho de micro-learning']) {
    const c = por[nombre].parameters.jsCode
    if (!c.includes('const MAX_RONDAS = 3;')) throw new Error('MAX_RONDAS no encontrado en ' + nombre)
    por[nombre].parameters.jsCode = c.replace('const MAX_RONDAS = 3;', 'const MAX_RONDAS = 0;   // sin agente de corrección: lo pendiente se informa')
  }
  const quitar = new Set(['Preparar ajustes individuales', 'Corregir elemento individual', 'Esquema de correccion individual', 'Aplicar ajustes individuales'])
  salida.nodes = salida.nodes.filter((n) => !quitar.has(n.name))
  for (const k of quitar) delete salida.connections[k]
  for (const [o, tipos] of Object.entries(salida.connections)) {
    for (const [tipo, filas] of Object.entries(tipos)) tipos[tipo] = filas.map((r) => r.filter((x) => !quitar.has(x.node)))
  }
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
