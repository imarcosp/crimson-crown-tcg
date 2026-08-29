import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceWrapper = join(sourceRoot, 'scripts', 'release', 'run-linked-dry-run.ps1')
const productionRef = 'djfqozfaqkqdoqeoqbzt'
const remoteFile = '20240101000000_verified_remote.sql'
const projectedRemoteFile = '20240101010101_verified_remote.sql'
const forwardFiles = [
  '20240102000000_forward_one.sql',
  '20240103000000_forward_two.sql',
]
const remoteSql = '-- verified remote migration\n'
const forwardSql = ['select 1;\n', 'select 2;\n']

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function verifiedManifest({ zeroForward = false } = {}) {
  return {
    schemaVersion: 2,
    productionProjectRef: productionRef,
    entries: [
      {
        class: 'remote_applied',
        version: '20240101010101',
        remoteName: 'verified_remote',
        file: remoteFile,
        sha256: sha256(remoteSql),
        releaseProof: {
          status: 'verified_present',
          evidence: 'docs/evidence/fixture-proof.md#verified-remote',
          remediationVersions: [],
        },
      },
      ...(
        zeroForward
          ? []
          : forwardFiles.map((file, index) => ({
            class: 'forward_pending',
            version: file.slice(0, file.indexOf('_')),
            file,
            sha256: sha256(forwardSql[index]),
          }))
      ),
    ],
  }
}

const fakeCliSource = String.raw`$cliArgs = @($args | ForEach-Object { [string]$_ })
$record = ConvertTo-Json -Compress -InputObject @($cliArgs)
Add-Content -LiteralPath $env:FAKE_SUPABASE_LOG -Value $record

if ($cliArgs.Count -eq 1 -and $cliArgs[0] -ceq '--version') {
  switch ($env:FAKE_SUPABASE_MODE) {
    'version-wrong' { Write-Output '2.112.0'; exit 0 }
    'version-multiline' { Write-Output '2.113.0'; Write-Output 'unexpected second line'; exit 0 }
    'version-missing' { exit 0 }
    'version-malformed' { Write-Output 'v2.113.0'; exit 0 }
    default { Write-Output '2.113.0'; exit 0 }
  }
}

$workdirIndex = [Array]::IndexOf($cliArgs, '--workdir')
if ($workdirIndex -lt 0 -or $workdirIndex + 2 -ge $cliArgs.Count) { exit 90 }
$workdir = $cliArgs[$workdirIndex + 1]
$command = $cliArgs[$workdirIndex + 2]

if ($command -eq 'link') {
  if ($env:FAKE_SUPABASE_MODE -eq 'link-fail') { exit 41 }
  if ($env:FAKE_SUPABASE_MODE -eq 'use-lock-attack') {
    $tempRoot = Split-Path -Parent $workdir
    Set-Content -NoNewline -LiteralPath $env:FAKE_USE_LOCK_READY -Value $tempRoot
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not (Test-Path -LiteralPath $env:FAKE_USE_LOCK_DONE)) {
      if ([DateTime]::UtcNow -ge $deadline) { exit 46 }
      Start-Sleep -Milliseconds 5
    }
  }
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
  $rows = [Collections.Generic.List[string]]::new()
  $rows.Add('   20240101010101 | 20240101010101 | 2024-01-01 01:01:01')
  if ($env:FAKE_ZERO_FORWARD -cne '1') {
    $rows.Add('   20240102000000 |                | 2024-01-02 00:00:00')
    $rows.Add('   20240103000000 |                | 2024-01-03 00:00:00')
  }
  switch ($env:FAKE_SUPABASE_MODE) {
    'list-missing-forward' { $rows.RemoveAt($rows.Count - 1) }
    'list-extra-forward' { $rows.Add('   20240104000000 |                | 2024-01-04 00:00:00') }
    'list-duplicate-forward' { $rows.Insert($rows.Count - 1, '   20240102000000 |                | 2024-01-02 00:00:00') }
    'list-reordered-forward' {
      $row = $rows[1]
      $rows[1] = $rows[2]
      $rows[2] = $row
    }
    'list-remote-only' { $rows.Insert(0, '                  | 20231231000000 | 2023-12-31 00:00:00') }
    'list-local-only-marker' { $rows[0] = '   20240101010101 |                | 2024-01-01 01:01:01' }
    'list-additional-local-history' { $rows.Insert(1, '   20231231000000 |                | 2023-12-31 00:00:00') }
    'list-duplicate-remote' { $rows.Insert(1, $rows[0]) }
    'list-malformed' { $rows[0] = '   not-a-version  | 20240101010101 | 2024-01-01 01:01:01' }
  }
  Write-Output 'Connecting to remote database...'
  Write-Output ''
  Write-Output '   Local          | Remote         | Time (UTC)'
  Write-Output '  ----------------|----------------|---------------------'
  $rows | Write-Output
  if ($env:FAKE_SUPABASE_MODE -eq 'list-unknown-grammar') {
    Write-Output 'unexpected parser drift'
  }
  exit 0
}

if ($command -eq 'db') {
  if ($env:FAKE_SUPABASE_MODE -eq 'push-fail') { exit 43 }
  if ($env:FAKE_SUPABASE_MODE -eq 'cleanup-race-after-push') {
    $tempRoot = Split-Path -Parent $workdir
    $raceDirectory = Join-Path $tempRoot 'race-subdir'
    New-Item -ItemType Directory -Path $raceDirectory | Out-Null
    for ($index = 0; $index -lt 2500; $index += 1) {
      [IO.File]::WriteAllText((Join-Path $raceDirectory ("entry-{0:D4}.txt" -f $index)), 'fixture')
    }
    Set-Content -NoNewline -LiteralPath $env:FAKE_RACE_READY -Value $raceDirectory
  }
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
  $pending = [Collections.Generic.List[string]]::new()
  if ($env:FAKE_ZERO_FORWARD -cne '1') {
    $pending.Add('20240102000000_forward_one.sql')
    $pending.Add('20240103000000_forward_two.sql')
  }
  switch ($env:FAKE_SUPABASE_MODE) {
    'push-missing-forward' { $pending.RemoveAt($pending.Count - 1) }
    'push-extra-forward' { $pending.Add('20240104000000_extra.sql') }
    'push-duplicate-forward' { $pending.Insert($pending.Count - 1, $pending[0]) }
    'push-reordered-forward' {
      $file = $pending[0]
      $pending[0] = $pending[1]
      $pending[1] = $file
    }
    'push-renamed-forward' { $pending[0] = '20240102000000_renamed.sql' }
    'push-remote-marker' { $pending.Insert(0, '20240101010101_verified_remote.sql') }
    'push-baseline' { $pending.Insert(0, '20231231000000_baseline.sql') }
    'zero-forward-pending' { $pending.Add('20240104000000_unapproved.sql') }
  }
  Write-Output 'DRY RUN: migrations will *not* be pushed to the database.'
  Write-Output 'Connecting to remote database...'
  if ($env:FAKE_SUPABASE_MODE -eq 'up-to-date' -or ($env:FAKE_ZERO_FORWARD -ceq '1' -and $env:FAKE_SUPABASE_MODE -ne 'zero-forward-pending')) {
    Write-Output 'Remote database is up to date.'
  } else {
    Write-Output 'Would push these migrations:'
    foreach ($file in $pending) {
      Write-Output (' {0} {1}' -f [char]0x2022, $file)
    }
    Write-Output 'Finished supabase db push.'
  }
  if ($env:FAKE_SUPABASE_MODE -eq 'push-unknown-grammar') {
    Write-Output 'unexpected parser drift'
  }
  exit 0
}

exit 91
`

