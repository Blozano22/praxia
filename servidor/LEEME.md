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

**Reiniciar sin perder trabajo.** Un reinicio del servidor SÍ corta las generaciones en curso: Praxia mantiene abierta la petición a n8n esperando el resultado, y al arrancar lo que seguía «en curso» se marca como fallido. Antes de reiniciar, comprueba que no haya ninguna (despliegue seguro; si hay, el comando falla y no reinicia):

```
cd /var/www/html/praxia/servidor && npm run puede-reiniciar && sudo -u proy3ctos pm2 restart praxia
```

`npm run puede-reiniciar` imprime «Se puede reiniciar» (código 0) o la lista de proyecto, unidad y hora con «NO reinicie todavía» (código 1). La administración ve lo mismo en `GET /api/admin/trabajos-en-curso` y como aviso en «Conexión n8n». Solo cuenta generaciones de guiones (no las lecturas de bibliografía).

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
`regenerar` (opcional, array de hasta 200 códigos de posición como `["U1-T1-R2"]`): si viene, n8n solo toma esas filas (ya creadas: POR_REVISAR, GENERADO o ERROR, con plantilla) y la orden NO lleva `unidades`. Praxia las marca EN_PROCESO conservando enlace, imagen, consumo y contenido; n8n no toca «Enlace del recurso» y el aviso `h5p_recurso` POR_REVISAR nuevo reemplaza el contenido (descarta lo editado a mano). Un código que no esté en las matrices se omite con motivo `no_encontrado`.

### Vista global (coordinación)

`GET /api/pipeline/resumen` (permiso `proyectos.ver_todos`) y el menú «Pipeline H5P»: una fila por curso de todas las personas (matrices listas o con error, recursos generados, en curso, sin respuesta, última actividad), el conteo de avisos de las últimas 24 h y los avisos huérfanos o rechazados para revisión. Solo lectura.

### Tope de tamaño del paquete

Antes de enviar guiones o unidades, Praxia mide el paquete (bibliografía incluida). Si pasa de `N8N_PAQUETE_MAX_MB` (12 por defecto; n8n acepta 16 MiB), responde `413` con el tamaño y el límite en vez de enviarlo y dejar que n8n falle con un error confuso.

### Identificador de fila

El «ID del recurso» de la matriz es el del catálogo (`G-11-A`…) y se repite entre temas; lo único único por fila es su `codigo` (`U1-T2-R3 · G-11-A`). Si una unidad trae ids repetidos en `matrices_fin`, Praxia guarda cada fila con su `codigo`. En los avisos `h5p_inicio` (plan) y `h5p_recurso` envíe siempre `codigo` junto con `id`: Praxia localiza la fila por `codigo` y, si no existe, por `id`.

### Categorías de las plantillas HTML (para n8n)

Cada tipo de recurso del catálogo (`G-09 · Acordeón`…) es una **categoría** con su ID y nombre, y reúne las **variantes** (plantillas publicadas). Se administran en la pantalla «Plantillas HTML → Categorías para n8n» (ver: quien ve las plantillas; crear, renombrar, borrar y asignar: quien las revisa). Rutas: `GET/POST /api/plantillas/categorias`, `PUT/DELETE /api/plantillas/categorias/:id`, `PUT /api/plantillas/asignacion/:plantilla` (`{categoria: "G-09" | null}`).

El índice público `GET /plantillas-html/plantillas.json` (sin sesión) conserva `marcas`, `total` y `plantillas[].nombre/archivo` y añade `plantillas[].id_catalogo`, `categorias[{id, nombre, variantes[{nombre, archivo}]}]` y `sin_categoria[]`. Si la base de datos no responde, entrega el archivo del build tal cual (sin lo nuevo). La primera vez se crean las categorías G-00…G-12 y se asignan las plantillas de nombre inequívoco; lo demás queda «sin categoría». No hace falta cambiar nombres de archivo ni el historial de revisiones.

#### Subir plantillas desde la pantalla

En «Plantillas HTML → Categorías para n8n», quien revisa plantillas puede **subir** un HTML (`POST /api/plantillas/subidas {nombre, html, categoria?}`, `PUT` para reemplazar, `DELETE` para quitar; solo las subidas, nunca las del sistema). Se arma y valida con las mismas reglas que el build (estilos y código comunes incrustados, tema DIEPO, **una** marca `{{TITULO}}` y **una** `/*CONTENIDO*/`, hasta 1,5 MB), se guarda en la tabla `plantilla_subidas` y queda publicada en `/plantillas-html/<nombre>.html` y en el índice (`subida: true`), sin compilar ni desplegar. Como la sube una persona y se sirve desde el mismo dominio, se entrega **aislada** (`Content-Security-Policy: sandbox allow-scripts…`, sin `allow-same-origin`): sus scripts corren, pero no pueden usar la sesión de Praxia.

