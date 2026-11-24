// Prompts listos para pegar en un agente de IA: uno para GENERAR un paquete de íconos para el banco de Praxia y otro para MODIFICAR un ícono que ya está en el banco.
// Las reglas son las MISMAS que valida el servidor (servidor/src/iconos/normalizar.js y servidor/src/iconos/rutas.js): si allí cambian, hay que cambiarlas aquí.

const PEDIDO = '[ESCRIBA AQUÍ QUÉ ÍCONOS NECESITA: uno por línea o una descripción general. Ejemplo: «candado, escudo, lupa, bombilla, gráfico de barras»]'

const REGLAS_SVG = `REGLAS DEL SVG (el banco rechaza el ícono completo si no se cumplen):
1. Un solo elemento <svg> con viewBox CUADRADO (por ejemplo viewBox="0 0 24 24" o "0 0 100 100"). Sin width ni height en el <svg>. Sin xmlns:xlink ni otros espacios de nombres.
2. Fondo transparente. Sin texto (nada de <text>, ni letras ni números dibujados como texto). El dibujo ocupa entre el 80 % y el 90 % del cuadro y está centrado; todos los íconos del conjunto con el mismo margen interior y el mismo peso visual. Sombras, brillos y relieve dentro del cuadro (lo que salga del viewBox se recorta).
3. Elementos PERMITIDOS (solo estos): svg, g, path, circle, ellipse, rect, line, polyline, polygon, defs, linearGradient, radialGradient, stop, clipPath, mask.
4. PROHIBIDO (rechazo seguro): script, style, image, use, foreignObject, text, tspan, filter, pattern, symbol, marker, a, animate y cualquier animación; los atributos class y style; cualquier atributo que empiece por "on"; href y xlink:href; entidades (&); comentarios, CDATA, DOCTYPE.
5. Atributos PERMITIDOS: d, cx, cy, r, rx, ry, x, y, x1, y1, x2, y2, width, height (solo en formas, no en el <svg>), points, transform, fill, stroke, stroke-width, stroke-linecap (butt|round|square), stroke-linejoin (miter|round|bevel), stroke-miterlimit, stroke-dasharray, stroke-dashoffset, opacity, fill-opacity, stroke-opacity, fill-rule (nonzero|evenodd), clip-rule, offset, stop-color, stop-opacity, gradientUnits, gradientTransform, fx, fy, spreadMethod, clip-path, mask, id, viewBox (solo en el <svg>). Los valores numéricos son números simples (sin unidades como px; se admite %).
6. COLOR: el ícono NO lleva colores fijos, porque su color cambia según la formación del curso.
   · Color principal: "currentColor" en fill y stroke. Si el <svg> no declara fill, queda currentColor.
   · Segundo color (solo si el ícono tiene 2 tonos): var(--ico-2, currentColor).
   · Permitido además: "none" y referencias a elementos del mismo SVG con url(#id) (degradados, clipPath, mask).
   · PROHIBIDO cualquier otro color: nada de #hexadecimales, rgb(), hsl() ni nombres como green o red.
   · Blanco y negro SOLO como capas semitransparentes de relieve: fill="#fff" fill-opacity=".35" o fill="#000" fill-opacity=".2" (la opacidad debe ser menor que 1).
   · Degradados: stop-color="currentColor" y la intensidad con stop-opacity (por ejemplo de .7 a 1).
7. Los id internos (degradados, recortes) empiezan por una letra, solo llevan letras, números, "_", "-" o "." y no se repiten dentro del SVG. Todo url(#x) debe apuntar a un id que exista.
8. Límites: máximo 50 KB por SVG (ideal menos de 20 KB), 2000 elementos y 40 niveles de anidamiento. Trazos con stroke-linecap="round" y stroke-linejoin="round" para que se vea limpio.`

