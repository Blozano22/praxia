// Nodo Code: «Armar contenido desde la bibliografía» · Modo: Run Once for All Items
// Sustituye a «Generar contenido» (el modelo de OpenAI): YA NO SE GENERA CONTENIDO. Todo sale de dos fuentes:
//   · el Syllabus (nombres de unidad, temas, subtemas, evaluaciones literales, formatos RED y actividades asignados), y
//   · los extractos de la bibliografía que leyó la plataforma (cada uno con su fuente y su página).
// Devuelve el mismo formato que antes producía el modelo, para que «Armar salida» siga igual: { output: {...} }.

const ORDINALES = ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena', 'décima'];
const ORDEN = [['OVI', 1], ['OVA', 1], ['OVI', 2], ['OVA', 2], ['OVI', 3], ['OVA', 3]];

const limpio = s => String(s || '').replace(/\s+/g, ' ').trim();
const sinNumero = s => limpio(s).replace(/^\d+(?:\.\d+)*\s*[.)\-–]?\s*/, '');
const sinPunto = s => limpio(s).replace(/[\s.;:,]+$/, '');
const minuscula = s => (s && s.length > 1 && s !== s.toUpperCase() ? s.charAt(0).toLocaleLowerCase('es') + s.slice(1) : s);
const norm = s => limpio(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const claves = s => [...new Set(norm(s).split(/[^a-z0-9ñ]+/).filter(w => w.length > 3))];
const lista = a => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]);

// Primera frase del extracto que menciona el tema (o, si ninguna, la primera frase completa). Es texto literal de la fuente.
function fraseDe(texto, palabras) {
  const frases = limpio(texto).split(/(?<=[.!?])\s+/).filter(f => f.length >= 40 && f.length <= 320);
  const con = frases.find(f => palabras.some(w => norm(f).includes(w)));
  return con || frases[0] || limpio(texto).slice(0, 220);
}
const citaDe = x => ({ id: x.id, pagina: Number(x.pagina) });

return $input.all().map((item, idx) => {
  const j = item.json;
  const u = j.unidad;
  const g = j.general || {};
  const temas = u.temas || [];

  // ---- temas y recursos ----
  const salidaTemas = temas.map((tema, ti) => {
    const subtemas = tema.subtemas || [];
    const cobertura = tema.cobertura_recursos || {};
    const vistos = {}; // veces que ya se usó un subtema: la 1.ª vez el OVI, la 2.ª el OVA
    const recursos = ORDEN.map(([tipo, indice]) => {
      const clave = tipo + indice;
      const idxs = (cobertura[clave] && cobertura[clave].indices) || [];
      const sub = subtemas[idxs[0]] || {};
      const nombreSub = sinPunto(sinNumero(sub.nombre || tema.nombre));
      const veces = (vistos[idxs[0]] = (vistos[idxs[0]] || 0) + 1);
      const extractos = sub.extractos || [];
      const usado = extractos[Math.min(veces - 1, Math.max(extractos.length - 1, 0))] || extractos[0];
      const citas = usado ? [citaDe(usado)] : [];
      const asignada = tema.actividades_autoaprendizaje && tema.actividades_autoaprendizaje['OVA' + indice];
      const frase = usado ? fraseDe(usado.texto, claves(nombreSub)) : '';
      return {
        tipo, indice,
        // OVI: el subtema tal como lo nombra el Syllabus. OVA: su aplicación (misma materia, otra mirada).
        nombre: tipo === 'OVI' ? nombreSub : 'Aplicación de ' + minuscula(nombreSub),
        actividad: tipo === 'OVA' && asignada ? asignada.red + ' sobre ' + minuscula(nombreSub) : '',
        tipo_actividad: tipo === 'OVA' && asignada ? asignada.red : '',
        fuentes_ids: [...new Set(citas.map(c => c.id))],
        citas,
        sustento: usado ? 'Extracto de ' + usado.id + ' (p. ' + usado.pagina + '): «' + frase + '»' : 'Sin extractos de la bibliografía para este subtema; el título sale del Syllabus.'
      };
    });
    // Semanas: la unidad se reparte en cuatro bloques iguales de dos semanas (8 semanas).
    return { numero: ti + 1, semana: ((ti * 2) + 1) + '-' + ((ti * 2) + 2), recursos };
  });

  // ---- descripción: Syllabus + una frase literal de la fuente mejor respaldada ----
  const nombreUnidad = sinPunto(u.nombre);
  const nombresTemas = temas.map(t => sinPunto(sinNumero(t.nombre))).map(minuscula);
  const todos = temas.flatMap(t => (t.subtemas || []).flatMap(s => s.extractos || []));
  const mejor = todos[0];
  const justif = limpio(g.justificacion || '').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  const citasDesc = mejor ? [citaDe(mejor)] : [];
  const descTexto = [
    'La unidad ' + u.numero + ', «' + nombreUnidad + '», aborda ' + lista(nombresTemas) + '.',
    justif,
    mejor ? 'Las fuentes de la unidad lo desarrollan así: «' + fraseDe(mejor.texto, claves(nombreUnidad)) + '»' : ''
  ].filter(Boolean).join(' ');

  // ---- evaluaciones: la descripción literal que declara el Syllabus ----
  const asig = u.evaluaciones_asignadas || {};
  const plan = [(asig.formativas || [])[0], (asig.formativas || [])[1], asig.sumativa];
  const evaluaciones = plan.map((ev, k) => ({
    tipo: k === 2 ? 'Sumativa' : 'Formativa',
    objetivo: ev ? sinPunto(ev.descripcion || ev.estrategia) : '',
    fuentes_ids: []
  }));

  // ---- presentación de la unidad: plantilla con los nombres del Syllabus ----
  const subtemasNombres = temas.flatMap(t => (t.subtemas || []).map(s => minuscula(sinPunto(sinNumero(s.nombre)))));
  const presentacion = 'Presentación de diapositivas de introducción a la ' + (ORDINALES[u.numero - 1] || u.numero) + ' unidad, donde conoceremos ' +
    minuscula(nombreUnidad) + '. Abordaremos ' + lista(subtemasNombres.slice(0, 8)) + (subtemasNombres.length > 8 ? ' y otros temas de la unidad' : '') +
    ', relacionando estos aprendizajes con situaciones propias del ejercicio profesional del programa.';

  return {
    json: {
      output: {
        descripcion: { texto: descTexto, fuentes_ids: [...new Set(citasDesc.map(c => c.id))], citas: citasDesc, sustento: mejor ? 'Frase literal de ' + mejor.id + ' (p. ' + mejor.pagina + ') junto con la justificación del Syllabus.' : 'Sale del Syllabus.' },
        resultado_aprendizaje: '',
        temas: salidaTemas,
        evaluaciones,
        presentacion_unidad: presentacion
      }
    },
    pairedItem: { item: idx }
  };
});
