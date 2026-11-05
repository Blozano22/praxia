# Servidor y base de datos de la plataforma

Node (Express) + PostgreSQL. La plataforma React habla con este servidor; ya no guarda nada en el navegador.

## Qué resuelve

| Necesidad | Cómo se resuelve |
|---|---|
| Usuarios, roles y permisos | Tablas `usuarios`, `roles`, `permisos`, `rol_permisos`. Roles: **admin**, **coordinador**, **docente**. Una persona puede tener **varios roles** (tabla `usuario_roles`) y sus permisos se suman. |
| Cada persona ve solo lo que crea | Cada syllabus y cada enlace tiene `propietario_id`. La clave es `(propietario, id)`: nadie puede pisar el de otra persona. Además, la base aplica **seguridad por fila (RLS)**: aunque una consulta olvidara el filtro, PostgreSQL no entrega ni deja escribir filas ajenas. |
| Guardar todas las URL generadas | Tabla `enlaces`: syllabus, carpeta, documento por unidad y guiones, con su propietario. Solo se aceptan `https://`. |
| Consultas seguras | Ver «Cómo evitamos la inyección SQL». |

### Permisos por rol (por defecto)

| Permiso | admin | coordinador | docente |
|---|:-:|:-:|:-:|
| proyectos.crear / ver_propios / editar / eliminar | | ✔ | ✔ |
| usuarios.gestionar (crear, cambiar rol, activar, clave) | ✔ | | |
| auditoria.ver | ✔ | | |
| proyectos.ver_todos | no se asigna a nadie | | |

El administrador gestiona cuentas pero **no ve el contenido de los demás**. Si algún día se quiere que lo vea:
`INSERT INTO rol_permisos VALUES (1, 5);` (rol admin, permiso `proyectos.ver_todos`).

## Cómo evitamos la inyección SQL

1. **Ninguna consulta se arma con texto del usuario.** Todas están escritas a mano en `src/consultas.js`, como constantes. Los datos viajan aparte (`$1`, `$2`…).
2. **No hay consultas genéricas.** No existe nada como `seleccionar(tabla, campo, valor)`: cada operación (login, listar mis syllabus, borrar el mío…) tiene su propia consulta con sus columnas y condiciones fijas. Nombres de tablas y columnas nunca vienen de fuera.
3. **Validación antes de la base de datos** (`zod`): correo, identificadores (`^[A-Za-z0-9_-]{1,64}$`), roles (lista cerrada), tamaños. Lo que no cumple se rechaza con 400.
4. **Restricciones en la propia base** (`CHECK`): formato de id, correo, `https://` en los enlaces, largos máximos.
5. **Usuario de la aplicación sin privilegios de dueño** (`ova_app`): sin `DROP`, sin crear tablas, sin saltarse RLS; solo puede modificar las columnas que necesita.
6. Una prueba automática verifica que `consultas.js` no use `${}` y que las rutas no escriban SQL.

Otras protecciones: claves con bcrypt (costo 12), sesión en cookie `httpOnly` + `SameSite=Strict`, cabecera `x-ova` obligatoria en escrituras (anti-CSRF), bloqueo tras 5 fallos (15 min), límite de intentos por IP, mismo mensaje de error exista o no el correo, sesión revocable al instante (desactivar usuario / cambiar rol / salir), cabeceras de `helmet`, errores internos sin detalle, registro de actividad en `auditoria`.

## Puesta en marcha

1. **Crear la base y los dos usuarios de PostgreSQL** (como administrador de PostgreSQL):
   ```sql
   CREATE DATABASE ova;
   CREATE ROLE ova_app LOGIN PASSWORD 'ELIGE_UNA_CLAVE_LARGA' NOSUPERUSER NOBYPASSRLS;
   ```
   (El dueño de la base puede ser `postgres` u otro usuario propio.)
2. `cd servidor && npm install`
3. Copiar `.env.ejemplo` a `.env` y completar `DATABASE_URL`, `DATABASE_URL_DUENO` y `JWT_SECRET`.
4. Crear las tablas: `npm run db:migrar`
5. Crear el primer administrador (la clave no se guarda en ningún archivo):
   ```bash
   ADMIN_CORREO=persona@dominio ADMIN_NOMBRE="Nombre" ADMIN_CLAVE='UnaClaveSegura123' npm run usuario:crear-admin
   ```
6. Compilar la plataforma (`cd ../plataforma-react && npm run build`) y arrancar: `cd ../servidor && npm start`.
   Se abre en `http://localhost:3001`. El servidor entrega la plataforma y la API desde el mismo origen.

En **desarrollo**: `npm run dev` en `servidor/` y `npm run dev` en `plataforma-react/` (Vite reenvía `/api` al servidor).

En **producción**: usar HTTPS y poner `COOKIE_SEGURA=true`.

## Probar sin instalar PostgreSQL

- `npm test`: levanta un PostgreSQL temporal y ejecuta 10 pruebas (permisos, propiedad de los datos, RLS, intentos de inyección, bloqueo de cuenta…).
- `npm run demo`: deja corriendo servidor y base temporales con tres usuarios de prueba (`admin@demo.co`, `ana@demo.co`, `beto@demo.co`, clave `ClaveDemo2026`). No es para producción; todo se borra al cerrar.

## Datos que ya existían en el navegador

Al iniciar sesión, si en ese navegador había syllabus guardados antes (IndexedDB), aparece un aviso para **importarlos a tu cuenta**.

## Archivos

- `sql/001_esquema.sql`: tablas, roles, permisos, RLS y privilegios.
- `src/consultas.js`: todas las consultas SQL, fijas y parametrizadas.
- `src/rutas.js`: endpoints, validación y permisos.
- `src/seguridad.js`: claves, sesión, permisos, anti-CSRF.
- `src/enlaces.js`: extrae los enlaces de un syllabus.
- `test/seguridad.test.js`: pruebas contra PostgreSQL real.
