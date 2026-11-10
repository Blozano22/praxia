import { useCallback, useEffect, useRef, useState } from 'react'
import Dashboard from './components/Dashboard.jsx'
import PortalSyllabus from './components/PortalSyllabus.jsx'
import Workspace from './components/Workspace.jsx'
import Editor from './components/Editor.jsx'
import PortalUnidades from './components/PortalUnidades.jsx'
import Login from './components/Login.jsx'
import { LEMA, Praxia } from './components/Marca.jsx'
import Bibliografia from './components/Bibliografia.jsx'
import Plantillas from './components/Plantillas.jsx'
import Seguimiento from './components/Seguimiento.jsx'
import Usuarios from './components/Usuarios.jsx'
import { fijarAnfitrion } from './lib/trabajosGuiones.js'
import Conexiones from './components/Conexiones.jsx'
import Titulo from './components/Titulo.jsx'
import { api } from './lib/api.js'
import { NOMBRE_ROL, resumenRoles } from './lib/roles.js'
import { borrar, borrarLocal, guardar, locales, todos } from './lib/store.js'
import { uid } from './lib/util.js'

// Opción del menú lateral: icono + texto; con el menú contraído solo se ve el icono y el texto queda como etiqueta.
function ItemMenu({ on, icono, texto, onClick }) {
  return (
    <button className={on ? 'on' : ''} onClick={onClick} title={texto} aria-label={texto} aria-current={on ? 'page' : undefined}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icono} /></svg>
      <span>{texto}</span>
    </button>
  )
}

