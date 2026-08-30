import assert from 'node:assert/strict'
import test from 'node:test'

import { getAdminEmails, getOwnerAdminEmail, getStaffAdminEmail, isAdminEmail, isCommissionAdminEmail } from './admin-access.ts'

const staging = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://crimsonstage12345678.supabase.co',
  NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'crimsonstage12345678',
  NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
} as const

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

test('allows exact synthetic roles only when URL, target, and staging ref are bound', () => {
  assert.equal(isAdminEmail('admin.crimson.staging@example.test', staging), true)
  assert.deepEqual(getAdminEmails(staging).slice(-1), ['admin.crimson.staging@example.test'])
  assert.equal(getOwnerAdminEmail(staging), 'admin.crimson.staging@example.test')
  assert.equal(getStaffAdminEmail(staging), 'operator.crimson.staging@example.test')
  assert.equal(isCommissionAdminEmail('operator.crimson.staging@example.test', staging), true)
  assert.equal(isAdminEmail('operator.crimson.staging@example.test', staging), false)

  for (const unsafe of [
    { ...staging, NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'production' },
    { ...staging, NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' },
    { ...staging, NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'other' },
  ]) {
    assert.equal(isAdminEmail('admin.crimson.staging@example.test', unsafe), false)
    assert.equal(getOwnerAdminEmail(unsafe), 'mjperchezabala@gmail.com')
    assert.equal(getStaffAdminEmail(unsafe), 'crimsoncrownimports@gmail.com')
    assert.equal(isCommissionAdminEmail('operator.crimson.staging@example.test', unsafe), false)
  }
})
