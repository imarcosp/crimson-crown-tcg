import assert from 'node:assert/strict'
import test from 'node:test'

import { isAdminEmail } from './admin-access.ts'

test('allows the synthetic admin only on a loopback Supabase URL', () => {
  assert.equal(isAdminEmail('admin.local@example.test', 'http://127.0.0.1:54621'), true)
  assert.equal(isAdminEmail('admin.local@example.test', 'http://localhost:54621'), true)
  assert.equal(isAdminEmail('admin.local@example.test', 'https://www.crimsoncrownimports.com'), false)
})

test('keeps the existing production administrators recognized', () => {
  assert.equal(isAdminEmail('mjperchezabala@gmail.com', 'https://www.crimsoncrownimports.com'), true)
  assert.equal(isAdminEmail('crimsoncrownimports@gmail.com', 'https://www.crimsoncrownimports.com'), true)
  assert.equal(isAdminEmail('tester.local@example.test', 'http://127.0.0.1:54621'), false)
})