const fakeCliLauncher = '@powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-supabase-impl.ps1" %*\r\n'

const cleanupAttackerSource = String.raw`param(
  [Parameter(Mandatory = $true)][string]$ReadyPath,
  [Parameter(Mandatory = $true)][string]$TempBase,
  [Parameter(Mandatory = $true)][string]$SubdirectoryTarget,
  [Parameter(Mandatory = $true)][string]$TempBaseTarget,
  [Parameter(Mandatory = $true)][int]$InitialCount
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CrimsonCleanupAttackNative
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool MoveFileExW(string existingPath, string newPath, uint flags);
}
'@

function Get-PathState([string]$Path) {
  try {
    $Item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    return @{
      exists = $true
      isReparse = (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
    }
  } catch {
    return @{ exists = $false; isReparse = $null }
  }
}

function Try-Replacement([string]$Path, [string]$Backup, [string]$Target) {
  $MoveSucceeded = [CrimsonCleanupAttackNative]::MoveFileExW($Path, $Backup, 0)
  $Win32Error = if ($MoveSucceeded) { 0 } else { [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
  $JunctionAttempted = $false
  $JunctionCreated = $false
  $JunctionError = $null

  if ($MoveSucceeded) {
    $JunctionAttempted = $true
    try {
      New-Item -ItemType Junction -Path $Path -Target $Target -ErrorAction Stop | Out-Null
      $JunctionCreated = $true
    } catch {
      $JunctionError = $_.Exception.GetType().FullName
    }
  }

  $PathState = Get-PathState $Path
  $LockRejected = ((5, 32) -contains $Win32Error) -and $PathState.exists -and -not $PathState.isReparse
  $Status = if ($LockRejected) {
    'lock-rejected'
  } elseif ($MoveSucceeded -and $JunctionCreated) {
    'substituted'
  } elseif ($MoveSucceeded) {
    'junction-failed'
  } else {
    'ambiguous-move-failure'
  }

  return @{
    status = $Status
    replacementAttempted = $true
    moveSucceeded = $MoveSucceeded
    win32Error = $Win32Error
    junctionAttempted = $JunctionAttempted
    junctionCreated = $JunctionCreated
    junctionError = $JunctionError
    pathExistsAfter = $PathState.exists
    isReparseAfter = $PathState.isReparse
  }
}

$Deadline = [DateTime]::UtcNow.AddSeconds(30)
$RaceDirectory = $null
while ([DateTime]::UtcNow -lt $Deadline) {
  if (Test-Path -LiteralPath $ReadyPath) {
    $RaceDirectory = Get-Content -Raw -LiteralPath $ReadyPath
    break
  }
  Start-Sleep -Milliseconds 5
}
if ($null -eq $RaceDirectory) {
  ConvertTo-Json -Depth 5 -Compress @{
    observedCleanup = $false
    attemptedBothDuringCleanup = $false
    status = 'missed-ready'
    initialCount = $InitialCount
    remainingAtObservation = $null
    remainingAfterAttempts = $null
    subdirectory = @{ replacementAttempted = $false; status = 'not-attempted' }
    tempBase = @{ replacementAttempted = $false; status = 'not-attempted' }
  }
  exit 0
}

$ObservedCleanup = $false
$RemainingAtObservation = $null
while ([DateTime]::UtcNow -lt $Deadline) {
  try {
    $Remaining = @(Get-ChildItem -LiteralPath $RaceDirectory -Force -ErrorAction Stop).Count
    if ($Remaining -gt 0 -and $Remaining -lt $InitialCount) {
      $ObservedCleanup = $true
      $RemainingAtObservation = $Remaining
      break
    }
  } catch {}
  Start-Sleep -Milliseconds 1
}

if (-not $ObservedCleanup) {
  ConvertTo-Json -Depth 5 -Compress @{
    observedCleanup = $false
    attemptedBothDuringCleanup = $false
    status = 'missed-cleanup-window'
    initialCount = $InitialCount
    remainingAtObservation = $null
    remainingAfterAttempts = $null
    subdirectory = @{ replacementAttempted = $false; status = 'not-attempted' }
    tempBase = @{ replacementAttempted = $false; status = 'not-attempted' }
  }
  exit 0
}

$TempBaseResult = Try-Replacement $TempBase ("{0}-attacker-backup" -f $TempBase) $TempBaseTarget
$SubdirectoryResult = Try-Replacement $RaceDirectory ("{0}-attacker-backup" -f $RaceDirectory) $SubdirectoryTarget

$RemainingAfterAttempts = $null
try {
  $RemainingAfterAttempts = @(Get-ChildItem -LiteralPath $RaceDirectory -Force -ErrorAction Stop).Count
} catch {}
$AttemptedBothDuringCleanup = (
  $SubdirectoryResult.replacementAttempted -and
  $TempBaseResult.replacementAttempted -and
  $null -ne $RemainingAfterAttempts -and
  $RemainingAfterAttempts -gt 0 -and
  $RemainingAfterAttempts -lt $InitialCount
)

ConvertTo-Json -Depth 5 -Compress @{
  observedCleanup = $ObservedCleanup
  attemptedBothDuringCleanup = $AttemptedBothDuringCleanup
  status = if ($AttemptedBothDuringCleanup) { 'attacks-attempted-during-cleanup' } else { 'cleanup-window-ended-during-attempts' }
  initialCount = $InitialCount
  remainingAtObservation = $RemainingAtObservation
  remainingAfterAttempts = $RemainingAfterAttempts
  subdirectory = $SubdirectoryResult
  tempBase = $TempBaseResult
}
`

