// ---------- Bibliografía leída por la plataforma (reemplaza a la que se sacaba del Syllabus) ----------
// La plataforma Praxia ya leyó cada fuente completa (PDF, página web o archivo subido) y envía, junto a la unidad,
// la bibliografía en "bibliografia.fuentes": cada una con su ID (U2-B1, U2-C3…), su referencia APA 7 y el texto por página.
// Aquí se eligen, para cada tema, los fragmentos de esas fuentes que más hablan de ese tema y de sus subtemas.
const recibidaGuion = ((($('Webhook Guiones').first().json) || {}).body || {}).bibliografia;
if (!recibidaGuion || !Array.isArray(recibidaGuion.fuentes)) {
  throw new Error('La plataforma no envió la bibliografía leída ("bibliografia.fuentes"). Cree los guiones desde la plataforma Praxia.');
}
const fuentesUnidad = recibidaGuion.fuentes.filter(f => !f.unidad || Number(f.unidad) === numeroUnidad);
const sinTilde = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PALABRAS_VACIAS = new Set(['para', 'como', 'entre', 'sobre', 'desde', 'hasta', 'esta', 'este', 'estos', 'estas', 'cada', 'tema', 'temas', 'unidad', 'proceso', 'procesos', 'desarrollo', 'general', 'generales', 'basico', 'basica', 'aplicado', 'aplicada', 'donde', 'pero', 'tambien']);
const clavesDeTema = txt => [...new Set(sinTilde(txt).split(/[^a-z0-9ñ]+/).filter(p => p.length > 3 && !PALABRAS_VACIAS.has(p)))];
const MAX_PAGINAS_POR_FUENTE = 3;
const MAX_CARACTERES_PAGINA = 900;
const MAX_CARACTERES_TEMA = 14000;
const sinAsteriscos = s => String(s || '').replace(/\*/g, '');

const bibliografiaDelTema = (t) => {
  const ks = clavesDeTema(t.nombre + ' ' + JSON.stringify(t.subtemas || []));
  let total = 0;
  const entradas = fuentesUnidad.map(f => {
    const extractos = [];
    const puntuadas = (f.paginas || []).map(p => {
      const txt = sinTilde(p.texto);
      let puntos = 0;
      for (const k of ks) {
        let i = txt.indexOf(k);
        while (i !== -1) { puntos++; i = txt.indexOf(k, i + k.length); }
      }
      return { pagina: p.numero, texto: String(p.texto || ''), puntos };
    }).filter(p => p.puntos > 0).sort((a, b) => b.puntos - a.puntos || a.pagina - b.pagina).slice(0, MAX_PAGINAS_POR_FUENTE);
    for (const p of puntuadas) {
      const recorte = p.texto.slice(0, MAX_CARACTERES_PAGINA);
      if (total + recorte.length > MAX_CARACTERES_TEMA) break;
      total += recorte.length;
      extractos.push({ pagina: p.pagina, texto: recorte });
    }
    return {
      id: f.id,
      tipo: f.categoria === 'complementaria' ? 'complementaria' : 'basica',
      texto: sinAsteriscos(f.referencia_apa || f.entrada_syllabus),
      cita_apa: sinAsteriscos(f.cita_apa),
      anio: Number(f.anio) || null,
      doi: f.doi || null,
      url: f.url || null,
      extractos,
      nota: extractos.length ? null : 'Ningún fragmento leído de esta fuente trata este tema.'
    };
  });
  return {
    disponible: entradas.length > 0,
    motivo: entradas.length ? null : 'La plataforma no envió fuentes leídas para la unidad ' + numeroUnidad + '.',
    origen: 'Lectura completa de las fuentes hecha por la plataforma',
    entradas
  };
};

