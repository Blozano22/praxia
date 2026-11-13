import { useEd, Campo, Lista, Imagen, Interruptor, Opciones, Aviso, useAbiertos } from './Fields.jsx'
import { PRESETS, FUENTES, temaBase } from '../lib/render.js'
import { clone, getIn } from '../lib/util.js'

// Cómo se edita cada tipo de recurso (qué lista tiene y qué campos).
const EDIT = {
  presentacion: { arr: 'diapositivas', item: 'Diapositiva', plural: 'Diapositivas', art: 'las diapositivas', nuevo: () => ({ titulo: 'Nueva diapositiva', layout: 'texto', subtitulo: '', texto: '', items: '', extra: '', img: '' }), tit: 'titulo', img: 'Agregar imagen a esta diapositiva (según el diseño)',
    campos: [['titulo', 'Título de la diapositiva (aparece en el encabezado)'], ['layout', 'Diseño de la diapositiva', 'sel2', [['texto', 'Texto y tarjetas'], ['radial', 'Círculo radial con panel'], ['puntos', 'Imagen con puntos'], ['tarjetas', 'Tarjetas numeradas'], ['acordeon', 'Acordeón'], ['galeria', 'Galería con flechas'], ['pregunta', 'Pregunta de comprobación'], ['sintesis', 'Síntesis y reflexión']]],
      ['subtitulo', 'Subtítulo o título de la infografía (opcional)'], ['texto', 'Texto principal (en «pregunta», el enunciado)', 1],
      ['items', 'Elementos, uno por renglón: Título | explicación | ejemplo o dato (en «pregunta», una opción por renglón con * en la correcta)', 1],
      ['extra', 'Texto adicional (mini clave, explicación de la pregunta o pregunta de reflexión)', 1]] },
  flujo: { arr: 'nodos', item: 'Paso', plural: 'Pasos del diagrama', art: 'los pasos', nuevo: () => ({ nombre: 'Nuevo paso', descripcion: '', conexion: '', forma: '', img: '' }), tit: 'nombre',
    campos: [['nombre', 'Nombre del paso (si termina en «?» se dibuja como decisión)'], ['descripcion', 'Explicación del paso', 1], ['conexion', 'Con qué continúa', 1], ['forma', 'Forma: inicio, fin, proceso, decision o io (vacío = automática)']],
    extra: [['proposito', 'Propósito del procedimiento', 1], ['explicacion', 'Explicación breve (al pie)', 1]] },
  video: { arr: 'escenas', item: 'Escena', plural: 'Escenas', art: 'las escenas', nuevo: () => ({ titulo: 'Nueva escena', visual: '', narracion: '', img: '' }), tit: 'titulo', img: 'Agregar imagen de fondo a esta escena',
    campos: [['titulo', 'Nombre de la escena'], ['visual', 'Qué se ve en pantalla (descripción visual)', 1], ['narracion', 'Texto que se narra (aparece como subtítulo)', 1]] },
  podcast: { arr: 'bloques', item: 'Bloque', plural: 'Bloques del podcast', art: 'los bloques', nuevo: () => ({ etiqueta: 'Nuevo bloque', texto: '' }), tit: 'etiqueta',
    campos: [['etiqueta', 'Nombre del bloque'], ['texto', 'Texto del locutor', 1]] },
  lectura: { arr: 'secciones', item: 'Sección', plural: 'Secciones de la lectura', art: 'las secciones', nuevo: () => ({ titulo: 'Nueva sección', texto: '', estilo: 'normal', img: '' }), tit: 'titulo', img: 'Agregar imagen a esta sección',
    campos: [['titulo', 'Título de la sección'], ['texto', 'Texto de la sección', 1], ['estilo', 'Tipo de sección', 'sel']] }
}
EDIT.acordeon = { arr: 'apartados', item: 'Apartado', plural: 'Apartados del acordeón', art: 'los apartados', nuevo: () => ({ titulo: 'Nuevo apartado', texto: '', idea: '', img: '' }), tit: 'titulo', img: 'Agregar imagen a este apartado',
  campos: [['titulo', 'Título del apartado'], ['texto', 'Contenido del apartado', 1], ['idea', 'Idea clave (opcional)', 1]],
  extra: [['introduccion', 'Introducción', 1], ['sintesis', 'Síntesis', 1], ['referencias', 'Referencias', 1]], imgGlobal: 'Imagen de la columna izquierda',
  variantes: [['1', 'Diseño 1 · Clásico'], ['2', 'Diseño 2'], ['3', 'Diseño 3']] }
