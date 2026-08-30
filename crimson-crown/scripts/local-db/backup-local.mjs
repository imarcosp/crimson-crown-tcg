import { execFileSync, spawnSync } from 'node:child_process'
import { rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {
  buildTimestampedName,
  LOCAL_DB_CONTAINER,
  sha256,
} from '../lib/local-operations.mjs'
import {
  buildDefaultArtifactRoot,
  prepareArtifactDirectories,
} from './verify-artifact-location.mjs'

async function atomicWrite(targetPath, content) {
  const temporaryPath = `${targetPath}.tmp-${process.pid}`
  await writeFile(temporaryPath, content, { flag: 'wx' })
  await rename(temporaryPath, targetPath)
}

async function main() {
  const workspaceRoot = process.cwd()
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim()
  const artifactRoot = process.env.CRIMSON_LOCAL_ARTIFACT_ROOT ?? buildDefaultArtifactRoot(process.env.LOCALAPPDATA)
  const layout = await prepareArtifactDirectories(artifactRoot, {
    gitRoot,
    userProfile: process.env.USERPROFILE,
    workspaceRoot,
  })

  const databaseCheck = execFileSync('docker', [
    'exec', LOCAL_DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-AtX',
    '-c', "select case when current_database() = 'postgres' then 'LOCAL_OK' else 'INVALID' end;",
  ], { encoding: 'utf8', windowsHide: true }).trim()
  if (databaseCheck !== 'LOCAL_OK') throw new Error('El contenedor local no respondió con la identidad esperada.')

  const dump = spawnSync('docker', [
    'exec', LOCAL_DB_CONTAINER, 'pg_dump', '-U', 'postgres', '-d', 'postgres',
    '--format=custom', '--no-owner', '--no-privileges', '--compress=6',
  ], { encoding: null, maxBuffer: 512 * 1024 * 1024, windowsHide: true })
  if (dump.status !== 0) {
    throw new Error(`pg_dump local falló con código ${dump.status ?? 'desconocido'}.`)
  }
  if (!dump.stdout || dump.stdout.length < 1024) throw new Error('El backup local quedó vacío o incompleto.')

  const generatedAt = new Date().toISOString()
  const filename = buildTimestampedName('local-backup', generatedAt, 'dump')
  const targetPath = path.join(layout.raw, filename)
  const digest = sha256(dump.stdout)
  const manifest = {
    schema_version: 1,
    generated_at: generatedAt,
    source: { kind: 'supabase_local', container: LOCAL_DB_CONTAINER, database: 'postgres' },
    backup_file: filename,
    bytes: dump.stdout.length,
    sha256: digest,
  }

  await atomicWrite(targetPath, dump.stdout)
  await atomicWrite(`${targetPath}.sha256`, `${digest}  ${filename}\n`)
  await atomicWrite(path.join(layout.manifests, `${filename}.json`), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`Backup lógico local externo creado: ${targetPath}`)
  console.log(`Bytes: ${dump.stdout.length}; SHA-256: ${digest}`)
}

main().catch((error) => {
  console.error(`No se pudo crear el backup local: ${error?.message ?? 'error desconocido'}`)
  process.exitCode = 1
})
