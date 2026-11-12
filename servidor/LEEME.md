# Servidor y base de datos de la plataforma

Node (Express) + PostgreSQL. La plataforma React habla con este servidor; ya no guarda nada en el navegador.

## Qué resuelve

| Necesidad | Cómo se resuelve |
|---|---|
| Usuarios, roles y permisos | Tablas `usuarios`, `roles`, `permisos`, `rol_permisos`. Roles: **admin**, **coordinador**, **docente**. Una persona puede tener **varios roles** (tabla `usuario_roles`) y sus permisos se suman. |
| Cada persona ve solo lo que crea | Cada syllabus y cada enlace tiene `propietario_id`. La clave es `(propietario, id)`: nadie puede pisar el de otra persona. Además, la base aplica **seguridad por fila (RLS)**: aunque una consulta olvidara el filtro, PostgreSQL no entrega ni deja escribir filas ajenas. |
| Guardar todas las URL generadas | Tabla `enlaces`: syllabus, carpeta, documento por unidad y guiones, con su propietario. Solo se aceptan `https://`. |
| Consultas seguras | Ver «Cómo evitamos la inyección SQL». |

### Permisos por rol (por defecto)

| Permiso | admin | coordinador | docente |
|---|:-:|:-:|:-:|
| proyectos.crear / ver_propios / editar / eliminar | | ✔ | ✔ |
| usuarios.gestionar (crear, cambiar rol, activar, clave) | ✔ | | |
| auditoria.ver | ✔ | | |
| proyectos.ver_todos | no se asigna a nadie | | |

El administrador gestiona cuentas pero **no ve el contenido de los demás**. Si algún día se quiere que lo vea:
`INSERT INTO rol_permisos VALUES (1, 5);` (rol admin, permiso `proyectos.ver_todos`).

## Cómo evitamos la inyección SQL

1. **Ninguna consulta se arma con texto del usuario.** Todas están escritas a mano en `src/consultas.js`, como constantes. Los datos viajan aparte (`$1`, `$2`…).
2. **No hay consultas genéricas.** No existe nada como `seleccionar(tabla, campo, valor)`: cada operación (login, listar mis syllabus, borrar el mío…) tiene su propia consulta con sus columnas y condiciones fijas. Nombres de tablas y columnas nunca vienen de fuera.
3. **Validación antes de la base de datos** (`zod`): correo, identificadores (`^[A-Za-z0-9_-]{1,64}$`), roles (lista cerrada), tamaños. Lo que no cumple se rechaza con 400.
4. **Restricciones en la propia base** (`CHECK`): formato de id, correo, `https://` en los enlaces, largos máximos.
5. **Usuario de la aplicación sin privilegios de dueño** (`ova_app`): sin `DROP`, sin crear tablas, sin saltarse RLS; solo puede modificar las columnas que necesita.
6. Una prueba automática verifica que `consultas.js` no use `${}` y que las rutas no escriban SQL.

Otras protecciones: claves con bcrypt (costo 12), sesión en cookie `httpOnly` + `SameSite=Strict`, cabecera `x-ova` obligatoria en escrituras (anti-CSRF), bloqueo tras 5 fallos (15 min), límite de intentos por IP, mismo mensaje de error exista o no el correo, sesión revocable al instante (desactivar usuario / cambiar rol / salir), cabeceras de `helmet`, errores internos sin detalle, registro de actividad en `auditoria`.

## Puesta en marcha

1. **Crear la base y los dos usuarios de PostgreSQL** (como administrador de PostgreSQL):
   ```sql
   CREATE DATABASE ova;
   CREATE ROLE ova_app LOGIN PASSWORD 'ELIGE_UNA_CLAVE_LARGA' NOSUPERUSER NOBYPASSRLS;
   ```
   (El dueño de la base puede ser `postgres` u otro usuario propio.)
2. `cd servidor && npm install`
3. Copiar `.env.ejemplo` a `.env` y completar `DATABASE_URL`, `DATABASE_URL_DUENO` y `JWT_SECRET`.
4. Crear las tablas: `npm run db:migrar`
5. Crear el primer administrador (la clave no se guarda en ningún archivo):
   ```bash
   ADMIN_CORREO=persona@dominio ADMIN_NOMBRE="Nombre" ADMIN_CLAVE='UnaClaveSegura123' npm run usuario:crear-admin
   ```
6. Compilar la plataforma (`cd ../plataforma-react && npm run build`) y arrancar: `cd ../servidor && npm start`.
   Se abre en `http://localhost:3001`. El servidor entrega la plataforma y la API desde el mismo origen.

