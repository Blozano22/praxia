// ===== Estructura metodológica vigente por nivel (Tecnológico, Licenciatura, Especialización y Doctorado) =====
// Sustituye el catálogo de RED y de actividades generales por el del nivel del Syllabus y agrega las actividades
// específicas de autoaprendizaje. Datos: n8n/bibliografia/catalogos-nivel.json (lo inserta aplicar-parche.mjs).
const ESTRUCTURA_NIVEL = __CATALOGOS__;
const KIND_POR_FAMILIA = {
  'Representación y organización visual': 'visual',
  'Recursos audiovisuales y sonoros': 'audiovisual',
  'Recursos de lectura y profundización académica': 'lectura',
  'Experiencias multimedia interactivas': 'multimedia',
  'Secuenciación y organización temporal': 'temporal'
};
const FAMILIA_POR_RED = {};
const nivelEstructura = (() => { try { return nivelDe(items[0].json.general?.nivel_formacion); } catch (e) { return null; } })();
const estructura = ESTRUCTURA_NIVEL[nivelEstructura];
if (estructura) {
  const PR = x => (x === 'P' ? 'Prioritaria' : 'Complementaria');
  CATALOGO_RED.splice(0, CATALOGO_RED.length, ...estructura.red.map(([fam, red, pr], i) => ({
    anexo: 100 + i, red, familia: fam, proposito: '', prioridad: { [nivelEstructura]: PR(pr) }, uso: '', precaucion: ''
  })));
  CATALOGO.splice(0, CATALOGO.length, ...estructura.act.map(([red, pr], i) => ({
    anexo: 200 + i, red, familia: 'Actividad de autoaprendizaje general', proposito: '', prioridad: { [nivelEstructura]: PR(pr) }, uso: '', precaucion: ''
  })));
  estructura.red.forEach(([fam, red]) => { FAMILIA_POR_RED[red] = fam; });
}
// Actividades de autoaprendizaje del nivel: específicas (con su propósito) y generales. Se cuentan los usos entre unidades.
const ACTIVIDADES_NIVEL = estructura ? [
  ...estructura.esp.map(e => ({ nombre: e[0], tipo: 'esp', pr: e[1], proposito: e[2], texto: e[0] + ' ' + e[2] })),
  ...estructura.act.map(a => ({ nombre: a[0], tipo: 'gen', pr: a[1], proposito: '', texto: a[0] }))
] : [];
const usoActividad = new Map();
