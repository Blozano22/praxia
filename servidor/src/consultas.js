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
  // Bloqueo solo de esa cuenta: a los 10 fallos seguidos, 5 minutos. Pasado el bloqueo la cuenta cuenta de cero (antes, un solo fallo más la volvía a bloquear).
  registrarFallo: `
    UPDATE usuarios SET
           intentos_fallidos = CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= now() THEN 1 ELSE intentos_fallidos + 1 END,
           bloqueado_hasta = CASE
             WHEN (CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= now() THEN 1 ELSE intentos_fallidos + 1 END) >= 10 THEN now() + interval '5 minutes'
             WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= now() THEN NULL
             ELSE bloqueado_hasta END
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
  configLeer: `SELECT clave, valor FROM configuracion WHERE clave = ANY($1::text[])`,
  configGuardar: `INSERT INTO configuracion (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado = now()`,
  configBorrar: `DELETE FROM configuracion WHERE clave = $1`,
  usuarioBorrar: `DELETE FROM usuarios WHERE id = $1 RETURNING id, correo`,
  historialListar: `
    SELECT id, plantilla, estado, observacion, doc_url AS "docUrl", usuario_id AS "usuarioId", usuario_nombre AS usuario, rol, referencia,
           creado, editado_en AS "editadoEn", editado_por AS "editadoPor"
      FROM plantilla_historial ORDER BY creado DESC, id DESC LIMIT 2000`,
  // Un paso a la vez por plantilla: dos personas decidiendo a la vez se atienden una tras otra.
  historialBloquear: `SELECT pg_advisory_xact_lock(hashtext($1))`,
  historialUltimo: `
    SELECT id, plantilla, estado, observacion, doc_url AS "docUrl", usuario_id AS "usuarioId", usuario_nombre AS usuario, rol, referencia,
           creado, editado_en AS "editadoEn", editado_por AS "editadoPor"
      FROM plantilla_historial WHERE plantilla = $1 ORDER BY creado DESC, id DESC LIMIT 1`,
  historialObtener: `
    SELECT id, plantilla, estado, observacion, doc_url AS "docUrl", usuario_id AS "usuarioId", usuario_nombre AS usuario, rol, referencia,
           creado, editado_en AS "editadoEn", editado_por AS "editadoPor"
      FROM plantilla_historial WHERE id = $1`,
  historialCrear: `
    INSERT INTO plantilla_historial (plantilla, estado, observacion, doc_url, usuario_id, usuario_nombre, rol, referencia)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, plantilla, estado, observacion, doc_url AS "docUrl", usuario_id AS "usuarioId", usuario_nombre AS usuario, rol, referencia,
              creado, editado_en AS "editadoEn", editado_por AS "editadoPor"`,
  historialEditar: `
    UPDATE plantilla_historial SET observacion = $2, doc_url = $3, editado_en = now(), editado_por = $4 WHERE id = $1
    RETURNING id, plantilla, estado, observacion, doc_url AS "docUrl", usuario_id AS "usuarioId", usuario_nombre AS usuario, rol, referencia,
              creado, editado_en AS "editadoEn", editado_por AS "editadoPor"`,
  // ---- trabajos de guiones (la llamada a n8n la hace el servidor). Todo va filtrado por propietario.
  guionTrabajoCrear: `
    INSERT INTO guiones_trabajos (propietario_id, proyecto_id, unidad, estado) VALUES ($1, $2, $3, 'en_curso')
    ON CONFLICT (propietario_id, proyecto_id, unidad) WHERE estado = 'en_curso' DO NOTHING
    RETURNING id, creado`,
  guionTrabajoEnCurso: `SELECT id, creado FROM guiones_trabajos WHERE propietario_id = $1 AND proyecto_id = $2 AND unidad = $3 AND estado = 'en_curso'`,
  guionTrabajoListo: `UPDATE guiones_trabajos SET estado = 'listo', respuesta = $2, terminado = now() WHERE id = $1 AND estado = 'en_curso'`,
  guionTrabajoFallo: `UPDATE guiones_trabajos SET estado = 'error', error = $2, terminado = now() WHERE id = $1 AND estado = 'en_curso'`,
  guionTrabajosListar: `
    SELECT id, proyecto_id AS proyecto, unidad, estado, creado, terminado, error
      FROM guiones_trabajos WHERE propietario_id = $1 ORDER BY creado DESC LIMIT 200`,
  guionTrabajoRespuesta: `SELECT respuesta FROM guiones_trabajos WHERE id = $1 AND propietario_id = $2 AND estado = 'listo'`,
  guionTrabajoBorrar: `DELETE FROM guiones_trabajos WHERE id = $1 AND propietario_id = $2 AND estado <> 'en_curso' RETURNING id`,
  // Mantenimiento: lo que quedó «en curso» demasiado tiempo (el servidor se reinició o n8n no respondió) se da por fallido; lo terminado hace más de 7 días se borra.
  guionTrabajosCaducar: `
    UPDATE guiones_trabajos SET estado = 'error', error = $1, terminado = now()
     WHERE estado = 'en_curso' AND creado < now() - ($2::int * interval '1 minute')`,
  guionTrabajosLimpiar: `DELETE FROM guiones_trabajos WHERE estado <> 'en_curso' AND coalesce(terminado, creado) < now() - interval '7 days'`,
  // ---- trabajos de creación de unidades (la llamada a n8n la hace el servidor). Todo va filtrado por propietario.
  unidadTrabajoCrear: `
    INSERT INTO unidades_trabajos (propietario_id, syllabus_doc, syllabus_url, carpeta_url, curso, proyecto_id, bibliografia_id, estado)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'en_curso')
    ON CONFLICT (propietario_id, syllabus_doc) WHERE estado = 'en_curso' DO NOTHING
    RETURNING id, creado`,
  unidadTrabajoEnCurso: `SELECT id, creado FROM unidades_trabajos WHERE propietario_id = $1 AND syllabus_doc = $2 AND estado = 'en_curso'`,
  unidadTrabajoListo: `UPDATE unidades_trabajos SET estado = 'listo', respuesta = $2, terminado = now() WHERE id = $1 AND estado = 'en_curso'`,
  unidadTrabajoFallo: `UPDATE unidades_trabajos SET estado = 'error', error = $2, terminado = now() WHERE id = $1 AND estado = 'en_curso'`,
  unidadTrabajosListar: `
    SELECT id, syllabus_doc AS "syllabusDoc", syllabus_url AS "syllabusUrl", carpeta_url AS "carpetaUrl", curso, proyecto_id AS proyecto,
           bibliografia_id AS "bibliografiaId", estado, creado, terminado, error
      FROM unidades_trabajos WHERE propietario_id = $1 ORDER BY creado DESC LIMIT 200`,
  unidadTrabajoRespuesta: `SELECT respuesta FROM unidades_trabajos WHERE id = $1 AND propietario_id = $2 AND estado = 'listo'`,
  unidadTrabajoBorrar: `DELETE FROM unidades_trabajos WHERE id = $1 AND propietario_id = $2 AND estado <> 'en_curso' RETURNING id`,
  unidadTrabajosCaducar: `
    UPDATE unidades_trabajos SET estado = 'error', error = $1, terminado = now()
     WHERE estado = 'en_curso' AND creado < now() - ($2::int * interval '1 minute')`,
  unidadTrabajosLimpiar: `DELETE FROM unidades_trabajos WHERE estado <> 'en_curso' AND coalesce(terminado, creado) < now() - interval '7 days'`,
  // ---- pipeline: avisos de n8n guardados ligados al curso (sin sesión: la persona sale de pipeline_origen)
  pipeCarpetaDeProyecto: `SELECT datos->>'carpetaUrl' AS carpeta FROM proyectos WHERE propietario_id = $1 AND id = $2`,
  pipeProyectoDatos: `SELECT datos FROM proyectos WHERE propietario_id = $1 AND id = $2`,
  pipeOrigenBorrar: `DELETE FROM pipeline_origen WHERE trabajo_id = $1`,
  // ¿Hay ya una generación de matrices en este curso? Una corrida avisó hace menos de 15 min, o se lanzó hace menos de 3 y aún no terminó.
  pipeMatrizEnCurso: `
    SELECT 1 FROM pipeline_ejecuciones
     WHERE propietario_id = $1 AND proyecto_id = $2 AND etapa = 'matrices' AND estado = 'en_curso' AND ultimo_evento_en > now() - interval '15 minutes'
    UNION ALL
    SELECT 1 FROM pipeline_origen o
     WHERE o.propietario_id = $1 AND o.proyecto_id = $2 AND o.etapa = 'matrices' AND o.creado > now() - interval '3 minutes'
       AND NOT EXISTS (SELECT 1 FROM pipeline_ejecuciones e WHERE e.propietario_id = o.propietario_id AND e.proyecto_id = o.proyecto_id
                          AND e.etapa = 'matrices' AND e.estado = 'terminada' AND (e.trabajo_id = o.trabajo_id OR e.origen_trabajo_id = o.trabajo_id))
    LIMIT 1`,
  pipeOrigenGuardar: `
    INSERT INTO pipeline_origen (trabajo_id, propietario_id, proyecto_id, carpeta_raiz, etapa, unidad) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (trabajo_id) DO NOTHING`,
  pipeOrigenObtener: `SELECT trabajo_id, propietario_id, proyecto_id, carpeta_raiz, etapa, unidad FROM pipeline_origen WHERE trabajo_id = $1`,
  pipeEventoInsertar: `
    INSERT INTO pipeline_eventos (evento_id, tipo, etapa, trabajo_id, origen_trabajo_id, ejecucion_id, propietario_id, proyecto_id, secuencia, fecha_evento, resultado, motivo, carga)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
    ON CONFLICT (evento_id) DO NOTHING
    RETURNING evento_id`,
  pipeEventoResultado: `UPDATE pipeline_eventos SET resultado = $2, motivo = $3 WHERE evento_id = $1`,
  pipeEventosLimpiar: `DELETE FROM pipeline_eventos WHERE recibido < now() - interval '60 days'`,
  pipeOrigenLimpiar: `DELETE FROM pipeline_origen WHERE creado < now() - interval '180 days'`,
  pipeEjecucionInicio: `
    INSERT INTO pipeline_ejecuciones (propietario_id, proyecto_id, etapa, ejecucion_id, trabajo_id, origen_trabajo_id, carpeta_raiz, estado, maximo, plan, iniciado_en, ultimo_evento_en)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'en_curso', $8, $9::jsonb, $10, $10)
    ON CONFLICT (propietario_id, proyecto_id, etapa, ejecucion_id) DO UPDATE SET
      trabajo_id = coalesce(pipeline_ejecuciones.trabajo_id, EXCLUDED.trabajo_id),
      origen_trabajo_id = coalesce(pipeline_ejecuciones.origen_trabajo_id, EXCLUDED.origen_trabajo_id),
      carpeta_raiz = coalesce(EXCLUDED.carpeta_raiz, pipeline_ejecuciones.carpeta_raiz),
      maximo = coalesce(EXCLUDED.maximo, pipeline_ejecuciones.maximo),
      plan = coalesce(EXCLUDED.plan, pipeline_ejecuciones.plan),
      iniciado_en = least(coalesce(pipeline_ejecuciones.iniciado_en, EXCLUDED.iniciado_en), EXCLUDED.iniciado_en),
      ultimo_evento_en = greatest(pipeline_ejecuciones.ultimo_evento_en, EXCLUDED.ultimo_evento_en),
      estado = CASE WHEN pipeline_ejecuciones.estado = 'terminada' THEN 'terminada' ELSE 'en_curso' END`,
  pipeEjecucionTocar: `
    INSERT INTO pipeline_ejecuciones (propietario_id, proyecto_id, etapa, ejecucion_id, trabajo_id, origen_trabajo_id, carpeta_raiz, estado, ultimo_evento_en)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'en_curso', $8)
    ON CONFLICT (propietario_id, proyecto_id, etapa, ejecucion_id) DO UPDATE SET
      ultimo_evento_en = greatest(pipeline_ejecuciones.ultimo_evento_en, EXCLUDED.ultimo_evento_en)`,
  pipeEjecucionFin: `
    INSERT INTO pipeline_ejecuciones (propietario_id, proyecto_id, etapa, ejecucion_id, trabajo_id, origen_trabajo_id, carpeta_raiz, estado, resumen, ultimo_evento_en, terminado_en)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'terminada', $8::jsonb, $9, $9)
    ON CONFLICT (propietario_id, proyecto_id, etapa, ejecucion_id) DO UPDATE SET
      estado = 'terminada',
      resumen = coalesce(EXCLUDED.resumen, pipeline_ejecuciones.resumen),
      ultimo_evento_en = greatest(pipeline_ejecuciones.ultimo_evento_en, EXCLUDED.ultimo_evento_en),
      terminado_en = greatest(coalesce(pipeline_ejecuciones.terminado_en, EXCLUDED.terminado_en), EXCLUDED.terminado_en)`,
  // Un aviso solo cambia lo guardado si no es más antiguo que lo que ya está (por fecha y, si empatan, por secuencia).
  pipeMatrizGuardar: `
    INSERT INTO pipeline_matrices (propietario_id, proyecto_id, unidad, formacion, estado, matriz_id, matriz_url, matriz_nombre, detalle, filas_total, actualizado_en, secuencia)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, 0), $11, $12)
    ON CONFLICT (propietario_id, proyecto_id, unidad) DO UPDATE SET
      formacion = coalesce(EXCLUDED.formacion, pipeline_matrices.formacion),
      estado = EXCLUDED.estado,
      matriz_id = coalesce(EXCLUDED.matriz_id, pipeline_matrices.matriz_id),
      matriz_url = coalesce(EXCLUDED.matriz_url, pipeline_matrices.matriz_url),
      matriz_nombre = coalesce(EXCLUDED.matriz_nombre, pipeline_matrices.matriz_nombre),
      detalle = EXCLUDED.detalle,
      filas_total = CASE WHEN $10 IS NULL THEN pipeline_matrices.filas_total ELSE EXCLUDED.filas_total END,
      actualizado_en = EXCLUDED.actualizado_en,
      secuencia = EXCLUDED.secuencia
    WHERE (pipeline_matrices.actualizado_en, pipeline_matrices.secuencia) <= (EXCLUDED.actualizado_en, EXCLUDED.secuencia)
    RETURNING unidad`,
  pipeRecursoGuardar: `
    INSERT INTO pipeline_recursos (propietario_id, proyecto_id, id, unidad, id_base, variante, alcance, tema, codigo, formato, titulo, con_actividad, generador, estado, observaciones, enlace_guion, enlace_recurso, omision, actualizado_en, secuencia)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    ON CONFLICT (propietario_id, proyecto_id, id) DO UPDATE SET
      unidad = coalesce(EXCLUDED.unidad, pipeline_recursos.unidad),
      id_base = coalesce(EXCLUDED.id_base, pipeline_recursos.id_base),
      variante = coalesce(EXCLUDED.variante, pipeline_recursos.variante),
      alcance = coalesce(EXCLUDED.alcance, pipeline_recursos.alcance),
      tema = coalesce(EXCLUDED.tema, pipeline_recursos.tema),
      codigo = coalesce(EXCLUDED.codigo, pipeline_recursos.codigo),
      formato = coalesce(EXCLUDED.formato, pipeline_recursos.formato),
      titulo = coalesce(EXCLUDED.titulo, pipeline_recursos.titulo),
      con_actividad = coalesce(EXCLUDED.con_actividad, pipeline_recursos.con_actividad),
      generador = coalesce(EXCLUDED.generador, pipeline_recursos.generador),
      estado = EXCLUDED.estado,
      observaciones = EXCLUDED.observaciones,
      enlace_guion = coalesce(EXCLUDED.enlace_guion, pipeline_recursos.enlace_guion),
      enlace_recurso = coalesce(EXCLUDED.enlace_recurso, pipeline_recursos.enlace_recurso),
      omision = EXCLUDED.omision,
      actualizado_en = EXCLUDED.actualizado_en,
      secuencia = EXCLUDED.secuencia
    WHERE (pipeline_recursos.actualizado_en, pipeline_recursos.secuencia) <= (EXCLUDED.actualizado_en, EXCLUDED.secuencia)
    RETURNING id`,
  // Plan de una corrida: marca el motivo de omisión en las filas que ya se conocen (sin crear filas).
  pipeRecursoOmitir: `
    UPDATE pipeline_recursos SET omision = $4, actualizado_en = $5, secuencia = $6
     WHERE propietario_id = $1 AND proyecto_id = $2 AND id = $3 AND (actualizado_en, secuencia) <= ($5, $6)
    RETURNING id`,
  // Una matriz nueva reemplaza la foto de su unidad: se quitan las filas que ya no están, salvo las que cambiaron después de esa foto.
  pipeRecursosQuitarSobrantes: `
    DELETE FROM pipeline_recursos
     WHERE propietario_id = $1 AND proyecto_id = $2 AND unidad = $3 AND NOT (id = ANY($4::text[])) AND actualizado_en <= $5`,
  // ---- pipeline: lectura para la pantalla del curso (solo lo de esa persona y ese curso)
  pipeLeerMatrices: `
    SELECT unidad, formacion, estado, matriz_id AS "matrizId", matriz_url AS "matrizUrl", matriz_nombre AS "matrizNombre", detalle,
           filas_total AS "filasTotal", actualizado_en AS "actualizadoEn",
           (estado = 'generando' AND actualizado_en < now() - interval '15 minutes') AS "sinRespuesta"
      FROM pipeline_matrices WHERE propietario_id = $1 AND proyecto_id = $2 ORDER BY unidad`,
  pipeLeerRecursos: `
    SELECT id, unidad, tema, codigo, formato, titulo, generador, estado, observaciones, enlace_guion AS "enlaceGuion",
           enlace_recurso AS "enlaceRecurso", omision, actualizado_en AS "actualizadoEn",
           (estado = 'EN_PROCESO' AND actualizado_en < now() - interval '30 minutes') AS "sinRespuesta"
      FROM pipeline_recursos WHERE propietario_id = $1 AND proyecto_id = $2
     ORDER BY unidad NULLS LAST, tema NULLS LAST, codigo NULLS LAST, id LIMIT 3000`,
  pipeLeerEjecuciones: `
    SELECT etapa, ejecucion_id AS "ejecucionId", estado, maximo, plan, resumen, iniciado_en AS "iniciadoEn",
           ultimo_evento_en AS "ultimoEventoEn", terminado_en AS "terminadoEn",
           (estado = 'en_curso' AND ultimo_evento_en < now() - interval '15 minutes') AS "sinRespuesta"
      FROM pipeline_ejecuciones WHERE propietario_id = $1 AND proyecto_id = $2 ORDER BY ultimo_evento_en DESC LIMIT 20`,
  usuarioSubirVersion: `UPDATE usuarios SET version_token = version_token + 1 WHERE id = $1 RETURNING id`,
  rolesListar: `SELECT nombre FROM roles ORDER BY id`,

  // ---- syllabus (proyectos): siempre del usuario de la sesión
  proyectosListar: `
    SELECT datos, version FROM proyectos WHERE propietario_id = $1 ORDER BY creado DESC LIMIT 1000`,
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
  // Con FOR UPDATE: dos guardados a la vez del mismo syllabus se atienden uno tras otro y el segundo ve la versión nueva.
  proyectoObtener: `
    SELECT datos, version FROM proyectos WHERE propietario_id = $1 AND id = $2 FOR UPDATE`,
  proyectoGuardar: `
    INSERT INTO proyectos (propietario_id, id, programa, curso, datos)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    ON CONFLICT (propietario_id, id)
    DO UPDATE SET programa = EXCLUDED.programa, curso = EXCLUDED.curso, datos = EXCLUDED.datos, actualizado = now(), version = proyectos.version + 1
    RETURNING id, version`,
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
    INSERT INTO bib_trabajos (propietario_id, proyecto_id, estado, total, syllabus_doc) VALUES ($1, $2, 'pendiente', $3, $4) RETURNING id`,
  // La lectura más reciente de ese documento (de los últimos 14 días) para retomarla desde cualquier pestaña o equipo.
  bibTrabajoPorDoc: `
    SELECT id, estado, creado FROM bib_trabajos
     WHERE propietario_id = $1 AND syllabus_doc = $2 AND creado > now() - interval '14 days'
     ORDER BY creado DESC LIMIT 1`,
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