EDIT.infografia = { arr: 'bloques', item: 'Bloque', plural: 'Bloques de la infografía', art: 'los bloques', nuevo: () => ({ titulo: 'Nuevo bloque', subtitulo: '', texto: '', idea: '', fuente: '', x: '', y: '', img: '' }), tit: 'titulo', img: 'Agregar imagen o ícono a este bloque',
  campos: [['titulo', 'Título del bloque'], ['subtitulo', 'Pregunta o subtítulo (solo versión vertical)'], ['texto', 'Texto del bloque', 1], ['idea', 'Idea central (versión radial, opcional)', 1], ['fuente', 'Fuente de este bloque (opcional)'], ['x', 'Posición horizontal del punto, 0 a 100 (versión de puntos)'], ['y', 'Posición vertical del punto, 0 a 100 (versión de puntos)']],
  extra: [['centro', 'Texto del centro (hexágonos y radial)'], ['kicker', 'Frase sobre el título (opcional)'], ['descripcion', 'Descripción (versión de puntos)', 1], ['dato', 'Dato importante (versión de puntos)', 1], ['fuentes', 'Fuentes (versión vertical)', 1]],
  imgGlobal: 'Ilustración de fondo (versión de puntos)',
  variantes: [['red', 'Vertical con fotos (RED)'], ['hex', 'Hexágonos alrededor de un círculo'], ['radial', 'Círculo radial con panel de lectura'], ['pines', 'Puntos sobre una ilustración']] }
EDIT.portada = { arr: 'etiquetas', item: 'Etiqueta', plural: 'Etiquetas de la portada', art: 'las etiquetas', nuevo: () => ({ texto: 'Nueva etiqueta' }), tit: 'texto',
  campos: [['texto', 'Texto de la etiqueta']],
  extra: [['descripcion', 'Descripción', 1], ['boton', 'Texto del botón']], imgGlobal: 'Imagen de la portada' }
EDIT.crucigrama = { arr: 'palabras', item: 'Palabra', plural: 'Palabras y pistas', art: 'las palabras', nuevo: () => ({ palabra: 'PALABRA', pista: '' }), tit: 'palabra',
  campos: [['palabra', 'Palabra (sin espacios ni tildes importan)'], ['pista', 'Pista', 1]],
  extra: [['tituloCrucigrama', 'Título sobre la cuadrícula'], ['nota', 'Nota al pie', 1]], sinActividad: false,
  variantes: [['1', 'Diseño 1 · Clásico'], ['2', 'Diseño 2'], ['3', 'Diseño 3']] }
EDIT.lectura.extra = [['kicker', 'Frase sobre el título (opcional)'], ['subtitulo', 'Subtítulo (opcional)'], ['resumen', 'Resumen (columna derecha)', 1], ['centro', 'Idea central del diagrama (opcional)']]
EDIT.lectura.lista3 = { arr: 'pasos', item: 'Paso', plural: 'Pasos del flujo (página 2)', art: 'los pasos', nuevo: () => ({ titulo: 'Nuevo paso', texto: '' }), tit: 'titulo',
  campos: [['titulo', 'Nombre del paso'], ['texto', 'Descripción corta', 1]] }
EDIT.lectura.lista4 = { arr: 'registro', item: 'Fila', plural: 'Tabla de registro (qué observamos / qué registramos)', art: 'las filas', nuevo: () => ({ observa: '', registra: '' }), tit: 'observa',
  campos: [['observa', 'Qué observamos'], ['registra', 'Qué registramos']] }
EDIT.lectura.lista2 = { arr: 'glosario', item: 'Término', plural: 'Glosario (ítems del diagrama)', art: 'los términos', nuevo: () => ({ termino: 'Nuevo término', definicion: '' }), tit: 'termino',
  campos: [['termino', 'Término'], ['definicion', 'Definición', 1]] }
const PARES = { base: ['actividad'], arr: 'pares', item: 'Par', plural: 'Pares', art: 'los pares', nuevo: () => ({ a: '', b: '' }), tit: 'a',
  campos: [['a', 'Concepto (columna A)', 1], ['b', 'Aplicación que le corresponde (columna B)', 1]] }
