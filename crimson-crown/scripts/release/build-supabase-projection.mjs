import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { getMigrationManifestPaths, loadAndValidateManifest } from './migration-manifest.mjs'

const releaseEvidenceRelativePath = join('local-artifacts', 'release-evidence')
const projectedRemoteFilePattern = /^\d{8,}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/

function fail(message) {
  throw new Error(message)
}

function isWithin(path, parent) {
  const relativePath = relative(parent, path)
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

function isSamePath(left, right) {
  return isWithin(left, right) && isWithin(right, left)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function replaceMigrationSetting(config) {
  const lines = config.split(/(\r?\n)/)
  let inMigrationsSection = false
  let matches = 0
  let disabledMatches = 0

  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index]
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)
    if (section) {
      inMigrationsSection = section[1] === 'db.migrations'
      continue
    }
    if (!inMigrationsSection) continue

    const enabled = line.match(/^(\s*enabled\s*=\s*)(true|false)(\s*(?:#.*)?)$/)
    if (!enabled) continue
    matches += 1
    if (enabled[2] !== 'false') continue
    disabledMatches += 1
    lines[index] = `${enabled[1]}true${enabled[3]}`
  }

  if (matches !== 1 || disabledMatches !== 1 || !lines.join('').includes('[db.migrations]')) {
    fail('configuración de migraciones inválida')
  }

  const projectedConfig = lines.join('')
  if (!/\[db\.migrations\][\s\S]*?^\s*enabled\s*=\s*true\s*(?:#.*)?$/m.test(projectedConfig)) {
    fail('configuración de migraciones inválida')
  }

  return projectedConfig
}

async function resolvePhysicalPaths({ rootDir, outputDir }) {
  const absoluteRoot = resolve(rootDir)
  const absoluteOutput = resolve(outputDir)
  let physicalRoot
  let physicalParent

  try {
    physicalRoot = await realpath(absoluteRoot)
  } catch (error) {
    fail('directorio raíz de proyección no disponible')
  }
  try {
    physicalParent = await realpath(dirname(absoluteOutput))
  } catch (error) {
    fail('directorio padre de proyección no disponible')
  }

  const physicalOutput = join(physicalParent, basename(absoluteOutput))
  const lexicalEvidence = resolve(absoluteRoot, releaseEvidenceRelativePath)
  const expectedPhysicalEvidence = join(physicalRoot, releaseEvidenceRelativePath)
  let physicalEvidence = null

  if (isWithin(absoluteOutput, lexicalEvidence)) {
    try {
      const resolvedEvidence = await realpath(lexicalEvidence)
      if (isSamePath(resolvedEvidence, expectedPhysicalEvidence)) {
        physicalEvidence = resolvedEvidence
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') fail('directorio de evidencia de release no disponible')
    }
  }

  if (
    isWithin(physicalOutput, physicalRoot)
    && (!isWithin(absoluteOutput, lexicalEvidence) || !physicalEvidence || !isWithin(physicalOutput, physicalEvidence))
  ) {
    fail('directorio de proyección dentro del repositorio no permitido')
  }

  return { physicalRoot, physicalOutput }
}

async function reserveOutputDirectory(outputDir) {
  try {
    await mkdir(outputDir)
  } catch (error) {
    if (error?.code === 'EEXIST') fail('directorio de proyección ya existe')
    fail('no se pudo reservar el directorio de proyección')
  }
}

async function createProjectionDirectory(directory) {
  try {
    await mkdir(directory)
  } catch (error) {
    fail('no se pudo crear el directorio de proyección')
  }
}

async function writeExclusive(path, contents) {
  try {
    await writeFile(path, contents, { flag: 'wx' })
  } catch (error) {
    fail('no se pudo escribir el archivo de proyección')
  }
}

function remoteMarker(entry) {
  return `-- release projection: remote_version=${entry.version} remote_name=${entry.remoteName} local_source_sha256=${entry.sha256}\n`
}

export async function buildProjection({ rootDir, outputDir, allowCandidates = false }) {
  const { physicalRoot, physicalOutput } = await resolvePhysicalPaths({ rootDir, outputDir })
  const { migrationsPath } = getMigrationManifestPaths({ rootDir: physicalRoot })

  const manifest = await loadAndValidateManifest({ rootDir: physicalRoot, allowCandidates })
  const sourceConfigPath = join(physicalRoot, 'supabase', 'config.toml')
  let projectedConfig
  try {
    projectedConfig = replaceMigrationSetting(await readFile(sourceConfigPath, 'utf8'))
  } catch (error) {
    if (error?.message === 'configuración de migraciones inválida') throw error
    fail('no se pudo preparar la configuración de Supabase')
  }

  await reserveOutputDirectory(physicalOutput)

  const projectedSupabasePath = join(physicalOutput, 'supabase')
  const projectedMigrationsPath = join(projectedSupabasePath, 'migrations')
  await createProjectionDirectory(projectedSupabasePath)
  await createProjectionDirectory(projectedMigrationsPath)
  await writeExclusive(join(projectedSupabasePath, 'config.toml'), projectedConfig)

  for (const entry of manifest.entries) {
    if (entry.class === 'baseline_present') continue

    if (entry.class === 'remote_applied') {
      const projectedFile = `${entry.version}_${entry.remoteName}.sql`
      if (!projectedRemoteFilePattern.test(projectedFile)) {
        fail('nombre remoto de migración no seguro')
      }
      await writeExclusive(join(projectedMigrationsPath, projectedFile), remoteMarker(entry))
      continue
    }

    let forwardBytes
    try {
      forwardBytes = await readFile(join(migrationsPath, entry.file))
    } catch (error) {
      fail('no se pudo leer la migración forward')
    }
    if (sha256(forwardBytes) !== entry.sha256) {
      fail('hash SHA-256 no coincide')
    }
    await writeExclusive(join(projectedMigrationsPath, entry.file), forwardBytes)
  }

  return Object.freeze({
    forwardPendingCount: manifest.entries.filter((entry) => entry.class === 'forward_pending').length,
  })
}
