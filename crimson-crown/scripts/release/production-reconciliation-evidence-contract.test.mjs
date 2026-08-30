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
const reconciliationVersion = '20260829235800'
const preflightPath = path.join(appRoot, 'scripts', 'release', 'production-reconciliation-preflight.sql')

const historicalVersions = [
  '20260826210617', '20260826210725', '20260827051550', '20260827051604', '20260827051615',
  '20231218', '20240701000000', '202606100001', '202606100002', '20260615000300',
  '20260823043500', '20260823043637', '20260823044210', '20260823044710', '20260823044936',
  '20260823050711', '20260823051113', '20260823140924', '20260823142117', '20260823173257',
  '20260823183638',
]

const directlyVerified = new Set([
  '20260826210617', '20260826210725', '20260827051550', '20260827051604', '20260827051615',
  '20260823051113', '20260823140924',
])

const exactRemediations = new Map([
  ['20231218', [reconciliationVersion]],
  ['20240701000000', [reconciliationVersion]],
  ['202606100001', [reconciliationVersion]],
  ['202606100002', [reconciliationVersion]],
  ['20260615000300', [reconciliationVersion]],
  ['20260823043500', [reconciliationVersion]],
  ['20260823043637', ['20260829183155', reconciliationVersion]],
  ['20260823044210', ['20260829183155']],
  ['20260823044710', [reconciliationVersion]],
  ['20260823044936', [reconciliationVersion]],
  ['20260823050711', ['20260829183155', reconciliationVersion]],
  ['20260823142117', [reconciliationVersion]],
  ['20260823173257', [reconciliationVersion]],
  ['20260823183638', [reconciliationVersion]],
])

test('las 21 exclusiones históricas tienen prueba PASS sin candidatos ni bypass del gate', () => {
  assert.ok(fs.existsSync(evidencePath), 'falta la evidencia de reconciliación productiva')
  const evidence = fs.readFileSync(evidencePath, 'utf8')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const historical = manifest.entries.filter((entry) => entry.class !== 'forward_pending')

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
  assert.equal(evidenceAnchors.length, 21)
  assert.equal(new Set(evidenceAnchors).size, 21)

  for (const entry of historical) {
    const anchor = `${entry.class === 'remote_applied' ? 'remote' : 'baseline'}-${entry.version}`
    assert.equal(entry.releaseProof.evidence, `${evidenceRelativePath}#${anchor}`)
    assert.match(evidence, new RegExp(`^## ${anchor}\\r?\\n\\r?\\n\\*\\*PASS\\*\\*`, 'mu'))

    if (directlyVerified.has(entry.version)) {
      assert.equal(entry.releaseProof.status, 'verified_present')
      assert.deepEqual(entry.releaseProof.remediationVersions, [])
    } else {
      assert.equal(entry.releaseProof.status, 'forward_reconciled')
      assert.deepEqual(entry.releaseProof.remediationVersions, exactRemediations.get(entry.version))
    }
  }

  const reconciliation = manifest.entries.find((entry) => entry.version === reconciliationVersion)
  assert.deepEqual(reconciliation, {
    class: 'forward_pending',
    version: reconciliationVersion,
    file: '20260829235800_reconcile_legacy_schema_safely.sql',
    sha256: 'feff9a68c4bd35d7eb04e30c85b980b7e7b5863e0706570651a1ca8647e511de',
  })
  const forwards = manifest.entries.filter((entry) => entry.class === 'forward_pending')
  assert.equal(forwards.at(-1).file, '20260829235900_harden_storage_buckets_and_policies.sql')
})
