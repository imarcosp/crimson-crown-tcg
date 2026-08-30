import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const appRoot = process.cwd()
const wrapperPath = path.join(appRoot, 'scripts', 'staging', 'run-p0-rehearsal.ps1')
const snapshotPath = path.join(appRoot, 'scripts', 'staging', 'snapshot-crimson-schema.sql')
const baselinePath = 'C:\\Users\\mjper\\AppData\\Local\\CrimsonCrown\\supabase-mirror\\raw\\schema.sql'
const stagingRef = 'ssyeqgtdohwkcucedpwx'

const expectedMigrations = [
  ['20260830002923', 'production_schema_baseline_20260829', 'c3ff23cd631e89e5124dd0f2cba6d389d760183838b82c35accbe4a1c8cf7e66'],
  ['20260830002956', 'production_runtime_functions', '728a2ff87787d7dd4637159492c163143e0a15206fc0c6e9f072d058a9ed4093'],
  ['20260830003002', 'revoke_is_admin_anon', '89a4cfdc2b7399cbf9aa4ce36919dc3db0f57e14f3ae0e1709bc18ee96f32ae2'],
  ['20260830003009', 'create_multi_inventory_system', '757cac5ae425453787aee2bbba67d884837b4bca66825e65c60cfdc6d736c485'],
  ['20260830003018', 'multi_inventory_runtime_functions', '33f0e6e37cca7658c6775b2258b98a29c52a7ac128ec8f6ddb29808fc6288289'],
  ['20260830003025', 'add_external_prices_name_search_index', '94ced8537442c5afca9c270a7362c6a983cc1017681d57c909ba252565e74e24'],
  ['20260830003041', 'admin_product_mutations', '7cd95bd263feef103974fec28060df9ec8a5c55181ca8e21ca5d9f232e0ed273'],
  ['20260830003047', 'harden_privileged_surfaces', '852994bf0c3563fd0417e64fe485c19d7942a92bd9b587feb73a462a73c79478'],
  ['20260830003053', 'add_payment_proof_paths', 'a11bb8935d5bcb3d268b6f8cc3c9e341bffd0815d0842625b10222e5b185dc6e'],
  ['20260830003100', 'finalize_import_quotes_atomically', '287b0b1c8f2184cf7ae5329967c6f935f7c79766f44a426e250c5c8ba9ea426d'],
  ['20260830003106', 'freeze_approved_import_quote_items', '1d2c4ff3c6a5079f37309ab34b3ac415b47bb6a82c6277505ae6cfe6905b14fb'],
  ['20260830003113', 'fix_import_item_guard_rls', '6461df90e0745dbbd6f11e6777d2437aabba3f2248fb13a592b4b1f39c7c4220'],
  ['20260830004907', 'harden_storage_buckets_and_policies', '30ed7942c176e0d6e781d7f73f33be714014d312023dd47764466a34fc0ca811'],
  ['20260830012837', 'scope_staging_commission_operator', '4a9d1475cf9375ae02d009ddbddf4b9f290617c262e12e234a53ab59130fac9f'],
  ['20260830030639', 'report_commission_payment_atomically', '90797543348a079d528561ff1f8ad55902ee6ddc02e1d3dd8942fb13c2bb827b'],
  ['20260830031656', 'confirm_commission_payment_atomically', '5cb3aa5a8d2efd28a4d47e467653feb00993d02d27e20ea6d5a4a089813e611b'],
  ['20260830033321', 'fix_commission_payment_proof_path_regex', '114647ad0d1b465c7a4a654080873e33061495085caf2867073b95b3ef6dd7f6'],
  ['20260830041919', 'reconcile_legacy_schema_safely', '616bc1907f3901cd6f37e88d9dfe3f5dc11ec09644f9094fd168cf31394adf5a'],
  ['20260830043020', 'reconcile_legacy_schema_safely_transactional', 'ba28412950740ca5ae53020f46fd2d4310d9db4857e1ce35a13ff90077aa3f4a'],
]