const FORMATO = `FORMATO DE ENTREGA: un único archivo JSON (paquete) con esta forma exacta:
{
  "version": 1,
  "iconos": [
    {
      "id": "candado-seguridad",
      "tipo": "recurso",
      "nombre_es": "Candado",
      "nombre_en": "Padlock",
      "etiquetas_es": ["candado", "seguridad", "privacidad"],
      "etiquetas_en": ["padlock", "security", "privacy"],
      "descripcion": "Qué representa y cuándo conviene usarlo (entre 10 y 400 caracteres).",
      "prompt": "El prompt con el que se generó este ícono, para poder regenerarlo o crear otro igual de estilo.",
      "estilo": "relieve",
      "tonos": 1,
      "categoria": "opcional, texto libre",
      "subcategoria": "opcional, texto libre",
      "svg": "<svg viewBox=\\"0 0 24 24\\">…</svg>"
    }
  ]
}
Reglas de los datos:
· id: solo a-z minúsculas, 0-9 y guiones, máximo 80; único en todo el banco. Descriptivo, en minúsculas y con guiones (por ejemplo "candado-seguridad"). Si el id ya lo usa OTRO dibujo, el banco NO lo reemplaza: guarda el nuevo con un sufijo (-2, -3…) y lo avisa; el mismo dibujo con el mismo id solo actualiza los datos.
· tipo: siempre "recurso".
· nombre_es y nombre_en: 1 a 80 caracteres. etiquetas_es y etiquetas_en: entre 3 y 12 palabras o sinónimos cada una (máximo 40 caracteres cada una), en el idioma correspondiente.
· descripcion: entre 10 y 400 caracteres; el flujo que genera los recursos usa este texto (junto con nombres y etiquetas) para ELEGIR el ícono, así que debe decir con claridad qué idea representa.
· prompt: entre 3 y 2000 caracteres.
· estilo: solo a-z, 0-9 y guiones, máximo 40; igual en todos los íconos del paquete.
· tonos: 1 (un solo color) o 2 (principal y secundario con var(--ico-2, currentColor)).
· categoria y subcategoria: opcionales, texto libre de hasta 80 caracteres; son solo informativas.
· No repita el mismo dibujo con dos id distintos del mismo tipo (el banco lo rechaza como duplicado).
· En el JSON, las comillas dobles dentro del svg van escapadas (\\") y todo el svg va en una sola línea de texto.`

const AUTORREVISION = `ANTES DE RESPONDER, revise cada ícono contra esta lista y corrija lo que falle:
[ ] un solo <svg> con viewBox cuadrado, sin width/height, sin texto, fondo transparente
[ ] solo elementos y atributos permitidos; sin class, style, filter, use, image, text ni atributos on*
[ ] ningún color fijo: solo currentColor, var(--ico-2, currentColor), none, url(#id); blanco/negro solo con opacidad menor que 1
[ ] los id internos son válidos y todo url(#...) apunta a un id que existe
[ ] el dibujo ocupa del 80 % al 90 % del cuadro, centrado, igual margen en todo el conjunto, sombras dentro del cuadro
[ ] cada ícono tiene todos los campos del formato, id único y descriptivo, etiquetas en ambos idiomas y descripción útil
[ ] el JSON es válido (comillas escapadas) y no hay texto fuera del JSON`

const TECNICA_RELIEVE = `TÉCNICA DE RELIEVE (sin colores fijos): construya cada ícono con una forma base rellena con un degradado lineal de currentColor (primer stop con stop-opacity de .7 a .8 y el último con stop-opacity="1"), más capas encima: un brillo con fill="#fff" y fill-opacity entre .25 y .5 (una elipse o curva en la parte superior izquierda) y una sombra con fill="#000" y fill-opacity entre .12 y .3 en la parte inferior o derecha. Bordes redondeados. Los detalles internos en el color secundario solo si el ícono tiene 2 tonos.`

const TECNICA_LINEAL = `TÉCNICA LINEAL: trazos con fill="none" y stroke="currentColor", stroke-width entre 1.5 y 2 (en viewBox 24×24), stroke-linecap="round" y stroke-linejoin="round". Un mismo grosor en todo el conjunto. Sin rellenos salvo detalles pequeños con currentColor.`

const TECNICA_PLANA = `TÉCNICA PLANA: formas rellenas con fill="currentColor", sin degradados. Si el ícono tiene 2 tonos, las partes secundarias usan fill="var(--ico-2, currentColor)". Detalles internos con capas blancas semitransparentes (fill="#fff" fill-opacity=".35").`

const tecnica = (estilo, relieve) => (relieve ? TECNICA_RELIEVE : /lineal|trazo|line/i.test(estilo || '') ? TECNICA_LINEAL : TECNICA_PLANA)
const limpiarId = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