const CATEGORIAS = { base: ['actividad'], arr: 'categorias', item: 'Categoría', plural: 'Categorías', art: 'las categorías', nuevo: () => ({ nombre: 'Nueva categoría', descripcion: '', elementos: '' }), tit: 'nombre',
  campos: [['nombre', 'Nombre de la categoría'], ['descripcion', 'Descripción corta (opcional)', 1], ['elementos', 'Elementos de esta categoría (uno por renglón)', 1]] }
EDIT.lineatiempo = { arr: 'eventos', item: 'Momento', plural: 'Momentos de la línea de tiempo', art: 'los momentos', nuevo: () => ({ fecha: 'Nueva fecha', titulo: '', texto: '', cambio: '', img: '' }), tit: 'fecha', img: 'Agregar imagen a este momento',
  campos: [['fecha', 'Fecha o nombre del momento'], ['titulo', 'Frase corta bajo la fecha (opcional)'], ['texto', 'Descripción del momento', 1], ['cambio', '¿Qué cambió? (opcional)', 1]],
  extra: [['tituloSecuencia', 'Título de la secuencia (opcional)'], ['intro', 'Frase bajo el título (opcional)', 1]],
  variantes: [['1', 'Diseño 1 · Clásico'], ['2', 'Diseño 2'], ['3', 'Diseño 3']] }
EDIT.mapa = { arr: 'ramas', item: 'Rama', plural: 'Ramas del mapa (conceptos que salen del central)', art: 'las ramas', nuevo: () => ({ titulo: 'Nuevo concepto', relacion: '', texto: '', hijosTxt: '' }), tit: 'titulo',
  campos: [['titulo', 'Concepto'], ['relacion', 'Cómo se relaciona con el central (texto sobre la línea)'], ['texto', 'Explicación del concepto', 1], ['hijosTxt', 'Subconceptos, uno por renglón: Título | relación | explicación', 1]],
  extra: [['central', 'Concepto central'], ['centralTexto', 'Explicación del concepto central', 1], ['tituloMapa', 'Título sobre el mapa (opcional)'], ['intro', 'Frase bajo el título (opcional)', 1], ['relacionTema', 'Relación con el tema', 1], ['ejemplo', 'Ejemplo aplicado', 1]] }
const PREGUNTAS = { base: ['actividad'], arr: 'preguntas', item: 'Pregunta', plural: 'Preguntas', art: 'las preguntas', nuevo: () => ({ tipo: 'unica', enunciado: '', opciones: '', retro: '' }), tit: 'enunciado',
  campos: [['tipo', 'Tipo: unica, multiple o vf (verdadero/falso)'], ['enunciado', 'Enunciado de la pregunta', 1], ['opciones', 'Opciones, una por renglón. Marque la correcta con * al final', 1], ['retro', 'Retroalimentación (explicación)', 1]] }
EDIT.casos = { arr: 'evidencias', item: 'Evidencia', plural: 'Evidencias (puntos sobre la imagen, etapa 2)', art: 'las evidencias', nuevo: () => ({ titulo: 'Nueva evidencia', texto: '', dato: '', x: '', y: '' }), tit: 'titulo',
  campos: [['titulo', 'Título del punto'], ['texto', 'Explicación del punto', 1], ['dato', 'Dato importante (opcional)', 1], ['x', 'Posición horizontal, 0 a 100 (opcional)'], ['y', 'Posición vertical, 0 a 100 (opcional)']],
  extra: [['tituloReto', 'Título del reto'], ['contexto', 'Contexto del caso (etapa 1)', 1], ['objetivo', 'Objetivo del reto', 1], ['tituloExploracion', 'Título de la exploración visual'], ['subExploracion', 'Frase bajo ese título'], ['preguntas', 'Preguntas orientadoras (una por renglón)', 1], ['pasos', 'Pasos a seguir (uno por renglón)', 1], ['estructura', 'Estructura de la respuesta argumentada', 1], ['criterios', 'Criterios de revisión (uno por renglón)', 1]],
  imgGlobal: 'Imagen del contexto (etapa 1)', imgGlobal2: 'Imagen de la exploración (etapa 2; si no, usa la anterior)',
  lista2: { arr: 'apartados', item: 'Apartado', plural: 'Apartados del análisis (etapa 3)', art: 'los apartados', nuevo: () => ({ titulo: 'Nuevo apartado', guia: '', clave: '' }), tit: 'titulo',
    campos: [['titulo', 'Título del apartado'], ['guia', 'Guía para el estudiante', 1], ['clave', 'Idea clave (opcional)', 1]] },
  sinActividad: false }
