import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'

const ROLES = ['admin', 'coordinador', 'docente']
const NOMBRE_ROL = { admin: 'Administrador', coordinador: 'Coordinador', docente: 'Docente' }

const alternar = (lista, r) => (lista.includes(r) ? lista.filter((x) => x !== r) : [...lista, r])

export default function Usuarios({ yo, aviso }) {
  const [lista, setLista] = useState([])
  const [form, setForm] = useState({ nombre: '', correo: '', clave: '', roles: ['docente'] })
  const [error, setError] = useState('')

  const cargar = useCallback(() => api('GET', '/usuarios').then(setLista).catch(() => setError('No se pudo cargar la lista')), [])
  useEffect(() => { cargar() }, [cargar])

  const crear = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api('POST', '/usuarios', form)
      setForm({ nombre: '', correo: '', clave: '', roles: ['docente'] })
      aviso('Usuario creado')
      cargar()
    } catch (err) { setError(err.message) }
  }
  const cambiar = async (ruta, cuerpo, ok) => {
    try { await api('PATCH', ruta, cuerpo); aviso(ok); cargar() } catch (err) { aviso(err.message) }
  }
  const nuevaClave = (u) => {
    const clave = window.prompt('Nueva clave para ' + u.correo + ' (10 o más caracteres, con mayúscula, minúscula y número):')
    if (clave) cambiar('/usuarios/' + u.id + '/clave', { clave }, 'Clave actualizada')
  }

  return (
    <div className="wrapx fade">
      <h1>Usuarios</h1>
      <p className="lead">Cada usuario trabaja solo con los syllabus que él mismo crea. El administrador gestiona las cuentas y los roles, pero no ve el contenido de los demás.</p>

      <form className="card" onSubmit={crear} style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>Nuevo usuario</h2>
        <div className="kvc" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
          <div><label className="l" htmlFor="u-nombre">Nombre</label><input id="u-nombre" type="text" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
          <div><label className="l" htmlFor="u-correo">Correo</label><input id="u-correo" type="text" value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} /></div>
          <div><label className="l" htmlFor="u-clave">Clave inicial</label><input id="u-clave" type="password" autoComplete="new-password" value={form.clave} onChange={(e) => setForm({ ...form, clave: e.target.value })} /></div>
          <div><span className="l" style={{ display: 'block' }}>Roles</span>
            <div className="roles-chk">{ROLES.map((r) => (
              <label key={r}><input type="checkbox" checked={form.roles.includes(r)} onChange={() => setForm({ ...form, roles: alternar(form.roles, r) })} /> {NOMBRE_ROL[r]}</label>
            ))}</div></div>
        </div>
        {error && <div className="msg bad" role="alert" style={{ marginTop: 14 }}>{error}</div>}
        <button className="btn" type="submit" style={{ marginTop: 16 }} disabled={!form.nombre || !form.correo || !form.clave || !form.roles.length}>Crear usuario</button>
      </form>

      <h2>Personas con acceso <span className="pill">{lista.length}</span></h2>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tabla">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Roles</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {lista.map((u) => {
              const yoMismo = u.correo === yo.correo
              return (
                <tr key={u.id}>
                  <td><b>{u.nombre}</b></td>
                  <td>{u.correo}</td>
                  <td>
                    <div className="roles-chk" aria-label={'Roles de ' + u.nombre}>{ROLES.map((r) => (
                      <label key={r}><input type="checkbox" disabled={yoMismo} checked={u.roles.includes(r)}
                        onChange={() => { const nuevos = alternar(u.roles, r); if (nuevos.length) cambiar('/usuarios/' + u.id + '/roles', { roles: nuevos }, 'Roles actualizados'); else aviso('Debe tener al menos un rol') }} /> {NOMBRE_ROL[r]}</label>
                    ))}</div>
                  </td>
                  <td><span className={'pill ' + (u.activo ? 'ok' : 'warn')}>{u.activo ? 'Activo' : 'Desactivado'}</span></td>
                  <td className="acc">
                    <button className="btn sec sm" type="button" onClick={() => nuevaClave(u)}>Cambiar clave</button>{' '}
                    {!yoMismo && <button className={'btn sm ' + (u.activo ? 'danger' : 'sec')} type="button" onClick={() => cambiar('/usuarios/' + u.id + '/activo', { activo: !u.activo }, u.activo ? 'Usuario desactivado' : 'Usuario activado')}>{u.activo ? 'Desactivar' : 'Activar'}</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
