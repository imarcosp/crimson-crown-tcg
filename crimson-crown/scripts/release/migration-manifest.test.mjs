import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
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
const gammaFile = '20240103000000_gamma.sql'
const alphaHash = 'b6a98d9ce9a2d9149288fa3df42d377c3e42737afdcdaf714e33c0a100b51060'
const betaHash = 'f2c82decdd7181cf98945929a62598db7e6b477e11f6e0eb0ae97020eff151ad'
const gammaHash = 'ae9a6306a205417afddd14316cc1d0d5e04a98f1be10865dce643925ee070ce2'
const bootstrapScript = resolve('scripts/release/bootstrap-migration-manifest.mjs')
const windowsReparseGuardScript = resolve('scripts/release/query-windows-reparse-points.ps1')
const genericReparsePointScript = String.raw`
param([Parameter(Mandatory = $true)][string]$LiteralPath)
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class CrimsonGenericReparseFixture
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(SafeFileHandle handle, uint code, IntPtr input, uint inputSize, IntPtr output, uint outputSize, out uint returned, IntPtr overlapped);

    public static void Set(string path)
    {
        using (SafeFileHandle handle = CreateFileW(path, 0x40000000, 7, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero))
        {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            IntPtr buffer = Marshal.AllocHGlobal(24);
            try
            {
                for (int index = 0; index < 24; index++) Marshal.WriteByte(buffer, index, 0);
                Marshal.WriteInt32(buffer, 0, 3);
                byte[] guid = Guid.Parse("12345678-1234-1234-1234-1234567890ab").ToByteArray();
                Marshal.Copy(guid, 0, IntPtr.Add(buffer, 8), 16);
                uint returned;
                if (!DeviceIoControl(handle, 0x000900A4, buffer, 24, IntPtr.Zero, 0, out returned, IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
    }
}
'@
Add-Type -TypeDefinition $source
[CrimsonGenericReparseFixture]::Set($LiteralPath)
`

function windowsSystemExecutable(name) {
  const systemRoot = process.env.SystemRoot
  if (!systemRoot) throw new Error('Windows system root unavailable')
  return join(systemRoot, 'System32', name)
}

async function createGenericReparsePoint(path) {
  const scriptDir = await mkdtemp(join(tmpdir(), 'crimson-generic-reparse-fixture-'))
  const scriptPath = join(scriptDir, 'create-generic-reparse.ps1')
  try {
    await writeFile(scriptPath, genericReparsePointScript)
    await execFileAsync(
      windowsSystemExecutable('WindowsPowerShell\\v1.0\\powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-File', scriptPath, path],
      { maxBuffer: 16 * 1024, timeout: 15_000, windowsHide: true },
    )
  } finally {
    await rm(scriptDir, { force: true, recursive: true })
  }
}

async function clearGenericReparsePoint(path) {
  await execFileAsync(
    windowsSystemExecutable('fsutil.exe'),
    ['reparsepoint', 'delete', path],
    { maxBuffer: 16 * 1024, timeout: 15_000, windowsHide: true },
  )
}

async function queryWindowsReparsePoints(paths) {
  return execFileAsync(
    windowsSystemExecutable('WindowsPowerShell\\v1.0\\powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', windowsReparseGuardScript, ...paths],
    { maxBuffer: 16 * 1024, timeout: 15_000, windowsHide: true },
  )
}

function candidateProof() {
  return { status: 'candidate', evidence: null, remediationVersions: [] }
}

function verifiedProof(evidence = 'docs/evidence/fixture-proof.md#verified') {
  return { status: 'verified_present', evidence, remediationVersions: [] }
}

function reconciledProof(remediationVersions, evidence = 'docs/evidence/fixture-proof.md#reconciled') {
  return { status: 'forward_reconciled', evidence, remediationVersions }
}