En **desarrollo**: `npm run dev` en `servidor/` y `npm run dev` en `plataforma-react/` (Vite reenvía `/api` al servidor).

En **producción**: usar HTTPS y poner `COOKIE_SEGURA=true`.

## Probar sin instalar PostgreSQL

- `npm test`: levanta un PostgreSQL temporal y ejecuta 10 pruebas (permisos, propiedad de los datos, RLS, intentos de inyección, bloqueo de cuenta…).
- `npm run demo`: deja corriendo servidor y base temporales con tres usuarios de prueba (`admin@demo.co`, `ana@demo.co`, `beto@demo.co`, clave `ClaveDemo2026`). No es para producción; todo se borra al cerrar.

## Datos que ya existían en el navegador

Al iniciar sesión, si en ese navegador había syllabus guardados antes (IndexedDB), aparece un aviso para **importarlos a tu cuenta**.

## Archivos

- `sql/001_esquema.sql`: tablas, roles, permisos, RLS y privilegios.
- `src/consultas.js`: todas las consultas SQL, fijas y parametrizadas.
- `src/rutas.js`: endpoints, validación y permisos.
- `src/seguridad.js`: claves, sesión, permisos, anti-CSRF.
- `src/enlaces.js`: extrae los enlaces de un syllabus.
- `test/seguridad.test.js`: pruebas contra PostgreSQL real.

## Bibliografía (src/bibliografia)

Lee la bibliografía de un syllabus: busca cada fuente (DOI, página web o PDF), descarga el archivo, guarda **todo el texto página por página** y arma la cita y la referencia en **APA 7**. Sin IA: solo lectura de archivos, metadatos y reglas.

**Base de datos** (`sql/002_bibliografia.sql`): `bib_trabajos` (una corrida por syllabus) → `bib_fuentes` (una por referencia, con metadatos y cita APA) → `bib_autores` · `bib_documentos` (PDF/HTML/DOCX con huella sha256) → `bib_paginas` (texto por página, con búsqueda de texto completo). Cada fila tiene `propietario_id` y la misma política de filas que `proyectos`.

**Orden en que se resuelve cada fuente** (`orquestador.js`): texto del syllabus → Crossref (si hay DOI) → página o archivo → PDF que enlaza la página → texto a la base → cita. Los metadatos se funden por prioridad: Crossref > página web > metadatos del PDF > lo escrito en el syllabus.

**Seguridad:** las direcciones que escribe una persona pasan por `red.js`: solo http/https, puertos 80/443, nunca direcciones privadas o locales, cada redirección se revalida, tope de 40 MB y de tiempo.

**API** (`/api/bibliografia`, requiere sesión y permiso `proyectos.crear`):

| Método y ruta | Qué hace |
| --- | --- |
| `POST /trabajos` | Crea un trabajo con `{texto}`, `{entradas:[...]}` o `{syllabusUrl}` (Google Doc). Responde 202 y sigue en segundo plano. |
| `GET /trabajos/:id` | Avance, fuentes, autores y documentos. |
| `GET /trabajos/:id/referencias` | Bibliografía APA 7 ordenada, con la cita en el texto de cada fuente. |
| `GET /trabajos/:id/buscar?q=` | Búsqueda en todo el texto leído; cada resultado trae su cita con la página. |
| `GET /documentos/:id/paginas?desde=&hasta=` | Texto completo por páginas. |
| `GET /fuentes/:id/cita?pagina=12` | Cita en el texto con página, por ejemplo `(Pérez y Gómez, 2020, p. 12)`. |

**Aplicar la migración** (es idempotente): `DATABASE_URL_DUENO=postgres://postgres:CLAVE@localhost:5432/ova npm run db:migrar`. Pruebas: `npm test`.

**Límites conocidos:** los PDF escaneados (imágenes) se registran sin texto: no hay OCR. Páginas que exigen sesión o captcha quedan como `sin_acceso`. Las páginas web se numeran por bloques de ~3000 caracteres («bloque N»).

## Sesión y generación de guiones con n8n

**Sesión.** Se renueva sola mientras se usa la plataforma: vence tras `SESION_DIAS_INACTIVIDAD` días sin actividad (7 por defecto) y, en todo caso, a los `SESION_DIAS_MAXIMO` días de haber iniciado (30). Una sesión también termina al cerrar sesión, desactivar a la persona, cambiarle la clave o los roles. `HORAS_SESION` (de versiones anteriores) ya no se usa: si está en el `.env`, se puede borrar.

