import assert from 'node:assert/strict'
import test from 'node:test'

import { compareLintBaseline, summarizeLintResults } from './lint-ratchet.mjs'

const baseline = {
  maximum: { errors: 2, warnings: 1 },
  rules: {
    alpha: { errors: 2, warnings: 0 },
    beta: { errors: 0, warnings: 1 },
  },
}

test('resume resultados por severidad y regla', () => {
  const summary = summarizeLintResults([{
    errorCount: 1,
    warningCount: 1,
    messages: [
      { ruleId: 'alpha', severity: 2 },
      { ruleId: 'beta', severity: 1 },
    ],
  }])
  assert.deepEqual(summary, {
    errors: 1,
    warnings: 1,
    files: 1,
    rules: {
      alpha: { errors: 1, warnings: 0 },
      beta: { errors: 0, warnings: 1 },
    },
  })
})

test('acepta reducciones y rechaza aumentos o reglas nuevas', () => {
  assert.deepEqual(compareLintBaseline({ ...baseline.maximum, files: 1, rules: baseline.rules }, baseline), [])
  assert.deepEqual(
    compareLintBaseline({
      errors: 2,
      warnings: 2,
      files: 1,
      rules: { ...baseline.rules, gamma: { errors: 0, warnings: 1 } },
    }, baseline),
    ['warnings: 2 > 1', 'gamma.warnings: 1 > 0'],
  )
})
