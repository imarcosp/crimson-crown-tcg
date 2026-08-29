import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import { buildClassifiedEntries } from './bootstrap-migration-manifest.mjs'
import { loadAndValidateManifest } from './migration-manifest.mjs'

const execFileAsync = promisify(execFile)
const fixtureProjectRef = 'djfqozfaqkqdoqeoqbzt'
const alphaFile = '20240101000000_alpha.sql'
const betaFile = '20240102000000_beta.sql'
const alphaHash = 'b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060'
const betaHash = 'f2c82decdd7181cf98945929a62598db7e6b477e11f6e0eb0ae97020eff151ad'
const bootstrapScript = resolve('scripts/release/bootstrap-migration-manifest.mjs')

function completeFixtureManifest(entries = [
  { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash },
  { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
]) {
  return {
    schemaVersion: 1,
    productionProjectRef: fixtureProjectRef,
    entries,
  }
}

async function withFixture(callback, manifest = completeFixtureManifest()) {
  const rootDir = await mkdtemp(join(tmpdir(), 'crimson-migration-manifest-'))
  const migrationsDir = join(rootDir, 'supabase', 'migrations')
  const manifestPath = join(rootDir, 'scripts', 'release', 'migration-manifest.json')

  await mkdir(migrationsDir, { recursive: true })
  await writeFile(join(migrationsDir, alphaFile), 'alpha\n')
  await writeFile(join(migrationsDir, betaFile), 'beta\n')
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  try {
    await callback(rootDir, manifestPath)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
}

test('loads a complete fixture with literal classifications and hashes', async () => {
  await withFixture(async (rootDir) => {
    const manifest = await loadAndValidateManifest({ rootDir, allowCandidates: true })

    assert.deepEqual(manifest.entries, [
      { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash },
      { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
    ])
  })
})

test('every migration is classified exactly once and hashes match', async () => {
  const manifest = await loadAndValidateManifest({ rootDir: process.cwd(), allowCandidates: true })
  const classified = manifest.entries.map((entry) => entry.file).sort()
  const actual = (await readdir('supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()

  assert.deepEqual(classified, actual)
})

test('projection is blocked while a remote pair is only a candidate', async () => {
  await assert.rejects(
    () => loadAndValidateManifest({ rootDir: process.cwd(), allowCandidates: false }),
    /equivalencia remota sin verificar/,
  )
})

test('projection rejects a candidate unless allowCandidates is the literal boolean true', async () => {
  const manifest = completeFixtureManifest([
    {
      class: 'remote_applied',
      version: '20240101000000',
      remoteName: 'fixture_remote',
      file: alphaFile,
      sha256: alphaHash,
      equivalence: 'candidate',
    },
    { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
  ])

  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: 'true' }),
      /equivalencia remota sin verificar/,
    ),
    manifest,
  )
})

test('rejects a local classification whose version disagrees with its filename prefix', async () => {
  const manifest = completeFixtureManifest([
    { class: 'baseline_present', version: '20240103000000', file: alphaFile, sha256: alphaHash },
    { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
  ])

  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
      /versión de migración no coincide con el archivo/,
    ),
    manifest,
  )
})

test('rejects a duplicate migration version', async () => {
  const manifest = completeFixtureManifest([
    { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash },
    { class: 'forward_pending', version: '20240101000000', file: betaFile, sha256: betaHash },
  ])

  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
      (error) => error.message === 'versión de migración duplicada',
    ),
    manifest,
  )
})

test('rejects a manifest file that is not a migration', async () => {
  const manifest = completeFixtureManifest([
    { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash },
    { class: 'forward_pending', version: '20240102000000', file: '20240103000000_unknown.sql', sha256: betaHash },
  ])

  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
      (error) => error.message === 'archivo de migración desconocido',
    ),
    manifest,
  )
})

test('rejects a changed migration hash', async () => {
  const manifest = completeFixtureManifest([
    { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash },
    { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: '0000000000000000000000000000000000000000000000000000000000000000' },
  ])

  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
      (error) => error.message === 'hash SHA-256 no coincide',
    ),
    manifest,
  )
})