**Guiones con identificador.** La llamada al flujo de n8n que escribe los guiones la hace el **servidor**, no el navegador (`src/guiones/rutas.js`, tabla `guiones_trabajos`). Cada generación es un *trabajo* con identificador:

| Ruta (`/api/guiones`) | Qué hace |
| --- | --- |
| `POST /trabajos` | Lanza la generación de una unidad. Responde 202 con el id y sigue en segundo plano. Si ya hay una en curso para esa unidad, responde 409 con `ya: true` y el id de la que corre. |
| `GET /trabajos` | Los trabajos de la persona: `en_curso`, `listo` o `error`. |
| `GET /trabajos/:id/respuesta` | La respuesta de n8n de un trabajo `listo`. |
| `DELETE /trabajos/:id` | Lo quita (la página lo hace al guardar los guiones en el syllabus). |

Así, aunque se cierre la página o venza la sesión, la generación sigue; al volver, la plataforma sabe que está en curso (o ya terminó) y no deja lanzarla otra vez. Una sola por syllabus y unidad (índice único en la base). Si n8n falla o no responde en `N8N_MINUTOS_MAXIMO` (45), el trabajo queda con error; si el servidor se reinicia, lo que estaba en curso se marca como fallido al arrancar.

**Para el flujo de n8n:** el cuerpo que recibe trae ahora además `trabajo_id` (el identificador del trabajo). No hace falta usarlo; sirve para registrarlo o relacionar la ejecución. La dirección del flujo es la que guarda el administrador en «Conexión n8n» (o `N8N_GUIONES_URL`, por defecto la de siempre).

**Aplicar el cambio de esquema** (idempotente; crea `guiones_trabajos`): `sudo -u postgres psql -d ova -f servidor/sql/001_esquema.sql`.

### Crear las unidades también corre en el servidor

«Crear las unidades» (el flujo de n8n que genera un documento por unidad a partir del syllabus) usa el mismo esquema que los guiones: es un *trabajo* con identificador (`src/unidades/rutas.js`, tabla `unidades_trabajos`) y sigue aunque se cierre la página.

| Ruta (`/api/unidades`) | Qué hace |
| --- | --- |
| `POST /trabajos` | Lanza la creación con `{syllabusUrl, carpetaUrl, bibliografiaId, curso?, proyecto?}`. Responde 202 con el id; 409 con `ya: true` si ya hay una en curso para ese syllabus. `proyecto` solo se envía al volver a generar los documentos de un syllabus que ya existe. |
| `GET /trabajos` · `GET /trabajos/:id/respuesta` · `DELETE /trabajos/:id` | Igual que en los guiones. |

Cuando el trabajo termina, la página crea el syllabus con ese resultado (o actualiza el existente), aunque la persona estuviera en otra pantalla o haya vuelto a iniciar sesión. El identificador del syllabus nuevo sale del trabajo, así que reintentar no lo duplica. A n8n le llega además `trabajo_id`. La dirección es la que guarda el administrador en «Conexión n8n» (o `N8N_UNIDADES_URL`).

**Bibliografía recuperable.** Cada lectura guarda el documento de Google del que salió (`bib_trabajos.syllabus_doc`). `GET /api/bibliografia/trabajos/por-syllabus?url=` devuelve la lectura más reciente (de los últimos 14 días) de esa persona para ese enlace: así se retoma desde otra pestaña, tras cerrar la página o desde otro equipo (antes dependía de `sessionStorage`, que es por pestaña).

### Versión del syllabus (el último en guardar ya no pisa)

Cada syllabus guarda un número de versión (`proyectos.version`) que sube con cada guardado. `GET /api/proyectos` lo devuelve como `_v`; quien guarda (`PUT /api/proyectos/:id`) envía el `_v` que tenía. Si en el servidor ya es otro (alguien lo cambió en otra pestaña o equipo), responde **409** con `conflicto: true`, la versión vigente y el syllabus actual, y no escribe nada; la página lo muestra con dos opciones («Ver la versión más reciente» o «Guardar lo mío de todos modos»). Una página antigua que no envía `_v` sigue guardando como antes. Los guardados de un mismo syllabus se atienden de uno en uno.

### Bloqueo de cuenta e intentos de acceso

