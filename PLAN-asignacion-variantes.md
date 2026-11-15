# Asignación de variantes por curso: qué hicimos en Praxia y qué falta (para el flujo de n8n)

Documento para quien construye el flujo nuevo («preparar curso antes de los guiones»). Praxia ya tiene la parte del servidor; el flujo, el orquestador de H5P y todo lo de n8n **no se tocó** y es de quien recibe este documento.

## 1. Qué cambió en las reglas

Antes de generar los guiones, un flujo lee la estructura completa del curso y **pide a Praxia una variante de plantilla para cada recurso**. Praxia **elige** (n8n no reparte) y guarda la asignación en su base de datos. Después, el orquestador de H5P **solo lee** la variante asignada.

Regla de Roger, que Praxia garantiza **en la base de datos** (no depende del flujo): dentro de un curso, ningún recurso repite variante dentro de su categoría, ni en la misma unidad ni en otras. Solo cambia la variante, nunca la categoría. La asignación se hace una sola vez y los recursos se generan enseguida con ella.

## 2. Qué se hizo en Praxia (rama `feat/asignacion-variantes`)

| Pieza | Dónde |
| --- | --- |
| Tabla `asignacion_variantes` + índices + permisos | `servidor/sql/005_asignacion_variantes.sql` |
| Cómo deshacerlo | `servidor/sql/revertir/005_asignacion_variantes.down.sql` |
| Endpoints para n8n (firmados) | `servidor/src/pipeline/asignaciones.js` |
| Orden «preparar el curso» (Praxia → n8n) y su dirección configurable | `servidor/src/pipeline/lanzar.js`, `servidor/src/rutas.js`, pantalla «Conexión n8n» |
| Consultas | `servidor/src/consultas.js` (`asign…`) |
| Mover/eliminar plantilla o eliminar categoría marcan lo asignado como inválido | `servidor/src/rutas.js` |
| Pruebas | `servidor/test/asignaciones.test.js` (101 pruebas del servidor pasan en total) |
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

### 3.0 Cómo empieza todo: la orden que Praxia le manda al flujo
Praxia identifica persona y curso con un `trabajo_id` que ella misma registra al lanzar. Para la preparación lo hace así: `POST /api/proyectos/:id/pipeline/preparacion` (con sesión de la persona; cuerpo opcional `{ "unidades": [1,2], "forzar": false }`). Praxia valida el curso, registra el `trabajo_id` (etapa `preparacion`) y **llama por POST al webhook del flujo de preparación** (se configura en «Conexión n8n» → «Preparar el curso», o con la variable `N8N_PREPARACION_URL`; sin dirección, queda desactivado). El flujo debe responder enseguida (como los de matrices: un `200` con `{ "ejecucion_id": "…" }` opcional) y trabajar en segundo plano; `409` si ya hay una preparación en curso de ese curso y `400` con `{ "error": "…" }` si rechaza la orden.

Cuerpo que recibe el webhook:
```json
{ "trabajo_id": "uuid", "proyecto_id": "…", "carpeta_raiz": "https://drive.google.com/drive/folders/…", "curso": "nombre del curso",
  "formacion": "tecnologico", "syllabus_url": "https://docs.google.com/document/d/…", "bibliografia_id": "uuid",
  "unidades": [1, 2], "forzar": false }
```
`formacion` es la del curso ya normalizada (`tecnologico`, `profesional`, `especializacion` o `doctorado`; si el curso no la dice, Praxia no lanza y avisa). `syllabus_url`, `bibliografia_id` y `unidades` solo van si existen. **Ese `trabajo_id` es el que el flujo usa en `pedir` y `consultar`.** (Falta, si se quiere, el botón en la pantalla del curso: hoy la orden existe como ruta del servidor.)

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

## 4. Lo que le toca al flujo nuevo (no está hecho)

1. **Leer la estructura del curso** (unidades, temas, recursos con su código de posición `U1-T2-R3` / `U1-PRES`, su categoría general y la formación del curso).
2. **Llamar a `pedir`** (el curso entero o por unidades) y guardar/usar el resultado; tratar los `pendiente`, `conflicto` y `error` (corregir y volver a pedir, o avisar a la persona).
3. **Orquestador de H5P**: dejar de repartir variantes y leer la asignada con `consultar`; generar solo lo `asignada`.
4. **Catálogo de qué existe**: sigue saliendo del índice público `/plantillas-html/plantillas.json` (categorías, variantes, `estado`, `formacion`). No hace falta nada más para saber qué recursos hay disponibles.
5. **Avisos a Praxia** (matrices, H5P): seguir mandando `codigo` en cada fila.

### Pendiente
- **Fallo conocido de `pipeline_recursos`**: su clave es (curso, id de catálogo), así que el mismo `G-12-A` en dos unidades se pisa. Conviene cambiarla a clave por `codigo`. No se tocó.

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