Convención de nombre: n8n deduce la variante del nombre del archivo (`lineatiempo` = 1, `lineatiempo-2` = 2…); la pantalla propone sola el siguiente nombre de la categoría. Que una variante nueva **genere** depende además de que el servicio de H5P la tenga en su librería.

#### Recurso o actividad

Cada categoría es de un **tipo**: `recurso` (acordeón, línea de tiempo…) o `actividad` de autoaprendizaje (crucigrama…). Se elige al crearla (`POST /api/plantillas/categorias {id, nombre, tipo}`; por defecto `recurso`) y se cambia con `PUT /api/plantillas/categorias/:id {nombre?, tipo?}`. El índice público trae `tipo` en cada categoría y en cada plantilla (`null` si no tiene categoría). En la galería de diseños, «Recursos / Actividades» solo filtra lo que se ve.

#### Gestionar las variantes desde Praxia (sin tocar el código)

En cada categoría, «Gestionar variantes» lista todas sus plantillas. Las que **subió una persona** se reemplazan o se eliminan (`PUT`/`DELETE /api/plantillas/subidas/:nombre`). Las **del sistema** son archivos del código y no se borran, pero se pueden **quitar de n8n** y volver a mostrar (`PUT /api/plantillas/ocultas/:nombre {oculta: true|false}`): una plantilla quitada no sale en `/plantillas-html/plantillas.json` (ni en `plantillas`, ni en `categorias`, ni en `total`) y su archivo responde 404; la pantalla la sigue viendo para poder revertirlo. Así n8n solo usa lo que está activo en Praxia. «Eliminar» una del sistema (`DELETE /api/plantillas/sistema/:nombre`) hace lo mismo y además la saca de la pantalla (marca `eliminada` en `plantilla_ocultas`; el archivo sigue en el código y «Mostrar» ya no la trae de vuelta). Requiere `npm run db:migrar` (columna nueva).

El **nombre** de una plantilla subida sale solo del ID de su categoría y del orden de subida: `g-08-v01`, `g-08-v02`… (en una categoría compartida, que sirve a 2 o más formaciones, cada formación numera las suyas: `g-09-tec-v01`, `g-09-esp-v01`… con tec/pre/esp/doc y su contador en `plantilla_categoria_contador`; `POST /api/plantillas/subidas` con `categoria`, sin `nombre`; el número viene de `plantilla_categorias.siguiente_variante` y no se reutiliza al eliminar una variante mientras queden otras de su grupo; si el grupo —la categoría, o su formación y tipo— se queda sin ninguna subida, ya sea por eliminarlas o por moverlas a otra categoría, su numeración vuelve a empezar en 1, y la revisión que tuviera una variante eliminada con ese nombre se aparta para que la nueva no la herede). Requiere `npm run db:migrar` (columna nueva).

**Roles propios:** cada persona puede editar sus propios roles (`PATCH /api/usuarios/:id/roles`); su sesión se renueva en la misma respuesta. Nadie puede quitar el rol de administrador al único administrador activo (409).

**Quién ve las plantillas HTML:** solo los roles Diseñador y Editor HTML. Ni el docente, ni el coordinador, ni el administrador las ven por sí solos (el administrador o el coordinador que además tenga uno de esos roles, sí). El índice público para n8n no depende de la sesión.

**Formaciones por categoría:** cada categoría dice para qué formaciones sirve (`tecnologico`, `profesional`, `especializacion`, `doctorado`) y con qué prioridad (P prioritaria, C complementaria), según el catálogo de formatos por nivel. Sale en `GET /api/plantillas/categorias` (`formaciones`) y en el índice público (`categorias[].formaciones`); se edita con `PUT /api/plantillas/categorias/:id/formaciones` `{formaciones: [{formacion, prioridad}]}`. Requiere `npm run db:migrar` (tabla nueva, con los valores iniciales del catálogo). Las plantillas toman los colores de la formación de `nivel` en el JSON, de `?nivel=` o de `window.__NIVEL` (la vista previa lo inyecta).

**Ficha con categoría y formación:** el comentario de la ficha puede llevar «Categoría Praxia: G-12» y «Formación: especializacion» (tecnologico | profesional | especializacion | doctorado; «licenciatura» = profesional). `POST .../previa` devuelve `ficha`, `categoriaUsada` y `avisos`; sin categoría en la petición se usa la de la ficha; la formación se guarda por variante (`plantilla_subidas.formacion`), sale en el índice (`formacion` por variante) y en `GET /api/plantillas/categorias` (`subidas[n].formacion`). Requiere `npm run db:migrar`.

