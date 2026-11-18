# Flujo «Matriz de recursos por Estructura»: que la matriz traiga la plantilla que eligió Praxia

Flujo `Xi3gga7z6l0sKLJN`. Hoy la columna **Plantilla usada** (la 18 de la hoja) queda vacía porque el flujo no recibe las variantes. Con este cambio de Praxia ya las recibe.

## Lo que ya hace Praxia (en `main`, falta desplegar)

La orden que Praxia manda al webhook `diepo-matriz-regenerar` ahora trae, **por cada unidad**, el campo `asignaciones` con lo que Praxia eligió para esa unidad:

```json
"unidades_detalle": [{
  "numero": 1, "formacion": "Tecnológico", "guiones": [ … ],
  "asignaciones": [
    { "codigo": "U1-T1-R1", "categoria": "G-11", "id_catalogo": "G-11-C", "formacion": "tecnologico", "plantilla": "g-11-tec-v03" }
  ]
}]
```
- `codigo` es el mismo `U{u}-T{t}-R{posición}` del código del recurso de la matriz (la parte antes de « · »).
- Solo vienen las asignadas. Si Praxia no tiene nada para la unidad, `asignaciones` es `[]` (no falla).
- La plantilla es el nombre del archivo en Praxia, por ejemplo `g-11-tec-v03`. Se baja de `https://proyectos.americana.edu.co/praxia/plantillas-html/g-11-tec-v03.html`.

## Cambios en el flujo (cuatro nodos)

1. **`Recibe unidad y guiones`** (el trigger): agregar el campo `asignaciones` de tipo `array`.
2. **`Una orden por unidad`**: en el objeto que devuelve, agregar `asignaciones: u.asignaciones || []`. En **`Generar matriz de la unidad`** agregar el campo `asignaciones` = `{{ $json.asignaciones }}` (tipo array).
3. **`Separar guiones`**: en `base` agregar `asignaciones: Array.isArray(e.asignaciones) ? e.asignaciones : []`.
4. **`Resolver carpeta raíz`**: después de reordenar `filas` y **antes** del bloque de «Generador», agregar:

```js
// Plantilla elegida por Praxia para cada recurso (columna 18, «Plantilla usada»).
const asig = {};
(sep0.asignaciones || []).forEach(a => { if (a && a.codigo) asig[a.codigo] = a.plantilla; });
const codigoLimpio = s => String(s || '').split(' · ')[0].trim();
filas.forEach((r, k) => {
  if (k === 0) return;                 // la fila 0 es el encabezado
  while (r.length < 17) r.push('');    // columnas 16 y 17 (enlace del recurso y última actualización) quedan vacías
  r[17] = asig[codigoLimpio(r[7])] || '';
});
```
`r[7]` es el «Código del recurso» y `r[17]` la columna «Plantilla usada». El PUT de «Escribir matriz» empieza en `A2` y acepta filas de 18 columnas, no hay que tocarlo.

Opcional: en `Preparar salida`, dentro de `fila`, agregar `plantilla: r[17] || ''`. Praxia lo ignora por ahora; sirve si luego quiere mostrarla.

## Lo que no cambia
- Los encabezados están bien. «Plantilla usada» ya existe; no hace falta otra columna. «Variante» es C/A (con o sin actividad) y no es la variante de Praxia: no se mezclan, y por eso la plantilla va en su propia columna.
- Los videos y el podcast (G-05, G-06, G-07) no tienen plantilla: su celda queda vacía y es lo correcto (su «Generador» es Videos).

## Ojo
- **Una matriz que ya existe no se reescribe.** Para ver las plantillas en una matriz ya creada hay que regenerarla con `forzar: true` (el botón de volver a generar) o borrar la hoja.
- **La matriz solo conoce las plantillas de los recursos.** Las actividades (`U#-T#-A#`) no se asignan todavía, así que no aparecen.
- Si se llega a este flujo desde el flujo de guiones (modo directo), `asignaciones` no viaja y la columna queda vacía; hoy la matriz se regenera desde Praxia, que sí las manda.
- Las plantillas del modo de pruebas pueden no estar aprobadas todavía: la matriz las muestra igual.
