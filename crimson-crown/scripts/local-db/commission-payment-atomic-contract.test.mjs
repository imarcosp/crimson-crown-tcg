import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../../supabase/migrations/20260829235000_report_commission_payment_atomically.sql', import.meta.url)
const confirmationMigrationUrl = new URL('../../supabase/migrations/20260829235500_confirm_commission_payment_atomically.sql', import.meta.url)
const proofRegexMigrationUrl = new URL('../../supabase/migrations/20260829235700_fix_commission_payment_proof_path_regex.sql', import.meta.url)
const actionUrl = new URL('../../src/app/actions/commissions.ts', import.meta.url)

test('la migración reporta pagos de comisión de forma atómica e idempotente', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /add column if not exists operation_key uuid/iu)
  assert.match(sql, /create unique index[^;]+operation_key/isu)
  assert.match(sql, /create or replace function public\.report_commission_payment_atomic\(/iu)
  assert.match(sql, /pg_advisory_xact_lock/iu)
  assert.match(sql, /insert into public\.commission_payments/iu)
  assert.match(sql, /insert into public\.commission_payment_allocations/iu)
  assert.match(sql, /created := false/iu)
  assert.match(sql, /is distinct from/iu)
  assert.match(sql, /revoke all on function public\.report_commission_payment_atomic/iu)
  assert.match(sql, /grant execute on function public\.report_commission_payment_atomic[^;]+service_role/isu)
  assert.doesNotMatch(sql, /grant execute[^;]+(?:anon|authenticated)/iu)
  assert.doesNotMatch(sql, /delete from public\.commission_(?:payments|payment_allocations)/iu)
})

test('el hotfix acepta exclusivamente una extensión real en proof_path', async () => {
  const sql = await readFile(proofRegexMigrationUrl, 'utf8')
  assert.match(sql, /create or replace function public\.report_commission_payment_atomic\(/iu)
  assert.ok(sql.includes('}\\.(jpg|jpeg|png|webp|pdf)$'))
  assert.equal(sql.includes('}\\\\.(jpg|jpeg|png|webp|pdf)$'), false)
})

test('la confirmación comparte el lock FIFO, es transaccional e idempotente', async () => {
  const sql = await readFile(confirmationMigrationUrl, 'utf8')

  assert.match(sql, /create or replace function public\.confirm_commission_payment_atomic\(/iu)
  assert.match(sql, /for update/iu)
  assert.match(sql, /commission-payment-allocation-fifo/iu)
  assert.match(sql, /status is distinct from 'reported'/iu)
  assert.match(sql, /v_payment\.status = 'confirmed'/iu)
  assert.match(sql, /insert into public\.commission_payment_allocations/iu)
  assert.match(sql, /update public\.commission_payments/iu)
  assert.match(sql, /revoke all on function public\.confirm_commission_payment_atomic/iu)
  assert.match(sql, /grant execute on function public\.confirm_commission_payment_atomic[^;]+service_role/isu)
  assert.doesNotMatch(sql, /delete from public\.commission_payment_allocations/iu)
})

test('la Server Action delega la persistencia al RPC y conserva la clave de operación', async () => {
  const source = await readFile(actionUrl, 'utf8')
  const start = source.indexOf('export async function reportCommissionPaymentAction')
  const end = source.indexOf('export async function confirmCommissionPaymentAction')
  assert.ok(start >= 0 && end > start)
  const action = source.slice(start, end)

  assert.match(action, /input\.operationKey/iu)
  assert.match(action, /rpc\('report_commission_payment_atomic'/iu)
  assert.doesNotMatch(action, /\.from\('commission_payments'\)\s*\.insert/isu)
})

test('la Server Action confirma por RPC y nunca reasigna desde JavaScript', async () => {
  const source = await readFile(actionUrl, 'utf8')
  const start = source.indexOf('export async function confirmCommissionPaymentAction')
  const end = source.indexOf('export async function rejectCommissionPaymentAction')
  assert.ok(start >= 0 && end > start)
  const action = source.slice(start, end)

  assert.match(action, /rpc\('confirm_commission_payment_atomic'/iu)
  assert.doesNotMatch(action, /allocateConfirmedPayment/iu)
  assert.doesNotMatch(source, /async function allocateConfirmedPayment/iu)
})
