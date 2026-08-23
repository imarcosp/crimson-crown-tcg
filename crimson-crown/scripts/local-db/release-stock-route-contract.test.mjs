import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const routeSource = await readFile(new URL('../../src/app/api/cron/release-stock/route.ts', import.meta.url), 'utf8')

test('el cron delega la liberación financiera a la RPC atómica', () => {
  assert.match(routeSource, /\.rpc\(['"]release_expired_orders_atomic['"]\s*,/)
  assert.doesNotMatch(routeSource, /\.from\(['"]products['"]\)\.update/)
  assert.doesNotMatch(routeSource, /\.from\(['"]orders['"]\)\.update/)
  assert.doesNotMatch(routeSource, /\.from\(['"]order_items['"]\)\.select/)
})
