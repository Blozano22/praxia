# Asignación de variantes por curso: qué hicimos en Praxia y qué falta (para el flujo de n8n)

Documento para quien construye el flujo nuevo de n8n («preparar el curso antes de los guiones»). Praxia ya tiene hecha toda su parte; el flujo, el orquestador de H5P, el flujo de guiones y todo lo de n8n **no se tocó** y es de quien recibe este documento.

## 1. Qué cambió y cómo funciona de punta a punta

Antes de generar los guiones de un curso, se **asignan las variantes de plantilla de todos sus recursos**. Praxia **elige** las variantes (n8n no reparte) y las guarda; el flujo de n8n solo lee la estructura del curso, saca los recursos y se los pide a Praxia. Después, el orquestador de H5P **solo lee** la variante asignada.

Regla de Roger, que Praxia garantiza **en la base de datos** (no depende del flujo): dentro de un curso, ningún recurso repite variante dentro de su categoría, ni en la misma unidad ni en otras. Solo cambia la variante, nunca la categoría. La asignación se hace una sola vez y los recursos se generan con ella.

**El recorrido** (el disparador es el botón «Generar guiones» de siempre, que es por unidad):
1. La persona pulsa «Generar guiones» en una unidad. Praxia **exige que todas las unidades del curso estén aprobadas** (si no, responde 409 y no llama a n8n).
2. Si el curso aún no tiene variantes asignadas (o la unidad tiene algo pendiente o inválido), el trabajo en el servidor **llama al flujo de preparación y espera su respuesta** (sección 3.0).
3. El flujo lee las estructuras del curso, saca los recursos y se los pide a Praxia con `pedir` (3.1). Cuando termina, **responde con un 200**. No entrega las variantes en la respuesta: ya quedaron guardadas en Praxia.
4. Praxia lee de su base las variantes de **esa unidad**. Si a algún recurso no le tocó variante, el trabajo termina con un mensaje claro y **no** se generan guiones con huecos.
5. Praxia llama al **flujo de guiones de siempre** para esa unidad, con un campo nuevo `asignaciones` con las variantes de la unidad (3.4). Todo lo demás (estados, resultado, guardado en el syllabus) funciona como hoy.
6. Las demás unidades: al pulsar su botón, Praxia ya encuentra la asignación hecha y **no vuelve a llamar** al flujo de preparación.

## 2. Qué se hizo en Praxia (rama `feat/asignacion-variantes`)

| Pieza | Dónde |
| --- | --- |
| Tabla `asignacion_variantes` + índices + permisos | `servidor/sql/005_asignacion_variantes.sql` |
| Cómo deshacerlo | `servidor/sql/revertir/005_asignacion_variantes.down.sql` |
| Endpoints para n8n (firmados) | `servidor/src/pipeline/asignaciones.js` |
| Preparación dentro del trabajo de guiones (aprobación, llamada al flujo, variantes de la unidad) | `servidor/src/pipeline/preparacion.js`, `servidor/src/guiones/rutas.js` |
| Dirección del flujo de preparación (configurable) | pantalla «Conexión n8n» → «Preparar el curso», o la variable `N8N_PREPARACION_URL` |
| Consultas | `servidor/src/consultas.js` (`asign…`) |
| Mover/eliminar plantilla o eliminar categoría marcan lo asignado como inválido | `servidor/src/rutas.js` |
| Pruebas | `servidor/test/asignaciones.test.js`, `servidor/test/guiones-preparacion.test.js` (106 pruebas del servidor pasan en total) |
| Documentación | `servidor/LEEME.md` (sección «Asignación de variantes por curso») |

**No se aplicaron** las tablas `prep_*` ni `guion_recurso_plantillas` del paquete `praxia-bd-preparacion` (migraciones 003 y 004): no hacían falta para esto y su código no está en el repositorio. La migración 005 de Praxia es independiente; si más adelante esas tablas se necesitan, se aplican aparte.