function manifestWithVerifiedEvidence(evidence) {
  return completeFixtureManifest([
    {
      class: 'baseline_present',
      version: '20240101000000',
      file: alphaFile,
      sha256: alphaHash,
      releaseProof: verifiedProof(evidence),
    },
    { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
  ])
}

function completeFixtureManifest(entries = [
  {
    class: 'baseline_present',
    version: '20240101000000',
    file: alphaFile,
    sha256: alphaHash,
    releaseProof: candidateProof(),
  },
  { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
]) {
  return {
    schemaVersion: 2,
    productionProjectRef: fixtureProjectRef,
    entries,
  }
}

async function withFixture(callback, manifest = completeFixtureManifest(), additionalFiles = []) {
  const rootDir = await mkdtemp(join(tmpdir(), 'crimson-migration-manifest-'))
  const migrationsDir = join(rootDir, 'supabase', 'migrations')
  const evidenceDir = join(rootDir, 'docs', 'evidence')
  const manifestPath = join(rootDir, 'scripts', 'release', 'migration-manifest.json')

  await mkdir(migrationsDir, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(join(migrationsDir, alphaFile), 'alpha\n')
  await writeFile(join(migrationsDir, betaFile), 'beta\n')
  await writeFile(
    join(evidenceDir, 'fixture-proof.md'),
    '# Verified\n# Reconciled\n# Verified Remote\n',
  )
  await writeFile(join(evidenceDir, 'proof.md'), '# Baseline 20240101000000\n')
  for (const [file, contents] of additionalFiles) {
    await writeFile(join(migrationsDir, file), contents)
  }
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
      {
        class: 'baseline_present',
        version: '20240101000000',
        file: alphaFile,
        sha256: alphaHash,
        releaseProof: candidateProof(),
      },
      { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
    ])
    assert.equal(Object.isFrozen(manifest), true)
    assert.equal(Object.isFrozen(manifest.entries), true)
    assert.equal(Object.isFrozen(manifest.entries[0]), true)
    assert.equal(Object.isFrozen(manifest.entries[0].releaseProof), true)
    assert.equal(Object.isFrozen(manifest.entries[0].releaseProof.remediationVersions), true)
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

test('the real manifest is blocked while any historical proof is only a candidate', async () => {
  await assert.rejects(
    () => loadAndValidateManifest({ rootDir: process.cwd(), allowCandidates: false }),
    /prueba de release candidata/,
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
      releaseProof: candidateProof(),
    },
    { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
  ])

  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: 'true' }),
      /prueba de release candidata/,
    ),
    manifest,
  )
})

test('a baseline candidate blocks even when every remote proof is verified', async () => {
  const manifest = completeFixtureManifest([
    {
      class: 'remote_applied',
      version: '20240101010101',
      remoteName: 'fixture_remote',
      file: alphaFile,
      sha256: alphaHash,
      releaseProof: verifiedProof(),
    },
    {
      class: 'baseline_present',
      version: '20240102000000',
      file: betaFile,
      sha256: betaHash,
      releaseProof: candidateProof(),
    },
  ])

  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'prueba de release candidata',
    ),
    manifest,
  )
})

