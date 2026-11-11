# OVA · 6 recursos HTML tipo plantilla

Tema de ejemplo: *Gestión de solicitudes de clientes* (cámbielo editando el JSON).

| # | Recurso | Actividad asignada (sin repetir) | Prioridad |
|---|---|---|---|
| 1 | Infografía interactiva | Taller aplicado | Prioritaria |
| 2 | Línea de tiempo dinámica | Tarea evaluativa | Prioritaria |
| 3 | Mapa conceptual interactivo | Clasificaciones | Complementaria |
| 4 | Video de microlearning | Cuestionarios con retroalimentación | Complementaria |
| 5 | Presentación multimedia interactiva | Toma de decisiones | Prioritaria |
| 6 | Laboratorio virtual | Simulaciones de caso | Prioritaria |

## Uso
- Abrir cualquier archivo de `recursos/` en el navegador (no requiere internet ni librerías).
- **Plantilla:** cada HTML guarda su contenido en `<script id="contenido" type="application/json">`. Cambie solo ese JSON.
- Para editar con el flujo completo: modifique `src/contenido/NN.json` y ejecute `node build.js`.
- Para comprobar los rangos de las fichas (palabras, nodos, hitos, pares, etc.): `node validar.js`.

---

## Plataforma de recursos (`plataforma/index.html`)

Abra `plataforma/index.html` con doble clic (Chrome o Edge). No necesita internet ni servidor; los proyectos se guardan en el navegador.

1. **Cargar el guion** (Word `.docx`, `.txt`, `.md` o texto pegado). La plataforma busca cada recurso por su código (`U2-T1-OVA1 Nombre del recurso`) y lee su contenido: título, escenas, nodos y conexiones, bloques, secciones, actividad (materiales, pasos, evidencia, criterios) y la tabla de información general.
2. **Revisar**: muestra qué recursos encontró, qué texto no pudo ubicar y los avisos. Solo usa texto del guion; no inventa preguntas, respuestas ni contenido.
3. **Tarjetas** con vista previa de cada recurso. Al abrir una: editor con vista previa en vivo (Contenido · Colores y letra · Orden y opciones · Ayuda), deshacer/rehacer, vista «Ver todo» / «Como estudiante» y «Descargar recurso» (un .html independiente).

Tipos de recurso: Presentación, Diagrama de flujo, Video explicativo, Micro-video, Podcast y Lectura diagramada.

Para reconstruir después de tocar el código: `node build-plataforma.js`.

---

## Plataforma en React (`plataforma-react/`)

Misma plataforma, ahora hecha con **React + Vite**. Los recursos que genera siguen siendo archivos `.html` independientes.

- Para desarrollar: `cd plataforma-react` → `npm install` (una sola vez) → `npm run dev`.
- Para generar la versión final: `npm run build` → queda **`plataforma-react/dist/index.html`**, un solo archivo que se abre con doble clic.
- Comparte con la versión anterior el lector de guiones (`src/plataforma/engine.js`), las plantillas de los recursos (`src/plataforma/plantillas/`) y los estilos.
- Estructura: `src/App.jsx` (pantallas), `src/components/` (Inicio, Revision, Galeria, Editor, Paneles, Fields), `src/lib/` (render del recurso, tema, almacenamiento).

### Organización por syllabus (versión React)

1. **Dashboard:** lista los syllabus agrupados por **programa** (filtro lateral, totales de programas, syllabus, documentos y recursos).
2. **Nuevo syllabus:** idéntico al portal `syllabus-portal.html` (que no se modifica): solo URL del syllabus y URL de la carpeta de destino. Envía los mismos datos al mismo webhook de n8n (configurable en «Conexión con n8n») y muestra los documentos por unidad con «Abrir documento» y «Copiar ruta». La plataforma solo guarda el resultado; ponerle programa y curso es opcional y sirve para agrupar el dashboard.
3. **Espacio de trabajo del syllabus:** pasos 1 Syllabus · 2 Recursos (cargar el guion y crear los recursos de ESE curso) · 3 Integración (pendiente).

Si n8n no responde por CORS, se puede guardar el syllabus y agregar los enlaces de los documentos a mano.

### Revisión de documentos antes de crear recursos

Dentro del syllabus (paso 1) los documentos por unidad se revisan **uno por uno**: se abre el documento, se aprueba y recién ahí se habilita el siguiente. Al aprobarlos todos se habilita el paso 2 (Recursos). Si n8n no devuelve los enlaces, se pueden agregar a mano.

