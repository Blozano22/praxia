# Flujo de guiones con la bibliografía leída

`n8n/unidad-a-guiones-con-bibliografia.json` es una **copia nueva** del flujo «unidad-a-guiones»: no sustituye ni modifica nada en n8n.
Se importa como un flujo nuevo (Workflows → Import from file) y se activa. Su dirección es `/webhook/unidad-a-guiones-bibliografia`
(la original, `/unidad-a-guiones`, queda intacta).

## Qué cambia respecto al original
- **Entrada:** además de `unidad_url` y `syllabus_url`, recibe `unidad` y `bibliografia` (las fuentes de ESA unidad que la plataforma ya leyó:
  ID, referencia APA 7 y texto por página).
- **«Extraer unidad»:** la bibliografía de cada tema ya no se saca del Syllabus. Por cada tema se eligen los fragmentos (hasta 3 páginas por
  fuente, 900 caracteres cada una, 14 000 por tema) que más hablan del tema y de sus subtemas, y se pasan al modelo como `extractos`.
- **«Generar guion»:** la regla de fuentes ahora exige escribir SOLO con esos extractos, citar por ID y declarar en `sustento` qué página respalda
  cada recurso; si los extractos no cubren una idea, no se inventa.
- Todo lo demás (estructura RED, auditoría, ajuste de longitud, plantilla del nivel, carpeta en Drive) queda igual.
- Se dejó solo una de las dos cadenas duplicadas del original (la que arranca en «Webhook Guiones»).

## Para regenerarlo
`node n8n/guiones/aplicar-parche-guiones.mjs` (usa `unidad-a-guiones-original.json`, una copia de solo lectura del flujo original, y `bloque-bibliografia.js`).

## Lo que debe revisar al importarlo
- Las credenciales (Google Drive/Docs y OpenAI) y el subflujo «SUB: Ajuste de longitud de guiones (DIEPO)» se conservan por referencia: compruebe que
  los nodos las encuentren en su n8n.
- En la plataforma, «Conexión n8n» muestra la dirección de guiones que se usa y permite cambiarla.
