import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const productionProjectRef = 'djfqozfaqkqdoqeoqbzt'
const remoteApplied = [
  ['20260826210617', 'production_runtime_functions', '20260826120000_production_runtime_functions.sql'],
  ['20260826210725', 'revoke_is_admin_anon', '20260826121500_revoke_is_admin_anon.sql'],
  ['20260827051550', 'create_multi_inventory_system', '20260827020755_create_multi_inventory_system.sql'],
  ['20260827051604', 'multi_inventory_runtime_functions', '20260827020830_multi_inventory_runtime_functions.sql'],
  ['20260827051615', 'add_external_prices_name_search_index', '20260827024000_add_external_prices_name_search_index.sql'],
]

const baselinePresent = [
  '20231218_add_tcg_columns.sql',
  '20240701000000_search_functions.sql',
  '202606100001_commission_start_guard.sql',
  '202606100002_add_external_prices_catalog_support.sql',
  '20260615000300_add_admin_manual_buylist_quotes.sql',
  '20260823043500_production_compatibility_baseline.sql',
  '20260823043637_local_security_baseline.sql',
  '20260823044210_fix_merge_duplicate_products_lint.sql',
  '20260823044710_restrict_decrement_stock_rpc.sql',
  '20260823044936_restrict_user_credit_adjustments.sql',
  '20260823050711_local_write_surface_hardening.sql',
  '20260823051113_preserve_production_admin_allowlist.sql',
  '20260823140924_append_import_order_user_note.sql',
  '20260823142117_normalize_import_admin_policies.sql',
  '20260823173257_create_place_order_atomic.sql',
  '20260823183638_create_release_expired_orders_atomic.sql',
]

const forwardPending = ['20260829021742_admin_product_mutations.sql']

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function migrationVersion(file) {
  return file.slice(0, file.indexOf('_'))
}

function candidateReleaseProof() {
  return { status: 'candidate', evidence: null, remediationVersions: [] }
}

export function buildClassifiedEntries({ remoteApplied, baselinePresent, forwardPending }) {
  const entries = []
  const classifiedFiles = new Set()
  const versions = new Set()

  const addEntry = (entry) => {
    if (classifiedFiles.has(entry.file)) {
      throw new Error('archivo de migración clasificado más de una vez')
    }
    if (versions.has(entry.version)) {
      throw new Error('versión de migración duplicada')
    }
    classifiedFiles.add(entry.file)
    versions.add(entry.version)
    entries.push(entry)
  }

  for (const [version, remoteName, file] of remoteApplied) {
    addEntry({ class: 'remote_applied', version, remoteName, file, releaseProof: candidateReleaseProof() })
  }
  for (const file of baselinePresent) {
    addEntry({ class: 'baseline_present', version: migrationVersion(file), file, releaseProof: candidateReleaseProof() })
  }
  for (const file of forwardPending) {
    addEntry({ class: 'forward_pending', version: migrationVersion(file), file })
  }

  return entries
}

async function hashMigration(migrationsPath, file) {
  return sha256(await readFile(join(migrationsPath, file)))
}

async function manifestExists(manifestPath) {
  try {
    await stat(manifestPath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function bootstrap() {
  const rootDir = resolve(process.cwd())
  const migrationsPath = join(rootDir, 'supabase', 'migrations')
  const manifestPath = join(rootDir, 'scripts', 'release', 'migration-manifest.json')

  if (await manifestExists(manifestPath)) {
    throw new Error('el manifiesto ya existe; el bootstrap no lo reemplaza')
  }

  const actualFiles = new Set((await readdir(migrationsPath)).filter((file) => file.endsWith('.sql')))
  const entries = buildClassifiedEntries({ remoteApplied, baselinePresent, forwardPending })
  const classifiedFiles = new Set(entries.map((entry) => entry.file))
  const hashedEntries = []

  for (const entry of entries) {
    if (!actualFiles.has(entry.file)) {
      throw new Error(`archivo de migración clasificado no existe: ${entry.file}`)
    }
    hashedEntries.push({ ...entry, sha256: await hashMigration(migrationsPath, entry.file) })
  }

  for (const file of actualFiles) {
    if (!classifiedFiles.has(file)) {
      throw new Error(`archivo de migración sin clasificar: ${file}`)
    }
  }

  await mkdir(join(rootDir, 'scripts', 'release'), { recursive: true })
  await writeFile(
    manifestPath,
    `${JSON.stringify({ schemaVersion: 2, productionProjectRef, entries: hashedEntries }, null, 2)}\n`,
    { flag: 'wx' },
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bootstrap().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