- A los **10 intentos fallidos seguidos** esa cuenta (solo esa) se bloquea **5 minutos**; pasado el bloqueo cuenta de cero. Un acceso correcto reinicia el contador.
- El límite por IP (`LIMITE_LOGIN`, 300 fallos cada 15 minutos) es solo un tope de seguridad contra quien pruebe muchas cuentas desde un mismo sitio; los accesos correctos no cuentan, así que varias personas en la misma red no se bloquean entre sí.
- Los demás límites de velocidad (bibliografía, guiones, unidades) son **por persona**, no por IP.

**Aplicar el cambio de esquema** (idempotente; crea `unidades_trabajos` y añade las columnas `proyectos.version` y `bib_trabajos.syllabus_doc`): `npm run db:migrar`.

## Avisos de n8n a Praxia (pipeline guiones → matrices → H5P)

n8n **avisa** a Praxia cuando ocurren los eventos de la cadena (matrices y H5P) y Praxia los guarda ligados al curso; Praxia **no consulta** a n8n. Un solo endpoint, sin sesión de persona, protegido por firma: `src/pipeline/eventos.js`.

**Activarlo.** Poner `N8N_EVENTOS_SECRETO` en el `.env` (mínimo 32 caracteres aleatorios; el mismo valor lo guarda n8n en su credencial; **nunca** en el repositorio ni en el frontend). Sin ese valor el endpoint responde 503 y queda desactivado. Para rotarlo sin cortes: poner el valor viejo en `N8N_EVENTOS_SECRETO_ANTERIOR`, el nuevo en `N8N_EVENTOS_SECRETO`, cambiarlo en n8n y, cuando ya no llegue nada firmado con el viejo, borrar el anterior.

**Petición.** `POST /api/n8n/eventos` (en el servidor publicado: `https://proyectos.americana.edu.co/praxia/api/n8n/eventos`), cuerpo JSON: un aviso, o `{ "eventos": [ … ] }` con hasta 50. Máximo 2 MB.

| Cabecera | Valor |
| --- | --- |
| `X-Praxia-Fecha` | Hora actual en **segundos** (Unix). Se rechaza si difiere más de 5 minutos de la del servidor |
| `X-Praxia-Firma` | **HMAC-SHA256 en hexadecimal** de `fecha + "." + cuerpo`, con el secreto. `cuerpo` son **exactamente los bytes que se envían** |

Vector de referencia (secreto de ejemplo, **no** el real; se imprime con `node scripts/emitir-aviso-prueba.js --vector`): con secreto `secreto-de-prueba`, fecha `1700000000` y cuerpo `{"evento_id":"prueba-0001"}`, la firma es `d0e2186090dde1bb100aaa47b5cff7c63bec6e4a3fdf4a044b031b18cde92c99`.

**Campos comunes de todo aviso:** `evento_id` (único por aviso; **el mismo en un reintento**; 8–100 caracteres `A-Z a-z 0-9 _ . : -`), `evento`, `etapa` (`guiones`, `matrices` o `h5p`), `trabajo_id` (uuid que Praxia le mandó a n8n; `null` si la etapa la inició n8n), `origen_trabajo_id` (uuid del trabajo de guiones del que viene la cadena), `ejecucion_id` (id de la corrida en n8n; obligatorio en matrices y H5P), `proyecto_id` (curso; solo comprobación), `carpeta_raiz`, `secuencia` (entero creciente por corrida), `fecha_evento` (ISO 8601 con zona horaria). Praxia identifica a la persona y al curso **solo** con `trabajo_id` u `origen_trabajo_id`; si `proyecto_id` no coincide, el aviso se rechaza.

| `evento` | Campos propios |
| --- | --- |
| `guiones_terminados` (opcional) | `unidad`, `formacion`, `resultado` (`ok` o `error`), `detalle`, `guiones: [{tema, nombre, url}]` |
| `matrices_inicio` | `unidades: [n]`, `forzar` |
| `matrices_fin` | `resultados: [{unidad, formacion, resultado, matriz: {id, url, nombre}, anterior_id, detalle, filas: [...]}]`. `resultado` es `creada`, `omitida_ya_existe`, `reemplazada` o `error`. Cada fila: `id, id_base, variante, alcance, tema, codigo, formato, titulo, con_actividad, generador, estado, observaciones, enlace_guion, enlace_recurso`. `omitida_ya_existe` debe traer también `matriz` y `filas` |
| `h5p_inicio` | `maximo`, `plan: {a_generar: [{id, codigo}], omitidas: [{id, codigo, motivo}]}`. El motivo va en minúsculas con `_` (`sin_plantilla`, `generador_no_h5p`, `estado_no_pendiente`, `tipo_inactivo`, `supera_maximo`…) |
| `h5p_recurso` | `unidad`, `id`, `codigo`, `estado` (`PENDIENTE`, `EN_PROCESO`, `GENERADO` o `ERROR`), `enlace_recurso`, `observaciones` |
| `h5p_fin` | `resumen: {generados, errores, omitidos, pendientes_restantes}` |

