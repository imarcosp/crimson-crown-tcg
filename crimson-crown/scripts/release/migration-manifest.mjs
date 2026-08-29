import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const productionProjectRef = 'djfqozfaqkqdoqeoqbzt'
const manifestRelativePath = join('scripts', 'release', 'migration-manifest.json')
const migrationsRelativePath = join('supabase', 'migrations')
const classes = new Set(['remote_applied', 'baseline_present', 'forward_pending'])
const historicalClasses = new Set(['remote_applied', 'baseline_present'])
const proofStatuses = new Set(['candidate', 'verified_present', 'forward_reconciled'])
const sha256Pattern = /^[a-f0-9]{64}$/
const versionPattern = /^\d{8,}$/
const evidenceSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const evidenceAnchorPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/

function fail(message) {
  throw new Error(message)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateExactKeys(value, expectedKeys, message = 'campos de manifiesto inválidos') {
  const keys = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()

  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(message)
  }
}

function isSafeEvidenceAnchor(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.includes('\\') || controlCharacterPattern.test(value)) return false

  const firstHash = value.indexOf('#')
  if (firstHash !== value.lastIndexOf('#')) return false

  const evidencePath = firstHash === -1 ? value : value.slice(0, firstHash)
  const anchor = firstHash === -1 ? null : value.slice(firstHash + 1)
  if (!evidencePath.startsWith('docs/evidence/')) return false
  if (evidencePath.includes('://') || evidencePath.startsWith('/')) return false

  const segments = evidencePath.split('/')
  if (
    segments.length < 3
    || segments.some((segment) => (
      segment.length === 0
      || segment === '.'
      || segment === '..'
      || !evidenceSegmentPattern.test(segment)
    ))
  ) {
    return false
  }

  return anchor === null || evidenceAnchorPattern.test(anchor)
}

function validateReleaseProof(releaseProof) {
  if (!isPlainObject(releaseProof)) {
    fail('prueba de release inválida')
  }
  validateExactKeys(
    releaseProof,
    ['status', 'evidence', 'remediationVersions'],
    'prueba de release inválida',
  )

  if (!proofStatuses.has(releaseProof.status)) {
    fail('estado de prueba de release inválido')
  }
  if (!Array.isArray(releaseProof.remediationVersions)) {
    fail('prueba de release inválida')
  }

  if (releaseProof.status === 'candidate') {
    if (releaseProof.evidence !== null || releaseProof.remediationVersions.length !== 0) {
      fail('prueba de release inválida')
    }
    return
  }

  if (!isSafeEvidenceAnchor(releaseProof.evidence)) {
    fail('evidencia de release inválida')
  }

  if (releaseProof.status === 'verified_present') {
    if (releaseProof.remediationVersions.length !== 0) {
      fail('prueba de release inválida')
    }
    return
  }

  if (releaseProof.remediationVersions.length === 0) {
    fail('remediaciones de release inválidas')
  }
  const remediationVersions = new Set()
  for (const version of releaseProof.remediationVersions) {
    if (typeof version !== 'string' || !versionPattern.test(version) || remediationVersions.has(version)) {
      fail('remediaciones de release inválidas')
    }
    remediationVersions.add(version)
  }
}

function validateEntry(entry, { files, versions, classifiedFiles }) {
  if (!isPlainObject(entry) || !classes.has(entry.class)) {
    fail('clase de migración inválida')
  }

  const isRemoteApplied = entry.class === 'remote_applied'
  const isHistorical = historicalClasses.has(entry.class)
  validateExactKeys(
    entry,
    isRemoteApplied
      ? ['class', 'version', 'remoteName', 'file', 'sha256', 'releaseProof']
      : isHistorical
        ? ['class', 'version', 'file', 'sha256', 'releaseProof']
        : ['class', 'version', 'file', 'sha256'],
  )

  if (typeof entry.version !== 'string' || !versionPattern.test(entry.version)) {
    fail('versión de migración inválida')
  }
  if (versions.has(entry.version)) {
    fail('versión de migración duplicada')
  }
  versions.add(entry.version)

  if (typeof entry.file !== 'string' || !entry.file.endsWith('.sql') || entry.file.includes('/') || entry.file.includes('\\')) {
    fail('archivo de migración inválido')
  }
  if (classifiedFiles.has(entry.file)) {
    fail('archivo asignado a más de una clase')
  }
  classifiedFiles.add(entry.file)
  if (!files.has(entry.file)) {
    fail('archivo de migración desconocido')
  }

  if (typeof entry.sha256 !== 'string' || !sha256Pattern.test(entry.sha256)) {
    fail('hash SHA-256 inválido')
  }

  if (!isRemoteApplied) {
    const separatorIndex = entry.file.indexOf('_')
    const fileVersion = separatorIndex > 0 ? entry.file.slice(0, separatorIndex) : null
    if (entry.version !== fileVersion) {
      fail('versión de migración no coincide con el archivo')
    }
  }

  if (isRemoteApplied && (typeof entry.remoteName !== 'string' || entry.remoteName.length === 0)) {
    fail('nombre remoto inválido')
  }
  if (isHistorical) {
    validateReleaseProof(entry.releaseProof)
  }
}