**Descarga masiva de plantillas subidas:** `GET /api/plantillas/subidas/descarga-masiva.zip` (sesión + `plantillas.ver`) entrega un ZIP con solo las plantillas subidas (no las del sistema), cada una tal cual se subió (`html_crudo`), en `<Recursos|Actividades|Bibliografía>/<ID categoría> <nombre>/[<formación>/]<plantilla>.html` (la carpeta de formación solo si la categoría tiene varias) y un `indice.csv` en la raíz (UTF-8 con BOM, separador `;`: nombre, categoría, nombre_categoria, tipo, formacion, estado, calificable). Incluye variantes de cualquier estado (las archivadas salen como «archivada»). Filtros opcionales `?tipo=recurso|actividad|bibliografia` y `?categoria=ID`. Los nombres se sanean y el ZIP se arma en memoria con `src/plantillas/zip.js` (sin dependencias); si pasa de ~200 MB responde 413. En la galería de Plantillas: «Descargar todas (ZIP)» (pestaña activa) y «Descargar todo». Prueba: `test/descarga-masiva.test.js`.

**Enlace para ver una plantilla (guiones):** `GET /plantillas-html/ver/<nombre>` (con o sin `.html`) es público, sin sesión y aislado: arma al pedirlo la plantilla con su contenido de ejemplo (el original guardado) y la formación de la variante, para poder ponerlo como enlace en un guion. No cambia lo guardado ni `/plantillas-html/<nombre>.html`, que sigue siendo el esqueleto sin ejemplo que descarga n8n. Si la variante no trae ejemplo, responde 404.

**Índice solo con lo subido:** `/plantillas-html/plantillas.json` lista únicamente las plantillas subidas desde la pantalla; las del sistema (archivos del código, que usa la propia plataforma) ya no salen. `PLANTILLAS_INDICE_SOLO_SUBIDAS=0` restablece el comportamiento anterior. Si la base de datos falla se entrega el índice del build.

**Mismos campos por categoría:** todas las variantes de una categoría usan los mismos campos de contenido (los del JSON de ejemplo; `nivel`/`meta.nivel` no cuentan); la categoría define los campos y la variante solo cambia el diseño. Al subir, reemplazar o mover, se compara con la variante subida más antigua de la categoría que tenga ejemplo; **si la categoría sirve a 2 o más formaciones (compartida), con la más antigua de la categoría Y la misma formación** (cada formación tiene sus propios campos; la variante debe decir su formación: `formacion` en el cuerpo, o `Formación:` en la ficha; sin ella, `400` con `requiereFormacion`; una formación que la categoría no sirve también se rechaza; las subidas sin formación no sirven de referencia a nadie). En una categoría de una sola formación se compara con toda la categoría, como antes. Si difiere, `409` con `faltan`, `sobran` y `referencia` (y `requiereConfirmacion: 'esquema'`); nadie puede forzarla (ya no existe `esquemaDistinto`). `POST .../previa` devuelve `esquema` con la comparación antes de subir. **Índice público:** cada plantilla/variante trae `estado` (`aprobada` | `en_revision` | `rechazada`; sin historial, `en_revision`), `fecha_estado` (ISO o null) y `esquema_ok` (true/false/null si no hay con qué comparar). Requiere `npm run db:migrar` (columna `esquema`).

**Lo propio:** quien solo sube (Editor HTML) puede reemplazar (`PUT /api/plantillas/subidas/:nombre`), mover (`POST /api/plantillas/subidas/:nombre/mover {categoria}`) y eliminar (`DELETE`) únicamente las plantillas que subió él (403 con las ajenas); quien revisa, cualquiera. Mover cambia también el nombre (g-09-v03 → g-10-v01, con el contador de la categoría nueva) y traslada la categoría y el historial de revisión. `GET /api/plantillas/categorias` marca cuáles son `propia`.

**Rol «Editor HTML»** (`editor_html`, permisos `plantillas.ver` y `plantillas.subir`): ve la galería de diseños y sube variantes, pero no ve «Categorías para n8n» (permiso `plantillas.categorias`, que tienen los demás roles) ni aprueba, rechaza, manda a revisión, cambia categorías, oculta, reemplaza o elimina. **Vista previa antes de subir:** `POST /api/plantillas/subidas/previa` `{html, categoria?}` valida y arma el archivo sin guardarlo y devuelve `{conEjemplo, html, nombre}` (o 400 con el motivo). Requiere `npm run db:migrar` (rol y permisos nuevos).

