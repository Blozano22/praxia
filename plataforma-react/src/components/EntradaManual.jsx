import { useState } from 'react'
import { E } from '../lib/engine.js'
import { apiArchivo } from '../lib/api.js'
import { RE_CARPETA, RE_DOC } from '../lib/syllabus.js'

const TEXTOS = {
  unidades: {
    ayuda: 'El syllabus y los documentos por unidad ya deben estar creados en Google Docs: pegue el enlace de cada uno. Con eso queda listo para crear los guiones.',
    boton: 'Crear y seguir a los guiones →'
  },
  guiones: {
    ayuda: 'Pegue el enlace del syllabus y, por cada unidad, el de su documento y el de su guion. La plataforma lee los guiones y le muestra los recursos para revisarlos.',
    boton: 'Leer los guiones y revisar los recursos →'
  }
}

const VACIA = { nombre: '', url: '', guiones: [''] }

// Punto de entrada para quien ya tiene avance: crea el syllabus con sus unidades ya aprobadas, sin pasar por n8n.
// Todo se pide por enlace de Google Docs: el syllabus, el documento de cada unidad y, si hay guiones, el guion de cada una.
export default function EntradaManual({ onCrear }) {
  const [modo, setModo] = useState('unidades')
  const t = TEXTOS[modo]
  const [programa, setPrograma] = useState('')
  const [curso, setCurso] = useState('')
  const [syllabusUrl, setSyllabusUrl] = useState('')
  const [carpetaUrl, setCarpetaUrl] = useState('')
  const [unidades, setUnidades] = useState([VACIA, VACIA, VACIA, VACIA])
  const [error, setError] = useState('')
  const [leyendo, setLeyendo] = useState('')

  const cambiar = (i, c) => setUnidades(unidades.map((u, k) => (k === i ? { ...u, ...c } : u)))

  // Devuelve los datos listos, o null si algo falta (y deja el aviso en pantalla).
  const reunir = () => {
    const falla = (m) => { setError(m); return null }
    if (!curso.trim()) return falla('Escriba el nombre del curso.')
    if (!syllabusUrl.trim()) return falla('Falta el enlace del syllabus.')
    if (!RE_DOC.test(syllabusUrl.trim())) return falla('El enlace del syllabus debe ser de Google Docs.')
    if (!carpetaUrl.trim()) return falla('Falta el enlace de la carpeta de Drive.')
    if (!RE_CARPETA.test(carpetaUrl.trim())) return falla('El enlace de la carpeta debe ser de Google Drive.')
    const docs = []
    const guiones = []
    for (let i = 0; i < unidades.length; i++) {
      const u = unidades[i]
      const gs = u.guiones.map((g) => g.trim()).filter(Boolean)
      if (!u.nombre.trim() && !u.url.trim() && !gs.length) continue
      if (!u.url.trim()) return falla('Falta el enlace del documento de la unidad ' + (i + 1) + '. Los documentos deben existir antes de continuar.')
      if (!RE_DOC.test(u.url.trim())) return falla('El enlace de la unidad ' + (i + 1) + ' debe ser de Google Docs.')
      if (modo === 'guiones') {
        if (!gs.length) return falla('Falta el enlace del guion de la unidad ' + (i + 1) + '.')
        const mal = gs.findIndex((g) => !RE_DOC.test(g))
        if (mal >= 0) return falla('El guion ' + (mal + 1) + ' de la unidad ' + (i + 1) + ' debe ser un enlace de Google Docs.')
        gs.forEach((g, k) => guiones.push({ unidad: i + 1, url: g, n: k + 1, de: gs.length }))
      }
      docs.push({ unidad: i + 1, nombre: u.nombre.trim() || 'Unidad ' + (i + 1), url: u.url.trim(), aprobado: true, visto: true })
    }
    if (!docs.length) return falla('Agregue al menos una unidad con su documento.')
    setError('')
    return { datos: { programa: programa.trim(), curso: curso.trim(), syllabusUrl: syllabusUrl.trim(), carpetaUrl: carpetaUrl.trim(), documentos: docs }, guiones }
  }

  const enviar = async (e) => {
    e.preventDefault()
    const r = reunir()
    if (!r) return
    if (modo === 'unidades') return onCrear(r.datos, 'unidades')
    // Con guiones: se descargan y analizan todos antes de crear nada; si uno falla, no se crea el syllabus.
    const cola = []
    try {
      for (const g of r.guiones) {
        const et = 'unidad ' + g.unidad + (g.de > 1 ? ' (guion ' + g.n + ' de ' + g.de + ')' : '')
        setLeyendo('Leyendo el guion de la ' + et + '…')
        let an
        try { an = E.analizar(await E.leerDocx(await apiArchivo('/guion-url', { url: g.url }))) } catch (err) { throw new Error(et + ': ' + (err.message || err)) }
        if (!an.recursos.length) throw new Error(et + ': no se encontraron recursos en el guion. ' + (an.diagnostico || 'Revise que tenga el formato con el código del recurso (por ejemplo «U1-T1-OVA1 Nombre»).'))
        cola.push({ unidad: g.unidad, pend: { nombre: 'Guion de la Unidad ' + g.unidad + (g.de > 1 ? ' (' + g.n + ')' : '') + ' (Google Docs)', info: an.info, recursos: an.recursos } })
      }
      setLeyendo('')
      onCrear(r.datos, 'guiones', cola)
    } catch (err) { setLeyendo(''); setError(err.message || String(err)) }
  }

  return (
    <form className="card" onSubmit={enviar} noValidate style={{ maxWidth: 900 }}>
      <h2 style={{ marginTop: 0 }}>Cargar trabajo adelantado</h2>
      <p className="help">¿Hasta dónde va?</p>
      <div className="row" style={{ margin: '6px 0 10px' }}>
        {[['unidades', 'Tengo las unidades · me faltan los guiones'], ['guiones', 'Tengo los guiones · me faltan los recursos']].map(([k, n]) => (
          <button type="button" key={k} className={'btn sm' + (modo === k ? '' : ' sec')} onClick={() => { setModo(k); setError('') }}>{n}</button>
        ))}
      </div>
      <p className="help">{t.ayuda}</p>
      <label className="l" htmlFor="em-curso">Curso o asignatura</label>
      <input id="em-curso" type="text" value={curso} onChange={(e) => setCurso(e.target.value)} placeholder="Ej.: Didáctica" />
      <label className="l" htmlFor="em-prog">Programa <span className="help">(opcional, para agrupar en el dashboard)</span></label>
      <input id="em-prog" type="text" value={programa} onChange={(e) => setPrograma(e.target.value)} placeholder="Ej.: Licenciatura en Educación Comunitaria" />
      <label className="l" htmlFor="em-syl">Enlace del syllabus <span className="help">(obligatorio)</span></label>
      <input id="em-syl" type="text" value={syllabusUrl} onChange={(e) => setSyllabusUrl(e.target.value)} placeholder="https://docs.google.com/document/d/..." />

      <label className="l" htmlFor="em-car">Carpeta de Drive <span className="help">(obligatorio)</span></label>
      <input id="em-car" type="text" value={carpetaUrl} onChange={(e) => setCarpetaUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />

      <label className="l">Unidades</label>
      {unidades.map((u, i) => (
        <div className="row" key={i} style={{ marginBottom: 8, alignItems: 'flex-start' }}>
          <b style={{ width: 28 }}>{i + 1}</b>
          <input type="text" aria-label={'Nombre de la unidad ' + (i + 1)} style={{ flex: 1, minWidth: 150 }} value={u.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })} placeholder="Nombre de la unidad" />
          <input type="text" aria-label={'Documento de la unidad ' + (i + 1)} style={{ flex: 1.3, minWidth: 200 }} value={u.url} onChange={(e) => cambiar(i, { url: e.target.value })} placeholder="Enlace del documento de la unidad" />
          {modo === 'guiones' && (
            <div style={{ flex: 1.3, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {u.guiones.map((g, k) => (
                <input key={k} type="text" aria-label={'Guion ' + (k + 1) + ' de la unidad ' + (i + 1)} value={g} placeholder={u.guiones.length > 1 ? 'Enlace del guion ' + (k + 1) : 'Enlace del guion de la unidad'} onChange={(e) => cambiar(i, { guiones: u.guiones.map((x, j) => (j === k ? e.target.value : x)) })} />
              ))}
              <button type="button" className="btn sec sm" style={{ alignSelf: 'flex-start' }} onClick={() => cambiar(i, { guiones: [...u.guiones, ''] })}>＋ Otro guion de esta unidad</button>
            </div>
          )}
        </div>
      ))}
      <div className="row" style={{ marginTop: 4 }}>
        <button type="button" className="btn sec sm" onClick={() => setUnidades([...unidades, VACIA])}>＋ Otra unidad</button>
      </div>
      {leyendo && <div className="msg info" role="status" style={{ marginTop: 14 }}>{leyendo}</div>}
      {error && <div className="msg bad" role="alert" style={{ marginTop: 14 }}>{error}</div>}
      <div className="row" style={{ marginTop: 18 }}><button className="btn" type="submit" disabled={!!leyendo}>{t.boton}</button></div>
    </form>
  )
}
