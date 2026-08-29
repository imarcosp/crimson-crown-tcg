import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import axios, { AxiosError } from 'axios'
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

test('uses the verified Webpack build path after the deployment guard', async () => {
  const rootPackage = await readJson(path.join(process.cwd(), 'package.json'))

  assert.equal(
    rootPackage.scripts.build,
    'node scripts/assert-deployment-environment.mjs && next build --webpack',
  )
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

test('keeps Axios params, custom headers, and validateStatus in configured requests', async () => {
  let seen
  const adapter = async (config) => {
    seen = {
      acceptLanguage: config.headers.get('Accept-Language'),
      apiKey: config.headers.get('X-API-Key'),
      baseURL: config.baseURL,
      params: config.params,
      status399Accepted: config.validateStatus(399),
      status400Accepted: config.validateStatus(400),
      url: config.url,
    }
    return {
      config,
      data: { cards: [] },
      headers: {},
      status: 200,
      statusText: 'OK',
    }
  }
  const client = axios.create({
    baseURL: 'https://api.example.invalid',
    headers: { 'X-API-Key': 'local-contract-key' },
    timeout: 30_000,
  })

  const response = await client.get('/cards', {
    adapter,
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    params: { game: 'Riftbound', page: 2 },
    validateStatus: (status) => status >= 200 && status < 400,
  })

  assert.deepEqual(response.data, { cards: [] })
  assert.deepEqual(seen, {
    acceptLanguage: 'en-US,en;q=0.9',
    apiKey: 'local-contract-key',
    baseURL: 'https://api.example.invalid',
    params: { game: 'Riftbound', page: 2 },
    status399Accepted: true,
    status400Accepted: false,
    url: '/cards',
  })
})

test('keeps the Axios error response and request config used by script handlers', async () => {
  const adapter = async (config) => {
    const response = {
      config,
      data: { error: 'temporarily unavailable' },
      headers: {},
      status: 503,
      statusText: 'Service Unavailable',
    }
    throw new AxiosError('Request failed with status code 503', 'ERR_BAD_RESPONSE', config, undefined, response)
  }

  await assert.rejects(
    axios.get('https://api.example.invalid/cards/example-id', {
      adapter,
      headers: { Accept: 'application/json' },
      timeout: 20_000,
    }),
    (error) => {
      assert.equal(axios.isAxiosError(error), true)
      assert.equal(error.code, 'ERR_BAD_RESPONSE')
      assert.equal(error.config.method, 'get')
      assert.equal(error.config.timeout, 20_000)
      assert.equal(error.config.url, 'https://api.example.invalid/cards/example-id')
      assert.equal(error.config.headers.get('Accept'), 'application/json')
      assert.equal(error.response.status, 503)
      assert.deepEqual(error.response.data, { error: 'temporarily unavailable' })
      return true
    },
  )
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