### n8n: que responda con los enlaces de las unidades

El portal mostró «El flujo terminó. Revisa tu carpeta» porque la respuesta no traía la lista de documentos. En `n8n/` están:
- `preparar-respuesta-con-enlaces.js`: código del nodo **Preparar respuesta con enlace** (modo *Run Once for All Items*): junta todas las unidades en un solo ítem con `documentos_generados` (unidad, nombre y URL).
- `nodo-preparar-respuesta-con-enlace.json`: el mismo nodo para pegar en n8n.
El nodo «Responder enlaces de plantillas» (Respond to Webhook) debe ir después y responder con *First Incoming Item*.

### Unidades, temas y recursos (paso 2)

Al aprobar los documentos se habilita **Unidades y recursos**: una tarjeta por cada unidad que devolvió n8n. Al abrir una unidad se ven sus **temas** (con los recursos de cada uno) y la «Introducción de la unidad». El guion se carga **dentro de cada unidad**; cada recurso se ubica solo en su tema según su código: `U2-T1-OVA1` → Unidad 2, Tema 1; `U2-PRES` → Unidad 2, introducción. En la revisión se puede cambiar la unidad y el tema de cada recurso. Los temas se pueden nombrar y agregar a mano; si n8n devuelve los temas dentro de cada unidad (campo `temas`), aparecen solos.

## Plantillas públicas para n8n

En cada `npm run build` de `plataforma-react/` se arman solas las plantillas HTML de los recursos y quedan en `dist/plantillas-html/`, junto con `plantillas.json` (lista de archivos). Cada archivo ya trae los estilos, el código común, el tema (paleta DIEPO) y la fuente; solo quedan sin reemplazar **dos marcas**:

- `{{TITULO}}`: el título del recurso (texto; escape `& < > "`).
- `/*CONTENIDO*/`: el JSON del recurso (con `</` escrito como `</`, igual que hace la plataforma).

El servidor las sirve públicas y de solo lectura (sin sesión ni cabecera `x-ova`; CORS abierto solo para GET):

```
https://proyectos.americana.edu.co/praxia/plantillas-html/lectura.html
https://proyectos.americana.edu.co/praxia/plantillas-html/plantillas.json
```

(En un servidor sin subcarpeta: `/plantillas-html/<nombre>.html`.) Un flujo de n8n descarga la plantilla que necesite, reemplaza las dos marcas y obtiene el mismo HTML que genera la plataforma para ese contenido.

- **Se regeneran solas** con cada build y no se versionan en git (`dist/` está en `.gitignore`). Una plantilla nueva en `src/plataforma/plantillas/` aparece sola en el siguiente build, sin tocar el script. Si una plantilla no tiene exactamente una marca de cada tipo, el build falla.
- A mano: `node scripts/armar-plantillas.mjs [carpeta]` (dentro de `plataforma-react/`).
- El armado (tema, paleta y reemplazos) está en `plataforma-react/src/lib/armado.js`; lo usan `render.js` y el script, así no se duplica.
- Las plantillas no llevan datos de usuarios, claves ni direcciones internas; lo único externo es la hoja de la fuente Montserrat (Google Fonts). Abiertas directamente en el navegador desde la plataforma, su política de seguridad bloquea esa fuente; no afecta al recurso final.

## «Creemos los guiones» (dentro de cada unidad)

En la unidad hay un bloque **Creemos los guiones**: envía el enlace del documento de la unidad al segundo flujo de n8n
(`unidad-a-guiones`, dato `unidad_url`), muestra un guion por tema, se revisan y aprueban uno por uno y, con todos
aprobados, el botón **Crear los recursos** los genera en su tema y baja a la vista de recursos.

- Dirección del webhook: Dashboard → «Conexión con n8n» (por defecto `https://n8n.americana.edu.co/webhook/unidad-a-guiones`).
- Para que la plataforma pueda construir los recursos, el último nodo del flujo debe responder también con el
  **contenido** de cada guion, no solo el enlace. Use `n8n/preparar-respuesta-con-enlaces2-guiones.js`
  (nodo Code, modo «Run Once for All Items», entre «Subir DOCX a Google Drive2» y «Responder JSON4»).
- Respuesta esperada: `{ ok, total, archivos: [{ id, nombre, url, unidad, tema, nombre_tema, info, guion, advertencias }] }`.
- «Cargar un guion (Word) a mano» sigue disponible como alternativa.

## Diseño «Tecnología» y tipos nuevos (plataforma)