const CONFIGS = { base: ['actividad'], arr: 'configs', item: 'Configuración', plural: 'Configuraciones a comparar (paso 2)', art: 'las configuraciones', nuevo: () => ({ nombre: 'Configuración', indicadores: '' }), tit: 'nombre',
  campos: [['nombre', 'Nombre de la configuración'], ['indicadores', 'Indicadores, uno por renglón: Nombre | valor de 0 a 100', 1]] }
EDIT.microvideo = EDIT.video
export const cfgDe = (tipo) => EDIT[tipo] || EDIT.lectura

function Lista3({ cfg }) {
  const { draft, set } = useEd()
  const [abiertos, alternar] = useAbiertos()
  const arr = getIn(draft.datos, [...(cfg.base || []), cfg.arr]) || []
  const mover = (i, d) => {
    const j = i + d
    if (j < 0 || j >= arr.length) return
    const n = arr.slice();
    [n[i], n[j]] = [n[j], n[i]]
    set(['datos', ...(cfg.base || []), cfg.arr], n)
  }
  return (
    <div>
      {arr.map((it, i) => {
        const key = draft.id + cfg.arr + i
        const cerrado = abiertos[key] === false
        return (
          <div key={key} className={'item' + (cerrado ? ' closed' : '')}>
            <div className="ih" onClick={(e) => { if (!e.target.closest('.ic')) alternar(key) }}>
              <b>{cfg.item} {i + 1}{it[cfg.tit] ? ' · ' + it[cfg.tit] : ''}</b>
              <button className="ic" title="Subir" onClick={() => mover(i, -1)}>▲</button>
              <button className="ic" title="Bajar" onClick={() => mover(i, 1)}>▼</button>
              <button className="ic" title="Duplicar" onClick={() => { const n = arr.slice(); n.splice(i + 1, 0, clone(it)); set(['datos', ...(cfg.base || []), cfg.arr], n) }}>⧉</button>
              <button className="ic d" title="Eliminar" onClick={() => { if (confirm('¿Eliminar ' + cfg.item.toLowerCase() + ' ' + (i + 1) + '?')) set(['datos', ...(cfg.base || []), cfg.arr], arr.filter((_, k) => k !== i)) }}>✕</button>
            </div>
            <div className="ib">
              {cfg.campos.map((c) => c[2] === 'sel2' ? (
                <div key={c[0]}>
                  <label className="l">{c[1]}</label>
                  <select value={it[c[0]] || c[3][0][0]} onChange={(e) => set(['datos', ...(cfg.base || []), cfg.arr, i, c[0]], e.target.value)}>
                    {c[3].map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                  </select>
                </div>
              ) : c[2] === 'sel' ? (
                <div key={c[0]}>
                  <label className="l">{c[1]}</label>
                  <select value={it[c[0]] || 'normal'} onChange={(e) => set(['datos', ...(cfg.base || []), cfg.arr, i, c[0]], e.target.value)}>
                    <option value="normal">Normal</option><option value="ejemplo">Ejemplo destacado</option><option value="caso">Caso (tarjeta lateral)</option><option value="sintesis">Conclusión / síntesis</option><option value="referencias">Referencias</option>
                  </select>
                </div>
              ) : <Campo key={c[0]} label={c[1]} path={['datos', ...(cfg.base || []), cfg.arr, i, c[0]]} long={c[2] === 1} rows={4} />)}
              {cfg.img && <Imagen label={cfg.img} path={['datos', ...(cfg.base || []), cfg.arr, i, 'img']} />}
            </div>
          </div>
        )
      })}
      <button className="btn sm" onClick={() => set(['datos', ...(cfg.base || []), cfg.arr], [...arr, cfg.nuevo()])}>＋ Agregar {cfg.item.toLowerCase()}</button>
    </div>
  )
}

export function PanelContenido() {
  const { draft, set } = useEd()
  const d = draft.datos
  const cfg = cfgDe(draft.tipo)
  const a = d.actividad
  return (
    <div>
      <div className="tour">Cambie cualquier texto: el resultado se ve a la derecha al instante y se guarda solo. Use ▲ ▼ para mover, ⧉ para duplicar y ✕ para eliminar.</div>
      <Campo label="Título del recurso" path={['datos', 'titulo']} />
      <Campo label="Resultado de aprendizaje (aparece al inicio del recurso)" path={['datos', 'info', 'resultado']} long rows={3} help="Viene de la tabla de información del guion." />
      {cfg.variantes && (
        <div><label className="l">{d.tipo === "infografia" ? "Versión de la infografía" : "Diseño del recurso"}</label>
          <select value={d.variante || cfg.variantes[0][0]} onChange={(e) => set(['datos', 'variante'], e.target.value)}>{cfg.variantes.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
      )}
      {(cfg.extra || []).map(([k, n, l]) => <Campo key={k} label={n} path={['datos', k]} long={!!l} rows={3} />)}
      {cfg.imgGlobal && <Imagen label={cfg.imgGlobal} path={['datos', 'img']} />}
      {cfg.imgGlobal2 && <Imagen label={cfg.imgGlobal2} path={['datos', 'img2']} />}
      <h2 style={{ fontSize: '1.05rem', margin: '18px 0 4px' }}>{cfg.plural}</h2>
      <Lista3 cfg={cfg} />
      {[cfg.lista2, cfg.lista3, cfg.lista4].filter(Boolean).map((l) => <div key={l.arr}><h2 style={{ fontSize: '1.05rem', margin: '18px 0 4px' }}>{l.plural}</h2><Lista3 cfg={l} /></div>)}
      {!cfg.sinActividad && <h2 style={{ fontSize: '1.05rem', margin: '22px 0 4px' }}>Actividad de autoaprendizaje</h2>}
      {cfg.sinActividad ? null : a && !draft.actividadOculta ? (
        <div>
          <label className="l">Tipo de actividad</label>
          <select value={a.tipo || ''} onChange={(e) => set(['datos', 'actividad', 'tipo'], e.target.value)}>
            <option value="">Autoaprendizaje (pasos y evidencia)</option>
            <option value="emparejamiento">Emparejamiento (columnas A y B, en una vista aparte)</option>
            <option value="laboratorio">Laboratorio virtual (4 pasos, en una vista aparte)</option>
            <option value="tarea">Tarea evaluativa (3 páginas, en una vista aparte)</option>
            <option value="cuestionario">Cuestionario con retroalimentación (preguntas, en una vista aparte)</option>
            <option value="clasificacion">Clasificación (banco de elementos y zonas, en una vista aparte)</option>
          </select>
          <Campo label="Nombre de la actividad (opcional)" path={['datos', 'actividad', 'nombre']} />
          <Campo label="Enunciado de la actividad" path={['datos', 'actividad', 'enunciado']} long rows={3} />
          {a.tipo === 'laboratorio' && <div><p className="help">Cuatro pasos: diagnóstico, comparación de configuraciones, validación de una intervención y reporte final. En las opciones, marque la correcta con * al final.</p><Imagen label="Imagen de la situación de práctica" path={['datos', 'actividad', 'img']} /><Campo label="Situación de práctica" path={['datos', 'actividad', 'situacion']} long rows={3} /><Campo label="Pregunta del diagnóstico (paso 1)" path={['datos', 'actividad', 'diagPregunta']} long rows={2} /><Campo label="Opciones del diagnóstico (una por renglón, * en la correcta)" path={['datos', 'actividad', 'diagOpciones']} long rows={3} /><Campo label="Retroalimentación del diagnóstico" path={['datos', 'actividad', 'diagRetro']} long rows={2} /><Lista3 cfg={CONFIGS} /><Campo label="Criterio de comparación (paso 2)" path={['datos', 'actividad', 'criterioComp']} long rows={2} /><Campo label="Pregunta de la intervención (paso 3)" path={['datos', 'actividad', 'intervPregunta']} long rows={2} /><Campo label="Opciones de la intervención (una por renglón, * en la correcta)" path={['datos', 'actividad', 'intervOpciones']} long rows={3} /><Campo label="Retroalimentación de la intervención" path={['datos', 'actividad', 'intervRetro']} long rows={2} /><Campo label="Indicación del reporte final (paso 4)" path={['datos', 'actividad', 'reporte']} long rows={2} /></div>}
          {a.tipo === 'tarea' && <div><p className="help">La tarea usa los campos de abajo: el enunciado es la «Descripción de la actividad», la evidencia es el «Producto esperado», los pasos van en la página 2 («Título | descripción») y los criterios en la página 3 («Nombre | descripción»).</p><Campo label="Objetivo del reto" path={['datos', 'actividad', 'objetivo']} long rows={2} /><Campo label="Preguntas guía para el borrador (una por renglón)" path={['datos', 'actividad', 'guias']} long rows={3} /><Campo label="Estructura y formato de entrega" path={['datos', 'actividad', 'estructura']} long rows={2} /><Campo label="Antes de continuar (recordatorio)" path={['datos', 'actividad', 'antes']} long rows={2} /></div>}
          {a.tipo === 'cuestionario' && <div><h2 style={{ fontSize: '1.05rem', margin: '14px 0 4px' }}>Preguntas del cuestionario</h2><p className="help">Escriba una opción por renglón y ponga * al final de las correctas.</p><Lista3 cfg={PREGUNTAS} /></div>}
          {a.tipo === 'clasificacion' && <div><Campo label="Criterio de clasificación" path={['datos', 'actividad', 'criterio']} long rows={2} /><h2 style={{ fontSize: '1.05rem', margin: '14px 0 4px' }}>Categorías y sus elementos</h2><p className="help">Los elementos salen mezclados en el banco; el estudiante los asigna a la zona que corresponde.</p><Lista3 cfg={CATEGORIAS} /></div>}
          {a.tipo === 'emparejamiento' && <div><h2 style={{ fontSize: '1.05rem', margin: '14px 0 4px' }}>Pares para emparejar</h2><p className="help">Cada fila es un par correcto. En la actividad, la columna B sale mezclada.</p><Lista3 cfg={PARES} /></div>}
          <Campo label="Materiales" path={['datos', 'actividad', 'materiales']} long rows={2} />
          <Lista label="Pasos" path={['datos', 'actividad', 'pasos']} add="Agregar paso" />
          <Campo label="Evidencia que se debe entregar" path={['datos', 'actividad', 'evidencia']} long rows={2} />
          <Lista label="Criterios de evaluación" path={['datos', 'actividad', 'criterios']} add="Agregar criterio" />
          <button className="btn danger sm" style={{ marginTop: 12 }} onClick={() => { if (confirm('¿Quitar la actividad de este recurso?')) set(['actividadOculta'], true) }}>Quitar la actividad</button>
        </div>
      ) : (
        <div>
          <p className="help">{a ? 'La actividad está oculta en este recurso.' : 'El guion no trae una actividad para este recurso.'}</p>
          <button className="btn sec sm" onClick={() => {
            if (!a) set(['datos', 'actividad'], { enunciado: '', materiales: '', pasos: [], evidencia: '', criterios: [] })
            set(['actividadOculta'], false)
          }}>{a ? 'Mostrar la actividad' : '＋ Agregar una actividad'}</button>
        </div>
      )}
      {(draft.avisos.length > 0 || draft.sinUbicar.length > 0 || draft.tecnica) && (
        <details className="item" style={{ padding: '10px 12px', marginTop: 22 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Notas del guion para este recurso</summary>
          {draft.avisos.map((t, i) => <Aviso key={i} tipo="warn">{t}</Aviso>)}
          {draft.sinUbicar.length > 0 && (
            <div><p className="help">Texto que no se pudo ubicar (puede copiarlo a donde corresponda):</p>{draft.sinUbicar.map((t, i) => <p key={i} style={{ fontSize: '.9rem' }}>{t}</p>)}</div>
          )}
          {draft.tecnica && <div><p className="help">Indicaciones técnicas del guion (no se muestran a los estudiantes):</p><p style={{ fontSize: '.9rem' }}>{draft.tecnica}</p></div>}
        </details>
      )}
    </div>
  )
}

export function PanelDiseno() {
  return (
    <div>
      <div className="tour">Todos los recursos usan el mismo diseño institucional DIEPO: la paleta, la tipografía (Montserrat) y el estilo no cambian según la formación. Por eso aquí no hay colores ni letras para elegir.</div>
      <label className="l">Paleta DIEPO</label>
      <div className="sw" aria-label="Colores del recurso" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[['#142749', 'Azul noche'], ['#22335D', 'Azul marino'], ['#1C45B4', 'Azul'], ['#08A6CB', 'Cian'], ['#00665F', 'Verde azulado']].map(([c, n]) => (
          <span key={c} title={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.78rem' }}><i style={{ width: 22, height: 22, borderRadius: 6, background: c, display: 'inline-block' }} />{n}</span>
        ))}
      </div>
      <p className="help">El verde lima solo aparece en detalles pequeños (un indicador o una etiqueta), nunca como fondo.</p>
    </div>
  )
}

export function PanelOrden() {
  const { draft, set } = useEd()
  const t = draft.tema
  const cfg = cfgDe(draft.tipo)
  const arr = draft.datos[cfg.arr] || []
  const mover = (i, d) => {
    const j = i + d
    if (j < 0 || j >= arr.length) return
    const n = arr.slice();
    [n[i], n[j]] = [n[j], n[i]]
    set(['datos', ...(cfg.base || []), cfg.arr], n)
  }
  return (
    <div>
      <div className="tour">Aquí cambia el orden de los elementos y cómo se comporta el recurso.</div>
      <label className="l">Orden de {cfg.art}</label>
      <p className="help">Use las flechas para subir o bajar. El resultado se ve a la derecha.</p>
      {arr.map((it, i) => (
        <div key={i} className="listrow" style={{ border: '1.5px solid var(--line)', borderRadius: 8, padding: '6px 8px', background: '#fff' }}>
          <span className="pill">{i + 1}</span>
          <span style={{ flex: 1, fontSize: '.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it[cfg.tit] || cfg.item}</span>
          <button className="ic" title="Subir" onClick={() => mover(i, -1)}>▲</button>
          <button className="ic" title="Bajar" onClick={() => mover(i, 1)}>▼</button>
        </div>
      ))}
      <label className="l" style={{ marginTop: 22 }}>Comportamiento</label>
      <Interruptor checked={t.bloqueo !== false} onChange={(v) => set(['tema', 'bloqueo'], v)} titulo="Obligar a avanzar en orden" texto="El estudiante debe leer o explorar cada parte para desbloquear la siguiente." />
      {draft.tipo === 'presentacion' && (
        <div><label className="l">Posición de la imagen en cada diapositiva</label>
          <Opciones valor={t.layout.imgLado} opciones={[['izq', 'A la izquierda'], ['der', 'A la derecha']]} onChange={(v) => set(['tema', 'layout', 'imgLado'], v)} /></div>
      )}
      {draft.tipo === 'flujo' && (
        <div><label className="l">Dirección del diagrama</label>
          <Opciones valor={t.layout.orientacion} opciones={[['horizontal', 'Horizontal (izquierda a derecha)'], ['vertical', 'Vertical (arriba hacia abajo)']]} onChange={(v) => set(['tema', 'layout', 'orientacion'], v)} /></div>
      )}
      {draft.datos.actividad && (
        <Interruptor checked={!draft.actividadOculta} onChange={(v) => set(['actividadOculta'], !v)} titulo="Mostrar la actividad de autoaprendizaje" texto="Si la desactiva, el recurso termina sin actividad." />
      )}
    </div>
  )
}

export function PanelAyuda() {
  return (
    <div className="ayuda">
      <h2 style={{ fontSize: '1.1rem' }}>¿Cómo usar el editor?</h2>
      <ol>
        <li><b>Contenido: </b>cambie los textos. Cada escena, nodo, bloque o sección es una tarjeta que puede abrir y cerrar tocando su título.</li>
        <li><b>Colores y letra: </b>elija una combinación de colores o sus propios colores, el tipo y tamaño de letra y suba el logo de la institución.</li>
        <li><b>Orden y opciones: </b>cambie el orden de los elementos y decida si el estudiante debe avanzar en orden.</li>
        <li><b>Vista previa: </b>«Ver todo» muestra el recurso completo para que lo revise. «Como estudiante» muestra los bloqueos tal como los verá quien lo use.</li>
        <li><b>Si se equivoca: </b>use «Deshacer» (arriba a la izquierda) para volver atrás.</li>
        <li><b>Descargar: </b>el botón dorado descarga un archivo .html que funciona solo, sin internet. Puede subirlo a su aula virtual o abrirlo con doble clic.</li>
      </ol>
      <Aviso>Todo el contenido sale del guion. Si algo falta, escríbalo en la tarjeta correspondiente.</Aviso>
    </div>
  )
}
