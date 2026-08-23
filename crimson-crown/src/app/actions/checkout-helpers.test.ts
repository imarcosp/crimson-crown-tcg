import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getCheckoutDeliveryMethod,
  getCheckoutShippingNote,
  requiresCheckoutAddress,
} from './checkout-helpers.ts'

test('normaliza el método que agrega la etiqueta de pago', () => {
  assert.equal(getCheckoutDeliveryMethod('pickup [Pago: Efectivo]'), 'pickup')
  assert.equal(getCheckoutDeliveryMethod('moto [Pago: Efectivo]'), 'moto')
  assert.equal(getCheckoutDeliveryMethod('shipping [Pago: Transf. Pesos]'), 'shipping')
})

test('exige dirección sólo para moto y shipping', () => {
  assert.equal(requiresCheckoutAddress('pickup [Pago: Efectivo]'), false)
  assert.equal(requiresCheckoutAddress('moto [Pago: Efectivo]'), true)
  assert.equal(requiresCheckoutAddress('shipping [Pago: Efectivo]'), true)
})

test('construye la nota de entrega con el método real', () => {
  assert.equal(
    getCheckoutShippingNote('moto [Pago: Efectivo]', { street: 'Corrientes 123', city: 'CABA', province: 'CABA', zip: '1043' }),
    'Entrega: Moto Mensajería (CABA/GBA) - A coordinar / Pago en destino',
  )
  assert.equal(
    getCheckoutShippingNote('shipping [Pago: Transf. Pesos]', { street: 'Corrientes 123', city: 'CABA', province: 'CABA', zip: '1043' }),
    'Entrega: Correo Argentino | Corrientes 123, CABA, CABA (1043)',
  )
})
