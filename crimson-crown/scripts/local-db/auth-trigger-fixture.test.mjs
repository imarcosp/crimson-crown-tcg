import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('el fixture Auth recrea únicamente el trigger productivo conocido', () => {
  const sql = readFileSync(new URL('./auth-trigger-fixture.sql', import.meta.url), 'utf8')
  assert.match(sql, /create trigger on_auth_user_created/iu)
  assert.match(sql, /after insert on auth\.users/iu)
  assert.match(sql, /execute function public\.handle_new_user\(\)/iu)
  assert.doesNotMatch(sql, /drop\s+(?:table|schema|function)/iu)
})

test('el preparador sólo acepta el contenedor y puerto locales de Crimson', () => {
  const script = readFileSync(new URL('./prepare-auth-fixture.ps1', import.meta.url), 'utf8')
  assert.match(script, /supabase_db_crimson-crown/u)
  assert.match(script, /HostPort -ne '54622'/u)
  assert.match(script, /docker inspect/u)
  assert.match(script, /docker exec -e PGPASSWORD=postgres -i \$expectedContainer psql -U postgres/u)
  assert.doesNotMatch(script, /supabase\.co|db push|migration repair/iu)
})