function fakeSnapshot(migrations = expectedMigrations) {
  return {
    schema_version: 1,
    migrations: migrations.map(([version, name, statements_sha256]) => ({ version, name, statements_sha256 })),
    relation_signatures: [{ schema: 'public', name: 'orders', kind: 'r', rls: true, signature_sha256: 'a'.repeat(64) }],
    function_signatures: [{ signature: 'is_admin()', security_definer: true, proconfig: ['search_path=public, pg_temp'], definition_sha256: 'b'.repeat(64) }],
    grants: [{ object_kind: 'table', object_name: 'orders', grantee: 'authenticated', privilege: 'SELECT' }],
    policies: [{ table_name: 'orders', policy_name: 'owner_select', command: 'SELECT', roles: ['authenticated'], expression_sha256: 'c'.repeat(64) }],
    buckets: [{ id: 'payment_proofs', public: false, file_size_limit: 5242880, allowed_mime_types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] }],
    counts: [{ object_name: 'public.orders', row_count: 0 }, { object_name: 'storage.payment_proofs', row_count: 0 }],
  }
}

function safeEnvironment(overrides = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(?:RESEND|MERCADO_?PAGO|^MP_|WEBHOOK)/iu.test(name)))
  return {
    ...env,
    NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
    CRIMSON_STAGING_SUPABASE_PROJECT_REF: stagingRef,
    NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: stagingRef,
    NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
    PLAYWRIGHT_BASE_URL: 'https://crimson-preview.vercel.app',
    DISABLE_EXTERNAL_SIDE_EFFECTS: 'true',
    CRIMSON_STAGING_EMAIL_DOMAIN: 'example.test',
    ...overrides,
  }
}

async function withFakes(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'crimson-p0-wrapper-test-'))
  try {
    const cliLog = path.join(root, 'cli.log')
    const nodeLog = path.join(root, 'node.log')
    const fakeCliJs = path.join(root, 'fake-cli.mjs')
    const fakeCli = path.join(root, 'fake-cli.cmd')
    const fakeNode = path.join(root, 'fake-node.cmd')
    const evidence = path.join(root, 'evidence')
    await mkdir(evidence)
    await writeFile(fakeCliJs, `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
if (process.argv.includes('--version')) console.log('2.113.0')
else if (process.argv.includes('query')) {
  console.error('Initialising login role...')
  console.log(JSON.stringify({ boundary: 'fake-boundary', rows: [{ snapshot: JSON.parse(process.env.FAKE_SNAPSHOT_JSON) }] }))
}
else {
  const workdir = process.argv[process.argv.indexOf('--workdir') + 1]
  const tempDirectory = path.join(workdir, 'supabase', '.temp')
  mkdirSync(tempDirectory, { recursive: true })
  writeFileSync(path.join(tempDirectory, 'project-ref'), process.env.FAKE_LINKED_REF, 'utf8')
  console.error('Initialising login role...')
  console.log(JSON.stringify({ ok: true }))
}
`, 'utf8')
    await writeFile(fakeCli, `@echo off\r\n"${process.execPath}" "${fakeCliJs}" %*\r\n`, 'utf8')
    await writeFile(fakeNode, `@echo off\r\necho %*>>"${nodeLog}"\r\nexit /b 0\r\n`, 'utf8')
    await run({ root, cliLog, nodeLog, fakeCli, fakeNode, evidence })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function invokeWrapper({ fakeCli, fakeNode, evidence, env = safeEnvironment(), mode, apply = false, baseline = baselinePath, linkedRef = stagingRef }) {
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', wrapperPath,
    '-SupabaseCli', fakeCli,
    '-NodeExecutable', fakeNode,
    '-BaselinePath', baseline,
    '-EvidenceDirectory', evidence,
  ]
  if (mode) args.push('-Mode', mode)
  if (apply) args.push('-ApplyToStaging')
  return spawnSync('powershell.exe', args, {
    cwd: appRoot,
    env: { ...env, FAKE_CLI_LOG: path.join(path.dirname(fakeCli), 'cli.log'), FAKE_SNAPSHOT_JSON: JSON.stringify(fakeSnapshot()), FAKE_LINKED_REF: linkedRef },
    encoding: 'utf8',
  })
}