test('rejects missing, extra, and malformed release proof fields', async () => {
  const validBaseline = {
    class: 'baseline_present',
    version: '20240101000000',
    file: alphaFile,
    sha256: alphaHash,
    releaseProof: candidateProof(),
  }
  const cases = [
    {
      entry: { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash },
      expectedMessage: 'campos de manifiesto inválidos',
    },
    {
      entry: { ...validBaseline, equivalence: 'candidate' },
      expectedMessage: 'campos de manifiesto inválidos',
    },
    {
      entry: { ...validBaseline, releaseProof: null },
      expectedMessage: 'prueba de release inválida',
    },
    {
      entry: { ...validBaseline, releaseProof: { status: 'candidate', evidence: null } },
      expectedMessage: 'prueba de release inválida',
    },
    {
      entry: { ...validBaseline, releaseProof: { ...candidateProof(), unexpected: true } },
      expectedMessage: 'prueba de release inválida',
    },
    {
      entry: { ...validBaseline, releaseProof: { status: 'unknown', evidence: null, remediationVersions: [] } },
      expectedMessage: 'estado de prueba de release inválido',
    },
    {
      entry: { ...validBaseline, releaseProof: { status: 'candidate', evidence: 'docs/evidence/proof.md', remediationVersions: [] } },
      expectedMessage: 'prueba de release inválida',
    },
    {
      entry: { ...validBaseline, releaseProof: { status: 'candidate', evidence: null, remediationVersions: ['20240102000000'] } },
      expectedMessage: 'prueba de release inválida',
    },
  ]

  for (const { entry, expectedMessage } of cases) {
    await withFixture(
      (rootDir) => assert.rejects(
        () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
        (error) => error.message === expectedMessage,
      ),
      completeFixtureManifest([
        entry,
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
    )
  }
})

test('verified-present proofs require safe evidence and no remediations', async () => {
  const cases = [
    { releaseProof: { status: 'verified_present', evidence: null, remediationVersions: [] }, expectedMessage: 'evidencia de release inválida' },
    { releaseProof: { status: 'verified_present', evidence: '', remediationVersions: [] }, expectedMessage: 'evidencia de release inválida' },
    { releaseProof: { status: 'verified_present', evidence: 'docs/evidence/proof.md', remediationVersions: ['20240102000000'] }, expectedMessage: 'prueba de release inválida' },
  ]

  for (const { releaseProof, expectedMessage } of cases) {
    await withFixture(
      (rootDir) => assert.rejects(
        () => loadAndValidateManifest({ rootDir }),
        (error) => error.message === expectedMessage,
      ),
      completeFixtureManifest([
        { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash, releaseProof },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
    )
  }

  await withFixture(async (rootDir) => {
    const manifest = await loadAndValidateManifest({ rootDir })
    assert.equal(manifest.entries[0].releaseProof.status, 'verified_present')
  }, completeFixtureManifest([
    {
      class: 'baseline_present',
      version: '20240101000000',
      file: alphaFile,
      sha256: alphaHash,
      releaseProof: verifiedProof('docs/evidence/proof.md#baseline-20240101000000'),
    },
    { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
  ]))
})

test('rejects unsafe evidence anchors without echoing them', async () => {
  const unsafeEvidence = [
    'C:/docs/evidence/proof.md',
    '/docs/evidence/proof.md',
    'docs\\evidence\\proof.md',
    'docs/evidence/../proof.md',
    'docs/evidence/./proof.md',
    'docs/evidence//proof.md',
    'docs/evidence/',
    'docs/evidence/proof.md#',
    'docs/evidence/proof.md#bad/anchor',
    'docs/evidence/proof.md#one#two',
    'https://example.invalid/docs/evidence/proof.md',
    'docs/evidence/proof.md#bad\nanchor',
  ]

  for (const evidence of unsafeEvidence) {
    await withFixture(
      (rootDir) => assert.rejects(
        () => loadAndValidateManifest({ rootDir }),
        (error) => error.message === 'evidencia de release inválida' && !error.message.includes(evidence),
      ),
      completeFixtureManifest([
        {
          class: 'baseline_present',
          version: '20240101000000',
          file: alphaFile,
          sha256: alphaHash,
          releaseProof: verifiedProof(evidence),
        },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
    )
  }
})

test('rejects a syntactically safe evidence path when the file does not exist', async () => {
  const evidence = 'docs/evidence/missing-proof.md#verified'

  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => (
        error.message === 'evidencia de release inválida'
        && !error.message.includes(evidence)
        && !error.message.includes(rootDir)
      ),
    ),
    manifestWithVerifiedEvidence(evidence),
  )
})

test('rejects an evidence path that names a directory instead of a regular file', async () => {
  const evidence = 'docs/evidence/not-a-file.md#verified'

  await withFixture(async (rootDir) => {
    await mkdir(join(rootDir, 'docs', 'evidence', 'not-a-file.md'))

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'evidencia de release inválida',
    )
  }, manifestWithVerifiedEvidence(evidence))
})

test('rejects an evidence file reached through a symbolic-link file', async (t) => {
  const evidence = 'docs/evidence/linked-proof.md#verified'

  await withFixture(async (rootDir) => {
    const evidenceDir = join(rootDir, 'docs', 'evidence')
    const target = join(evidenceDir, 'real-proof.md')
    const link = join(evidenceDir, 'linked-proof.md')
    await writeFile(target, '<a id="verified"></a>\n')
    try {
      await symlink(target, link, 'file')
    } catch (error) {
      t.skip(`file symlink unavailable on this host: ${error.code ?? 'unknown error'}`)
      return
    }

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'evidencia de release inválida',
    )
  }, manifestWithVerifiedEvidence(evidence))
})

test('rejects an evidence file reached through a hard-link alias', async () => {
  const evidence = 'docs/evidence/hard-linked-proof.md#verified'

  await withFixture(async (rootDir) => {
    const evidenceDir = join(rootDir, 'docs', 'evidence')
    const target = join(evidenceDir, 'hard-link-target.md')
    const alias = join(evidenceDir, 'hard-linked-proof.md')
    await writeFile(target, '<a id="verified"></a>\n')
    await link(target, alias)

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'evidencia de release inválida',
    )
  }, manifestWithVerifiedEvidence(evidence))
})

test('rejects an evidence file reached through a junction ancestor', async (t) => {
  const evidence = 'docs/evidence/linked-section/proof.md#verified'

  await withFixture(async (rootDir) => {
    const evidenceDir = join(rootDir, 'docs', 'evidence')
    const target = join(evidenceDir, 'real-section')
    const link = join(evidenceDir, 'linked-section')
    await mkdir(target)
    await writeFile(join(target, 'proof.md'), '<a id="verified"></a>\n')
    try {
      await symlink(target, link, 'junction')
    } catch (error) {
      t.skip(`junction unavailable on this host: ${error.code ?? 'unknown error'}`)
      return
    }

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'evidencia de release inválida',
    )
  }, manifestWithVerifiedEvidence(evidence))
})

test('rejects a generic non-name Windows reparse evidence file', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('generic Windows reparse fixture requires Windows')
    return
  }
  const evidence = 'docs/evidence/generic-reparse.md'

  await withFixture(async (rootDir) => {
    const evidenceFile = join(rootDir, 'docs', 'evidence', 'generic-reparse.md')
    await writeFile(evidenceFile, '# Verified\n')
    try {
      await createGenericReparsePoint(evidenceFile)
    } catch {
      t.skip('generic Windows reparse fixture unavailable on this host')
      return
    }

    try {
      await assert.rejects(
        () => loadAndValidateManifest({ rootDir }),
        (error) => error.message === 'evidencia de release inválida',
      )
    } finally {
      await clearGenericReparsePoint(evidenceFile)
    }
  }, manifestWithVerifiedEvidence(evidence))
})

