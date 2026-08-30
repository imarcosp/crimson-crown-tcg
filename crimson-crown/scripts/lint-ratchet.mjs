import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'

import { compareLintBaseline, summarizeLintResults } from './lib/lint-ratchet.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const baseline = JSON.parse(await readFile(path.join(scriptDirectory, 'lint-baseline.json'), 'utf8'))
  const eslint = new ESLint({ cwd: process.cwd() })
  const results = await eslint.lintFiles(['.'])
  const current = summarizeLintResults(results)
  const regressions = compareLintBaseline(current, baseline)

  if (regressions.length > 0) {
    throw new Error(`La deuda ESLint aumentó:\n- ${regressions.join('\n- ')}`)
  }

  console.log(`ESLint ratchet OK: ${current.errors} errores, ${current.warnings} advertencias, ${current.files} archivos.`)
}

main().catch((error) => {
  console.error(error?.message ?? 'No se pudo ejecutar el ratchet ESLint.')
  process.exitCode = 1
})