const mutateManifestAfterBuildSource = `import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildProjection as buildRealProjection } from './build-supabase-projection-real.mjs'

export async function buildProjection(options) {
  const summary = await buildRealProjection(options)
  const manifestPath = join(options.rootDir, 'scripts', 'release', 'migration-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const forward of manifest.entries.filter((entry) => entry.class === 'forward_pending')) {
    forward.class = 'baseline_present'
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\\n')
  return summary
}
`

function overrideProjectionSummarySource(value) {
  return `import { buildProjection as buildRealProjection } from './build-supabase-projection-real.mjs'

export async function buildProjection(options) {
  await buildRealProjection(options)
  return ${JSON.stringify(value)}
}
`
}

function validProjectionSummary({ zeroForward = false } = {}) {
  return {
    forwardPendingCount: zeroForward ? 0 : 2,
    forwardPendingVersions: zeroForward ? [] : ['20240102000000', '20240103000000'],
    forwardPendingFilenames: zeroForward ? [] : [...forwardFiles],
    projectedRemoteVersions: ['20240101010101'],
    projectedRemoteFilenames: [projectedRemoteFile],
  }
}

async function git(rootDir, args) {
  await execFileAsync('git', ['-C', rootDir, ...args], { windowsHide: true })
}

async function makeFixture({
  candidate = false,
  dirty = false,
  forceIdentityFailureBeforeLink = false,
  mutateManifestAfterBuild = false,
  pauseAtCreationIdentityBoundary = false,
  projectionSummaryOverride,
  zeroForward = false,
} = {}) {
  const fixtureParent = await mkdtemp(join(tmpdir(), 'crimson-wrapper-fixture-'))
  const rootDir = join(fixtureParent, 'repo')
  const releaseDir = join(rootDir, 'scripts', 'release')
  const migrationsDir = join(rootDir, 'supabase', 'migrations')
  const explicitCliDir = join(fixtureParent, 'cli space & (literal) ^!')
  const fakeCli = join(explicitCliDir, 'fake supabase & cli.cmd')
  const fakeCliImplementation = join(explicitCliDir, 'fake-supabase-impl.ps1')
  const defaultCliDir = join(rootDir, 'node_modules', '.bin')
  const defaultCli = join(defaultCliDir, 'supabase.cmd')
  const defaultCliImplementation = join(defaultCliDir, 'fake-supabase-impl.ps1')
  const cleanupAttacker = join(fixtureParent, 'cleanup-attacker.ps1')
  const logPath = join(fixtureParent, 'fake-cli-log.jsonl')
  const tempBase = join(fixtureParent, 'temp')
  const sentinel = join(tempBase, 'keep-me.txt')
  const junctionTarget = join(fixtureParent, 'external-junction-target')
  const junctionSentinel = join(junctionTarget, 'must-survive.txt')
  const tempBaseTarget = join(fixtureParent, 'temp-base-target')
  const tempBaseJunction = join(fixtureParent, 'temp-base-junction')
  const tempBaseSentinel = join(tempBaseTarget, 'must-survive.txt')
  const raceReady = join(fixtureParent, 'race-ready.txt')
  const useLockReady = join(fixtureParent, 'use-lock-ready.txt')
  const useLockDone = join(fixtureParent, 'use-lock-done.txt')
  const creationLockReady = join(fixtureParent, 'creation-lock-ready.txt')
  const creationLockDone = join(fixtureParent, 'creation-lock-done.txt')
  const manifest = verifiedManifest({ zeroForward })

  if (candidate) {
    manifest.entries[0].releaseProof = { status: 'candidate', evidence: null, remediationVersions: [] }
  }

  await mkdir(releaseDir, { recursive: true })
  await mkdir(migrationsDir, { recursive: true })
  await mkdir(explicitCliDir, { recursive: true })
  await mkdir(defaultCliDir, { recursive: true })
  await mkdir(tempBase)
  await mkdir(junctionTarget)
  await mkdir(tempBaseTarget)
  const fixtureWrapper = join(releaseDir, 'run-linked-dry-run.ps1')
  await cp(sourceWrapper, fixtureWrapper)
  if (forceIdentityFailureBeforeLink) {
    const wrapperSource = await readFile(fixtureWrapper, 'utf8')
    const identityGate = "Assert-TempRootUseIdentity -Phase 'link'\n  $LinkOutput"
    assert.equal(wrapperSource.includes(identityGate), true)
    await writeFile(
      fixtureWrapper,
      wrapperSource.replace(identityGate, "throw 'Fallo de identidad temporal simulado.'\n  $LinkOutput"),
    )
  }
  if (pauseAtCreationIdentityBoundary) {
    const wrapperSource = await readFile(fixtureWrapper, 'utf8')
    const vulnerableBoundary = "New-Item -ItemType Directory -Path $TempRoot -ErrorAction Stop | Out-Null\n    $TempRootUseLock = Open-DirectoryIdentityLock -LiteralPath $TempRoot"
    const atomicBoundary = '$TempRootUseLock = New-DirectoryIdentityLock -LiteralPath $TempRoot'
    const pauseSource = String.raw`Set-Content -NoNewline -LiteralPath $env:FAKE_CREATION_LOCK_READY -Value $TempRoot
    $CreationHookDeadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not (Test-Path -LiteralPath $env:FAKE_CREATION_LOCK_DONE)) {
      if ([DateTime]::UtcNow -ge $CreationHookDeadline) { throw 'Hook de creación agotado.' }
      Start-Sleep -Milliseconds 5
    }`
    let hookedSource
    if (wrapperSource.includes(vulnerableBoundary)) {
      hookedSource = wrapperSource.replace(
        vulnerableBoundary,
        `New-Item -ItemType Directory -Path $TempRoot -ErrorAction Stop | Out-Null\n    ${pauseSource}\n    $TempRootUseLock = Open-DirectoryIdentityLock -LiteralPath $TempRoot`,
      )
    } else {
      assert.equal(wrapperSource.includes(atomicBoundary), true)
      hookedSource = wrapperSource.replace(atomicBoundary, `${atomicBoundary}\n    ${pauseSource}`)
    }
    await writeFile(fixtureWrapper, hookedSource)
  }
  if (mutateManifestAfterBuild || projectionSummaryOverride !== undefined) {
    await cp(join(sourceRoot, 'scripts', 'release', 'build-supabase-projection.mjs'), join(releaseDir, 'build-supabase-projection-real.mjs'))
    await writeFile(
      join(releaseDir, 'build-supabase-projection.mjs'),
      mutateManifestAfterBuild ? mutateManifestAfterBuildSource : overrideProjectionSummarySource(projectionSummaryOverride),
    )
  } else {
    await cp(join(sourceRoot, 'scripts', 'release', 'build-supabase-projection.mjs'), join(releaseDir, 'build-supabase-projection.mjs'))
  }
  await cp(join(sourceRoot, 'scripts', 'release', 'migration-manifest.mjs'), join(releaseDir, 'migration-manifest.mjs'))
  await writeFile(join(releaseDir, 'migration-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(rootDir, 'supabase', 'config.toml'), '[db.migrations]\nenabled = false\n')
  await writeFile(join(migrationsDir, remoteFile), remoteSql)
  if (!zeroForward) {
    await Promise.all(forwardFiles.map((file, index) => writeFile(join(migrationsDir, file), forwardSql[index])))
  }
  await writeFile(fakeCli, fakeCliLauncher)
  await writeFile(fakeCliImplementation, fakeCliSource)
  await writeFile(defaultCli, fakeCliLauncher)
  await writeFile(defaultCliImplementation, fakeCliSource)
  await writeFile(cleanupAttacker, cleanupAttackerSource)
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
    defaultCli,
    logPath,
    tempBase,
    sentinel,
    junctionTarget,
    junctionSentinel,
    tempBaseTarget,
    tempBaseJunction,
    tempBaseSentinel,
    raceReady,
    useLockReady,
    useLockDone,
    creationLockReady,
    creationLockDone,
    cleanupAttacker,
    zeroForward,
  }
}

function runWrapper(fixture, mode = 'success', {
  tempBase = fixture.tempBase,
  useDefaultCli = false,
  cliPath = fixture.fakeCli,
} = {}) {
  const path = `${dirname(process.execPath)};${process.env.PATH ?? ''}`
  const wrapperArgs = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(fixture.rootDir, 'scripts', 'release', 'run-linked-dry-run.ps1'),
  ]
  if (!useDefaultCli) wrapperArgs.push('-SupabaseCli', cliPath)
  const child = spawn(
    'powershell.exe',
    wrapperArgs,
    {
      cwd: fixture.rootDir,
      env: {
        ...process.env,
        PATH: path,
        TEMP: tempBase,
        TMP: tempBase,
        FAKE_SUPABASE_LOG: fixture.logPath,
        FAKE_SUPABASE_MODE: mode,
        FAKE_ZERO_FORWARD: fixture.zeroForward ? '1' : '0',
        FAKE_JUNCTION_TARGET: fixture.junctionTarget,
        FAKE_RACE_READY: fixture.raceReady,
        FAKE_USE_LOCK_READY: fixture.useLockReady,
        FAKE_USE_LOCK_DONE: fixture.useLockDone,
        FAKE_CREATION_LOCK_READY: fixture.creationLockReady,
        FAKE_CREATION_LOCK_DONE: fixture.creationLockDone,
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

async function runRootReplacementAttacker(fixture, readyPath, donePath) {
  const deadline = Date.now() + 30_000
  let tempRoot
  while (Date.now() < deadline) {
    try {
      tempRoot = (await readFile(readyPath, 'utf8')).trim()
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await delay(5)
  }
  if (!tempRoot) {
    return { reachedActiveWindow: false, moveSucceeded: false, junctionAttempted: false }
  }

  const backup = `${tempRoot}-attacker-backup`
  let moveSucceeded = false
  let moveErrorCode = null
  let junctionAttempted = false
  let junctionCreated = false
  try {
    await rename(tempRoot, backup)
    moveSucceeded = true
  } catch (error) {
    moveErrorCode = error.code ?? null
  }
  if (moveSucceeded) {
    junctionAttempted = true
    try {
      await symlink(fixture.junctionTarget, tempRoot, 'junction')
      junctionCreated = true
    } catch {}
  }

  let pathExistsAfter = false
  let isReparseAfter = null
  try {
    const state = await lstat(tempRoot)
    pathExistsAfter = true
    isReparseAfter = state.isSymbolicLink()
  } catch {}
  await writeFile(donePath, 'done\n')

  return {
    reachedActiveWindow: true,
    moveSucceeded,
    moveErrorCode,
    junctionAttempted,
    junctionCreated,
    pathExistsAfter,
    isReparseAfter,
  }
}

function runUseLockAttacker(fixture) {
  return runRootReplacementAttacker(fixture, fixture.useLockReady, fixture.useLockDone)
}

function runCreationBoundaryAttacker(fixture) {
  return runRootReplacementAttacker(fixture, fixture.creationLockReady, fixture.creationLockDone)
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

function assertNormalizedSuccess(result, { zeroForward = false } = {}) {
  assert.equal(result.code, 0, result.stderr)
  const lines = result.stdout.trim().split(/\r?\n/)
  assert.equal(lines.length, 9)
  assert.equal(lines[0], 'Supabase CLI version: 2.113.0')
  assert.match(lines[1], /^Git SHA: [a-f0-9]{40}$/)
  assert.equal(lines[2], 'Projected remote versions: 20240101010101')
  assert.equal(lines[3], `Projected remote filenames: ${projectedRemoteFile}`)
  assert.equal(lines[4], `Approved forward count: ${zeroForward ? 0 : 2}`)
  assert.equal(lines[5], `Approved forward versions: ${zeroForward ? '<none>' : '20240102000000, 20240103000000'}`)
  assert.equal(lines[6], `Approved forward filenames: ${zeroForward ? '<none>' : forwardFiles.join(', ')}`)
  assert.equal(lines[7], 'Migration list outcome: exact')
  assert.equal(lines[8], `Dry-run outcome: ${zeroForward ? 'up to date' : 'exact batch'}`)
  assert.doesNotMatch(result.stdout, /Connecting to|Time \(UTC\)|DRY RUN|Would push|Finished supabase|crimson-release-/i)
}

function runCleanupAttacker(fixture) {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      fixture.cleanupAttacker,
      '-ReadyPath',
      fixture.raceReady,
      '-TempBase',
      fixture.tempBase,
      '-SubdirectoryTarget',
      fixture.junctionTarget,
      '-TempBaseTarget',
      fixture.tempBaseTarget,
      '-InitialCount',
      '2500',
    ],
    { windowsHide: true },
  )

  return new Promise((resolvePromise, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`cleanup attacker failed (${code}): ${stderr}`))
        return
      }
      try {
        resolvePromise(JSON.parse(stdout.trim()))
      } catch (error) {
        reject(new Error(`cleanup attacker returned invalid JSON: ${error.message}`))
      }
    })
  })
}

