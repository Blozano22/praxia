import { useEffect, useMemo, useRef, useState } from 'react'

// Botón «Revisión» de la galería + ventana con el conteo de plantillas revisadas y la lista para navegar entre ellas.
// «Mis plantillas» = las que subió la persona; «General» = todas (para que quien revisa vea qué falta).
// Una plantilla está «revisada» si quedó aprobada o rechazada; «piden cambios» y «corregida» siguen pendientes.
const ESTADOS = {
  aprobada: { texto: 'Aprobada', ico: '✓', fondo: '#e4f5ec', color: '#0a6b5c', pc: '#145c3b' },
  rechazada: { texto: 'Rechazada', ico: '×', fondo: '#fbe9e7', color: '#c43b32', pc: '#8c2620' },
  revision: { texto: 'Piden cambios', ico: '!', fondo: '#fff1c9', color: '#9a6a00', pc: '#6b4a00' },
  corregida: { texto: 'Corregida', ico: '↻', fondo: '#e8eefb', color: '#3957b8', pc: '#2a448f' },
  nada: { texto: 'Sin revisar', ico: '·', fondo: '#eef1f7', color: '#5b6783', pc: '#44506b' }
}
const hace = (c) => {
  if (!c) return ''
  const s = Math.max(0, Math.round((Date.now() - new Date(c).getTime()) / 1000))
  if (s < 3600) return 'hace ' + Math.max(1, Math.round(s / 60)) + ' min'
  if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h'
  const d = Math.round(s / 86400)
  return 'hace ' + d + (d === 1 ? ' día' : ' días')
}
const corta = (t, n = 90) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x }
const pendiente = (e) => e === 'nada' || e === 'corregida'

function contar(items) {
  const c = { total: items.length, aprobada: 0, rechazada: 0, revision: 0, corregida: 0, nada: 0 }
  items.forEach((i) => { c[i.estado]++ })
  c.rev = c.aprobada + c.rechazada
  c.faltan = c.total - c.rev
  c.falta = c.nada + c.corregida
  return c
}

