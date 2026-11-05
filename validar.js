// Uso: node validar.js
// Verifica que el contenido de cada recurso cumpla los rangos de la ficha técnica.
const fs = require('fs'), path = require('path');
const W = t => (t || '').trim().split(/\s+/).filter(Boolean).length;
let fails = 0, checks = 0;
let cur = '';
function rng(label, val, min, max) {
  checks++;
  if (val < min || val > max) { fails++; console.log(`  ✗ ${cur} · ${label}: ${val} (esperado ${min}–${max})`); }
}
function words(label, text, min, max) { rng(label + ` «${(text || '').slice(0, 32)}…»`, W(text), min, max); }
function load(n) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'contenido', n + '.json'), 'utf8')); }

// ---------- Taller aplicado (infografía) ----------
function taller(t) {
  rng('pasos', t.pasos.length, 4, 8);
  rng('preguntas de análisis', t.analisis.length, 3, 5);
  rng('criterios de verificación', t.checklist.length, 4, 6);
  const mins = parseInt(t.duracion); rng('duración (min)', mins, 15, 30);
  checks++; if (!t.problema || !t.objetivo || !t.materiales.length || !t.reflexion) { fails++; console.log('  ✗ taller incompleto'); }
}

// 01
cur = '01 Infografía interactiva';
{
  const c = load('01');
  words('título', c.titulo, 5, 10);
  words('subtítulo', c.subtitulo, 10, 20);
  rng('bloques', c.bloques.length, 5, 7);
  c.bloques.forEach(b => { words('texto bloque', b.texto, 25, 45); checks++; if (!b.icono || !b.ejemplo) { fails++; console.log('  ✗ bloque sin icono/ejemplo'); } });
  checks++; if (!c.ideaCentral || !c.sintesis || !c.recomendacion) { fails++; console.log('  ✗ falta idea central / cierre'); }
  taller(c.taller);
}
// 02
cur = '02 Línea de tiempo dinámica';
{
  const c = load('02');
  rng('hitos', c.hitos.length, 6, 8);
  c.hitos.forEach(h => {
    words('nombre hito', h.nombre, 3, 7); words('explicación', h.explicacion, 25, 45);
    checks++; if (!h.fase || !h.ejemplo || !h.icono) { fails++; console.log('  ✗ hito incompleto'); }
  });
  const t = c.tarea;
  rng('instrucciones', t.instrucciones.length, 4, 7);
  rng('criterios de evaluación', t.criterios.length, 4, 6);
  rng('duración tarea (min)', parseInt(t.duracion), 20, 40);
  checks++; if (!t.condiciones || !t.producto || !t.reto || !t.checklist.length) { fails++; console.log('  ✗ tarea incompleta'); }
}
// 03
cur = '03 Mapa conceptual interactivo';
{
  const c = load('03');
  rng('nodos totales', c.nodos.length, 6, 10);
  rng('niveles', Math.max(...c.nodos.map(n => n.nivel)) + 1, 1, 3);
  rng('conceptos de primer nivel', c.nodos.filter(n => n.nivel === 1).length, 4, 6);
  c.nodos.forEach(n => { words('etiqueta', n.etiqueta, 2, 6); words('ficha', n.ficha, 25, 40); if (n.nivel > 0) { checks++; if (!n.enlace) { fails++; console.log('  ✗ nodo sin enlace'); } } });
  const a = c.cierre.actividad;
  rng('elementos', a.elementos.length, 8, 12);
  rng('categorías', a.categorias.length, 3, 4);
  a.elementos.forEach(e => words('etiqueta elemento', e.texto, 1, 5));
  a.categorias.forEach(e => words('etiqueta categoría', e.nombre, 1, 5));
  checks++; if (!a.elementos.some(e => e.confunde)) { fails++; console.log('  ✗ sin elementos confundibles'); }
}
// 04
cur = '04 Video de microlearning';
{
  const c = load('04');
  const cues = c.escenas.flatMap(s => s.cues);
  const total = cues.reduce((s, q) => s + W(q.texto), 0);
  rng('palabras del guion', total, 250, 450);
  const seg = cues.reduce((s, q) => s + W(q.texto) / c.velocidad + c.pausa, 0);
  rng('duración estimada (min)', +(seg / 60).toFixed(2), 2, 4);
  rng('pasos de la demostración', c.pasos.length, 3, 5);
  cues.forEach(q => words('rótulo en pantalla', q.rotulo, 1, 8));
  const a = c.actividad;
  rng('preguntas', a.preguntas.length, 5, 8);
  a.preguntas.forEach(p => { words('retro correcta', p.retroOk, 20, 35); words('retro incorrecta', p.retroMal, 20, 35); });
  const tipos = new Set(a.preguntas.map(p => p.tipo)); rng('tipos de pregunta distintos', tipos.size, 2, 3);
  console.log(`    (guion: ${total} palabras, ~${(seg / 60).toFixed(1)} min)`);
}
// 05
cur = '05 Presentación multimedia';
{
  const c = load('05');
  const d = c.diapositivas;
  rng('diapositivas', d.length, 8, 12);
  d.forEach(s => {
    words('título', s.titulo, 5, 10);
    const extra = (s.ejemplo ? W(s.ejemplo) : 0) + (s.pregunta ? W(s.pregunta) : 0);
    rng('texto diapositiva «' + s.titulo.slice(0, 25) + '»', W(s.texto) + extra, 40, 70);
  });
  const inter = d.filter(s => ['pregunta', 'explorar', 'caso'].includes(s.tipo)).length;
  rng('interacciones', inter, 2, 4);
  const act = d.find(s => s.tipo === 'actividad');
  rng('escenarios', act.escenarios.length, 1, 4);
  act.escenarios.forEach(e => {
    rng('alternativas', e.alternativas.length, 2, 4);
    e.alternativas.forEach(a => words('retro decisión', a.retro, 25, 40));
    checks++; if (e.alternativas.filter(a => a.mejor).length !== 1) { fails++; console.log('  ✗ debe haber una alternativa mejor'); }
  });
  rng('duración actividad (min)', act.escenarios.length * 2.5, 2, 12);
}
// 06
cur = '06 Laboratorio virtual';
{
  const c = load('06');
  rng('etapas / pasos', c.etapas.length, 3, 5);
  rng('puntos de decisión/comprobación', c.etapas.filter(e => e.decision).length, 2, 4);
  rng('datos relevantes', c.ticket.datos.filter(d => d.relevante).length, 2, 4);
  c.etapas.forEach(e => { words('retro ok', e.retroOk, 25, 40); words('retro mal', e.retroMal, 25, 40); });
  checks++; if (!c.contexto || !c.objetivo || !c.condiciones.length || !c.instrucciones || !c.autoevaluacion) { fails++; console.log('  ✗ laboratorio incompleto'); }
}
console.log(fails ? `\n${fails} incumplimientos de ${checks} verificaciones` : `\n✔ ${checks} verificaciones cumplidas`);
process.exit(fails ? 1 : 0);