// Prompt para GENERAR un paquete de íconos nuevo.
export function promptGenerar({ estilo = '', tonos = 1, relieve = false, pedido = '', categoria = '' } = {}) {
  const est = limpiarId(estilo) || (relieve ? 'relieve' : 'lineal')
  const cat = String(categoria || '').trim().slice(0, 80)
  const solicitud = String(pedido || '').trim() || PEDIDO
  return `Eres un diseñador de íconos SVG. Debes generar un PAQUETE de íconos para el banco de íconos de la plataforma Praxia. Un sistema automático valida cada SVG con reglas estrictas y rechaza los que no las cumplen, así que sigue las reglas al pie de la letra.

QUÉ NECESITO
· Tipo de íconos: recurso (para recursos educativos interactivos); en el JSON, "tipo": "recurso".
${cat ? '· Categoría: "' + cat + '" (úsala en el campo "categoria" de cada ícono).\n' : ''}· Estilo: "${est}". Tonos: ${Number(tonos) === 2 ? '2 (color principal currentColor y secundario var(--ico-2, currentColor))' : '1 (solo currentColor)'}.
· Los íconos son para cursos universitarios de cualquier tema: deben ser claros, reconocibles y neutros, y comunicar una sola idea cada uno.
· Íconos solicitados:
${solicitud}

${tecnica(est, relieve)}

${REGLAS_SVG}

${FORMATO}

${AUTORREVISION}

RESPUESTA: entregue SOLO el contenido del archivo JSON (que se guardará como paquete-iconos.json). Sin explicaciones, sin comentarios y sin bloques de código. Si algún ícono pedido no puede cumplir las reglas, no lo incluya y no lo invente.`
}

const AUTORREVISION_SVG = `ANTES DE RESPONDER, revise el SVG contra esta lista y corrija lo que falle:
[ ] un solo <svg> con viewBox cuadrado, sin width/height, sin texto, fondo transparente
[ ] solo elementos y atributos permitidos; sin class, style, filter, use, image, text ni atributos on*
[ ] ningún color fijo: solo currentColor, var(--ico-2, currentColor), none, url(#id); blanco/negro solo con opacidad menor que 1
[ ] los id internos son válidos y todo url(#...) apunta a un id que existe
[ ] el dibujo ocupa del 80 % al 90 % del cuadro, centrado, con sombras dentro del cuadro
[ ] la respuesta es solo el código <svg>…</svg>, sin JSON ni explicaciones`

// Prompt para MODIFICAR un ícono que ya está en el banco: la IA devuelve SOLO el SVG (se pega en Editar → Reemplazar el SVG).
export function promptModificar(icono, cambio = '') {
  const datos = { nombre_es: icono.nombre_es, nombre_en: icono.nombre_en, descripcion: icono.descripcion, estilo: icono.estilo, tonos: icono.tonos }
  const solicitud = String(cambio || '').trim() || '[ESCRIBA AQUÍ QUÉ CAMBIO NECESITA. Ejemplo: «hazlo más simple», «cambia el candado a abierto», «agrega un segundo tono en el detalle»]'
  return `Eres un diseñador de íconos SVG. Debes MODIFICAR el SVG de un ícono que ya está en el banco de íconos de la plataforma Praxia. Un sistema automático valida el SVG con reglas estrictas y lo rechaza si no las cumple.

ÍCONO ACTUAL (solo como contexto)
${JSON.stringify(datos, null, 2)}

SVG actual:
${icono.svg}

CAMBIO QUE NECESITO
${solicitud}

CÓMO MODIFICARLO
· Parte del SVG actual y cambia solo lo necesario; conserva el estilo («${icono.estilo}»), el margen interior, el peso de los trazos y las proporciones.
· Es el mismo ícono: no cambies su identificador ni crees una versión nueva.
· Si el ícono pasa a usar un segundo color, usa var(--ico-2, currentColor) en esas partes.

${REGLAS_SVG}

${AUTORREVISION_SVG}

RESPUESTA: entregue SOLO el código SVG modificado: un único <svg>…</svg>. Sin JSON, sin explicaciones, sin comentarios y sin bloques de código.`
}
