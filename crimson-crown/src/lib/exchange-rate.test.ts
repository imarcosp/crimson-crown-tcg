import assert from 'node:assert/strict'
import test from 'node:test'

import { EXCHANGE_RATE, parseStoredExchangeRate } from './exchange-rate.ts'

test('uses the shared fallback when stored exchange rate is unavailable or invalid', () => {
  assert.equal(parseStoredExchangeRate(null), EXCHANGE_RATE)
  assert.equal(parseStoredExchangeRate(''), EXCHANGE_RATE)
  assert.equal(parseStoredExchangeRate('not-a-number'), EXCHANGE_RATE)
  assert.equal(parseStoredExchangeRate('0'), EXCHANGE_RATE)
})

test('accepts a positive persisted exchange rate after hydration', () => {
  assert.equal(parseStoredExchangeRate('1400'), 1400)
})
