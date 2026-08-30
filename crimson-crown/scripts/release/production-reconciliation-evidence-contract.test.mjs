import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifestPath = path.join(appRoot, 'scripts', 'release', 'migration-manifest.json')
const evidenceRelativePath = 'docs/evidence/crimson-production-reconciliation-2026-08-30.md'
const evidencePath = path.join(appRoot, ...evidenceRelativePath.split('/'))
const preflightPath = path.join(appRoot, 'scripts', 'release', 'production-reconciliation-preflight.sql')
const productionReleaseVersions = [
  '20260830051302', '20260830051308', '20260830051315', '20260830051429',
  '20260830051436', '20260830051442', '20260830051448', '20260830051455',
  '20260830051501', '20260830051537', '20260830052613',
]

const historicalVersions = [
  '20260826210617', '20260826210725', '20260827051550', '20260827051604', '20260827051615',
  '20231218', '20240701000000', '202606100001', '202606100002', '20260615000300',
  '20260823043500', '20260823043637', '20260823044210', '20260823044710', '20260823044936',
  '20260823050711', '20260823051113', '20260823140924', '20260823142117', '20260823173257',
  '20260823183638',
]

const directlyVerified = new Set(historicalVersions)

test('las 21 exclusiones históricas tienen prueba PASS sin candidatos ni bypass del gate', () => {
  assert.ok(fs.existsSync(evidencePath), 'falta la evidencia de reconciliación productiva')
  const evidence = fs.readFileSync(evidencePath, 'utf8')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const historical = manifest.entries.filter((entry) => historicalVersions.includes(entry.version))

  assert.equal(historical.length, 21)
  assert.deepEqual(historical.map((entry) => entry.version), historicalVersions)
  assert.doesNotMatch(evidence, /\*\*(?:Blocked|FAIL)\*\*/u)
  assert.match(evidence, /Production project: `djfqozfaqkqdoqeoqbzt`/u)
  assert.match(evidence, /Retained pre-start commission periods: `9`/u)
  assert.match(evidence, /Reconciliation source SHA-256: `feff9a68c4bd35d7eb04e30c85b980b7e7b5863e0706570651a1ca8647e511de`/u)
  assert.ok(fs.existsSync(preflightPath), 'falta el preflight productivo reproducible')
  const preflightHash = createHash('sha256').update(fs.readFileSync(preflightPath)).digest('hex')
  assert.equal(preflightHash, 'c7cb7b48784f84de6b2e88127a80fcbf478925ef3dfc37e22a7f0f38ecc0cfc1')
  assert.match(evidence, /Preflight SQL SHA-256: `c7cb7b48784f84de6b2e88127a80fcbf478925ef3dfc37e22a7f0f38ecc0cfc1`/u)

  const evidenceAnchors = [...evidence.matchAll(/^## ((?:remote|baseline)-[0-9]+)$/gmu)].map((match) => match[1])
  assert.equal(evidenceAnchors.length, 32)
  assert.equal(new Set(evidenceAnchors).size, 32)

  for (const entry of historical) {
    const anchor = `${entry.class === 'remote_applied' ? 'remote' : 'baseline'}-${entry.version}`
    assert.equal(entry.releaseProof.evidence, `${evidenceRelativePath}#${anchor}`)
    assert.match(evidence, new RegExp(`^## ${anchor}\\r?\\n\\r?\\n\\*\\*PASS\\*\\*`, 'mu'))

    assert.equal(directlyVerified.has(entry.version), true)
    assert.equal(entry.releaseProof.status, 'verified_present')
    assert.deepEqual(entry.releaseProof.remediationVersions, [])
  }

  const released = manifest.entries.filter((entry) => productionReleaseVersions.includes(entry.version))
  assert.deepEqual(released.map((entry) => entry.version), productionReleaseVersions)
  assert.ok(released.every((entry) => entry.class === 'remote_applied'))
  assert.ok(released.every((entry) => entry.releaseProof.status === 'verified_present'))
  assert.ok(released.every((entry) => entry.releaseProof.remediationVersions.length === 0))

  const reconciliation = manifest.entries.find(
    (entry) => entry.file === '20260829235800_reconcile_legacy_schema_safely.sql',
  )
  assert.deepEqual(reconciliation, {
    class: 'remote_applied',
    version: '20260830051537',
    remoteName: 'reconcile_legacy_schema_safely',
    file: '20260829235800_reconcile_legacy_schema_safely.sql',
    releaseProof: {
      status: 'verified_present',
      evidence: `${evidenceRelativePath}#remote-20260830051537`,
      remediationVersions: [],
    },
    sha256: 'feff9a68c4bd35d7eb04e30c85b980b7e7b5863e0706570651a1ca8647e511de',
  })
  const forwards = manifest.entries.filter((entry) => entry.class === 'forward_pending')
  assert.deepEqual(forwards, [
    {
      class: 'forward_pending',
      version: '20260830133000',
      file: '20260830133000_add_magic_legalities_to_external_prices.sql',
      sha256: 'e964da84d7b1afa3aa0786c4bbe29e91f65fd48b2cf70100d02fc3302919e67d',
    },
    {
      class: 'forward_pending',
      version: '20260830170000',
      file: '20260830170000_create_home_quick_links.sql',
      sha256: 'f3ee016220c8066d7201359c7c93168676aedfd9009bc262ce2900d45a619285',
    },
    {
      class: 'forward_pending',
      version: '20260830203000',
      file: '20260830203000_create_deck_builder_foundation.sql',
      sha256: '00e00d8fcd86703777166a6e6f7c6e2c65aeeb5a21ed19888f28c4a2c35f486b',
    },
  ])
})
