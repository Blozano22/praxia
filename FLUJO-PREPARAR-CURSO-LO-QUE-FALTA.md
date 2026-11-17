# Flujo «DIEPO - Preparar el curso (asignar variantes)»: lo que falta

Revisión del 17-11-2026 del flujo `y5aDE8sxvXSRm7qV`, hecha desde Praxia. Este documento es para quien lleva el flujo.

## 1. Qué hace cada parte (para que no haya dudas)

| Quién | Qué hace |
|---|---|
| **Praxia** | Manda a n8n solo los enlaces de los documentos de las unidades. No sabe qué recursos trae cada una y no tiene acceso a Google. |
| **n8n (este flujo)** | Lee los documentos y arma la **lista de lo que necesita variante**: un código por recurso y su categoría. **No elige ninguna plantilla.** |
| **Praxia otra vez** | Con esa lista (`POST /api/n8n/asignaciones/pedir`) **elige la variante** de cada recurso: aprobada, de la formación del curso, sin repetir. La guarda y la devuelve. |

El pedido que sale del flujo nunca lleva nombres de plantilla: solo `codigo` y `categoria` (más `calificable` en las actividades).

## 2. Lo que ya está bien (comprobado, no tocar)

- Praxia ↔ flujo: lo que manda Praxia es lo que valida «Validar orden»; los errores salen con el campo `error` y Praxia los muestra tal cual.
- El pedido de los recursos pasa la validación de Praxia: la ejecución 385037 (26 recursos reales de la unidad 1) recibió «404 trabajo desconocido», que solo ocurre después de aceptar la firma y el cuerpo (el `trabajo_id` de la prueba era inventado).
- Los códigos `U{n}-T{t}-R{pos}` coinciden con la `posicion` del flujo de guiones: leen las tablas con las mismas reglas.
- Lotes de 500 (el máximo de Praxia), reintentos dentro de la ventana de 5 minutos de la firma, y repetir un pedido no cambia lo ya asignado.

## 3. Lo que falta, en orden

### 3.1 Actividades (lo más importante)

Hoy el flujo ignora las actividades: en `Extraer recursos` el comentario dice que no se piden hasta tener el mapeo. Ya está todo para hacerlo.

**a) Dónde está la actividad de cada fila.** En cada tabla de tema, la columna **«Actividad de autoaprendizaje»** (el código ya la localiza como `iAct`). Formato: `Nombre de la actividad: descripción…`. «No aplica» o vacío = esa fila no tiene actividad (ya está resuelto). El **nombre** es el texto antes del primer `:`.

**b) Código de la actividad: `U{u}-T{t}-A{pos}`.** `pos` es la posición de la fila en la tabla del tema, el mismo número del recurso de esa fila (que sigue siendo `U{u}-T{t}-R{pos}`). La fila 2 del tema 3 produce **dos** códigos: `U1-T3-R2` (el recurso) y `U1-T3-A2` (su actividad). No pueden compartir código.

**c) Del nombre a la categoría.** Leer la hoja **ACTIVIDADES_AUTOAPRENDIZAJE** del catálogo (la de la matriz de IDs; hay que tenerla en el mismo Google Sheet que ya lee el flujo). Columnas: `ID de la actividad`, `Ámbito`, `Nivel`, `Nombre de la actividad` y `Nombre en TEC / PRO / ESP / DOC`.
- Normalizar igual que con los recursos (`claveCat`: sin tildes, minúsculas, sin plural) y buscar el nombre en la columna **«Nombre en …» del nivel del curso** (`tecnologico`→TEC, `profesional`→PRO, `especializacion`→ESP, `doctorado`→DOC).
- La categoría es el `ID de la actividad` de esa fila: `ACT-G-02` (general; el nivel va en el campo `formacion` del pedido) o `ACT-E-05-TEC` (específica; el nivel va al final del ID).
- Si el nombre no aparece, o aparece en más de una fila: **422 con el nombre**, igual que con los recursos. No adivinar.
- Verificado con la matriz actual: dentro de cada nivel ningún nombre apunta a dos categorías, y **las 13 actividades de la unidad 1 de Tecnología encuentran su categoría**:

