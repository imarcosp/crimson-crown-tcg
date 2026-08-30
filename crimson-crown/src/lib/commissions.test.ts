import assert from 'node:assert/strict'
import test from 'node:test'

import { getClientPayableCommissionMonthKey } from './commissions.ts'

const now = new Date('2026-08-29T12:00:00.000Z')

test('uses the collision-free fixture period only for the exact staging target and ref', () => {
  const staging = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://crimsonstage12345678.supabase.co',
    NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: 'crimsonstage12345678',
    NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
  }
  assert.equal(getClientPayableCommissionMonthKey(now, staging), '2099-12')
  assert.equal(getClientPayableCommissionMonthKey(now, { ...staging, NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'production' }), '2026-07')
  assert.equal(getClientPayableCommissionMonthKey(now, { ...staging, NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' }), '2026-07')
})