test('snapshot produce sólo firmas y conteos, sin columnas sensibles ni DML', async () => {
  const sql = await readFile(snapshotPath, 'utf8')
  assert.match(sql, /supabase_migrations[.]schema_migrations/iu)
  assert.match(sql, /jsonb_build_object/iu)
  assert.match(sql, /pg_get_functiondef/iu)
  assert.match(sql, /storage[.]buckets/iu)
  assert.match(sql, /count[(][*][)]/iu)
  assert.doesNotMatch(sql, /\b(?:email|first_name|last_name|address|phone|payment_proof_url|payment_proof_path|proof_url|proof_path)\b/iu)
  assert.doesNotMatch(sql, /\b(?:insert|update|delete|truncate|drop|alter|create)\b/iu)
  assert.doesNotMatch(sql, /select\s+[*]/iu)
})

test('ancla la entrada 14 a una fuente staging-only fuera de migraciones productivas', async () => {
  const wrapper = await readFile(wrapperPath, 'utf8')
  assert.match(wrapper, /Class = 'staging-only'/u)
  assert.match(wrapper, /scripts\\staging\\sql\\scope-staging-commission-operator[.]sql/u)
  assert.match(wrapper, /28ca719e8ba88c48f399ff9f9b0534bff27928df922cd2b6e77e6fc861de73ff/u)
  assert.match(wrapper, /20260830012837/u)
  assert.match(wrapper, /4a9d1475cf9375ae02d009ddbddf4b9f290617c262e12e234a53ab59130fac9f/u)
  assert.doesNotMatch(wrapper, /supabase\\migrations\\scope_staging_commission_operator/iu)
})

test('incluye la reconciliación productiva antes de Storage en el ledger fuente', async () => {
  const wrapper = await readFile(wrapperPath, 'utf8')
  const reconciliation = wrapper.indexOf('20260829235800_reconcile_legacy_schema_safely.sql')
  const storage = wrapper.indexOf('20260829235900_harden_storage_buckets_and_policies.sql')

  assert.ok(reconciliation >= 0, 'falta la reconciliación en el ledger fuente')
  assert.ok(storage > reconciliation, 'Storage debe permanecer último en el orden lógico de producción')
  assert.match(wrapper, /feff9a68c4bd35d7eb04e30c85b980b7e7b5863e0706570651a1ca8647e511de/u)
})

test('verify-only valida guard, hashes y tres snapshots sin comando remoto mutante', async () => {
  await withFakes(async ({ cliLog, nodeLog, fakeCli, fakeNode, evidence }) => {
    const result = invokeWrapper({ fakeCli, fakeNode, evidence })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.deepEqual(JSON.parse(result.stdout), {
      mode: 'verify-only',
      projectRef: stagingRef,
      migrations: { baseline: 1, production: 5, forward: 10, storage: 1, stagingOnly: 1, transactionalRehearsal: 1, total: 19 },
      snapshots: ['snapshot-before.json', 'snapshot-after.json', 'snapshot-rollback.json'],
      remoteMutations: 0,
    })

    const calls = (await readFile(cliLog, 'utf8')).trim().split(/\r?\n/u).map(JSON.parse)
    assert.equal(calls.length, 5)
    assert.ok(calls[0].includes('--version'))
    assert.ok(calls[1].includes('link'))
    assert.equal(calls.filter((call) => call.includes('query')).length, 3)
    assert.ok(calls.every((call) => !call.includes('push') && !call.includes('reset') && !call.includes('repair')))

    const nodeCalls = await readFile(nodeLog, 'utf8')
    assert.match(nodeCalls, /assert-crimson-staging[.]mjs/u)
    assert.match(nodeCalls, /privileged-surface-contract[.]test[.]mjs/u)
    assert.match(nodeCalls, /storage-matrix[.]mjs/u)
    for (const filename of ['snapshot-before.json', 'snapshot-after.json', 'snapshot-rollback.json']) {
      const saved = JSON.parse(await readFile(path.join(evidence, filename), 'utf8'))
      assert.deepEqual(saved.migrations, fakeSnapshot().migrations)
    }
  })
})