Una plantilla subida puede traer su **contenido de ejemplo** entre `/*CONTENIDO*/` y `/*FIN-CONTENIDO*/` (un objeto JSON válido): al subirla, n8n recibe la plantilla con la marca sola y `GET /api/plantillas/subidas/:nombre/ejemplo` devuelve el HTML con el ejemplo puesto (lo usa «Ver»). La guía para quien genera los HTML está en `guia-html/GUIA-HTML-PRAXIA.md` (un solo archivo: reglas + límites de las cuatro formaciones, generado de los Excel «Estructura RED»).

### Actividades (categorías `ACT-G-01`, `ACT-E-03-TEC`…)
Las categorías de tipo `actividad` siguen el plan de trabajo: `ACT-G-01` (general: sirve a varias formaciones, que se marcan en la categoría y se eligen al subir) y `ACT-E-03-TEC` (específica: número y, **al final**, la formación `TEC`/`PRO`/`ESP`/`DOC`; esa formación queda marcada sola, no admite otra y no hay que elegirla al subir). El orden anterior `ACT-E-TEC-03` se sigue aceptando. **La restricción de la base cambió: hay que `npm run db:migrar` antes de reiniciar**, o crear `ACT-E-03-TEC` da error. Cada variante de actividad es **calificable (`c`) o práctica (`p`)**: se elige al subirla (`calificable: true|false` en `POST /api/plantillas/subidas`, que también acepta `PUT` y `mover`) o con la línea de la ficha `Tipo de actividad: calificable` / `práctica`; sin tipo responde 400 (`requiereTipo`). El nombre sale del plan: categoría + formación (si el código de la categoría no la lleva ya) + tipo + `v` y el número **sin ceros**, y cada formación y tipo numera las suyas por orden de subida (tabla `plantilla_actividad_contador`, no se reutiliza al eliminar): `act-g-01-tec-c-v1`, `act-g-01-tec-p-v2`, `act-e-03-tec-p-v1`. Profesional se escribe `pro` en las actividades (en los recursos es `pre`). Los campos de contenido se comparan por categoría, formación (si es compartida) **y tipo** (la calificable puede llevar campos que la práctica no). El índice público trae `calificable` por variante. Requiere `npm run db:migrar` (columna `plantilla_subidas.calificable`, tabla nueva y restricción de códigos).

**Asignación de actividades al curso:** en `POST /api/n8n/asignaciones/pedir` cada recurso de una categoría de actividad debe traer `calificable` (`true` la calificable de la unidad, `false` práctica; lo lee n8n de la tabla de la unidad, Praxia no lo adivina: sin él, `resultado: error` con `motivo: falta_calificable`). Solo se dan variantes del tipo pedido (aprobadas y de la formación del curso), **al azar** entre las libres. Si ya se usaron todas las de ese tipo en el curso, se **repite** la menos usada y se avisa (`repetida: true`, `aviso`, `motivo: variante_repetida`) en vez de dejar el recurso sin variante; la calificable también puede repetirse. Si la categoría no tiene variantes de ese tipo: `pendiente` con `categoria_sin_calificables` / `categoria_sin_practicas`. Los recursos normales siguen sin repetir (`variantes_agotadas`). `sql/005` añade `asignacion_variantes.repetida` y cambia el índice único para que solo cuente las no repetidas.

### Revisión de plantillas: el Editor HTML responde, y avisos temporales
- **Ciclo:** el diseñador aprueba, rechaza o manda a revisión; quien subió la plantilla **responde** con «Notificar cambio y pedir revisión» (estado `corregida`, `POST /api/plantillas/revisiones`) y el diseñador vuelve a revisar. Se responde a una solicitud de cambios **o a un rechazo** (en el rechazo hay que contar qué cambió). Pueden responder la administración (permiso `plantillas.corregir`, cualquier plantilla) y el **Editor HTML que subió esa plantilla** (permiso `plantillas.subir`, solo la suya); no hace falta migrar nada, la regla está en el servidor.
- **Avisos temporales (`GET /api/plantillas/avisos`, `src/avisos.js`):** cuando alguien aprueba, rechaza, pide cambios o notifica un cambio, le llega un aviso a quien le importa: a quien subió la plantilla si decide el diseñador, y al diseñador que hizo la solicitud o el rechazo si le notifican el cambio. Nadie recibe aviso de lo que hizo él mismo. **No se guardan en la base de datos ni en archivos:** viven hasta 3 minutos en la memoria del servidor y se borran cuando la pantalla los recoge (cada 8 s, solo con la pestaña a la vista). Si el servidor se reinicia, los no recogidos se pierden; si hay más de un proceso del servidor (modo cluster de PM2), cada uno tiene su propia memoria y el aviso solo llegaría si la lectura cae en el mismo proceso: en producción debe correr una sola instancia.
- **En pantalla:** una tarjeta arriba a la derecha con quién hizo qué sobre qué plantilla, botón para quitarla, barra de 10 segundos (se detiene con el cursor encima) y, al pulsarla, abre la plantilla. Al llegar un aviso, la galería recarga los estados de revisión.

