import { execFileSync } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  buildCountSql,
  buildSnapshotEnvelope,
  buildTimestampedName,
  LOCAL_DB_CONTAINER,
  sha256,
} from '../lib/local-operations.mjs'
import {
  buildDefaultArtifactRoot,
  prepareArtifactDirectories,
} from './verify-artifact-location.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const schemaSqlPath = path.join(scriptDirectory, '..', 'staging', 'snapshot-crimson-schema.sql')

function runLocalPsql(sql, database = 'postgres') {
  return execFileSync(
    'docker',
    ['exec', '-i', LOCAL_DB_CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-AtX', '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  ).trim()
}

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

  const objectNames = JSON.parse(runLocalPsql(`
    select jsonb_agg(object_name order by object_name)
    from (
      select namespace.nspname || '.' || relation.relname as object_name
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and relation.relkind in ('r', 'p')
      union all select 'auth.users'
      union all select 'storage.buckets'
      union all select 'storage.objects'
    ) objects;
  `))
  const rowCounts = JSON.parse(runLocalPsql(buildCountSql(objectNames)))
  const schemaSql = await readFile(schemaSqlPath, 'utf8')
  const schemaSnapshot = JSON.parse(runLocalPsql(schemaSql))
  const generatedAt = new Date().toISOString()
  const snapshot = buildSnapshotEnvelope({ generatedAt, schemaSnapshot, rowCounts })
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`
  const filename = buildTimestampedName('local-state', generatedAt, 'json')
  const targetPath = path.join(layout.manifests, filename)
  const digest = sha256(serialized)

  await atomicWrite(targetPath, serialized)
  await atomicWrite(`${targetPath}.sha256`, `${digest}  ${filename}\n`)

  console.log(`Snapshot local externo creado: ${targetPath}`)
  console.log(`Objetos clasificados: ${snapshot.classifications.length}; SHA-256: ${digest}`)
}

main().catch((error) => {
  console.error(`No se pudo crear el snapshot local: ${error?.message ?? 'error desconocido'}`)
  process.exitCode = 1
})