- Estilo de los recursos de la plataforma: `src/plataforma/tec.css` (se aplica después de `base.css`). Encabezado degradado, tarjetas blancas, botones azul marino y acento lima, letra Montserrat.
- La paleta cambia según el **grado**: Tecnología, Licenciatura, Especialización y Doctorado (`PRESETS` en `plataforma-react/src/lib/render.js`). Al crear los recursos desde un guion se elige sola según el programa y el nivel de formación del guion; en el editor, «Colores y letra» permite cambiarla.
- Tipos nuevos: **Acordeón** (`plantillas/acordeon.html`), **Infografía** (`infografia.html`) y **Portada** (`portada.html`). El tipo se reconoce por el nombre del formato en el guion («Acordeón», «Infografía», «Portada»/«Galería»).
- Pendiente: el **Crucigrama** (necesita palabras y pistas en el guion) y el grado Maestría (falta ver su paleta).
- Los recursos creados antes de este cambio conservan sus colores anteriores; para pasarlos a un grado, elija uno en «Colores y letra».

### Rediseño según el tablero de Figma (segunda versión)

Las plantillas siguen el tablero «DIEPO»: hoja blanca centrada con encabezado degradado, textos compactos y tarjetas con borde fino. Recursos reproducidos: **Portada**, **Acordeón**, **Infografía estática (RED)**, **Crucigrama** y **Lectura diagramada** (páginas con diagrama de términos). Las demás plantillas (diagrama, presentación, video, podcast) solo heredan el estilo.

- **Crucigrama:** el guion debe traer un renglón por palabra: `PALABRA: pista` (el rótulo es la palabra y el texto es la pista). La cuadrícula se arma sola cruzando las palabras.
- **Lectura diagramada:** las secciones se reparten de 2 en 2 por página. Los renglones `Término X: definición` (o `Glosario X: …`) forman el diagrama de la derecha y cada uno abre su definición. Un renglón `Resumen: …` va en la columna derecha del encabezado.
- **Infografía:** los cuatro bloques llevan los títulos de la plantilla (Activa tus conocimientos, Reconoce el aprendizaje, Sigue la ruta del subtema, Integra y aplica) si el rótulo del guion es genérico (Bloque 1…).

### Lectura diagramada (3 páginas, según el tablero)

Las secciones se reparten en páginas de a 2. La **página 1** lleva el título con resumen, la banda y el diagrama de conceptos (`Término X: definición`, hasta 4 nodos). La **página 2** lleva el flujo de pasos (`Paso N: Nombre — descripción corta`), la tarjeta de caso (sección titulada «Caso …») y la tabla de registro (`Registro: observa | registra; observa | registra`). La **última página** lleva la conclusión (`Conclusión`/`Síntesis`) y las referencias (`Referencias`), y retoma el mapa de conceptos. Ejemplos con texto de prueba: `ejemplos/lectura-*.html` (regenerar con `node build-ejemplos.js`).

### Infografías (cuatro versiones, un solo recurso)

En el editor, «Versión de la infografía» cambia el diseño sin perder el contenido: **Vertical con fotos (RED)**, **Hexágonos alrededor de un círculo** (6 ítems), **Círculo radial con panel de lectura** (hasta 7 puntos) y **Puntos sobre una ilustración** (suba la ilustración y escriba la posición x/y de cada punto, de 0 a 100). La versión la indica el guion (en el nombre del formato o en un renglón «Versión: hexagonal / radial / puntos / vertical»); si no la indica, se muestra la vertical y se avisa. Ejemplos: `ejemplos/infografia-hex-*.html`, `infografia-radial-*.html` y `infografia-pines-*.html` (`node build-ejemplos.js`).

### OVA = recurso + actividad (paso final aparte)

Cualquier recurso (acordeón, lectura, infografía…) puede llevar una actividad. Al terminar el recurso se desbloquea una tarjeta «Ir a la actividad →» y la actividad se abre en una vista propia a hoja completa, con botón «Volver al recurso».

- **Emparejamiento** (hecho): en el guion, `Actividad: <enunciado>. Pares: Concepto = Aplicación; Concepto = Aplicación; …`. También se reconoce `Tipo: Emparejamiento` y `Nombre: …`. La columna B sale mezclada; «Comprobar respuestas» se habilita al formar todos los pares y marca aciertos y errores. En el editor: «Tipo de actividad» y la lista «Pares para emparejar».
- Pendientes con el mismo mecanismo: **Clasificación**, **Tarea evaluativa** (3 páginas) y **Laboratorio virtual** (4 pasos).
- Ejemplos: `ejemplos/acordeon-emparejamiento-*.html`.

