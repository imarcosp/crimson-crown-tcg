import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { win32 as windowsPath } from 'node:path'

import dotenv from 'dotenv'

import { createOperationalSupabaseClient as createClient } from '../lib/guarded-supabase-client.mjs'

const LOCAL_API_URL = 'http://127.0.0.1:54621/'
const CRIMSON_PRODUCTION_ORIGIN = 'https://djfqozfaqkqdoqeoqbzt.supabase.co'
const EXPECTED_STACK_WORKDIR = 'D:\\crimson-crown-tcg\\crimson-crown'
const LEGACY_PREFIX = '/storage/v1/object/public/payment_proofs/'
const SAFE_PATH_PATTERN = /^[a-zA-Z0-9._/-]+\.(?:jpg|jpeg|png|webp|pdf)$/iu
const UPDATE_BATCH_SIZE = 50
const READ_PAGE_SIZE = 500

const DOMAIN_CONFIG = Object.freeze([
  Object.freeze({
    domain: 'order',
    table: 'orders',
    pathColumn: 'payment_proof_path',
    legacyColumn: 'payment_proof_url',
    select: 'id,payment_proof_path,payment_proof_url',
  }),
  Object.freeze({
    domain: 'import',
    table: 'import_orders',
    pathColumn: 'payment_proof_path',
    legacyColumn: 'payment_proof_url',
    select: 'id,payment_proof_path,payment_proof_url',
  }),
  Object.freeze({
    domain: 'commission',
    table: 'commission_payments',
    pathColumn: 'proof_path',
    legacyColumn: 'proof_url',
    select: 'id,proof_path,proof_url,commission_periods!inner(period_key)',
  }),
])

function isSafeStoragePath(path) {
  if (typeof path !== 'string' || !path || path.length > 256 || !SAFE_PATH_PATTERN.test(path)) {
    return false
  }
  if (
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('//') ||
    path.includes('\\') ||
    path.includes('%') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    return false
  }
  return path.split('/').every((segment) => segment !== '.' && segment !== '..' && segment.length > 0)
}

function parseTask6LegacyPath(rawUrl, allowedOrigin) {
  if (
    typeof rawUrl !== 'string' ||
    rawUrl.length === 0 ||
    rawUrl !== rawUrl.trim() ||
    rawUrl.includes('\\') ||
    rawUrl.includes('%') ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(rawUrl)
  ) {
    return null
  }

  try {
    const allowed = new URL(allowedOrigin)
    const candidate = new URL(rawUrl)
    if (
      allowed.pathname !== '/' ||
      allowed.search ||
      allowed.hash ||
      allowed.username ||
      allowed.password ||
      candidate.origin !== allowed.origin ||
      candidate.username ||
      candidate.password ||
      candidate.search ||
      candidate.hash ||
      !candidate.pathname.startsWith(LEGACY_PREFIX)
    ) {
      return null
    }

    const path = candidate.pathname.slice(LEGACY_PREFIX.length)
    return isSafeStoragePath(path) ? path : null
  } catch {
    return null
  }
}

function isLegacyPathForRecord(record, path) {
  const extension = '(?:[jJ][pP][gG]|[jJ][pP][eE][gG]|[pP][nN][gG]|[wW][eE][bB][pP]|[pP][dD][fF])'
  if (record.domain === 'order') {
    return new RegExp(`^stock_${record.id}_[0-9]{13}\\.${extension}$`, 'u').test(path)
  }
  if (record.domain === 'import') {
    return new RegExp(`^import_${record.id}_[0-9]{13}\\.${extension}$`, 'u').test(path)
  }
  if (!record.legacyScopeKey || !/^[0-9]{4}-(?:0[1-9]|1[0-2])$/u.test(record.legacyScopeKey)) {
    return false
  }
  return new RegExp(
    `^commission-payments/${record.legacyScopeKey}/[0-9]{13}-[a-zA-Z0-9._-]+\\.${extension}$`,
    'u',
  ).test(path)
}

function idFragment(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9]/gu, '')
  return safe.length >= 8 ? safe.slice(0, 8) : safe.padStart(8, '0')
}

