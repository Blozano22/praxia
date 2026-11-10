// Roles de la plataforma, de mayor a menor rango. Cuando una persona tiene varios, en pantalla se muestra el de mayor rango.
export const ORDEN_ROLES = ['admin', 'coordinador', 'docente', 'disenador']
export const NOMBRE_ROL = { admin: 'Administrador', coordinador: 'Coordinador', docente: 'Docente', disenador: 'Diseñador' }

// Roles de la persona ordenados por rango (los desconocidos van al final).
export const ordenarRoles = (roles = []) => [...roles].sort((a, b) => {
  const ia = ORDEN_ROLES.indexOf(a), ib = ORDEN_ROLES.indexOf(b)
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
})

// { principal, otros, todos }: el rol de mayor rango, cuántos más tiene y la lista completa con nombres (para el aviso al pasar el cursor).
export function resumenRoles(roles = []) {
  const ord = ordenarRoles(roles)
  return { principal: ord[0] || 'docente', otros: Math.max(0, ord.length - 1), todos: ord.map((r) => NOMBRE_ROL[r] || r).join(' · ') }
}
