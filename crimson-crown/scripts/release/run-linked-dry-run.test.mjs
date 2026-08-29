import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceWrapper = join(sourceRoot, 'scripts', 'release', 'run-linked-dry-run.ps1')
const productionRef = 'djfqozfaqkqdoqeoqbzt'
const remoteFile = '20240101000000_verified_remote.sql'
const forwardFile = '20240102000000_forward.sql'
const remoteSql = '-- verified remote migration\n'
const forwardSql = 'select 1;\n'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function verifiedManifest() {
  return {
    schemaVersion: 1,
    productionProjectRef: productionRef,
    entries: [
      {
        class: 'remote_applied',
        version: '20240101010101',
        remoteName: 'verified_remote',
        file: remoteFile,
        sha256: sha256(remoteSql),
        equivalence: 'verified',
      },
      {
        class: 'forward_pending',
        version: '20240102000000',
        file: forwardFile,
        sha256: sha256(forwardSql),
      },
    ],
  }
}

const fakeCliSource = String.raw`$cliArgs = @($args | ForEach-Object { [string]$_ })
$record = ConvertTo-Json -Compress -InputObject @($cliArgs)
Add-Content -LiteralPath $env:FAKE_SUPABASE_LOG -Value $record

$workdirIndex = [Array]::IndexOf($cliArgs, '--workdir')
if ($workdirIndex -lt 0 -or $workdirIndex + 2 -ge $cliArgs.Count) { exit 90 }
$workdir = $cliArgs[$workdirIndex + 1]
$command = $cliArgs[$workdirIndex + 2]

if ($command -eq 'link') {
  if ($env:FAKE_SUPABASE_MODE -eq 'link-fail') { exit 41 }
  if ($env:FAKE_SUPABASE_MODE -ne 'missing-ref') {
    $metadata = Join-Path $workdir 'supabase/.temp'
    New-Item -ItemType Directory -Force -Path $metadata | Out-Null
    $ref = if ($env:FAKE_SUPABASE_MODE -eq 'foreign-ref') { 'foreignprojectref0000' } else { 'djfqozfaqkqdoqeoqbzt' }
    Set-Content -NoNewline -LiteralPath (Join-Path $metadata 'project-ref') -Value $ref
  }
  Write-Output 'fake link output must stay hidden'
  exit 0
}

if ($command -eq 'migration') {
  if ($env:FAKE_SUPABASE_MODE -eq 'list-fail') { exit 42 }
  Write-Output 'LOCAL | REMOTE | TIME'
  Write-Output '20240102000000 | | 2024-01-02'
  exit 0
}

if ($command -eq 'db') {
  if ($env:FAKE_SUPABASE_MODE -eq 'push-fail') { exit 43 }
  if ($env:FAKE_SUPABASE_MODE -eq 'root-junction-after-push') {
    $tempRoot = Split-Path -Parent $workdir
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
    try {
      $junction = New-Item -ItemType Junction -Path $tempRoot -Target $env:FAKE_JUNCTION_TARGET -ErrorAction Stop
    } catch {
      exit 44
    }
    if (($junction.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { exit 45 }
  }
  if ($env:FAKE_SUPABASE_MODE -eq 'up-to-date') {
    Write-Output 'Remote database is up to date.'
  } else {
    Write-Output 'DRY RUN: 20240102000000_forward.sql'
  }
  exit 0
}

exit 91
`

const fakeCliLauncher = '@powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-supabase-impl.ps1" %*\r\n'

const mutateManifestAfterBuildSource = `import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildProjection as buildRealProjection } from './build-supabase-projection-real.mjs'

export async function buildProjection(options) {
  const summary = await buildRealProjection(options)
  const manifestPath = join(options.rootDir, 'scripts', 'release', 'migration-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const forward = manifest.entries.find((entry) => entry.class === 'forward_pending')
  forward.class = 'baseline_present'
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\\n')
  return summary
}
`

async function git(rootDir, args) {
  await execFileAsync('git', ['-C', rootDir, ...args], { windowsHide: true })
}