export function loadLocalBackfillEnvironment(environment) {
  const url = environment?.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = environment?.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = environment?.SUPABASE_SERVICE_ROLE_KEY
  let parsedUrl = null
  try {
    parsedUrl = url ? new URL(url) : null
  } catch {
    parsedUrl = null
  }
  if (
    !url ||
    !anonKey ||
    !serviceKey ||
    parsedUrl?.toString() !== LOCAL_API_URL ||
    parsedUrl.protocol !== 'http:' ||
    parsedUrl.hostname !== '127.0.0.1' ||
    parsedUrl.port !== '54621' ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.pathname !== '/' ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error('El backfill sólo puede usar el API local exacto http://127.0.0.1:54621/.')
  }
  return Object.freeze({ url: parsedUrl.toString(), anonKey, serviceKey })
}

function assertPublishedPort(container, containerPort, expectedHostPort) {
  const bindings = container?.HostConfig?.PortBindings?.[containerPort]
  if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0]?.HostPort !== expectedHostPort) {
    throw new Error('El binding del stack local exacto de Crimson no coincide.')
  }
}

export function assertExactLocalCrimsonStack() {
  const inspected = spawnSync(
    'docker',
    ['inspect', 'supabase_kong_crimson-crown', 'supabase_db_crimson-crown'],
    { encoding: 'utf8', shell: false, windowsHide: true },
  )
  if (inspected.error || inspected.status !== 0) {
    throw new Error('No se pudo verificar el stack local exacto de Crimson.')
  }

  let containers
  try {
    containers = JSON.parse(inspected.stdout)
  } catch {
    throw new Error('Docker no devolvió una identidad local verificable.')
  }
  if (!Array.isArray(containers) || containers.length !== 2) {
    throw new Error('El stack local exacto de Crimson está incompleto.')
  }

  const api = containers.find((container) => container.Name === '/supabase_kong_crimson-crown')
  const database = containers.find((container) => container.Name === '/supabase_db_crimson-crown')
  if (api?.State?.Running !== true || database?.State?.Running !== true) {
    throw new Error('El stack local exacto de Crimson no está activo.')
  }
  assertPublishedPort(api, '8000/tcp', '54621')
  assertPublishedPort(database, '5432/tcp', '54622')

  const expectedWorkdir = windowsPath.resolve(EXPECTED_STACK_WORKDIR).toLowerCase()
  for (const container of [api, database]) {
    const labels = container?.Config?.Labels ?? {}
    const actualWorkdir = windowsPath.resolve(labels['com.supabase.cli.workdir'] ?? '').toLowerCase()
    if (
      labels['com.docker.compose.project'] !== 'crimson-crown' ||
      labels['com.supabase.cli.project'] !== 'crimson-crown' ||
      actualWorkdir !== expectedWorkdir
    ) {
      throw new Error('La identidad Docker/Supabase no corresponde al proyecto Crimson Crown.')
    }
  }
}

export function classifyLegacyProof(record) {
  if (record.path !== null && record.path !== undefined) return Object.freeze({ kind: 'alreadyPathed' })
  if (typeof record.legacyUrl !== 'string') return Object.freeze({ kind: 'invalidFormat' })

  let candidate
  try {
    candidate = new URL(record.legacyUrl)
  } catch {
    return Object.freeze({ kind: 'invalidFormat' })
  }
  if (!['http:', 'https:'].includes(candidate.protocol)) {
    return Object.freeze({ kind: 'invalidFormat' })
  }

  const allowedOrigins = new Set([LOCAL_API_URL.slice(0, -1), CRIMSON_PRODUCTION_ORIGIN])
  if (!allowedOrigins.has(candidate.origin)) return Object.freeze({ kind: 'foreignUrl' })

  const path = parseTask6LegacyPath(record.legacyUrl, `${candidate.origin}/`)
  if (!path || !isLegacyPathForRecord(record, path)) {
    return Object.freeze({ kind: 'invalidFormat' })
  }
  return Object.freeze({ kind: 'candidate', path })
}

export function classifyStorageObjectResult(data, error) {
  if (data && !error) return 'exists'
  if (
    !data &&
    error &&
    typeof error === 'object' &&
    error.name === 'StorageApiError' &&
    [400, 404].includes(error.status) &&
    String(error.statusCode) === '404'
  ) {
    return 'missing'
  }
  throw new Error('El estado del objeto Storage no es verificable; backfill abortado.')
}

export function chunkCandidates(candidates) {
  const chunks = []
  for (let index = 0; index < candidates.length; index += UPDATE_BATCH_SIZE) {
    chunks.push(candidates.slice(index, index + UPDATE_BATCH_SIZE))
  }
  return chunks
}