test('the Windows attribute guard rejects a generic reparse point and accepts a regular file', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows attribute guard requires Windows')
    return
  }
  const rootDir = await mkdtemp(join(tmpdir(), 'crimson-reparse-guard-'))
  const regularFile = join(rootDir, 'regular.md')
  const reparseFile = join(rootDir, 'generic.md')
  await writeFile(regularFile, '# Regular\n')
  await writeFile(reparseFile, '# Generic\n')

  try {
    const safeResult = await queryWindowsReparsePoints([regularFile])
    assert.equal(safeResult.stdout, 'SAFE')
    assert.equal(safeResult.stderr, '')

    try {
      await createGenericReparsePoint(reparseFile)
    } catch {
      t.skip('generic Windows reparse fixture unavailable on this host')
      return
    }
    try {
      await assert.rejects(() => queryWindowsReparsePoints([regularFile, reparseFile]))
    } finally {
      await clearGenericReparsePoint(reparseFile)
    }
  } finally {
    await rm(rootDir, { force: true, recursive: true })
  }
})

test('rejects a safe anchor that is absent from the evidence Markdown', async () => {
  const evidence = 'docs/evidence/fixture-proof.md#missing-anchor'

  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'evidencia de release inválida',
    ),
    manifestWithVerifiedEvidence(evidence),
  )
})

test('resolves deterministic duplicate ATX heading slugs', async () => {
  const evidence = 'docs/evidence/duplicate-headings.md#review-proof-1-1'

  await withFixture(async (rootDir) => {
    await writeFile(
      join(rootDir, 'docs', 'evidence', 'duplicate-headings.md'),
      '# Review Proof\n# Review Proof\n# Review Proof-1\n',
    )

    const manifest = await loadAndValidateManifest({ rootDir })
    assert.equal(manifest.entries[0].releaseProof.evidence, evidence)
  }, manifestWithVerifiedEvidence(evidence))
})