async function makeFixture({ candidate = false, dirty = false, mutateManifestAfterBuild = false } = {}) {
  const fixtureParent = await mkdtemp(join(tmpdir(), 'crimson-wrapper-fixture-'))
  const rootDir = join(fixtureParent, 'repo')
  const releaseDir = join(rootDir, 'scripts', 'release')
  const migrationsDir = join(rootDir, 'supabase', 'migrations')
  const fakeCli = join(fixtureParent, 'fake-supabase.cmd')
  const fakeCliImplementation = join(fixtureParent, 'fake-supabase-impl.ps1')
  const logPath = join(fixtureParent, 'fake-cli-log.jsonl')
  const tempBase = join(fixtureParent, 'temp')
  const sentinel = join(tempBase, 'keep-me.txt')
  const junctionTarget = join(fixtureParent, 'external-junction-target')
  const junctionSentinel = join(junctionTarget, 'must-survive.txt')
  const tempBaseTarget = join(fixtureParent, 'temp-base-target')
  const tempBaseJunction = join(fixtureParent, 'temp-base-junction')
  const tempBaseSentinel = join(tempBaseTarget, 'must-survive.txt')
  const manifest = verifiedManifest()

  if (candidate) manifest.entries[0].equivalence = 'candidate'

  await mkdir(releaseDir, { recursive: true })
  await mkdir(migrationsDir, { recursive: true })
  await mkdir(tempBase)
  await mkdir(junctionTarget)
  await mkdir(tempBaseTarget)
  await cp(sourceWrapper, join(releaseDir, 'run-linked-dry-run.ps1'))
  if (mutateManifestAfterBuild) {
    await cp(join(sourceRoot, 'scripts', 'release', 'build-supabase-projection.mjs'), join(releaseDir, 'build-supabase-projection-real.mjs'))
    await writeFile(join(releaseDir, 'build-supabase-projection.mjs'), mutateManifestAfterBuildSource)
  } else {
    await cp(join(sourceRoot, 'scripts', 'release', 'build-supabase-projection.mjs'), join(releaseDir, 'build-supabase-projection.mjs'))
  }
  await cp(join(sourceRoot, 'scripts', 'release', 'migration-manifest.mjs'), join(releaseDir, 'migration-manifest.mjs'))
  await writeFile(join(releaseDir, 'migration-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(rootDir, 'supabase', 'config.toml'), '[db.migrations]\nenabled = false\n')
  await writeFile(join(migrationsDir, remoteFile), remoteSql)
  await writeFile(join(migrationsDir, forwardFile), forwardSql)
  await writeFile(fakeCli, fakeCliLauncher)
  await writeFile(fakeCliImplementation, fakeCliSource)
  await writeFile(sentinel, 'preserve\n')
  await writeFile(junctionSentinel, 'external preserve\n')
  await writeFile(tempBaseSentinel, 'temp base preserve\n')

  await git(rootDir, ['init', '--quiet'])
  await git(rootDir, ['config', 'user.email', 'offline-fixture@example.invalid'])
  await git(rootDir, ['config', 'user.name', 'Offline Fixture'])
  await git(rootDir, ['add', '.'])
  await git(rootDir, ['commit', '--quiet', '-m', 'fixture'])
  if (dirty) await writeFile(join(rootDir, 'dirty.txt'), 'dirty\n')

  return {
    fixtureParent,
    rootDir,
    fakeCli,
    logPath,
    tempBase,
    sentinel,
    junctionTarget,
    junctionSentinel,
    tempBaseTarget,
    tempBaseJunction,
    tempBaseSentinel,
  }
}

function runWrapper(fixture, mode = 'success', { tempBase = fixture.tempBase } = {}) {
  const path = `${dirname(process.execPath)};${process.env.PATH ?? ''}`
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(fixture.rootDir, 'scripts', 'release', 'run-linked-dry-run.ps1'),
      '-SupabaseCli',
      fixture.fakeCli,
    ],
    {
      cwd: fixture.rootDir,
      env: {
        ...process.env,
        PATH: path,
        TEMP: tempBase,
        TMP: tempBase,
        FAKE_SUPABASE_LOG: fixture.logPath,
        FAKE_SUPABASE_MODE: mode,
        FAKE_JUNCTION_TARGET: fixture.junctionTarget,
      },
      windowsHide: true,
    },
  )

  return new Promise((resolvePromise, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => resolvePromise({ code, stdout, stderr }))
  })
}

