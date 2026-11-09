# Flujo «syllabus → unidades» con la bibliografía que envía la plataforma

**No modifica n8n.** Es una copia: se genera un archivo nuevo que usted importa como flujo aparte.

## Qué cambia respecto al flujo original
| Antes | Ahora |
| --- | --- |
| La bibliografía se leía del Word y el modelo la vinculaba «por título y tema» sin haberla leído. | La plataforma lee cada fuente completa y envía su **texto por página** y su **cita APA 7**. |
| El modelo podía apoyarse en lo que «sabe». | Solo puede apoyarse en los **extractos** de cada subtema (fuente + página) y debe citar `{id, pagina}`. |
| Las referencias de la unidad salían del Word. | Salen de lo enviado: `<<Bibliografia_Basica>>` y `<<Bibliografia_Complementaria>>` (APA 7, orden alfabético). |
| Cualquier ID citado valía. | Una cita se descarta si el ID no existe o la página no estaba entre los extractos enviados. |
| Si faltaba bibliografía, el modelo seguía. | El flujo **se detiene** si no llega `body.bibliografia`. |

## Pasos
1. En n8n, abra el flujo «syllabus-a-plantilla» → ⋯ → **Download** y guarde el JSON, por ejemplo en `n8n/syllabus-a-plantilla.json`.
2. Genere la copia:
   ```bash
   node n8n/bibliografia/aplicar-parche.mjs n8n/syllabus-a-plantilla.json
   ```
   Cada modificación aparece con ✔ o ✖. Si hay ✖ no se aplicó esa parte: dígame cuál.
3. En n8n: **Import from file** con `n8n/syllabus-a-plantilla-con-bibliografia.json`. El webhook nuevo es
   `https://n8n.americana.edu.co/webhook/syllabus-a-plantilla-bibliografia`.
4. Pruebe y, cuando esté conforme, active la copia. El flujo original queda intacto.

## Lo que envía la plataforma
`GET /api/bibliografia/trabajos/:id/paquete` (solo cuando **todas** las fuentes están leídas). La petición a n8n lleva, además del
syllabus y la carpeta, `bibliografia: { fuentes: [...] }`. Cada fuente: `id` (`U1-B1` = unidad 1, básica, primera), `unidad`,
`categoria`, `referencia_apa`, `cita_apa`, `titulo`, `autores`, `anio`, `doi`, `url` y `paginas: [{ numero, texto }]`.

> El envío desde la pantalla sigue **apagado** (se detiene al completar la bibliografía). Para activarlo hay que apuntar
> `WEBHOOK_POR_DEFECTO` (`plataforma-react/src/lib/syllabus.js`) al webhook nuevo y llamar `generar()` en `PortalSyllabus.jsx`.

## Límites
- Se verificó contra un flujo de prueba con los mismos puntos de anclaje; **no se ha ejecutado contra su n8n real**.
- Por fuente se envían hasta 150 páginas de 2 500 caracteres. Una fuente más larga se recorta (las primeras páginas).
- La selección de extractos es por coincidencia de palabras con el tema y el subtema; no «entiende» el contenido.