### Datos que guarda cada asignación (una fila por recurso)
`codigo` (clave, único por curso y persona: `U1-T2-R3`, `U1-PRES`) · `unidad` · `id_catalogo` (`G-12-A`, se repite entre temas, **no** es clave) · `id_base` · `categoria` (`G-12`, `PRE-05`, `POS-11`) · `formacion` · `plantilla` (nombre de la variante, p. ej. `g-12-tec-v02`) · `estado` · `motivo` · `trabajo_id` (la tanda que la pidió) · `asignada_en`.

Estados: **`asignada`** (tiene plantilla) · **`pendiente`** (no se pudo: lleva `motivo`) · **`invalida`** (la plantilla dejó de existir o cambió de categoría: conserva `plantilla_anterior` y el `motivo`; Praxia **no** la reasigna sola).

## 3. Contrato para n8n

Misma protección que los avisos a `/api/n8n/eventos`: sin sesión, **mismo secreto** (`N8N_EVENTOS_SECRETO`) y firma sobre el cuerpo. **Son dos POST** (la firma cubre el cuerpo, que lleva lo que se pide). Persona y curso los resuelve Praxia con el `trabajo_id` (tabla `pipeline_origen`), nunca con ids que mande n8n.

Cabeceras: `X-Praxia-Fecha` (segundos Unix, tolerancia de 5 min) y `X-Praxia-Firma` = HMAC-SHA256 en hexadecimal de `fecha + "." + cuerpo exacto`. Se firma **el mismo texto** que se envía (serializar una vez).

```js
// Nodo Code de n8n (ejemplo)
const crypto = require('crypto');
const cuerpo = JSON.stringify({ trabajo_id, formacion: 'tecnologico', recursos });
const fecha = Math.floor(Date.now() / 1000);
const firma = crypto.createHmac('sha256', SECRETO).update(fecha + '.' + cuerpo).digest('hex');
// POST {dominio de Praxia}/api/n8n/asignaciones/pedir
// cabeceras: Content-Type: application/json, X-Praxia-Fecha: fecha, X-Praxia-Firma: firma · cuerpo: el mismo texto `cuerpo`
```

### 3.0 La orden que Praxia le manda al flujo de preparación
Praxia identifica persona y curso con un `trabajo_id` que ella misma registra (etapa `preparacion`) justo antes de llamar al flujo. **Llama por POST al webhook del flujo** (se configura en «Conexión n8n» → «Preparar el curso», o con la variable `N8N_PREPARACION_URL`; sin dirección, la preparación se omite y los guiones se generan como antes) y **espera la respuesta** (hasta 20 minutos). El flujo debe responder **200** cuando termine de asignar; cualquier otro código se muestra a la persona como error de la generación, con el `error` o `message` del cuerpo si lo trae.

Cuerpo que recibe el webhook:
```json
{ "trabajo_id": "uuid", "proyecto_id": "…", "carpeta_raiz": "https://drive.google.com/drive/folders/…", "curso": "nombre del curso",
  "formacion": "tecnologico", "syllabus_url": "https://docs.google.com/document/d/…",
  "unidades_detalle": [ { "numero": 1, "nombre": "Unidad 1", "url": "https://docs.google.com/document/d/…" } ],
  "forzar": false }
```
- `formacion`: la del curso, ya normalizada (`tecnologico`, `profesional`, `especializacion` o `doctorado`). Si el curso no la dice, Praxia no llama y avisa a la persona.
- `unidades_detalle`: los documentos de **todas** las unidades del curso (la preparación solo se pide con todas aprobadas): las estructuras que hay que leer.
- `forzar`: `true` cuando la persona pidió volver a repartir todo; el flujo debe pasarlo tal cual a `pedir` (3.1).
- Ese `trabajo_id` es el que el flujo usa en `pedir` y `consultar`. No hay bibliografía en esta orden: sigue llegando al flujo de guiones como hoy.