Los enlaces deben ser `https://docs.google.com/…` o `https://drive.google.com/…` (las hojas de cálculo están en docs.google.com); cualquier otro se rechaza.

**Respuestas y qué hace n8n con cada una**

| Código | Significado | ¿Reintentar? |
| --- | --- | --- |
| `200` con `{ok, aplicados, duplicados, ignorados, huerfanos, rechazados}` | Procesado y guardado de forma duradera | No |
| `202` con `{huerfano: true}` | El aviso es válido pero no se pudo atribuir a ningún curso (se guarda aparte) | No |
| `400` | Contrato mal armado (`problemas` dice qué campo); no se guarda nada del envío | No (corregir el aviso) |
| `401` | Firma o fecha inválida | No (revisar secreto y reloj) |
| `413`, `429`, `5xx` o sin respuesta | Demasiado grande, demasiados avisos, error o caída | `413` no; `429` y `5xx` **sí**, con espera creciente |
| `503` | Receptor sin secreto configurado | Avisar al administrador |

Praxia responde `200` solo **después** de guardar. **Idempotencia:** un `evento_id` ya recibido se responde `200` con `duplicados: 1` y no vuelve a aplicarse. **Orden:** un aviso más antiguo (por `fecha_evento` y, si empatan, `secuencia`) que lo ya guardado de esa unidad o fila no lo sobrescribe (queda registrado como `ignorado_antiguo`); una fecha más de 5 minutos adelantada se recorta a la hora del servidor.

**Qué se guarda** (tablas en `sql/001_esquema.sql`, ligadas a la persona y al curso): `pipeline_origen` (trabajo_id → persona y curso; se escribe al lanzar guiones y se conserva 180 días), `pipeline_ejecuciones` (cada corrida: plan, resumen, último aviso), `pipeline_matrices` (la matriz de cada unidad), `pipeline_recursos` (una fila por recurso), `pipeline_eventos` (registro de todo aviso y su resultado; 60 días).

**Qué ve la persona (paso «4 · Matrices y H5P» del curso).** La pantalla lee solo de Praxia con `GET /api/proyectos/:id/pipeline` (sesión y curso propios): las matrices de cada unidad, sus recursos con su estado, enlaces, errores y motivos de omisión, y las corridas de H5P con su plan y resumen. Mientras algo está en proceso se refresca sola cada 8 s (consulta a Praxia, no a n8n). Lo que lleva tiempo sin avisos se marca **«sin respuesta de n8n»** y deja de contar como en proceso: una corrida o una matriz «generando» sin avisos hace más de 15 minutos, un recurso `EN_PROCESO` sin avisos hace más de 30. Praxia no consulta a n8n para comprobarlo: es un reloj interno.

**Ver la pantalla sin n8n (demo local).** Con `npm run demo` en marcha (si el puerto está ocupado, `PG_PORT=<otro>`): `PG_PORT=<el mismo> node test/demo-pipeline-simulado.js` crea el curso «Curso de demostración del pipeline» para `ana@demo.co` y le manda avisos simulados y firmados (matriz creada, ya existente, con error, recursos generados, con error, en proceso y omitidos con su motivo). `--terminar` cierra la corrida de H5P y `--atascado` deja una matriz y una corrida sin avisos para ver «sin respuesta». Solo para el demo temporal.

**Probar** sin lanzar guiones de verdad: `node scripts/crear-origen-prueba.js <correo> <id del curso>` imprime un `trabajo_id` de prueba; luego `N8N_EVENTOS_SECRETO=… node scripts/emitir-aviso-prueba.js <url> <tipo> <trabajo_id>` envía un aviso de ejemplo firmado.

## Lectura de PDF escaneados (OCR)

Si un PDF no tiene texto seleccionable (es un escaneo), cada página sin texto se dibuja y se lee con Tesseract (español e inglés),
todo dentro de este servidor y sin servicios externos. Los idiomas vienen en las dependencias `@tesseract.js-data/*` y se copian
solos a `servidor/data/ocr` la primera vez. Variables opcionales: `OCR=0` lo apaga, `OCR_MAX_PAGINAS` (60 por defecto) limita las
páginas leídas por documento y `OCR_ESCALA` (2) la resolución. El texto leído así puede traer errores; la lectura queda con la nota
«Leído por OCR».