export default function RevisionResumen({ items, clase = '', puedeRevisar, onIr, enHeader = false }) {
  const deQue = clase === 'actividad' ? 'actividades' : clase === 'recurso' ? 'recursos' : 'plantillas' // la revisión es de la clase que se está viendo
  const [abierto, setAbierto] = useState(false)
  const [vista, setVista] = useState(puedeRevisar ? 'general' : 'mias')
  const [filtro, setFiltro] = useState(puedeRevisar ? 'falta' : 'revision')
  const [cat, setCat] = useState('')
  const caja = useRef(null)
  const boton = useRef(null)
  const [pos, setPos] = useState({ top: 84, right: 24 }) // la ventana va FIJA en la pantalla (no se mueve con el scroll) y siempre debajo del encabezado
  const alternar = () => {
    if (!abierto && boton.current) {
      const r = boton.current.getBoundingClientRect()
      setPos({ top: Math.min(140, Math.max(84, Math.round(r.bottom + 10))), right: Math.max(12, Math.round(window.innerWidth - r.right)) })
    }
    setAbierto(!abierto)
  }
  useEffect(() => {
    if (!abierto) return undefined
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    const tecla = (e) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla) }
  }, [abierto])

  const mias = useMemo(() => items.filter((i) => i.propia), [items])
  const base = vista === 'mias' ? mias : items
  const c = useMemo(() => contar(base), [base])
  const cGeneral = useMemo(() => contar(items), [items])
  const cMias = useMemo(() => contar(mias), [mias])
  const sirveFiltro = (e) => (filtro === 'falta' ? pendiente(e) : e === filtro) // «falta» = sin revisar + corregidas; el resto, un estado
  const orden = vista === 'mias' ? { revision: 0, nada: 1, corregida: 2, rechazada: 3, aprobada: 4 } : { corregida: 0, nada: 1, revision: 2, rechazada: 3, aprobada: 4 }
  // Primero por estado (el orden de arriba) y, dentro de cada estado, la revisión más reciente primero; las que nadie ha revisado quedan en el orden de la galería.
  const fechaDe = (i) => { const t = i.rev && i.rev.creado ? new Date(i.rev.creado).getTime() : NaN; return Number.isNaN(t) ? null : t }
  const porEstadoYFecha = (a, b) => { const d = orden[a.estado] - orden[b.estado]; if (d) return d; const fa = fechaDe(a), fb = fechaDe(b); return fa !== null && fb !== null ? fb - fa : 0 }
  const filas = base.filter((i) => sirveFiltro(i.estado) && (!cat || i.cat === cat)).sort(porEstadoYFecha)
  const topCats = useMemo(() => {
    const m = {}
    items.forEach((i) => { if (i.cat && pendiente(i.estado)) { m[i.cat] = m[i.cat] || { id: i.cat, nombre: i.catNombre, n: 0 }; m[i.cat].n++ } })
    return Object.values(m).sort((a, b) => b.n - a.n).slice(0, 4)
  }, [items])

  // El botón muestra lo que le importa a cada rol: quien revisa, lo general; quien solo sube, lo suyo.
  const pie = puedeRevisar ? cGeneral : cMias
  const alerta = puedeRevisar ? cGeneral.faltan : cMias.revision
  const cambiar = (v) => { setVista(v); setFiltro(v === 'general' ? 'falta' : 'revision'); setCat('') }
  const ir = (i) => { setAbierto(false); onIr(i) }
  const primeraPorRevisar = base.filter((i) => pendiente(i.estado)).sort(porEstadoYFecha)[0]

  const detalle = (i) => {
    const quien = vista === 'general' && i.por ? ' · subida por ' + i.por : ''
    const r = i.rev
    if (i.estado === 'aprobada') return 'Aprobada por ' + (r.usuario || 'quien revisa') + ' ' + hace(r.creado) + quien
    if (i.estado === 'rechazada') return 'Rechazada por ' + (r.usuario || 'quien revisa') + (r.observacion ? ': ' + corta(r.observacion) : '') + ' · ' + hace(r.creado) + quien
    if (i.estado === 'revision') return (vista === 'mias' ? 'Pide cambios' : 'Se pidieron cambios') + (r.observacion ? ': «' + corta(r.observacion) + '»' : '') + ' · ' + hace(r.creado) + quien
    if (i.estado === 'corregida') return (vista === 'general' && i.por ? i.por : 'Se') + ' marcó como corregida ' + hace(r.creado) + ': falta revisarla de nuevo'
    return 'Aún nadie la ha revisado' + quien
  }
  const filtros = vista === 'general'
    ? [['falta', 'Faltan por revisar', c.falta, true], ['revision', 'Piden cambios', c.revision], ['corregida', 'Corregidas', c.corregida], ['rechazada', 'Rechazadas', c.rechazada], ['aprobada', 'Aprobadas', c.aprobada]]
    : [['revision', 'Piden cambios', c.revision, true], ['nada', 'Sin revisar', c.nada], ['corregida', 'Corregidas', c.corregida], ['rechazada', 'Rechazadas', c.rechazada], ['aprobada', 'Aprobadas', c.aprobada]]
  const pct = (n) => (c.total ? (n / c.total) * 100 : 0)

  return (
    <div className="rv2" ref={caja}>
      <button type="button" ref={boton} className={'btn rv2-btn' + (enHeader ? ' hd' : '') + (abierto ? ' on' : '')} aria-haspopup="dialog" aria-expanded={abierto} onClick={alternar}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0" /></svg>
        Revisión
        <span className="rv2-cuenta"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>{pie.rev}/{pie.total}</span>
        {alerta > 0 && <span className="rv2-alerta" title={puedeRevisar ? 'Faltan por revisar' : 'Piden cambios'} aria-label={alerta + (puedeRevisar ? ' faltan por revisar' : ' piden cambios')}>{alerta}</span>}
      </button>

      {abierto && (
        <div className="rv2-pop" role="dialog" aria-label="Revisión de plantillas" style={{ top: pos.top, right: pos.right, maxHeight: 'calc(100vh - ' + (pos.top + 16) + 'px)' }}>
          <div className="rv2-cab">
            <div><b>Revisión de plantillas</b><small>{vista === 'general' ? 'Todas las ' + (clase ? 'plantillas de ' + deQue : 'plantillas de la plataforma') + ': qué falta por revisar' : 'Las ' + cMias.total + ' de ' + deQue + ' que subiste y cómo van en la revisión'}</small></div>
            <button type="button" className="rv2-x" aria-label="Cerrar" onClick={() => setAbierto(false)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
          </div>

          <div className="rv2-vista" role="tablist" aria-label="Qué ver">
            <button type="button" role="tab" aria-selected={vista === 'mias'} className={vista === 'mias' ? 'on' : ''} onClick={() => cambiar('mias')}>Mis plantillas <small>{cMias.total}</small></button>
            <button type="button" role="tab" aria-selected={vista === 'general'} className={vista === 'general' ? 'on' : ''} onClick={() => cambiar('general')}>General <small>{cGeneral.total}</small></button>
          </div>

          <div className="rv2-conteo">
            <div className="rv2-num"><b>{c.rev}</b><span>de {c.total} ya fueron revisadas</span><strong>{c.total ? Math.round((c.rev / c.total) * 100) : 0}%</strong></div>
            <div className="rv2-barra" role="img" aria-label={c.rev + ' de ' + c.total + ' revisadas'}>
              <i style={{ width: pct(c.aprobada) + '%', background: '#0a6b5c' }} /><i style={{ width: pct(c.rechazada) + '%', background: '#c43b32' }} /><i style={{ width: pct(c.revision) + '%', background: '#e0a100' }} /><i style={{ width: pct(c.corregida) + '%', background: '#5a7bd6' }} />
            </div>
            <div className="rv2-ley">
              <span><i style={{ background: '#0a6b5c' }} /><b>{c.aprobada}</b> aprobadas</span>
              <span><i style={{ background: '#c43b32' }} /><b>{c.rechazada}</b> rechazadas</span>
              <span><i style={{ background: '#e0a100' }} /><b>{c.revision}</b> piden cambios</span>
              <span><i style={{ background: '#5a7bd6' }} /><b>{c.corregida}</b> corregidas</span>
              <span><i style={{ background: '#aab4c8' }} /><b>{c.nada}</b> sin revisar</span>
            </div>
          </div>

          {vista === 'general' && topCats.length > 0 && (
            <div className="rv2-cats">
              <span>CATEGORÍAS CON MÁS PENDIENTES</span>
              <div>
                {topCats.map((t) => (
                  <button key={t.id} type="button" className={cat === t.id ? 'on' : ''} aria-pressed={cat === t.id} onClick={() => { setCat(cat === t.id ? '' : t.id); setFiltro('falta') }}><b>{t.id}</b>{t.nombre}<em>· faltan {t.n}</em></button>
                ))}
              </div>
            </div>
          )}

          <div className="rv2-filtros" role="tablist" aria-label="Filtrar">
            {filtros.map(([k, t, n, alerta2]) => (
              <button key={k} type="button" role="tab" aria-selected={filtro === k} className={(filtro === k ? 'on ' : '') + (alerta2 ? 'pide' : '')} onClick={() => setFiltro(k)}>{t} <b>{n}</b></button>
            ))}
          </div>

          <div className="rv2-lista">
            {filas.map((i) => {
              const s = ESTADOS[i.estado]
              return (
                <button key={i.k} type="button" className={'rv2-fila' + (i.estado === 'revision' && vista === 'mias' ? ' pide' : '')} onClick={() => ir(i)} aria-label={'Ir a ' + i.codigo}>
                  <span className="rv2-ic" style={{ background: s.fondo, color: s.color }} aria-hidden="true">{s.ico}</span>
                  <span className="rv2-tit"><b>{i.codigo}</b>{i.cat && <em>{i.cat}</em>}</span>
                  <span className="rv2-est" style={{ background: s.fondo, color: s.pc }}>{s.texto}</span>
                  <span className="rv2-det">{detalle(i)}</span>
                </button>
              )
            })}
            {filas.length === 0 && <div className="rv2-vacio">No hay plantillas en este filtro.</div>}
          </div>

          <div className="rv2-pie">
            <span>{vista === 'general' ? 'Las corregidas esperan una nueva revisión.' : 'Al elegir una, la galería la abre.'}</span>
            {vista === 'general' && primeraPorRevisar && <button type="button" className="btn" onClick={() => ir(primeraPorRevisar)}>Ir a la primera por revisar</button>}
          </div>
        </div>
      )}
    </div>
  )
}