### Modo de pruebas de plantillas (solo mientras no estén aprobadas)
Interruptor de la administración en «Conexión n8n» (clave `n8n.pruebas_plantillas` en `configuracion`, `PUT /api/config/n8n` con `pruebas_plantillas: true|false`; queda en el registro de auditoría). **Encendido**, la preparación del curso asigna **cualquier plantilla subida**, aprobada o no y de cualquier formación (las de la formación del curso van primero; en actividades se prefieren las de la formación si hay libres), y un curso que no dice su formación **no se detiene** (usa Tecnológico solo como referencia de orden). Praxia aplica esto por su cuenta en `pedir`: el flujo de n8n no necesita cambiar. A n8n le llega `modo_pruebas: true` en la orden y la respuesta de `pedir` lo trae. Lo demás no cambia: siguen sin repetirse las variantes de los recursos y hay que tener todas las unidades aprobadas. **Hay que apagarlo antes de producción**: encendido, un curso real puede recibir plantillas sin aprobar.

### Asignación de variantes por curso (antes de generar los guiones)
Antes de generar los guiones, n8n pide a Praxia una variante de plantilla para cada recurso del curso; **Praxia las reparte** entre las variantes **aprobadas** de la **formación** del curso y la guarda (`asignacion_variantes`, `sql/005_asignacion_variantes.sql`). Regla: **dentro de una misma unidad** ninguna variante se repite dentro de su categoría; en otra unidad del mismo curso la misma variante sí puede volver a usarse (antes la regla era por curso). La garantiza la base (índice único por curso + unidad + categoría + variante, `sql/013_asignacion_por_unidad.sql`), no el flujo; lo ya asignado sigue siendo válido. Si en una unidad hay más recursos que variantes, el sobrante queda «sin variante» (actividades: se repite una y se avisa). La clave de cada recurso es su **código de posición** (`U1-T2-R3`, `U1-PRES`), único por curso; el id de catálogo (`G-12-A`) se guarda pero se repite entre temas.
- `POST /api/n8n/asignaciones/pedir` `{trabajo_id, formacion, recursos:[{codigo, categoria, unidad?, id_catalogo?, id_base?}], forzar?, solo_aprobadas?}` → por recurso `asignada` (con su `plantilla`), `ya_asignada` (no cambia al repetir), `pendiente` (con `motivo`: `variantes_agotadas`, `sin_variantes_aprobadas`, `sin_variantes_de_la_formacion`, `categoria_sin_variantes`, `categoria_no_es_de_la_formacion`), `conflicto` o `error` (`categoria_inexistente`, o `categoria_de_bibliografia` si piden una categoría de tipo `bibliografia`: esas son plantillas por formación para mostrar referencias, no se reparten por recurso y no se guarda nada). Las peticiones de un mismo curso se serializan (bloqueo por curso), así que unidades en paralelo no repiten variante. `forzar:true` recalcula desde cero lo pedido; `solo_aprobadas:false` (solo mientras no haya aprobadas) admite las que aún no lo están.
- `POST /api/n8n/asignaciones/consultar` `{trabajo_id, unidad?, codigos?}` → lo asignado (`estado`: `asignada`, `pendiente` o `invalida`).
- Misma protección que los avisos: sin sesión, cabeceras `X-Praxia-Fecha` y `X-Praxia-Firma` (HMAC-SHA256 de `fecha + "." + cuerpo`, mismo secreto `N8N_EVENTOS_SECRETO`); persona y curso salen de `pipeline_origen` por el `trabajo_id`. Son POST para que la firma cubra lo que se pide.
- **Si la plantilla asignada se elimina, se mueve de categoría o su categoría se elimina**, la asignación queda `invalida` (con `plantilla_anterior` y el `motivo`) en la misma transacción; no se reasigna sola: al volver a pedir se le da otra variante libre.
- **Cómo empieza:** el botón «Generar guiones» (`POST /api/guiones/trabajos`) exige TODAS las unidades aprobadas (409 si no) y, si hay flujo de preparación (`Conexión n8n`, o `N8N_PREPARACION_URL`), el trabajo en el servidor lo llama primero y **espera su respuesta** (`src/pipeline/preparacion.js`): el flujo lee las estructuras y pide las variantes a `pedir`. Luego Praxia lee las variantes de esa unidad (si a algún recurso no le tocó, el trabajo falla con el motivo) y las entrega al flujo de guiones en el campo `asignaciones`. Una sola preparación por curso aunque se pidan unidades a la vez; con lo ya asignado no se vuelve a llamar (salvo `reasignar:true`). Sin dirección configurada, todo es como antes.
- **Orden de despliegue:** `npm run db:migrar` ANTES de reiniciar el servidor (eliminar y mover plantillas ya consultan esa tabla). Volver atrás: `sql/revertir/005_asignacion_variantes.down.sql` (borra solo esa tabla; ver `PLAN-asignacion-variantes.md`).