- **Clasificación** (hecho): en el guion, `Actividad: <enunciado>. Criterio de clasificación: <texto>. Categorías: Cat A = elemento, elemento; Cat B = elemento, elemento.` Los elementos salen mezclados en el «Banco de elementos» y se asignan a las zonas tocando o arrastrando (se pueden reubicar). «Comprobar respuestas» se habilita al clasificar todos. En el editor: tipo «Clasificación», criterio y lista de categorías (elementos uno por renglón). Ejemplos: `ejemplos/acordeon-clasificacion-*.html`.

### Línea de tiempo

Recurso nuevo (`plantillas/lineatiempo.html`): línea ondulada con momentos alternados arriba y abajo, tarjeta de detalle con imagen, «¿Qué cambió?» y «Compara y analiza» (se habilita al revisar todos los momentos). En el guion, el formato «Línea de tiempo» usa un renglón por momento: `Fecha o hito: descripción`; opcionales `Introducción: …` y `Compara y analiza: …`. Ejemplos: `ejemplos/linea-tiempo-*.html` y `ejemplos/crucigrama-*.html`. La instrucción del encabezado es lima en Tecnología, Licenciatura y Especialización, y blanca en Doctorado.

### Diagrama de flujo, mapa conceptual y cuestionario

- **Diagrama de flujo** (`flujo.html`, rediseñado): pasos en filas con conectores y flechas; óvalo = inicio/fin, rectángulo = proceso, rombo = decisión (un paso cuyo nombre termina en «?» se dibuja como decisión). Al pulsar un paso se muestra su explicación abajo. Guion: `Nodo N: nombre: descripción` + `Conexión N: …`, y opcionales `Propósito: …` y `Explicación: …`. Versión simplificada: flujo lineal que se parte en filas (sin ramas paralelas).
- **Mapa conceptual** (`mapa.html`, nuevo): concepto central, ramas y subconceptos con etiqueta de relación sobre la línea; panel del concepto elegido, «Relación con el tema», «Reflexione y aplique» (se habilita al ver todos) y «Ejemplo aplicado». Guion: `Concepto central: Título | explicación`; `Nodo N: Título | relación | explicación`; `Hijo: Título | relación | explicación` (cuelga del último nodo); opcionales `Relación con el tema`, `Reflexione y aplique`, `Ejemplo aplicado`.
- **Cuestionario con retroalimentación** (actividad, vista aparte): una pregunta por pantalla (única, múltiple, verdadero/falso), «Comprobar respuesta» con explicación, avance «1/5» y resultado final. Guion: `Tipo: Cuestionario. Preguntas: tipo | enunciado | opción; opción*; opción | retroalimentación ;; tipo | …` (el * marca la correcta; `;;` separa preguntas). Ejemplos: `ejemplos/diagrama-flujo-*.html`, `mapa-conceptual-*.html`, `acordeon-cuestionario-*.html`.
- Pendientes de este lote: **Estudio de casos** (3 páginas), **Presentación multimedia** (varias diapositivas con diseños distintos), **Tarea evaluativa** y **Laboratorio virtual**.

### Estudio de casos (3 etapas)

`casos.html`: **1 Lee el contexto** (imagen, título del reto, contexto y «Objetivo del reto»), **2 Explora las evidencias** (imagen con puntos, panel de la evidencia con «Dato importante», «Preguntas orientadoras» y «Pasos a seguir»; «Siguiente» se habilita al ver todas) y **3 Construye tu análisis** (apartados con espacio para escribir, «Defienda y aplique», estructura de la respuesta y criterios; lo escrito se guarda en el navegador). Guion: `Contexto: …`, `Título del reto: …`, `Objetivo del reto: …`, `Evidencia N: Título | explicación | dato importante`, `Preguntas orientadoras: p1; p2`, `Pasos a seguir: a; b`, `Apartado N: Título | guía | idea clave`, `Defienda y aplique: …`, `Estructura: …`, `Criterios: c1; c2`. Ejemplos: `ejemplos/estudio-casos-*.html`.

### Presentación multimedia (8 diseños de diapositiva)