test('validation errors never echo untrusted manifest values', async () => {
  const marker = 'untrusted-manifest-value'
  const cases = [
    {
      manifest: { ...completeFixtureManifest(), productionProjectRef: marker },
      expectedMessage: 'referencia de proyecto de producción no permitida',
    },
    {
      manifest: completeFixtureManifest([
        { class: 'baseline_present', version: marker, file: alphaFile, sha256: alphaHash },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
      expectedMessage: 'versión de migración inválida',
    },
    {
      manifest: completeFixtureManifest([
        { class: 'baseline_present', version: '20240101000000', file: marker, sha256: alphaHash },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
      expectedMessage: 'archivo de migración inválido',
    },
    {
      manifest: completeFixtureManifest([
        { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: marker },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
      expectedMessage: 'hash SHA-256 inválido',
    },
  ]

  for (const { manifest, expectedMessage } of cases) {
    await withFixture(
      (rootDir) => assert.rejects(
        () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
        (error) => error.message === expectedMessage && !error.message.includes(marker),
      ),
      manifest,
    )
  }
})

test('rejects a migration assigned to two classes', async () => {
  const manifest = completeFixtureManifest([
    { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash },
    { class: 'forward_pending', version: '20240102000000', file: alphaFile, sha256: alphaHash },
    { class: 'forward_pending', version: '20240103000000', file: betaFile, sha256: betaHash },
  ])

  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
      (error) => error.message === 'archivo asignado a más de una clase',
    ),
    manifest,
  )
})

test('bootstrap classification rejects distinct files with a duplicate version', () => {
  assert.throws(
    () => buildClassifiedEntries({
      remoteApplied: [
        ['20240101000000', 'fixture_one', '20240101000000_one.sql'],
        ['20240101000000', 'fixture_two', '20240102000000_two.sql'],
      ],
      baselinePresent: [],
      forwardPending: [],
    }),
    (error) => error.message === 'versión de migración duplicada',
  )
})

test('bootstrap creates a complete manifest and refuses to replace it', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'crimson-migration-bootstrap-'))

  try {
    await cp(resolve('supabase', 'migrations'), join(rootDir, 'supabase', 'migrations'), { recursive: true })

    await execFileAsync(process.execPath, [bootstrapScript], { cwd: rootDir })
    const manifest = await loadAndValidateManifest({ rootDir, allowCandidates: true })

    assert.equal(manifest.entries.length, 22)
    assert.deepEqual(manifest.entries.slice(0, 2), [
      {
        class: 'remote_applied',
        version: '20260826210617',
        remoteName: 'production_runtime_functions',
        file: '20260826120000_production_runtime_functions.sql',
        sha256: '1495f5ccbd382224fa5c28312ecc488f29ad8bd680020dda73e9f68a183388f3',
        equivalence: 'candidate',
      },
      {
        class: 'remote_applied',
        version: '20260826210725',
        remoteName: 'revoke_is_admin_anon',
        file: '20260826121500_revoke_is_admin_anon.sql',
        sha256: '9ccca376f02452f82481037f25646b1fc47812dd3e1966437f0fa8e0784dddcd',
        equivalence: 'candidate',
      },
    ])

    await assert.rejects(
      () => execFileAsync(process.execPath, [bootstrapScript], { cwd: rootDir }),
      /el manifiesto ya existe/,
    )
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('bootstrap refuses a migration tree missing a classified file', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'crimson-migration-bootstrap-missing-'))

  try {
    await cp(resolve('supabase', 'migrations'), join(rootDir, 'supabase', 'migrations'), { recursive: true })
    await unlink(join(rootDir, 'supabase', 'migrations', '20260829021742_admin_product_mutations.sql'))

    await assert.rejects(
      () => execFileAsync(process.execPath, [bootstrapScript], { cwd: rootDir }),
      /archivo de migración clasificado no existe: 20260829021742_admin_product_mutations\.sql/,
    )
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
