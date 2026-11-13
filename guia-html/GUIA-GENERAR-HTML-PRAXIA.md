# Guía para generar recursos HTML que se suben a Praxia

Esta guía es para **pegarla en el chat** de la herramienta de IA con la que vas a generar una plantilla HTML. Junto con ella pega el archivo de límites de la formación (`limites-<formación>.md`) y dile al chat **qué recurso** vas a generar (ver el apartado 1).

> Instrucción para la IA que lea esto: eres quien diseña y programa **una plantilla HTML reutilizable** para Praxia. Sigue esta guía al pie de la letra. Si algo no está claro, pregunta antes de generar. Entrega **un solo archivo `.html`** completo.

---

## 1. Qué debes decirle al chat antes de empezar

Sin estos tres datos la IA no sabe qué límites seguir:

1. **Formación:** Tecnológico, Profesional, Especialización o Doctorado (cada una tiene su archivo de límites).
2. **Tipo de recurso exacto**, con el nombre que aparece en el archivo de límites (por ejemplo «Infografías estáticas», «Mapas conceptuales interactivos», «Emparejamiento», «Estudio de caso»).
3. **Idea de diseño** (opcional): cómo quieres que se vea o se comporte esta variante.

Mensaje de arranque sugerido:

```
Formación: <Tecnológico | Profesional | Especialización | Doctorado>
Recurso: <nombre exacto del recurso>
Genera una plantilla HTML para Praxia siguiendo la guía y los límites de ese recurso en el archivo de límites.
Variante / idea de diseño: <opcional>
```

La IA debe localizar ese recurso en el archivo de límites y usar **solo** sus secciones y sus rangos de palabras.

---

## 2. Qué es una plantilla de Praxia (cómo funciona)

- Una **plantilla** es el marco del recurso: diseño, interacciones y código. **No lleva el contenido del curso.**
- El contenido de cada recurso lo escribe el flujo automático (n8n) como un **JSON** y lo inserta en la plantilla. La misma plantilla sirve para muchos cursos.
- Por eso la plantilla tiene **dos marcas** que el sistema reemplaza: `{{TITULO}}` y `/*CONTENIDO*/`.
- **Todo texto que cambie de un curso a otro debe venir del JSON, no estar escrito en el HTML.**

Praxia acepta, además, que dentro del archivo vaya un **contenido de ejemplo** ya puesto (apartado 4). Así, al subirla se ve la vista previa con contenido, y al reutilizar la plantilla **no se arrastra el texto de ejemplo**: Praxia lo separa al subirla.

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
- El contenido de ejemplo debe ser un **objeto JSON válido** (`{ … }`, no una lista). Si no es JSON válido, Praxia rechaza la subida y dice por qué.
- Dentro del ejemplo evita escribir la secuencia `</script>`.

Lectura del contenido en el JavaScript de la plantilla:

