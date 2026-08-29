import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const productionProjectRef = 'djfqozfaqkqdoqeoqbzt'
const manifestRelativePath = join('scripts', 'release', 'migration-manifest.json')
const migrationsRelativePath = join('supabase', 'migrations')
const classes = new Set(['remote_applied', 'baseline_present', 'forward_pending'])
const sha256Pattern = /^[a-f0-9]{64}$/
const versionPattern = /^\d{8,}$/

function fail(message) {
  throw new Error(message)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateExactKeys(entry, expectedKeys) {
  const keys = Object.keys(entry).sort()
  const expected = [...expectedKeys].sort()

  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('campos de manifiesto inválidos')
  }
}

function validateEntry(entry, { allowCandidates, files, versions, classifiedFiles }) {
  if (!isPlainObject(entry) || !classes.has(entry.class)) {
    fail('clase de migración inválida')
  }

  const isRemoteApplied = entry.class === 'remote_applied'
  validateExactKeys(
    entry,
    isRemoteApplied
      ? ['class', 'version', 'remoteName', 'file', 'sha256', 'equivalence']
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

  if (isRemoteApplied) {
    if (typeof entry.remoteName !== 'string' || entry.remoteName.length === 0) {
      fail('nombre remoto inválido')
    }
    if (entry.equivalence !== 'candidate' && entry.equivalence !== 'verified') {
      fail('equivalencia remota inválida')
    }
    if (entry.equivalence === 'candidate' && allowCandidates !== true) {
      fail('equivalencia remota sin verificar')
    }
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function loadAndValidateManifest({ rootDir, allowCandidates }) {
  const absoluteRoot = resolve(rootDir)
  const manifestPath = join(absoluteRoot, manifestRelativePath)
  const migrationsPath = join(absoluteRoot, migrationsRelativePath)
  let manifest

  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    fail('no se pudo leer el manifiesto de migraciones')
  }

  if (!isPlainObject(manifest) || Object.keys(manifest).sort().join(',') !== 'entries,productionProjectRef,schemaVersion') {
    fail('forma de manifiesto inválida')
  }
  if (manifest.schemaVersion !== 1) {
    fail('versión de esquema de manifiesto no admitida')
  }
  if (manifest.productionProjectRef !== productionProjectRef) {
    fail('referencia de proyecto de producción no permitida')
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    fail('entradas de manifiesto inválidas')
  }

  const files = new Set((await readdir(migrationsPath)).filter((file) => file.endsWith('.sql')))
  const versions = new Set()
  const classifiedFiles = new Set()

  for (const entry of manifest.entries) {
    validateEntry(entry, { allowCandidates, files, versions, classifiedFiles })
  }

  for (const file of files) {
    if (!classifiedFiles.has(file)) {
      fail('migración sin clasificar')
    }
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

  return manifest
}
