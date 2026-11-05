# Cómo escribir el guion para que la plataforma arme cada recurso

La plataforma **no decide** qué recurso ni qué actividad usar: lo dice el guion. Este documento resume qué debe traer el guion en cada caso. Sirve para quien escriba el guion o el prompt de n8n.

## Estructura general (guion en tablas)

Cada recurso va así:

1. Un título: **«Recurso educativo N»** (o **«Recurso de presentación»**).
2. Tabla **Dato | Detalle** con las filas `Código`, `Formato`, `Título`, `Subtemas`.
3. Título **«Guion estructurado»** y su tabla **Escena / Sección | Contenido**: una fila por escena, nodo, sección, momento, etc.
4. (Opcional) Título **«Actividad de autoaprendizaje»** y su tabla **Apartado | Indicaciones para el estudiante**.
5. Título **«Cómo se visualiza el recurso»** y su tabla con la duración y la accesibilidad.

Un recurso con actividad es **OVA**; sin actividad es **OVI**.

El **tipo de recurso** sale de la fila `Formato`:

| Formato (palabra clave) | Recurso |
|---|---|
| Diagrama(s) de flujo | Diagrama de flujo |
| Mapa conceptual | Mapa conceptual |
| Acordeón | Acordeón |
| Infografía (+ «hexagonal», «radial», «de puntos» o «vertical») | Infografía; si no dice versión, sale la vertical y se avisa |
| Línea de tiempo | Línea de tiempo |
| Estudio(s) de caso(s) | Estudio de casos |
| Crucigrama | Crucigrama |
| Portada / Galería | Portada |
| Lectura(s) diagramada(s) | Lectura diagramada |
| Presentación (multimedia) | Presentación |
| Video(s) / Micro-learning / Podcast(s) | Video / Micro-video / Podcast |

## Filas de «Guion estructurado» por recurso

- **Diagrama de flujo:** `Nodo 1: Nombre` | descripción · `Conexión 1` | con qué continúa · `Propósito` · `Relaciones entre nodos` o `Explicación breve`.
- **Mapa conceptual:** `Concepto central` | `Título | explicación` · `Nodo 1: Título` | `relación con el central | explicación` · `Hijo` | `Título | relación | explicación` (cuelga del último nodo) · `Relación con el tema` · `Reflexione y aplique` · `Ejemplo aplicado`.
- **Acordeón:** una fila por apartado (el rótulo es el título) · `Introducción` · `Síntesis` · `Referencias`.
- **Línea de tiempo:** una fila por momento (el rótulo es la fecha o el hito) · `Introducción` · `Compara y analiza`.
- **Lectura diagramada:** una fila por sección (2 por página) · `Resumen` · `Término X` | definición (diagrama de conceptos) · `Paso N` | `Nombre: descripción` · `Caso …` · `Registro` | `observa | registra; observa | registra` · `Conclusión` · `Referencias`.
- **Infografía:** una fila por bloque (rótulo = título) · `Fuentes` · opcional `Versión`.
- **Estudio de casos:** `Contexto` · `Título del reto` · `Objetivo del reto` · `Evidencia N` | `Título | explicación | dato importante` · `Preguntas orientadoras` (separadas por `;`) · `Pasos a seguir` · `Apartado N` | `Título | guía | idea clave` · `Defienda y aplique` · `Estructura` · `Criterios`.
- **Crucigrama:** una fila por palabra: el rótulo es la palabra y el contenido es la pista.
- **Presentación multimedia:** una fila por diapositiva (`Diapositiva N` | `[diseño] Título: texto || Elemento | explicación | ejemplo ;; Elemento | …`). Diseños: `texto`, `radial`, `puntos`, `tarjetas`, `acordeon`, `galeria`, `pregunta` (opciones con `*` en la correcta), `sintesis`. Sin marcador, la diapositiva sale como texto.
- **Video, micro-video, podcast:** una fila por escena o bloque (`Escena 1`, `Apertura`, `Bloque 1: Tema`, `Cierre`).

## Filas de la tabla de actividad (qué actividad es y sus datos)

Filas básicas (siempre): `Consigna`, `Materiales`, `Pasos` (numerados `1. … 2. …`), `Evidencia`, `Criterios` (`a) …; b) …`).

Para una **actividad especial**, agregar la fila `Tipo` y las filas de sus datos:

| Actividad | `Tipo` | Filas con sus datos |
|---|---|---|
| Emparejamiento | `Emparejamiento` | `Pares`: `Concepto = Aplicación; Concepto = Aplicación; …` |
| Clasificación | `Clasificación` | `Criterio de clasificación`: texto · `Categorías`: `Categoría A = elemento, elemento; Categoría B = elemento, elemento` |
| Cuestionario | `Cuestionario` | `Preguntas`: `tipo | enunciado | opción; opción*; opción | explicación ;; tipo | …` (tipo: única, múltiple o verdadero; `*` marca la correcta; `;;` separa preguntas) |
| Tarea evaluativa | `Tarea evaluativa` | `Objetivo` · `Preguntas guía` (`;`) · `Estructura` · `Antes de continuar`; los pasos y criterios usan las filas básicas |
| Laboratorio virtual | `Laboratorio` | `Situación` · `Diagnóstico`: `pregunta | opción*; opción | explicación` · `Configuraciones`: `A = Indicador: 25, Indicador: 30 ;; B = …` · `Criterio de comparación` · `Intervención`: `pregunta | opción*; opción | explicación` · `Reporte` |

Si el guion nombra una actividad especial pero no trae sus datos, la plataforma la muestra como actividad general (consigna, pasos, evidencia y criterios) y lo avisa en las «Notas del guion» del recurso.
