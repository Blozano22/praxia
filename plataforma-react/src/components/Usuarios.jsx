import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api.js'

import { NOMBRE_ROL, ORDEN_ROLES as ROLES, resumenRoles } from '../lib/roles.js'
const DETALLE_ROL = {
  admin: 'Gestiona cuentas, roles y auditoría',
  coordinador: 'Crea syllabus y ve el avance de todos',
  docente: 'Crea y edita sus propios syllabus',
  disenador: 'Solo ve las plantillas HTML'
}

const alternar = (lista, r) => (lista.includes(r) ? lista.filter((x) => x !== r) : [...lista, r])
const iniciales = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
// El color de cada avatar sigue al rol principal de la persona.
const rolPrincipal = (roles) => resumenRoles(roles).principal

const Svg = ({ children, size = 20, sw = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const ICONO = {
  admin: <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></>,
  coordinador: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20v-1a4.5 4.5 0 014.5-4.5h3A4.5 4.5 0 0115 19v1M16 5.5a3 3 0 010 5.5M21 20v-1a4 4 0 00-3-3.8" /></>,
  docente: <><path d="M2 9l10-5 10 5-10 5L2 9z" /><path d="M6 11.5V16c0 1.2 2.7 3 6 3s6-1.8 6-3v-4.5M22 9v5" /></>,
  disenador: <><path d="M12 3a9 9 0 100 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>
}
const IconoRol = ({ r, size = 20 }) => <Svg size={size}>{ICONO[r]}</Svg>

// Selector de roles en tarjetas (formulario de nuevo usuario).
function SelectorRoles({ valor, onCambio }) {
  return (
    <fieldset className="us-roles">
      <legend>Roles <small>Puedes asignar más de uno; los permisos se suman.</small></legend>
      <div className="us-roles-grid">
        {ROLES.map((r) => (
          <label key={r} className="rol">
            <input type="checkbox" checked={valor.includes(r)} onChange={() => onCambio(alternar(valor, r))} />
            <span className={'rol-ic r-' + r}><IconoRol r={r} size={22} /></span>
            <span className="rol-tx"><b>{NOMBRE_ROL[r]}</b><small>{DETALLE_ROL[r]}</small></span>
            <span className="rol-ck"><Svg size={14} sw={3.2}><path d="M5 12.5l4.5 4.5L19 7" /></Svg></span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

// Menú flotante para cambiar los roles de una persona ya creada.
function MenuRoles({ u, ancla, onCambio, onCerrar }) {
  const caja = useRef(null)
  const [pos, setPos] = useState(null)
  useEffect(() => {
    const r = ancla.getBoundingClientRect()
    const ancho = 260
    setPos({ top: Math.min(r.bottom + 6, window.innerHeight - 270), left: Math.max(12, Math.min(r.right - ancho, window.innerWidth - ancho - 12)) })
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target) && !ancla.contains(e.target)) onCerrar() }
    const tecla = (e) => { if (e.key === 'Escape') { onCerrar(); ancla.focus() } }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    window.addEventListener('resize', onCerrar)
    window.addEventListener('scroll', onCerrar, true)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); window.removeEventListener('resize', onCerrar); window.removeEventListener('scroll', onCerrar, true) }
  }, [ancla, onCerrar])
  if (!pos) return null
  return (
    <div className="us-pop" ref={caja} role="group" aria-label={'Roles de ' + u.nombre} style={pos}>
      <h5>ROLES</h5>
      {ROLES.map((r) => (
        <label key={r}>
          <input type="checkbox" checked={u.roles.includes(r)} onChange={() => onCambio(alternar(u.roles, r))} />
          <span className={'mini r-' + r}><IconoRol r={r} size={15} /></span>{NOMBRE_ROL[r]}
        </label>
      ))}
      <div className="fin">Los cambios se guardan al marcar.</div>
    </div>
  )
}

// Ventana para editar nombre y correo de una persona.
function EditarDatos({ u, onGuardado, onCerrar }) {
  const [f, setF] = useState({ nombre: u.nombre, correo: u.correo })
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const nom = useRef(null)
  useEffect(() => {
    nom.current && nom.current.focus()
    const tecla = (e) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [onCerrar])
  const sinCambios = f.nombre.trim() === u.nombre && f.correo.trim().toLowerCase() === u.correo.toLowerCase()
  const guardar = async (e) => {
    e.preventDefault()
    setError(''); setOcupado(true)
    try { await api('PATCH', '/usuarios/' + u.id + '/datos', { nombre: f.nombre.trim(), correo: f.correo.trim() }); onGuardado() } catch (err) { setError(err.message); setOcupado(false) }
  }
  return (
    <div className="us-modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
      <form className="us-card us-modal" role="dialog" aria-modal="true" aria-labelledby="us-ed-t" onSubmit={guardar} noValidate>
        <div className="us-mod-cab">
          <span className="us-ico sm"><Svg size={22}><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></Svg></span>
          <div className="us-mod-tx">
            <h2 id="us-ed-t">Editar datos</h2>
            <p>Cambia el nombre y el correo con el que {u.nombre.split(' ')[0]} inicia sesión.</p>
          </div>
          <button type="button" className="us-mod-x" aria-label="Cerrar" onClick={onCerrar}><Svg size={18}><path d="M6 6l12 12M18 6L6 18" /></Svg></button>
        </div>
        <div className="us-campos us-una">
          <Campo id="ed-nombre" etiqueta="Nombre" icono={<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" /></>}>
            <input id="ed-nombre" ref={nom} type="text" autoComplete="off" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
          </Campo>
          <Campo id="ed-correo" etiqueta="Correo" icono={<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7l8.5 6 8.5-6" /></>}>
            <input id="ed-correo" type="text" inputMode="email" autoComplete="off" value={f.correo} onChange={(e) => setF({ ...f, correo: e.target.value })} />
          </Campo>
        </div>
        {error && <div className="msg bad" role="alert" style={{ marginTop: 14 }}>{error}</div>}
        <div className="us-acciones us-mod-pie">
          <button className="btn sec" type="button" onClick={onCerrar}>Cancelar</button>
          <button className="btn" type="submit" disabled={ocupado || sinCambios || f.nombre.trim().length < 2 || !f.correo.trim()}>{ocupado ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </form>
    </div>
  )
}

const MOTIVO_PROPIA = 'No puedes hacerlo en tu propia cuenta'

// Botón solo con icono: el nombre va como etiqueta de accesibilidad y como aviso al pasar el cursor.
// Si la acción no está permitida sigue visible, pero en gris y sin efecto.
function BotonIcono({ texto, etiqueta, tipo = '', desactivado = false, motivo = '', abierto, onClick, children }) {
  return (
    <button type="button" className={'us-bi ' + (desactivado ? 'off' : tipo)} aria-label={etiqueta || texto} title={desactivado ? motivo : texto}
      aria-disabled={desactivado || undefined} aria-expanded={abierto === undefined ? undefined : !!abierto} aria-haspopup={abierto === undefined ? undefined : 'true'}
      data-abierto={abierto ? 'true' : undefined} onClick={desactivado ? undefined : onClick}>{children}</button>
  )
}

const Campo = ({ id, etiqueta, icono, children, nota }) => (
  <div>
    <label className="us-lab" htmlFor={id}>{etiqueta}</label>
    <div className="us-fld"><Svg size={19}>{icono}</Svg>{children}</div>
    {nota && <div className="us-nota">{nota}</div>}
  </div>
)

export default function Usuarios({ yo, aviso, onYo }) {
  const [lista, setLista] = useState([])
  const [form, setForm] = useState({ nombre: '', correo: '', clave: '', roles: ['docente'] })
  const [verClave, setVerClave] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [menu, setMenu] = useState(null) // { id, ancla }
  const [editando, setEditando] = useState(null) // id de la persona cuyo nombre/correo se edita
  const cerrarMenu = useCallback(() => setMenu(null), [])

  const cargar = useCallback(() => api('GET', '/usuarios').then(setLista).catch(() => setError('No se pudo cargar la lista')), [])
  useEffect(() => { cargar() }, [cargar])

  const crear = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api('POST', '/usuarios', form)
      setForm({ nombre: '', correo: '', clave: '', roles: ['docente'] })
      setVerClave(false)
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
  const cambiarRoles = (u, nuevos) => {
    if (!nuevos.length) { aviso('Debe tener al menos un rol'); return }
    cambiar('/usuarios/' + u.id + '/roles', { roles: nuevos }, 'Roles actualizados')
  }

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    return lista.filter((u) => (filtro === 'todos' || u.roles.includes(filtro)) && (!t || u.nombre.toLowerCase().includes(t) || u.correo.toLowerCase().includes(t)))
  }, [lista, q, filtro])
  const usuarioMenu = menu && lista.find((u) => u.id === menu.id)

  return (
    <div className="wrapx fade us">
      <div className="us-cab">
        <span className="us-ico"><Svg size={28}>{ICONO.coordinador}</Svg></span>
        <div>
          <h1>Usuarios</h1>
          <p className="lead">Cada usuario trabaja solo con los syllabus que él mismo crea. El administrador gestiona las cuentas y los roles, pero no ve el contenido de los demás.</p>
        </div>
      </div>

      <form className="us-card us-form" onSubmit={crear}>
        <div className="us-card-cab">
          <span className="us-ico sm"><Svg size={22}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20v-1a5 5 0 015-5h3a5 5 0 015 5v1M19 8v6M16 11h6" /></Svg></span>
          <h2>Nuevo usuario</h2>
        </div>
        <div className="us-campos">
          <Campo id="u-nombre" etiqueta="Nombre" icono={<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" /></>}>
            <input id="u-nombre" type="text" placeholder="Ingresa el nombre" autoComplete="off" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          </Campo>
          <Campo id="u-correo" etiqueta="Correo" icono={<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7l8.5 6 8.5-6" /></>}>
            <input id="u-correo" type="text" inputMode="email" placeholder="ejemplo@demo.co" autoComplete="off" value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} />
          </Campo>
          <Campo id="u-clave" etiqueta="Clave inicial" nota="10 o más caracteres, con mayúscula, minúscula y número."
            icono={<><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 018 0v3" /></>}>
            <input id="u-clave" className="con-ojo" type={verClave ? 'text' : 'password'} placeholder="Define una clave inicial" autoComplete="new-password" value={form.clave} onChange={(e) => setForm({ ...form, clave: e.target.value })} />
            <button type="button" className="us-ojo" aria-label={verClave ? 'Ocultar la clave' : 'Mostrar la clave'} aria-pressed={verClave} onClick={() => setVerClave((v) => !v)}>
              <Svg size={20}>{verClave ? <><path d="M3 3l18 18M10.6 5.1A9.6 9.6 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.4 6.4A17 17 0 002 12s3.5 7 10 7a9.7 9.7 0 004.1-.9" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></> : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>}</Svg>
            </button>
          </Campo>
        </div>

        <SelectorRoles valor={form.roles} onCambio={(roles) => setForm({ ...form, roles })} />

        {error && <div className="msg bad" role="alert" style={{ marginTop: 16 }}>{error}</div>}
        <div className="us-acciones">
          <button className="btn ico" type="submit" disabled={!form.nombre || !form.correo || !form.clave || !form.roles.length}>
            <Svg size={18}><path d="M12 5v14M5 12h14" /></Svg>Crear usuario
          </button>
          {!form.roles.length && <span className="help">Elige al menos un rol.</span>}
        </div>
      </form>

      <section className="us-card" aria-labelledby="us-lista-t">
        <div className="us-lista-cab us-card-cab">
          <span className="us-ico sm"><Svg size={22}>{ICONO.coordinador}</Svg></span>
          <h2 id="us-lista-t">Personas con acceso</h2>
          <span className="us-cuenta" aria-label={lista.length + ' personas'}>{lista.length}</span>
          <div className="us-tools">
            <div className="us-buscar">
              <Svg size={18}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></Svg>
              <input type="search" placeholder="Buscar por nombre o correo…" aria-label="Buscar personas" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="us-filtro" aria-label="Filtrar por rol" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              <option value="todos">Todos los roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
            </select>
          </div>
        </div>

        <div className="us-tabla-caja">
          <table className="tabla us-tabla">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Roles</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              {visibles.map((u) => {
                const yoMismo = yo.id ? u.id === yo.id : u.correo === yo.correo
                return (
                  <tr key={u.id} className={u.activo ? '' : 'inactivo'}>
                    <td>
                      <div className="us-nom">
                        <span className={'us-av r-' + rolPrincipal(u.roles)} aria-hidden="true">{iniciales(u.nombre)}</span>
                        <span><b>{u.nombre}</b>{yoMismo && <span className="us-tu">Tú</span>}</span>
                      </div>
                    </td>
                    <td>{u.correo}</td>
                    <td>
                      <div className="us-roles-celda" aria-label={'Roles de ' + u.nombre}>
                        {(() => { const { principal, otros, todos } = resumenRoles(u.roles); return (
                          <>
                            <span className={'us-chip r-' + principal} title={otros ? todos : undefined}><IconoRol r={principal} size={15} />{NOMBRE_ROL[principal]}</span>
                            {otros > 0 && <span className="us-chip us-mas" title={todos} aria-label={'y ' + otros + ' rol' + (otros > 1 ? 'es' : '') + ' más: ' + todos}>+{otros}</span>}
                          </>) })()}
                      </div>
                    </td>
                    <td><span className={'us-chip estado ' + (u.activo ? 'on' : 'off')}>{u.activo ? 'Activo' : 'Desactivado'}</span></td>
                    <td>
                      <div className="us-acc">
                        <BotonIcono texto="Editar nombre y correo" etiqueta={'Editar el nombre y el correo de ' + u.nombre} onClick={() => { setMenu(null); setEditando(u.id) }}>
                          <Svg size={17} sw={1.9}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20v-1a5 5 0 015-5h2M14 21l1-4 5.5-5.5a1.4 1.4 0 012 2L17 19l-3 2z" /></Svg>
                        </BotonIcono>
                        <BotonIcono texto="Editar roles" desactivado={yoMismo} motivo={MOTIVO_PROPIA} abierto={menu?.id === u.id}
                          etiqueta={'Editar los roles de ' + u.nombre}
                          onClick={(e) => setMenu(menu?.id === u.id ? null : { id: u.id, ancla: e.currentTarget })}>
                          <Svg size={17} sw={1.9}><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></Svg>
                        </BotonIcono>
                        <BotonIcono texto="Cambiar clave" etiqueta={'Cambiar la clave de ' + u.nombre} onClick={() => nuevaClave(u)}>
                          <Svg size={17} sw={1.9}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></Svg>
                        </BotonIcono>
                        <BotonIcono texto={u.activo ? 'Desactivar' : 'Activar'} etiqueta={(u.activo ? 'Desactivar a ' : 'Activar a ') + u.nombre} tipo={u.activo ? 'peligro' : ''}
                          desactivado={yoMismo} motivo={MOTIVO_PROPIA}
                          onClick={() => cambiar('/usuarios/' + u.id + '/activo', { activo: !u.activo }, u.activo ? 'Usuario desactivado' : 'Usuario activado')}>
                          <Svg size={17} sw={1.9}>{u.activo ? <path d="M12 3v8M6.5 6.5a8 8 0 1011 0" /> : <path d="M5 12.5l4.5 4.5L19 7" />}</Svg>
                        </BotonIcono>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!visibles.length && <tr><td className="us-vacio" colSpan={5}>{lista.length ? 'Ninguna persona coincide con la búsqueda.' : 'Aún no hay personas con acceso.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editando && lista.find((u) => u.id === editando) && (
        <EditarDatos key={editando} u={lista.find((u) => u.id === editando)} onCerrar={() => setEditando(null)}
          onGuardado={() => { const propio = editando === yo.id; setEditando(null); aviso('Datos actualizados'); cargar(); if (propio && onYo) onYo() }} />
      )}
      {menu && usuarioMenu && <MenuRoles u={usuarioMenu} ancla={menu.ancla} onCambio={(n) => cambiarRoles(usuarioMenu, n)} onCerrar={cerrarMenu} />}
    </div>
  )
}
