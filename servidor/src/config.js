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
  horasSesion: Number(process.env.HORAS_SESION || 8),
  cookieSegura: process.env.COOKIE_SEGURA === 'true',
  origenPermitido: process.env.ORIGEN_PERMITIDO || '',
  carpetaWeb: process.env.CARPETA_WEB || '',
  // Si la plataforma se publica en una subcarpeta (p. ej. /praxia), la cookie de sesión se limita a ella.
  rutaBase: process.env.RUTA_BASE || '/'
}