function assertCleanupAttackEvidence(result, initialCount = 2500) {
  assert.equal(result.observedCleanup, true, `cleanup was not observed: ${JSON.stringify(result)}`)
  assert.equal(result.initialCount, initialCount)
  assert.ok(Number.isInteger(result.remainingAtObservation))
  assert.ok(result.remainingAtObservation > 0 && result.remainingAtObservation < initialCount)
  assert.equal(result.attemptedBothDuringCleanup, true, `both attempts were not bracketed by active cleanup: ${JSON.stringify(result)}`)
  assert.ok(Number.isInteger(result.remainingAfterAttempts))
  assert.ok(result.remainingAfterAttempts > 0 && result.remainingAfterAttempts < initialCount)

  for (const label of ['subdirectory', 'tempBase']) {
    const attempt = result[label]
    assert.equal(attempt?.replacementAttempted, true, `${label} replacement was not attempted`)
    assert.equal(attempt.status, 'lock-rejected', `${label} did not report an unambiguous lock rejection`)
    assert.equal(attempt.moveSucceeded, false, `${label} was moved`)
    assert.ok([5, 32].includes(attempt.win32Error), `${label} returned Win32 error ${attempt.win32Error}`)
    assert.equal(attempt.junctionAttempted, false, `${label} unexpectedly reached junction creation`)
    assert.equal(attempt.junctionCreated, false, `${label} was replaced by a junction`)
    assert.equal(attempt.pathExistsAfter, true, `${label} disappeared after the rejected move`)
    assert.equal(attempt.isReparseAfter, false, `${label} became a reparse point`)
  }
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

    assertNormalizedSuccess(result)
    assert.match(fixture.fakeCli, /cli space & \(literal\) \^![\\/]fake supabase & cli\.cmd$/)
    assert.equal(calls.length, 4)
    const projection = calls[1][1]
    assert.deepEqual(calls, [
      ['--version'],
      ['--workdir', projection, 'link', '--project-ref', productionRef],
      ['--workdir', projection, 'migration', 'list', '--linked'],
      ['--workdir', projection, 'db', 'push', '--linked', '--dry-run'],
    ])
    assert.match(projection, /crimson-release-[0-9a-f]{32}[\\/]projection$/i)
    assert.doesNotMatch(result.stdout, /fake link output/)
    assert.equal(calls.some((call) => call.join(' ') === '--workdir ' + projection + ' db push --linked'), false)
    await assertExactCleanup(fixture)
  })
})

