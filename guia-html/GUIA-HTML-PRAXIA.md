# Guía para generar recursos HTML que se suben a Praxia

Esta guía es para **pegarla en el chat** de la herramienta de IA con la que vas a generar una plantilla HTML. Al final de este mismo documento están los límites de las cuatro formaciones: dile al chat **qué recurso** vas a generar (ver el apartado 1).

> Instrucción para la IA que lea esto: eres quien diseña y programa **una plantilla HTML reutilizable** para Praxia. Sigue esta guía al pie de la letra. Si algo no está claro, pregunta antes de generar. Entrega **un solo archivo `.html`** completo.

---

## 1. Qué debes decirle al chat antes de empezar

Sin estos tres datos la IA no sabe qué límites seguir:

1. **Formación:** Tecnológico, Profesional, Especialización o Doctorado (cada una tiene su parte de límites al final de este documento).
2. **Tipo de recurso exacto**, con el nombre que aparece en los límites de su formación (por ejemplo «Infografías estáticas», «Mapas conceptuales interactivos», «Emparejamiento», «Estudio de caso»).
3. **Idea de diseño** (opcional): cómo quieres que se vea o se comporte esta variante.

Mensaje de arranque sugerido:

```
Formación: <Tecnológico | Profesional | Especialización | Doctorado>
Recurso: <nombre exacto del recurso>
Genera una plantilla HTML para Praxia siguiendo la guía y los límites de ese recurso en la parte de su formación.
Variante / idea de diseño: <opcional>
```

La IA debe localizar ese recurso en los límites de su formación (parte final de este documento) y usar **solo** sus secciones y sus rangos de palabras.

---

## 2. Qué es una plantilla de Praxia (cómo funciona)

- Una **plantilla** es el marco del recurso: diseño, interacciones y código. **No lleva el contenido del curso.**
- El contenido de cada recurso lo escribe el flujo automático (n8n) como un **JSON** y lo inserta en la plantilla. La misma plantilla sirve para muchos cursos.
- Por eso la plantilla tiene **dos marcas** que el sistema reemplaza: `{{TITULO}}` y `/*CONTENIDO*/`.
- **Todo texto que cambie de un curso a otro debe venir del JSON, no estar escrito en el HTML.**

Praxia acepta, además, que dentro del archivo vaya un **contenido de ejemplo** ya puesto (apartado 4). Así, al subirla se ve la vista previa con contenido, y al reutilizar la plantilla **no se arrastra el texto de ejemplo**: Praxia lo separa al subirla.

### 2.1 Tres tipos de plantilla: recurso, actividad de autoaprendizaje y evaluación

En los límites de cada formación hay tres grupos; el chat debe saber de cuál es lo que vas a generar:

| Tipo | Dónde está en los límites | Qué es |
|---|---|---|
| **Recurso** | Hoja «RED» | Infografías, mapas, diagramas, líneas de tiempo, estudios de caso, etc. |
| **Actividad de autoaprendizaje** | Hoja «Actividades» | Emparejamiento, arrastre y suelte, clasificación, cuestionario con retroalimentación, toma de decisiones, estudio de caso, etc. |
| **Evaluación** | Hoja «Evaluaciones» | Evaluación formativa, sumativa y banco de preguntas. |

Reglas:

- En Praxia cada categoría de plantillas es de tipo **recurso** o **actividad**. Una plantilla de actividad se sube en una categoría de actividad.
- **Si la estructura de un recurso termina en «Actividad de autoaprendizaje»** (por ejemplo mapas conceptuales o líneas de tiempo), esa actividad va **dentro del mismo HTML**, como último apartado, con su propio bloque en el JSON (clave `actividad`). No es un archivo aparte.
- Una **actividad** o **evaluación** que se genera sola es su propio HTML, con los límites de su fila en la hoja «Actividades» o «Evaluaciones» (número de preguntas, pares, situaciones, palabras de la instrucción, retroalimentación).
- En actividades y evaluaciones el JSON debe traer **todo lo que se corrige**: respuestas correctas, retroalimentación de acierto y de error por opción, y los porcentajes si el recurso los pide. La plantilla calcula el resultado; no inventa respuestas.
- Respeta la **cantidad de elementos** de la actividad (por ejemplo «3–4 pares», «3 preguntas, máximo 4»): ni más ni menos de lo permitido.

---

## 3. Las marcas obligatorias

Cada una debe aparecer **exactamente una vez**. Si falta o se repite, Praxia rechaza el archivo.

| Marca | Dónde va | Qué pasa con ella |
|---|---|---|
| `{{TITULO}}` | Solo dentro de `<title>{{TITULO}}</title>` | n8n escribe el título del recurso. El título visible en pantalla se pinta desde el JSON (`titulo`), no con esta marca. |
| `/*CONTENIDO*/ … /*FIN-CONTENIDO*/` | Dentro de `<script type="application/json" id="contenido">` | n8n reemplaza **todo lo que hay entre las dos marcas** por el JSON real. Entre ellas va el contenido de ejemplo. |
| `<style>/*TEMA*/</style>` | Justo antes de `</head>`, después de tus propios estilos | Praxia pone aquí las variables de color y tipografía (apartado 6). |

Reglas de las marcas:

- No uses nunca `/*CSS*/`, `/*LIB*/` ni `/*TEMAJS*/`: son marcas internas del sistema. La plantilla debe ser **autónoma** (su propio CSS y su propio JavaScript).
- No dejes ningún otro `/*…*/` o `{{…}}` suelto con apariencia de marca.
- **No escribas el texto de una marca en ningún otro sitio**, ni siquiera en un comentario HTML, un comentario de código o un texto visible (por ejemplo «aquí va {{TITULO}}»): Praxia cuenta todas las apariciones y rechaza el archivo si hay más de una.
- El título visible no lleva marca: sale del JSON (`titulo`).
- El contenido de ejemplo debe ser un **objeto JSON válido** (`{ … }`, no una lista). Si no es JSON válido, Praxia rechaza la subida y dice por qué.
- Dentro del ejemplo evita escribir la secuencia `</script>`.

### 3.1 Ficha de la plantilla: categoría y formación

Al inicio del `<head>`, en un comentario HTML, la plantilla lleva su **ficha**: los campos del JSON con sus límites y estas dos líneas, que Praxia lee al subirla:

```html
<!--
  Categoría Praxia: G-12
  Formación: especializacion
  CAMPOS DEL JSON … (nombre, tipo, límites)
-->
```

- **Categoría Praxia:** el ID de la categoría de destino (G-12, POS-10, PRE-03…). Praxia la **preselecciona** al subir; si la eliges distinta, avisa.
- **Formación:** `tecnologico`, `profesional`, `especializacion` o `doctorado` (también acepta `licenciatura` como profesional). Praxia guarda la formación de **esa variante** y la muestra en el índice para n8n.
- Si falta alguna de las dos líneas, la plantilla se sube igual (sin categoría preseleccionada o sin formación).

Lectura del contenido en el JavaScript de la plantilla. **Debe quitar las dos marcas antes de leer el JSON**: así, al abrir el archivo suelto, la plantilla se ve con su contenido de ejemplo (si no se quitan, el JSON no es válido y la página sale vacía):

```js
const CFG = JSON.parse(document.getElementById('contenido').textContent.replace(/\/\*(?:FIN-)?CONTENIDO\*\//g, ''));
```

---

## 4. Contenido de ejemplo dentro de la plantilla

Escribe el ejemplo **entre las dos marcas**, con la misma estructura que tendrá el contenido real:

```html
<script type="application/json" id="contenido">/*CONTENIDO*/
{
  "titulo": "Título de ejemplo del recurso",
  "textos": { "instruccion": "Texto de ejemplo de la instrucción." },
  "bloques": [ { "titulo": "Primer bloque", "texto": "Texto de ejemplo…" } ]
}
/*FIN-CONTENIDO*/</script>
```

- Llena **todos** los campos y deja el texto de ejemplo **en el máximo permitido** del recurso (apartado 5). Así se ve el peor caso en la vista previa.
- Incluye siempre la clave `"titulo"`: Praxia la usa como título de la vista previa.
- Usa un tema neutro y genérico (no datos reales de un curso ni de una persona).
- Praxia guarda la plantilla **sin** este ejemplo para n8n y usa el ejemplo solo para la vista previa.

---

## 5. Texto que cambia, texto fijo y límites de caracteres

### 5.1 Qué va en el JSON y qué va en el HTML

| Va en el JSON (cambia con cada recurso) | Va fijo en el HTML (no se etiqueta) |
|---|---|
| Títulos, párrafos, preguntas, opciones, respuestas correctas, pistas, retroalimentación, casos, pasos, nombres, textos alternativos de imágenes, enlaces | Textos de interfaz: «Siguiente», «Reiniciar», «Comprobar», nombres de botones, etiquetas de accesibilidad |

**Si el agente puede ajustar un texto de interfaz** (por ejemplo una instrucción general o un mensaje de acierto), **no lo escribas fijo**: ponlo en el JSON bajo la clave `textos` con un valor por defecto y léelo con respaldo:

```js
const T = Object.assign({ instruccion: 'Selecciona la opción correcta.', acierto: '¡Correcto!' }, CFG.textos || {});
```

De esa forma el agente solo toca el JSON, nunca el HTML, y la plantilla sigue funcionando si no cambia nada.

### 5.1 bis Mismos campos dentro de una categoría

Todas las variantes de una categoría (por ejemplo G-12, línea de tiempo) usan **los mismos campos de contenido**: la categoría define los campos y la variante solo cambia el diseño. Praxia lo comprueba al subir con el contenido de ejemplo: si los campos (nombres, listas y tipos) no coinciden con los de las demás variantes de la categoría, la subida se rechaza y dice qué campos faltan o sobran. Si vas a hacer un diseño con campos distintos, es una categoría distinta. El campo `nivel` (formación) no cuenta.

### 5.2 Respeta los límites del recurso

La parte de límites de la formación (al final de este documento) indica, por sección, las **palabras mínimas y máximas** y la **cantidad de elementos** (por ejemplo «3–4 ideas principales», «títulos de 3–8 palabras»). La plantilla debe:

1. **Tener una sección o campo por cada elemento** de la estructura del recurso, en ese orden.
2. **Dar espacio para el máximo** de palabras de cada campo, sin que el texto se salga, se corte ni tape otros elementos.
3. **No romperse con el mínimo** ni con menos elementos del máximo (por ejemplo 3 ideas en lugar de 4): los elementos ausentes o vacíos no se dibujan.
4. **Aceptar cualquier cantidad dentro del rango** (listas dinámicas), no una cantidad fija si el rango es variable.
5. Escribir los textos con CSS que no desborde: `overflow-wrap:anywhere`, cajas que crecen con el texto o con **scroll interno** si el alto es fijo. **Nunca truncar texto con «…»**.
6. Usar el ejemplo (apartado 4) al máximo para comprobar que todo cabe.

Praxia **todavía no valida** las palabras del JSON: los límites los cumple el diseño de la plantilla y quien escribe el contenido.

---

## 6. Línea gráfica DIEPO y colores por formación

### 6.1 Variables de color (usa solo estas)

Praxia define estas variables en `/*TEMA*/` y la plantilla las ajusta según la formación (apartado 6.2). **Los colores se escriben siempre como `var(--nombre)`**, nunca con un código hexadecimal suelto.

| Variable | Uso | Valor por defecto |
|---|---|---|
| `--nav` / `--ink` / `--tit` | Texto principal, títulos y barras de navegación | `#142749` |
| `--brand` | Color principal de marca: botones, énfasis, bordes activos | `#00665F` |
| `--brand2` | Variante oscura de marca | `#22335D` |
| `--mid` | Azul de apoyo (enlaces, estados) | `#1C45B4` |
| `--cyan` (texto encima: `--cyan-ink`) | Acento secundario | `#08A6CB` (`#151B3B`) |
| `--lime` / `--accent` | Detalles pequeños (puntos, subrayados, marcas de avance). Nunca fondos grandes. Texto encima: `--nav` | `#CBFF01` |
| `--tint`, `--tint2` | Fondos suaves de tarjetas y bloques | mezcla clara de `--brand` / `--cyan` |
| `--bg` | Fondo de la página | `#FFFFFF` |
| `--muted` | Texto secundario | `#142749` al 72 % |
| `--line` | Líneas y bordes neutros | `#C8C8C8` |
| `--black` | Negro de apoyo | `#161616` |
| `--radius` | Radio de esquinas | `14px` |
| `--font` | Familia tipográfica: **Montserrat** (siempre, en todas las variantes) | `Montserrat`, `Segoe UI`, sans-serif |

Reglas de color:

- Escribe siempre un respaldo por si la variable no llega: `color: var(--brand, #00665F)`.
- Para tonos intermedios usa `color-mix(in srgb, var(--brand) 12%, #fff)` o `--tint`; no inventes un color nuevo.
- Los íconos y el SVG deben usar `currentColor` o `fill: var(--brand)`; nunca un color escrito a mano.
- **Excepción:** los colores de **acierto y error** son fijos y no cambian por formación (verde y rojo con contraste suficiente); no uses los colores de marca para decir «correcto» o «incorrecto».
- El blanco, el negro y los grises neutros pueden ir fijos.
- Todo texto debe tener contraste suficiente (4,5:1) sobre su fondo, también con otra paleta.

### 6.2 Paleta por formación (la plantilla la trae incluida)

Cada formación tiene un color **base** y uno **oscuro**; el blanco, el gris y el cian son comunes:

| Formación | `nivel` en el JSON | Base | Oscuro |
|---|---|---|---|
| Tecnológico | `tecnologia` | `#00665F` | `#142749` |
| Profesional | `profesional` (acepta también `licenciatura`) | `#1C45B4` | `#151B3B` |
| Especialización | `especializacion` | `#08A6CB` | `#151B3B` |
| Doctorado | `doctorado` | `#22335D` | `#151B3B` |

Comunes: cian `#14A4C9`, gris `#C8C8C8`, blanco `#FFFFFF`, negro `#161616`.

Reglas:

- El JSON del recurso trae `meta.nivel` (o la dirección trae `?nivel=`); si falta, se usa `tecnologia`.
- La plantilla lleva este objeto y, al cargar, fija en `:root` las variables `--brand` (base) y `--nav` (oscuro) y las que derive. Todo el CSS usa esas variables:

```js
var NIVELES = {
  tecnologia:      { base: '#00665F', oscuro: '#142749' },
  profesional:     { base: '#1C45B4', oscuro: '#151B3B' },
  especializacion: { base: '#08A6CB', oscuro: '#151B3B' },
  doctorado:       { base: '#22335D', oscuro: '#151B3B' }
};
```

- Para los elementos que antes alternaban varios colores, alterna **tonos de la formación**: claro (fondo blanco, texto oscuro, acento base), base (fondo base) y oscuro (fondo oscuro, texto blanco, acento cian).
- Sobre el color base, el texto es blanco solo si el contraste es de 4,5:1 o más; si no, usa el oscuro (el cian de Especialización pide texto oscuro).
- Referencia: `HTMLs/_archivo/linea-de-tiempo/anterior_por-formacion.html` (`NIVELES`, `pickNivel`, `applyPalette`).
- Pendiente de confirmar: que «Profesional» use los colores de «licenciatura» (azul `#1C45B4`).

### 6.3 Tipografía, forma y espacio

- **Fuente: Montserrat en todas las variantes** (sin excepción, para mantener la misma línea gráfica). Se escribe siempre con `font-family: var(--font)`, y la variable nunca se redefine con otra familia. Praxia carga Montserrat al servir la plantilla; el respaldo es Segoe UI y la fuente del sistema. Títulos en peso 800, cuerpo en 400–600. Base **17 px** (`--fs`), interlineado 1,5.
- Esquinas redondeadas (`var(--radius)`), botones en forma de píldora, bordes de 2 px.
- Estilo limpio: fondo blanco, mucho espacio, sin sombras pesadas ni degradados llamativos.
- Pensado para verse en **pantalla completa 16:9 (1280 × 720)** y también en celular (ancho 360 px) sin scroll horizontal. Usa `clamp()` y unidades relativas.
- Animaciones suaves y breves (≤ 350 ms); respeta `@media (prefers-reduced-motion: reduce)` desactivándolas.

### 6.4 Accesibilidad (obligatorio)

