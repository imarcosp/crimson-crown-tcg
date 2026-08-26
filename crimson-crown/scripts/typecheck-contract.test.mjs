import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const nextConfig = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8')

test('el proyecto expone un typecheck estricto', () => {
  assert.equal(packageJson.scripts?.typecheck, 'tsc --noEmit')
})

test('el build no ignora errores de TypeScript', () => {
  assert.doesNotMatch(nextConfig, /ignoreBuildErrors\s*:\s*true/)
})