test('resolves and invokes the literal default node_modules Supabase cmd path', async () => {
  await withFixture({}, async (fixture) => {
    const result = await runWrapper(fixture, 'success', { useDefaultCli: true })
    const calls = await readCalls(fixture.logPath)

    assertNormalizedSuccess(result)
    assert.equal(calls[0][0], '--version')
    assert.equal(calls[1][2], 'link')
    assert.equal(resolve(fixture.defaultCli), join(fixture.rootDir, 'node_modules', '.bin', 'supabase.cmd'))
    await assertExactCleanup(fixture)
  })
})

test('does not let the default cmd path bypass the exact version gate', async () => {
  await withFixture({}, async (fixture) => {
    const result = await runWrapper(fixture, 'version-wrong', { useDefaultCli: true })

    assert.notEqual(result.code, 0)
    assert.deepEqual(await readCalls(fixture.logPath), [['--version']])
    assert.equal(result.stdout, '')
    await assertExactCleanup(fixture)
  })
})

for (const mode of ['version-wrong', 'version-multiline', 'version-missing', 'version-malformed']) {
  test(`blocks ${mode} before link`, async () => {
    await withFixture({}, async (fixture) => {
      const result = await runWrapper(fixture, mode)

      assert.notEqual(result.code, 0)
      assert.deepEqual(await readCalls(fixture.logPath), [['--version']])
      assert.equal(result.stdout, '')
      await assertExactCleanup(fixture)
    })
  })
}