`presentacion.html`: cada diapositiva tiene su propio encabezado y un diseño a elegir en el editor: **texto y tarjetas**, **círculo radial con panel**, **imagen con puntos**, **tarjetas numeradas**, **acordeón** (con «Mini clave»), **galería con flechas**, **pregunta de comprobación** y **síntesis con reflexión**. Con `Siguiente` bloqueado hasta completar la interacción de cada diapositiva. Guion: `Diapositiva N: Título: texto`; para un diseño especial, `Diapositiva N: [radial] Título: texto || Elemento | explicación | ejemplo ;; Elemento | …` (diseños: texto, radial, puntos, tarjetas, acordeon, galeria, pregunta, sintesis; en «pregunta» las opciones llevan * en la correcta). Ejemplos: `ejemplos/presentacion-*.html`.

### Tarea evaluativa (actividad de 3 páginas, vista aparte)

Reutiliza los campos de la actividad: **1 Analiza el caso** (objetivo del reto, descripción = enunciado, materiales y producto esperado = evidencia), **2 Organiza y redacta tu respuesta** (pasos «Título | descripción» a la izquierda y el borrador a la derecha con una caja por pregunta guía; «Siguiente» se habilita con 20 palabras) y **3 Revisa la entrega** (estructura y formato, criterios «Nombre | descripción» y «Descargar mi respuesta (.txt)»). Guion: `Actividad: <descripción>. Tipo: Tarea. Objetivo: …. Pasos: 1) Título | descripción 2) …. Preguntas guía: p1; p2. Estructura: …. Antes de continuar: …. Evidencia: …. Criterios: Nombre | descripción, Nombre | descripción.` Ejemplos: `ejemplos/acordeon-tarea-*.html`. Pendiente: **Laboratorio virtual** (4 pasos).

### Laboratorio virtual (actividad de 4 pasos, vista aparte)

**1 Diagnóstico de la situación** (situación de práctica con imagen + pregunta con opciones y «Comprobar diagnóstico»), **2 Comparación de resultados** (elegir cada configuración y ver sus indicadores en barras; «Comparar configuraciones» se habilita al verlas todas), **3 Validación de la intervención** (flujo Preparar → Aplicar → Verificar y «Comprobar intervención») y **4 Reporte final** (tabla de registro con lo elegido, reporte escrito y «Descargar mi reporte (.txt)»). Guion: `Actividad: <enunciado>. Tipo: Laboratorio. Situación: …. Diagnóstico: pregunta | opción*; opción | retroalimentación. Configuraciones: A = Indicador: 25, Indicador: 30 ;; B = Indicador: 80, Indicador: 75. Criterio de comparación: …. Intervención: pregunta | opción*; opción | retroalimentación. Reporte: indicación.` Ejemplos: `ejemplos/acordeon-laboratorio-*.html`.

**Con esto quedan hechos todos los recursos y actividades de los ejemplos de Figma.** Lo que falta para que salgan solos desde n8n es pedir en el prompt del guion los formatos de cada tipo (ver cada sección de este archivo).

### Regla general: el guion decide

La plataforma **no elige** qué recurso ni qué actividad usar: todo viene en el guion. El tipo del recurso sale del nombre del formato (Acordeón, Infografía, Línea de tiempo, Mapa conceptual, Estudio de casos, Presentación…), la versión de la infografía del nombre o de un renglón «Versión:», el diseño de cada diapositiva del marcador `[diseño]`, y la actividad de su renglón `Tipo:` o de los datos que trae (pares, categorías, preguntas, configuraciones…). Si el guion no dice algo, la plataforma usa la opción neutra (vertical, texto, actividad general) y lo muestra en las «Notas del guion» del recurso.

### Guion en formato de tablas («Recurso educativo N»)

Además del formato con códigos en párrafos (`U2-T1-OVA1 …`), la plataforma lee guiones donde cada recurso viene en tablas: `Recurso de presentación` / `Recurso educativo N` con la tabla **Dato | Detalle** (Código, Formato, Título, Subtemas), la tabla **Guion estructurado** (Escena / Sección | Contenido; para el diagrama de flujo «Nodo N: Nombre» y «Relaciones entre nodos»), la tabla **Actividad de autoaprendizaje** (Consigna, Materiales, Pasos, Evidencia, Criterios) y **Cómo se visualiza el recurso** (duración y accesibilidad). El tipo sale del *Formato*; es OVA si trae actividad y OVI si no. Para ver los HTML de un guion fuera de la plataforma: `node build-guion.js "ruta\Guion.docx"` (crea `ejemplos/guion-<nombre>/`). Si el guion pide una actividad especial (cuestionario, clasificación…) pero no trae sus datos, se muestra como actividad general y se avisa en las notas del recurso.

Formato completo que debe tener el guion para cada recurso y cada actividad: ver **FORMATO-GUION.md**.
