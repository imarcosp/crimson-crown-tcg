export function summarizeLintResults(results) {
  const summary = { errors: 0, warnings: 0, files: 0, rules: {} }

  for (const result of results) {
    summary.errors += result.errorCount
    summary.warnings += result.warningCount
    if (result.errorCount > 0 || result.warningCount > 0) summary.files += 1

    for (const message of result.messages) {
      const rule = message.ruleId || '<parser>'
      summary.rules[rule] ??= { errors: 0, warnings: 0 }
      if (message.severity === 2) summary.rules[rule].errors += 1
      if (message.severity === 1) summary.rules[rule].warnings += 1
    }
  }

  return summary
}

export function compareLintBaseline(current, baseline) {
  const regressions = []
  for (const metric of ['errors', 'warnings']) {
    if (current[metric] > baseline.maximum[metric]) {
      regressions.push(`${metric}: ${current[metric]} > ${baseline.maximum[metric]}`)
    }
  }

  const rules = new Set([...Object.keys(current.rules), ...Object.keys(baseline.rules)])
  for (const rule of [...rules].sort()) {
    for (const metric of ['errors', 'warnings']) {
      const actual = current.rules[rule]?.[metric] ?? 0
      const maximum = baseline.rules[rule]?.[metric] ?? 0
      if (actual > maximum) regressions.push(`${rule}.${metric}: ${actual} > ${maximum}`)
    }
  }

  return regressions
}