## Contenido final de cada recurso H5P

El aviso `h5p_recurso` puede traer `contenido`: el JSON final con el que el flujo pintó la plantilla (objeto, o ese objeto como texto JSON; hasta 400 KB). Praxia lo guarda en `pipeline_recursos.contenido` (migración `008_pipeline_contenido.sql`: `npm run db:migrar` antes de reiniciar) y conserva el anterior si un aviso posterior no lo trae. Es tolerante: un contenido que no es objeto, no es JSON o es demasiado grande se ignora sin rechazar el aviso. El registro de avisos no guarda el JSON, solo cuántos campos traía.
- `GET /api/proyectos/:id/pipeline/recursos/:recurso/contenido` (con sesión, solo el propio curso) → `{ id, codigo, titulo, plantilla, enlaceRecurso, contenido, actualizadoEn }`; 404 si no hay.
- `GET /api/proyectos/:id/pipeline` marca cada recurso con `conContenido` (sin cargar el JSON).
- `h5p_recurso` también acepta `revision_pendiente` (entero ≥ 0: campos que quedaron para revisión humana; `0` = ninguno; lo no válido cuenta como «sin dato»). Se guarda en `pipeline_recursos.revision_pendiente` (misma migración 008), la lista del curso lo entrega como `revisionPendiente` y la pantalla muestra «REVISAR n campos» en los recursos generados.

## Editor de textos de un recurso H5P (pantalla «Matrices y H5P»)

En cada recurso generado que tiene contenido guardado aparece «Editar textos»: abre la plantilla pintada con ese contenido en un iframe aislado (`sandbox="allow-scripts"`, sin acceso a la sesión) con el módulo de edición del servicio de H5P (`plataforma-react/src/lib/editor-campos.js`, hablan por `postMessage`). Un clic en un texto lo edita; los textos que no se asocian a un elemento van en la lista de la derecha.
- `PUT /api/proyectos/:id/pipeline/recursos/:recurso/contenido` `{ contenido }` guarda lo editado. Solo textos: el servidor rechaza (400) cualquier cambio de estructura (campos o tipos distintos a los guardados), 413 si pasa de 400 KB. Un aviso posterior `h5p_recurso` con `contenido` (regeneración) lo reemplaza. Requiere migración `009_pipeline_contenido_editado.sql`.
- `POST /api/proyectos/:id/pipeline/recursos/:recurso/h5p` arma el `.h5p` llamando al servicio de plantillas (`POST <SERVICIO_PLANTILLAS_URL>/h5p` con `X-API-Key`) y lo entrega como descarga; los íconos que el servicio no pudo resolver vienen en `X-Iconos-Sin-Resolver`. Variables de `.env`: `SERVICIO_PLANTILLAS_CLAVE` (la misma `SERVICIO_CLAVE` de n8n; sin ella responde 503) y, si cambia, `SERVICIO_PLANTILLAS_URL` (por defecto `https://proyectos.americana.edu.co/plantillas-diepo`). Subir el `.h5p` corregido a Drive/Moodle queda fuera de este paso.

### Partes del recurso: actividad y bibliografía dentro del mismo H5P (migración `017_partes_recurso.sql`)

