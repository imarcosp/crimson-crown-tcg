import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { loadAndValidateManifest } from './migration-manifest.mjs'

const execFileAsync = promisify(execFile)
const rootDir = resolve(process.cwd())

test('a Windows checkout preserves the migration bytes covered by the release manifest', async () => {
  const migrationsDir = join(rootDir, 'supabase', 'migrations')
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const migrationPaths = migrationFiles.map((file) => relative(rootDir, join(migrationsDir, file)))
  const contractPaths = [
    ...migrationPaths,
    relative(rootDir, join(rootDir, 'scripts', 'release', 'migration-manifest.json')),
    relative(rootDir, join(rootDir, 'scripts', 'release', 'production-reconciliation-preflight.sql')),
    relative(rootDir, join(rootDir, 'scripts', 'release', 'run-linked-dry-run.ps1')),
  ]

  const { stdout } = await execFileAsync('git', [
    '-C',
    rootDir,
    'check-attr',
    'eol',
    '--',
    ...contractPaths,
  ])
  const attributes = stdout.trim().split(/\r?\n/)

  assert.equal(attributes.length, contractPaths.length)
  for (const attribute of attributes) {
    assert.match(attribute, /: eol: (?:lf|crlf)$/)
  }

  await loadAndValidateManifest({ rootDir })
})