function validateCrossEntryRelationships(entries) {
  const historicalEntries = entries.filter((entry) => historicalClasses.has(entry.class))
  const forwardEntries = entries.filter((entry) => entry.class === 'forward_pending')
  const forwardByVersion = new Map(forwardEntries.map((entry) => [entry.version, entry]))
  const excludedFrontier = historicalEntries.reduce((frontier, entry) => {
    const version = BigInt(entry.version)
    return frontier === null || version > frontier ? version : frontier
  }, null)

  for (const entry of historicalEntries) {
    if (entry.releaseProof.status !== 'forward_reconciled') continue

    const excludedVersion = BigInt(entry.version)
    for (const remediationVersion of entry.releaseProof.remediationVersions) {
      const remediation = forwardByVersion.get(remediationVersion)
      const numericRemediationVersion = BigInt(remediationVersion)
      if (
        !remediation
        || numericRemediationVersion <= excludedVersion
        || (excludedFrontier !== null && numericRemediationVersion <= excludedFrontier)
      ) {
        fail('remediaciones de release inválidas')
      }
    }
  }

  let previousForwardVersion = null
  for (const entry of forwardEntries) {
    const version = BigInt(entry.version)
    if (excludedFrontier !== null && version <= excludedFrontier) {
      fail('versión forward no posterior al frontier')
    }
    if (previousForwardVersion !== null && version <= previousForwardVersion) {
      fail('orden de migraciones forward inválido')
    }
    previousForwardVersion = version
  }
}

function freezeManifestSnapshot(manifest) {
  for (const entry of manifest.entries) {
    if (historicalClasses.has(entry.class)) {
      Object.freeze(entry.releaseProof.remediationVersions)
      Object.freeze(entry.releaseProof)
    }
    Object.freeze(entry)
  }
  Object.freeze(manifest.entries)
  return Object.freeze(manifest)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function getMigrationManifestPaths({ rootDir }) {
  const absoluteRoot = resolve(rootDir)

  return {
    rootDir: absoluteRoot,
    manifestPath: join(absoluteRoot, manifestRelativePath),
    migrationsPath: join(absoluteRoot, migrationsRelativePath),
  }
}

export async function loadAndValidateManifest({ rootDir, allowCandidates }) {
  const { manifestPath, migrationsPath } = getMigrationManifestPaths({ rootDir })
  let manifest

  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    fail('no se pudo leer el manifiesto de migraciones')
  }

  if (!isPlainObject(manifest) || Object.keys(manifest).sort().join(',') !== 'entries,productionProjectRef,schemaVersion') {
    fail('forma de manifiesto inválida')
  }
  if (manifest.schemaVersion !== 2) {
    fail('versión de esquema de manifiesto no admitida')
  }
  if (manifest.productionProjectRef !== productionProjectRef) {
    fail('referencia de proyecto de producción no permitida')
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    fail('entradas de manifiesto inválidas')
  }

  let migrationFiles
  try {
    migrationFiles = await readdir(migrationsPath)
  } catch {
    fail('no se pudo leer el directorio de migraciones')
  }
  const files = new Set(migrationFiles.filter((file) => file.endsWith('.sql')))
  const versions = new Set()
  const classifiedFiles = new Set()

  for (const entry of manifest.entries) {
    validateEntry(entry, { files, versions, classifiedFiles })
  }

  for (const file of files) {
    if (!classifiedFiles.has(file)) {
      fail('migración sin clasificar')
    }
  }

  validateCrossEntryRelationships(manifest.entries)

  if (
    allowCandidates !== true
    && manifest.entries.some((entry) => (
      historicalClasses.has(entry.class) && entry.releaseProof.status === 'candidate'
    ))
  ) {
    fail('prueba de release candidata')
  }

  for (const entry of manifest.entries) {
    let migrationBytes
    try {
      migrationBytes = await readFile(join(migrationsPath, entry.file))
    } catch {
      fail('hash SHA-256 no disponible')
    }
    const actualHash = sha256(migrationBytes)
    if (entry.sha256 !== actualHash) {
      fail('hash SHA-256 no coincide')
    }
  }

  return freezeManifestSnapshot(manifest)
}