async function fetchDomainRecords(service, config) {
  const records = []
  for (let from = 0; ; from += READ_PAGE_SIZE) {
    const to = from + READ_PAGE_SIZE - 1
    const response = await service
      .from(config.table)
      .select(config.select)
      .or(`${config.pathColumn}.not.is.null,${config.legacyColumn}.not.is.null`)
      .order('id', { ascending: true })
      .range(from, to)
    if (response.error) {
      throw new Error(`No se pudo leer ${config.domain}; backfill abortado.`)
    }

    for (const row of response.data ?? []) {
      const period = Array.isArray(row.commission_periods)
        ? row.commission_periods[0]
        : row.commission_periods
      records.push(Object.freeze({
        domain: config.domain,
        table: config.table,
        id: String(row.id),
        path: row[config.pathColumn],
        legacyUrl: row[config.legacyColumn],
        legacyScopeKey: config.domain === 'commission' ? period?.period_key ?? null : null,
        pathColumn: config.pathColumn,
        legacyColumn: config.legacyColumn,
      }))
    }
    if ((response.data?.length ?? 0) < READ_PAGE_SIZE) break
  }
  return records
}

export async function fetchBackfillRecords(service) {
  const records = []
  for (const config of DOMAIN_CONFIG) {
    records.push(...await fetchDomainRecords(service, config))
  }
  return records
}

async function applyCandidate(service, candidate) {
  let query = service
    .from(candidate.record.table)
    .update({ [candidate.record.pathColumn]: candidate.path })
    .eq('id', candidate.record.id)
    .is(candidate.record.pathColumn, null)
  query = candidate.record.legacyUrl === null
    ? query.is(candidate.record.legacyColumn, null)
    : query.eq(candidate.record.legacyColumn, candidate.record.legacyUrl)
  const response = await query.select('id')
  if (response.error) {
    throw new Error(`Falló el update local ${candidate.record.domain}/${idFragment(candidate.record.id)}.`)
  }
  if (!Array.isArray(response.data) || response.data.length !== 1) {
    throw new Error(`Se detectó una carrera concurrente en ${candidate.record.domain}/${idFragment(candidate.record.id)}.`)
  }
}

export async function runPaymentProofBackfill({ service, records, apply = false }) {
  if (apply !== true && apply !== false) throw new Error('Modo de backfill inválido.')
  const report = {
    scanned: 0,
    resolvable: 0,
    missingObject: 0,
    foreignUrl: 0,
    invalidFormat: 0,
    alreadyPathed: 0,
  }
  const exceptions = []
  const candidates = []

  for (const record of records) {
    report.scanned += 1
    const classification = classifyLegacyProof(record)
    if (classification.kind === 'alreadyPathed') {
      report.alreadyPathed += 1
      continue
    }
    if (classification.kind === 'foreignUrl' || classification.kind === 'invalidFormat') {
      report[classification.kind] += 1
      exceptions.push(Object.freeze({
        domain: record.domain,
        id: idFragment(record.id),
        reason: classification.kind,
      }))
      continue
    }

    const object = await service.storage.from('payment_proofs').info(classification.path)
    const objectState = classifyStorageObjectResult(object.data, object.error)
    if (objectState === 'missing') {
      report.missingObject += 1
      exceptions.push(Object.freeze({
        domain: record.domain,
        id: idFragment(record.id),
        reason: 'missingObject',
      }))
      continue
    }
    report.resolvable += 1
    candidates.push(Object.freeze({ record, path: classification.path }))
  }

  if (apply) {
    for (const batch of chunkCandidates(candidates)) {
      await Promise.all(batch.map((candidate) => applyCandidate(service, candidate)))
    }
  }

  return Object.freeze({
    mode: apply ? 'apply' : 'dry-run',
    report: Object.freeze(report),
    exceptions: Object.freeze(exceptions),
  })
}

export function formatBackfillOutput(result) {
  return JSON.stringify({
    mode: result.mode,
    report: result.report,
    exceptions: result.exceptions,
  }, null, 2)
}

function parseMode(arguments_) {
  if (arguments_.length === 0) return false
  if (arguments_.length === 1 && arguments_[0] === '--apply') return true
  throw new Error('Uso: node scripts/local-db/payment-proof-backfill.mjs [--apply]')
}

async function main() {
  const apply = parseMode(process.argv.slice(2))
  dotenv.config({ path: '.env.test.local', override: true })
  const environment = loadLocalBackfillEnvironment(process.env)
  assertExactLocalCrimsonStack()
  const service = createClient(environment.url, environment.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const records = await fetchBackfillRecords(service)
  const result = await runPaymentProofBackfill({ service, records, apply })
  console.log(formatBackfillOutput(result))
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
