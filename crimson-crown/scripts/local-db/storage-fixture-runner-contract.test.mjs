import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const localDbRoot = path.dirname(fileURLToPath(import.meta.url))

function source(name) {
  return readFileSync(path.join(localDbRoot, name), 'utf8')
}

test('el preparador de Storage deriva el worktree y conserva la identidad local exacta', () => {
  const runner = source('prepare-storage-fixtures.ps1')

  assert.match(runner, /GetFullPath\(\$repoRoot\)/)
  assert.match(runner, /docker inspect supabase_kong_crimson-crown supabase_db_crimson-crown/)
  assert.match(runner, /HostPort -ne '54621'/)
  assert.match(runner, /HostPort -ne '54622'/)
  assert.match(runner, /docker exec -i -e PGPASSWORD=postgres supabase_db_crimson-crown/)
  assert.doesNotMatch(runner, /GetFullPath\('D:\\crimson-crown-tcg/)
})

test('la matriz de Storage deriva el mismo worktree sin relajar proyecto ni contenedores', () => {
  const matrix = source('storage-matrix.mjs')

  assert.match(matrix, /fileURLToPath\(import\.meta\.url\)/)
  assert.match(matrix, /'docker',[\s\S]*'inspect', 'supabase_kong_crimson-crown', 'supabase_db_crimson-crown'/)
  assert.match(matrix, /'com\.docker\.compose\.project'\], 'crimson-crown'/)
  assert.match(matrix, /'com\.supabase\.cli\.project'\], 'crimson-crown'/)
  assert.doesNotMatch(matrix, /D:\\\\crimson-crown-tcg\\\\crimson-crown/)
})
