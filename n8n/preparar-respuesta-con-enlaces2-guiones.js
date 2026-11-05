// NODO: «Preparar respuesta con enlaces2»  ·  Modo: "Run Once for All Items"
// Va entre «Subir DOCX a Google Drive2» y «Responder JSON4».
// Devuelve, por cada tema: el enlace del guion en Drive + el CONTENIDO del guion (el mismo que se escribió en el .docx),
// para que la plataforma pueda mostrarlo, aprobarlo y crear los recursos a partir de él.

const subidos = $input.all();
const armados = $('Armar guion4').all();

// Datos generales (salen de los valores que ya se pusieron en la plantilla).
const valor = (reemplazos, marcador) => {
  const r = (reemplazos || []).find(x => x.marcador === marcador);
  return r ? String(r.valor || '').trim() : '';
};

const archivos = subidos.map((it, i) => {
  const subido = it.json || {};
  const nombre = subido.name || subido.fileName || '';

  // El guion que corresponde a este archivo: primero por nombre (Guion_U<n>_T<k>.docx), si no por posición.
  const g =
    (armados.find(a => 'Guion_U' + a.json.unidad + '_T' + a.json.tema + '.docx' === nombre) || armados[i] || { json: {} }).json;

  const url = subido.webViewLink || (subido.id ? 'https://drive.google.com/file/d/' + subido.id + '/view' : null);
  const rr = g.reemplazos || [];

  return {
    id: subido.id || null,
    nombre,
    url,
    unidad: g.unidad ?? null,
    nombre_unidad: g.nombre_unidad || null,
    tema: g.tema ?? null,
    nombre_tema: g.nombre_tema || null,
    info: {
      programa: valor(rr, '<<Programa>>'),
      nivel: valor(rr, '<<Pregrado>>'),
      semestre: valor(rr, '<<Semestre>>'),
      asignatura: valor(rr, '<<Asignatura>>') || g.asignatura || '',
      creditos: valor(rr, '<<Creditos>>'),
      resultado: valor(rr, '<<Resultado_Aprendizaje>>'),
      indicadores: valor(rr, '<<Indicadores>>'),
      horas: valor(rr, '<<Duracion>>')
    },
    guion: g.guion || null,
    advertencias: g.advertencias || []
  };
});

return [{ json: { ok: true, total: archivos.length, archivos } }];
