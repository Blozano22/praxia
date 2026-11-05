import { useCallback, useEffect, useRef, useState } from 'react'
import Dashboard from './components/Dashboard.jsx'
import PortalSyllabus from './components/PortalSyllabus.jsx'
import Workspace from './components/Workspace.jsx'
import Editor from './components/Editor.jsx'
import EntradaManual from './components/EntradaManual.jsx'
import Login from './components/Login.jsx'
import { LEMA, Praxia } from './components/Marca.jsx'
import Plantillas from './components/Plantillas.jsx'
import Seguimiento from './components/Seguimiento.jsx'
import Usuarios from './components/Usuarios.jsx'
import { api } from './lib/api.js'
import { borrar, borrarLocal, guardar, locales, todos } from './lib/store.js'
import { uid } from './lib/util.js'

export default function App() {
  const [yo, setYo] = useState(undefined) // undefined = comprobando · null = sin sesión · objeto = con sesión
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

  useEffect(() => { api('GET', '/auth/yo').then(setYo).catch(() => setYo(null)) }, [])

  // Con sesión iniciada se cargan SOLO los syllabus de esta persona (el servidor no entrega otros).
  useEffect(() => {
    if (!yo) return
    setCargado(false)
    if (!yo.permisos.includes('proyectos.ver_propios')) { setVista('usuarios'); setCargado(true); return }
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

  const actual = lista.find((s) => s.id === actualId)
  const programas = [...new Set(lista.map((s) => s.programa))].filter((p) => p !== 'Sin programa')

  // Guarda el resultado del generador (igual al portal). Devuelve el id para poder nombrarlo después.
  const crearSyllabus = (d) => {
    const s = {
      id: uid(), programa: d.programa || 'Sin programa', curso: d.curso || 'Syllabus sin nombre (' + new Date().toLocaleDateString() + ')',
      syllabusUrl: d.syllabusUrl, carpetaUrl: d.carpetaUrl, creado: Date.now(),
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
      id: uid(), programa: d.programa || 'Sin programa', curso: d.curso, syllabusUrl: d.syllabusUrl, carpetaUrl: d.carpetaUrl || '', creado: Date.now(),
      syllabus: { estado: 'listo', documentos: d.documentos, mensaje: '' }, recursos: [], guiones: [], info: {}
    }
    actualizar(s)
    setActualId(s.id); setTab('unidades'); setRecSel({ u: null })
    setPendInicial(cola && cola.length ? cola : null)
    setUnidadSel(destino === 'guiones' && cola && cola.length ? cola[0].unidad : null)
    ir('workspace')
  }
  const abrir = (id) => { setActualId(id); setTab('syllabus'); setUnidadSel(null); setRecSel({ u: null }); ir('workspace') }

  if (yo === undefined) return null
  if (yo === null) return <Login onEntro={() => api('GET', '/auth/yo').then(setYo).catch(() => setYo(null))} />
  const puedeVer = yo.permisos.includes('proyectos.ver_propios')
  const esAdmin = yo.permisos.includes('usuarios.gestionar')
  const veTodos = yo.permisos.includes('proyectos.ver_todos') // coordinación: ve el avance de todos los cursos

  return (
    <>
      <div className="top">
        <div className="brand" onClick={() => ir('dashboard')} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') ir('dashboard') }}><Praxia claro /><small>{LEMA}</small></div>
        <div className="sp" />
        {actual && vista !== 'dashboard' && <button className="btn sec sm" onClick={() => { setTab('syllabus'); ir('workspace') }}>{actual.curso.slice(0, 30)}</button>}
        <span className="quien" title={yo.correo}>{yo.nombre}<small>{yo.roles.map((r) => ({ admin: 'Administrador', coordinador: 'Coordinador', docente: 'Docente' })[r] || r).join(' · ')}</small></span>
        <button className="btn sec sm" onClick={salir}>Salir</button>
      </div>

      <div className="shell">
      <nav className="rail" aria-label="Menú principal">
        <h4>Menú</h4>
        {puedeVer && <button className={['dashboard', 'nuevo', 'workspace', 'editor'].includes(vista) ? 'on' : ''} onClick={() => ir('dashboard')}>Dashboard</button>}
        {veTodos && <button className={vista === 'seguimiento' ? 'on' : ''} onClick={() => ir('seguimiento')}>Seguimiento</button>}
        <button className={vista === 'plantillas' ? 'on' : ''} onClick={() => ir('plantillas')}>Plantillas HTML</button>
        {esAdmin && <button className={vista === 'usuarios' ? 'on' : ''} onClick={() => ir('usuarios')}>Usuarios</button>}
      </nav>
      <div className="shellmain">
      {vista === 'plantillas' && <Plantillas />}
      {vista === 'usuarios' && esAdmin && <Usuarios yo={yo} aviso={aviso} />}
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
        <Dashboard lista={lista} onNuevo={() => ir('nuevo')}
          onAbrir={(id) => { setActualId(id); setTab('syllabus'); setUnidadSel(null); setRecSel({ u: null }); ir('workspace') }}
          onEliminar={async (s) => { await borrar(s.id); setLista((l) => l.filter((x) => x.id !== s.id)); aviso('Syllabus eliminado') }} />
      )}
      {vista === 'nuevo' && (
        <div className="wrapx fade">
          <div className="crumbs"><button className="lnk" onClick={() => ir('dashboard')}>Dashboard</button> › <b>Crear unidades</b></div>
          <h1>Crear unidades desde el syllabus</h1>
          <p className="lead">Empiece por donde va: puede generar las unidades desde el syllabus, o entrar directo con las unidades o los guiones que ya tiene.</p>
          <div className="stepper2" role="tablist" style={{ marginBottom: 18 }}>
            {[['syllabus', '1', 'Empezar desde cero', 'Solo tengo el syllabus'], ['avance', '2', 'Cargar trabajo adelantado', 'Ya tengo unidades o guiones']].map(([k, n, t, sub]) => (
              <button key={k} role="tab" className={entrada === k ? 'on' : ''} onClick={() => setEntrada(k)}><i>{n}</i><span><b>{t}</b><small>{sub}</small></span></button>
            ))}
          </div>
          {entrada === 'syllabus'
            ? <PortalSyllabus onResultado={crearSyllabus} onNombrar={nombrar} onAbrir={abrir} />
            : <EntradaManual onCrear={crearManual} />}
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
