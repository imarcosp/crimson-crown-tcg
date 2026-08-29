import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { buildProjection } from './build-supabase-projection.mjs'

const sourceRoot = resolve(process.cwd())
const verifiedProof = {
  status: 'verified_present',
  evidence: 'docs/evidence/fixture-proof.md#verified',
  remediationVersions: [],
}
const fixtureEntries = [
  {
    class: 'remote_applied',
    version: '20260826210617',
    remoteName: 'production_runtime_functions',
    file: '20260826120000_production_runtime_functions.sql',
    sha256: '1495f5ccbd382224fa5c28312ecc488f29ad8bd680020dda73e9f68a183388f3',
    releaseProof: verifiedProof,
  },
  {
    class: 'remote_applied',
    version: '20260826210725',
    remoteName: 'revoke_is_admin_anon',
    file: '20260826121500_revoke_is_admin_anon.sql',
    sha256: '9ccca376f02452f82481037f25646b1fc47812dd3e1966437f0fa8e0784dddcd',
    releaseProof: verifiedProof,
  },
  {
    class: 'remote_applied',
    version: '20260827051550',
    remoteName: 'create_multi_inventory_system',
    file: '20260827020755_create_multi_inventory_system.sql',
    sha256: '71f827c3d33fad843e1324fa4566be56d662c27d9da9e0f781eaacfa418a0080',
    releaseProof: verifiedProof,
  },
  {
    class: 'remote_applied',
    version: '20260827051604',
    remoteName: 'multi_inventory_runtime_functions',
    file: '20260827020830_multi_inventory_runtime_functions.sql',
    sha256: '0ec9d9c609d0cd30f9bf0d3089f983a2cf4d2dea5ef4a641594e5df38b801210',
    releaseProof: verifiedProof,
  },
  {
    class: 'remote_applied',
    version: '20260827051615',
    remoteName: 'add_external_prices_name_search_index',
    file: '20260827024000_add_external_prices_name_search_index.sql',
    sha256: '3deec1275e2079c80c5f0c5782c2b8580ee17433f28cb4ff21e998a70f1be39f',
    releaseProof: verifiedProof,
  },
  {
    class: 'baseline_present',
    version: '20231218',
    file: '20231218_add_tcg_columns.sql',
    sha256: 'e16166248daf1b0f72c31ae7a3b6b12530c064a73c919841a2468ed2617c2647',
    releaseProof: verifiedProof,
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

async function withFixture(callback, { config, entries = fixtureEntries } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'crimson-release-projection-root-'))
  const outputParent = await mkdtemp(join(tmpdir(), 'crimson-release-projection-output-'))
  const outputDir = join(outputParent, 'projection')
  const migrationsDir = join(rootDir, 'supabase', 'migrations')
  const evidenceDir = join(rootDir, 'docs', 'evidence')
  const manifestPath = join(rootDir, 'scripts', 'release', 'migration-manifest.json')

  await mkdir(migrationsDir, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(join(evidenceDir, 'fixture-proof.md'), '<a id="verified"></a>\n')
  await cp(join(sourceRoot, 'supabase', 'config.toml'), join(rootDir, 'supabase', 'config.toml'))
  for (const entry of entries) {
    await cp(join(sourceRoot, 'supabase', 'migrations', entry.file), join(migrationsDir, entry.file))
  }
  if (config !== undefined) {
    await writeFile(join(rootDir, 'supabase', 'config.toml'), config)
  }
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 2,
    productionProjectRef: 'djfqozfaqkqdoqeoqbzt',
    entries,
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
    assert.equal(
      await readFile(join(outputDir, 'supabase', 'migrations', '20260826210725_revoke_is_admin_anon.sql'), 'utf8'),
      '-- release projection: remote_version=20260826210725 remote_name=revoke_is_admin_anon local_source_sha256=9ccca376f02452f82481037f25646b1fc47812dd3e1966437f0fa8e0784dddcd\n',
    )
    assert.equal(
      await readFile(join(outputDir, 'supabase', 'migrations', '20260827051550_create_multi_inventory_system.sql'), 'utf8'),
      '-- release projection: remote_version=20260827051550 remote_name=create_multi_inventory_system local_source_sha256=71f827c3d33fad843e1324fa4566be56d662c27d9da9e0f781eaacfa418a0080\n',
    )
    assert.equal(
      await readFile(join(outputDir, 'supabase', 'migrations', '20260827051604_multi_inventory_runtime_functions.sql'), 'utf8'),
      '-- release projection: remote_version=20260827051604 remote_name=multi_inventory_runtime_functions local_source_sha256=0ec9d9c609d0cd30f9bf0d3089f983a2cf4d2dea5ef4a641594e5df38b801210\n',
    )
    assert.equal(
      await readFile(join(outputDir, 'supabase', 'migrations', '20260827051615_add_external_prices_name_search_index.sql'), 'utf8'),
      '-- release projection: remote_version=20260827051615 remote_name=add_external_prices_name_search_index local_source_sha256=3deec1275e2079c80c5f0c5782c2b8580ee17433f28cb4ff21e998a70f1be39f\n',
    )
    assert.deepEqual(
      await readFile(join(outputDir, 'supabase', 'migrations', '20260829021742_admin_product_mutations.sql')),
      await readFile(join(rootDir, 'supabase', 'migrations', '20260829021742_admin_product_mutations.sql')),
    )
  })
})

