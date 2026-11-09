  // UNA SOLA actividad de autoaprendizaje por OVA. Se elige entre las específicas del nivel (prioridad) y las generales:
  // primero las menos usadas, a igualdad las específicas, luego las Prioritarias y, por último, la más afín al subtema.
  // Así se usan primero todas las específicas y, cuando se agotan (por ejemplo en la unidad siguiente), entran las
  // generales, alternando; nada se repite hasta haber usado todas. El conteo vale para TODAS las unidades de la petición.
  if (estructura) {
    temas.forEach((tema, ti) => {
      ['OVA1', 'OVA2', 'OVA3'].forEach((clave, k) => {
        const posicion = ORDEN.findIndex(([c]) => c === clave);
        const indices = coberturaRecursos((tema.subtemas || []).length)[posicion] || [];
        const texto = normalizar(textoDelSlot(tema, indices));
        const afinidad = c => {
          const palabras = new Set(normalizar(c.texto).split(/[^a-z0-9]+/).filter(w => w.length > 4));
          let p = 0;
          palabras.forEach(w => { if (texto.includes(w.slice(0, 6))) p++; });
          return p;
        };
        const elegida = ACTIVIDADES_NIVEL.slice().sort((a, b) =>
          (usoActividad.get(a.nombre) || 0) - (usoActividad.get(b.nombre) || 0) ||
          (a.tipo === 'esp' ? 0 : 1) - (b.tipo === 'esp' ? 0 : 1) ||
          (a.pr === 'P' ? 0 : 1) - (b.pr === 'P' ? 0 : 1) ||
          afinidad(b) - afinidad(a))[0];
        usoActividad.set(elegida.nombre, (usoActividad.get(elegida.nombre) || 0) + 1);
        actividadesTema[ti][k] = {
          red: elegida.nombre, familia: elegida.tipo === 'esp' ? 'Actividad de autoaprendizaje específica' : 'Actividad de autoaprendizaje general',
          proposito: elegida.proposito, prioridad: { [nivelEstructura]: elegida.pr === 'P' ? 'Prioritaria' : 'Complementaria' }, tecnica_origen: null
        };
      });
    });
  }
