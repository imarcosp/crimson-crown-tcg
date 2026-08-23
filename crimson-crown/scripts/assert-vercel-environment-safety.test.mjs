import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const proxySource = await readFile(new URL('../src/proxy.ts', import.meta.url), 'utf8')

test('el proxy bloquea un Supabase productivo fuera de Vercel Production', () => {
  assert.match(proxySource, /assertSafeRuntimeSupabaseUrl/)
  assert.match(proxySource, /Entorno no disponible para este deployment\./)
  assert.match(proxySource, /createServerClient/)
  const guardCall = proxySource.indexOf('assertSafeRuntimeSupabaseUrl(supabaseUrl')
  const clientCall = proxySource.indexOf('createServerClient(')
  assert.ok(guardCall >= 0, 'el proxy debe invocar el guard con la URL')
  assert.ok(clientCall >= 0, 'el proxy debe crear el cliente Supabase')
  assert.ok(guardCall < clientCall, 'el guard debe ejecutarse antes de crear el cliente Supabase')
})
