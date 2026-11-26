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
// La plataforma envía hasta 150 páginas de 2.500 caracteres por fuente: aquí se pasa al modelo la mayor parte posible de lo que
// habla del tema (no solo 3 páginas). El presupuesto total se reparte entre las fuentes para que ninguna quede sin texto.
const MAX_PAGINAS_POR_FUENTE = 12;
const MAX_CARACTERES_PAGINA = 1800;
const MAX_CARACTERES_TEMA = 40000;
const sinAsteriscos = s => String(s || '').replace(/\*/g, '');

const bibliografiaDelTema = (t) => {
  const ks = clavesDeTema(t.nombre + ' ' + JSON.stringify(t.subtemas || []));
  const presupuestoFuente = Math.floor(MAX_CARACTERES_TEMA / Math.max(1, fuentesUnidad.length));
  const entradas = fuentesUnidad.map(f => {
    const extractos = [];
    let total = 0;
    const todas = (f.paginas || []).map(p => ({ pagina: p.numero, texto: String(p.texto || ''), puntos: 0 }));
    const puntuadas = (f.paginas || []).map(p => {
      const txt = sinTilde(p.texto);
      let puntos = 0;
      for (const k of ks) {
        let i = txt.indexOf(k);
        while (i !== -1) { puntos++; i = txt.indexOf(k, i + k.length); }
      }
      return { pagina: p.numero, texto: String(p.texto || ''), puntos };
    }).filter(p => p.puntos > 0).sort((a, b) => b.puntos - a.puntos || a.pagina - b.pagina);
    // Sin ninguna página que nombre el tema, se envían las primeras de la fuente: nunca se manda una fuente vacía.
    // Primero las páginas que nombran el tema; si sobra presupuesto se completan con el resto de la fuente, para que el modelo
    // siempre tenga material con qué llenar cada campo (nada debe quedar vacío por falta de texto).
    const nombradas = new Set(puntuadas.map(p => p.pagina));
    const resto = todas.filter(p => p.texto.trim() && !nombradas.has(p.pagina));
    const elegidas = [...puntuadas, ...resto].slice(0, MAX_PAGINAS_POR_FUENTE);
    for (const p of elegidas) {
      const recorte = p.texto.slice(0, MAX_CARACTERES_PAGINA);
      if (total + recorte.length > presupuestoFuente) break;
      total += recorte.length;
      extractos.push({ pagina: p.pagina, texto: recorte });
    }
    extractos.sort((a, b) => a.pagina - b.pagina);
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