| Código | Nombre en el documento | Categoría |
|---|---|---|
| `U1-T1-A2` | Análisis de incidentes | `ACT-E-01-TEC` |
| `U1-T1-A4` | Análisis de una noticia | `ACT-E-12-TEC` |
| `U1-T1-A6` | Elaboración de informes | `ACT-E-10-TEC` |
| `U1-T1-A8` | Emparejar normas con situaciones | `ACT-E-03-TEC` |
| `U1-T2-A2` | Clasificación de conducta | `ACT-E-06-TEC` |
| `U1-T2-A4` | Identificación de conceptos | `ACT-E-13-TEC` |
| `U1-T2-A6` | Verdadero o falso | `ACT-E-11-TEC` |
| `U1-T3-A2` | Actuación ante escenarios críticos | `ACT-E-05-TEC` (**calificable**) |
| `U1-T3-A4` | Construcción de propuestas preventivas | `ACT-E-07-TEC` |
| `U1-T3-A6` | Toma de decisiones | `ACT-G-02` |
| `U1-T4-A2` | Simulaciones de caso | `ACT-G-04` |
| `U1-T4-A4` | Taller aplicado | `ACT-G-09` |
| `U1-T4-A6` | Portafolio de evidencias | `ACT-E-09-TEC` |

**d) Cuál es la calificable.** No se deduce por posición: lo dice la tabla **EVALUACIONES** del mismo documento.
- Buscar la fila con `Tipo de evaluación = Actividad de autoaprendizaje`.
- El **nombre** de la actividad está en la columna `Mecanismo` (`Mecanismo: <nombre>. Descripción: …`) y también en `Estrategias evaluativa` (`<nombre>. Indicadores: …`).
- El **tema** está en `Momento de aplicación` (`Después de abordar el siguiente tema: 3. …`).
- En la tabla de ese tema, la fila cuya actividad tenga ese nombre es la calificable (`calificable: true`); **todas las demás actividades van con `false`**. Solo hay una por unidad.
- Comprobación cruzada (no atajo): en la unidad 1 coincide con la **primera actividad del tema 3** (`U1-T3-A2`), que es la regla del plan. Si no coincide, avisar.
- Si la unidad no trae esa fila, o el nombre no está en el tema indicado: **parar y avisar** con el motivo (422). No marcar ninguna al azar.

**e) Cómo queda el pedido.** Se agregan las actividades a `recursos`, junto a los recursos de siempre:

```json
{ "codigo": "U1-T3-A2", "categoria": "ACT-E-05-TEC", "unidad": 1,
  "id_catalogo": "ACT-E-05-TEC", "id_base": "ACT-E-05-TEC", "calificable": true },
{ "codigo": "U1-T3-A6", "categoria": "ACT-G-02", "unidad": 1,
  "id_catalogo": "ACT-G-02", "id_base": "ACT-G-02", "calificable": false }
```
`calificable` es obligatorio en toda actividad: sin él Praxia responde `error: falta_calificable` para ese recurso. En los recursos normales no se manda.

**f) Reglas de repetición** (decididas con Roger; las aplica Praxia, el flujo solo las informa):
- **Recursos normales: nunca se repiten** dentro del curso. Si no alcanzan, queda `pendiente` (`variantes_agotadas`).
- **La calificable sí se puede repetir** en el curso sin problema: es una sola variante HTML por categoría y nivel, así que si dos unidades la piden es lo normal. Praxia la devuelve con `repetida: true`, **`aviso: null`** y `motivo: "calificable_repetida"`. No es un aviso ni un error: **el flujo no debe mostrarla como alerta**.
- **Prácticas:** al azar entre las libres; solo si ya se usaron todas las del tipo en el curso, Praxia repite la menos usada y **sí avisa** (`repetida: true`, `aviso` con texto, `motivo: "variante_repetida"`). **Cambio necesario en `Resumir respuesta`:** hoy arma `repetidas` con `resultados.filter(x => x.repetida === true)` y, si no hay texto, escribe «variante repetida». Con la calificable eso la listaría como aviso. Debe quedar así:

