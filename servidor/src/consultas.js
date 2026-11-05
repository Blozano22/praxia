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

  // ---- auditoría
  auditoriaRegistrar: `
    INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, ip) VALUES ($1, $2, $3, $4, $5)`,
  auditoriaListar: `
    SELECT a.id, a.accion, a.entidad, a.entidad_id, a.ip, a.creado, u.correo
      FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT 200`
})