### 3.1 Pedir variantes
`POST /api/n8n/asignaciones/pedir`
```json
{
  "trabajo_id": "uuid del trabajo registrado en Praxia",
  "formacion": "tecnologico",
  "recursos": [
    { "codigo": "U1-T1-R1", "categoria": "G-09", "unidad": 1, "id_catalogo": "G-09-A", "id_base": "G-09" },
    { "codigo": "U1-PRES",  "categoria": "G-08" }
  ],
  "forzar": false,
  "solo_aprobadas": true
}
```
- `formacion`: `tecnologico` | `profesional` | `especializacion` | `doctorado` (la del curso).
- `categoria`: el código **general** (`G-09`, `PRE-05`, `POS-11`), sin sufijos `-C/-A`.
- `recursos`: de 1 a 500; los `codigo` no pueden repetirse dentro del pedido. Se puede pedir el curso entero o una unidad; las peticiones de un mismo curso se atienden **de una en una** (bloqueo por curso), así que unidades en paralelo no se pisan.
- `forzar` (opcional): recalcula desde cero lo pedido. Sin él, lo ya asignado **no cambia** (idempotente).
- `solo_aprobadas` (opcional, por defecto `true`): solo mientras aún no haya variantes aprobadas se puede poner `false`.

Respuesta 200:
```json
{ "ok": true, "proyecto_id": "…",
  "resultados": [
    { "codigo": "U1-T1-R1", "resultado": "asignada", "categoria": "G-09", "formacion": "tecnologico", "plantilla": "g-09-tec-v01", "motivo": null },
    { "codigo": "U1-PRES", "resultado": "pendiente", "plantilla": null, "motivo": "sin_variantes_aprobadas" }
  ],
  "resumen": { "asignadas": 1, "ya_asignadas": 0, "pendientes": 1, "conflictos": 0, "errores": 0 } }
```
`resultado` por recurso:
- `asignada`: se le dio esa `plantilla`.
- `ya_asignada`: ya la tenía (se devuelve la existente, sin cambios).
- `pendiente`: no hay variante; `motivo` = `variantes_agotadas` (hay elegibles pero ya las usan otros recursos del curso), `sin_variantes_aprobadas`, `sin_variantes_de_la_formacion`, `categoria_sin_variantes` o `categoria_no_es_de_la_formacion`.
- `conflicto` (`ya_asignada_en_otra_categoria`): ese código ya tiene variante de otra categoría; no se pisa sin `forzar`.
- `error` (`categoria_inexistente`).

Una variante es **elegible** si es de esa categoría, está **aprobada** (último estado de revisión) y es de la formación del curso (las subidas antiguas sin formación valen si la categoría sirve a esa formación, y se usan al final). Se asigna la más antigua libre. **Lo `pendiente` e `invalida` se vuelve a intentar en cada petición**; lo `asignada` no.

Otros códigos HTTP: 400 cuerpo inválido · 401 firma o fecha · 404 `trabajo_desconocido` · 409 `conflicto_concurrente` (reintentar) · 429 · 503 sin secreto configurado.

### 3.2 Leer lo asignado (para el orquestador de H5P)
`POST /api/n8n/asignaciones/consultar`
```json
{ "trabajo_id": "…", "unidad": 2 }
{ "trabajo_id": "…", "codigos": ["U2-T1-R1", "U2-T1-R2"] }
{ "trabajo_id": "…" }
```
Devuelve `{ "ok": true, "asignaciones": [ { "codigo", "unidad", "id_catalogo", "id_base", "categoria", "formacion", "plantilla", "estado", "motivo", "asignada_en" } ] }` (más `plantilla_anterior` si quedó inválida). **Antes de generar un recurso**, el orquestador debe mirar `estado`: solo `asignada` trae plantilla. Con `pendiente` o `invalida` el recurso **no se genera** y se avisa a Praxia con el motivo (no inventar ni repartir variantes).

### 3.3 Qué pasa si la plantilla desaparece
Si en Praxia se **elimina** la plantilla, se **mueve** a otra categoría (cambia de nombre) o se elimina su **categoría**, todas las asignaciones que la usaban pasan a `invalida` en la misma operación, con `motivo` `plantilla_eliminada`, `plantilla_movida_a_<nuevo nombre>` o `categoria_eliminada`. Para repararlo, el flujo vuelve a llamar a `pedir` con esos códigos: se les da otra variante libre del curso.