Un recurso H5P puede llevar hasta 3 partes: el recurso (`contenido`, sin cambios), `actividad` y `bibliografia`. `h5p_recurso` acepta, todos opcionales:
- `tipo_actividad` (texto ≤ 200) y `actividad_guion` (objeto `{ tipo, nombre, instrucciones }`, ≤ 4000 caracteres).
- `actividad` `{ plantilla, contenido, imagen_url }` y `bibliografia` `{ plantilla, contenido }`: `plantilla` con la forma `^[a-z0-9-]{1,80}$`, `contenido` objeto (o texto JSON) de hasta 200000 caracteres, `imagen_url` https como la del recurso. Una parte inválida se ignora sin rechazar el aviso.
- Se guardan en `pipeline_recursos` (`tipo_actividad`, `actividad_guion`, `actividad`, `bibliografia`, `actividad_editado_en`, `bibliografia_editado_en`); un aviso posterior sin ellos no los borra, y una parte nueva descarta las ediciones a mano de esa parte. Regenerar (`regenerar` en `POST pipeline/h5p`) conserva las partes hasta que llegue el aviso nuevo.
- La lista del curso (`GET /proyectos/:id/pipeline`) devuelve `tipoActividad`, `actividadGuion`, `tieneActividad` y `tieneBibliografia`; el detalle (`GET .../recursos/:recurso/contenido`) añade `actividad` y `bibliografia` completas.
- `PUT .../recursos/:recurso/contenido` acepta `parte`: `'recurso'` (por defecto) | `'actividad'` | `'bibliografia'`. `contenido` se valida contra la estructura guardada de esa parte (solo cambian textos; 400 si no) y se marca su `*_editado_en`; 404 si el recurso es de otro propietario o no tiene esa parte.
- La orden de publicar suma `actividad` `{ plantilla, contenido, imagen_url }` y `bibliografia` `{ plantilla, contenido }` de primer nivel solo cuando la fila las tiene (con el contenido editado vigente); si no, no manda esas claves.

## Aprobar antes de publicar (H5P en dos etapas)

1. **Generar** (flujo de H5P): por cada recurso avisa `h5p_recurso` con `estado: 'POR_REVISAR'`, `contenido` y `revision_pendiente`; no arma el `.h5p` ni sube nada a Drive. `h5p_fin.resumen` puede traer `por_revisar`.
2. **Revisar** en «Matrices y H5P»: «Editar textos» abre el editor; «Aprobar y publicar» (en la fila o en el editor) llama a `POST /api/proyectos/:id/pipeline/recursos/:recurso/aprobar`. Praxia marca `aprobado_en` (mientras sea posterior al último aviso, el recurso figura «Publicando…»; sin respuesta a los 15 min) y entrega a n8n, en el webhook «Publicar un recurso H5P aprobado» (dirección en «Conexión n8n», clave `n8n.publicar`, respaldo `N8N_PUBLICAR_URL`; sin ella no aparece el botón), esta orden: `{ trabajo_id, proyecto_id, carpeta_raiz, id, codigo, unidad, plantilla, contenido, enlace_recurso, reemplazar }`. Si el recurso ya tenía archivo en Drive, `reemplazar: true` y `enlace_recurso` trae su enlace: n8n debe reemplazar el contenido de ESE archivo (sin duplicados, mismo enlace).
   - `h5p_recurso` también acepta `imagen_url` (opcional: solo https, sin espacios ni comillas, máx. 500; si no cumple se ignora y el aviso se acepta) y `consumo` (opcional, objeto: `texto` {modelo, entrada, salida, llamadas}, `imagenes` [{modelo, calidad, tamano, uso}], `costo_estimado_usd`, `costo_parcial`; máx. ~4000 caracteres). Se guardan en `pipeline_recursos.imagen_url` y `.consumo` (migración `015_imagen_consumo_recurso.sql`); un aviso posterior sin ellos no los borra. La lectura del curso los devuelve (`imagenUrl`, `consumo`). La persona puede cambiar la imagen en Praxia con `PUT /api/proyectos/:id/pipeline/recursos/imagen` `{ recursoId, imagenUrl }` (https; cadena vacía la quita; solo el dueño del curso). La orden de publicar suma `imagen_url` de primer nivel cuando la fila la tiene y es https válida (si no, no se manda el campo).
   - Tipos de categoría de plantillas: `recurso`, `actividad` y `bibliografia` (migración `014_tipo_bibliografia.sql`); `plantillas.json` expone `tipo`.
3. **Publicar** (n8n): arma el `.h5p` con el servicio, lo sube (o reemplaza) y avisa `h5p_recurso` `GENERADO` con `enlace_recurso` y `plantilla` (sin `contenido`: Praxia conserva el guardado), con el `trabajo_id` de la orden; si falla, `ERROR` con `observaciones` (el contenido se conserva y se puede reintentar). Un `POR_REVISAR` nuevo anula la aprobación anterior.

Migración `010_pipeline_aprobacion.sql` (columna `aprobado_en` y el estado `POR_REVISAR` en la restricción de `pipeline_recursos`): `npm run db:migrar` antes de reiniciar. Revisar, editar y aprobar tienen un tope propio de 90 por minuto por persona (`LIMITE_EDITAR_RECURSO`).

## Archivar plantillas subidas

