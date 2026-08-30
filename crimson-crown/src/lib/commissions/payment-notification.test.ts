import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertNotificationProviderResult,
  deliverCommissionPaymentNotification,
} from './payment-notification.ts'

test('omite la notificación cuando los efectos externos están deshabilitados', async () => {
  let sends = 0
  const result = await deliverCommissionPaymentNotification({
    disabled: true,
    send: async () => { sends += 1 },
  })

  assert.equal(result, 'disabled')
  assert.equal(sends, 0)
})

test('un fallo de correo no convierte en fallido un pago ya persistido', async () => {
  let failures = 0
  const result = await deliverCommissionPaymentNotification({
    disabled: false,
    send: async () => { throw new Error('provider unavailable') },
    onFailure: () => { failures += 1 },
  })

  assert.equal(result, 'failed')
  assert.equal(failures, 1)
})

test('un callback de observabilidad defectuoso tampoco propaga el fallo', async () => {
  const result = await deliverCommissionPaymentNotification({
    disabled: false,
    send: async () => { throw new Error('provider unavailable') },
    onFailure: () => { throw new Error('logger unavailable') },
  })

  assert.equal(result, 'failed')
})

test('convierte el error devuelto por el proveedor en una excepción controlable', () => {
  assert.throws(
    () => assertNotificationProviderResult({ error: { message: 'provider rejected request' } }),
    /notificaci[oó]n no entregada/i,
  )
  for (const invalid of [undefined, {}, { error: false }, { data: null, error: null }, { data: { id: '' }, error: null }]) {
    assert.throws(() => assertNotificationProviderResult(invalid), /notificaci[oó]n no entregada/i)
  }
  assert.doesNotThrow(() => assertNotificationProviderResult({ data: { id: 'synthetic' }, error: null }))
})

test('reporta una entrega exitosa', async () => {
  const result = await deliverCommissionPaymentNotification({
    disabled: false,
    send: async () => undefined,
  })

  assert.equal(result, 'sent')
})