### 3.4 Lo que recibe el flujo de guiones
El pedido de siempre al flujo de guiones lleva ahora, además, `asignaciones`: las variantes de **esa unidad** (todas con estado asignada; si alguna faltara, Praxia no llama):
```json
"asignaciones": [ { "codigo": "U1-T2-R3", "id_catalogo": "G-12-A", "id_base": "G-12", "categoria": "G-12", "formacion": "tecnologico", "plantilla": "g-12-tec-v02" } ]
```
Cuando la preparación no está configurada, el campo no existe y todo es como antes. **El flujo de guiones tiene que aceptar y usar este campo** (lo mantiene quien tenga ese flujo).

## 4. Lo que le toca al flujo nuevo (no está hecho)

1. **Leer la estructura del curso** (unidades, temas, recursos con su código de posición `U1-T2-R3` / `U1-PRES`, su categoría general y la formación del curso).
2. **Llamar a `pedir`** (3.1) con los recursos de **todas** las unidades en un solo pedido (o por unidades, da igual: Praxia serializa y no repite variantes). Los `pendiente`, `conflicto` y `error` no los resuelve el flujo: Praxia los lee después y le dice a la persona qué recurso quedó sin variante. Después, **responder 200**.
3. **Orquestador de H5P**: dejar de repartir variantes y leer la asignada con `consultar`; generar solo lo `asignada`.
4. **Catálogo de qué existe**: sigue saliendo del índice público `/plantillas-html/plantillas.json` (categorías, variantes, `estado`, `formacion`). No hace falta nada más para saber qué recursos hay disponibles.
5. **Avisos a Praxia** (matrices, H5P): seguir mandando `codigo` en cada fila.

### Dos detalles de cómo se comporta
- **Volver a repartir** (por ejemplo si cambiaron las estructuras): la generación acepta `reasignar: true`; Praxia lo manda al flujo como `forzar: true`. Sin eso, se reutiliza lo ya asignado.
- **Avisos de matrices y H5P**: la clave de cada fila ya es el `codigo` cuando viene (el mismo `G-12-A` en dos unidades no se pisa). Seguir mandando `codigo` en cada fila.

## 5. Desplegar en el servidor y volver atrás

La migración **solo agrega** una tabla (y amplía una regla de `pipeline_origen` para admitir `preparacion`). **No cambia ni borra datos existentes.** Aun así, antes de tocar el servidor:

**Orden obligatorio:** primero `db:migrar`, **después** reiniciar. Si el código nuevo corre sin la tabla, eliminar o mover plantillas falla.

```bash
# 0. Copia de seguridad (se puede restaurar si algo sale mal)
sudo -u postgres pg_dump -Fc ova > ~/ova-antes-asignacion.dump

# 1. Traer el código y migrar
cd /var/www/html/praxia && git fetch && git checkout main && git pull
cd servidor && npm run db:migrar && cd ..

# 2. Construir y reiniciar (la app corre con el usuario proy3ctos)
cd plataforma-react && npm run build && cd ..
sudo -u proy3ctos pm2 restart praxia
```

**Volver atrás** (de menos a más drástico):
```bash
# a) Solo quitar la tabla nueva (no toca nada más). Antes, volver al código anterior (b).
sudo -u postgres psql -d ova < /var/www/html/praxia/servidor/sql/revertir/005_asignacion_variantes.down.sql

# b) Volver al código anterior (el commit que estaba desplegado: decff13) y reiniciar
cd /var/www/html/praxia && git checkout decff13   # queda en ese commit; para volver a lo último: git checkout main
cd plataforma-react && npm run build && cd ..
sudo -u proy3ctos pm2 restart praxia

# c) Restaurar TODA la base como estaba antes (borra lo que se haya guardado después de la copia)
sudo -u postgres pg_restore -c -d ova ~/ova-antes-asignacion.dump
```
La opción (b) es segura aunque la tabla siga creada: el código anterior ignora la tabla. La (a) borra solo `asignacion_variantes` y sus datos.