for (const mode of ['missing-ref', 'foreign-ref']) {
  test(`blocks ${mode} after link and cleans only its temporary root`, async () => {
    await withFixture({}, async (fixture) => {
      const result = await runWrapper(fixture, mode)
      const calls = await readCalls(fixture.logPath)

      assert.notEqual(result.code, 0)
      assert.equal(calls.length, 2)
      assert.deepEqual(calls[0], ['--version'])
      assert.equal(calls[1][2], 'link')
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
    assert.deepEqual(await readCalls(fixture.logPath), [['--version']])
    await assertExactCleanup(fixture)
  })
})

test('blocks an up-to-date result when the verified manifest has a forward migration', async () => {
  await withFixture({}, async (fixture) => {
    const result = await runWrapper(fixture, 'up-to-date')
    const calls = await readCalls(fixture.logPath)

    assert.notEqual(result.code, 0)
    assert.equal(calls.length, 4)
    assert.equal(calls[3].at(-1), '--dry-run')
    assert.equal(result.stdout, '')
    await assertExactCleanup(fixture)
  })
})

test('uses the materialized projection snapshot when the manifest changes after build', async () => {
  await withFixture({ mutateManifestAfterBuild: true }, async (fixture) => {
    const result = await runWrapper(fixture)
    const calls = await readCalls(fixture.logPath)
    const changedManifest = JSON.parse(await readFile(join(fixture.rootDir, 'scripts', 'release', 'migration-manifest.json'), 'utf8'))

    assert.equal(changedManifest.entries.some((entry) => entry.class === 'forward_pending'), false)
    assertNormalizedSuccess(result)
    assert.equal(calls.length, 4)
    await assertExactCleanup(fixture)
  })
})

const summaryValidationCases = [
  { name: 'a scalar summary', value: 2 },
  { name: 'an unknown field', value: { ...validProjectionSummary(), unknown: true } },
  {
    name: 'a missing field',
    value: {
      forwardPendingCount: 2,
      forwardPendingVersions: ['20240102000000', '20240103000000'],
      forwardPendingFilenames: [...forwardFiles],
      projectedRemoteVersions: ['20240101010101'],
    },
  },
  { name: 'a string count', value: { ...validProjectionSummary(), forwardPendingCount: '2' } },
  { name: 'an inconsistent count', value: { ...validProjectionSummary(), forwardPendingCount: 1 } },
  { name: 'a scalar array field', value: { ...validProjectionSummary(), forwardPendingVersions: '20240102000000' } },
  { name: 'a numeric-coerced version', value: { ...validProjectionSummary(), forwardPendingVersions: [20240102000000, '20240103000000'] } },
  { name: 'duplicate forward versions', value: { ...validProjectionSummary(), forwardPendingVersions: ['20240102000000', '20240102000000'] } },
  { name: 'duplicate forward filenames', value: { ...validProjectionSummary(), forwardPendingFilenames: [forwardFiles[0], forwardFiles[0]] } },
  { name: 'unordered forward versions', value: { ...validProjectionSummary(), forwardPendingVersions: ['20240103000000', '20240102000000'] } },
  { name: 'unordered remote versions', value: { ...validProjectionSummary(), projectedRemoteVersions: ['20240101010102', '20240101010101'], projectedRemoteFilenames: ['20240101010102_second.sql', projectedRemoteFile] } },
  { name: 'a mismatched forward filename version', value: { ...validProjectionSummary(), forwardPendingFilenames: ['20240104000000_wrong.sql', forwardFiles[1]] } },
  { name: 'an unsafe projected filename', value: { ...validProjectionSummary(), projectedRemoteFilenames: ['20240101010101_unsafe name.sql'] } },
]

for (const invalidSummary of summaryValidationCases) {
  test(`rejects projection summary with ${invalidSummary.name}`, async () => {
    await withFixture({ projectionSummaryOverride: invalidSummary.value }, async (fixture) => {
      const result = await runWrapper(fixture)

      assert.notEqual(result.code, 0)
      assert.deepEqual(await readCalls(fixture.logPath), [['--version']])
      await assertExactCleanup(fixture)
    })
  })
}

for (const mode of [
  'list-missing-forward',
  'list-extra-forward',
  'list-duplicate-forward',
  'list-reordered-forward',
  'list-remote-only',
  'list-local-only-marker',
  'list-additional-local-history',
  'list-duplicate-remote',
  'list-malformed',
  'list-unknown-grammar',
]) {
  test(`rejects migration list mode ${mode} before dry-run`, async () => {
    await withFixture({}, async (fixture) => {
      const result = await runWrapper(fixture, mode)
      const calls = await readCalls(fixture.logPath)

      assert.notEqual(result.code, 0)
      assert.equal(calls.length, 3)
      assert.deepEqual(calls[0], ['--version'])
      assert.equal(calls[2][2], 'migration')
      assert.equal(result.stdout, '')
      assert.doesNotMatch(result.stderr, /unexpected parser drift/)
      await assertExactCleanup(fixture)
    })
  })
}

for (const mode of [
  'push-missing-forward',
  'push-extra-forward',
  'push-duplicate-forward',
  'push-reordered-forward',
  'push-renamed-forward',
  'push-remote-marker',
  'push-baseline',
  'push-unknown-grammar',
]) {
  test(`rejects dry-run mode ${mode}`, async () => {
    await withFixture({}, async (fixture) => {
      const result = await runWrapper(fixture, mode)
      const calls = await readCalls(fixture.logPath)

      assert.notEqual(result.code, 0)
      assert.equal(calls.length, 4)
      assert.deepEqual(calls[0], ['--version'])
      assert.equal(calls[3].at(-1), '--dry-run')
      assert.equal(result.stdout, '')
      assert.doesNotMatch(result.stderr, /unexpected parser drift/)
      await assertExactCleanup(fixture)
    })
  })
}

test('accepts zero approved forwards only when list and dry-run prove exact up-to-date state', async () => {
  await withFixture({ zeroForward: true }, async (fixture) => {
    const result = await runWrapper(fixture)
    const calls = await readCalls(fixture.logPath)

    assertNormalizedSuccess(result, { zeroForward: true })
    assert.equal(calls.length, 4)
    assert.equal(calls[3].at(-1), '--dry-run')
    await assertExactCleanup(fixture)
  })
})

test('rejects a pending dry-run batch when zero forwards are approved', async () => {
  await withFixture({ zeroForward: true }, async (fixture) => {
    const result = await runWrapper(fixture, 'zero-forward-pending')

    assert.notEqual(result.code, 0)
    assert.equal((await readCalls(fixture.logPath)).length, 4)
    assert.equal(result.stdout, '')
    await assertExactCleanup(fixture)
  })
})

test('rejects a local-only migration-list row when zero forwards are approved', async () => {
  await withFixture({ zeroForward: true }, async (fixture) => {
    const result = await runWrapper(fixture, 'list-extra-forward')

    assert.notEqual(result.code, 0)
    assert.equal((await readCalls(fixture.logPath)).length, 3)
    assert.equal(result.stdout, '')
    await assertExactCleanup(fixture)
  })
})

test('fails closed on a substituted temporary-root junction without traversing its external target', async (t) => {
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
    const calls = await readCalls(fixture.logPath)

    assert.notEqual(result.code, 0)
    assert.equal(result.stdout, '')
    assert.equal(calls.length, 4)
    assert.equal(calls[3].at(-1), '--dry-run')
    assert.equal(await readFile(fixture.junctionSentinel, 'utf8'), 'external preserve\n')
    assert.deepEqual(await readdir(fixture.junctionTarget), ['must-survive.txt'])
    assert.equal(await readFile(fixture.sentinel, 'utf8'), 'preserve\n')
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

test('rejects missed or ambiguous cleanup attacker evidence', () => {
  assert.throws(() => assertCleanupAttackEvidence({
    observedCleanup: false,
    initialCount: 2500,
    attemptedBothDuringCleanup: false,
    remainingAtObservation: null,
    remainingAfterAttempts: null,
    subdirectory: { replacementAttempted: false, status: 'not-attempted' },
    tempBase: { replacementAttempted: false, status: 'not-attempted' },
  }))

  assert.throws(() => assertCleanupAttackEvidence({
    observedCleanup: true,
    initialCount: 2500,
    attemptedBothDuringCleanup: true,
    remainingAtObservation: 100,
    remainingAfterAttempts: 90,
    subdirectory: {
      replacementAttempted: true,
      status: 'ambiguous-move-failure',
      moveSucceeded: false,
      win32Error: 3,
      junctionAttempted: false,
      junctionCreated: false,
      pathExistsAfter: false,
      isReparseAfter: null,
    },
    tempBase: {
      replacementAttempted: true,
      status: 'lock-rejected',
      moveSucceeded: false,
      win32Error: 5,
      junctionAttempted: false,
      junctionCreated: false,
      pathExistsAfter: true,
      isReparseAfter: false,
    },
  }))

  assert.throws(() => assertCleanupAttackEvidence({
    observedCleanup: true,
    initialCount: 2500,
    attemptedBothDuringCleanup: true,
    remainingAtObservation: 100,
    remainingAfterAttempts: 90,
    subdirectory: {
      replacementAttempted: true,
      status: 'junction-failed',
      moveSucceeded: true,
      win32Error: 0,
      junctionAttempted: false,
      junctionCreated: false,
      pathExistsAfter: false,
      isReparseAfter: null,
    },
    tempBase: {
      replacementAttempted: true,
      status: 'lock-rejected',
      moveSucceeded: false,
      win32Error: 32,
      junctionAttempted: false,
      junctionCreated: false,
      pathExistsAfter: true,
      isReparseAfter: false,
    },
  }))
})

test('holds directory identities while a concurrent attacker attempts cleanup substitution', async (t) => {
  await withFixture({}, async (fixture) => {
    const attacker = runCleanupAttacker(fixture)
    const [result, attackResult] = await Promise.all([
      runWrapper(fixture, 'cleanup-race-after-push'),
      attacker,
    ])

    assert.equal(result.code, 0, `${result.stderr}\nattack=${JSON.stringify(attackResult)}`)
    assertCleanupAttackEvidence(attackResult)
    t.diagnostic(JSON.stringify({
      observedCleanup: attackResult.observedCleanup,
      attemptedBothDuringCleanup: attackResult.attemptedBothDuringCleanup,
      initialCount: attackResult.initialCount,
      remainingAtObservation: attackResult.remainingAtObservation,
      remainingAfterAttempts: attackResult.remainingAfterAttempts,
      subdirectory: {
        status: attackResult.subdirectory.status,
        win32Error: attackResult.subdirectory.win32Error,
        pathExistsAfter: attackResult.subdirectory.pathExistsAfter,
        isReparseAfter: attackResult.subdirectory.isReparseAfter,
      },
      tempBase: {
        status: attackResult.tempBase.status,
        win32Error: attackResult.tempBase.win32Error,
        pathExistsAfter: attackResult.tempBase.pathExistsAfter,
        isReparseAfter: attackResult.tempBase.isReparseAfter,
      },
    }))
    assert.equal(await readFile(fixture.junctionSentinel, 'utf8'), 'external preserve\n')
    assert.equal(await readFile(fixture.tempBaseSentinel, 'utf8'), 'temp base preserve\n')
    await assertExactCleanup(fixture)
  })
})

test('holds the exact temporary-root identity throughout projection use and rejects an active rename/junction attack', async () => {
  await withFixture({}, async (fixture) => {
    const [result, attackResult] = await Promise.all([
      runWrapper(fixture, 'use-lock-attack'),
      runUseLockAttacker(fixture),
    ])
    const calls = await readCalls(fixture.logPath)

    assert.equal(attackResult.reachedActiveWindow, true, JSON.stringify(attackResult))
    assert.equal(attackResult.moveSucceeded, false, JSON.stringify(attackResult))
    assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(attackResult.moveErrorCode), JSON.stringify(attackResult))
    assert.equal(attackResult.junctionAttempted, false, JSON.stringify(attackResult))
    assert.equal(attackResult.junctionCreated, false, JSON.stringify(attackResult))
    assert.equal(attackResult.pathExistsAfter, true, JSON.stringify(attackResult))
    assert.equal(attackResult.isReparseAfter, false, JSON.stringify(attackResult))
    assertNormalizedSuccess(result)
    assert.equal(calls.length, 4)
    assert.equal(await readFile(fixture.junctionSentinel, 'utf8'), 'external preserve\n')
    await assertExactCleanup(fixture)
  })
})

test('creates the temporary root with its non-delete-sharing handle already held', async () => {
  await withFixture({ pauseAtCreationIdentityBoundary: true }, async (fixture) => {
    const [result, attackResult] = await Promise.all([
      runWrapper(fixture),
      runCreationBoundaryAttacker(fixture),
    ])

    assert.equal(attackResult.reachedActiveWindow, true, JSON.stringify(attackResult))
    assert.equal(attackResult.moveSucceeded, false, JSON.stringify(attackResult))
    assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(attackResult.moveErrorCode), JSON.stringify(attackResult))
    assert.equal(attackResult.junctionAttempted, false, JSON.stringify(attackResult))
    assert.equal(attackResult.junctionCreated, false, JSON.stringify(attackResult))
    assert.equal(attackResult.pathExistsAfter, true, JSON.stringify(attackResult))
    assert.equal(attackResult.isReparseAfter, false, JSON.stringify(attackResult))
    assertNormalizedSuccess(result)
    assert.equal((await readCalls(fixture.logPath)).length, 4)
    assert.equal(await readFile(fixture.junctionSentinel, 'utf8'), 'external preserve\n')
    await assertExactCleanup(fixture)
  })
})

test('runs no linked command after the pre-link identity gate fails', async () => {
  await withFixture({ forceIdentityFailureBeforeLink: true }, async (fixture) => {
    const result = await runWrapper(fixture)

    assert.notEqual(result.code, 0)
    assert.equal(result.stdout, '')
    assert.deepEqual(await readCalls(fixture.logPath), [['--version']])
    await assertExactCleanup(fixture)
  })
})

for (const failure of [
  { mode: 'link-fail', expectedCalls: 2 },
  { mode: 'list-fail', expectedCalls: 3 },
  { mode: 'push-fail', expectedCalls: 4 },
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

test('opens the use lock under the creation-base lock and revalidates identity before each sensitive use', async () => {
  const source = await readFile(sourceWrapper, 'utf8')
  const creationStart = source.indexOf('$CreationBaseLock = Open-SafeTempBaseLock')
  const creationEnd = source.indexOf('$CreationBaseLock.Dispose()', creationStart)
  const useLockOpen = source.indexOf('$TempRootUseLock = New-DirectoryIdentityLock', creationStart)

  assert.ok(creationStart >= 0)
  assert.ok(useLockOpen > creationStart && useLockOpen < creationEnd)
  assert.doesNotMatch(source.slice(creationStart, creationEnd), /New-Item\s+-ItemType\s+Directory\s+-Path\s+\$TempRoot/i)
  assert.match(source, /NtCreateFile/)
  assert.match(source, /FileCreate/)
  assert.match(source, /if \(\$TempRootUseLock\.IsReparsePoint\)/)
  for (const phase of ['projection-build', 'link', 'linked-ref-read', 'migration-list', 'dry-run', 'cleanup']) {
    assert.match(source, new RegExp(`Assert-TempRootUseIdentity -Phase '${phase}'`))
  }
  const cleanupRevalidation = source.indexOf("Assert-TempRootUseIdentity -Phase 'cleanup'")
  const useLockDispose = source.indexOf('$TempRootUseLock.Dispose()', cleanupRevalidation)
  const removeTree = source.indexOf('Remove-ExactTree -LiteralPath $CleanupTarget', cleanupRevalidation)
  assert.ok(cleanupRevalidation >= 0 && useLockDispose > cleanupRevalidation && removeTree > useLockDispose)
})

test('parses the Win32 identity-lock helper with Windows PowerShell 5.1', async () => {
  const parserProbe = String.raw`if ($PSVersionTable.PSVersion.Major -ne 5) { exit 51 }
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($env:WRAPPER_UNDER_TEST, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -ne 0) { exit 52 }
Write-Output 'powershell-5.1-parser-ok'
`
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', parserProbe],
    {
      env: { ...process.env, WRAPPER_UNDER_TEST: sourceWrapper },
      timeout: 10_000,
      windowsHide: true,
    },
  )
  const source = await readFile(sourceWrapper, 'utf8')

  assert.match(stdout, /powershell-5\.1-parser-ok/)
  assert.match(source, /CreateFileW/)
  assert.match(source, /GetFileInformationByHandle/)
  assert.match(source, /FileFlagOpenReparsePoint/)
  assert.doesNotMatch(source, /FileShareDelete/)
})
