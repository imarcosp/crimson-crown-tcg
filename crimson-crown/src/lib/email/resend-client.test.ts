import assert from 'node:assert/strict'
import test from 'node:test'

import { getResendClient } from './resend-client.ts'

test('no exige una clave de correo al importar el módulo', () => {
  assert.throws(() => getResendClient(''), /servicio de correo no está configurado/i)
})

test('reutiliza el cliente sólo mientras la clave configurada sea la misma', () => {
  const first = getResendClient('re_local_test_one')
  const repeated = getResendClient('re_local_test_one')
  const changed = getResendClient('re_local_test_two')

  assert.equal(first, repeated)
  assert.notEqual(first, changed)
})