test('rechaza producción, refs extranjeros y mismatch antes de invocar el CLI', async () => {
  await withFakes(async ({ cliLog, fakeCli, fakeNode, evidence }) => {
    for (const projectRef of [
      'djfqozfaqkqdoqeoqbzt',
      'jzkxvgntwompkntimrao',
      'tszglqwrklthnzhqdffn',
      'shwqihiueeuqeumdoepn',
    ]) {
      const result = invokeWrapper({
        fakeCli, fakeNode, evidence,
        env: safeEnvironment({
          NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
          CRIMSON_STAGING_SUPABASE_PROJECT_REF: projectRef,
          NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: projectRef,
        }),
      })
      assert.notEqual(result.status, 0)
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(projectRef, 'u'))
    }
    await assert.rejects(readFile(cliLog, 'utf8'), { code: 'ENOENT' })

    const linkedElsewhere = invokeWrapper({
      fakeCli,
      fakeNode,
      evidence,
      linkedRef: 'djfqozfaqkqdoqeoqbzt',
    })
    assert.notEqual(linkedElsewhere.status, 0)
    assert.match(linkedElsewhere.stderr, /proyecci[oó]n temporal no coincide/iu)
    const calls = (await readFile(cliLog, 'utf8')).trim().split(/\r?\n/u).map(JSON.parse)
    assert.equal(calls.length, 2)
    assert.ok(calls[0].includes('--version'))
    assert.ok(calls[1].includes('link'))
    assert.ok(calls.every((call) => !call.includes('query')))
  })
})

test('modo apply exige switch tipado y queda no-op si el ledger ya está completo', async () => {
  await withFakes(async ({ cliLog, fakeCli, fakeNode, evidence }) => {
    const denied = invokeWrapper({ fakeCli, fakeNode, evidence, mode: 'Apply' })
    assert.notEqual(denied.status, 0)
    await assert.rejects(readFile(cliLog, 'utf8'), { code: 'ENOENT' })

    const allowed = invokeWrapper({ fakeCli, fakeNode, evidence, mode: 'Apply', apply: true })
    assert.equal(allowed.status, 0, `${allowed.stdout}\n${allowed.stderr}`)
    assert.equal(JSON.parse(allowed.stdout).mode, 'apply-authorized-noop')
    const calls = (await readFile(cliLog, 'utf8')).trim().split(/\r?\n/u).map(JSON.parse)
    assert.ok(calls.every((call) => !call.includes('push') && !call.includes('reset') && !call.includes('repair')))
  })
})

test('falla cerrado ante hash local o inventario remoto distinto', async () => {
  await withFakes(async ({ root, fakeCli, fakeNode, evidence }) => {
    const wrongBaseline = path.join(root, 'wrong-baseline.sql')
    await writeFile(wrongBaseline, '-- not crimson baseline\n')
    const localMismatch = invokeWrapper({ fakeCli, fakeNode, evidence, baseline: wrongBaseline })
    assert.notEqual(localMismatch.status, 0)
    assert.match(`${localMismatch.stdout}${localMismatch.stderr}`, /hash local no coincide/u)

    const changed = fakeSnapshot(expectedMigrations.slice(0, -1))
    const remoteMismatch = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath,
      '-SupabaseCli', fakeCli, '-NodeExecutable', fakeNode, '-BaselinePath', baselinePath,
      '-EvidenceDirectory', evidence,
    ], {
      cwd: appRoot,
      env: { ...safeEnvironment(), FAKE_CLI_LOG: path.join(root, 'cli.log'), FAKE_SNAPSHOT_JSON: JSON.stringify(changed), FAKE_LINKED_REF: stagingRef },
      encoding: 'utf8',
    })
    assert.notEqual(remoteMismatch.status, 0)
    assert.match(`${remoteMismatch.stdout}${remoteMismatch.stderr}`, /inventario remoto no coincide/u)
  })
})

test('package expone verificación enfocada sin ruta apply automática', async () => {
  const packageJson = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'))
  assert.equal(packageJson.scripts['test:staging-rehearsal'], 'node --test scripts/staging/run-p0-rehearsal.test.mjs')
  assert.equal(packageJson.scripts['staging:p0:verify'], 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/staging/run-p0-rehearsal.ps1')
  assert.equal(Object.keys(packageJson.scripts).some((name) => /staging:p0:apply/u.test(name)), false)
})
