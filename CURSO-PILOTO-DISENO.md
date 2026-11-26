# «Curso piloto»: documento de diseño

Fecha: 25-11-2026. Estado: **diseño aprobado para implementar** (no hay código escrito todavía).
Destinatario: quien implemente (agente o persona) sin más contexto que este documento y el repositorio.

---

## 0. Resumen de decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Listar la carpeta de Drive | **Opción A**: el servidor lee la carpeta **pública con enlace** con `https://drive.google.com/embeddedfolderview?id=<ID>` y exporta cada Google Doc con `export?format=html`. No toca n8n. **Plan B**: un flujo n8n **nuevo** que lista y exporta con la credencial de Drive (misma interfaz de «fuente»). Opción C (clave de API) descartada por ahora. |
| 2 | Leer los documentos | Export **HTML** (conserva tablas, responde 200 desde `docs.google.com` sin redirección) + **cheerio** (ya está en `servidor/package.json`). Un adaptador convierte el HTML a un modelo neutro de bloques (párrafo / tabla) sobre el que se **porta en copia aislada** el código de «Extraer recursos» del flujo «Preparar el curso». |
| 3 | Catálogo de IDs | Se lee la **misma hoja de Google** que usa n8n por export CSV anónimo (verificado: responde 200 `text/csv`). Si no se puede leer: respaldo `baseIdPorPalabras` (regla existente del flujo de guiones) **marcado** como respaldo; las actividades sin hoja **no se asignan**. |
| 4 | Asociación | Reglas determinísticas por número de unidad (nombre de carpeta «Guiones U#», número en el documento de unidad, códigos `U#-T#-R#` en el guion). Todo lo que no sea único se reporta como **ambiguo** y no se asigna. Nunca se elige al azar. |
| 5 | Variantes | **Simulación en memoria** («curso nuevo vacío»). No escribe en `asignacion_variantes`, ni en `pipeline_origen`, ni en ninguna tabla. Sin migración. Reutiliza `elegibles()` (único cambio en código existente del servidor: añadir `export`) y las consultas `Q.asignElegibles`, `Q.categoriasListar`, `Q.formacionesListar`. Actividades: **orden determinista** en lugar de azar (diferencia consciente y documentada). |
| 6 | API | Módulo nuevo `servidor/src/piloto/`, rutas `/api/piloto/…`, permiso existente `proyectos.crear`, trabajo **asíncrono en memoria** con consulta de estado (POST → 202, GET para sondear). |
| 7 | Frontend | `CursoPiloto.jsx` + `curso-piloto.css` (clases con prefijo `cp-`). En `App.jsx` solo 5 líneas puntuales. |
| 8 | Aislamiento | 2 archivos existentes del servidor tocados (1 línea cada uno), 1 del cliente (`App.jsx`), opcional `servidor/package.json` (script de prueba). Ni n8n, ni SQL, ni estilos globales. |
| 9 | Pruebas | Fixtures sintéticos en `servidor/test/fixtures/piloto/` (sin red ni base) + prueba de integración opcional con `embedded-postgres` que comprueba que **no se escribe nada** + prueba real con una carpeta del usuario compartida con enlace. |

---

## 1. Cómo se lee la carpeta de Drive (sin credenciales en el servidor)

### 1.1 Lo que se verificó (25-11-2026, con datos públicos ajenos al usuario)

Con `curl` desde este equipo, sobre la carpeta pública de pruebas del proyecto `gdown` (`15uNXeRBIhVvZJIhL4yTw4IsStMhUaaxl`):

- `GET https://drive.google.com/embeddedfolderview?id=<ID>` → **200 `text/html`**. Cada elemento es un `<div class="flip-entry" id="entry-<ID>">` con:
  - `<a href="…">`: `https://drive.google.com/drive/folders/<ID>` (subcarpeta), `https://docs.google.com/document/d/<ID>/edit?usp=drive_web` (Google Doc), `https://docs.google.com/spreadsheets/d/<ID>/edit…` (hoja), `https://drive.google.com/file/d/<ID>/view?usp=drive_web` (archivo subido: .docx, .pdf…).
  - `<div class="flip-entry-title">nombre</div>` y `aria-label="Folder"` en las carpetas.
  - El nombre de la carpeta está en `<title>`.
- Una subcarpeta con **100 archivos** devolvió las **100** entradas en una sola página (no hay paginación visible hasta 100). No se pudo verificar un tope superior.
- Un ID inexistente o una carpeta **no pública** → **404** (no se distinguen).
- `GET https://docs.google.com/document/d/<ID>/export?format=html` → **200 `text/html` directo** (sin redirección). `format=docx` y `format=txt` → **307** a `*.googleusercontent.com`.
- La hoja del catálogo de IDs (`1w8OsZQHtlLcJ0whtl6NeVGcilFkORbhQ_L81ihlaZFw`, gid `967151393`) **se puede leer sin credenciales** como CSV: `export?format=csv&gid=967151393` → 307 → 200 `text/csv` (39 líneas; encabezados en la fila 2: `ID base, ID C (contenido), ID A (contenido con actividad), Alcance, TEC, PRO, ESP, DOC, Nombre del recurso, Nombre en TEC, …, Tipo de producción propuesto, …`). La hoja `ACTIVIDADES_AUTOAPRENDIZAJE` también: `gviz/tq?tqx=out:csv&sheet=ACTIVIDADES_AUTOAPRENDIZAJE` → 200 `text/csv` (66 líneas; encabezados en la fila 2: `ID de la actividad, Ámbito, Nivel, Nombre de la actividad, Actividad / Entregable, Nombre en TEC, Nombre en PRO, Nombre en ESP, Nombre en DOC, …`). **El catálogo real tiene `G-13`, `G-14`, `G-15`** (presentación) y no tiene `G-00`.

### 1.2 Opciones evaluadas

| Opción | Pros | Contras |
|---|---|---|
| **A. `embeddedfolderview` + export HTML** | Sin credenciales, sin n8n, sin cambios en flujos. Mismo mecanismo que ya usa Praxia (`export?format=txt/docx` sin autenticación). Probado. | Exige compartir la carpeta y sus documentos con «Cualquier persona con el enlace». Página no documentada por Google (puede cambiar). No distingue «privada» de «no existe». Tope de entradas desconocido (>100). Las unidades compartidas solo dentro del dominio (`americana.edu.co`) **no** se ven de forma anónima. |
| **B. Flujo n8n nuevo** (credencial «INNOVACION EDUCATIVA») | Lee carpetas privadas y del dominio. API oficial de Drive (paginación real). | Hay que crear y activar un flujo nuevo en n8n (no se puede hacer desde el repo); dependencia de n8n y de su disponibilidad; más piezas (firma, URL). |
| **C. Clave de API de Google** | API oficial con paginación. | Solo lee lo **público** (igual que A), exige crear y custodiar una clave en Google Cloud. No aporta nada sobre A para el piloto. |

### 1.3 Recomendación

- **A** como fuente por defecto (`PILOTO_FUENTE` vacío o `publica`).
- **Plan B** listo en el diseño (§5.3, `crearFuenteN8n`): si la institución no permite compartir con enlace, se crea el flujo nuevo y se activa con `PILOTO_FUENTE=n8n` + `PILOTO_N8N_URL`. El resto del módulo no cambia porque todo pasa por la misma interfaz de «fuente».
- Toda descarga pasa por `descargarGoogle()` (§5.2): IDs validados con `^[A-Za-z0-9_-]{10,100}$`, la URL la arma el servidor (nunca se usa la URL del usuario tal cual), redirecciones manuales (máx. 5) y en **cada salto** `validarDestino()` de `servidor/src/bibliografia/red.js` (anti-SSRF, ya exportada) **más** una lista blanca de hosts: `drive.google.com`, `docs.google.com`, `drive.usercontent.google.com` y `*.googleusercontent.com`. Una redirección a `accounts.google.com` (documento privado) se corta y se reporta como «no público». No se usa `descargar()` de `red.js` porque sigue redirecciones a cualquier host público.

---

## 2. Cómo se leen los documentos

### 2.1 Formato de exportación

- **HTML** (`export?format=html`). Conserva tablas, celdas y párrafos; llega en una sola petición a `docs.google.com`. El `txt` pierde la estructura de tablas; el `docx` exige descomprimir y redirige a otro host.
- Parser: **cheerio** (`servidor/package.json`, ya usado en `src/bibliografia/extraer.js`). No se añade ninguna dependencia.
- Archivos `.docx` subidos (no Google Docs): soporte **opcional** (fase 2) con `https://drive.google.com/uc?export=download&id=<ID>` + `mammoth.convertToHtml` (ya instalado) → mismo adaptador. Mientras no se implemente, se reportan como `no_reconocido` con motivo «archivo .docx subido: conviértalo a Google Docs». PDF y otros: `no_reconocido`.

### 2.2 Modelo neutro de bloques (`servidor/src/piloto/documento.js`)

```js
// Bloque = { tipo: 'parrafo', texto: string } | { tipo: 'tabla', filas: string[][] }
export function bloquesDeHtml(html) → Bloque[]
export function textoDeBloques(bloques) → string   // párrafos con \n, filas de tabla con ' | ' entre celdas
```

Reglas (imitan a la API de Docs que usa n8n, para que el código portado no cambie):
- Recorrido en **orden de documento** de `body`. Un `<table>` que no está dentro de otra tabla → bloque `tabla`; cada `<tr>` → fila; cada `<td>/<th>` → celda.
- Texto de celda = `<p>`/`<li>` de la celda, cada uno con `aplanar()` (espacios colapsados), unidos con `\n` (igual que `textoCelda` del flujo). Tablas anidadas: su texto se añade a la celda que las contiene.
- `<p>`, `<h1>…<h6>`, `<li>` fuera de tablas → bloque `parrafo` (texto con `aplanar()`); vacíos se omiten.
- Celdas combinadas (`colspan`) se repiten como celdas vacías para conservar índices de columna.

### 2.3 Port aislado de las reglas del flujo vivo

Se **copia** (no se importa ni se modifica) el código del nodo «Extraer recursos» del flujo «DIEPO - Preparar el curso» (versión con actividades, presentación `G-13/14/15`; la versión pegada en la sesión `fb9b83be…`, línea 22527 de la transcripción) y las funciones de catálogo del nodo «Preparar relleno del guion1» de `n8n/vivo/guiones-vivo.json`. Cambios permitidos al portar: solo la **entrada** (bloques en vez de JSON de la API de Docs) y la **salida** (estructuras del §6 en vez de `{ json }`). Cada función portada lleva un comentario `// Copia de n8n «<nodo>» (<fecha>): no cambiar sin cambiar también el flujo`.

`servidor/src/piloto/catalogo.js`:
```js
export const normCat = (s) => …            // idéntica a n8n
export const claveCat = (s) => …           // idéntica a n8n (sin tildes, minúsculas, sin plural)
export function baseIdPorPalabras(nombre)  // copia literal de guiones-vivo.json («respaldo»)
export function leerCsv(texto) → string[][] // RFC 4180 mínimo (comillas, comas, saltos de línea en comillas)
export function filasConEncabezado(matriz, encabezadoBuscado) → object[] // busca la fila cuya celda normalizada === encabezadoBuscado ('id base' / 'id de la actividad'); las siguientes son datos
export function indiceRecursos(filas) → { baseId(nombre) → string|null, tipoProduccion(base) → string|null, tamano }
   // misma construcción que INDICE: columnas /^(nombre|alias)/i separadas por ; | \n; ID base /^(?:G|PRE|POS)-\d{2}$/
   // baseId: exacta por claveCat; si no, contención con claves de ≥12 caracteres SOLO si apunta a un único ID
export function indiceActividades(filas, formacion) → { idsDe(texto) → { ids: Set, general: bool } | null, tamano }
   // copia de INDICE_ACT / INDICE_ACT_GEN / idsDe (columna «Nombre en TEC/PRO/ESP/DOC» y respaldo «Nombre de la actividad»)
export const SIGLA = { tecnologico: 'tec', profesional: 'pro', especializacion: 'esp', doctorado: 'doc' }
export const categoriaPresentacion = (txt) => …  // copia: infograf → G-14, pantalla interactiva → G-15, otro → G-13
```

`servidor/src/piloto/unidad.js`:
```js
export function leerUnidad(bloques) → { numero, temas:[{numero,nombre,recursos:[{formato,actividad,titulo}]}], presentacion, evaluacion, evalFilas, avisos, formacionTexto }
   // port 1:1 de leerUnidad() de «Extraer recursos»: «ESTRUCTURA METODOL… UNIDAD N», «Unidad: Unidad Nro. N», títulos de tema
   // /^(?:Tema\s*)?\d+\s*[.:\-–]…/, tabla «Tipo de recurso» (fila «Recurso de presentación»), tabla EVALUACIONES (Tipo de evaluación + Mecanismo),
   // tablas «Subtemas | … | RED | Actividad» con columnas detectadas por cabecera. formacionTexto: /nivel\s+de\s+formaci[oó]n[\s|:*]*([^\r\n|]{3,60})/i sobre textoDeBloques.
export function extraerRecursos(u, numero, { indiceRec, indiceAct, formacion }) → { recursos, actividades, presentacion, problemas, avisos }
   // port 1:1 del bucle «todas las unidades» para UNA unidad, con dos diferencias conscientes (§4.4):
   //   - presentación sin texto en el documento → NO se pide G-13 por defecto: queda sin_asignar «presentacion_no_indicada»;
   //   - lo que el flujo deja «fuera» (actividad fuera de hoja, ambigua, calificable indeterminada) se conserva en la lista con estado sin_asignar y su motivo.
```

Reglas que se conservan exactamente (las del flujo vivo):
- Recurso: `codigo = U{u}-T{t}-R{pos}` (pos = fila de la tabla del tema, desde 1); `categoria = id_base = baseId(formato)`; `id_catalogo = id_base + '-A'` si la celda de actividad trae algo distinto de vacío/«N/A»/«No aplica», si no `+ '-C'`; `G-00` sin sufijo.
- Actividad: `codigo = U{u}-T{t}-A{pos}`; nombre = texto antes del primer `:`; categoría por la hoja ACTIVIDADES en la columna del nivel (respaldo: «Nombre de la actividad»); `calificable` = la actividad del tema indicado en EVALUACIONES cuyo nombre coincide (`mismoNombre`); todas las demás `false`; si EVALUACIONES no identifica una, **ninguna** actividad de la unidad se asigna (`calificable_indeterminada`).
- Presentación: `U{u}-PRES`, categoría `categoriaPresentacion(texto)`, `id_catalogo = cat + '-C'`.
- Formato no encontrado en el catálogo → sin asignar `formato_fuera_de_catalogo` (el flujo lo considera error; aquí no detiene el resto de la unidad).
- Códigos repetidos dentro de la unidad (dos tablas con el mismo número de tema) → problema `ambiguo` y **ninguno** de los repetidos se asigna.

### 2.4 Lectura del Syllabus (`servidor/src/piloto/syllabus.js`)

```js
export const RE_UNIDAD = /^Unidad\s*(?:Nro\.?|N[°ºo]\.?|N[uú]mero)\s*(\d+)|^Unidad\s+(\d+)\s*$/i // copia de n8n/syllabus-a-plantilla.json
export function leerSyllabus(bloques) → { unidades: [{ numero, nombre }], formacionTexto, formacion, curso }
```
- Unidades: en **todas** las filas de **todas** las tablas, primera celda que cumple `RE_UNIDAD` (Word une tablas pegadas: se corta por fila, igual que n8n); `nombre` = celda 2; números repetidos se ignoran (gana el primero, como n8n).
- Formación: misma expresión que `formacionDeSyllabus` (`servidor/src/pipeline/preparacion.js` l.60) sobre `textoDeBloques`; el texto se traduce con `formacionDeCurso({ info: { nivel: texto } })` (ya exportada; no se modifica).
- `curso`: título del documento (nombre de la entrada de Drive) sin prefijo «Syllabus».

### 2.5 Lectura de un guion (`servidor/src/piloto/guion.js`)

Los guiones los crea el flujo de guiones: un Google Doc por tema llamado **`Guion_U{u}_T{t}`** (nodo «Preparar copia de guion (base)1»: `nombre_copia`) dentro de la carpeta **`Guiones U{u} - {nombre} - {yyyy-MM-dd HH-mm}`** (nodo «Crear carpeta de guiones1»). Cada recurso lleva la fila «Código del recurso» con `U1-T2-R3 · G-09-A` (`unirId`).

```js
export const RE_NOMBRE_GUION = /^guion[\s_-]*u\s*(\d{1,3})[\s_-]*t\s*(\d{1,2})\b/   // sobre normCat-sin-espacios del nombre
export const RE_CODIGO_GUION = /\bU(\d{1,3})-T(\d{1,2})-R(\d{1,3})\b(?:\s*[·•\-–]\s*((?:G|PRE|POS)-\d{2}(?:-[AC])?))?/g
export function leerGuion(bloques, nombre) → { unidad, tema, codigos: [{ codigo, id_en_guion }], tiene_presentacion, actividades: number, discrepancias: string[] }
```
- Códigos: se buscan en las filas de tabla cuya primera celda normalizada empieza por `codigo` (filas «Código» / «Código del recurso»); si no hay ninguna, en todo el texto.
- `unidad`/`tema`: del nombre (`RE_NOMBRE_GUION`) y de los códigos; si no coinciden entre sí → `discrepancias`.
- `tiene_presentacion`: título «Recurso de presentación» o fila de código con `G-00`/`G-13|14|15` sin `U#-T#`.
- `actividades`: cantidad de títulos «Actividad de autoaprendizaje» (solo para comparar, no para asignar).

---

## 3. Asociación: carpeta raíz → Syllabus → unidades → documento de unidad ↔ guiones

Implementación pura (sin red) en `servidor/src/piloto/asociar.js`:
```js
export function clasificarRaiz(entradas) → { syllabus: Entrada[], carpetasUnidad: Map<numero, Entrada[]>, otrasCarpetas, docs: Entrada[], otros }
export function clasificarDocumento(entrada, bloques) → 'unidad' | 'guion' | 'syllabus' | 'no_reconocido' (+ datos leídos)
export function asociar({ raiz, syllabusLeido, carpetas, docsPorCarpeta, docsRaizLeidos }) → { unidades, problemas, carpetas_sobrantes, raiz_no_reconocidos }
```

Normalización de nombres: `normCat()`.

### 3.1 Syllabus
1. Candidatos = Google Docs **de la carpeta raíz** cuyo nombre normalizado contiene `syllabus`, `silabo` o `syllabo`.
2. Si hay 0: candidatos = Docs de la raíz que, leídos, tienen ≥1 fila `RE_UNIDAD` **y** la frase «nivel de formación». 
3. Exactamente 1 → `syllabus.estado = 'encontrado'`. 0 → `'falta'` (problema `falta`). >1 → `'ambiguo'` con la lista de candidatos (problema `ambiguo`); **no se usa ninguno**.
4. Syllabus que no se puede leer (no público, error) → `'ilegible'`.

### 3.2 Carpetas de unidad
- Subcarpetas de la raíz cuyo nombre normalizado cumple `^guiones u ?(\d{1,3})\b` («Guiones U1», «Guiones U1 - Fundamentos - 2026-11-20 10-00», «guiones u 1»). Las demás subcarpetas se listan como `otras_carpetas` (no se abren).
- Una sola carpeta para el número → se usa. **Varias** (p. ej. el flujo de guiones se corrió dos veces y dejó dos carpetas con fechas distintas) → unidad `ambigua`: se listan las candidatas y **no se asigna** nada en esa unidad. El mensaje sugiere mover las antiguas a otra carpeta. (Se descarta elegir «la más reciente por fecha del nombre»: es una regla que el usuario no pidió; se deja anotada en §10 como posible opción futura).

### 3.3 Unidades del Syllabus vs. carpetas
- `en_syllabus` = número presente en el Syllabus.
- Número del Syllabus sin carpeta «Guiones U#»: la asignación depende del documento de unidad, no de la carpeta. Si en la raíz hay **un único** documento de unidad con ese número, la unidad se analiza y se asigna (estado `incompleta`, aviso «sin carpeta de guiones»); si no hay ninguno, queda `sin_carpeta` (problema `falta`); si hay varios, `ambigua`.
- Carpeta sin unidad en el Syllabus → `carpetas_sobrantes` (problema `discrepancia`); se analiza igual y se marca `en_syllabus: false`.
- Sin Syllabus: las unidades salen solo de las carpetas y de los documentos de unidad de la raíz (problema global `falta`).

### 3.4 Documentos dentro de cada carpeta de unidad
Cada Google Doc de la carpeta se descarga y se clasifica **por contenido** (el nombre solo desempata):
- **documento de unidad**: `leerUnidad()` da `numero !== null` **y** ≥1 tabla de tema.
- **guion**: nombre cumple `RE_NOMBRE_GUION` **o** el contenido tiene ≥1 código `U#-T#-R#` en una fila «Código…» **y** no es documento de unidad.
- Cumple ambos o ninguno → `no_reconocido` (se lista).

Reglas por unidad `N` (carpeta «Guiones UN»):
1. Documento de unidad: 
   - exactamente uno en la carpeta con `numero === N` → `origen: 'carpeta'`;
   - ninguno en la carpeta → se busca en la **raíz** (Docs clasificados como unidad con `numero === N`): uno → `origen: 'raiz'`; varios → `ambiguo`; ninguno → `falta` (problema `falta`);
   - varios en la carpeta con `numero === N` → `ambiguo` (no se asigna la unidad);
   - uno en la carpeta con `numero !== N` → problema `discrepancia` («la carpeta es U2 pero el documento dice UNIDAD 3») y se trata como si faltara.
2. Guiones: cada guion se asocia al tema `T` que dicen su nombre y sus códigos. Guion cuya unidad ≠ N → `discrepancia`, no se asocia. Dos guiones para el mismo tema → `ambiguo` en ese tema (se listan ambos; el tema queda sin guion asociado).
3. Cruce recurso ↔ guion (solo informativo, excepto el ID):
   - `recurso.guion_id` = guion asociado al tema del recurso; si no hay → aviso `recurso_sin_guion` (**no bloquea**: en el sistema real las variantes se asignan antes de que existan los guiones).
   - Si el guion trae un ID para ese código (`id_en_guion`) y su base (`G-09` de `G-09-A`) ≠ `categoria` calculada del documento de unidad → **`id_discrepante`**: el recurso **no se asigna** (no se sabe cuál de los dos IDs es el correcto). Si solo difiere el sufijo `-A/-C` → aviso, se asigna con la categoría del documento.
   - Códigos que están en un guion y no en el documento de unidad → problema `discrepancia` en la unidad.
4. Unidad **sin documento de unidad**: se listan los recursos que traen los guiones (código + `id_en_guion`) como `detectado_en: 'guion'`, todos `sin_asignar` con motivo `falta_documento_unidad`. Razón: sin ese documento no se conocen la tabla EVALUACIONES (calificable), las actividades ni el formato; los códigos del guion por sí solos no bastan para replicar la regla real.

### 3.5 Estado de la unidad
- `completa`: carpeta única, documento de unidad único y legible, sin problemas bloqueantes.
- `incompleta`: falta algo pero hay documento de unidad (p. ej. tema sin guion) → se asigna lo que se pueda.
- `ambigua`: carpeta o documento de unidad ambiguo → nada asignado.
- `sin_documento_unidad`: no se asigna.
- `sin_carpeta`: sin carpeta y sin documento en la raíz.

---

## 4. Asignación de variantes en modo piloto (simulación)

### 4.1 Principio
Se simula **«qué variantes recibiría este curso si fuera un curso nuevo»**: estado de uso vacío, sin leer ni escribir `asignacion_variantes`. Nada se persiste. No hay migración. No se crea `pipeline_origen` ni se llama a `/api/n8n/asignaciones/pedir` (esa ruta escribe y su reparto de actividades es aleatorio).

### 4.2 Reutilización sin cambiar comportamiento
- **Único cambio en código existente del servidor**: `servidor/src/pipeline/asignaciones.js` l.63
  `function elegibles(` → `export function elegibles(`. Nada más en ese archivo.
- Consultas existentes de `servidor/src/consultas.js` (solo lectura, con `sinUsuario`): `Q.categoriasListar` (id → tipo), `Q.formacionesListar` (categoría → formaciones), `Q.asignElegibles` (variantes de una categoría, no archivadas, `ORDER BY s.creado, s.nombre`, con `ultimo` = último estado de revisión).
- `modoPruebasPlantillas()` de `servidor/src/pipeline/preparacion.js` (ya exportada): el piloto respeta el mismo interruptor que el sistema real y lo informa en la respuesta (`modo_pruebas`).
- `formacionDeCurso()` de `preparacion.js` (ya exportada) para traducir el texto del nivel.

### 4.3 `servidor/src/piloto/simular.js`
```js
// Lee de la base, una sola vez por análisis, lo necesario para simular (solo SELECT).
export async function cargarPlantillas(categoriasNecesarias) → { tipoDe: Map<id,'recurso'|'actividad'>, formDe: Record<id,string[]>, variantesDe: Record<id, Variante[]> }
// Pura: no toca la base. items en el orden de la unidad: PRES, recursos (tema, posición), actividades (tema, posición).
export function simularUnidad(items, { formacion, pruebas, tipoDe, formDe, variantesDe }) → items con { variante, estado, motivo, aviso }
```
Algoritmo por unidad (la unicidad del sistema real es por unidad, sql/013; las unidades son independientes):
```
uso = Map<categoria, { usadas: Set, veces: Map }>        // vacío al empezar la unidad
para cada item con categoria y sin motivo previo:
  si !tipoDe.has(cat)                       → sin_asignar 'categoria_inexistente'
  esAct = tipoDe.get(cat) === 'actividad'
  si esAct y typeof calificable !== 'boolean' → sin_asignar 'falta_calificable'
  delTipo = esAct ? variantesDe[cat].filter(v => v.calificable === item.calificable) : variantesDe[cat]
  { lista, motivo } = elegibles(delTipo, formacion, formDe[cat] || [], true, pruebas)   // función real, sin cambios
  si esAct y variantesDe[cat].length y !delTipo.length → motivo = calificable ? 'categoria_sin_calificables' : 'categoria_sin_practicas'
  libres = lista.filter(v => !uso.usadas.has(v.nombre))
  si !esAct: elegida = libres[0]                                   // = sistema real (lista.find)
  si esAct:  pref = pruebas ? libres.filter(v => v.formacion === formacion) : []
             elegida = (pref.length ? pref : libres)[0]            // DIFERENCIA: real = azar(...)
             si !elegida y lista.length: min = mínimo de veces; elegida = primera de lista con veces === min; repetida = true   // real = azar
  si elegida: uso.usadas.add (si !repetida), veces++; estado = repetida ? 'repetida' : 'asignada'
              motivo = repetida ? (calificable === true ? 'calificable_repetida' : 'variante_repetida') : null
              aviso  = repetida && calificable !== true ? 'Variante repetida: …' (mismo texto que avisoRepetida) : null
  si no:      estado = 'sin_asignar', motivo = motivo || 'variantes_agotadas'
```
`solo_aprobadas` es siempre `true` (como el flujo real); con modo de pruebas encendido `elegibles()` ya ignora aprobación y formación.

### 4.4 Diferencias conscientes con el sistema real (se muestran en pantalla)
| Caso | Sistema real | Piloto | Por qué |
|---|---|---|---|
| Actividad con varias variantes libres | al azar | la primera en el orden de `elegibles()` (subida más antigua) y se informa `candidatas: N` | el requisito prohíbe el azar; el resultado es reproducible |
| Actividad sin libres | repite una de las menos usadas, al azar | repite la primera de las menos usadas | ídem |
| Presentación no indicada en el documento | pide `G-13` por defecto | `sin_asignar` `presentacion_no_indicada` | no inventar |
| Estado previo del curso | lo ya asignado no cambia | parte de cero | el piloto no se asocia a un curso de Praxia |
| Categoría de producción no HTML (columna «Tipo de producción propuesto» ≠ HTML, p. ej. videos y podcast) | se pide y vuelve `categoria_inexistente` | `no_html` (no necesita variante HTML) | FLUJO-PREPARAR-CURSO-LO-QUE-FALTA.md §3.2 |

### 4.5 Formación
1. La del Syllabus (`leerSyllabus().formacion`).
2. Si el Syllabus no la trae o no existe: la de los documentos de unidad (`leerUnidad().formacionTexto`) **solo si todas** las que la traen coinciden.
3. Si no se obtiene una de `tecnologico | profesional | especializacion | doctorado`, o los documentos se contradicen → problema global `falta` («No se pudo saber la formación del curso») y **ninguna** variante se asigna (sí se listan recursos y actividades con sus categorías; las actividades tampoco tienen categoría porque la hoja depende del nivel). A diferencia de `asegurarAsignacion`, **no** se usa `tecnologico` por defecto con el modo de pruebas.

### 4.6 Catálogo de IDs
| Situación | Recursos | Actividades |
|---|---|---|
| Hoja de recursos legible | `baseId` por la hoja (`fuente_categoria: 'hoja'`) | — |
| Hoja de recursos ilegible | `baseIdPorPalabras` (`fuente_categoria: 'respaldo_palabras'`) + aviso global «Catálogo de IDs no disponible: se usó el respaldo por palabras clave del flujo de guiones» | — |
| Hoja de actividades legible | — | categoría por la columna del nivel |
| Hoja de actividades ilegible | — | todas `sin_asignar` `catalogo_actividades_no_disponible` |
| Nombre no encontrado | `formato_fuera_de_catalogo` | `actividad_fuera_de_catalogo` |
| Nombre con varias categorías | (no ocurre: `baseId` exige ID único) | `actividad_ambigua` con la lista |

IDs de la hoja configurables por entorno sin tocar `config.js`: `PILOTO_CATALOGO_ID` (por defecto `1w8OsZQHtlLcJ0whtl6NeVGcilFkORbhQ_L81ihlaZFw`), `PILOTO_CATALOGO_GID` (`967151393`), `PILOTO_ACTIVIDADES_HOJA` (`ACTIVIDADES_AUTOAPRENDIZAJE`). Caché en memoria de 10 minutos por proceso. Además, la categoría resultante debe existir en `plantilla_categorias` (si no → `categoria_inexistente`, como el sistema real).

---

## 5. Servidor: módulo `servidor/src/piloto/`

### 5.1 Archivos
| Archivo | Contenido |
|---|---|
| `rutas.js` | `export const rutasPiloto = Router()`; `exigirSesion`; rutas del §5.4 |
| `google.js` | `descargarGoogle`, `listarCarpetaPublica`, `exportarDocHtml`, `leerCsvHoja` |
| `fuentes.js` | `crearFuentePublica()`, `crearFuenteFixtures(dir)`, `crearFuenteN8n(url)` (plan B), `fuentePorEntorno()` |
| `documento.js` | `bloquesDeHtml`, `textoDeBloques`, `aplanar` |
| `catalogo.js` | §2.3 |
| `syllabus.js` | §2.4 |
| `unidad.js` | §2.3 |
| `guion.js` | §2.5 |
| `asociar.js` | §3 |
| `simular.js` | §4.3 |
| `analisis.js` | `analizarCarpeta()` (orquestador) y almacén de trabajos en memoria |

### 5.2 `google.js`
```js
const HOSTS = (h) => ['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'].includes(h) || h.endsWith('.googleusercontent.com')
export const RE_ID = /^[A-Za-z0-9_-]{10,100}$/
export async function descargarGoogle(url, { maxBytes = 15 * 1024 * 1024, tiempoMs = 30000 } = {}) → { estado, tipo, datos: Buffer }
  // bucle de hasta 5 saltos: u = await validarDestino(url) (red.js); si !HOSTS(u.hostname) → Error('no_publico' si es accounts.google.com, si no 'host_no_permitido');
  // fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(tiempoMs), headers: { 'user-agent': 'Mozilla/5.0 (compatible; PraxiaPiloto/1.0)' } });
  // 3xx → siguiente salto; corta por content-length y por bytes leídos > maxBytes ('demasiado_grande').
export async function listarCarpetaPublica(id, resourcekey) → { nombre, entradas: [{ id, nombre, tipo: 'carpeta'|'doc'|'docx'|'hoja'|'otro', url }] }
  // GET https://drive.google.com/embeddedfolderview?id=<id>[&resourcekey=<rk>]; 404 → Error('carpeta_no_publica');
  // cheerio: $('.flip-entry') → id de attr 'id' (sin 'entry-'), href, $('.flip-entry-title').text(); nombre de carpeta: $('title').text().
  // tipo por href: /drive\/folders\// carpeta · docs.google.com\/document doc · spreadsheets hoja · /file/d/ y nombre .docx docx · otro.
  // Más de 500 entradas → Error('carpeta_demasiado_grande').
export async function exportarDocHtml(id) → string   // https://docs.google.com/document/d/<id>/export?format=html; tipo debe ser text/html
export async function leerCsvHoja(id, { gid, hoja }) → string  // export?format=csv&gid=… o gviz/tq?tqx=out:csv&sheet=…; tipo text/csv
```

### 5.3 Fuentes (interfaz común)
```js
// Fuente = {
//   nombre: 'publica' | 'fixtures' | 'n8n',
//   listar(carpetaId, resourcekey?) → Promise<{ nombre, entradas: Entrada[] }>,
//   leerDocHtml(entrada) → Promise<string>,
//   leerCatalogoRecursos() → Promise<string|null>,      // CSV o null si no se pudo
//   leerCatalogoActividades() → Promise<string|null>
// }
export function crearFuentePublica()         // google.js
export function crearFuenteFixtures(dir)     // carpeta local que imita Drive (§8.1). ID = 'fx' + sha1(ruta relativa).slice(0, 24)
export function crearFuenteN8n(url)          // PLAN B: POST firmado (mismo esquema HMAC que los avisos, secreto config.n8nEventosSecreto) a un flujo NUEVO
                                             // «DIEPO - Curso piloto (leer carpeta)»: entrada { carpeta_id }, salida { nombre, entradas, documentos: { [id]: html } }
                                             // (Drive API files.list con paginación + files.export mimeType text/html). Los flujos existentes no se tocan.
export function fuentePorEntorno()           // PILOTO_FUENTE === 'n8n' && PILOTO_N8N_URL → n8n;
                                             // PILOTO_FUENTE === 'fixtures' && NODE_ENV === 'test' && PILOTO_FIXTURES → fixtures (solo pruebas manuales locales);
                                             // en cualquier otro caso → publica
```

### 5.4 API
Montaje en `servidor/src/app.js`, **una línea** antes de `app.use('/api', exigirCabecera, rutas)` (l.50) y su `import`:
```js
import { rutasPiloto } from './piloto/rutas.js'
app.use('/api/piloto', exigirCabecera, rutasPiloto)
```
Permiso: `exigirPermiso('proyectos.crear')` (existente; el que ya exigen lanzar guiones y unidades). No se crea permiso nuevo.

| Método y ruta | Cuerpo / parámetros | Respuesta |
|---|---|---|
| `POST /api/piloto/analisis` | `{ "carpeta_url": "https://drive.google.com/drive/folders/<ID>[?usp=…&resourcekey=…]" }` (zod `.strict()`, máx. 500, regex `^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]{10,100}(?:[/?#].*)?$`) | `202 { "id": "<uuid>" }` · `400` datos no válidos · `403` · `429` «Ya tiene un análisis en curso» o «El servidor está ocupado con otros análisis» |
| `GET /api/piloto/analisis/:id` | `id` uuid | `200` objeto del §6 · `404` si no existe, venció o es de otra persona |
| `DELETE /api/piloto/analisis/:id` | | `204` (olvida el resultado) |

- Límites: `limiteCrear` 6/min por persona, `limiteLeer` 240/min (mismo patrón `porPersona` de `guiones/rutas.js`).
- Trabajos en memoria (`Map`), dueño = `req.usuario.id`; **1** en curso por persona, **3** en total; resultado guardado **60 min** (limpieza en cada petición); máximo 50 guardados.
- Asíncrono porque un curso con 4 unidades y ~5 documentos por carpeta son ~30 descargas de 1–3 s (más que el tiempo de espera de un proxy). Concurrencia de descargas: 4. Tope por análisis: 150 documentos, 6 minutos (se corta con `estado: 'error'`, `error: 'tiempo_agotado'`).
- La carpeta raíz se recorre a **un nivel**: solo se abren las subcarpetas «Guiones U#». Ningún contenido de documento se guarda en el resultado (solo nombres, IDs, enlaces y lo extraído). Nada se escribe en la base. Los registros de consola solo llevan el id del trabajo y conteos.

### 5.5 Orquestador (`analisis.js`)
```js
export async function analizarCarpeta({ carpetaId, resourcekey, fuente, alAvanzar = () => {} }) → Resultado   // §6.resultado
```
Pasos (cada uno llama `alAvanzar({ paso, hechos, total })`):
1. `listar` raíz → `clasificarRaiz`.
2. Catálogos (`leerCatalogoRecursos/Actividades`) en paralelo con 3.
3. Leer y clasificar: Syllabus candidato(s), Docs de la raíz (para documentos de unidad en la raíz), y por cada carpeta «Guiones U#» `listar` + leer sus Docs.
4. `leerSyllabus` → formación (§4.5).
5. `asociar` → unidades.
6. Por unidad con documento de unidad: `extraerRecursos` + cruce con guiones (§3.4.3).
7. `cargarPlantillas(categorías usadas)` + `modoPruebasPlantillas()` → `simularUnidad` por unidad (solo si hay formación).
8. Totales y problemas.

Errores de un documento (no público, demasiado grande, tiempo) no detienen el análisis: el documento queda `ilegible` con el motivo. Solo detienen todo: carpeta raíz no legible (`carpeta_no_publica`) o tiempo total agotado.

---

## 6. Esquema exacto de la respuesta

`GET /api/piloto/analisis/:id`:
```jsonc
{
  "id": "uuid",
  "estado": "en_cola | leyendo | analizando | listo | error",
  "avance": { "paso": "Leyendo «Guiones U2»", "hechos": 12, "total": 31 },
  "creado": "ISO-8601", "terminado": "ISO-8601 | null",
  "error": null,                       // texto listo para mostrar si estado = error (p. ej. carpeta_no_publica → mensaje de §9)
  "resultado": null | {
    "version": 1,
    "carpeta": { "id": "…", "nombre": "…", "url": "https://drive.google.com/drive/folders/…" },
    "fuente": "publica | n8n | fixtures",
    "modo_pruebas": false,
    "formacion": { "valor": "tecnologico | profesional | especializacion | doctorado | null", "texto": "Tecnológico", "fuente": "syllabus | unidad | null" },
    "catalogo": {
      "recursos":    { "fuente": "hoja | respaldo_palabras", "filas": 36 },
      "actividades": { "fuente": "hoja | no_disponible", "filas": 63 }
    },
    "syllabus": {
      "estado": "encontrado | falta | ambiguo | ilegible",
      "documento": Doc | null,
      "candidatos": [Doc],
      "unidades": [{ "numero": 1, "nombre": "…" }]
    },
    "unidades": [{
      "numero": 1, "nombre": "…", "en_syllabus": true,
      "estado": "completa | incompleta | ambigua | sin_documento_unidad | sin_carpeta",
      "carpeta": Carpeta | null, "carpetas_candidatas": [Carpeta],
      "documento_unidad": (Doc & { "origen": "carpeta | raiz" }) | null, "documento_unidad_candidatos": [Doc],
      "guiones": [Doc & { "tema": 2, "codigos": ["U1-T2-R1"], "ids_en_guion": { "U1-T2-R1": "G-09-A" }, "actividades": 3 }],
      "no_reconocidos": [Doc & { "motivo": "…" }],
      "temas": [{ "numero": 1, "nombre": "1. …", "guion_id": "…" | null }],
      "presentacion": Item | null,
      "recursos": [Item],
      "actividades": [Item],
      "conteo": { "recursos": 26, "actividades": 13, "asignadas": 35, "repetidas": 1, "sin_asignar": 2, "no_html": 4 },
      "problemas": [Problema]
    }],
    "carpetas_sobrantes": [Carpeta & { "numero": 5 }],
    "otras_carpetas": [Carpeta],
    "raiz_no_reconocidos": [Doc],
    "problemas": [Problema],          // globales: syllabus, formación, catálogo
    "diferencias_con_sistema_real": ["Actividades: se elige la primera variante libre (el sistema real elige al azar)", "…"],
    "resumen": { "unidades_syllabus": 4, "unidades_encontradas": 3, "guiones": 9, "recursos": 70, "actividades": 35,
                 "asignadas": 98, "repetidas": 2, "sin_asignar": 5, "no_html": 9, "problemas": 4 }
  }
}
```
Tipos:
```jsonc
Doc      = { "id": "…", "nombre": "…", "url": "https://docs.google.com/document/d/…/edit", "tipo": "doc | docx | otro", "estado": "leido | ilegible", "motivo": null | "no_publico | demasiado_grande | tiempo | formato_no_soportado" }
Carpeta  = { "id": "…", "nombre": "…", "url": "…" }
Item     = {
  "codigo": "U1-T3-R2 | U1-T3-A2 | U1-PRES", "clase": "recurso | actividad | presentacion",
  "tema": 3, "posicion": 2, "recurso_codigo": "U1-T3-R2" /* solo actividades */,
  "formato": "Acordeón" /* recurso */, "nombre": "Actuación ante escenarios críticos" /* actividad */, "titulo": "…",
  "con_actividad": true /* recurso */, "calificable": true | false | null /* actividad */,
  "categoria": "G-09 | ACT-E-05-TEC | G-13 | null", "id_base": "…", "id_catalogo": "G-09-A",
  "fuente_categoria": "hoja | respaldo_palabras | null", "tipo_produccion": "HTML | Video | null",
  "id_en_guion": "G-09-A | null", "guion_id": "… | null", "detectado_en": "unidad | guion",
  "estado": "asignada | repetida | sin_asignar | no_html",
  "motivo": null | "<motivo>",
  "aviso": null | "texto",
  "variante": null | { "plantilla": "acordeon-tec-01", "formacion": "tecnologico | null", "revision": "aprobada | revision | rechazada | corregida",
                       "url_ver": "/plantillas-html/ver/acordeon-tec-01", "regla": "primera_libre | primera_libre_determinista | menos_usada_determinista", "candidatas": 3 }
}
Problema = { "tipo": "falta | ambiguo | discrepancia | ilegible | no_reconocido | catalogo | formacion", "unidad": 1 | null, "codigo": "…" | null,
             "mensaje": "texto para la persona", "candidatos": [Doc | Carpeta] }
```
Motivos (`Item.motivo`): los del sistema real — `categoria_inexistente`, `categoria_sin_variantes`, `categoria_no_es_de_la_formacion`, `sin_variantes_de_la_formacion`, `sin_variantes_aprobadas`, `variantes_agotadas`, `categoria_sin_calificables`, `categoria_sin_practicas`, `falta_calificable`, `calificable_repetida`, `variante_repetida` — y los propios del piloto: `formacion_desconocida`, `formato_fuera_de_catalogo`, `actividad_fuera_de_catalogo`, `actividad_ambigua`, `catalogo_actividades_no_disponible`, `calificable_indeterminada`, `id_discrepante`, `codigo_repetido`, `falta_documento_unidad`, `unidad_ambigua`, `presentacion_no_indicada`, `fila_sin_recurso`. `url_ver` es relativa a la base de la plataforma (el cliente antepone `RUTA_API` sin `/api`).

---

## 7. Frontend

### 7.1 Archivos nuevos
- `plataforma-react/src/components/CursoPiloto.jsx`
- `plataforma-react/src/components/curso-piloto.css` (importado solo desde `CursoPiloto.jsx`, como `matrices.css` en `MatricesH5P.jsx`); todas las clases con prefijo `cp-`; solo variables y clases existentes (`wrapx`, `card`, `btn`, `btn sec sm`, `msg ok|info|bad|warn`, `help`, `row`, `crumbs`, `card st`) se reutilizan, sin redefinirlas.

### 7.2 Cambios puntuales en `plataforma-react/src/App.jsx`
1. `import CursoPiloto from './components/CursoPiloto.jsx'` junto a los demás imports.
2. Restauración por URL (l.78-84), una rama: `else if (p[0] === 'curso-piloto' && perm('proyectos.crear')) setVista('curso-piloto')`.
3. Guardia (l.110): añadir `'curso-piloto': 'proyectos.crear'` al objeto `exige`.
4. Menú (después de la opción «Dashboard», l.274):
   `{yo.permisos.includes('proyectos.crear') && <ItemMenu on={vista === 'curso-piloto'} icono="M2 9l10-5 10 5-10 5L2 9zM6 11.5V16c0 1.2 2.7 3 6 3s6-1.8 6-3v-4.5" texto="Curso piloto" onClick={() => ir('curso-piloto')} />}`
5. Render (junto a l.283-288): `{vista === 'curso-piloto' && yo.permisos.includes('proyectos.crear') && <CursoPiloto />}`

El efecto que escribe `#/<vista>` (l.88-94) ya produce `#/curso-piloto` sin cambios. Comentario de l.43 y l.67: añadir `curso-piloto` a la lista (solo comentario).

### 7.3 Comportamiento de `CursoPiloto.jsx`
- Encabezado `<Titulo icono="curso"><h1>Curso piloto</h1><p className="lead">Pegue el enlace de la carpeta raíz del curso en Drive. Se leen el Syllabus y las carpetas «Guiones U…», y se simula qué variante HTML recibiría cada recurso y actividad. No se guarda nada ni se cambia ningún curso.</p></Titulo>`.
- **Una sola entrada**: URL de carpeta, validada con `RE_CARPETA` de `lib/syllabus.js` (mensaje: «Pegue el enlace de una carpeta de Google Drive»). Botón «Analizar» (deshabilitado si no valida o hay un análisis en curso). Ayuda bajo el campo: «La carpeta y sus documentos deben estar compartidos como "Cualquier persona con el enlace" (lector)».
- Al enviar: `api('POST', '/piloto/analisis', { carpeta_url })` → guarda `id` (y en `sessionStorage` `cp-ultimo`, con try/catch) → sondeo `GET` cada 2 s mientras `estado` no sea `listo|error` (se detiene al desmontar). Barra de avance con `avance.paso` y `hechos/total`.
- Resultado:
  1. Avisos globales: `modo_pruebas` («Modo de pruebas de plantillas encendido: se usan plantillas sin aprobar»), formación (valor + fuente) o su problema, fuente del catálogo, `diferencias_con_sistema_real` (en un `<details>`).
  2. Tarjetas (`card st`): Unidades (encontradas / del Syllabus), Guiones, Recursos, Actividades, Asignadas, Sin asignar.
  3. Lista de `problemas` globales y por unidad (`msg bad` para `falta|ambiguo|discrepancia|ilegible`, `msg warn` para el resto), con enlaces a los documentos/carpetas candidatos.
  4. Por unidad, un `<details className="cp-unidad">` (abierto si tiene problemas): cabecera con número, nombre, estado (`cp-estado ok|warn|bad`), enlaces a carpeta y documento de unidad; lista de guiones (tema → enlace); tabla `Código | Recurso / actividad | Categoría (ID) | Variante | Estado`: la variante enlaza a `url_ver` (nueva pestaña); `sin_asignar` muestra el motivo en texto (mapa `MOTIVO` en el componente, reutilizando los textos de `MOTIVOS` de `preparacion.js` donde existan); `repetida` con su aviso; actividades indentadas bajo su recurso; la calificable con etiqueta «Calificable».
  5. Botón «Descargar resumen (JSON)» (Blob local) y «Analizar otra carpeta».
- Errores de la API en `msg bad` con `e.message`. Sin `localStorage` para datos.

---

## 8. Plan de pruebas

### 8.1 Fixtures sintéticos (sin red ni base): `servidor/test/fixtures/piloto/`
Formato de la fuente de fixtures: un directorio = una carpeta de Drive; `*.html` = Google Doc (HTML con la misma forma que `export?format=html`: `<body>` con `<p>` y `<table><tbody><tr><td><p>…`); `*.docx` = archivo subido; cualquier otro = `otro`. `_catalogo/recursos.csv` y `_catalogo/actividades.csv` (fila 1 título, fila 2 encabezados reales listados en §1.1, filas sintéticas). Directorios que empiezan por `_` no se listan.

```
fixtures/piloto/
  _catalogo/recursos.csv        G-01 Infografía · G-05 Video (Tipo de producción «Video») · G-09 Acordeón (alias «Acordeones») · G-11 Lectura diagramada ·
                                G-13 Presentación en diapositivas · G-14 Infografía de presentación · PRE-05 Cuadro comparativo
  _catalogo/actividades.csv     ACT-E-05-TEC «Actuación ante escenarios críticos» · ACT-G-02 «Toma de decisiones» · ACT-E-11-TEC «Verdadero o falso» ·
                                ACT-G-04 y ACT-G-05 ambas con «Simulaciones de caso» en «Nombre en TEC» (ambigua)
  curso-ejemplo/
    Syllabus Seguridad.html                      3 unidades («Unidad Nro. 1/2/3»), fila «Nivel de formación | Tecnológico»
    Unidad 2 - Estructura metodológica.html      documento de la U2 en la raíz
    Notas.html                                   no reconocido
    Guiones U1 - Fundamentos - 2026-11-20 10-00/
      Unidad 1 - Estructura metodológica.html    ESTRUCTURA METODOLÓGICA – UNIDAD 1; tabla «Tipo de recurso» (Recurso de presentación: Presentación en diapositivas);
                                                 Tema 1: 3 filas (Acordeón+actividad «Toma de decisiones: …», Video+No aplica, Infografía+«Verdadero o falso: …»);
                                                 Tema 2: 2 filas (Cuadro comparativo+«Actuación ante escenarios críticos: …», Lectura diagramada+No aplica);
                                                 EVALUACIONES: Actividad de autoaprendizaje · Mecanismo: Actuación ante escenarios críticos · Momento: tema: 2
      Guion_U1_T1.html                           Códigos U1-T1-R1 · G-09-A, U1-T1-R2 · G-05-C, U1-T1-R3 · G-01-A
      Guion_U1_T2.html                           Códigos U1-T2-R1 · PRE-05-A, U1-T2-R2 · G-11-C
    Guiones U2/
      Guion_U2_T1.html                           Códigos U2-T1-R1 · G-01-A (el documento de U2 dice Acordeón → id_discrepante)
    Guiones U4/
      Guion_U4_T1.html                           carpeta sobrante (U4 no está en el Syllabus) y sin documento de unidad
  curso-ambiguo/
    Syllabus A.html, Syllabus B.html             dos syllabus → ambiguo
    Guiones U1 - x - 2026-11-01 08-00/ y Guiones U1 - x - 2026-11-20 08-00/   dos carpetas U1 → unidad ambigua
    Guiones U2/ con dos documentos de unidad UNIDAD 2 y un guion con actividad «Simulaciones de caso»
  curso-sin-formacion/
    Syllabus.html (sin «Nivel de formación») + Guiones U1/ (unidad completa)
```
Catálogo de plantillas para la simulación (sin base): `fixtures/piloto/_plantillas.json` (lo usan la prueba y `piloto-probar.js --sin-base`) con `tipoDe`, `formDe` y `variantesDe` (`{ nombre, formacion, calificable, ultimo, creado }`), p. ej. `G-09`: 2 aprobadas tecnológico; `ACT-E-05-TEC`: 1 calificable aprobada; `ACT-G-02`: 3 prácticas aprobadas; `G-13`: 1 aprobada; `PRE-05`: 1 en revisión (→ `sin_variantes_aprobadas`).

### 8.2 `servidor/test/piloto.test.js` (node:test, sin base) — criterios medibles
- `bloquesDeHtml`: orden párrafo/tabla, texto de celdas con `\n`, tablas anidadas, `colspan`.
- `leerSyllabus` (curso-ejemplo): 3 unidades con nombre, `formacion === 'tecnologico'`.
- `leerUnidad` + `extraerRecursos` (U1): 5 recursos con códigos `U1-T1-R1…R3`, `U1-T2-R1…R2`; `id_catalogo` `G-09-A`, `G-05-C`, `G-01-A`, `PRE-05-A`, `G-11-C`; 3 actividades `U1-T1-A1`, `U1-T1-A3`, `U1-T2-A1`; **una sola** `calificable: true` = `U1-T2-A1` (`ACT-E-05-TEC`); presentación `U1-PRES` categoría `G-13`, `id_catalogo` `G-13-C`.
- Port fiel: tabla de casos `baseId`/`claveCat`/`baseIdPorPalabras` con las mismas entradas y salidas que el código de n8n (copiar 10 nombres reales: «Acordeones», «Infografía interactiva», «Línea de tiempo», «Presentación de la asignatura» → `G-00`, etc.).
- `asociar` (curso-ejemplo): Syllabus `encontrado`; U1 `completa` con 2 guiones (temas 1 y 2) y documento `origen: 'carpeta'`; U2 documento `origen: 'raiz'`, `U2-T1-R1` `id_discrepante` y sin variante; U3 `sin_carpeta` (problema `falta`); U4 en `carpetas_sobrantes`, `sin_documento_unidad`, su recurso `detectado_en: 'guion'` y `falta_documento_unidad`; `Notas` en `raiz_no_reconocidos`.
- `asociar` (curso-ambiguo): Syllabus `ambiguo` con 2 candidatos; U1 `ambigua` con 2 carpetas; U2 `ambigua` (2 documentos de unidad); **ninguna** variante asignada en U1/U2; la actividad «Simulaciones de caso» `actividad_ambigua` con `[ACT-G-04, ACT-G-05]`.
- `simularUnidad`: `G-09` → primera aprobada por `creado`; `G-05` → `no_html`; `PRE-05` → `sin_variantes_aprobadas`; calificable → la única calificable; prácticas → la primera libre, y al agotarse `repetida` con `variante_repetida` + aviso; dos ejecuciones con la misma entrada dan **exactamente** el mismo resultado (determinismo); con `pruebas: true` se asignan variantes en revisión y las de la formación van primero.
- `curso-sin-formacion`: problema `formacion`, 0 asignadas, recursos listados con categoría.
- `descargarGoogle`: rechaza `http://127.0.0.1`, `https://evil.com`, y una redirección simulada a `accounts.google.com` (con `fetch` sustituido en la prueba).
- `listarCarpetaPublica`: parseo de un HTML guardado de `embeddedfolderview` (fixture `embedded.html` construido a mano con la estructura del §1.1: carpeta, Doc, hoja, archivo .docx).
- Rutas sin base: `rutas.js` exporta además `crearRutasPiloto({ antes = [exigirSesion, exigirPermiso('proyectos.crear')], fuente = fuentePorEntorno, plantillas = cargarPlantillas, pruebas = modoPruebasPlantillas })` y `rutasPiloto = crearRutasPiloto()`. La prueba monta `express()` + `express.json()` + `crearRutasPiloto({ antes: [(req, _r, n) => { req.usuario = { id: req.get('x-prueba-usuario') }; n() }], fuente: () => crearFuenteFixtures(dir), plantillas: async () => catalogoDePrueba, pruebas: async () => false })`, lo levanta con `app.listen(0)` y usa `fetch` (no hay `supertest`). Casos: 400 con URL no válida, 202 + sondeo hasta `listo` con el resultado esperado, 404 para el trabajo de otra persona, 429 con un segundo análisis de la misma persona en curso.

Comando: `cd servidor && node --test test/piloto.test.js` (no necesita base de datos; evita el fallo local de la base temporal WIN1252).

### 8.3 Integración con base (opcional, `servidor/test/piloto-base.test.js`)
Mismo arranque que `test/asignaciones.test.js` (`embedded-postgres`, migraciones 001…013). Siembra categorías y variantes, corre `analizarCarpeta` con la fuente de fixtures y comprueba: variantes = las de §8.2; **`SELECT count(*) FROM asignacion_variantes` y `FROM pipeline_origen` siguen en 0**; `GET /plantillas-html/plantillas.json` es idéntico antes y después. Comando: `node --test test/piloto-base.test.js`. **Necesita base temporal**: localmente puede fallar por la codificación WIN1252 ajena a esta función; correrlo donde ya corre `npm test` (servidor o CI) o con `PGCLIENTENCODING=UTF8`/`LC_ALL=C.UTF-8` si el entorno lo permite.

### 8.4 Script manual `servidor/scripts/piloto-probar.js`
`node scripts/piloto-probar.js <url-carpeta | --fixtures <dir>> [--sin-base <plantillas.json>]` imprime el resultado (§6) en JSON. Con `--sin-base` lee `tipoDe/formDe/variantesDe` de un JSON local en vez de la base. Sirve para la carpeta real sin levantar la API.

### 8.5 Prueba con una carpeta real (sin credenciales de producción en el servidor)
1. Desde la sesión principal, con el conector de Google Drive del usuario (`search_files`, `get_file_metadata`, `get_file_permissions`): localizar una carpeta de curso con «Guiones U#» y ver si está compartida con enlace. **Cambiar el uso compartido lo decide y lo hace el usuario** (o se le pide permiso explícito antes).
2. Si está compartida con enlace: `node scripts/piloto-probar.js <url>` y, con la API arriba, la pantalla «Curso piloto».
3. Si no puede compartirse: con el conector, exportar cada Doc a HTML (`download_file_content` con `text/html`) a `servidor/test/fixtures/piloto/_real/` (**añadir `_real/` a `.gitignore`**: son datos del usuario; nunca se suben) y correr con `--fixtures`.
4. Criterios de aceptación con la carpeta real: Syllabus detectado; N unidades = filas «Unidad Nro.» del Syllabus; por unidad, guiones = Docs `Guion_U#_T#` de su carpeta; recursos y actividades = los que da el flujo «Preparar el curso» con `simular: true` para esas mismas unidades (comparar conteos y categorías código a código: 26 recursos y 13 actividades en la U1 de Tecnología de referencia, calificable `U1-T3-A2` → `ACT-E-05-TEC`); cada variante asignada pertenece a `variantesDe[categoria]` y cumple `elegibles()`; cada falta/ambigüedad sembrada a propósito (renombrar una copia, duplicar una carpeta) aparece como problema y sin variante.

### 8.6 No regresión
- `cd servidor && npm test` (suite completa, donde funcione la base temporal): debe pasar igual que antes. El único cambio en código existente del servidor es `export` en `elegibles`; `test/asignaciones.test.js` y `test/guiones-preparacion.test.js` cubren su comportamiento.
- `cd plataforma-react && npm run build`: compila.
- `git diff --stat` debe mostrar **solo** los archivos del §9.2 además de los nuevos. Ningún cambio en `n8n/`, `servidor/sql/`, `servidor/src/consultas.js`, `servidor/src/config.js`, estilos globales (`*.css` fuera de `components/curso-piloto.css`).
- Manual: abrir un curso existente y comprobar que «Dashboard», «Nuevo curso», guiones, «Matrices y H5P» y «Plantillas HTML» se ven y funcionan igual; el menú solo suma «Curso piloto».

---

## 9. Aislamiento: archivos

### 9.1 Nuevos
```
servidor/src/piloto/rutas.js
servidor/src/piloto/google.js
servidor/src/piloto/fuentes.js
servidor/src/piloto/documento.js
servidor/src/piloto/catalogo.js
servidor/src/piloto/syllabus.js
servidor/src/piloto/unidad.js
servidor/src/piloto/guion.js
servidor/src/piloto/asociar.js
servidor/src/piloto/simular.js
servidor/src/piloto/analisis.js
servidor/scripts/piloto-probar.js
servidor/test/piloto.test.js
servidor/test/piloto-base.test.js            (opcional)
servidor/test/fixtures/piloto/**              (§8.1)
plataforma-react/src/components/CursoPiloto.jsx
plataforma-react/src/components/curso-piloto.css
```

### 9.2 Existentes (cambio puntual)
| Archivo | Cambio |
|---|---|
| `servidor/src/pipeline/asignaciones.js` | l.63: `function elegibles(` → `export function elegibles(` |
| `servidor/src/app.js` | `import { rutasPiloto } from './piloto/rutas.js'` y `app.use('/api/piloto', exigirCabecera, rutasPiloto)` antes de l.50 |
| `plataforma-react/src/App.jsx` | 5 cambios del §7.2 |
| `servidor/package.json` | (opcional) `"test:piloto": "node --test test/piloto.test.js"`; **no** se añade a `test` para no alterar la suite existente |
| `.gitignore` | (solo si se usa §8.5.3) `servidor/test/fixtures/piloto/_real/` |

Nota: el árbol de trabajo ya tiene cambios sin confirmar en `servidor/src/config.js`, `servidor/src/pipeline/lanzar.js`, `servidor/src/pipeline/preparacion.js`, `plataforma-react/src/components/Guiones.jsx` y `n8n/…`; esta función **no** los toca (las variables de entorno `PILOTO_*` se leen con `process.env` dentro de `src/piloto/`, sin pasar por `config.js`).

No se toca: ningún flujo n8n (ni `n8n/vivo/guiones-vivo.json`), ninguna migración SQL, `consultas.js`, `preparacion.js`, `red.js`, `seguridad.js`, las tablas `asignacion_variantes`/`pipeline_origen`, las rutas `/api/n8n/*`, ni los formatos Tecnológico, Profesional, Especialización o Doctorado (sus plantillas, catálogos y resultados).

---

## 10. Pasos de implementación (en orden)

1. `export` en `elegibles` (§9.2). Correr `node --test test/asignaciones.test.js` donde funcione la base (o revisar que el diff es de una palabra).
2. `documento.js` + pruebas de `bloquesDeHtml` con HTML a mano.
3. `catalogo.js`: copiar `normCat`, `claveCat`, `baseIdPorPalabras` (de `n8n/vivo/guiones-vivo.json`, nodo «Preparar relleno del guion1») y la construcción de `INDICE`, `INDICE_ACT`, `idsDe`, `mismoNombre`, `categoriaPresentacion` (de «Extraer recursos»); `leerCsv`, `filasConEncabezado`. Pruebas de fidelidad.
4. `syllabus.js`, `unidad.js` (port de `leerUnidad` y del bucle de una unidad), `guion.js`. Crear fixtures `curso-ejemplo`. Pruebas.
5. `asociar.js` + fixtures `curso-ambiguo`, `curso-sin-formacion`. Pruebas.
6. `simular.js` (`simularUnidad` pura + `cargarPlantillas` con `Q.*`). Pruebas puras.
7. `google.js` (`descargarGoogle` con `validarDestino` y lista blanca; `listarCarpetaPublica`; `exportarDocHtml`; `leerCsvHoja`) + `fuentes.js` (pública y fixtures). Pruebas con `fetch` sustituido y `embedded.html`.
8. `analisis.js` (orquestador, almacén de trabajos, concurrencia 4, topes) + `rutas.js` + montaje en `app.js`. Pruebas de rutas con fixtures.
9. `scripts/piloto-probar.js`. Probar con `--fixtures` y, si hay una carpeta pública, con su URL.
10. Frontend: `CursoPiloto.jsx`, `curso-piloto.css`, cambios en `App.jsx`. `npm run build`. Prueba manual con el servidor local apuntando a fixtures (`NODE_ENV=test PILOTO_FUENTE=fixtures PILOTO_FIXTURES=test/fixtures/piloto/curso-ejemplo`) o a una carpeta pública.
11. (Opcional) `piloto-base.test.js`.
12. Verificación de no regresión (§8.6) y prueba real (§8.5).

Comandos:
```bash
cd servidor && node --test test/piloto.test.js
cd servidor && node scripts/piloto-probar.js --fixtures test/fixtures/piloto/curso-ejemplo --sin-base test/fixtures/piloto/_plantillas.json
cd servidor && node scripts/piloto-probar.js "https://drive.google.com/drive/folders/<ID>"
cd servidor && npm test            # suite existente (requiere base temporal)
cd plataforma-react && npm run build
```

---

## 11. Riesgos, límites y lo que debe decidir o hacer el usuario

**Riesgos y límites**
- **Carpeta no pública**: la opción A solo funciona si la carpeta raíz, las carpetas «Guiones U#» y **cada documento** están compartidos con «Cualquier persona con el enlace» (lector). Compartir solo con el dominio institucional no basta. Mensaje en pantalla: «No se pudo leer la carpeta: compártala (y sus documentos) como "Cualquier persona con el enlace" con permiso de lector, o pida activar la lectura por n8n». Si la política de la institución lo impide → plan B (§5.3).
- **`embeddedfolderview` no está documentada** por Google: puede cambiar o limitarse sin aviso. Se aísla en `listarCarpetaPublica()`; si falla, el error es claro y se pasa al plan B. Tope de entradas no verificado por encima de 100.
- **Exportaciones anónimas**: Google puede limitar muchas descargas seguidas desde una misma IP; por eso concurrencia 4 y tope de 150 documentos por análisis.
- **Documentos con formato distinto** (tablas reordenadas, títulos de tema sin número, EVALUACIONES sin la fila de autoaprendizaje): las reglas son las del flujo vivo; lo que no cumplan se reporta (`no_reconocido`, `calificable_indeterminada`, `formato_fuera_de_catalogo`), nunca se adivina.
- **Copia de reglas**: el código portado puede quedar desfasado si se cambia el flujo n8n. Mitigación: comentario en cada función copiada y pruebas de fidelidad con casos fijos; quien cambie el flujo debe actualizar `src/piloto/`.
- **Catálogo de IDs**: hoy la hoja es legible con el enlace. Si deja de serlo, los recursos usan el respaldo por palabras (marcado) y las actividades no se asignan. Hay una incoherencia conocida entre flujos: el de guiones usa `G-00` para la presentación y el de preparación `G-13/14/15`; el piloto sigue al de preparación (el que alimenta las asignaciones) y lo deja dicho en «diferencias».
- **La simulación no es la asignación real**: parte de un curso vacío y no aleatoriza actividades; sirve para revisar cobertura del catálogo y de las variantes, no para fijar variantes de un curso.
- **Modo de pruebas de plantillas**: si está encendido, el piloto también asigna variantes sin aprobar (igual que el sistema); se avisa en pantalla.

**Lo que debe hacer o decidir el usuario**
1. Elegir una carpeta de ejemplo y compartirla (con sus documentos) como «Cualquier persona con el enlace», o decidir que se use el plan B (crear y activar en n8n el flujo nuevo «DIEPO - Curso piloto (leer carpeta)» con la credencial «INNOVACION EDUCATIVA» y poner `PILOTO_FUENTE=n8n`, `PILOTO_N8N_URL=…` en el `.env` del servidor).
2. Confirmar que la hoja del catálogo de IDs puede seguir legible con enlace (hoy lo es; si se cierra, el piloto pierde las actividades).
3. Confirmar las diferencias del §4.4 (sobre todo: actividades en orden determinista y presentación sin valor por defecto).
4. Decidir si quiere, en el futuro, que ante varias carpetas «Guiones U#» del mismo número se tome automáticamente la de fecha más reciente en el nombre (hoy: se reporta como ambigua y no se asigna).
5. Confirmar el permiso: «Curso piloto» visible para quien tenga `proyectos.crear`.