async function readCalls(logPath) {
  try {
    return (await readFile(logPath, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

async function assertExactCleanup(fixture) {
  assert.equal(await readFile(fixture.sentinel, 'utf8'), 'preserve\n')
  assert.deepEqual((await readdir(fixture.tempBase)).sort(), ['keep-me.txt'])
}

async function withFixture(options, callback) {
  const fixture = await makeFixture(options)
  try {
    await callback(fixture)
  } finally {
    await rm(fixture.fixtureParent, { recursive: true, force: true })
  }
}

test('uses the exact linked dry-run command sequence and exposes only review output', async () => {
  await withFixture({}, async (fixture) => {
    const result = await runWrapper(fixture)
    const calls = await readCalls(fixture.logPath)

    assert.equal(result.code, 0, result.stderr)
    assert.equal(calls.length, 3)
    const projection = calls[0][1]
    assert.deepEqual(calls, [
      ['--workdir', projection, 'link', '--project-ref', productionRef],
      ['--workdir', projection, 'migration', 'list', '--linked'],
      ['--workdir', projection, 'db', 'push', '--linked', '--dry-run'],
    ])
    assert.match(projection, /crimson-release-[0-9a-f]{32}[\\/]projection$/i)
    assert.match(result.stdout, /LOCAL \| REMOTE \| TIME/)
    assert.match(result.stdout, /DRY RUN: 20240102000000_forward\.sql/)
    assert.doesNotMatch(result.stdout, /fake link output/)
    assert.equal(calls.some((call) => call.join(' ') === '--workdir ' + projection + ' db push --linked'), false)
    await assertExactCleanup(fixture)
  })
})

for (const mode of ['missing-ref', 'foreign-ref']) {
  test(`blocks ${mode} after link and cleans only its temporary root`, async () => {
    await withFixture({}, async (fixture) => {
      const result = await runWrapper(fixture, mode)
      const calls = await readCalls(fixture.logPath)

      assert.notEqual(result.code, 0)
      assert.equal(calls.length, 1)
      assert.equal(calls[0][2], 'link')
      await assertExactCleanup(fixture)
    })
  })
}

test('blocks a dirty worktree before projection or CLI execution', async () => {
  await withFixture({ dirty: true }, async (fixture) => {
    const result = await runWrapper(fixture)

    assert.notEqual(result.code, 0)
    assert.deepEqual(await readCalls(fixture.logPath), [])
    await assertExactCleanup(fixture)
  })
})

test('blocks a candidate manifest without an allow-candidates bypass', async () => {
  await withFixture({ candidate: true }, async (fixture) => {
    const result = await runWrapper(fixture)

    assert.notEqual(result.code, 0)
    assert.deepEqual(await readCalls(fixture.logPath), [])
    await assertExactCleanup(fixture)
  })
})

test('blocks an up-to-date result when the verified manifest has a forward migration', async () => {
  await withFixture({}, async (fixture) => {
    const result = await runWrapper(fixture, 'up-to-date')
    const calls = await readCalls(fixture.logPath)

    assert.notEqual(result.code, 0)
    assert.equal(calls.length, 3)
    assert.equal(calls[2].at(-1), '--dry-run')
    assert.equal(result.stdout, '')
    await assertExactCleanup(fixture)
  })
})

test('uses the materialized projection snapshot when the manifest changes after build', async () => {
  await withFixture({ mutateManifestAfterBuild: true }, async (fixture) => {
    const result = await runWrapper(fixture, 'up-to-date')
    const calls = await readCalls(fixture.logPath)
    const changedManifest = JSON.parse(await readFile(join(fixture.rootDir, 'scripts', 'release', 'migration-manifest.json'), 'utf8'))

    assert.equal(changedManifest.entries.some((entry) => entry.class === 'forward_pending'), false)
    assert.notEqual(result.code, 0)
    assert.equal(calls.length, 3)
    assert.equal(result.stdout, '')
    await assertExactCleanup(fixture)
  })
})

test('removes a substituted temporary-root junction without traversing its external target', async (t) => {
  await withFixture({}, async (fixture) => {
    const junctionProbe = join(fixture.fixtureParent, 'junction-probe')
    try {
      await symlink(fixture.junctionTarget, junctionProbe, 'junction')
      await rm(junctionProbe)
    } catch (error) {
      t.skip(`junction unavailable on this host: ${error.code ?? 'unknown error'}`)
      return
    }

    const result = await runWrapper(fixture, 'root-junction-after-push')

    assert.equal(result.code, 0, result.stderr)
    assert.equal(await readFile(fixture.junctionSentinel, 'utf8'), 'external preserve\n')
    assert.deepEqual(await readdir(fixture.junctionTarget), ['must-survive.txt'])
    await assertExactCleanup(fixture)
  })
})

test('rejects a temporary base that is itself a junction', async (t) => {
  await withFixture({}, async (fixture) => {
    try {
      await symlink(fixture.tempBaseTarget, fixture.tempBaseJunction, 'junction')
    } catch (error) {
      t.skip(`junction unavailable on this host: ${error.code ?? 'unknown error'}`)
      return
    }

    const result = await runWrapper(fixture, 'success', { tempBase: fixture.tempBaseJunction })

    assert.notEqual(result.code, 0)
    assert.deepEqual(await readCalls(fixture.logPath), [])
    assert.equal(await readFile(fixture.tempBaseSentinel, 'utf8'), 'temp base preserve\n')
    assert.deepEqual(await readdir(fixture.tempBaseTarget), ['must-survive.txt'])
  })
})

for (const failure of [
  { mode: 'link-fail', expectedCalls: 1 },
  { mode: 'list-fail', expectedCalls: 2 },
  { mode: 'push-fail', expectedCalls: 3 },
]) {
  test(`propagates ${failure.mode} without executing later commands`, async () => {
    await withFixture({}, async (fixture) => {
      const result = await runWrapper(fixture, failure.mode)
      const calls = await readCalls(fixture.logPath)

      assert.notEqual(result.code, 0)
      assert.equal(calls.length, failure.expectedCalls)
      assert.equal(result.stdout, '')
      await assertExactCleanup(fixture)
    })
  })
}

test('contains no repair, dry-run bypass, or recursive Remove-Item shortcut', async () => {
  const source = await readFile(sourceWrapper, 'utf8')

  assert.doesNotMatch(source, /migration\s+repair/i)
  assert.doesNotMatch(source, /\[switch\][^\r\n]*(?:dry.?run|push|live|apply)/i)
  assert.doesNotMatch(source, /Remove-Item[^\r\n]*-Recurse/i)
})