```js
const CFG = JSON.parse(document.getElementById('contenido').textContent);
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

### 5.2 Respeta los límites del recurso

El archivo de límites de la formación indica, por sección, las **palabras mínimas y máximas** y la **cantidad de elementos** (por ejemplo «3–4 ideas principales», «títulos de 3–8 palabras»). La plantilla debe:

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

Praxia define estas variables en `/*TEMA*/`. **Los colores se escriben siempre como `var(--nombre)`**, nunca con un código hexadecimal, para que Praxia pueda cambiar la paleta según la formación sin tocar el HTML.

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
| `--font` | Familia tipográfica | Century Gothic; respaldo Montserrat |

Reglas de color:

- Escribe siempre un respaldo por si la variable no llega: `color: var(--brand, #00665F)`.
- Para tonos intermedios usa `color-mix(in srgb, var(--brand) 12%, #fff)` o `--tint`; no inventes un color nuevo.
- Los íconos y el SVG deben usar `currentColor` o `fill: var(--brand)`; nunca un color escrito a mano.
- **Excepción:** los colores de **acierto y error** son fijos y no cambian por formación (verde y rojo con contraste suficiente); no uses los colores de marca para decir «correcto» o «incorrecto».
- El blanco, el negro y los grises neutros pueden ir fijos.
- Todo texto debe tener contraste suficiente (4,5:1) sobre su fondo, también con otra paleta.

> **Estado actual:** Praxia aplica hoy la paleta DIEPO base a todas las formaciones. Cuando exista la paleta de cada formación, Praxia cambiará las variables y las plantillas que sigan esta regla se verán con los colores de la formación **sin volver a generarlas**. Para eso se necesita la tabla formación → colores (código hexadecimal de cada variable).

### 6.2 Tipografía, forma y espacio

- Fuente `var(--font)`; títulos en peso 800, cuerpo en 400–600. Base **17 px** (`--fs`), interlineado 1,5.
- Esquinas redondeadas (`var(--radius)`), botones en forma de píldora, bordes de 2 px.
- Estilo limpio: fondo blanco, mucho espacio, sin sombras pesadas ni degradados llamativos.
- Pensado para verse en **pantalla completa 16:9 (1280 × 720)** y también en celular (ancho 360 px) sin scroll horizontal. Usa `clamp()` y unidades relativas.
- Animaciones suaves y breves (≤ 350 ms); respeta `@media (prefers-reduced-motion: reduce)` desactivándolas.

### 6.3 Accesibilidad (obligatorio)

- Se debe poder usar **solo con teclado** (Tab, Enter, Espacio, flechas) y el foco se ve (`:focus-visible` con contorno de 3 px).
- Botones con `<button>`, no `<div>`; `aria-label` en los botones de solo ícono; `alt` en imágenes (el texto alternativo viene del JSON).
- Idioma `<html lang="es">`.
- No transmitas información solo con color.

---

## 7. Reglas técnicas del archivo

- **Un solo archivo** `.html`, de menos de **1,5 MB**, con `<html lang="es">`, `<meta charset="utf-8">` y `<meta name="viewport" content="width=device-width,initial-scale=1">`.
- **Todo dentro del archivo:** CSS en `<style>`, JavaScript en `<script>`. Sin librerías externas, sin CDN, sin fuentes externas (Praxia ya añade la tipografía de la marca).
- Las imágenes vienen del JSON como URL (con su texto alternativo) o son SVG en línea. Si no hay imagen, la plantilla debe verse bien igual.
- La plantilla corre **aislada** en un iframe protegido (sandbox): funcionan los scripts, pero **no** uses `localStorage`, `sessionStorage`, cookies, `window.parent`, ni llamadas a la API de Praxia. Si guardas algo, envuélvelo en `try/catch`.
- No uses `alert()`, `confirm()` ni `prompt()`.
- Sin llamadas de red (`fetch`, `XMLHttpRequest`).
- **El JavaScript no debe fallar si falta un campo** del JSON: revisa que existan (`CFG.bloques || []`) antes de recorrerlos.
- Nombre del archivo: minúsculas, números y guiones, hasta 80 caracteres (por ejemplo `infografia-vertical-2.html`). No puede llamarse `plantillas` ni `index`, ni repetir el de una plantilla existente.

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
const CFG = JSON.parse(document.getElementById('contenido').textContent);
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
- [ ] Cada sección y cada elemento del recurso (según el archivo de límites) tiene su lugar, en orden.
- [ ] Con el máximo de palabras nada se desborda ni se corta; con el mínimo o con menos elementos no se rompe.
- [ ] Los colores usan solo `var(--…)` (excepto acierto/error y neutros).
- [ ] Funciona con teclado, tiene foco visible, `lang="es"` y `alt` en imágenes.
- [ ] Sin librerías externas, sin `localStorage`, sin `fetch`, sin `alert()`.
- [ ] Se ve bien en 1280 × 720 y en 360 px de ancho.

---

## 10. Cómo subirla a Praxia

1. Entra a Praxia con un usuario de **diseñador o administrador** → **Plantillas HTML** → pestaña **Categorías para n8n**.
2. Pulsa **Subir plantilla**, elige la **categoría** (el tipo de recurso, con su ID), el **nombre** y el archivo `.html`.
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