test('returns an exact deep-frozen projection summary from the validated manifest snapshot', async () => {
  await withFixture(async ({ rootDir, outputDir }) => {
    const summary = await buildProjection({ rootDir, outputDir })

    assert.deepEqual(summary, {
      forwardPendingCount: 1,
      forwardPendingVersions: ['20260829021742'],
      forwardPendingFilenames: ['20260829021742_admin_product_mutations.sql'],
      projectedRemoteVersions: [
        '20260826210617',
        '20260826210725',
        '20260827051550',
        '20260827051604',
        '20260827051615',
      ],
      projectedRemoteFilenames: [
        '20260826210617_production_runtime_functions.sql',
        '20260826210725_revoke_is_admin_anon.sql',
        '20260827051550_create_multi_inventory_system.sql',
        '20260827051604_multi_inventory_runtime_functions.sql',
        '20260827051615_add_external_prices_name_search_index.sql',
      ],
    })
    assert.equal(Object.isFrozen(summary), true)
    assert.equal(Object.isFrozen(summary.forwardPendingVersions), true)
    assert.equal(Object.isFrozen(summary.forwardPendingFilenames), true)
    assert.equal(Object.isFrozen(summary.projectedRemoteVersions), true)
    assert.equal(Object.isFrozen(summary.projectedRemoteFilenames), true)
    assert.throws(() => summary.forwardPendingVersions.push('20260830000000'), TypeError)
    assert.throws(() => summary.projectedRemoteFilenames.reverse(), TypeError)
  })
})

test('rejects an unsafe projected remote filename before reserving the output directory', async () => {
  const entries = fixtureEntries.map((entry) => (
    entry.class === 'remote_applied' && entry.version === '20260826210617'
      ? { ...entry, remoteName: 'unsafe remote name' }
      : entry
  ))

  await withFixture(async ({ rootDir, outputDir, outputParent }) => {
    await assert.rejects(
      () => buildProjection({ rootDir, outputDir }),
      /nombre remoto de migración no seguro/,
    )
    assert.deepEqual(await readdir(outputParent), [])
  }, { entries })
})

