// Cada operación de la aplicación tiene SU PROPIA consulta fija, escrita aquí a mano.
//  - El texto SQL es una constante: nunca se arma con datos del usuario.
//  - Los datos viajan siempre aparte, como parámetros ($1, $2…), nunca dentro del texto.
//  - No existe ninguna función genérica del tipo «seleccionar(tabla, campo, valor)».
//  - Las consultas de proyectos y enlaces filtran por propietario Y además la base de datos
//    aplica su política de seguridad por fila.

export const Q = Object.freeze({
  // ---- sesión y acceso
  usuarioParaLogin: `
    SELECT id, nombre, correo, clave_hash, activo, intentos_fallidos, bloqueado_hasta
      FROM usuarios WHERE lower(correo) = lower($1)`,
  usuarioParaSesion: `
    SELECT u.id, u.nombre, u.correo, u.activo, u.version_token,
           coalesce(array_agg(r.nombre ORDER BY r.id) FILTER (WHERE r.id IS NOT NULL), '{}') AS roles
      FROM usuarios u
      LEFT JOIN usuario_roles ur ON ur.usuario_id = u.id
      LEFT JOIN roles r ON r.id = ur.rol_id
     WHERE u.id = $1
     GROUP BY u.id`,
  permisosDelUsuario: `
    SELECT DISTINCT p.codigo
      FROM usuario_roles ur
      JOIN rol_permisos rp ON rp.rol_id = ur.rol_id
      JOIN permisos p ON p.id = rp.permiso_id
     WHERE ur.usuario_id = $1`,
  registrarFallo: `
    UPDATE usuarios
       SET intentos_fallidos = intentos_fallidos + 1,
           bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= 5 THEN now() + interval '15 minutes' ELSE bloqueado_hasta END
     WHERE id = $1`,
  registrarAcceso: `
    UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now() WHERE id = $1`,
  cerrarSesiones: `UPDATE usuarios SET version_token = version_token + 1 WHERE id = $1`,

  // ---- administración de usuarios (permiso usuarios.gestionar)
  usuariosListar: `
    SELECT u.id, u.nombre, u.correo, u.activo, u.ultimo_acceso, u.creado,
           coalesce(array_agg(r.nombre ORDER BY r.id) FILTER (WHERE r.id IS NOT NULL), '{}') AS roles
      FROM usuarios u
      LEFT JOIN usuario_roles ur ON ur.usuario_id = u.id
      LEFT JOIN roles r ON r.id = ur.rol_id
     GROUP BY u.id ORDER BY u.creado DESC LIMIT 500`,
  usuarioCrear: `
    WITH nuevo AS (
      INSERT INTO usuarios (nombre, correo, clave_hash) VALUES ($1, $2, $3)
      RETURNING id, nombre, correo, activo, creado
    ), asignados AS (
      INSERT INTO usuario_roles (usuario_id, rol_id)
      SELECT nuevo.id, r.id FROM nuevo CROSS JOIN roles r WHERE r.nombre = ANY($4::text[])
      RETURNING 1
    )
    SELECT * FROM nuevo`,
  rolesDelUsuarioBorrar: `DELETE FROM usuario_roles WHERE usuario_id = $1`,
  rolDelUsuarioAsignar: `
    INSERT INTO usuario_roles (usuario_id, rol_id) SELECT $1, id FROM roles WHERE nombre = ANY($2::text[])
    ON CONFLICT DO NOTHING`,
  usuarioCambiarActivo: `
    UPDATE usuarios SET activo = $2, version_token = version_token + 1 WHERE id = $1 RETURNING id`,
  usuarioCambiarClave: `
    UPDATE usuarios SET clave_hash = $2, intentos_fallidos = 0, bloqueado_hasta = NULL, version_token = version_token + 1
     WHERE id = $1 RETURNING id`,
  usuarioCambiarDatos: `UPDATE usuarios SET nombre = $2, correo = $3 WHERE id = $1 RETURNING id, nombre, correo`,
  usuarioSubirVersion: `UPDATE usuarios SET version_token = version_token + 1 WHERE id = $1 RETURNING id`,
  rolesListar: `SELECT nombre FROM roles ORDER BY id`,

  // ---- syllabus (proyectos): siempre del usuario de la sesión
  proyectosListar: `
    SELECT datos FROM proyectos WHERE propietario_id = $1 ORDER BY creado DESC LIMIT 1000`,
  // Seguimiento (coordinación): solo cifras de avance de TODOS los cursos, nunca el contenido. Lectura: la política
  // proyectos_leer deja ver filas ajenas únicamente a quien tiene proyectos.ver_todos; escribir sigue siendo solo lo propio.
  seguimientoListar: `
    SELECT p.id, p.propietario_id, u.nombre AS responsable, u.correo, p.programa, p.curso, p.creado AS creado_en, p.actualizado,
           coalesce(nullif(p.datos->>'syllabusUrl', ''), '') <> '' AS tiene_syllabus,
           jsonb_array_length(CASE WHEN jsonb_typeof(p.datos->'syllabus'->'documentos') = 'array' THEN p.datos->'syllabus'->'documentos' ELSE '[]'::jsonb END) AS unidades,
           (SELECT count(*) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.datos->'syllabus'->'documentos') = 'array' THEN p.datos->'syllabus'->'documentos' ELSE '[]'::jsonb END) d
             WHERE d->>'aprobado' = 'true')::int AS unidades_aprobadas,
           (SELECT count(*) FROM jsonb_each(CASE WHEN jsonb_typeof(p.datos->'guionesUnidad') = 'object' THEN p.datos->'guionesUnidad' ELSE '{}'::jsonb END) g
             WHERE jsonb_typeof(g.value->'archivos') = 'array' AND jsonb_array_length(g.value->'archivos') > 0)::int AS unidades_con_guion,
           jsonb_array_length(CASE WHEN jsonb_typeof(p.datos->'guiones') = 'array' THEN p.datos->'guiones' ELSE '[]'::jsonb END) AS guiones_cargados,
           jsonb_array_length(CASE WHEN jsonb_typeof(p.datos->'recursos') = 'array' THEN p.datos->'recursos' ELSE '[]'::jsonb END) AS recursos
      FROM proyectos p
      JOIN usuarios u ON u.id = p.propietario_id
     ORDER BY p.actualizado DESC
     LIMIT 2000`,
  proyectoObtener: `
    SELECT datos FROM proyectos WHERE propietario_id = $1 AND id = $2`,
  proyectoGuardar: `
    INSERT INTO proyectos (propietario_id, id, programa, curso, datos)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    ON CONFLICT (propietario_id, id)
    DO UPDATE SET programa = EXCLUDED.programa, curso = EXCLUDED.curso, datos = EXCLUDED.datos, actualizado = now()
    RETURNING id`,
  proyectoEliminar: `
    DELETE FROM proyectos WHERE propietario_id = $1 AND id = $2 RETURNING id`,

  // ---- enlaces generados (syllabus, carpeta, documentos por unidad, guiones)
  enlacesBorrarDelProyecto: `
    DELETE FROM enlaces WHERE propietario_id = $1 AND proyecto_id = $2`,
  enlaceInsertar: `
    INSERT INTO enlaces (propietario_id, proyecto_id, tipo, unidad, nombre, url)
    VALUES ($1, $2, $3, $4, $5, $6)`,
  enlacesDelProyecto: `
    SELECT tipo, unidad, nombre, url, creado FROM enlaces
     WHERE propietario_id = $1 AND proyecto_id = $2 ORDER BY tipo, unidad NULLS FIRST, id`,

  // ---- bibliografía (cada consulta filtra por propietario y además actúa la política de filas)
  bibTrabajoCrear: `
    INSERT INTO bib_trabajos (propietario_id, proyecto_id, estado, total) VALUES ($1, $2, 'pendiente', $3) RETURNING id`,
  bibTrabajoActualizar: `
    UPDATE bib_trabajos SET estado = $3, resueltas = $4, fallidas = $5, detalle = $6, actualizado = now()
     WHERE id = $1 AND propietario_id = $2`,
  bibTrabajoObtener: `
    SELECT id, proyecto_id, estado, total, resueltas, fallidas, detalle, creado, actualizado FROM bib_trabajos WHERE id = $1`,
  // Panel de bibliografía (coordinación/administración): cada lectura con quién la hizo y a qué syllabus quedó vinculada
  // (el syllabus guarda en datos->bibliografiaId el trabajo que se leyó). Lectura de lo ajeno: la política de filas (ver_todos).
  bibResumenTodos: `
    SELECT t.id, t.estado, t.total, t.resueltas, t.fallidas, t.detalle, t.creado, u.nombre AS responsable, u.correo,
           p.id AS proyecto_id, p.curso, p.programa, p.creado AS syllabus_creado,
           (SELECT count(*) FROM bib_fuentes f WHERE f.trabajo_id = t.id AND f.estado = 'resuelta')::int AS leidas,
           (SELECT count(*) FROM bib_fuentes f WHERE f.trabajo_id = t.id AND f.estado = 'parcial')::int AS parciales,
           (SELECT count(*) FROM bib_fuentes f WHERE f.trabajo_id = t.id AND f.estado IN ('sin_acceso','error')
              AND NOT (coalesce(f.estado_detalle, '') LIKE 'Omitida a mano%' OR (coalesce(f.url, '') = '' AND coalesce(f.doi, '') = '')))::int AS sin_acceso,
           (SELECT count(*) FROM bib_fuentes f WHERE f.trabajo_id = t.id AND f.estado <> 'resuelta'
              AND (coalesce(f.estado_detalle, '') LIKE 'Omitida a mano%' OR (coalesce(f.url, '') = '' AND coalesce(f.doi, '') = '')))::int AS omitidas
      FROM bib_trabajos t
      JOIN usuarios u ON u.id = t.propietario_id
      LEFT JOIN proyectos p ON p.propietario_id = t.propietario_id AND p.datos->>'bibliografiaId' = t.id::text
     ORDER BY t.creado DESC
     LIMIT 300`,
  bibTrabajosListar: `
    SELECT id, proyecto_id, estado, total, resueltas, fallidas, creado FROM bib_trabajos
     WHERE propietario_id = $1 AND ($2::text IS NULL OR proyecto_id = $2) ORDER BY creado DESC LIMIT 100`,
  bibFuenteInsertar: `
    INSERT INTO bib_fuentes (trabajo_id, propietario_id, orden, entrada_cruda, url, doi, unidad, categoria) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
  bibFuenteGuardar: `
    UPDATE bib_fuentes SET tipo = $3, estado = $4, estado_detalle = $5, titulo = $6, anio = $7, editorial = $8, publicacion = $9,
           volumen = $10, numero = $11, paginas = $12, edicion = $13, idioma = $14, url_final = $15, fuente_datos = $16, doi = $17,
           fecha_consulta = CURRENT_DATE, actualizado = now()
     WHERE id = $1 AND propietario_id = $2`,
  bibFuenteCitas: `
    UPDATE bib_fuentes SET referencia_apa = $3, cita_apa = $4 WHERE id = $1 AND propietario_id = $2`,
  bibFuentesDelTrabajo: `
    SELECT id, orden, entrada_cruda, unidad, categoria, url, doi, tipo, estado, estado_detalle, titulo, anio, editorial, publicacion, volumen, numero,
           paginas, edicion, idioma, url_final, fuente_datos, fecha_consulta, referencia_apa, cita_apa
      FROM bib_fuentes WHERE trabajo_id = $1 ORDER BY orden`,
  bibFuenteObtener: `
    SELECT id, trabajo_id, orden, entrada_cruda, unidad, categoria, url, doi, tipo, estado, estado_detalle, titulo, anio, editorial, publicacion, volumen,
           numero, paginas, edicion, idioma, url_final, fuente_datos, fecha_consulta, referencia_apa, cita_apa
      FROM bib_fuentes WHERE id = $1`,
  bibPaginasDeFuente: `
    SELECT p.numero, left(p.texto, $3) AS texto FROM bib_paginas p
     WHERE p.documento_id = (SELECT id FROM bib_documentos WHERE fuente_id = $1 AND estado = 'extraido' AND rol = 'texto' ORDER BY num_caracteres DESC NULLS LAST LIMIT 1)
       AND length(p.texto) > 40
     ORDER BY p.numero LIMIT $2`,
  bibFuenteMia: `SELECT id, trabajo_id, estado FROM bib_fuentes WHERE id = $1 AND propietario_id = $2`,
  bibFuenteEstado: `UPDATE bib_fuentes SET estado = $3, estado_detalle = $4, actualizado = now() WHERE id = $1 AND propietario_id = $2`,
  bibAutoresBorrar: `DELETE FROM bib_autores WHERE fuente_id = $1 AND propietario_id = $2`,
  bibAutorInsertar: `
    INSERT INTO bib_autores (fuente_id, propietario_id, orden, apellido, nombres, institucional) VALUES ($1, $2, $3, $4, $5, $6)`,
  bibAutoresDelTrabajo: `
    SELECT a.fuente_id, a.orden, a.apellido, a.nombres, a.institucional
      FROM bib_autores a JOIN bib_fuentes f ON f.id = a.fuente_id WHERE f.trabajo_id = $1 ORDER BY a.fuente_id, a.orden`,
  bibDocumentoGuardar: `
    INSERT INTO bib_documentos (fuente_id, propietario_id, url, formato, rol, estado, error, bytes, sha256, num_paginas, num_caracteres)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (fuente_id, url) DO UPDATE SET formato = EXCLUDED.formato, rol = EXCLUDED.rol, estado = EXCLUDED.estado, error = EXCLUDED.error,
           bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256, num_paginas = EXCLUDED.num_paginas, num_caracteres = EXCLUDED.num_caracteres
    RETURNING id`,
  bibPaginasGuardar: `
    INSERT INTO bib_paginas (documento_id, propietario_id, numero, texto)
    SELECT $1, $2, x.n, x.t FROM unnest($3::int[], $4::text[]) AS x(n, t)
    ON CONFLICT (documento_id, numero) DO UPDATE SET texto = EXCLUDED.texto`,
  bibPaginasBorrar: `DELETE FROM bib_paginas WHERE documento_id = $1 AND propietario_id = $2`,
  bibDocumentosDeFuente: `
    SELECT id, url, formato, rol, estado, error, bytes, sha256, num_paginas, num_caracteres FROM bib_documentos WHERE fuente_id = $1 ORDER BY creado`,
  bibPaginasDeDocumento: `
    SELECT numero, texto FROM bib_paginas WHERE documento_id = $1 AND numero BETWEEN $2 AND $3 ORDER BY numero`,
  bibBuscar: `
    SELECT f.id AS fuente_id, f.cita_apa, f.referencia_apa, d.id AS documento_id, d.formato, p.numero,
           ts_headline('spanish', p.texto, websearch_to_tsquery('spanish', $2), 'MaxFragments=2,MaxWords=30,MinWords=10') AS fragmento,
           ts_rank(p.busqueda, websearch_to_tsquery('spanish', $2)) AS relevancia
      FROM bib_paginas p
      JOIN bib_documentos d ON d.id = p.documento_id
      JOIN bib_fuentes f ON f.id = d.fuente_id
     WHERE f.trabajo_id = $1 AND p.busqueda @@ websearch_to_tsquery('spanish', $2)
     ORDER BY relevancia DESC LIMIT 30`,

  // ---- auditoría
  auditoriaRegistrar: `
    INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, ip) VALUES ($1, $2, $3, $4, $5)`,
  auditoriaListar: `
    SELECT a.id, a.accion, a.entidad, a.entidad_id, a.ip, a.creado, u.correo
      FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT 200`
})
