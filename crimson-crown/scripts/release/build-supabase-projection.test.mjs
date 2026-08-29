import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { buildProjection } from './build-supabase-projection.mjs'

const sourceRoot = resolve(process.cwd())
const fixtureEntries = [
  {
    class: 'remote_applied',
    version: '20260826210617',
    remoteName: 'production_runtime_functions',
    file: '20260826120000_production_runtime_functions.sql',
    sha256: '1495f5ccbd382224fa5c28312ecc488f29ad8bd680020dda73e9f68a183388f3',
    equivalence: 'verified',
  },
  {
    class: 'remote_applied',
    version: '20260826210725',
    remoteName: 'revoke_is_admin_anon',
    file: '20260826121500_revoke_is_admin_anon.sql',
    sha256: '9ccca376f02452f82481037f25646b1fc47812dd3e1966437f0fa8e0784dddcd',
    equivalence: 'verified',
  },
  {
    class: 'remote_applied',
    version: '20260827051550',
    remoteName: 'create_multi_inventory_system',
    file: '20260827020755_create_multi_inventory_system.sql',
    sha256: '71f827c3d33fad843e1324fa4566be56d662c27d9da9e0f781eaacfa418a0080',
    equivalence: 'verified',
  },
  {
    class: 'remote_applied',
    version: '20260827051604',
    remoteName: 'multi_inventory_runtime_functions',
    file: '20260827020830_multi_inventory_runtime_functions.sql',
    sha256: '0ec9d9c609d0cd30f9bf0d3089f983a2cf4d2dea5ef4a641594e5df38b801210',
    equivalence: 'verified',
  },
  {
    class: 'remote_applied',
    version: '20260827051615',
    remoteName: 'add_external_prices_name_search_index',
    file: '20260827024000_add_external_prices_name_search_index.sql',
    sha256: '3deec1275e2079c80c5f0c5782c2b8580ee17433f28cb4ff21e998a70f1be39f',
    equivalence: 'verified',
  },
  {
    class: 'baseline_present',
    version: '20231218',
    file: '20231218_add_tcg_columns.sql',
    sha256: 'e16166248daf1b0f72c31ae7a3b6b12530c064a73c919841a2468ed2617c2647',
  },
  {
    class: 'forward_pending',
    version: '20260829021742',
    file: '20260829021742_admin_product_mutations.sql',
    sha256: '52d24ebf8abe6727df7da45ca723d8226f7aa433e3ef527aef7b598376187112',
  },
]

function parseToml(text) {
  const result = {}
  let section = result

  for (const line of text.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = result
      for (const part of sectionMatch[1].split('.')) {
        section[part] ??= {}
        section = section[part]
      }
      continue
    }

    const valueMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(true|false)$/)
    if (valueMatch) {
      section[valueMatch[1]] = valueMatch[2] === 'true'
    }
  }

  return result
}