- Se debe poder usar **solo con teclado** (Tab, Enter, Espacio, flechas) y el foco se ve (`:focus-visible` con contorno de 3 px).
- Botones con `<button>`, no `<div>`; `aria-label` en los botones de solo ícono; `alt` en imágenes (el texto alternativo viene del JSON).
- Idioma `<html lang="es">`.
- No transmitas información solo con color.

---

## 7. Reglas técnicas del archivo

- **Un solo archivo** `.html`, de menos de **1,5 MB**, con `<html lang="es">`, `<meta charset="utf-8">` y `<meta name="viewport" content="width=device-width,initial-scale=1">`.
- **Todo dentro del archivo:** CSS en `<style>`, JavaScript en `<script>`. Sin librerías externas, sin CDN, sin fuentes externas (Praxia ya añade la tipografía de la marca).
- Las imágenes vienen del JSON como URL (con su texto alternativo) o son SVG en línea. Si no hay imagen, la plantilla debe verse bien igual.
- La plantilla corre **aislada** en un iframe protegido (sandbox): funcionan los scripts, pero **no** uses `localStorage`, `sessionStorage`, cookies, ni llamadas a la API de Praxia, y de `window.parent` no leas ni escribas nada. **Única excepción prevista** (hoy en pausa): `window.parent.postMessage(…)` con el mensaje de resultado para la nota, dentro de `try/catch` (apartado 3.2 de la versión con calificación). Si guardas algo, envuélvelo en `try/catch`.
- No uses `alert()`, `confirm()` ni `prompt()`.
- Sin llamadas de red (`fetch`, `XMLHttpRequest`).
- **El JavaScript no debe fallar si falta un campo** del JSON: revisa que existan (`CFG.bloques || []`) antes de recorrerlos.
- **Nombre:** no lo eliges tú. Praxia le pone el ID de la categoría y el número de variante, en el orden en que se suben (por ejemplo `g-08-v01`, `g-08-v02`). El nombre del archivo que subes no importa.

---