### Órdenes de Praxia a n8n (matrices y H5P)

Praxia entrega la orden y n8n responde enseguida; el resultado llega por los avisos firmados de arriba. Las direcciones se guardan en la pantalla «Conexión n8n» (administración; sin reiniciar). Si ahí no hay una, se usa la variable del `servidor/.env`. Sin ninguna, el botón queda desactivado:

| Variable | Webhook | Cuerpo que recibe | Respuesta esperada |
| --- | --- | --- | --- |
| `N8N_MATRICES_URL` | subflujo de matrices | `{ trabajo_id, proyecto_id, carpeta_raiz, unidades:[n], unidades_detalle:[{ numero, formacion, guiones:[{ tema, nombre, url }] }], forzar }` (Praxia no manda unidades sin guiones) | `200 {ok, ejecucion_id}` de inmediato; `400` con el motivo si falta algo; `409 {ya:true}` si ya hay una corrida en esa carpeta |
| `N8N_H5P_URL` | orquestador de H5P | `{ trabajo_id, proyecto_id, carpeta_raiz, unidades?:[n], reintentar_errores }` (Praxia ya no manda `maximo`: cuántos recursos se generan lo define n8n; si el pedido lo trae, se reenvía) | 2xx tras planificar, idealmente `{ ejecucion_id, plan }`; `409` si ya hay una corrida |

Rutas de Praxia (sesión y permiso `proyectos.crear`): `POST /api/proyectos/:id/pipeline/matrices` y `POST /api/proyectos/:id/pipeline/h5p`. Solo una generación por curso y etapa a la vez (409). Si n8n no acepta la orden, el curso no queda bloqueado. El flujo de guiones recibe además `proyecto_id` y `carpeta_raiz` (cambio 7.1a del plan).

### Vista global (coordinación)

`GET /api/pipeline/resumen` (permiso `proyectos.ver_todos`) y el menú «Pipeline H5P»: una fila por curso de todas las personas (matrices listas o con error, recursos generados, en curso, sin respuesta, última actividad), el conteo de avisos de las últimas 24 h y los avisos huérfanos o rechazados para revisión. Solo lectura.

### Tope de tamaño del paquete

Antes de enviar guiones o unidades, Praxia mide el paquete (bibliografía incluida). Si pasa de `N8N_PAQUETE_MAX_MB` (12 por defecto; n8n acepta 16 MiB), responde `413` con el tamaño y el límite en vez de enviarlo y dejar que n8n falle con un error confuso.

### Identificador de fila

El «ID del recurso» de la matriz es el del catálogo (`G-11-A`…) y se repite entre temas; lo único único por fila es su `codigo` (`U1-T2-R3 · G-11-A`). Si una unidad trae ids repetidos en `matrices_fin`, Praxia guarda cada fila con su `codigo`. En los avisos `h5p_inicio` (plan) y `h5p_recurso` envíe siempre `codigo` junto con `id`: Praxia localiza la fila por `codigo` y, si no existe, por `id`.

### Categorías de las plantillas HTML (para n8n)

Cada tipo de recurso del catálogo (`G-09 · Acordeón`…) es una **categoría** con su ID y nombre, y reúne las **variantes** (plantillas publicadas). Se administran en la pantalla «Plantillas HTML → Categorías para n8n» (ver: quien ve las plantillas; crear, renombrar, borrar y asignar: quien las revisa). Rutas: `GET/POST /api/plantillas/categorias`, `PUT/DELETE /api/plantillas/categorias/:id`, `PUT /api/plantillas/asignacion/:plantilla` (`{categoria: "G-09" | null}`).

El índice público `GET /plantillas-html/plantillas.json` (sin sesión) conserva `marcas`, `total` y `plantillas[].nombre/archivo` y añade `plantillas[].id_catalogo`, `categorias[{id, nombre, variantes[{nombre, archivo}]}]` y `sin_categoria[]`. Si la base de datos no responde, entrega el archivo del build tal cual (sin lo nuevo). La primera vez se crean las categorías G-00…G-12 y se asignan las plantillas de nombre inequívoco; lo demás queda «sin categoría». No hace falta cambiar nombres de archivo ni el historial de revisiones.
