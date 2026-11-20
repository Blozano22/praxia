# Editor de textos del recurso H5P: lo que el diseño debe respetar

Archivos: `plataforma-react/src/components/EditorRecurso.jsx` (comportamiento) y `editor-recurso.css` (estilos actuales, provisionales). El botón de entrada es `.mx4-ed` en `Fila` (`MatricesH5P.jsx`). Se puede cambiar todo el aspecto; estas son las reglas de funcionamiento.

## Piezas que tienen que existir
1. **Cabecera**: código y título del recurso; interruptor «Editar con clic»; «Guardar cambios»; «Descargar .h5p»; cerrar (×).
2. **Mensaje de estado** (un solo lugar, `role="status"`), con tres tonos: `ok`, `bad`, `warn`.
3. **Vista del recurso**: el `<iframe>` con la plantilla. Es la pieza principal; debe ocupar el mayor espacio posible.
4. **Lista de textos** (panel lateral en escritorio, debajo en móvil): por defecto solo los textos que NO se editan por clic; un enlace alterna «Ver todos (n)».

## Reglas que no se pueden cambiar
- El `<iframe>` lleva **`sandbox="allow-scripts"` y nada más** (sin `allow-same-origin`): aísla los scripts de la plantilla de la sesión de Praxia. No se estiliza desde fuera ni se le agregan permisos.
- El iframe se pinta con `srcDoc`. **No se debe recargar** salvo que el contenido cambie: no poner en el iframe una `key` que cambie con el estado de la pantalla (se perdería el scroll y la edición abierta).
- Dentro del iframe el módulo de edición pinta su propio cuadro de edición y el resalte (`#praxia-editor-caja`, `#praxia-editor-resalte`); su aspecto está en `src/lib/editor-campos.js` (viene del servicio de H5P; si se le cambia el estilo, avisar a esa sesión).
- «Guardar cambios» solo se habilita si hay cambios (`sucio`). «Descargar .h5p» siempre se puede, y si hay cambios sin guardar **guarda primero**.
- Cerrar con cambios sin guardar **pide confirmación**; Escape cierra solo si no hay cambios.
- Los campos de la lista usan `defaultValue` + `key = ruta|valor` y guardan **al salir del campo** (`onBlur`), no en cada tecla: cada cambio vuelve a pintar el iframe.
- Textos largos (`largo`) van en `textarea`; los demás en `input`.
- Solo se cambian textos: no mostrar controles para iconos, encabezado, tipo ni estructura. El servidor rechaza cambios de estructura.
- El mensaje `warn` de «sin campo» aparece cuando se hace clic en un texto que no se puede asociar: debe verse sin tapar el iframe.
- La descarga muestra, si vienen, los íconos que el servicio no pudo resolver (`warn`).

## Estados a diseñar
Cargando · Error (mensaje) · Listo · Guardando · Armando el H5P (tarda unos 3 s, hasta 90 s) · Con cambios sin guardar · Guardado · Lista vacía («Todos los textos se pueden editar con un clic»).

## Responsive
En ≤ 860 px la lista pasa debajo del iframe. El iframe nunca debe quedar con altura 0.