export default function App() {
  const [yo, setYo] = useState(undefined) // undefined = comprobando · null = sin sesión · objeto = con sesión
  const [menuMin, setMenuMin] = useState(() => { try { return localStorage.getItem('praxia-menu') === 'min' } catch { return false } })
  const alternarMenu = () => setMenuMin((m) => { const n = !m; try { localStorage.setItem('praxia-menu', n ? 'min' : 'abierto') } catch { /* sin almacenamiento */ } return n })
  const [pendientesLocales, setPendientesLocales] = useState([])
  const [lista, setLista] = useState([])
  const [cargado, setCargado] = useState(false)
  const [vista, setVista] = useState('dashboard') // dashboard | nuevo | workspace | editor
  const [actualId, setActualId] = useState(null)
  const [tab, setTab] = useState('syllabus')
  const [recId, setRecId] = useState(null)
  const [unidadSel, setUnidadSel] = useState(null)
  const [recSel, setRecSel] = useState({ u: null })
  const [toast, setToast] = useState('')
  const [pendInicial, setPendInicial] = useState(null)
  const [entrada, setEntrada] = useState('syllabus') // syllabus | avance
  const ref = useRef([])
  ref.current = lista

  const [restaurado, setRestaurado] = useState(false)

  // La pantalla en que está se guarda en la dirección (#/...): al actualizar la página se queda donde estaba.
  //   #/dashboard · #/nuevo · #/seguimiento · #/plantillas · #/bibliografia · #/usuarios
  //   #/syllabus/<id>/<paso>[/<unidad>] · #/editor/<id>/<recurso>
  useEffect(() => {
    if (!yo || !cargado || restaurado) return
    const p = location.hash.replace(/^#\/?/, '').split('/').map((x) => { try { return decodeURIComponent(x) } catch { return x } })
    const perm = (c) => yo.permisos.includes(c)
    const proy = ref.current.find((x) => x.id === p[1])
    if (p[0] === 'syllabus' && proy) {
      setActualId(proy.id); setTab(['syllabus', 'docs', 'unidades', 'recursos'].includes(p[2]) ? p[2] : 'syllabus'); setUnidadSel(p[3] ? (Number(p[3]) || null) : null); setVista('workspace')
    } else if (p[0] === 'editor' && proy && proy.recursos.some((r) => r.id === p[2])) {
      setActualId(proy.id); setRecId(p[2]); setVista('editor')
    } else if (['dashboard', 'nuevo'].includes(p[0]) && perm('proyectos.ver_propios')) setVista(p[0])
    else if (p[0] === 'plantillas' && perm('plantillas.ver')) setVista('plantillas')
    else if (p[0] === 'seguimiento' && perm('proyectos.ver_todos')) setVista('seguimiento')
    else if (p[0] === 'bibliografia' && perm('usuarios.gestionar')) setVista('bibliografia')
    else if (p[0] === 'usuarios' && perm('usuarios.gestionar')) setVista('usuarios')
    else if (p[0] === 'conexion' && perm('usuarios.gestionar')) setVista('conexion')
    setRestaurado(true)
  }, [yo, cargado, restaurado])

  useEffect(() => {
    if (!restaurado || location.hash === '#config') return
    let h = '#/' + vista
    if (vista === 'workspace' && actualId) h = '#/syllabus/' + actualId + '/' + tab + (unidadSel != null ? '/' + unidadSel : '')
    else if (vista === 'editor' && actualId && recId) h = '#/editor/' + actualId + '/' + recId
    if (location.hash !== h) history.replaceState(null, '', h)
  }, [restaurado, vista, actualId, tab, unidadSel, recId])

  useEffect(() => { api('GET', '/auth/yo').then(setYo).catch(() => setYo(null)) }, [])

  // Con sesión iniciada se cargan SOLO los syllabus de esta persona (el servidor no entrega otros).
  useEffect(() => {
    if (!yo) return
    setCargado(false)
    if (!yo.permisos.includes('proyectos.ver_propios')) { setVista(yo.permisos.includes('usuarios.gestionar') ? 'usuarios' : 'plantillas'); setCargado(true); return }
    todos().then((l) => setLista(l.sort((a, b) => b.creado - a.creado))).catch(() => {}).finally(() => setCargado(true))
    locales().then(setPendientesLocales)
  }, [yo])

  const importarLocales = async () => {
    for (const p of pendientesLocales) { await guardar(p); await borrarLocal(p.id) }
    setLista((await todos()).sort((a, b) => b.creado - a.creado))
    setPendientesLocales([])
    aviso('Syllabus importados a tu cuenta')
  }
  const salir = async () => { try { await api('POST', '/auth/logout') } catch { /* la sesión ya no existía */ } setLista([]); setYo(null); setVista('dashboard') }

  const aviso = useCallback((t) => { setToast(t); setTimeout(() => setToast(''), 2400) }, [])
  const ir = (v) => { if (v !== 'workspace' && v !== 'editor') setPendInicial(null); setVista(v); window.scrollTo(0, 0) }

  // Guarda un syllabus (y todo lo que contiene) en pantalla y en el navegador.
  const actualizar = useCallback((s) => {
    const l = ref.current.some((x) => x.id === s.id) ? ref.current.map((x) => (x.id === s.id ? s : x)) : [s, ...ref.current]
    ref.current = l
    setLista(l)
    guardar(s).catch((e) => { if (e.estado === 401) setYo(null); else aviso('No se pudo guardar: ' + e.message) })
  }, [aviso])

  // Las generaciones de guiones en curso guardan su resultado aquí aunque ya se haya salido de la unidad.
  useEffect(() => { fijarAnfitrion({ obtener: (id) => ref.current.find((x) => x.id === id) || null, guardar: actualizar }) }, [actualizar])

  const actual = lista.find((s) => s.id === actualId)
  const programas = [...new Set(lista.map((s) => s.programa))].filter((p) => p !== 'Sin programa')

  // Guarda el resultado del generador (igual al portal). Devuelve el id para poder nombrarlo después.
  const crearSyllabus = (d) => {
    const s = {
      id: uid(), programa: d.programa || 'Sin programa', curso: d.curso || 'Syllabus sin nombre (' + new Date().toLocaleDateString() + ')',
      syllabusUrl: d.syllabusUrl, carpetaUrl: d.carpetaUrl, creado: Date.now(),
      bibliografiaId: d.bibliografiaId || '', // lectura de la bibliografía de este syllabus: de ahí salen las fuentes de los guiones
      syllabus: { estado: d.estado, documentos: d.documentos, mensaje: d.mensaje }, recursos: [], guiones: [], info: {}
    }
    actualizar(s)
    return s.id
  }
  const nombrar = (id, programa, curso) => {
    const s = ref.current.find((x) => x.id === id)
    if (s && (programa || curso)) actualizar({ ...s, programa: programa || s.programa, curso: curso || s.curso })
  }
  // Entrada con avance: el syllabus nace con sus unidades ya aprobadas y se abre en el paso que sigue.
  const crearManual = (d, destino, cola) => {
    const s = {
      id: uid(), programa: d.programa || 'Sin programa', curso: d.curso, syllabusUrl: d.syllabusUrl, carpetaUrl: d.carpetaUrl || '', creado: Date.now(), bibliografiaId: d.bibliografiaId || '',
      syllabus: { estado: 'listo', documentos: d.documentos, mensaje: '' }, recursos: [], guiones: [], info: {}
    }
    actualizar(s)
    setActualId(s.id); setTab('unidades'); setRecSel({ u: null })
    setPendInicial(cola && cola.length ? cola : null)
    setUnidadSel(destino === 'guiones' && cola && cola.length ? cola[0].unidad : null)
    ir('workspace')
  }
  const abrir = (id, paso = 'syllabus') => { setActualId(id); setTab(paso); setUnidadSel(null); setRecSel({ u: null }); ir('workspace') }

  if (yo === undefined) return null
  if (yo === null) return <Login onEntro={() => api('GET', '/auth/yo').then(setYo).catch(() => setYo(null))} />
  const puedeVer = yo.permisos.includes('proyectos.ver_propios')
  const esAdmin = yo.permisos.includes('usuarios.gestionar')
  const verPlantillas = yo.permisos.includes('plantillas.ver')
  const veTodos = yo.permisos.includes('proyectos.ver_todos') // coordinación: ve el avance de todos los cursos

  return (
    <>
      <div className={'top' + (actual && vista !== 'dashboard' ? ' con-curso' : '')}>
        <svg className="top-curva" aria-hidden="true" width="130" height="68" viewBox="0 0 130 68"><path d="M0 68C50 62 88 38 93 0H123C112 50 70 68 0 68Z" fill="#d7ff1e" /></svg>
        <div className="brand" onClick={() => ir('dashboard')} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') ir('dashboard') }}><Praxia claro /><small>{LEMA}</small></div>
        <div className="sp" />
        {actual && vista !== 'dashboard' && <button className="btn sec sm" onClick={() => { setTab('syllabus'); ir('workspace') }}>{actual.curso.slice(0, 30)}</button>}
        <span className="quien" title={yo.correo}>
          <span className="quien-av" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" /></svg></span>
          <span className="quien-tx">{yo.nombre}<small title={resumenRoles(yo.roles).todos}>{NOMBRE_ROL[resumenRoles(yo.roles).principal]}{resumenRoles(yo.roles).otros > 0 && <i className="quien-mas">+{resumenRoles(yo.roles).otros}</i>}</small></span>
        </span>
        <button className="btn sec sm salir" onClick={salir}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9" /></svg>Salir</button>
      </div>

      <div className={'shell' + (menuMin ? ' min' : '')}>
      <nav className="rail" aria-label="Menú principal">
        <svg className="rail-ola" aria-hidden="true" viewBox="0 0 238 190" preserveAspectRatio="none"><path d="M0 70C50 70 80 120 130 150S210 175 238 190H0Z" fill="#0a6b5c" opacity=".55" /><path d="M0 120C40 112 70 135 105 160S180 185 238 190H0Z" fill="#7fbf2a" opacity=".75" /><path d="M0 150C40 148 70 165 100 190H0Z" fill="#d7ff1e" /></svg>
        <button className="rail-tog" aria-label={menuMin ? 'Expandir el menú' : 'Contraer el menú'} aria-expanded={!menuMin} onClick={alternarMenu}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={menuMin ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} /></svg>
          <span>Menú</span>
        </button>
        {puedeVer && <ItemMenu on={['dashboard', 'nuevo', 'workspace', 'editor'].includes(vista)} icono="M3 11l9-8 9 8M5 10v10h14V10" texto="Dashboard" onClick={() => ir('dashboard')} />}
        {veTodos && <ItemMenu on={vista === 'seguimiento'} icono="M4 19V9M10 19V5M16 19v-7M22 19H2" texto="Seguimiento" onClick={() => ir('seguimiento')} />}
        {esAdmin && <ItemMenu on={vista === 'bibliografia'} icono="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z" texto="Bibliografía" onClick={() => ir('bibliografia')} />}
        {verPlantillas && <ItemMenu on={vista === 'plantillas'} icono="M8 7l-5 5 5 5M16 7l5 5-5 5" texto="Plantillas HTML" onClick={() => ir('plantillas')} />}
        {esAdmin && <ItemMenu on={vista === 'conexion'} icono="M9 7V3M15 7V3M7 7h10v4a5 5 0 01-10 0V7zM12 16v5" texto="Conexión n8n" onClick={() => ir('conexion')} />}
        {esAdmin && <ItemMenu on={vista === 'usuarios'} icono="M16 20v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1M10 11a3 3 0 100-6 3 3 0 000 6" texto="Usuarios" onClick={() => ir('usuarios')} />}
      </nav>
      <div className="shellmain">
      {vista === 'plantillas' && verPlantillas && <Plantillas />}
      {vista === 'bibliografia' && esAdmin && <Bibliografia lista={lista} />}
      {vista === 'usuarios' && esAdmin && <Usuarios yo={yo} aviso={aviso} />}
      {vista === 'conexion' && esAdmin && <Conexiones aviso={aviso} />}
      {vista === 'seguimiento' && veTodos && <Seguimiento />}
      {vista === 'dashboard' && cargado && pendientesLocales.length > 0 && (
        <div className="wrapx" style={{ paddingBottom: 0 }}>
          <div className="msg info" style={{ marginBottom: 0 }}>
            Hay <b>{pendientesLocales.length}</b> syllabus guardados antes en este navegador. ¿Quieres pasarlos a tu cuenta?{' '}
            <button className="btn sm" style={{ marginLeft: 8 }} onClick={importarLocales}>Importar a mi cuenta</button>
          </div>
        </div>
      )}

      {vista === 'dashboard' && cargado && (
        <Dashboard lista={lista} onNuevo={() => { setEntrada('syllabus'); ir('nuevo') }}
          onAbrir={(id) => { setActualId(id); setTab('syllabus'); setUnidadSel(null); setRecSel({ u: null }); ir('workspace') }}
          onEliminar={async (s) => { await borrar(s.id); setLista((l) => l.filter((x) => x.id !== s.id)); aviso('Syllabus eliminado') }} />
      )}
      {vista === 'nuevo' && (
        <div className="wrapx fade">
          <div className="crumbs"><button className="lnk" onClick={() => ir('dashboard')}>Dashboard</button> › <b>Nuevo curso</b></div>
          <Titulo icono="nuevo">
            <h1>Nuevo curso</h1>
            <p className="lead">Elija cómo empezar: crear las unidades desde el syllabus o continuar con unidades que ya existen.</p>
          </Titulo>
          <div className="modo-sel" role="radiogroup" aria-label="Cómo empezar">
            {[['syllabus', 'Desde el syllabus', 'Se leen las referencias y n8n crea un documento por unidad.', 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M12 11v6M9 14h6'],
              ['unidades', 'Curso con unidades ya creadas', 'Ya existen los documentos: solo se montan sus enlaces en el curso.', 'M10 13.5a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.7 1.7M14 10.5a4 4 0 00-5.7 0l-3 3A4 4 0 0011 19.2l1.7-1.7']].map(([k, t, d, ic]) => (
              <label key={k} className="rol modo">
                <input type="radio" name="modo-nuevo" checked={entrada === k} onChange={() => setEntrada(k)} />
                <span className="rol-ic r-docente"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ic} /></svg></span>
                <span className="rol-tx"><b>{t}</b><small>{d}</small></span>
                <span className="rol-ck"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg></span>
              </label>
            ))}
          </div>
          {entrada === 'unidades'
            ? <PortalUnidades key="unidades" onCrear={crearManual} />
            : <PortalSyllabus key="syllabus" onResultado={crearSyllabus} onNombrar={nombrar} onAbrir={abrir} />}
        </div>
      )}
      {vista === 'workspace' && actual && (
        <Workspace key={actual.id + (pendInicial ? '-p' : '')} pendInicial={pendInicial} s={actual} tab={tab} setTab={setTab} unidadSel={unidadSel} setUnidadSel={setUnidadSel} recSel={recSel} setRecSel={setRecSel} aviso={aviso}
          onCambio={actualizar} onVolver={() => ir('dashboard')}
          onEditar={(id) => { setRecId(id); ir('editor') }} />
      )}
      {vista === 'editor' && actual && actual.recursos.find((r) => r.id === recId) && (
        <Editor key={recId} recurso={actual.recursos.find((r) => r.id === recId)} proyecto={actual} aviso={aviso}
          onGuardar={(r) => { const s = ref.current.find((x) => x.id === actual.id); if (s) actualizar({ ...s, recursos: s.recursos.map((x) => (x.id === r.id ? r : x)) }) }}
          onVolver={() => { setTab('recursos'); ir('workspace') }} />
      )}
      </div>
      </div>
      {toast && <div className="toast-app">{toast}</div>}
    </>
  )
}
