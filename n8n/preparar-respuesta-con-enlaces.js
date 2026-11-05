// NODO: «Preparar respuesta con enlace»  ·  Modo: "Run Once for All Items"
// Se ejecuta UNA sola vez con todas las unidades y devuelve UN solo ítem con los enlaces de los documentos.
// Ese ítem es el que debe enviar el nodo «Responder enlaces de plantillas» al portal / plataforma.

const salidas = $input.all();
const documentos = salidas.map((salida, i) => {
  const actualizacion = salida.json || {};
  if (actualizacion.error) {
    throw new Error('No se pudo rellenar la copia de Google Docs: ' + actualizacion.error);
  }

  // Datos de la unidad y de la copia que conservó el nodo anterior (mismo orden de ítems).
  let unidad;
  try { unidad = $('Conservar unidad y copia').itemMatching(i).json; }
  catch (e) { unidad = $('Conservar unidad y copia').all()[i].json; }

  const copia = unidad.documento_generado || {};
  const numero =
    (unidad.unidad && unidad.unidad.numero) ??
    unidad.numero_unidad ??
    (typeof unidad.unidad === 'number' || typeof unidad.unidad === 'string' ? unidad.unidad : undefined) ??
    (i + 1);
  const url = copia.url || (copia.id ? 'https://docs.google.com/document/d/' + copia.id + '/edit' : '');

  return {
    unidad: { numero: Number(numero) || i + 1 },
    nombre_unidad: unidad.nombre_unidad || copia.nombre || ('Unidad ' + (i + 1)),
    url,
    documento_generado: {
      id: copia.id || '',
      nombre: copia.nombre || unidad.nombre_copia || unidad.nombre_unidad || '',
      url,
      diligenciado: true
    }
  };
});

return [{
  json: {
    ok: true,
    total: documentos.length,
    documentos_generados: documentos
  }
}];