test('accepts a strict ATX Markdown evidence heading', async () => {
  const evidence = 'docs/evidence/fixture-proof.md#verified'

  await withFixture(async (rootDir) => {
    const manifest = await loadAndValidateManifest({ rootDir })
    assert.equal(manifest.entries[0].releaseProof.evidence, evidence)
  }, manifestWithVerifiedEvidence(evidence))
})

test('rejects an ATX evidence heading hidden inside a Markdown comment', async () => {
  const evidence = 'docs/evidence/commented-anchor.md#verified'

  await withFixture(async (rootDir) => {
    await writeFile(
      join(rootDir, 'docs', 'evidence', 'commented-anchor.md'),
      '<!--\n# Verified\n-->\n',
    )

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'evidencia de release inválida',
    )
  }, manifestWithVerifiedEvidence(evidence))
})

test('rejects an ATX evidence heading hidden inside a raw HTML block', async () => {
  const evidence = 'docs/evidence/raw-html-anchor.md#verified'

  await withFixture(async (rootDir) => {
    await writeFile(
      join(rootDir, 'docs', 'evidence', 'raw-html-anchor.md'),
      '<script type="text/plain">\n# Verified\n</script>\n',
    )

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'evidencia de release inválida',
    )
  }, manifestWithVerifiedEvidence(evidence))
})

test('rejects an ATX evidence heading after a CommonMark raw tag with trailing content', async () => {
  const evidence = 'docs/evidence/raw-html-trailing-content.md#verified'

  await withFixture(async (rootDir) => {
    await writeFile(
      join(rootDir, 'docs', 'evidence', 'raw-html-trailing-content.md'),
      '<script type="text/plain">ignored\n# Verified\n</script>\n',
    )

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'evidencia de release inválida',
    )
  }, manifestWithVerifiedEvidence(evidence))
})

test('rejects ATX evidence headings inside processing, declaration, and CDATA blocks', async () => {
  const cases = [
    ['processing.md', '<?proof\n# Verified\n?>\n'],
    ['declaration.md', '<!PROOF\n# Verified\n>\n'],
    ['cdata.md', '<![CDATA[\n# Verified\n]]>\n'],
  ]

  for (const [file, markdown] of cases) {
    const evidence = `docs/evidence/${file}#verified`
    await withFixture(async (rootDir) => {
      await writeFile(join(rootDir, 'docs', 'evidence', file), markdown)
      await assert.rejects(
        () => loadAndValidateManifest({ rootDir }),
        (error) => error.message === 'evidencia de release inválida',
      )
    }, manifestWithVerifiedEvidence(evidence))
  }
})

test('rejects duplicate explicit HTML anchors instead of treating them as unique evidence', async () => {
  const evidence = 'docs/evidence/duplicate-explicit.md#verified'

  await withFixture(async (rootDir) => {
    await writeFile(
      join(rootDir, 'docs', 'evidence', 'duplicate-explicit.md'),
      '<a id="verified"></a>\n<a id="verified"></a>\n',
    )

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'evidencia de release inválida',
    )
  }, manifestWithVerifiedEvidence(evidence))
})

test('does not let an explicit HTML ID claim a heading collision suffix', async () => {
  const evidence = 'docs/evidence/html-heading-collision.md#proof-1'

  await withFixture(async (rootDir) => {
    await writeFile(
      join(rootDir, 'docs', 'evidence', 'html-heading-collision.md'),
      '<a id="proof-1"></a>\n# Proof\n',
    )

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir }),
      (error) => error.message === 'evidencia de release inválida',
    )
  }, manifestWithVerifiedEvidence(evidence))
})