async function withFixture(callback, { config } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'crimson-release-projection-root-'))
  const outputParent = await mkdtemp(join(tmpdir(), 'crimson-release-projection-output-'))
  const outputDir = join(outputParent, 'projection')
  const migrationsDir = join(rootDir, 'supabase', 'migrations')
  const manifestPath = join(rootDir, 'scripts', 'release', 'migration-manifest.json')

  await mkdir(migrationsDir, { recursive: true })
  await mkdir(dirname(manifestPath), { recursive: true })
  await cp(join(sourceRoot, 'supabase', 'config.toml'), join(rootDir, 'supabase', 'config.toml'))
  for (const entry of fixtureEntries) {
    await cp(join(sourceRoot, 'supabase', 'migrations', entry.file), join(migrationsDir, entry.file))
  }
  if (config !== undefined) {
    await writeFile(join(rootDir, 'supabase', 'config.toml'), config)
  }
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    productionProjectRef: 'djfqozfaqkqdoqeoqbzt',
    entries: fixtureEntries,
  }, null, 2)}\n`)

  try {
    await callback({ rootDir, outputDir, outputParent })
  } finally {
    await rm(rootDir, { recursive: true, force: true })
    await rm(outputParent, { recursive: true, force: true })
  }
}

test('builds a migration-only projection from a verified manifest', async () => {
  await withFixture(async ({ rootDir, outputDir }) => {
    await buildProjection({ rootDir, outputDir })

    const parsedConfig = parseToml(await readFile(join(outputDir, 'supabase', 'config.toml'), 'utf8'))
    const projectedFiles = await readdir(join(outputDir, 'supabase', 'migrations'))

    assert.equal(parsedConfig.db.migrations.enabled, true)
    assert.deepEqual(await readdir(outputDir), ['supabase'])
    assert.deepEqual((await readdir(join(outputDir, 'supabase'))).sort(), ['config.toml', 'migrations'])
    assert.deepEqual(
      projectedFiles.sort(),
      [
        '20260826210617_production_runtime_functions.sql',
        '20260826210725_revoke_is_admin_anon.sql',
        '20260827051550_create_multi_inventory_system.sql',
        '20260827051604_multi_inventory_runtime_functions.sql',
        '20260827051615_add_external_prices_name_search_index.sql',
        '20260829021742_admin_product_mutations.sql',
      ],
    )
    assert.equal(
      await readFile(join(outputDir, 'supabase', 'migrations', '20260826210617_production_runtime_functions.sql'), 'utf8'),
      '-- release projection: remote_version=20260826210617 remote_name=production_runtime_functions local_source_sha256=1495f5ccbd382224fa5c28312ecc488f29ad8bd680020dda73e9f68a183388f3\n',
    )
    assert.deepEqual(
      await readFile(join(outputDir, 'supabase', 'migrations', '20260829021742_admin_product_mutations.sql')),
      await readFile(join(rootDir, 'supabase', 'migrations', '20260829021742_admin_product_mutations.sql')),
    )
  })
})

test('returns an immutable forward summary from the validated manifest snapshot', async () => {
  await withFixture(async ({ rootDir, outputDir }) => {
    const summary = await buildProjection({ rootDir, outputDir })

    assert.deepEqual(summary, { forwardPendingCount: 1 })
    assert.equal(Object.isFrozen(summary), true)
  })
})

test('rejects a projection destination inside the repository outside release evidence', async () => {
  await withFixture(async ({ rootDir }) => {
    await assert.rejects(
      () => buildProjection({ rootDir, outputDir: join(rootDir, 'projection') }),
      /directorio de proyección dentro del repositorio no permitido/,
    )
  })
})

test('permits release evidence inside the ignored repository location', async () => {
  await withFixture(async ({ rootDir }) => {
    const outputDir = join(rootDir, 'local-artifacts', 'release-evidence', 'projection')
    await mkdir(dirname(outputDir), { recursive: true })

    await buildProjection({ rootDir, outputDir })

    assert.equal(
      (await readFile(join(outputDir, 'supabase', 'config.toml'), 'utf8')).includes('enabled = true'),
      true,
    )
  })
})

test('requires exactly one disabled migrations setting in the source config', async () => {
  await withFixture(
    async ({ rootDir, outputDir }) => {
      await assert.rejects(
        () => buildProjection({ rootDir, outputDir }),
        /configuración de migraciones inválida/,
      )
    },
    { config: '[db.migrations]\nenabled = false\nenabled = false\n' },
  )
})

test('refuses an existing output reservation without overwriting it', async () => {
  await withFixture(async ({ rootDir, outputDir }) => {
    await mkdir(outputDir)
    await writeFile(join(outputDir, 'caller-owned.txt'), 'do not replace\n')

    await assert.rejects(
      () => buildProjection({ rootDir, outputDir }),
      /directorio de proyección ya existe/,
    )
    assert.equal(await readFile(join(outputDir, 'caller-owned.txt'), 'utf8'), 'do not replace\n')
  })
})

test('refuses an empty output collision before creating projection files', async () => {
  await withFixture(async ({ rootDir, outputDir }) => {
    await mkdir(outputDir)

    await assert.rejects(
      () => buildProjection({ rootDir, outputDir }),
      /directorio de proyección ya existe/,
    )
    assert.deepEqual(await readdir(outputDir), [])
  })
})

test('requires an existing immediate parent for the output reservation', async () => {
  await withFixture(async ({ rootDir, outputParent }) => {
    await assert.rejects(
      () => buildProjection({ rootDir, outputDir: join(outputParent, 'missing-parent', 'projection') }),
      /directorio padre de proyección no disponible/,
    )
  })
})

test('rejects an external-looking output whose junction parent resolves inside the repository', async (t) => {
  await withFixture(async ({ rootDir, outputParent }) => {
    const junctionParent = join(outputParent, 'repository-alias')

    try {
      await symlink(rootDir, junctionParent, 'junction')
    } catch (error) {
      t.skip(`junction unavailable on this host: ${error.code ?? 'unknown error'}`)
      return
    }

    await assert.rejects(
      () => buildProjection({ rootDir, outputDir: join(junctionParent, 'projection') }),
      /directorio de proyección dentro del repositorio no permitido/,
    )
  })
})

test('rejects a release-evidence junction that expands the internal exception', async (t) => {
  await withFixture(async ({ rootDir }) => {
    const evidenceParent = join(rootDir, 'local-artifacts')
    const evidenceAlias = join(evidenceParent, 'release-evidence')
    await mkdir(evidenceParent)

    try {
      await symlink(rootDir, evidenceAlias, 'junction')
    } catch (error) {
      t.skip(`junction unavailable on this host: ${error.code ?? 'unknown error'}`)
      return
    }

    await assert.rejects(
      () => buildProjection({ rootDir, outputDir: join(rootDir, 'outside-evidence') }),
      /directorio de proyección dentro del repositorio no permitido/,
    )
    await assert.rejects(
      () => buildProjection({ rootDir, outputDir: join(evidenceAlias, 'redirected-output') }),
      /directorio de proyección dentro del repositorio no permitido/,
    )
  })
})

test('keeps the real candidate manifest fail-closed by default', async () => {
  const outputParent = await mkdtemp(join(tmpdir(), 'crimson-release-projection-real-output-'))
  const outputDir = join(outputParent, 'projection')

  try {
    await assert.rejects(
      () => buildProjection({ rootDir: sourceRoot, outputDir }),
      /equivalencia remota sin verificar/,
    )
  } finally {
    await rm(outputParent, { recursive: true, force: true })
  }
})