test('rejects unordered projected remote versions before reserving the output directory', async () => {
  const entries = [...fixtureEntries]
  ;[entries[0], entries[1]] = [entries[1], entries[0]]

  await withFixture(async ({ rootDir, outputDir, outputParent }) => {
    await assert.rejects(
      () => buildProjection({ rootDir, outputDir }),
      /orden de migraciones remotas inválido/,
    )
    assert.deepEqual(await readdir(outputParent), [])
  }, { entries })
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

test('fails closed when the physical parent is swapped before the reservation revalidation', async () => {
  await withFixture(async ({ rootDir, outputDir, outputParent }) => {
    const originalParent = `${outputParent}-original`
    try {
      await assert.rejects(
        () => buildProjection({
          rootDir,
          outputDir,
          _testHooks: {
            beforeParentReservationRevalidation: async () => {
              await rename(outputParent, originalParent)
              await mkdir(outputParent)
            },
          },
        }),
        (error) => error.message === 'identidad del directorio de proyección inválida',
      )
      assert.deepEqual(await readdir(outputParent), [])
    } finally {
      await rm(originalParent, { recursive: true, force: true })
    }
  })
})

test('fails closed after a parent junction swap before the final reservation check', async (t) => {
  await withFixture(async ({ rootDir, outputDir, outputParent }) => {
    const outsideTarget = await mkdtemp(join(tmpdir(), 'crimson-release-projection-outside-'))
    const outsideSentinel = join(outsideTarget, 'must-survive.txt')
    const junctionProbe = join(outputParent, 'junction-probe')
    const originalParent = `${outputParent}-original`
    await writeFile(outsideSentinel, 'preserve\n')

    try {
      try {
        await symlink(outsideTarget, junctionProbe, 'junction')
        await rm(junctionProbe)
      } catch (error) {
        t.skip(`junction unavailable on this host: ${error.code ?? 'unknown error'}`)
        return
      }

      await assert.rejects(
        () => buildProjection({
          rootDir,
          outputDir,
          _testHooks: {
            beforeParentReservationRevalidation: async () => {
              await rename(outputParent, originalParent)
              await symlink(outsideTarget, outputParent, 'junction')
            },
          },
        }),
        (error) => error.message === 'identidad del directorio de proyección inválida',
      )
      assert.equal(await readFile(outsideSentinel, 'utf8'), 'preserve\n')
      assert.deepEqual(await readdir(outsideTarget), ['must-survive.txt'])
    } finally {
      await rm(outputParent, { force: true })
      await mkdir(outputParent)
      await rm(originalParent, { recursive: true, force: true })
      await rm(outsideTarget, { recursive: true, force: true })
    }
  })
})

test('fails closed when the reserved output is replaced by a junction before identity verification', async (t) => {
  await withFixture(async ({ rootDir, outputDir, outputParent }) => {
    const outsideTarget = await mkdtemp(join(tmpdir(), 'crimson-release-projection-outside-'))
    const outsideSentinel = join(outsideTarget, 'must-survive.txt')
    const originalReservation = join(outputParent, 'original-reservation')
    const junctionProbe = join(outputParent, 'junction-probe')
    await writeFile(outsideSentinel, 'preserve\n')

    try {
      try {
        await symlink(outsideTarget, junctionProbe, 'junction')
        await rm(junctionProbe)
      } catch (error) {
        t.skip(`junction unavailable on this host: ${error.code ?? 'unknown error'}`)
        return
      }

      await assert.rejects(
        () => buildProjection({
          rootDir,
          outputDir,
          _testHooks: {
            afterOutputReservation: async () => {
              await rename(outputDir, originalReservation)
              await symlink(outsideTarget, outputDir, 'junction')
            },
          },
        }),
        (error) => error.message === 'identidad del directorio de proyección inválida',
      )
      assert.equal(await readFile(outsideSentinel, 'utf8'), 'preserve\n')
      assert.deepEqual(await readdir(outsideTarget), ['must-survive.txt'])
      assert.deepEqual(await readdir(originalReservation), [])
    } finally {
      await rm(outputDir, { force: true })
      await rm(outsideTarget, { recursive: true, force: true })
    }
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
      /identidad del directorio de proyección inválida/,
    )
  })
})

test('rejects a stable external junction as the immediate output parent', async (t) => {
  await withFixture(async ({ rootDir, outputParent }) => {
    const outsideTarget = await mkdtemp(join(tmpdir(), 'crimson-release-projection-stable-junction-'))
    const outsideSentinel = join(outsideTarget, 'must-survive.txt')
    const junctionParent = join(outputParent, 'external-alias')
    await writeFile(outsideSentinel, 'preserve\n')

    try {
      try {
        await symlink(outsideTarget, junctionParent, 'junction')
      } catch (error) {
        t.skip(`junction unavailable on this host: ${error.code ?? 'unknown error'}`)
        return
      }

      await assert.rejects(
        () => buildProjection({ rootDir, outputDir: join(junctionParent, 'projection') }),
        (error) => error.message === 'identidad del directorio de proyección inválida',
      )
      assert.equal(await readFile(outsideSentinel, 'utf8'), 'preserve\n')
      assert.deepEqual(await readdir(outsideTarget), ['must-survive.txt'])
    } finally {
      await rm(outsideTarget, { recursive: true, force: true })
    }
  })
})

test('rejects a stable junction in an ancestor component of the output parent', async (t) => {
  await withFixture(async ({ rootDir, outputParent }) => {
    const outsideTarget = await mkdtemp(join(tmpdir(), 'crimson-release-projection-stable-ancestor-'))
    const outsideSentinel = join(outsideTarget, 'must-survive.txt')
    const junctionAncestor = join(outputParent, 'external-alias')
    const nestedParent = join(outsideTarget, 'nested-parent')
    await mkdir(nestedParent)
    await writeFile(outsideSentinel, 'preserve\n')

    try {
      try {
        await symlink(outsideTarget, junctionAncestor, 'junction')
      } catch (error) {
        t.skip(`junction unavailable on this host: ${error.code ?? 'unknown error'}`)
        return
      }

      await assert.rejects(
        () => buildProjection({ rootDir, outputDir: join(junctionAncestor, 'nested-parent', 'projection') }),
        (error) => error.message === 'identidad del directorio de proyección inválida',
      )
      assert.equal(await readFile(outsideSentinel, 'utf8'), 'preserve\n')
      assert.deepEqual(await readdir(nestedParent), [])
    } finally {
      await rm(outsideTarget, { recursive: true, force: true })
    }
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
      /identidad del directorio de proyección inválida/,
    )
  })
})

test('keeps the real candidate manifest fail-closed by default', async () => {
  const outputParent = await mkdtemp(join(tmpdir(), 'crimson-release-projection-real-output-'))
  const outputDir = join(outputParent, 'projection')

  try {
    await assert.rejects(
      () => buildProjection({ rootDir: sourceRoot, outputDir }),
      /prueba de release candidata/,
    )
  } finally {
    await rm(outputParent, { recursive: true, force: true })
  }
})

test('does not materialize a baseline candidate when all remote proofs are verified', async () => {
  const candidateEntries = fixtureEntries.map((entry) => {
    if (entry.class !== 'baseline_present') return entry
    return {
      ...entry,
      releaseProof: { status: 'candidate', evidence: null, remediationVersions: [] },
    }
  })

  await withFixture(async ({ rootDir, outputDir, outputParent }) => {
    await assert.rejects(
      () => buildProjection({ rootDir, outputDir }),
      (error) => error.message === 'prueba de release candidata',
    )
    assert.deepEqual(await readdir(outputParent), [])
  }, { entries: candidateEntries })
})
