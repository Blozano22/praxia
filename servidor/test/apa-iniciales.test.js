// APA: las iniciales no deben romperse con nombres que traen guiones sueltos o dobles (antes: «Cannot read properties of undefined (reading 'toUpperCase')»).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciales, autoresReferencia } from '../src/bibliografia/apa.js'

test('iniciales: nombres normales y compuestos con guion', () => {
  assert.equal(iniciales('Juan Carlos'), 'J. C.')
  assert.equal(iniciales('Jean-Paul'), 'J.-P.')
})

test('iniciales: guion suelto, al inicio, al final o doble no lanza error', () => {
  assert.equal(iniciales('Ana-'), 'A.')
  assert.equal(iniciales('-María'), 'M.')
  assert.equal(iniciales('J--P'), 'J.-P.')
  assert.equal(iniciales('-'), '')
  assert.equal(iniciales('Ana - María'), 'A. M.')
  assert.equal(iniciales(''), '')
})

test('autoresReferencia: un autor con nombre raro no rompe la referencia', () => {
  assert.doesNotThrow(() => autoresReferencia({ autores: [{ apellido: 'Pérez', nombres: 'Ana-' }, { apellido: 'Gómez', nombres: '-' }] }))
})
