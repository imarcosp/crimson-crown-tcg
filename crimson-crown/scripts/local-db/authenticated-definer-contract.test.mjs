import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const matrix = path.join(appRoot, 'scripts', 'local-db', 'authenticated-definer-matrix.mjs')
const baseline = path.join(appRoot, 'docs', 'evidence', 'crimson-p0-security-advisor-baseline.md')

const retainedSignatures = [
  'admin_create_or_restock_product(uuid,jsonb,text)',
  'admin_delete_products(uuid,uuid[],text)',
  'admin_update_product(uuid,uuid,jsonb,text)',
  'append_import_order_user_note(bigint,text)',
  'approve_buylist_transaction(uuid,numeric)',
  'archive_inventory(uuid)',
  'cancel_order_atomic(uuid,boolean,boolean)',
  'create_inventory(text,text,text)',
  'decrement_stock(integer,uuid)',
  'delete_inventory_safely(uuid)',
  'get_inventory_metrics(uuid)',
  'is_admin()',
  'is_commission_admin()',
  'manage_credits(uuid,numeric,text,text,uuid)',
  'place_order_atomic(jsonb,text,text,jsonb,boolean,text,text,text)',
  'refund_order_atomic(uuid,boolean,numeric)',
  'release_expired_orders_atomic(integer,text)',
  'remove_order_item_atomic(uuid,integer,boolean)',
  'restore_order_inventory_atomic(uuid,text)',
  'restore_stock(uuid)',
  'set_inventory_active(uuid,boolean)',
  'submit_order_payment_proof(uuid,text)',
  'transfer_credits(text,numeric,text)',
  'update_profile_details(text,text,text)',
  'user_accept_buylist_offer(uuid)',
]

const gapSignatures = [
  'append_import_order_user_note(bigint,text)',
  'approve_buylist_transaction(uuid,numeric)',
  'archive_inventory(uuid)',
  'cancel_order_atomic(uuid,boolean,boolean)',
  'create_inventory(text,text,text)',
  'delete_inventory_safely(uuid)',
  'get_inventory_metrics(uuid)',
  'manage_credits(uuid,numeric,text,text,uuid)',
  'refund_order_atomic(uuid,boolean,numeric)',
  'remove_order_item_atomic(uuid,integer,boolean)',
  'restore_order_inventory_atomic(uuid,text)',
  'restore_stock(uuid)',
  'set_inventory_active(uuid,boolean)',
  'submit_order_payment_proof(uuid,text)',
  'transfer_credits(text,numeric,text)',
  'update_profile_details(text,text,text)',
  'user_accept_buylist_offer(uuid)',
]

test('la matriz cierra las 17 brechas y niega anon en las 25 firmas retenidas', () => {
  const result = spawnSync(process.execPath, [matrix], {
    cwd: appRoot,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
  assert.equal(result.status, 0, `${result.stdout || ''}\n${result.stderr || ''}`)

  const payload = JSON.parse(result.stdout)
  assert.equal(payload.ok, true)
  assert.equal(payload.catalogVerified, true)
  assert.deepEqual(payload.retainedSignatures, retainedSignatures)
  assert.deepEqual(payload.anonDeniedSignatures, retainedSignatures)
  assert.deepEqual(payload.closedGapSignatures, gapSignatures)
  assert.deepEqual(payload.authorizationProofs, {
    positive: 17,
    internalNegative: 15,
    internalNegativeNotApplicable: [
      'transfer_credits(text,numeric,text)',
      'update_profile_details(text,text,text)',
    ],
  })
  assert.deepEqual(payload.residuals, {
    buylistOrders: 0,
    creditTransactions: 0,
    importOrders: 0,
    notifications: 0,
    orders: 0,
    profileDrift: 0,
  })
})

test('el baseline documenta las 25 excepciones con evidencia verificable', () => {
  const markdown = fs.readFileSync(baseline, 'utf8')
  const block = markdown.match(/<!-- authenticated-definers:start -->([\s\S]*?)<!-- authenticated-definers:end -->/)
  assert.ok(block, 'falta el bloque contractual de definers autenticadas')
  const rows = block[1].split(/\r?\n/).filter((line) => line.startsWith('| `public.'))
  assert.equal(rows.length, retainedSignatures.length)

  const documented = []
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((cell) => cell.trim())
    assert.equal(cells.length, 4, `fila inválida: ${row}`)
    documented.push(cells[0].slice('`public.'.length, -1))
    for (const evidence of cells.slice(1)) {
      const match = evidence.match(/^`([^`]+):(\d+)` · `([^`]+)`$/)
      assert.ok(match, `evidencia inválida: ${evidence}`)
      const evidencePath = path.resolve(appRoot, match[1])
      assert.ok(evidencePath.startsWith(`${appRoot}${path.sep}`), 'evidencia fuera del repositorio')
      const source = fs.readFileSync(evidencePath, 'utf8').split(/\r?\n/)
      assert.match(source[Number(match[2]) - 1] || '', new RegExp(match[3].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  }
  assert.deepEqual(documented, retainedSignatures)
  assert.match(markdown, /Mutable search paths \(24 objetivo\)[^\n]*\| 0 \|/)
  assert.match(markdown, /SECURITY DEFINER ejecutables por `anon`[^\n]*\| 0 \|/)
  assert.match(markdown, /SECURITY DEFINER ejecutables por `authenticated`[^\n]*\| 25 \|/)
  assert.doesNotMatch(block[1], /TODO|BLOCKING|pendiente/i)
})
