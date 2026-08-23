import assert from 'node:assert/strict'
import test from 'node:test'

import { buildSiteConfig } from './site.ts'

test('builds a non-production site configuration for local tests', () => {
  const local = buildSiteConfig(true)

  assert.equal(local.url, 'http://127.0.0.1:3000')
  assert.equal(local.socialLinks.email, 'contact@example.test')
  assert.equal(local.socialLinks.instagram, '/local-test/instagram')
  assert.equal(local.payment.bankOwner, 'Local Test Account')
  assert.equal(local.payment.bankAliasArs, 'local-test')
  assert.equal(local.payment.bankCbuArs, '0000000000000000000000')
})

test('keeps the configured production site values outside loopback', () => {
  const production = buildSiteConfig(false)

  assert.equal(production.url, 'https://www.crimsoncrownimports.com')
  assert.equal(production.socialLinks.email, 'crimsoncrownimports@gmail.com')
})