test('forward-reconciled proofs reject unknown, duplicate, malformed, and old remediations', async () => {
  const cases = [
    {
      releaseProof: reconciledProof(['20240103000000']),
      excludedVersion: '20240101010101',
      expectedMessage: 'remediaciones de release inválidas',
    },
    {
      releaseProof: reconciledProof(['20240102000000', '20240102000000']),
      excludedVersion: '20240101010101',
      expectedMessage: 'remediaciones de release inválidas',
    },
    {
      releaseProof: reconciledProof(['not-a-version']),
      excludedVersion: '20240101010101',
      expectedMessage: 'remediaciones de release inválidas',
    },
    {
      releaseProof: reconciledProof(['20240102000000']),
      excludedVersion: '20240103000000',
      expectedMessage: 'remediaciones de release inválidas',
    },
  ]

  for (const { releaseProof, excludedVersion, expectedMessage } of cases) {
    await withFixture(
      (rootDir) => assert.rejects(
        () => loadAndValidateManifest({ rootDir }),
        (error) => error.message === expectedMessage,
      ),
      completeFixtureManifest([
        {
          class: 'remote_applied',
          version: excludedVersion,
          remoteName: 'fixture_remote',
          file: alphaFile,
          sha256: alphaHash,
          releaseProof,
        },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
    )
  }
})

test('accepts a forward-reconciled proof tied to a newer forward migration in the same snapshot', async () => {
  await withFixture(async (rootDir) => {
    const manifest = await loadAndValidateManifest({ rootDir })
    assert.deepEqual(manifest.entries[0].releaseProof, reconciledProof(['20240102000000']))
  }, completeFixtureManifest([
    {
      class: 'baseline_present',
      version: '20240101000000',
      file: alphaFile,
      sha256: alphaHash,
      releaseProof: reconciledProof(['20240102000000']),
    },
    { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
  ]))
})

for (const excludedVersion of ['20240103000000', '020240102000000']) {
  test(`rejects a forward version that is not newer than excluded frontier ${excludedVersion}`, async () => {
    await withFixture(
      (rootDir) => assert.rejects(
        () => loadAndValidateManifest({ rootDir }),
        (error) => error.message === 'versión forward no posterior al frontier',
      ),
      completeFixtureManifest([
        {
          class: 'remote_applied',
          version: excludedVersion,
          remoteName: 'fixture_remote',
          file: alphaFile,
          sha256: alphaHash,
          releaseProof: verifiedProof(),
        },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
    )
  })
}

test('rejects forward migrations that are not strictly increasing in manifest order', async () => {
  await withFixture(
    (rootDir) => assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
      (error) => error.message === 'orden de migraciones forward inválido',
    ),
    completeFixtureManifest([
      {
        class: 'baseline_present',
        version: '20240101000000',
        file: alphaFile,
        sha256: alphaHash,
        releaseProof: candidateProof(),
      },
      { class: 'forward_pending', version: '20240103000000', file: gammaFile, sha256: gammaHash },
      { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
    ]),
    [[gammaFile, 'gamma\n']],
  )
})

test('rejects a local classification whose version disagrees with its filename prefix', async () => {
  const manifest = completeFixtureManifest([
    { class: 'baseline_present', version: '20240103000000', file: alphaFile, sha256: alphaHash, releaseProof: candidateProof() },
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
    { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash, releaseProof: candidateProof() },
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
    { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash, releaseProof: candidateProof() },
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
    { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash, releaseProof: candidateProof() },
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
        { class: 'baseline_present', version: marker, file: alphaFile, sha256: alphaHash, releaseProof: candidateProof() },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
      expectedMessage: 'versión de migración inválida',
    },
    {
      manifest: completeFixtureManifest([
        { class: 'baseline_present', version: '20240101000000', file: marker, sha256: alphaHash, releaseProof: candidateProof() },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
      expectedMessage: 'archivo de migración inválido',
    },
    {
      manifest: completeFixtureManifest([
        { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: marker, releaseProof: candidateProof() },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
      expectedMessage: 'hash SHA-256 inválido',
    },
    {
      manifest: completeFixtureManifest([
        {
          class: 'remote_applied',
          version: '20240101000000',
          remoteName: { marker },
          file: alphaFile,
          sha256: alphaHash,
          releaseProof: candidateProof(),
        },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
      expectedMessage: 'nombre remoto inválido',
    },
    {
      manifest: completeFixtureManifest([
        {
          class: 'remote_applied',
          version: '20240101000000',
          remoteName: 'fixture_remote',
          file: alphaFile,
          sha256: alphaHash,
          releaseProof: { status: marker, evidence: null, remediationVersions: [] },
        },
        { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
      ]),
      expectedMessage: 'estado de prueba de release inválido',
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

test('malformed manifest JSON errors never echo parser details', async () => {
  const marker = 'untrusted-malformed-json-detail'

  await withFixture(async (rootDir, manifestPath) => {
    await writeFile(manifestPath, `{"entries":"${marker}`)

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
      (error) => error.message === 'no se pudo leer el manifiesto de migraciones' && !error.message.includes(marker),
    )
  })
})

test('migration directory enumeration errors are generic and redact absolute paths', async () => {
  await withFixture(async (rootDir) => {
    await rm(join(rootDir, 'supabase', 'migrations'), { recursive: true })

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
      (error) => (
        error.message === 'no se pudo leer el directorio de migraciones'
        && !error.message.includes(rootDir)
        && !error.message.includes('supabase')
      ),
    )
  })
})

test('migration content read errors never echo raw filesystem paths', async () => {
  const marker = '20240103000000_untrusted-filesystem-path.sql'
  const manifest = completeFixtureManifest([
    {
      class: 'remote_applied',
      version: '20240101010101',
      remoteName: 'untrusted_path_fixture',
      file: marker,
      sha256: alphaHash,
      releaseProof: candidateProof(),
    },
    { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash, releaseProof: candidateProof() },
    { class: 'forward_pending', version: '20240102000000', file: betaFile, sha256: betaHash },
  ])

  await withFixture(async (rootDir) => {
    await mkdir(join(rootDir, 'supabase', 'migrations', marker))

    await assert.rejects(
      () => loadAndValidateManifest({ rootDir, allowCandidates: true }),
      (error) => error.message === 'hash SHA-256 no disponible' && !error.message.includes(marker),
    )
  }, manifest)
})

test('rejects a migration assigned to two classes', async () => {
  const manifest = completeFixtureManifest([
    { class: 'baseline_present', version: '20240101000000', file: alphaFile, sha256: alphaHash, releaseProof: candidateProof() },
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

    assert.equal(manifest.schemaVersion, 2)
    assert.equal(manifest.entries.length, 22)
    assert.deepEqual(manifest.entries.slice(0, 2), [
      {
        class: 'remote_applied',
        version: '20260826210617',
        remoteName: 'production_runtime_functions',
        file: '20260826120000_production_runtime_functions.sql',
        sha256: '1495f5ccbd382224fa5c28312ecc488f29ad8bd680020dda73e9f68a183388f3',
        releaseProof: candidateProof(),
      },
      {
        class: 'remote_applied',
        version: '20260826210725',
        remoteName: 'revoke_is_admin_anon',
        file: '20260826121500_revoke_is_admin_anon.sql',
        sha256: '9ccca376f02452f82481037f25646b1fc47812dd3e1966437f0fa8e0784dddcd',
        releaseProof: candidateProof(),
      },
    ])
    assert.equal(
      manifest.entries
        .filter((entry) => entry.class === 'remote_applied' || entry.class === 'baseline_present')
        .every((entry) => (
          entry.releaseProof.status === 'candidate'
          && entry.releaseProof.evidence === null
          && entry.releaseProof.remediationVersions.length === 0
        )),
      true,
    )

    await assert.rejects(
      () => execFileAsync(process.execPath, [bootstrapScript], { cwd: rootDir }),
      /el manifiesto ya existe/,
    )
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('bootstrap output is byte-identical across two fresh destinations', async () => {
  const roots = await Promise.all([
    mkdtemp(join(tmpdir(), 'crimson-migration-bootstrap-deterministic-a-')),
    mkdtemp(join(tmpdir(), 'crimson-migration-bootstrap-deterministic-b-')),
  ])

  try {
    for (const rootDir of roots) {
      await cp(resolve('supabase', 'migrations'), join(rootDir, 'supabase', 'migrations'), { recursive: true })
      await execFileAsync(process.execPath, [bootstrapScript], { cwd: rootDir })
    }

    const outputs = await Promise.all(roots.map((rootDir) => (
      readFile(join(rootDir, 'scripts', 'release', 'migration-manifest.json'))
    )))
    assert.deepEqual(outputs[0], outputs[1])

    const manifest = JSON.parse(outputs[0].toString('utf8'))
    assert.equal(manifest.schemaVersion, 2)
    assert.deepEqual(manifest.entries[5].releaseProof, candidateProof())
  } finally {
    await Promise.all(roots.map((rootDir) => rm(rootDir, { recursive: true, force: true })))
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
