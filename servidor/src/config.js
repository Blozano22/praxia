import 'dotenv/config'

const exigir = (nombre) => {
  const v = process.env[nombre]
  if (!v) throw new Error('Falta la variable de entorno ' + nombre + ' (ver servidor/.env.ejemplo)')
  return v
}

export const config = {
  puerto: Number(process.env.PORT || 3001),
  baseDatos: exigir('DATABASE_URL'),
  secretoJwt: (() => {
    const s = exigir('JWT_SECRET')
    if (s.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres')
    return s
  })(),
  // La sesión se renueva sola mientras se usa la plataforma: vence tras N días SIN actividad, y en todo caso a los M días de haber iniciado.
  // (HORAS_SESION, de versiones anteriores, ya no se usa.)
  diasInactividad: Number(process.env.SESION_DIAS_INACTIVIDAD || 7),
  diasSesionMaximo: Number(process.env.SESION_DIAS_MAXIMO || 30),
  cookieSegura: process.env.COOKIE_SEGURA === 'true',
  origenPermitido: process.env.ORIGEN_PERMITIDO || '',
  carpetaWeb: process.env.CARPETA_WEB || '',
  // Flujo de n8n que escribe los guiones de una unidad (lo llama el servidor). Si el administrador guarda otra dirección en «Conexión n8n», se usa esa.
  n8nGuionesDefecto: process.env.N8N_GUIONES_URL || 'https://n8n.americana.edu.co/webhook/unidad-a-guiones-bibliografia',
  // Flujo de n8n que crea un documento por unidad a partir del syllabus (lo llama el servidor). Si el administrador guarda otra dirección en «Conexión n8n», se usa esa.
  n8nUnidadesDefecto: process.env.N8N_UNIDADES_URL || 'https://n8n.americana.edu.co/webhook/syllabus-a-plantilla-bibliografia-v2',
  // Webhooks de n8n a los que Praxia entrega órdenes de matrices y H5P. Lo normal es guardarlos en «Conexión n8n»; esto es el respaldo.
  n8nMatricesUrl: process.env.N8N_MATRICES_URL || '', // vacío = «Generar matriz» desactivado
  n8nH5pUrl: process.env.N8N_H5P_URL || '', // vacío = «Generar H5P» desactivado
  // Secreto con el que n8n FIRMA los avisos a Praxia (HMAC-SHA256). Sin él el receptor de avisos queda desactivado.
  // El «anterior» permite rotarlo sin cortar los avisos: durante el cambio se aceptan los dos.
  n8nEventosSecreto: process.env.N8N_EVENTOS_SECRETO || '',
  n8nEventosSecretoAnterior: process.env.N8N_EVENTOS_SECRETO_ANTERIOR || '',
  // Tope (MB) de lo que Praxia envía a n8n en un solo paquete: n8n acepta 16 MiB por defecto y falla con un error poco claro.
  n8nPaqueteMaxMb: Number(process.env.N8N_PAQUETE_MAX_MB || 12),
  // Minutos máximos que se espera la respuesta de n8n antes de darla por fallida.
  n8nMinutosMaximo: Number(process.env.N8N_MINUTOS_MAXIMO || 45),
  // Si la plataforma se publica en una subcarpeta (p. ej. /praxia), la cookie de sesión se limita a ella.
  rutaBase: process.env.RUTA_BASE || '/'
}
