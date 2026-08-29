import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

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

async function ensureEmptyOutputDirectory(outputDir) {
  try {
    if ((await readdir(outputDir)).length !== 0) {
      fail('directorio de proyección no está vacío')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await mkdir(outputDir, { recursive: true })
  }
}

function remoteMarker(entry) {
  return `-- release projection: remote_version=${entry.version} remote_name=${entry.remoteName} local_source_sha256=${entry.sha256}\n`
}

export async function buildProjection({ rootDir, outputDir, allowCandidates = false }) {
  const { rootDir: absoluteRoot, migrationsPath } = getMigrationManifestPaths({ rootDir })
  const absoluteOutput = resolve(outputDir)
  const releaseEvidencePath = resolve(absoluteRoot, releaseEvidenceRelativePath)

  if (isWithin(absoluteOutput, absoluteRoot) && !isWithin(absoluteOutput, releaseEvidencePath)) {
    fail('directorio de proyección dentro del repositorio no permitido')
  }

  const manifest = await loadAndValidateManifest({ rootDir: absoluteRoot, allowCandidates })
  const sourceConfigPath = join(absoluteRoot, 'supabase', 'config.toml')
  let projectedConfig
  try {
    projectedConfig = replaceMigrationSetting(await readFile(sourceConfigPath, 'utf8'))
  } catch (error) {
    if (error?.message === 'configuración de migraciones inválida') throw error
    fail('no se pudo preparar la configuración de Supabase')
  }

  await ensureEmptyOutputDirectory(absoluteOutput)

  const projectedSupabasePath = join(absoluteOutput, 'supabase')
  const projectedMigrationsPath = join(projectedSupabasePath, 'migrations')
  await mkdir(projectedMigrationsPath, { recursive: true })
  await cp(sourceConfigPath, join(projectedSupabasePath, 'config.toml'))
  await writeFile(join(projectedSupabasePath, 'config.toml'), projectedConfig)

  for (const entry of manifest.entries) {
    if (entry.class === 'baseline_present') continue

    if (entry.class === 'remote_applied') {
      const projectedFile = `${entry.version}_${entry.remoteName}.sql`
      if (!projectedRemoteFilePattern.test(projectedFile)) {
        fail('nombre remoto de migración no seguro')
      }
      await writeFile(join(projectedMigrationsPath, projectedFile), remoteMarker(entry))
      continue
    }

    await cp(join(migrationsPath, entry.file), join(projectedMigrationsPath, entry.file))
  }
}
