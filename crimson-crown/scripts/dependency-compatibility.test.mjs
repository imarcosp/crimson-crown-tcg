import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import axios from 'axios'
import { NextResponse } from 'next/server.js'
import puppeteer, { CdpBrowser, CdpPage, Page } from 'puppeteer'
import { MercadoPagoConfig, Payment } from 'mercadopago'
import { Resend } from 'resend'

const exactReleaseDependencies = Object.freeze({
  axios: '1.20.0',
  mercadopago: '2.12.0',
  next: '16.3.3',
  puppeteer: '25.9.0',
  resend: '6.25.0',
})

const exactReleaseDevDependencies = Object.freeze({
  'eslint-config-next': '16.3.3',
})

const exactAuditedTransitiveDependencies = Object.freeze({
  undici: '7.29.0',
})

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

test('resolves the exact audited release dependency versions', async () => {
  const rootPackage = await readJson(path.join(process.cwd(), 'package.json'))

  for (const [name, version] of Object.entries(exactReleaseDependencies)) {
    assert.equal(rootPackage.dependencies[name], version, `${name} must be pinned exactly`)
    const installedPackage = await readJson(path.join(process.cwd(), 'node_modules', name, 'package.json'))
    assert.equal(installedPackage.version, version, `${name} installed version must match its release pin`)
  }

  for (const [name, version] of Object.entries(exactReleaseDevDependencies)) {
    assert.equal(rootPackage.devDependencies[name], version, `${name} must be pinned exactly`)
    const installedPackage = await readJson(path.join(process.cwd(), 'node_modules', name, 'package.json'))
    assert.equal(installedPackage.version, version, `${name} installed version must match its release pin`)
  }

  for (const [name, version] of Object.entries(exactAuditedTransitiveDependencies)) {
    const installedPackage = await readJson(path.join(process.cwd(), 'node_modules', name, 'package.json'))
    assert.equal(installedPackage.version, version, `${name} installed version must match the audited lockfile`)
  }
})

test('keeps the Next response runtime contract used by route handlers', async () => {
  const response = NextResponse.json({ ok: true }, { status: 202 })

  assert.equal(response.status, 202)
  assert.match(response.headers.get('content-type') || '', /^application\/json/)
  assert.deepEqual(await response.json(), { ok: true })
})

test('keeps the Axios get and configured-client contracts without network I/O', async () => {
  const seen = []
  const adapter = async (config) => {
    seen.push({
      baseURL: config.baseURL,
      method: config.method,
      timeout: config.timeout,
      url: config.url,
    })
    return {
      config,
      data: { cards: 2 },
      headers: {},
      status: 200,
      statusText: 'OK',
    }
  }

  const direct = await axios.get('https://api.example.invalid/cards', {
    adapter,
    timeout: 20_000,
  })
  const client = axios.create({ baseURL: 'https://api.example.invalid', timeout: 30_000 })
  const configured = await client.get('/prices', { adapter })

  assert.deepEqual(direct.data, { cards: 2 })
  assert.deepEqual(configured.data, { cards: 2 })
  assert.deepEqual(seen, [
    {
      baseURL: undefined,
      method: 'get',
      timeout: 20_000,
      url: 'https://api.example.invalid/cards',
    },
    {
      baseURL: 'https://api.example.invalid',
      method: 'get',
      timeout: 30_000,
      url: '/prices',
    },
  ])
})

test('keeps the Puppeteer launch and PDF APIs used by quote generation', () => {
  assert.equal(typeof puppeteer.launch, 'function')
  assert.equal(typeof CdpBrowser.prototype.newPage, 'function')
  assert.equal(typeof Page.prototype.setContent, 'function')
  assert.equal(typeof CdpPage.prototype.pdf, 'function')
  assert.equal(typeof CdpBrowser.prototype.close, 'function')
})

test('keeps the Resend client and email-send API without sending email', () => {
  const client = new Resend('re_local_dependency_contract')

  assert.equal(typeof client.emails.send, 'function')
})

test('keeps the deferred Mercado Pago v2 payment-search surface unchanged', () => {
  const client = new MercadoPagoConfig({ accessToken: 'local_dependency_contract' })
  const payment = new Payment(client)

  assert.equal(typeof payment.search, 'function')
  assert.equal(typeof payment.get, 'function')
})