## 8. Esqueleto mínimo válido

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{TITULO}}</title>
<style>
  body{margin:0;background:var(--bg,#fff);color:var(--nav,#142749);font:17px/1.5 var(--font,sans-serif)}
  main{max-width:1100px;margin:0 auto;padding:clamp(16px,3vw,40px)}
  h1{font-weight:800;color:var(--tit,#142749)}
  .bloque{background:var(--tint,#e6f0ef);border-left:5px solid var(--brand,#00665F);border-radius:var(--radius,14px);padding:16px;margin:12px 0;overflow-wrap:anywhere}
  :focus-visible{outline:3px solid var(--nav,#142749);outline-offset:2px}
</style>
<style>/*TEMA*/</style>
</head>
<body>
<main id="app"></main>
<script type="application/json" id="contenido">/*CONTENIDO*/
{
  "titulo": "Título de ejemplo",
  "bloques": [
    { "titulo": "Primer bloque", "texto": "Texto de ejemplo con la extensión máxima permitida." }
  ]
}
/*FIN-CONTENIDO*/</script>
<script>
const CFG = JSON.parse(document.getElementById('contenido').textContent.replace(/\/\*(?:FIN-)?CONTENIDO\*\//g, ''));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const app = document.getElementById('app');
app.innerHTML = '<h1>' + esc(CFG.titulo) + '</h1>' +
  (CFG.bloques || []).map(b => '<section class="bloque"><h2>' + esc(b.titulo) + '</h2><p>' + esc(b.texto) + '</p></section>').join('');
</script>
</body>
</html>
```

Escapa siempre el texto del JSON antes de ponerlo en el HTML (`esc()`), porque viene de un flujo automático.

---

## 9. Lista de verificación antes de entregar

La IA debe comprobar y **responder cada punto** al entregar el archivo:

- [ ] Es un solo archivo `.html` con `<html lang="es">` y pesa menos de 1,5 MB.
- [ ] `{{TITULO}}` aparece **una sola vez**, dentro de `<title>`.
- [ ] `/*CONTENIDO*/` y `/*FIN-CONTENIDO*/` aparecen **una sola vez**, en `<script type="application/json" id="contenido">`.
- [ ] El ejemplo entre las dos marcas es un **objeto JSON válido**, con `"titulo"`, con todos los campos y al **máximo** de palabras.
- [ ] Está `<style>/*TEMA*/</style>` antes de `</head>` y **no** hay `/*CSS*/`, `/*LIB*/` ni `/*TEMAJS*/`.
- [ ] Ningún texto del curso está escrito fijo en el HTML; los textos ajustables están en `CFG.textos` con valor por defecto.
- [ ] Cada sección y cada elemento del recurso (según los límites de la formación) tiene su lugar, en orden.
- [ ] Con el máximo de palabras nada se desborda ni se corta; con el mínimo o con menos elementos no se rompe.
- [ ] Los colores usan solo `var(--…)` (excepto acierto/error y neutros) y la plantilla trae `NIVELES` y lee `meta.nivel` (apartado 6.2).
- [ ] Funciona con teclado, tiene foco visible, `lang="es"` y `alt` en imágenes.
- [ ] Sin librerías externas, sin `localStorage`, sin `fetch`, sin `alert()`.
- [ ] Se ve bien en 1280 × 720 y en 360 px de ancho.

---

## 10. Cómo subirla a Praxia

1. Entra a Praxia con un usuario de **diseñador o administrador** → **Plantillas HTML** → pestaña **Categorías para n8n**.
2. Pulsa **Subir plantilla**, elige la **categoría** (el tipo de recurso, con su ID) y el archivo `.html`. El nombre se genera solo.
3. Si no cumple las reglas, Praxia muestra el motivo en español (por ejemplo «Debe tener exactamente una marca {{TITULO}} y tiene 0»). Corrígelo y vuelve a subir.
4. Con **Ver** abres la vista previa con tu contenido de ejemplo.
5. Una variante **sin categoría** no la usa n8n: asígnale la categoría correcta.

Mensajes de rechazo frecuentes:

| Mensaje | Qué corregir |
|---|---|
| «Debe tener exactamente una marca {{TITULO}} y tiene 0» (o 2) | Pon la marca una sola vez, en `<title>` |
| «Debe tener exactamente una marca /\*CONTENIDO\*/ y tiene …» | Pon la marca una sola vez, en el `<script id="contenido">` |
| «El contenido de ejemplo … no es un JSON válido» | Revisa comas, comillas dobles y llaves del JSON de ejemplo |
| «Quedó sin reemplazar …» (con `/*CSS*/`, `/*LIB*/`, `/*TEMA*/` o `/*TEMAJS*/`) | Esa marca está repetida: deja `/*TEMA*/` una sola vez y no uses las otras tres |
| «No parece una página HTML completa» | Falta la etiqueta `<html>` |
| «El archivo pesa más de 1,5 MB» | Reduce imágenes o código |


---

# PARTE 2 — Límites y estructura por formación

Usa **solo la parte de la formación indicada**. Las demás no aplican.


---

# FORMACIÓN Tecnológico

Fuente: «Estructura RED - Tecnológico» (hojas RED, Actividades y Evaluaciones). Para cada recurso: qué secciones lleva y cuánto texto cabe. **Los máximos y rangos de palabras son los del recurso: la plantilla debe dejar espacio para el máximo y no romperse con el mínimo.**


### Hoja «RED»

#### 1 — Diapositivas de presentación de la unidad
- Categoría: Presentación · Uso recomendado: Unidad 1, Unidad 4
- **Estructura:**
  > 1. Pantalla 1 — Bienvenida y contextualización: nombre de la unidad, relación con la asignatura y pregunta inicial contextualizada
  > 2. Pantalla 2 — ¿Qué aprenderás?: resultado de aprendizaje de la unidad, indicadores y aplicación al servicio de Policía
  > 3. Pantalla 3 — ¿Qué estudiarás?: títulos de los temas y breve descripción de su utilidad
  > 4. Pantalla 4 — ¿Cómo aprenderás?: recursos, actividades, evaluaciones, orientaciones de navegación y primer paso. No presentar porcentajes ni fechas sin aprobación.
  > Tomar la información de la estructura metodológica de cada unidad
- **Extensión / límites:**
  > • 4 pantallas.
  > • Títulos: máximo 10 palabras.
  > • Texto visible: 45–75 palabras por pantalla.
  > • Presentar únicamente los temas de la unidad correspondiente.
  > • Resultado de aprendizaje e indicadores: conservar redacción aprobada.
  > • Tiempo de recorrido: 3–5 minutos.

#### 4 — Infografías estáticas
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del recurso → 1. Pregunta orientadora (derivada del subtema) → 2. Contextualización (situación del servicio) → 3. Concepto clave: contenido y recurso visual (fuente disciplinar) → 4. Ideas principales: título, explicación y recurso visual por idea → 5. Ejemplo aplicado en contexto policial y su visual → 6. Cierre: síntesis.
- **Extensión / límites:**
  > • 1 infografía vertical; título de 5–12 palabras.
  > • Pregunta orientadora: 1 (15–25 palabras).
  > • Contextualización: 45–70 palabras.
  > • Concepto clave: 55–85 palabras.
  > • 3–4 ideas principales, con títulos de 3–8 palabras y explicaciones de 45–70 palabras por idea.
  > • Ejemplo aplicado: 65–100 palabras.
  > • Síntesis: 45–70 palabras; visual por concepto, idea y ejemplo.

#### 5 — Infografías interactivas
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del recurso→ 1. Imagen contextualizada: descripción y texto alternativo → 2. Puntos de exploración: nombre, ubicación y tipo de interacción por punto → 3. Introducción: descripción de contexto (construir desde el subtema) → 4. Explicación: nombre y explicación diferenciada por cada punto (contenido validado y ejemplos policiales) → 5. Cierre: síntesis.
- **Extensión / límites:**
  > • 1 imagen contextualizada; descripción: 60–100 palabras; texto alternativo: 20–40.
  > • 4–6 puntos interactivos; nombres de 3–7 palabras.
  > • Introducción: 60–100 palabras.
  > • Explicación: 100–160 palabras por punto, con ejemplo o aplicación breve.
  > • Síntesis: 50–80 palabras.
  > • Todos los puntos deben tener interacción definida y contenido consultable.

#### 6 — Diagramas de flujo
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del recurso → 1. Propósito del proceso → 2. Nodo inicial → 3. Introducción → 4. Secuencia de actividades: ID, acción y conexión por nodo → 5. Decisiones (si aplican): ID, pregunta, ruta Sí y ruta No → 6. Resultado del proceso → 7. Explicación de la secuencia → 8. Ejemplo aplicado → 9. Cierre: síntesis.
  > Procedimiento y decisiones se toman de la fuente técnica pertinente al subtema.
- **Extensión / límites:**
  > • Título: 5–12 palabras; propósito: 30–50 palabras.
  > • Introducción: 50–80 palabras.
  > • 5–10 nodos con etiquetas de hasta 10 palabras y conexiones verificables.
  > • 1–3 decisiones como máximo; dos rutas explícitas por decisión (Sí/No).
  > • Explicación general: 80–130 palabras.
  > • Ejemplo aplicado: 70–110 palabras; síntesis: 45–70 palabras.

#### 7 — Fichas tecnicas interactivas
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del recurso → 1. Propósito de consulta → 2. Introducción → 3. Identificación del elemento o procedimiento: nombre, descripción e imagen/ícono → 4. Características técnicas: característica y descripción/valor por ítem → 5. Componentes o etapas: nombre, descripción y apoyo visual por etapa → 6. Condiciones de uso → 7. Ejemplo aplicado → 8. Recomendaciones → 9. Cierre: descripción.
  > La información técnica procede de protocolos/documentos vigentes y el subtema.
- **Extensión / límites:**
  > • Propósito: 25–45 palabras; introducción: 55–85.
  > • Identificación: 40–70 palabras y 1 visual.
  > • 3–5 características, 20–40 palabras por descripción.
  > • 3–5 componentes o etapas, 25–50 palabras y apoyo visual por etapa.
  > • Condiciones: 50–80; ejemplo: 80–130; recomendaciones: 3–5 de 15–30 palabras; cierre: 45–70 palabras.

#### 8 — Mapas conceptuales interactivos
- Categoría: Representación y organización visual · Uso recomendado: Complementaria
- **Estructura:**
  > Título del recurso → 1. Concepto central y explicación → 2. Conceptos relacionados: concepto y definición breve por nodo → 3. Conexiones explicadas: desde, palabra de enlace, hacia y explicación por relación → 4. Ejemplo de aplicación → 5. Síntesis.
  > Conceptos y relaciones provienen del contenido disciplinar del subtema.
- **Extensión / límites:**
  > • 1 concepto central: explicación de 45–75 palabras.
  > • 5–8 conceptos relacionados, nombres de 2–7 palabras y definiciones de 25–45.
  > • 5–10 conexiones con enlace de 1–5 palabras y explicación de 20–40 palabras cada una.
  > • Ejemplo aplicado: 80–130 palabras.
  > • Síntesis: 45–75 palabras.

#### 12 — Presentaciones multimedia interactivas
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del recurso → 1. Propósito de aprendizaje → 2. Ruta de navegación → 3. Desarrollo progresivo: número/título de diapositiva, contenido, apoyo visual y preguntas de comprobación con opciones y retroalimentación cuando correspondan → 4. Recursos de apoyo: recurso, tipo y uso → 5. Ejemplos aplicados: diapositiva y ejemplo → 6. Cierre: síntesis.
  > Contenidos construidos desde la estructura aprobada.
- **Extensión / límites:**
  > • 8–12 diapositivas.
  > • 60–100 palabras en cada diapositiva de contenido; un concepto principal por pantalla.
  > • 2 comprobaciones como máximo, cada una con 3 alternativas si son de selección y retroalimentación de 20–35 palabras.
  > • 2–3 recursos visuales de apoyo identificados y 1 ejemplo aplicado.
  > • Síntesis: 70–100 palabras.

#### 13 — Simulador de procesos tecnicos
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del recurso → propósito de simulación → contexto técnico → herramientas y condiciones → secuencia de acciones → decisiones operativas → consecuencias de cada elección → retroalimentación por decisión → síntesis de ejecución.
  > Seguir campos y orden con escenario y procedimiento técnico respaldados por las fuentes de la unidad.
- **Extensión / límites:**
  > • 1 escenario contextualizado de 180–250 palabras.
  > • 3 fases/acciones de ejecución y máximo 3 decisiones, cada una con 3 alternativas.
  > • 2–3 variables operativas observables.
  > • Consecuencia diferenciada y retroalimentación de 35–60 palabras por decisión.
  > • Síntesis final: 70–110 palabras.

#### 14 — Acordeones
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del recurso → 1. Introducción → 2. Ítems: pregunta o concepto, explicación breve y ejemplo por cada elemento desplegable → 3. Cierre: síntesis.
  > Los conceptos se extraen del contenido del subtema; ejemplos contextualizados en la práctica policial.
- **Extensión / límites:**
  > • Introducción: 50–80 palabras.
  > • 5–7 ítems desplegables, títulos de 3–8 palabras.
  > • Explicación: 40–70 palabras por ítem; ejemplo breve de 20–35 palabras por ítem.
  > • Síntesis: 50–80 palabras.

#### 15 — Galerías
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del recurso → 1. Introducción → 2. Elementos de galería: subtítulo, imagen, explicación y relación con el aprendizaje para cada elemento → 3. Cierre o síntesis. Contenido de cada imagen y explicación a partir del subtema y fuentes visuales pertinentes.
- **Extensión / límites:**
  > • Introducción: 50–80 palabras.
  > • 4–6 elementos; subtítulo de 3–8 palabras.
  > • Explicación: 50–80 palabras por elemento, con relación explícita a la aplicación.
  > • 1 imagen y texto alternativo de 15–30 palabras por elemento.
  > • Síntesis: 50–80 palabras.

#### 16 — Lecturas fundamentales diagramadas
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Complementaria
- **Estructura:**
  > Título del recurso → 1. Propósito → 2. Introducción → 3. Desarrollo por apartados: subtítulo y párrafos sustentados en fuentes académicas → 4. Ejemplo o caso aplicado al contexto del servicio → 5. Conclusión.
  > Los conceptos proceden de bibliografía pertinente al subtema.
- **Extensión / límites:**
  > • Propósito: 30–50 palabras.
  > • Introducción: 100–150 palabras.
  > • 3–4 apartados, con subtítulos de 5–12 palabras.
  > • Desarrollo total: 800–1.350 palabras; incluir aplicación concreta.
  > • 1 ejemplo o caso: 130–200 palabras.
  > • Conclusión: 100–150 palabras; extensión total orientativa: 1.100–1.850 palabras.

#### 17 — Boletines técnicos especializados
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del recurso → 1. Propósito del boletín → 2. Contextualización técnica → 3. Novedades o hallazgos: título y descripción por hallazgo → 4. Orientaciones operativas → ejemplo aplicado → 5. Recomendaciones. Hallazgos, lineamientos y procedimientos proceden de fuentes técnicas y normativas verificables, no de invenciones.
- **Extensión / límites:**
  > • Total 800–1.200 palabras.
  > • Propósito: 35–55 palabras; contextualización técnica: 160–230 palabras.
  > • 2–3 novedades o hallazgos, descripción de 100–150 palabras cada uno.
  > • 2–3 orientaciones de 60–95 palabras.
  > • 1 ejemplo aplicado: 130–190 palabras.
  > • 3–5 recomendaciones breves de 20–35 palabras cada una.

#### 18 — Líneas de tiempo dinámicas
- Categoría: Secuenciación y organización temporal. · Uso recomendado: Complementaria
- **Estructura:**
  > Título del recurso → 1. Introducción → 2. Acontecimientos históricos por año: nombre del hito, fecha y explicación verificable → 3. Cierre: síntesis. Fechas y sucesos se obtienen de fuentes históricas o normativas pertinentes; usar hitos, no etapas de un proceso.
- **Extensión / límites:**
  > • Introducción: 50–80 palabras.
  > • 6–10 hitos históricos con años distintos y orden cronológico.
  > • Nombre: 5–10 palabras; explicación: 50–85 palabras por hito.
  > • Síntesis: 70–110 palabras.
  > • Verificar cada fecha y evitar repetir acontecimientos.

#### 19 — Procedimiento Paso a Paso
- Categoría: Secuenciación y organización temporal. · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → 1. Propósito del procedimiento (construir desde el subtema) → 2. Introducción (contexto y utilidad práctica) → 3. Condiciones iniciales (protocolo o manual vigente) → 4. Materiales o herramientas (nombre y uso) → 5. Secuencia de pasos (número, acción y apoyo visual) → 6. Verificación de ejecución (criterios observables) → 7. Ejemplo aplicado (situación contextualizada) → 8. Recomendaciones finales (precauciones y buenas prácticas) → 9. Cierre: síntesis del procedimiento y su aplicación. La información técnica debe basarse en fuentes institucionales o documentos técnicos vigentes, sin inventar requisitos ni pasos.
- **Extensión / límites:**
  > • Propósito: 30–50 palabras.
  > • Introducción: 75–110 palabras.
  > • Condiciones iniciales: 60–90 palabras.
  > • Materiales o herramientas: 3–6 elementos, con nombre y uso de 10–20 palabras por elemento.
  > • Secuencia: 5–7 pasos operativos; acción de 10–20 palabras por paso y apoyo visual breve por paso.
  > • Verificación: 3 criterios observables, de 15–25 palabras cada uno.
  > • Ejemplo aplicado: 80–130 palabras.
  > • Recomendaciones finales: 3–5, de 15–25 palabras cada una.
  > • Cierre — síntesis: 60–90 palabras, destacando la ejecución y comprobación en una situación contextualizada.


### Hoja «Actividades»

#### 1 — Emparejamiento
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Instrucción breve y contextualizada → Dos columnas con 3–4 funciones, conceptos o situaciones y sus correspondencias → Relación de cada elemento con su pareja → Comprobación automática → Retroalimentación diferenciada por acierto o error → Opción de reintentar.
- **Extensión / límites:**
  > • 3–4 pares por actividad.
  > • Instrucción: 20–35 palabras.
  > • Duración: 2–4 minutos.
  > • Retroalimentación: 15–25 palabras por relación.
  > • Aplicar conceptos a situaciones laborales, policiales o comunitarias.

#### 2 — Toma de decisiones
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Presentación de 3 situaciones laborales breves y contextualizadas → Identificación del problema de cada situación → Formulación de una pregunta de decisión por situación → Presentación de 3 alternativas por pregunta → Selección de una alternativa → Visualización de la consecuencia de cada opción → Retroalimentación y recomendación de actuación.
- **Extensión / límites:**
  > • 3 situaciones y 3 preguntas de decisión por actividad (máximo 4).
  > • 3 alternativas por pregunta.
  > • Duración total: 6–9 minutos.
  > • 1 consecuencia explicada por alternativa.
  > • Retroalimentación: 25–40 palabras por decisión.
  > • Contextos laborales, policiales o comunitarios.

#### 3 — Arrastre y suelte
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Instrucción breve con objetivo → Presentación de 3–4 situaciones o elementos arrastrables → Identificación de 2–3 zonas de destino con categorías definidas → Ubicación de los elementos en su zona correspondiente → Comprobación automática → Retroalimentación por elemento y posibilidad de reintentar.
- **Extensión / límites:**
  > • 3–4 elementos arrastrables por actividad.
  > • 2–3 zonas de destino.
  > • Duración: 3–5 minutos.
  > • Etiquetas: 1–6 palabras.
  > • Explicación breve de cada clasificación correcta.

#### 5 — Simulaciones de caso
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Contextualización de un único caso técnico o comunitario → Propósito y condiciones de la simulación → Presentación de 2–4 datos o recursos disponibles → Desarrollo de 3 decisiones consecutivas mediante preguntas y 3 alternativas por decisión → Visualización de consecuencias y retroalimentación por etapa → Resultado final de aciertos y errores → Reflexión aplicada al entorno laboral y opción de reintento.
- **Extensión / límites:**
  > • 1 caso contextualizado.
  > • 3 decisiones o preguntas secuenciales (máximo 4).
  > • 3 alternativas por decisión.
  > • Duración: 8–12 minutos.
  > • 2–4 datos o recursos relevantes.
  > • Retroalimentación: 25–40 palabras por decisión.
  > • Permitir reintentar la simulación.

#### 6 — Clasificaciones
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Instrucción y criterio de clasificación → Presentación de 3–4 elementos o situaciones → Definición de 2–3 categorías claramente diferenciadas → Clasificación individual de los elementos → Comprobación automática → Retroalimentación por acierto o error y explicación de posibles confusiones → Opción de reintento.
- **Extensión / límites:**
  > • 3–4 elementos o situaciones para clasificar.
  > • 2–3 categorías.
  > • Duración: 3–5 minutos.
  > • Etiquetas: 1–5 palabras.
  > • Explicar brevemente las clasificaciones que puedan confundirse.

#### 7 — Cuestionarios con retroalimentación
- Categoría: Actividades de práctica · Uso recomendado: Complementaria
- **Estructura:**
  > Propósito y breve instrucción → Presentación de 3 preguntas contextualizadas vinculadas al resultado de aprendizaje → Tres opciones claras de respuesta por pregunta, cuando corresponda → Selección de respuestas → Calificación automática → Retroalimentación diferenciada para respuestas correctas e incorrectas → Resumen de resultados y sugerencia de repaso.
- **Extensión / límites:**
  > • 3 preguntas por cuestionario (máximo 4).
  > • Selección múltiple con 3 opciones, verdadero/falso o relación breve.
  > • Duración: 3–5 minutos.
  > • Retroalimentación: 20–35 palabras por pregunta y por tipo de respuesta.
  > • Priorizar aplicación a situaciones reales, no solo memoria.

#### 8 — Estudio de caso
- Categoría: Actividades de aplicación · Uso recomendado: Complementaria
- **Estructura:**
  > Presentación de 1 caso laboral o comunitario y su objetivo → Lectura de hechos y 3–4 datos clave → Formulación de 3 preguntas orientadoras sobre problema, actuación y solución → Respuesta a cada pregunta mediante 3 alternativas o respuesta breve argumentada → Propuesta de solución aplicable → Retroalimentación por pregunta y conclusión.
- **Extensión / límites:**
  > • 1 caso contextualizado de 180–250 palabras.
  > • 3 preguntas orientadoras.
  > • 3 alternativas por pregunta si se usa selección múltiple; en preguntas abiertas, 1 respuesta breve por pregunta.
  > • 3–4 datos relevantes.
  > • Duración: 10–15 minutos.
  > • Respuesta total abierta: 100–150 palabras.
  > • Retroalimentación para las 3 preguntas.

#### 9 — Tarea
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título, resultado de aprendizaje y reto contextualizado → Presentación de 3 instrucciones operativas numeradas → Producción de 1 evidencia concreta que resuelva el reto → Lista de comprobación con 3 criterios → Entrega en el formato indicado → Retroalimentación individual basada en los 3 criterios.
- **Extensión / límites:**
  > • 1 reto y 1 producto o evidencia.
  > • 3 instrucciones operativas.
  > • 3 criterios de evaluación y verificación.
  > • 3 componentes evaluables en el producto.
  > • Duración: 20–30 minutos.
  > • Definir formato y extensión de entrega; no añadir preguntas adicionales.

#### 10 — Taller aplicado
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Presentación de 1 problema práctico y objetivo → Recursos disponibles → Ejecución de 3 pasos de aplicación → Registro breve de resultados → Respuesta a 3 preguntas de análisis sobre procedimiento, resultado y mejora, con 3 alternativas cada una si son cerradas → Comprobación y retroalimentación → Conclusión aplicada.
- **Extensión / límites:**
  > • 1 reto práctico.
  > • 3 pasos de ejecución.
  > • 3 preguntas de análisis.
  > • 3 alternativas por pregunta cerrada; para preguntas abiertas, respuesta breve.
  > • 3 criterios de verificación.
  > • 1 evidencia del procedimiento.
  > • Duración: 15–25 minutos.

#### 11 — Laboratorio virtual
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Contexto y objetivo de 1 laboratorio virtual → Reconocimiento de herramientas y controles → Ejecución de 3 acciones o decisiones consecutivas → 3 alternativas por decisión cuando corresponda → Retroalimentación inmediata por acción → Comprobación final con 3 preguntas breves → Opción de corregir y repetir.
- **Extensión / límites:**
  > • 1 reto virtual de ejecución individual.
  > • 3 acciones o decisiones de laboratorio.
  > • 3 alternativas por decisión cuando haya selección.
  > • 3 preguntas de autoevaluación con 3 opciones cada una si son cerradas.
  > • Duración: 10–15 minutos.
  > • Retroalimentación: 20–35 palabras por acción o respuesta.
  > • Permitir reintentos.

#### 12 — Foros estructurados
- Categoría: Actividades de aplicación · Uso recomendado: Complementaria
- **Estructura:**
  > Tema, propósito y 1 situación contextualizada → Presentación de 3 preguntas orientadoras → Redacción de 1 intervención inicial que responda las 3 preguntas → Interacción asincrónica mediante 3 aportes breves a intervenciones de compañeros cuando estén disponibles → Síntesis y retroalimentación docente; si no hay intervenciones disponibles, elaborar 3 comentarios sobre aportes modelo.
- **Extensión / límites:**
  > • 1 situación laboral o comunitaria.
  > • 3 preguntas orientadoras.
  > • 1 intervención inicial de 100–150 palabras.
  > • 3 réplicas asincrónicas de 30–50 palabras cada una, o 3 respuestas a intervenciones modelo.
  > • Duración: 20–30 minutos.
  > • 3 criterios de valoración: pertinencia, argumentación y respeto.

#### 13 — Análisis de incidentes
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Presentación de 1 incidente y contexto operativo → Lectura de 3 evidencias relevantes → Identificación de hechos, riesgos y actuación institucional → Respuesta a 3 preguntas sobre identificación, valoración y medida preventiva, con 3 opciones por pregunta si se usa selección → Retroalimentación diferenciada → Conclusión y lección aprendida.
- **Extensión / límites:**
  > • 1 incidente de 180–250 palabras.
  > • 3 evidencias o datos relevantes.
  > • 3 preguntas de análisis.
  > • 3 opciones por pregunta cerrada; admitir respuesta breve si es abierta.
  > • Respuesta abierta total: 100–150 palabras.
  > • Duración: 12–18 minutos.
  > • Retroalimentación: 25–40 palabras por pregunta.

#### 14 — Lectura del mapa del delito
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Presentación de 1 mapa del delito con leyenda, escala, periodo y fuente → Identificación de 3 zonas o patrones señalados → Respuesta a 3 preguntas de ubicación, comparación y priorización, con 3 alternativas por pregunta → Comprobación automática → Retroalimentación basada en lo observado y advertencia de no atribuir causalidad sin evidencia.
- **Extensión / límites:**
  > • 1 mapa legible con fuente, leyenda y periodo.
  > • 3 puntos, zonas o patrones destacados.
  > • 3 preguntas de interpretación.
  > • 3 alternativas por pregunta.
  > • Duración: 6–10 minutos.
  > • Retroalimentación: 20–35 palabras por pregunta.
  > • Sin datos personales identificables.

#### 15 — Emparejar normas con situaciones
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Instrucción y propósito → Columna A con 3 normas o principios vigentes → Columna B con 3 situaciones policiales o comunitarias → Establecimiento de 3 correspondencias → Comprobación de las relaciones → Retroalimentación correcta e incorrecta por pareja → Reintento
- **Extensión / límites:**
  > • 3 normas o principios y 3 situaciones: 3 pares en total.
  > • 3 opciones de emparejamiento por elemento.
  > • Situaciones: 25–45 palabras cada una.
  > • Instrucción: 20–35 palabras.
  > • Duración: 4–6 minutos.
  > • Retroalimentación: 20–35 palabras por relación.

#### 16 — Elaboración de mapas de intervención
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Presentación de 1 problema territorial y mapa base → Identificación de 3 zonas prioritarias → Selección de 3 acciones de intervención entre 3 alternativas disponibles para cada zona → Ubicación de las acciones en el mapa con justificación → Revisión mediante 3 criterios → Síntesis de resultados y retroalimentación.
- **Extensión / límites:**
  > • 1 mapa base y escenario territorial.
  > • 3 zonas o puntos de intervención.
  > • 3 decisiones o preguntas, una por zona.
  > • 3 alternativas por decisión.
  > • 3 acciones justificadas en total.
  > • 3 criterios de revisión.
  > • Síntesis: 100–150 palabras.
  > • Duración: 15–25 minutos.

#### 17 — Actuación ante escenarios críticos
- Categoría: Actividades de simulación · Uso recomendado: Prioritaria
- **Estructura:**
  > Presentación de 1 escenario crítico y propósito → Identificación de hechos, riesgos y protocolos pertinentes → Desarrollo de 3 momentos secuenciales de decisión → Selección de 1 entre 3 alternativas por momento → Visualización de las consecuencias de cada alternativa → Retroalimentación por decisión → Balance final y reintento.
- **Extensión / límites:**
  > • 1 escenario crítico contextualizado.
  > • 3 preguntas o momentos de decisión.
  > • 3 alternativas por pregunta.
  > • 1 consecuencia fundamentada por alternativa.
  > • Duración: 8–12 minutos.
  > • Retroalimentación: 25–40 palabras por decisión.
  > • Reintento sin penalización.

#### 18 — Clasificación de conducta
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Instrucción y criterio de clasificación → Presentación de 3 conductas o hechos contextualizados → Presentación de 3 categorías definidas → Ubicación de cada conducta en una de las 3 categorías → Comprobación automática de 3 clasificaciones → Retroalimentación por respuesta y reintento.
- **Extensión / límites:**
  > • 3 situaciones o conductas.
  > • 3 categorías de clasificación.
  > • 3 respuestas evaluables, una por situación.
  > • Situaciones: 20–35 palabras cada una.
  > • Duración: 4–6 minutos.
  > • Retroalimentación: 20–35 palabras por respuesta.
  > • Clasificar hechos, no personas.

#### 19 — Construcción de propuestas preventivas
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Descripción de 1 problema y contexto preventivo → Identificación de 3 causas o necesidades relevantes → Planteamiento de 1 objetivo verificable → Selección de 3 acciones preventivas, cada una entre 3 alternativas o mediante justificación abierta → Definición de responsables y seguimiento → Revisión por 3 criterios
- **Extensión / límites:**
  > • 1 problema contextualizado.
  > • 3 causas o necesidades para analizar.
  > • 3 decisiones sobre acciones preventivas.
  > • 3 alternativas por decisión cuando sean cerradas.
  > • 3 acciones preventivas en la propuesta final.
  > • 3 indicadores de seguimiento y 3 criterios de revisión.
  > • Propuesta: 150–220 palabras o matriz equivalente.
  > • Duración: 20–30 minutos.

#### 20 — Completar espacios
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Propósito e instrucción → Lectura de 1 texto técnico breve con 3 espacios numerados → Selección de un término para cada espacio desde un banco de 3 opciones pertinentes, o escritura de 3 respuestas → Comprobación automática → Retroalimentación individual para cada espacio → Reintento y síntesis.
- **Extensión / límites:**
  > • 1 texto de 80–120 palabras.
  > • 3 espacios para completar.
  > • Banco de 3 términos, con correspondencia única (sin distractores adicionales), o 3 respuestas abiertas.
  > • 3 respuestas evaluables en total.
  > • Duración: 3–5 minutos.
  > • Retroalimentación: 15–25 palabras por espacio.
  > • Evitar soluciones ambiguas.

#### 21 — Portafolio de evidencias
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Propósito del portafolio y resultado de aprendizaje → Selección de 3 evidencias relacionadas con el aprendizaje → Organización de las 3 evidencias mediante fichas de descripción → Respuesta a 3 preguntas de reflexión sobre logro, dificultad y mejora → Verificación de 3 criterios de calidad → Entrega con índice y retroalimentación.
- **Extensión / límites:**
  > • 3 evidencias relacionadas con la unidad o subtema.
  > • 3 fichas descriptivas de 50–80 palabras, una por evidencia.
  > • 3 preguntas de reflexión final, con respuesta breve.
  > • 3 criterios de revisión.
  > • Reflexión total: 120–150 palabras.
  > • Duración: 25–40 minutos.
  > • Anonimizar registros cuando aplique.

#### 22 — Elaboración de informes
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Tipo de informe, destinatario y propósito → Entrega de 3 datos o evidencias verificables → Elaboración de 1 informe en 3 apartados: hechos, análisis y recomendaciones → Respuesta integrada a 3 preguntas guía sobre qué ocurrió, qué implica y qué se propone → Revisión por 3 criterios → Retroalimentación y entrega.
- **Extensión / límites:**
  > • 1 informe técnico o policial simulado.
  > • 3 apartados: hechos, análisis y recomendaciones.
  > • 3 preguntas guía integradas en el informe.
  > • 3 datos o evidencias relevantes.
  > • 3 criterios de revisión.
  > • Extensión: 250–350 palabras.
  > • Duración: 20–35 minutos.
  > • Mantener reserva y protección de datos.

#### 23 — Verdadero o falso
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Propósito e instrucciones → Presentación de 3 afirmaciones contextualizadas → Selección de verdadero o falso para cada una → Comprobación automática de las 3 respuestas → Retroalimentación explicativa por afirmación → Reintento y síntesis.
- **Extensión / límites:**
  > • 3 enunciados evaluables.
  > • 2 opciones inherentes al formato: verdadero o falso (excepción necesaria a la regla de 3 opciones).
  > • Enunciado: 15–30 palabras.
  > • Duración: 3–5 minutos.
  > • Retroalimentación: 20–30 palabras por afirmación.
  > • Evitar afirmaciones ambiguas.

#### 24 — Análisis de una noticia
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Presentación de 1 noticia con fecha, medio y fuente → Identificación de hechos y afirmaciones verificables → Respuesta a 3 preguntas: hecho principal, contraste y posibles implicaciones → Selección entre 3 alternativas por pregunta cerrada, o argumentación breve si son abiertas → Conclusión y retroalimentación.
- **Extensión / límites:**
  > • 1 noticia de 200–300 palabras o enlace verificable.
  > • 3 preguntas orientadoras.
  > • 3 alternativas por pregunta cerrada; respuesta breve si es abierta.
  > • Contrastar con 1 fuente adicional.
  > • Respuesta abierta total: 100–150 palabras.
  > • Duración: 12–18 minutos.
  > • Registrar autor, medio y fecha.

#### 25 — Identificación de conceptos
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Objetivo e instrucciones → Presentación de 3 definiciones, situaciones o pistas contextualizadas → Elección del concepto correspondiente para cada ítem entre 3 alternativas → Comprobación automática de las 3 respuestas → Retroalimentación sobre significado y aplicación → Reintento.
- **Extensión / límites:**
  > • 3 conceptos o ítems.
  > • 3 alternativas por ítem.
  > • Definiciones o pistas: 15–30 palabras.
  > • Duración: 3–5 minutos.
  > • Retroalimentación: 15–25 palabras por respuesta.
  > • Ejemplos laborales, policiales o comunitarios sin ambigüedad.

#### 25 — Crucigramas técnicos
- Categoría: Actividades de práctica · Uso recomendado: Complementaria
- **Estructura:**
  > Propósito e instrucción contextualizada → Presentación de 1 cuadrícula con 3 términos técnicos interconectados → Lectura de 3 pistas relacionadas con conceptos, procedimientos o situaciones laborales → Escritura de las respuestas en las casillas correspondientes → Comprobación automática de los 3 términos → Retroalimentación diferenciada por acierto o error → Opción de reintentar y síntesis de los conceptos aplicados.
- **Extensión / límites:**
  > • 1 crucigrama por actividad.
  > • 3 términos técnicos interconectados.
  > • 3 pistas, una por término.
  > • Pistas: 15–30 palabras cada una.
  > • Términos: 4–12 letras, preferiblemente de una palabra.
  > • Instrucción: 20–35 palabras.
  > • Duración: 4–6 minutos.
  > • Retroalimentación: 15–25 palabras por término.
  > • Utilizar conceptos técnicos vinculados con situaciones laborales, policiales o comunitarias.


### Hoja «Evaluaciones»

#### 1 — Evaluación formativa
- **Estructura:**
  > 1. Nombre de la evaluación.
  > 2. Resultado de aprendizaje relacionado.
  > 3. Instrucciones breves y claras.
  > 4. Preguntas o ejercicios aplicados al contenido.
  > 5. Opciones de respuesta cuando corresponda.
  > 6. Retroalimentación inmediata que explique el acierto o error.
  > 7. Resultado obtenido y recomendación de repaso.
- **Extensión / límites:**
  > • 1 evaluación por unidad o bloque temático.
  > • 5–8 preguntas o ejercicios.
  > • Duración estimada: 5–8 minutos.
  > • Intentos múltiples.
  > • Retroalimentación inmediata por pregunta.
  > • Priorizar comprensión y aplicación básica.
- **Porcentajes:** Formativa 1: 25% Evaluación formativa 1 tema 1 y 2  · 2,5% Alguna de las actividades de autoaprendizaje del tema 1  · 2,5% Alguna de las actividades de autoaprendizaje del tema 2 · Formativa 2: 25% Evaluación formativa 2 tema 3 y 4 · 2,5% Alguna de las actividades de autoaprendizaje del tema 3  · 2,5% Alguna de las actividades de autoaprendizaje del tema 4

#### 2 — Evaluación sumativa
- **Estructura:**
  > 1. Nombre de la evaluación y resultado de aprendizaje evaluado.
  > 2. Instrucciones, criterios y condiciones de presentación.
  > 3. Preguntas, caso breve o tarea práctica.
  > 4. Opciones de respuesta o espacio para desarrollar la evidencia.
  > 5. Calificación según criterios definidos.
  > 6. Retroalimentación posterior con fortalezas y aspectos por mejorar.
  > 7. Indicación de los siguientes pasos de aprendizaje.
- **Extensión / límites:**
  > • 1 evaluación al cierre de cada unidad o módulo.
  > • 8–12 preguntas, o 1 caso/tarea práctica equivalente.
  > • Duración estimada: 10–20 minutos, según el formato.
  > • Escala sugerida: 0,0 a 5,0; definir previamente la nota aprobatoria institucional.
  > • 1–2 intentos, según lineamientos del programa.
  > • Alinear todas las preguntas con los resultados de aprendizaje.
- **Porcentajes:** Sumativa: 40%

#### 3 — Banco de preguntas
- **Estructura:**
  > 1. Pregunta vinculada a una unidad y subtema.
  > 2. Resultado de aprendizaje asociado.
  > 3. Nivel cognitivo definido según la complejidad requerida.
  > 4. Enunciado claro y contextualizado.
  > 5. Opciones de respuesta plausibles o criterio de respuesta abierta.
  > 6. Respuesta correcta y justificación.
  > 7. Retroalimentación específica para cada opción cuando aplique.
  > 8. Etiquetas para organizar y seleccionar preguntas.
- **Extensión / límites:**
  > • Crear inicialmente 2–3 preguntas por subtema clave.
  > • Para una evaluación de 8–12 preguntas, disponer idealmente de 2–3 veces ese número en el banco.
  > • Combinar reconocimiento, comprensión y aplicación a situaciones técnicas.
  > • Cada pregunta debe estar asociada a un resultado de aprendizaje.
  > • Incluir justificación de la respuesta correcta y retroalimentación de 15–30 palabras.


### Recursos que NO son HTML (no van en esta guía)
Infografía de presentación de la unidad, Pantalla interactiva de presentación de la unidad, Podcasts, Video introductorio, Videos académicos estructurados, Videos de micro-learning.


---

# FORMACIÓN Profesional

Fuente: «Estructura RED - Profesional» (hojas RED, Actividades y Evaluaciones). Para cada recurso: qué secciones lleva y cuánto texto cabe. **Los máximos y rangos de palabras son los del recurso: la plantilla debe dejar espacio para el máximo y no romperse con el mínimo.**


### Hoja «RED»

#### 0 — *Diapositivas de presentación de la asignatura
- Categoría: Presentación · Uso recomendado: Obligatorio
- **Estructura:**
  > 1. Pantalla 1 — Bienvenida y contextualización: nombre de la asignatura, programa, periodo, créditos, modalidad y pregunta inicial sobre su importancia en el servicio.
  > 2. Pantalla 2 — ¿Qué aprenderás?: resultado de aprendizaje consignado en el syllabus, competencia del programa y relación con la práctica policial.
  > 3. Pantalla 3 — ¿Qué estudiarás?: Mención de los titulos de las unidades
  > 4. Pantalla 4 — ¿Cómo aprenderás?: recorrido por recursos, actividades y evaluaciones; orientaciones de navegación y primer paso para comenzar. No presentar porcentajes ni fechas sin aprobación.
- **Extensión / límites:**
  > • 4 pantallas
  > • Títulos: máximo 10 palabras.
  > • Texto visible: 70–110 palabras por pantalla.
  > • Interacciones: 1 exploración de unidades y navegación accesible.
  > • Información verificable: número de créditos, periodo o nivel, modalidad.
  > • Tiempo estimado de recorrido: 4–6 minutos.

#### 1 — Cuadro comparativo interactivo
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → pregunta orientadora → criterios de comparación → elementos o casos comparados → tabla interactiva → conclusiones
- **Extensión / límites:**
  > Título: 5–12 palabras. Introducción: 80–120 palabras. 3–5 criterios y 2–4 elementos. Cada celda: 20–40 palabras de explicación, cuando corresponda. Conclusión: 100–150 palabras. El número de celdas dependerá de los criterios y elementos seleccionados.

#### 2 — Infografías estáticas
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → pregunta orientadora → concepto clave → ideas principales → ejemplo aplicado → síntesis → fuentes
- **Extensión / límites:**
  > 1 pantalla vertical.
  > Título: 5–12 palabras.
  > Subtítulos: 3–7 palabras.
  > 4–6 bloques de 45–75 palabras.
  > Síntesis: 50–80 palabras.
  > Extensión total orientativa: 250–450 palabras.

#### 3 — Infografías interactivas
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → imagen contextualizada → puntos de exploración → explicación
- **Extensión / límites:**
  > Título: 5–12 palabras.
  > Introducción: 100–150 palabras.
  > 4–6 puntos interactivos con títulos de 3–7 palabras.
  > Explicación: 100–150 palabras por punto. Síntesis: 80–120 palabras.

#### 4 — Diagramas de flujo
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → inicio → pasos del proceso → decisión, si aplica → resultado → explicación breve
- **Extensión / límites:**
  > Título: 5–12 palabras. Introducción: 100–150 palabras. 8–12 nodos. Etiquetas: máximo 10 palabras por nodo. Explicación complementaria: 40–70 palabras por nodo cuando sea necesaria. Conclusión: 80–120 palabras.

#### 5 — Mapas conceptuales interactivos
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Concepto central → conceptos relacionados → conexiones explicadas → ejemplo
- **Extensión / límites:**
  > Título: 5–12 palabras.
  > 10–15 nodos y 2–4 niveles jerárquicos.
  > Conceptos visibles: 2–7 palabras por nodo.
  > Explicación: 35–60 palabras por concepto principal.
  > Ejemplo aplicado: 120–180 palabras.
  > Síntesis: 60–100 palabras.

#### 10 — Presentaciones multimedia interactivas
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Objetivo → explicación progresiva → ejemplos → síntesis
- **Extensión / límites:**
  > 10–15 diapositivas.
  > Título principal: 5–14 palabras.
  > Títulos de diapositiva: 5–10 palabras.
  > Desarrollo: 80–130 palabras por diapositiva de contenido, distribuidas entre texto visible y ampliaciones interactivas.
  > 2–3 interacciones.
  > Síntesis: 80–120 palabras.

#### 11 — Acordeones
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → pregunta o concepto → explicación breve por ítem → ejemplo
- **Extensión / límites:**
  > Título: 5–12 palabras.
  > Introducción: 80–120 palabras. 5–7 pestañas con títulos de 3–8 palabras.
  > Contenido: 80–120 palabras por pestaña, incluyendo ejemplos.
  > Ejemplos en al menos 2 pestañas.
  > Síntesis: 60–100 palabras.

#### 12 — Casos interactivos de diagnóstico
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → propósito del diagnóstico → contexto del caso → información y evidencias disponibles → identificación de indicadores → selección de hipótesis → retroalimentación → conclusión argumentada
- **Extensión / límites:**
  > Título: 5–15 palabras.
  > Contexto del caso: 500–750 palabras.
  > 4–6 evidencias de 50–100 palabras por evidencia textual.
  > 3–4 decisiones.
  > Retroalimentación: 70–110 palabras por decisión.
  > Conclusión: 150–200 palabras.

#### 13 — Simuladores de gestión por roles
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → rol y objetivo de gestión → contexto organizacional → recursos y restricciones → toma de decisiones por etapas → visualización de consecuencias → retroalimentación → reflexión final
- **Extensión / límites:**
  > Título: 5–15 palabras.
  > Escenario: 450–650 palabras.
  > 2–3 roles con descripciones de 60–100 palabras.
  > 3–4 rondas de decisión.
  > 2–4 variables de gestión. Retroalimentación: 80–120 palabras por ronda.
  > Cierre: 180–250 palabras.

#### 14 — Galerías
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → subtítulo → imagen → explicación → relación con el aprendizaje
- **Extensión / límites:**
  > Título: 5–12 palabras.
  > Subtítulos: 3–8 palabras.
  > Introducción: 80–120 palabras.
  > 4–6 elementos con descripciones de 90–140 palabras.
  > Síntesis: 80–120 palabras.

#### 15 — Libro de texto interactivo
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → propósito de lectura → índice navegable → desarrollo de contenidos por capítulos → recursos de apoyo → ejemplos aplicados → síntesis → referencias
- **Extensión / límites:**
  > Título: 5–15 palabras.
  > Títulos de capítulos: 5–12 palabras.
  > Introducción: 150–220 palabras. 3–5 capítulos o secciones de 700–1.000 palabras cada uno. 2–4 elementos interactivos.
  > Síntesis: 150–200 palabras.

#### 16 — Lecturas fundamentales diagramadas
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → propósito → introducción → desarrollo por apartados → ejemplo o caso → conclusión → referencias (Normas APA 7°)
- **Extensión / límites:**
  > Título: 5–18 palabras.
  > Subtítulos: 5–12 palabras.
  > Extensión total: 1.500–2.200 palabras, incluyendo introducción, desarrollo y conclusiones.
  > Introducción: 150–250 palabras.
  > Ejemplo: 200–350 palabras.
  > Conclusión: 150–220 palabras. 2-4 referencias pertinentes.

#### 17 — Tarjetas didácticas
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → propósito → instrucciones → conjunto de tarjetas con concepto o pregunta → respuesta o explicación al reverso → repaso → retroalimentación y cierre
- **Extensión / límites:**
  > Título: 5–12 palabras.
  > Propósito e instrucciones: 60–100 palabras en total.
  > 10–14 tarjetas.
  > Anverso: 5–15 palabras.
  > Reverso: 60–90 palabras, incluyendo ejemplo o aplicación.
  > Retroalimentación final: 80–120 palabras.

#### 18 — Líneas de tiempo dinámicas
- Categoría: Secuenciación y organización temporal. · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → acontecimientos relevantes → explicación
- **Extensión / límites:**
  > Título: 5–14 palabras.
  > Introducción: 80–120 palabras.
  > 6–10 acontecimientos históricos.
  > Nombre del acontecimiento: 5–10 palabras.
  > Explicación: 70–110 palabras por acontecimiento.
  > Síntesis: 100–150 palabras.


### Hoja «Actividades»

#### 1 — Toma de decisiones
- Categoría: Actividades de práctica · Uso recomendado: Complementaria
- **Estructura:**
  > Un escenario cotidiano o profesional, 2–3 decisiones y retroalimentación para cada opción.

#### 3 — Simulación de casos
- Categoría: Actividades de aplicación · Uso recomendado: Prioritario
- **Estructura:**
  > Un caso breve, 2–3 variables o decisiones y una conclusión justificada.

#### 4 — Clasificaciones
- Categoría: Actividades de práctica · Uso recomendado: Complementario
- **Estructura:**
  > 4-6 elementos, 3 categorías y criterio explícito de clasificación.

#### 5 — Cuestionario con retroalimentación
- Categoría: Actividades de práctica · Uso recomendado: Prioritario
- **Estructura:**
  > 5–8 preguntas sobre conceptos y comprensión, con explicación de las respuestas.

#### 6 — Estudio de caso
- Categoría: Actividades de aplicación · Uso recomendado: Complementario
- **Estructura:**
  > Caso de 300–500 palabras, 3–4 preguntas orientadoras y una respuesta argumentada breve.

#### 7 — Tarea
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Producto individual sencillo, instrucciones, criterios de evaluación y rúbrica breve.

#### 8 — Taller aplicado
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > 3–5 pasos, solución de un problema contextualizado y producto verificable.

#### 9 — Laboratorio virtual sencillo
- Categoría: Actividades de simulación · Uso recomendado: Prioritaria
- **Estructura:**
  > Explicación → situación → pasos guiados → comprobación → retroalimentación                                                                   2–4 pasos; retroalimentación breve por paso

#### 10 — Foros estructurados
- Categoría: Actividades de aplicación · Uso recomendado: Complementario
- **Estructura:**
  > -Presentación del tema y propósito del foro.
  > -Planteamiento de una situación educativa contextualizada.
  > -Formulación de preguntas orientadoras para el análisis y la reflexión pedagógica.
  > -Publicación de una intervención inicial argumentada con base en los contenidos estudiados.
  > -Interacción asincrónica mediante comentarios y aportes a las intervenciones de los compañeros.
  > -Construcción de conclusiones a partir de las diferentes perspectivas y experiencias educativas.
  > -Retroalimentación docente sobre la argumentación, participación y pertinencia pedagógica de los aportes.

#### 11 — Elaboración de guías de sensibilización
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → objetivo → contexto de sensibilización → destinatarios → mensajes clave → secuencia de actividades → producto final → criterios de revisión. Extensión: 1 guía de 2–3 páginas con 2-3 actividades breves.

#### 12 — Diagnóstico de una comunidad
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → propósito → caracterización de la comunidad → recolección de información → identificación de necesidades y recursos → análisis de hallazgos → diagnóstico → recomendaciones. Extensión: 1 comunidad o caso delimitado; 2–3 fuentes; informe de 500–700 palabras.

#### 13 — Diseño de una sección educativa
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → propósito formativo → destinatarios → contenido seleccionado → secuencia didáctica → recurso o actividad → evaluación breve → reflexión. Extensión: 1 sección de 2–3 momentos, con 2 actividades y 1 instrumento de verificación.

#### 14 — Planeación de una clase simulada
- Categoría: Actividades de simulación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → objetivo → contexto y grado escolar → resultados esperados → inicio → desarrollo → cierre → evaluación → autoevaluación de la clase simulada. Extensión: 1 planeación de 40–60 minutos, con 3 momentos y 2 criterios de evaluación.

#### 15 — Análisis de casos pedagógicos
- Categoría: Actividades de análisis · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → objetivo → presentación del caso pedagógico → evidencias y actores → identificación del problema → análisis de alternativas → decisión argumentada → retroalimentación. Extensión: 1 caso de 300–500 palabras; 3–4 preguntas orientadoras; respuesta de 200–300 palabras.

#### 16 — Registro de observación
- Categoría: Actividades de observación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → objetivo → contexto y foco de observación → categorías e indicadores → registro de evidencias → interpretación → conclusiones → reflexión ética. Extensión: 1 ficha con 2-4 indicadores, 4-6 registros observables y síntesis de 150–200 palabras.

#### 17 — Diseño de material educativo
- Categoría: Actividades de creación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → objetivo de aprendizaje → público destinatario → contenido central → selección del formato → elaboración del material → criterios de accesibilidad → prueba de uso → ajustes. Extensión: 1 recurso educativo con 3–5 componentes o secciones y ficha explicativa de 150–250 palabras.

#### 18 — Juego de roles
- Categoría: Actividades de simulación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → propósito → descripción del escenario → asignación de roles → reglas e instrucciones → interacción y decisiones → resultados → retroalimentación → reflexión. Extensión: 1 escenario; 3–4 roles; 2–3 rondas

#### 19 — Mapa de actores locales
- Categoría: Actividades de análisis · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → objetivo → delimitación del territorio o caso → identificación de actores → clasificación por función e influencia → mapa de relaciones → interpretación → conclusiones. Extensión: 1 mapa con 4-6 actores, 2 criterios de clasificación y explicación de 150–200 palabras.

#### 20 — Elaboración de esquemas conceptuales
- Categoría: Organización conceptual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → propósito → conceptos centrales → selección de ideas secundarias → jerarquización → conexiones justificadas → elaboración del esquema → síntesis. Extensión: 1 esquema de 6-10 conceptos con 2–3 niveles y 4–6 conexiones rotuladas.

#### 21 — Elaboración de fichas de lectura
- Categoría: Actividades de lectura y análisis · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → referencia de la lectura → propósito → ideas principales → conceptos relevantes → evidencia o cita breve → interpretación personal → conclusión. Extensión: 2–3 fichas, cada una de 150–200 palabras y vinculada con una lectura asignada.

#### 22 — Evaluación de una estrategia educativa-comunitaria
- Categoría: Evaluación aplicada · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → propósito → descripción de la estrategia educativa-comunitaria → criterios e indicadores → valoración de resultados → fortalezas y debilidades → propuesta de mejora. Extensión: 1 matriz de 4–6 criterios y un informe de 300–450 palabras.

#### 23 — Ordenar etapas del proceso disciplinar
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → objetivo → presentación de etapas del procedimiento → instrucciones → organización secuencial → comprobación → retroalimentación → síntesis. Extensión: 2–6 etapas por ordenar, 1 secuencia correcta y explicaciones breves para los errores.

#### 24 — Clasificación de faltas
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → objetivo → criterios de clasificación → presentación de situaciones o conductas → asignación de categorías → justificación → retroalimentación → cierre. Extensión: 3-5 situaciones, 3 categorías y retroalimentación fundamentada por respuesta.


### Hoja «Evaluaciones»

#### 1 — Evaluación formativa
- **Estructura:**
  > Una por unidad; 5–8 preguntas; varios intentos y retroalimentación inmediata.
- **Porcentajes:** Formativa 1: 25% Evaluación formativa 1 tema 1 y 2  · 2,5% Alguna de las actividades de autoaprendizaje del tema 1  · 2,5% Alguna de las actividades de autoaprendizaje del tema 2 · Formativa 2: 25% Evaluación formativa 2 tema 3 y 4 · 2,5% Alguna de las actividades de autoaprendizaje del tema 3  · 2,5% Alguna de las actividades de autoaprendizaje del tema 4

#### 2 — Evaluación sumativa
- **Estructura:**
  > Una por unidad; 8–10 preguntas o una tarea aplicada, según los resultados de aprendizaje.
- **Porcentajes:** Sumativa: 40%

#### 3 — Banco de preguntas
- **Estructura:**
  > 10–15 preguntas por unidad, vinculadas a resultados de aprendizaje y distintos niveles cognitivos.


### Recursos que NO son HTML (no van en esta guía)
Podcasts, Videos académicos estructurados, Videos de micro-learning.


---

# FORMACIÓN Especialización

Fuente: «Estructura RED - Especialización» (hojas RED, Actividades y Evaluaciones). Para cada recurso: qué secciones lleva y cuánto texto cabe. **Los máximos y rangos de palabras son los del recurso: la plantilla debe dejar espacio para el máximo y no romperse con el mínimo.**


### Hoja «RED»

#### 0 — *Diapositivas de presentación de la asignatura
- Categoría: Presentación · Uso recomendado: Obligatorio
- **Estructura:**
  > 1. Pantalla 1 — Bienvenida y contextualización: nombre de la asignatura, programa, periodo, créditos, modalidad y pregunta inicial sobre su importancia en el servicio.
  > 2. Pantalla 2 — ¿Qué aprenderás?: resultado de aprendizaje consignado en el syllabus, competencia del programa y relación con la práctica policial.
  > 3. Pantalla 3 — ¿Qué estudiarás?: Mención de los titulos de las unidades
  > 4. Pantalla 4 — ¿Cómo aprenderás?: recorrido por recursos, actividades y evaluaciones; orientaciones de navegación y primer paso para comenzar. No presentar porcentajes ni fechas sin aprobación.
- **Extensión / límites:**
  > • 4 pantallas
  > • Títulos: máximo 10 palabras.
  > • Texto visible recomendado:  110 - 160 palabras por pantalla.
  > • Interacciones: 1 exploración de unidades y navegación accesible.
  > • Información verificable: número de créditos, periodo o nivel, modalidad.
  > • Tiempo estimado de recorrido: 5 –10 minutos.
  > • Los criterios de evaluación, fechas y porcentajes se incluirán solo después de su aprobación.

#### 1 — Infografías estáticas
- Categoría: Representación y organización visual · Uso recomendado: Complementaria
- **Estructura:**
  > Una sola pantalla, formato vertical, no incluir botones, desplegables ni navegación interactiva
  > Titulo principal → Bloque: Activación cognitiva (pregunta o situación problema) → Bloque 2: Resultado de aprendizaje y relevancia académica → Bloque 3: Ruta del subtema (recurso, actividad y evaluación que siguen) → Bloque 4: Síntesis → Bloque 5: Referencias
- **Extensión / límites:**
  > 1 pantalla vertical
  > Título: 5-10 palabras
  > 4 –8 bloques
  > 80 –150 palabras por bloques
  > Síntesis de 70 – 90  palabras.

#### 2 — Infografías interactivas
- Categoría: Representación y organización visual · Uso recomendado: Complementaria
- **Estructura:**
  > Una sola visual
  > Título principal → Introducción → Instrucciones de navegación → Bloque 1: Fundamentación conceptual y teórica → Bloque 2: Desarrollo analítico → Bloque 3: Análisis comparativo → Bloque 4: Evidencia científica → Bloque 5: Aplicación → Bloque 6: Evaluación → Sintesis y referencia
- **Extensión / límites:**
  > 6 – 10 puntos interactivos
  > Introducción de 150–200 palabras.
  > 120–250 palabras por punto.
  > Síntesis de 90–150 palabras.

#### 3 — Matriz comparativa
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título de la matriz → Propósito y problema profesional → Criterios de comparación (normativos, técnicos y operativos) → Opciones, procedimientos o escenarios por columnas → Análisis de similitudes, diferencias y riesgos → Valoración sustentada en evidencia → Conclusión y recomendación para la toma de decisiones → Fuentes aplicables.
- **Extensión / límites:**
  > 1 matriz de 4–6 criterios y 3–4 alternativas o escenarios. • Celdas analíticas: 20–35 palabras cuando precisen explicación. • 1 síntesis comparativa de 120–180 palabras. • 1 decisión o recomendación profesional de 80–120 palabras. • Mínimo 2 fuentes normativas o técnicas verificables.

#### 4 — Diagramas de flujo
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Una sola composición visual, dirección de lectura definida, conexiones mediante flechas y simbolos                                                         Título del proceso → Nodo de inicio → Nodo de proceso → Nodo de decisión (SI- NO) → Nodo de finalización → Leyenda de símbolos → Nota de lectura
- **Extensión / límites:**
  > 10 –12 nodos.
  > Etiquetas de 6 –14 palabras.
  > Explicación de 50 –90 palabras por nodo.
  > Introducción de 150 – 200 palabras
  > Conclusión de 90 –130 palabras.

#### 5 — Mapas conceptuales interactivos
- Categoría: Representación y organización visual · Uso recomendado: Complementaria
- **Estructura:**
  > Título del mapa → Nodo central (raíz) → Palabra de enlace → Concepto de nivel 1 → Palabra de enlace → Concepto de nivel 2 → (Repetir hasta 3 niveles) → Ficha del nodo → Actividad de autoaprendizaje
- **Extensión / límites:**
  > 15 – 20 nodos
  > 4 – 6  niveles jerárquicos.
  > Explicación de 40 –80 palabras por concepto principal.
  > Ejemplo aplicado de 130–190 palabras.

#### 6 — Esquema gráfico
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del esquema → Pregunta o situación profesional de referencia → Concepto o procedimiento central → 3 a 5 componentes jerarquizados → Relaciones funcionales, causales o normativas entre componentes → Ejemplo de aplicación en el contexto profesional → Síntesis de implicaciones y decisión orientadora → Fuentes.
- **Extensión / límites:**
  > 1 composición visual por subtema. • 3–5 bloques principales y 2–3 niveles de organización. • Etiquetas: máximo 12 palabras. • Explicación por bloque: 25–40 palabras. • 1 ejemplo de aplicación de 60–90 palabras. • 1 síntesis de 40–60 palabras y fuentes pertinentes.

#### 7 — Análisis de los 5 porqués
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título y delimitación del problema → Descripción del incidente o hallazgo con evidencias → ¿Por qué? 1: causa inmediata → ¿Por qué? 2 → ¿Por qué? 3 → ¿Por qué? 4 → ¿Por qué? 5: causa raíz sustentada → Contraste con normas, procedimientos y datos → Acción correctiva o preventiva → Indicador de seguimiento y conclusión.
- **Extensión / límites:**
  > Problema profesional de 120–180 palabras. • 5 preguntas causales encadenadas, con respuestas de 30–50 palabras cada una. • 1 contraste con evidencias y normativa de 80–120 palabras. • 1 acción correctiva o preventiva con responsable e indicador. • Mínimo 1 referencia normativa o técnica verificable.

#### 12 — Escenario de toma de decisiones
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título y propósito → Contextualización de un dilema profesional → Rol del especialista y criterios normativos → Datos, restricciones y riesgos iniciales → Decisión 1: alternativas y consecuencias → Decisiones 2 y 3 condicionadas por las elecciones previas → Resultado del escenario → Retroalimentación argumentada sobre cumplimiento, impacto y riesgos → Reflexión final y transferencia a la práctica.
- **Extensión / límites:**
  > 1 escenario contextualizado de 200–300 palabras. • 2–3 puntos de decisión con 3 alternativas cada uno. • Consecuencias diferenciadas por elección. • Retroalimentación argumentada: 50–80 palabras por decisión. • 1 reflexión de transferencia profesional de 100–150 palabras. • Referencia normativa o técnica aplicable.

#### 13 — Presentaciones multimedia interactivas
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título académico del recurso → Presentación del subtema y resultado de aprendizaje → Pregunta problematizadora relacionada con el ejercicio profesional → Introducción y contextualización → Fundamentación conceptual, técnica y normativa → Desarrollo de contenidos, procedimientos y herramientas especializadas → Análisis de casos o situaciones profesionales → Interpretación y aplicación de criterios técnicos y normativos → Comparación de alternativas de solución → Aplicación de conocimientos a situaciones contextualizadas → Interacciones multimedia de profundización → Actividad de autoaprendizaje orientada a la resolución de problemas o toma de decisiones → Retroalimentación fundamentada → Síntesis y recomendaciones para la práctica profesional → Referencias.
- **Extensión / límites:**
  > 15 – 20 diapositivas.
  > 130 –190  palabras por diapositiva de contenido, con un concepto principal por pantalla.
  > 2–4 interacciones y síntesis final.

#### 14 — Acordeones
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Complementaria
- **Estructura:**
  > Funcionamiento: una sola interfaz con paneles expandibles y contraíbles. Cada pestaña presenta un contenido independiente, pero relacionado con el tema central.
  > Título principal → Introducción → Instrucción de navegación → Pestaña 1: Fundamentación conceptual → Pestaña 2: Enfoques teóricos → Pestaña 3: Desarrollo analítico → Pestaña 4: Evidencia investigativa → Pestañan 5: Análisis crítico → Pestaña 6: Aplicación → Sintesis y referencias bibliográficas
- **Extensión / límites:**
  > 7 – 9 ítems.
  > 120 –160 palabras por ítem.
  > Introducción de 120 –160 palabras.
  > Ejemplo o aplicación en al menos 3 ítems.

#### 15 — Microlecciones
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título de la microlección → Resultado de aprendizaje y pregunta retadora → Activación de saberes previos → Microcontenido conceptual y normativo → Ejemplo breve de aplicación en tránsito, aeronáutica, investigación criminal o gestión del riesgo → Interacción de comprobación → Retroalimentación explicativa → Síntesis y transferencia a una decisión profesional.
- **Extensión / límites:**
  > - 1 microlección de 5 a 7 pantallas. - 50–80 palabras por pantalla. - 1 caso breve de 100–150 palabras. - 2 a 3 interacciones de aplicación o análisis con retroalimentación. - Mín. 1 fuente técnico-normativa.

#### 16 — Galerías
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Complementaria
- **Estructura:**
  > Título principal → Subtítulo → Imagen → Contenido → (Repetir hasta 5 ítems)
- **Extensión / límites:**
  > 6 –8 elementos.
  > 140 –180  palabras por elemento.
  > Introducción de 140 –180 palabras
  > Síntesis de 140 –180  palabras.

#### 17 — Árbol de decisiones
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título y desafío profesional → Escenario inicial y marco normativo → Nodo de decisión 1 con alternativas → Consecuencias fundamentadas y bifurcaciones → Nodos de decisión 2 y 3 según el recorrido → Resultados finales diferenciados → Criterios de valoración: legalidad, evidencia, seguridad e impacto → Retroalimentación de cada ruta → Síntesis de la ruta recomendada.
- **Extensión / límites:**
  > - 1 árbol con 2 a 3 niveles de decisiones. - 2 a 3 alternativas por nodo. - 4 a 6 desenlaces o rutas relevantes, sin ramificaciones redundantes. - Descripción por nodo: 30–50 palabras. - Retroalimentación por desenlace: 60–90 palabras. - 1 matriz breve de criterios normativos.

#### 19 — Expedientes digitales simulados
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Titulo (Nombre del expediente y objetivo) → Contexto del caso simulado y marco normativo → Índice navegable de documentos → Registro de hechos y cronología → Evidencias documentales, gráficas y técnicas → Hallazgos e inconsistencias → Preguntas de análisis crítico y validación probatoria → Decisión profesional motivada → Retroalimentación sobre trazabilidad, legalidad y suficiencia de la evidencia.
- **Extensión / límites:**
  > - 1 expediente ficticio con 5 a 8 piezas documentales. - Contexto: 200–300 palabras. - Cada pieza: 80–150 palabras o equivalente visual accesible. - 3 a 5 preguntas de análisis con justificación. - 1 decisión fundamentada de 150–250 palabras. - Identificar normas y fuentes aplicables.

#### 20 — Lecturas fundamentales diagramadas
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Complementaria
- **Estructura:**
  > Título → Resumen (70–90 palabras) → Introducción → Desarrollo del tema aplicado → Subtítulo → Párrafo → Recuadro destacado (definición, caso o postura) → Bloque hotspot (glosario) → Conclusión → Referencias
- **Extensión / límites:**
  > 2.200 -  2,600 palabras por lectura.
  > Introducción, desarrollo argumentativo, ejemplos o casos, conclusiones
  > 3 –5 referencias pertinentes en APA 7.

#### 21 — Manuales y protocolos
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título, alcance y destinatario → Propósito y resultado de aprendizaje → Marco normativo vigente y jerarquía de fuentes → Condiciones de aplicación y responsables → Procedimiento por etapas con puntos de control → Criterios técnicos, evidencias y registros requeridos → Alertas, excepciones y gestión del riesgo → Lista de verificación operativa → Caso de aplicación → Referencias y fecha de actualización.
- **Extensión / límites:**
  > • 1 manual o protocolo con 4–6 secciones. • Extensión total: 1.000–1.400 palabras. • 5–8 pasos procedimentales, con responsables y evidencias. • 1 lista de verificación de 6–10 criterios. • 1 caso de aplicación de 150–200 palabras. • Mínimo 2 referencias normativas o técnicas verificables y fecha de actualización.

#### 22 — Casos de estudio
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del caso → Propósito y competencia profesional → Contextualización institucional y antecedentes → Hechos, actores y evidencia disponible → Problema o dilema central → Normativa y criterios técnicos aplicables → Preguntas de análisis y opciones de actuación → Comparación argumentada de alternativas → Decisión justificada y plan de acción → Consecuencias, lecciones y referencias.
- **Extensión / límites:**
  > • 1 caso ficticio o anonimizado de 400–600 palabras. • 3–5 piezas de información o evidencia. • 3–5 preguntas de análisis y aplicación normativa. • 2–3 alternativas de actuación justificables. • Orientación de respuesta o retroalimentación de 250–350 palabras. • Mínimo 2 referencias verificables.

#### 23 — Líneas de tiempo dinámicas
- Categoría: Secuenciación y organización temporal. · Uso recomendado: Complementaria
- **Estructura:**
  > Título general → Fecha → Suceso → Explicación → (Repetir hasta 8 eventos) → Actividad de autoaprendizaje
- **Extensión / límites:**
  > 10 –14 acontecimientos históricos.
  > Título de cada acontecimiento de 10 –14 palabras.
  > Explicación de 110 –140 palabras por acontecimiento.
  > Síntesis final de 150–200 palabras.


### Hoja «Actividades»

#### 1 — Casos ramificados de una gestión de una emergencia
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre del caso → Objetivo de aprendizaje → Escenario de emergencia y roles → Información inicial → Decisión 1 con opciones → Consecuencias y retroalimentación → Nuevos datos → Decisión 2 → Desenlace de la ruta → Reflexión y recomendaciones.
- **Extensión / límites:**
  > • 1 situación de emergencia simulada.
  > • 2–4 puntos de decisión con 3 opciones cada uno.
  > • Contexto inicial: 180–250 palabras.
  > • Retroalimentación para cada alternativa: 50–80 palabras.
  > • 1 reflexión final de 100–150 palabras y criterios de actuación.

#### 2 — Cuestionario sobre normas
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Propósito y norma de referencia → Instrucciones → Situación de tránsito contextualizada → Pregunta numerada → Opciones → Respuesta correcta → Explicación normativa y retroalimentación → Puntaje y cierre.
- **Extensión / límites:**
  > • 5–8 preguntas, priorizando aplicación normativa.
  > • 4 opciones con una única respuesta correcta por pregunta.
  > • Enunciados de 50–90 palabras cuando haya caso.
  > • Retroalimentación: 40–70 palabras por pregunta.
  > • Citar la disposición vigente aplicable y su fecha de consulta.

#### 3 — Reconocimiento de huellas
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Objetivo → Contexto técnico → Imagen o registro simulado de huella → Indicaciones de observación → Identificación de rasgos y correspondencias → Selección o marcación de hallazgos → Respuesta correcta → Retroalimentación técnica.
- **Extensión / límites:**
  > • 3–5 imágenes o registros simulados de huellas, de calidad suficiente.
  > • 4–6 ítems de identificación o comparación.
  > • Instrucciones: 100–150 palabras.
  > • Retroalimentación específica por ítem: 40–70 palabras.
  > • Imágenes con texto alternativo y sin datos personales.

#### 4 — Completar un informe
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Objetivo → Contexto de accidente simulado → Formato de informe con campos incompletos → Documentos y datos de apoyo → Diligenciamiento de campos → Verificación de consistencia → Modelo de respuesta → Retroalimentación sobre integridad y trazabilidad.
- **Extensión / límites:**
  > • 1 caso ficticio contextualizado: 200–300 palabras.
  > • 8–12 campos por completar (hechos, fecha, evidencias, análisis y conclusiones).
  > • 2–4 anexos simulados de soporte.
  > • Lista de cotejo de 5–8 criterios.
  > • Incluir modelo de informe y retroalimentación por errores frecuentes.

#### 5 — Análisis de una escena
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Propósito → Presentación de la escena simulada → Registro visual o descripción detallada → Observación guiada → Identificación de indicios → Hipótesis explicativas → Contraste con datos → Conclusiones y retroalimentación.
- **Extensión / límites:**
  > • 1 escena simulada y 3–5 evidencias contextualizadas.
  > • 4–6 preguntas orientadoras de observación y análisis.
  > • Descripción de escena: 200–300 palabras.
  > • Respuesta argumentada: 150–250 palabras.
  > • Retroalimentación con criterios de pertinencia, conservación y trazabilidad.

#### 6 — Identificación de elementos probatorios
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Objetivo → Escenario de investigación simulado → Presentación de elementos materiales probatorios y evidencias físicas → Observación e identificación → Clasificación según naturaleza y pertinencia → Análisis de integridad y trazabilidad → Justificación técnica → Retroalimentación.
- **Extensión / límites:**
  > • 1 escenario simulado de 200–300 palabras.
  > • 4–6 elementos probatorios para identificar y clasificar.
  > • 4–6 preguntas de análisis técnico.
  > • Justificación argumentada de 150–250 palabras.
  > • Retroalimentación de 40–70 palabras por ítem.

#### 7 — Plan de mitigación
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Objetivo → Escenario de riesgo → Identificación de amenazas y vulnerabilidades → Valoración de probabilidad e impacto → Medidas preventivas y correctivas → Responsables e indicadores → Cronograma → Entregable y rúbrica.
- **Extensión / límites:**
  > • 1 situación profesional contextualizada.
  > • Matriz de 4–6 riesgos con probabilidad, impacto y control.
  > • 3–5 acciones de mitigación priorizadas.
  > • Plan escrito de 500–700 palabras, más matriz.
  > •Rúbrica de 4–5 criterios: viabilidad, trazabilidad, prioridad y coherencia.

#### 8 — Simulación de toma de decisiones bajo presión
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Objetivo → Escenario crítico contextualizado → Roles y condiciones operacionales → Presentación de información inicial → Decisiones secuenciales bajo presión → Alternativas de actuación → Consecuencias de cada decisión → Retroalimentación técnica → Evaluación del desempeño → Reflexión final.
- **Extensión / límites:**
  > • 1 escenario profesional simulado de 200–300 palabras.
  > • 3–4 momentos de decisión.
  > • 3 alternativas por decisión.
  > • Consecuencias operacionales diferenciadas.
  > • Retroalimentación de 50–70 palabras por decisión                                • Reflexión final de 100–150 palabras.

#### 9 — Desarrollo de plan de contingencia
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Objetivo → Evento crítico hipotético → Análisis de impacto y continuidad → Objetivos de respuesta → Roles y rutas de comunicación → Procedimientos y recursos → Fases de activación, respuesta y recuperación → Indicadores → Plan y rúbrica.
- **Extensión / límites:**
  > • 1 escenario de contingencia.
  > • 4 fases de actuación como mínimo.
  > • 3–5 responsables o funciones y 3–5 recursos críticos.
  > • Plan de 600–900 palabras más tabla de responsabilidades.
  > • 4–6 indicadores o puntos de verificación y rúbrica analítica.

#### 10 — Análisis de la causa-raíz (Los 5 porqués)
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Objetivo → Descripción del incidente → Definición del problema → ¿Por qué? 1 → ¿Por qué? 2 → ¿Por qué? 3 → ¿Por qué? 4 → ¿Por qué? 5 → Causa raíz sustentada → Acción correctiva y retroalimentación.
- **Extensión / límites:**
  > • 1 incidente o problema profesional contextualizado de 200–300 palabras.
  > • 5 niveles sucesivos de análisis causal.
  > • 1 diagrama o esquema de relaciones causa-efecto.
  > • 1 causa raíz sustentada con evidencias.
  > • 2–3 acciones correctivas justificadas.                                                                  • Retroalimentación de 50–70 palabras.

#### 11 — Clasificación de riesgo según su nivel de gravedad
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Objetivo → Escenario y catálogo de riesgos → Definición de escalas → Valoración de probabilidad y consecuencia → Clasificación por niveles → Priorización → Controles recomendados → Retroalimentación.
- **Extensión / límites:**
  > • 1 escenario profesional con 6–8 riesgos simulados.
  > • Matriz de clasificación de 3–5 niveles de gravedad.
  > • 2 variables mínimas: probabilidad e impacto.
  > • 4–6 preguntas de justificación de la clasificación.
  > • Criterios, respuestas modelo y retroalimentación para los casos críticos.

#### 12 — Elaboración de informes diagnostico
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Objetivo → Contexto profesional → Presentación del caso y evidencias → Lineamientos técnicos y normativos → Estructura del informe → Registro y análisis de información → Hallazgos → Conclusiones y recomendaciones → Verificación de integridad y trazabilidad → Entrega y rúbrica.
- **Extensión / límites:**
  > • 1 caso profesional contextualizado de 200–300 palabras.
  > • 2–4 documentos o registros de soporte.
  > • Informe técnico de 800–1.200 palabras.
  > • 4–6 apartados estructurados.
  > • 3–5 hallazgos o conclusiones sustentadas.                                                      • Rúbrica analítica de 4–5 criterios.

#### 13 — Análisis de protocolos de atención a emergencias
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Objetivo → Caso práctico de atención de emergencias → Protocolo de referencia y criterios → Secuencia de actuación esperada → Comparación de actuaciones → Identificación de cumplimiento y desviaciones → Propuesta de ajustes → Conclusión y retroalimentación.
- **Extensión / límites:**
  > • 1 caso hipotético: 200–300 palabras.
  > • 1–2 protocolos oficiales de referencia.
  > • Lista de cotejo o matriz de 6–8 criterios.
  > • 3 preguntas orientadoras de análisis aplicado.
  > • Conclusión: 200–300 palabras, con retroalimentación y fuentes.

#### 14 — Toma de decisiones
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Descripción → Escenario → Decisión 1 → Opciones → Consecuencia y retroalimentación → (Repetir) → Resultado final
- **Extensión / límites:**
  > - 1 escenario contextualizado - 2 a 3 puntos de decisión - 3 opciones por decisión - Retroalimentación por consecuencia

#### 15 — Simulaciones de casos
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Explicación breve → Contexto o situación de partida → Planteamiento → Simulación (controles → resultados) → Retroalimentación → Informe de gestión → Rúbrica
- **Extensión / límites:**
  > - 1 caso contextualizado - 2 a 3 variables o controles - Resultados visibles y retroalimentación- Rúbrica publicada con la consigna

#### 16 — Cuestionarios con retroalimentación
- Categoría: Actividades de práctica · Uso recomendado: Complementaria
- **Estructura:**
  > Nombre de la actividad → Descripción → Nº de pregunta → Enunciado → Respuestas → Respuesta correcta → Retroalimentación
- **Extensión / límites:**
  > - 4 a 5 preguntas - Tipos: única, múltiple, falso/verdadero - Retroalimentación por cada opción

#### 17 — Estudios de casos
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre del reto → Objetivo (V+O+C) → Caso práctico → Preguntas orientadoras → Pasos a seguir → Estructura de entrega → Criterios
- **Extensión / límites:**
  > - Caso: 300–500 palabras - 3 a 5 preguntas orientadoras aplicadas - Entrega: 800–1.200 palabras - Rúbrica analítica

#### 18 — Tareas
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre del reto → Objetivo (V+O+C) → Descripción del entregable → Pasos a seguir → Formato de entrega → Criterios evaluativos
- **Extensión / límites:**
  > - Producto individual aplicado (ej. informe ejecutivo, análisis normativo) - Formato, extensión y etiquetado definidos - Rúbrica analítica

#### 19 — Talleres aplicados
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre del taller → Objetivo (V+O+C) → Contexto de práctica → Pasos a seguir (numerados) → Producto esperado → Estructura de entrega
- **Extensión / límites:**
  > - 3 a 5 pasos numerados - Producto aplicado a un problema del entorno real - Formato definido y estructurado - Rúbrica analítica

#### 20 — Laboratorios virtuales
- Categoría: Actividad de Aplicacion · Uso recomendado: Prioritaria
- **Estructura:**
  > Explicación breve del entorno → Planteamiento del problema/caso → Ejecución por pasos (Manipular → Comprobar) → Retroalimentación del sistema → Generación de reporte de resultados del estudiante
- **Extensión / límites:**
  > - Instrucciones y consigna clara - Práctica guiada: 2 a 4 pasos de manipulación de datos/variables - Retroalimentación del entorno: 30 a 50 palabras - Reporte final descargable o entregable breve

#### 21 — Foros estructurados
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Presentación del tema y propósito del foro → Planteamiento de una situación profesional contextualizada → Formulación de preguntas orientadoras para el análisis crítico y técnico-normativo → Publicación de una intervención inicial argumentada con fundamentos académicos, técnicos y normativos → Interacción asincrónica mediante aportes a las intervenciones de los compañeros → Construcción de conclusiones a partir de diferentes perspectivas y experiencias profesionales → Retroalimentación docente sobre la argumentación, pertinencia normativa y aplicabilidad de las propuestas.
- **Extensión / límites:**
  > • 1 situación profesional contextualizada.
  > • 2–3 preguntas orientadoras de análisis técnico y normativo.
  > • Intervención inicial argumentada: 200–250 palabras.
  > • 2 réplicas a compañeros: 70–100 palabras cada una.
  > • Sustentación en fuentes académicas, técnicas o normativas pertinentes. •Duración estimada: 25–35 minutos de participación activa asincrónica.


### Hoja «Evaluaciones»

#### 1 — Evaluación formativa
- **Estructura:**
  > Nombre → Resultado de aprendizaje evaluado → Instrucciones → Pregunta → Opciones → Retroalimentación formativa → Recomendación de repaso
- **Extensión / límites:**
  > - 1 por unidad - 6 a 8 preguntas tomadas del banco - Intentos múltiples con retroalimentación inmediata
- **Porcentajes:** Formativa 1: 25% Evaluación formativa 1 tema 1 y 2  · 2,5% Alguna de las actividades de autoaprendizaje del tema 1  · 2,5% Alguna de las actividades de autoaprendizaje del tema 2 · Formativa 2: 25% Evaluación formativa 2 tema 3 y 4 · 2,5% Alguna de las actividades de autoaprendizaje del tema 3  · 2,5% Alguna de las actividades de autoaprendizaje del tema 4

#### 2 — Evaluación sumativa
- **Estructura:**
  > Nombre → Resultado de aprendizaje evaluado → Instrucciones → Caso o pregunta → Opciones o espacio de respuesta → Calificación en el LMS
- **Extensión / límites:**
  > - Al finalizar cada unidad - 8 a 10 preguntas tomadas del banco - Escala 0,00 a 5,00; aprobatoria 3,50 - Máx. 1 a 2 intentos
- **Porcentajes:** Sumativa: 40%

#### 3 — Banco de preguntas
- **Estructura:**
  > Pregunta → Unidad y subtema → Resultado de aprendizaje → Nivel de Bloom (Priorizar Aplicación y Análisis) → Enunciado → Opciones → Respuesta → Retroalimentación
- **Extensión / límites:**
  > - Mín. 2 preguntas por cada pregunta presentada - Casos de estudio cortos en los enunciados - Retroalimentación por opción


### Recursos que NO son HTML (no van en esta guía)
Podcasts, Videos académicos estructurados, Videos de micro-learning.


---

# FORMACIÓN Doctorado

Fuente: «Estructura RED - Doctorado» (hojas RED, Actividades y Evaluaciones). Para cada recurso: qué secciones lleva y cuánto texto cabe. **Los máximos y rangos de palabras son los del recurso: la plantilla debe dejar espacio para el máximo y no romperse con el mínimo.**


### Hoja «RED»

#### 0 — *Diapositivas de presentación de la asignatura
- Categoría: Presentación · Uso recomendado: Obligatorio
- **Estructura:**
  > 1. Pantalla 1 — Bienvenida y contextualización: nombre de la asignatura, programa, periodo, créditos, modalidad y pregunta inicial sobre su importancia en el servicio.
  > 2. Pantalla 2 — ¿Qué aprenderás?: resultado de aprendizaje consignado en el syllabus, competencia del programa y relación con la práctica policial.
  > 3. Pantalla 3 — ¿Qué estudiarás?: Mención de los titulos de las unidades
  > 4. Pantalla 4 — ¿Cómo aprenderás?: recorrido por recursos, actividades y evaluaciones; orientaciones de navegación y primer paso para comenzar. No presentar porcentajes ni fechas sin aprobación.
- **Extensión / límites:**
  > • 4 pantallas
  > • Títulos: máximo 10 palabras.
  > • Texto visible recomendado: 160–200 palabras por pantalla.
  > • Interacciones: 1 exploración de unidades y navegación accesible.
  > • Información verificable: número de créditos, periodo o nivel, modalidad.
  > • Tiempo estimado de recorrido: 10–12 minutos.
  > • Los criterios de evaluación, fechas y porcentajes se incluirán solo después de su aprobación.

####  — Cuaderno interactivo de análisis de datos
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título académico → Propósito y pregunta investigativa → Descripción y procedencia del conjunto de datos → Instrucciones de navegación → Módulo 1: Importación, limpieza y trazabilidad → Módulo 2: Exploración y visualización de patrones → Módulo 3: Selección y fundamentación de técnicas analíticas → Módulo 4: Análisis reproducible y contraste de hipótesis o categorías → Módulo 5: Interpretación crítica, sesgos y limitaciones → Síntesis de hallazgos → Referencias y fuentes de datos.
- **Extensión / límites:**
  > Título académico → Propósito y pregunta investigativa → Descripción y procedencia del conjunto de datos → Instrucciones de navegación → Módulo 1: Importación, limpieza y trazabilidad → Módulo 2: Exploración y visualización de patrones → Módulo 3: Selección y fundamentación de técnicas analíticas → Módulo 4: Análisis reproducible y contraste de hipótesis o categorías → Módulo 5: Interpretación crítica, sesgos y limitaciones → Síntesis de hallazgos → Referencias y fuentes de datos.

####  — Pósteres científicos digitales interactivos
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título científico → Autoría e identificación del estudio → Pregunta, problema y aporte al conocimiento → Contexto y antecedentes esenciales → Objetivos → Diseño metodológico y consideraciones éticas → Hallazgos con gráficos y tablas → Discusión e interpretación → Aporte original, alcances y limitaciones → Conclusiones e implicaciones → Puntos interactivos de profundización → Fuentes y referencias verificables.
- **Extensión / límites:**
  > - 1 póster digital navegable, legible en computador y dispositivo móvil.
  > - 6 a 8 secciones visuales distribuidas jerárquicamente.
  > - Contenido visible total: 600–900 palabras, excluidas referencias.
  > - 4 a 6 elementos interactivos; ampliación de 70–110 palabras cada uno.
  > - 2 a 4 figuras, tablas o gráficos con títulos y fuentes.
  > - 8 a 12 referencias pertinentes y accesibles; incluir texto alternativo de gráficos.

#### 1 — Infografías estáticas
- Categoría: Representación y organización visual · Uso recomendado: Complementaria
- **Estructura:**
  > Titulo principal → Bloque 1: Activación cognitiva (pregunta o situación problema) → Bloque 2: Resultado de aprendizaje y relevancia académica → Bloque 3: Tema central  → Bloque 4: Marco de análisis y pregunta orientadora (contexto policial y enfoque de derechos humanos) →  Bloque 5: Sintesis → Bloque 6: Referencias
- **Extensión / límites:**
  > 1 pantalla vertical
  > Título: 5-10 palabras
  > 6  bloques
  > 90–200 palabras por bloques
  > Síntesis de 80–150 palabras.

#### 2 — Infografías interactivas
- Categoría: Representación y organización visual · Uso recomendado: Complementaria
- **Estructura:**
  > Título principal → Introducción → Bloque 1: Fundamentación conceptual y teórica → Bloque 2: Desarrollo analítico → Bloque 3: Análisis comparativo → Bloque 4: Evidencia científica → Bloque 5: Aplicación → Bloque 6: Evaluación → Sintesis y referencia
- **Extensión / límites:**
  > 8–12 puntos interactivos
  > Introducción de 200–300 palabras.
  > 200–300 palabras por punto.
  > Síntesis de 150–250 palabras.

#### 3 — Diagramas de flujo
- Categoría: Representación y organización visual · Uso recomendado: Complementaria
- **Estructura:**
  > Título → inicio → pasos del proceso → decisión, si aplica → resultado → explicación breve
- **Extensión / límites:**
  > 10–14 nodos.
  > Etiquetas de 8–16 palabras.
  > Explicación de 110–160 palabras por nodo.
  > Introducción de 200–250 palabras
  > Conclusión de 130–200 palabras.

#### 4 — Mapas conceptuales interactivos
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del mapa → Introducción → Concepto central → Nivel 1: Conceptos principales → Nivel 2: subconceptos → Nivel 3: profundización interactiva → Conexiones cruzadas → Análisis comparativo  → Síntesis crítica → Referencias bibliográficas
- **Extensión / límites:**
  > 20–25 nodos
  > 6–8  niveles jerárquicos.
  > Explicación de 80–150 palabras por concepto principal.
  > Ejemplo aplicado de 190–220 palabras.

####  — Secuencias ilustradas de fases de un diseño
- Categoría: Representación y organización visual · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del diseño → Propósito investigativo → Fundamentación conceptual y selección del enfoque → Secuencia visual de fases → Fase 1: Problematización → Fase 2: Diseño teórico-metodológico → Fase 3: Selección y validación de instrumentos o fuentes → Fase 4: Producción y análisis de evidencias → Fase 5: Interpretación, reflexividad y revisión → Fase 6: Comunicación de resultados → Conexiones entre fases y decisiones → Análisis de alternativas y límites → Síntesis y referencias.
- **Extensión / límites:**
  > - 1 secuencia ilustrada de 6 a 8 fases (ajustable al tipo de diseño).
  > - Título principal: máximo 90 caracteres.
  > - Cada fase: rótulo de 6–12 palabras y explicación de 65–95 palabras.
  > - 1 ilustración o esquema por fase, con texto alternativo.
  > - 2 a 3 puntos de decisión, retorno o revisión.
  > - Síntesis crítica: 100–150 palabras y al menos 3 referencias académicas.

####  — Videos académicos estructurados
- Categoría: Recursos audiovisuales y sonoros · Uso recomendado: Prioritaria
- **Estructura:**
  > Título académico → Presentación del propósito y resultado de aprendizaje → Pregunta problematizadora → Contextualización científica → Fundamentación epistemológica y conceptual → Desarrollo teórico organizado por bloques → Análisis comparativo de enfoques científicos → Presentación e interpretación de evidencias → Aplicación en un problema investigativo → Discusión crítica de hallazgos y limitaciones → Preguntas de reflexión doctoral → Síntesis argumental → Referencias bibliográficas.
- **Extensión / límites:**
  > Duración de 20–25 minutos.
  > Guion de 2.000–2.500 palabras. Incluye contextualización, desarrollo conceptual, ejemplo aplicado, análisis y síntesis.

####  — Podcasts
- Categoría: Recursos audiovisuales y sonoros · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del episodio → Presentación del propósito académico → Pregunta investigativa orientadora → Contextualización del problema científico → Introducción de perspectivas teóricas → Desarrollo argumentativo del tema → Análisis crítico de enfoques y evidencias → Discusión de controversias científicas → Ejemplificación en contextos investigativos o profesionales → Reflexión epistemológica y metodológica → Formulación de preguntas para profundización → Síntesis de aportes
- **Extensión / límites:**
  > Duración de 20–30 minutos.
  > Guion de 2.500–3.500 palabras.
  > Introducción, análisis conceptual, ejemplos, reflexión aplicada y conclusiones.

####  — Escenarios de toma de decisiones
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > Título y propósito formativo → Problema complejo situado → Contexto, actores y normativa pertinente → Evidencias iniciales y restricciones → Instrucciones de navegación → Decisión 1: diagnóstico y alternativas → Consecuencias argumentadas y retroalimentación → Decisiones sucesivas: evaluación de riesgos, dilemas y compensaciones → Comparación de rutas y resultados → Justificación científica y ética de la decisión final → Reflexión metacognitiva → Síntesis y referencias.
- **Extensión / límites:**
  > - 1 escenario ramificado sobre problema profesional o de investigación doctoral.
  > - 3 a 5 puntos de decisión vinculados entre sí.
  > - 3 alternativas razonadas por decisión, sin respuestas trivialmente evidentes.
  > - Contextualización inicial: 250–350 palabras.
  > - Retroalimentación por opción: 80–120 palabras, con consecuencias y fuentes.
  > - Reflexión final: 180–250 palabras; considerar normativa, incertidumbre y dilemas éticos.

####  — Presentaciones multimedia interactivas
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Prioritaria
- **Estructura:**
  > -Título principal:
  > -Título por diapositiva:
  > -Contenido temático:caracteres por diapositiva, distribuidos entre contenido visible y ampliaciones interactivas.
  > - 4 a 6 bloques académicos: fundamentación epistemológica, desarrollo teórico, análisis comparativo, evidencia científica, aplicación investigativa y síntesis crítica.
  > -1 a 2 elementos visuales por diapositiva, según pertinencia.
  > - 5 a 8 interacciones de profundización distribuidas estratégicamente.
  > - 2 a 3 preguntas de análisis crítico o problematización.
- **Extensión / límites:**
  > 20–25 diapositivas.
  > 200–250 palabras por diapositiva de contenido, con un concepto principal por pantalla.
  > 4–6 interacciones y síntesis final.

####  — Acordeones
- Categoría: Experiencias multimedia interactivas · Uso recomendado: Complementaria
- **Estructura:**
  > Funcionamiento: una sola interfaz con paneles expandibles y contraíbles. Cada pestaña presenta un contenido independiente, pero relacionado con el tema central.
  > Título principal → Introducción → Pestaña 1: Fundamentación conceptual → Pestaña 2: Enfoques teóricos → Pestaña 3: Desarrollo analítico → Pestaña 4: Evidencia investigativa → Pestaña 5: Análisis crítico → Pestaña 6: Aplicación → Síntesis y referencias bibliográficas
- **Extensión / límites:**
  > 10–15 ítems.
  > 160–200 palabras por ítem.
  > Introducción de 160 –200 palabras.
  > Ejemplo o aplicación en al menos 4 ítems.

####  — Matriz de revisión literaria
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título y pregunta de revisión → Alcance conceptual y criterios de elegibilidad → Bases de datos y estrategia de búsqueda → Registro de referencias y trazabilidad → Matriz de fuentes seleccionadas → Campos analíticos: autoría, año, enfoque, teoría, método, muestra o corpus, hallazgos y limitaciones → Comparación de convergencias y contradicciones → Identificación de vacíos y debates epistemológicos → Síntesis crítica y proyección investigativa → Referencias APA 7.
- **Extensión / límites:**
  > - 1 matriz analítica de revisión literaria.
  > - 20 a 30 publicaciones científicas pertinentes, como referencia orientativa.
  > - 8 a 10 campos analíticos por publicación.
  > - 3 a 5 categorías de análisis teórico, epistemológico o metodológico.
  > - 1 síntesis crítica de 1.000–1.500 palabras.
  > - Identificación de 3 a 5 vacíos, debates o contradicciones científicas.
  > - Referencias en normas APA 7 y trazabilidad de las fuentes.

####  — Lecturas fundamentales diagramadas
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título → Resumen (90–110 palabras) → Introducción → Desarrollo del tema → Subtítulo → Párrafo → (Recurso visual) → Recuadro destacado (definición, caso o postura) → Bloque hotspot (glosario) → Conclusión → Referencias
- **Extensión / límites:**
  > 2.600–3.000 palabras por lectura.
  > Introducción, desarrollo argumentativo, ejemplos o casos, conclusiones
  > 3–5 referencias pertinentes en APA 7.

####  — Líneas de tiempo dinámicas
- Categoría: Secuenciación y organización temporal. · Uso recomendado: Complementaria
- **Estructura:**
  > Título principal → Introducción → Eje cronológico interactivo → Hitos seleccionables → Información ampliada por hito → Relaciones sobre acontecimientos → Análisis comparativo → Síntesis final
- **Extensión / límites:**
  > 14–18 acontecimientos históricos.
  > Título de cada acontecimiento de 14–20 palabras.
  > Explicación de 140–170 palabras por acontecimiento.
  > Síntesis final de 200–250 palabras.


### Hoja «Actividades»

#### 1 — Investigación sobre las causas de la inseguridad en diferentes territorios
- Categoría: Actividades de investigación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título de la investigación → Propósito y pregunta orientadora → Delimitación territorial → Contextualización sociohistórica y normativa → Identificación de fuentes primarias y secundarias → Diseño metodológico y criterios éticos → Recolección y triangulación de evidencias → Análisis multicausal de factores de inseguridad → Hallazgos contrastados → Conclusiones y recomendaciones → Referencias APA 7 → Rúbrica analítica
- **Extensión / límites:**
  > - 1 territorio delimitado y 1 pregunta investigativa central - 3 a 5 dimensiones de análisis territorial - 8 a 12 fuentes científicas e institucionales verificables - Informe: 2.500–3.500 palabras (sin referencias y anexos) - 2 a 4 tablas, mapas o visualizaciones sustentadas - Rúbrica: rigor metodológico, triangulación, ética y pertinencia

#### 2 — Investigación comparativa entre territorios.
- Categoría: Actividades de investigación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del estudio comparado → Objetivo y justificación → Selección fundamentada de 2 o 3 territorios → Matriz de indicadores y fuentes comparables → Criterios de calidad y ética del dato → Análisis de convergencias y divergencias → Discusión de explicaciones alternativas → Implicaciones para políticas de seguridad y convivencia → Conclusiones → Referencias APA 7 → Rúbrica analítica
- **Extensión / límites:**
  > - 2 a 3 territorios contrastados - 5 a 8 indicadores comparables y definidos - 10 a 15 fuentes científicas, estadísticas e institucionales - Informe comparativo: 3.000–4.000 palabras - 1 matriz comparativa y 2 a 3 visualizaciones - Discusión explícita de limitaciones y sesgos

#### 3 — Formulación de un problema de investigación
- Categoría: Actividades de investigación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título provisional → Contexto y antecedentes → Identificación del vacío de conocimiento → Delimitación conceptual, poblacional, espacial y temporal → Formulación de la pregunta doctoral → Justificación científica y pertinencia social → Objetivo general y objetivos específicos → Supuestos o hipótesis, cuando aplique → Viabilidad y consideraciones éticas → Referencias APA 7 → Rúbrica analítica
- **Extensión / límites:**
  > - Planteamiento: 1.500–2.000 palabras - 1 pregunta central y 3 a 5 subpreguntas, si procede - 1 objetivo general y 3 a 5 objetivos específicos - 10 a 15 referencias académicas pertinentes - 1 matriz de coherencia problema–pregunta–objetivos - Explicitar alcance, vacío investigativo y viabilidad

#### 4 — Elaboración de artículos
- Categoría: Actividades de producción científica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título académico → Resumen estructurado y palabras clave → Introducción y problema de investigación → Marco teórico y estado del arte → Método y consideraciones éticas → Resultados o hallazgos → Discusión crítica y aporte original → Conclusiones, limitaciones y líneas futuras → Referencias APA 7 o norma de la revista → Lista de verificación y rúbrica
- **Extensión / límites:**
  > - Artículo científico: 5.000–7.000 palabras (ajustable a la revista) - Resumen: 200–250 palabras y 4 a 6 palabras clave - 25 a 40 referencias pertinentes y verificables - 3 a 5 tablas o figuras si los resultados lo requieren - Declaración de originalidad, ética y limitaciones - Producto entregable: manuscrito y revista objetivo

#### 5 — Matriz de estado del arte
- Categoría: Actividades de investigación · Uso recomendado: Prioritaria
- **Estructura:**
  > Propósito de revisión → Pregunta y alcance temático → Palabras clave y ecuaciones de búsqueda → Bases de datos y criterios de selección → Registro bibliográfico → Matriz analítica de autores, enfoques, métodos, hallazgos y vacíos → Contraste crítico de tendencias y controversias → Síntesis del estado del arte → Referencias APA 7 → Rúbrica analítica
- **Extensión / límites:**
  > - 20 a 30 publicaciones científicas pertinentes - Matriz: 8 a 10 campos analíticos por registro - Ventana temporal argumentada y trazabilidad de búsqueda - Síntesis crítica: 1.500–2.000 palabras - Identificar al menos 3 vacíos o controversias - Entrega: matriz editable y síntesis académica

#### 6 — Revisión sistemática guiada
- Categoría: Actividades de investigación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título y pregunta de revisión → Protocolo y criterios de elegibilidad → Estrategia de búsqueda reproducible → Fuentes y periodo de búsqueda → Cribado y registro de exclusiones → Extracción y evaluación de calidad → Síntesis temática o de evidencia → Riesgos de sesgo y limitaciones → Conclusiones → Referencias → Anexos y rúbrica analítica
- **Extensión / límites:**
  > - Consulta de mínimo 2 bases de datos académicas - 15 a 25 estudios incluidos como meta orientativa, según evidencia disponible - 1 protocolo y 1 diagrama de selección tipo PRISMA, si aplica - 1 matriz de extracción y evaluación crítica - Informe: 2.500–3.500 palabras - Registrar ecuaciones, fechas y motivos de exclusión

#### 7 — Operacionalización de variables
- Categoría: Actividades de investigación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título y propósito → Pregunta e hipótesis, cuando aplique → Definición conceptual de constructos → Identificación y clasificación de variables → Dimensiones y categorías → Indicadores observables → Escalas, unidades y fuentes de medición → Criterios de validez y confiabilidad → Matriz de operacionalización → Justificación metodológica → Rúbrica analítica
- **Extensión / límites:**
  > - 4 a 8 variables o constructos, según el estudio - 2 a 4 dimensiones por variable cuando corresponda - 2 a 3 indicadores por dimensión - Matriz con 7 a 10 columnas metodológicas - Justificación: 800–1.200 palabras - Entrega: matriz editable con definiciones y fuentes

#### 8 — Validación de instrumentos
- Categoría: Actividades de investigación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título y objetivo de validación → Descripción del instrumento y población → Fundamentación teórica de dimensiones → Diseño del proceso de validación → Criterios y perfil de jueces → Matriz de valoración de ítems → Análisis de validez de contenido y consistencia, cuando proceda → Ajustes al instrumento → Limitaciones y consideraciones éticas → Informe y anexos → Rúbrica analítica
- **Extensión / límites:**
  > - 1 instrumento con 15 a 30 ítems como referencia - 3 a 5 jueces expertos para valoración de contenido - Matriz de pertinencia, claridad y relevancia por ítem - Informe metodológico: 1.500–2.500 palabras - 1 versión inicial y 1 versión ajustada del instrumento - Indicadores de validez/confiabilidad solo si los datos lo permiten

#### 9 — Reseña crítica de artículos
- Categoría: Actividades de análisis crítico · Uso recomendado: Prioritaria
- **Estructura:**
  > Referencia y ficha bibliográfica → Presentación de la pregunta y tesis del artículo → Síntesis de fundamentos y metodología → Evaluación crítica de evidencia, rigor y límites → Contraste con otras investigaciones → Posición argumentada y aportes al campo → Conclusiones → Referencias APA 7 → Rúbrica analítica
- **Extensión / límites:**
  > - 1 artículo científico arbitrado como objeto central - Reseña: 1.200–1.800 palabras - Contraste con 3 a 5 fuentes académicas adicionales - Incluir evaluación de método, resultados y sesgos - Explicitar 2 a 3 fortalezas y 2 a 3 limitaciones - Citas y referencias según APA 7

#### 10 — Diario de investigación
- Categoría: Actividades de investigación · Uso recomendado: Prioritaria
- **Estructura:**
  > Identificación de sesión y fase investigativa → Propósito y actividades realizadas → Decisiones teórico-metodológicas → Registro de observaciones y evidencias → Reflexividad y posicionamiento del investigador → Dilemas éticos y ajustes → Preguntas emergentes → Próximas acciones y seguimiento → Síntesis de aprendizaje y trazabilidad
- **Extensión / límites:**
  > - 6 a 8 entradas cronológicas por periodo de trabajo - 250–400 palabras por entrada - Fecha, objetivo, evidencia y decisión en cada registro - 1 balance reflexivo final de 600–800 palabras - Anexar registros o enlaces a evidencias cuando proceda - Entrega: bitácora fechada y organizada

#### 11 — Elaboración de ensayos especializados
- Categoría: Actividades de producción científica · Uso recomendado: Prioritaria
- **Estructura:**
  > Título y tesis central → Problema o debate epistemológico → Introducción y alcance → Argumentos principales fundamentados → Contrargumentos y discusión de perspectivas → Integración crítica de evidencia científica → Implicaciones teóricas, metodológicas o sociales → Conclusión y aporte propio → Referencias APA 7 → Rúbrica analítica
- **Extensión / límites:**
  > - Ensayo: 2.500–3.500 palabras - 12 a 18 referencias académicas pertinentes - 3 a 5 argumentos centrales sustentados - Al menos 2 perspectivas contrastadas - Tesis original, contraargumentación y conclusión crítica - Rúbrica: rigor, coherencia, originalidad y fuentes

#### 12 — Evaluación de programa de prevención de delitos
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del programa y contexto → Pregunta y propósito evaluativo → Teoría de cambio o modelo lógico → Criterios e indicadores de evaluación → Diseño metodológico y fuentes → Análisis de implementación, resultados y efectos → Consideraciones éticas y sesgos → Juicio evaluativo sustentado → Recomendaciones de mejora → Referencias y anexos → Rúbrica analítica
- **Extensión / límites:**
  > - 1 programa de prevención de delitos claramente delimitado - 5 a 8 indicadores de proceso, resultado o efecto - 1 modelo lógico o teoría de cambio - Informe evaluativo: 2.500–3.500 palabras - Mínimo 10 fuentes documentales y empíricas, si existen - 1 matriz de hallazgos, evidencias y recomendaciones

#### 13 — Elaboración de plan de mejoramiento
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Título del plan → Diagnóstico basado en hallazgos y evidencias → Priorización de brechas y causas → Objetivo general y resultados esperados → Acciones correctivas y preventivas → Responsables y recursos → Cronograma y riesgos → Indicadores, metas y medios de verificación → Seguimiento y evaluación de efectividad → Sustento técnico y ético → Rúbrica analítica
- **Extensión / límites:**
  > - 1 problema o programa diagnosticado - 4 a 6 acciones priorizadas y justificadas - Matriz con responsable, plazo, recursos, indicador y meta - Horizonte de seguimiento: 6 a 12 meses (según caso) - Justificación técnica: 1.500–2.000 palabras - 1 cronograma y 1 matriz de monitoreo

#### 14 — Toma de decisiones
- Categoría: Actividades de práctica · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre → Descripción → Escenario → Decisión 1 → Opciones → Consecuencia y retroalimentación → (Repetir) → Resultado final y balance de decisiones
- **Extensión / límites:**
  > - 1 escenario contextualizado
  > - 3 a 4 puntos de decisión
  > - 3 opciones por decisión
  > - Retroalimentación por consecuencia

#### 15 — Simulaciones de casos
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Explicación breve → Contexto o situación de partida → Planteamiento → Simulación (controles → resultados) → Retroalimentación → Informe breve del estudiante → Rúbrica
- **Extensión / límites:**
  > - 1 caso contextualizado
  > - 2 a 4 variables o controles
  > - Resultados visibles y retroalimentación por resultado
  > - Rúbrica publicada con la consigna

#### 16 — Tarea
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre del reto → Objetivo (V+O+C) → Descripción de la actividad → Pasos a seguir → Estructura y formato de entrega → Criterios de evaluación (ponderados)
- **Extensión / límites:**
  > - Producto individual
  > - Entrega con formato, extensión y etiquetado definidos
  > - Rúbrica analítica

#### 17 — Taller aplicado
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre del taller → Objetivo (V+O+C) → Contexto práctico → Pasos a seguir (numerados) → Producto esperado → Estructura y formato de entrega → Criterios de evaluación
- **Extensión / límites:**
  > - 4 a 8 pasos numerados
  > - Producto aplicado a un caso o problema real
  > - Entrega con formato definido
  > - Rúbrica analítica

#### 18 — Foros estructurados
- Categoría: Actividades de aplicación · Uso recomendado: Prioritaria
- **Estructura:**
  > Nombre del foro → Objetivo (V+O+C) → Contextualización de una problemática científica o investigativa → Preguntas orientadoras de análisis crítico → Intervención inicial sustentada en literatura científica → Debate académico asincrónico con argumentación y contraargumentación → Síntesis crítica y aportes al conocimiento → Retroalimentación y rúbrica analítica.
- **Extensión / límites:**
  > • 1 problemática científica o investigativa contextualizada.
  > • 3–5 preguntas orientadoras de análisis crítico y reflexión epistemológica.
  > • Intervención inicial: 400–600 palabras, sustentada en literatura científica.
  > • 2–3 réplicas argumentadas a compañeros: 150–200 palabras cada una.
  > • Duración estimada: 45–60 minutos de participación activa asincrónica.


### Hoja «Evaluaciones»

#### 1 — Evaluación formativa
- **Estructura:**
  > Nombre → Resultado de aprendizaje evaluado → Instrucciones → Pregunta → Opciones → Retroalimentación formativa → Resultado y recomendación de repaso
- **Extensión / límites:**
  > - 1 por unidad (subtema 3 o 4)
  > - 10 a 12 preguntas
  > - Intentos múltiples con retroalimentación inmediata
- **Porcentajes:** Formativa 1: 25% Evaluación formativa 1 tema 1 y 2  · 2,5% Alguna de las actividades de autoaprendizaje del tema 1  · 2,5% Alguna de las actividades de autoaprendizaje del tema 2 · Formativa 2: 25% Evaluación formativa 2 tema 3 y 4 · 2,5% Alguna de las actividades de autoaprendizaje del tema 3  · 2,5% Alguna de las actividades de autoaprendizaje del tema 4

#### 2 — Evaluación sumativa
- **Estructura:**
  > Nombre → Resultado de aprendizaje evaluado → Instrucciones → Caso o pregunta → Opciones o espacio de respuesta → Retroalimentación posterior → Calificación en el Libro de Calificaciones
- **Extensión / límites:**
  > - Ultimo subtema de cada unidad
  > - 10 a 15 preguntas
  > - Escala 0,00 a 5,00; aprobatoria 3,50
  > - Máx. 1 intento (propuesta)
- **Porcentajes:** Sumativa: 40%

#### 3 — Banco de preguntas
- **Estructura:**
  > Pregunta → Unidad y subtema → Resultado de aprendizaje → Nivel de Bloom → Enunciado → Opciones → Respuesta correcta → Retroalimentación
- **Extensión / límites:**
  > - Mín. 2 preguntas por cada pregunta presentada
  > - Cada pregunta ligada a un RA y a un nivel de Bloom
  > - Retroalimentación por opción


#### — Resúmenes gráficos
- Categoría: Recursos de lectura y profundización académica · Uso recomendado: Prioritaria
- Nota: en el Excel de estructura esta fila no indica el tipo de recurso; por decisión del 14-11-2026 **es un recurso HTML** (categoría POS-14).
- **Estructura:**
  > Título académico → Propósito de aprendizaje → Introducción y contextualización científica → Identificación de conceptos fundamentales → Selección y jerarquización de información relevante → Bloque 1: Fundamentación teórica y conceptual → Bloque 2: Organización gráfica de categorías y relaciones → Bloque 3: Síntesis comparativa de enfoques científicos → Bloque 4: Representación de hallazgos y evidencias investigativas → Bloque 5: Interpretación crítica e implicaciones científicas → Síntesis integradora → Referencias bibliográficas en APA 7.
- **Extensión / límites:**
  > • 1 resumen gráfico digital de 2 a 3 páginas.
  > • Título principal: máximo 90 caracteres.
  > • Introducción: 60–90 palabras.
  > • 5 bloques de desarrollo académico.
  > • Desarrollo por bloque: 70–100 palabras.
  > • 3 a 5 elementos visuales: diagramas, tablas, esquemas o gráficos.
  > • 1 análisis comparativo de enfoques o evidencias científicas.
  > • Síntesis crítica: 100–150 palabras.
  > • Mínimo 3 referencias académicas en APA 7.

### Recursos que NO son HTML (no van en esta guía)
Emparejamiento.