Para reemplazar las plantillas sin borrarlas: `POST /api/plantillas/subidas/archivar-todas` (`{ categoria? }` limita a una categoría) y `PUT /api/plantillas/subidas/:nombre/archivo` (`{ archivada: true|false }`; restaurar). Requiere `plantillas.revisar`. Una plantilla **archivada**: queda guardada; **sigue entregándose** por su dirección (`/plantillas-html/<nombre>.html`, `/ver/…`, `.schema.json`) porque los recursos ya generados con ella la necesitan para editarse y volver a armarse; **sale** de las categorías de la pantalla (aparece en «Archivadas»), del índice `plantillas.json` para n8n, de la comparación de campos al subir otra variante y del reparto de variantes; y lo asignado con ella en los cursos pasa a `invalida` (motivo `plantilla_archivada`; se puede volver a asignar). La numeración de nombres continúa (no repite «g-09-doc-v01» mientras exista alguna subida del grupo). Columnas `archivada_en` / `archivada_por`: migración `011_plantilla_archivo.sql` (`npm run db:migrar` antes de reiniciar).

**Eliminar en bloque** (sin vuelta atrás): `POST /api/plantillas/subidas/eliminar-todas` con `{ confirmar: true, solo?: 'todas'|'archivadas', categoria? }` (solo administración, permiso `usuarios.gestionar`; quien solo revisa plantillas recibe 403; sin `confirmar: true` responde 400). Hace lo mismo que eliminar una por una: la saca de su categoría, invalida lo asignado con ella y, si un grupo de numeración se queda sin ninguna plantilla, su numeración vuelve a v01. En la pantalla: «Eliminar todas…» (pide escribir ELIMINAR) y, dentro de «Archivadas», «Eliminar las N archivadas…». Los recursos ya generados con esas plantillas ya no se podrán abrir en el editor.

## Banco de íconos

SVG reemplazables que el flujo de H5P coloca en los campos `icono` de las plantillas (contrato de entrega: `ESTRUCTURA-ICONOS-Y-VARIANTES.md`). Tabla `banco_iconos` (migración `012_banco_iconos.sql`: `npm run db:migrar` antes de reiniciar). Pantalla: «Plantillas HTML → Banco de íconos» (ver: quien ve plantillas; subir, editar y archivar: quien revisa o sube plantillas).

**Subir** (con sesión): `POST /api/iconos/paquete` con `{ version: 1, conjunto?, iconos: [ { id, svg, tipo, nombre_es, nombre_en, etiquetas_es, etiquetas_en, descripcion, prompt, estilo, tonos, categoria?, subcategoria?, conjunto? } ] }` (hasta 400 por paquete). Cada ícono se valida por separado: los buenos entran (un `id` repetido se actualiza) y los malos vuelven en `rechazados` con su motivo. `POST /api/iconos` (uno a mano), `PUT /api/iconos/:id` (datos y SVG), `PUT /api/iconos/:id/archivo` `{ archivado }`, `GET /api/iconos?tipo&estado=activos|archivados|todos&q&estilo&limite&desde`.
- `tipo` es `recurso` o `actividad`; `categoria` y `subcategoria` son texto libre informativo (no se busca por ellas). Mismo dibujo con otro `id` y el mismo `tipo` → rechazado como duplicado.
- **SVG** (normalizador `src/iconos/normalizar.js`): un solo `<svg>` con `viewBox` cuadrado, sin `width`/`height`, sin texto; solo formas y degradados (nada de script, image, use, foreignObject, style, class, on*, referencias externas). **Sin colores fijos**: `currentColor` (principal) y `var(--ico-2, currentColor)` (segundo tono); el blanco y el negro solo como capas semitransparentes (`fill-opacity`/`opacity` < 1); los degradados deben ser de `currentColor`. Los `id` internos se reescriben con el id del ícono como prefijo. Si no hay `fill` en el raíz, queda `currentColor`.

**Servicio de H5P** (cabecera `X-API-Key`; por defecto la misma `SERVICIO_PLANTILLAS_CLAVE`, o `ICONOS_CLAVE` si se quiere otra; sin clave responde 503): `GET /api/banco-iconos/lista?tipo&estilo` (activos, con `version`, cabecera `ETag` y 304 si no cambió), `GET /api/banco-iconos/buscar?q&tipo&estilo&limite` (por texto en nombres, etiquetas, descripción y prompt, sin tildes, con `puntaje`) y `GET /api/banco-iconos/:id` (también archivados, con `archivado`). Los archivados no salen en la lista ni en la búsqueda, pero se pueden pedir por id para regenerar recursos ya hechos.