```js
const repetidas = resultados
  .filter(x => x.repetida === true && x.motivo !== 'calificable_repetida')
  .map(x => x.codigo + ': ' + (x.aviso || 'variante repetida'));
```

**g) Lo que Praxia necesita para aceptar los códigos `A`.** Está en `main`, **todavía no desplegado**: cambia el servidor y la base (`npm run db:migrar`). Hasta que Roger confirme el despliegue, un código `U1-T3-A2` recibe `400 Cuerpo no válido`. No activar esta parte del flujo antes.

**h) Cómo probarlo.** Con `simular: true` el flujo arma el pedido sin llamar a Praxia: revisar que salgan los 26 recursos y las 13 actividades de la unidad 1, con una sola `calificable: true` (`U1-T3-A2`). Luego una prueba real desde Praxia con un curso de prueba.

### 3.1b Modo de pruebas de plantillas (no requiere cambios en el flujo)

Mientras no estén aprobadas las plantillas, la administración puede encender en Praxia («Conexión n8n») el **modo de pruebas**: Praxia asigna cualquier plantilla subida (aprobada o no, de cualquier formación; las de la formación del curso van primero) y no se detiene si el curso no dice su formación. Lo hace Praxia dentro de `pedir`, así que **el flujo no cambia**. Solo notará que la orden que recibe trae `modo_pruebas: true` y que la respuesta de `pedir` también (puede ignorarlo). Se apaga antes de producción.

### 3.2 Recursos que no son HTML (G-05, G-06 y G-07)

En la unidad de prueba, 4 de los 26 recursos son videos y podcast. Hoy se piden a Praxia y, si esas categorías no existen allí, vuelven como `error: categoria_inexistente` (no bloquea, pero es ruido). Si algún día se crean sin variantes, quedarían `pendiente` y **bloquearían los guiones de la unidad**. Lo limpio: filtrar con la columna «Tipo de producción propuesto» de la hoja del catálogo (pedir solo las que dicen `HTML`).

### 3.3 Presentación (`U{n}-PRES`)

El flujo no la pide (`PRESENTACION.ENVIAR = false`): falta decidir su categoría. Praxia ya acepta el código `U{n}-PRES`.

### 3.4 El flujo de guiones todavía no usa las asignaciones

Praxia, después de la preparación, le entrega al flujo de guiones (v14) el campo `asignaciones` de la unidad. En ese flujo el texto `asignaciones` no aparece en ningún nodo: hoy lo ignora. Cada elemento trae `codigo`, `id_catalogo`, `id_base`, `categoria`, `formacion` y `plantilla`. Para usarlas hay que buscar por el mismo código (`U{u}-T{t}-R{pos}` para el recurso y `U{u}-T{t}-A{pos}` para su actividad).

### 3.5 Seguridad y detalles

- El **secreto de firma está escrito en el código** del nodo `Firmar pedidos` (y, según el comentario, en `Firmar aviso`). Quien abra el flujo lo ve. Pasarlo a una credencial o variable de n8n. No pegarlo en chats ni documentos.
- El webhook de entrada no tiene autenticación (igual que los otros flujos).
- Una fila con la celda RED vacía rechaza todo el curso (422); el flujo de guiones la toleraría. Decidir si se quiere tan estricto.
- En la unidad de prueba, el tema 1 trae 8 recursos y la plantilla de guiones admite máximo 6.
- En «Conexión n8n» de Praxia, la dirección de preparación debe ser `https://n8n.americana.edu.co/webhook/diepo-preparar-curso`.

## 4. Orden sugerido

1. Esperar a que Roger confirme el despliegue de Praxia (códigos `A`).
2. Agregar las actividades (3.1) y probar con `simular: true`.
3. Filtrar lo que no es HTML (3.2).
4. Prueba real con un curso de prueba y revisar `consultar` (`POST /api/n8n/asignaciones/consultar`).
5. Después, el flujo de guiones (3.4) y la presentación (3.3).

Detalle completo del pedido y la respuesta: `PLAN-asignacion-variantes.md`, sección 3.5.
