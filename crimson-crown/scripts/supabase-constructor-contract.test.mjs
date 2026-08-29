import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const RAW_PACKAGES = new Set(['@supabase/supabase-js', '@supabase/ssr'])
const RAW_CONSTRUCTORS = new Set([
  'createClient',
  'createBrowserClient',
  'createServerClient',
])
const GUARDED_ADAPTER_ALLOWLIST = new Set([
  'scripts/lib/guarded-supabase-client.mjs',
  'src/lib/supabase/guarded-constructors.ts',
])
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const IGNORED_DIRECTORIES = new Set([
  '.next',
  'coverage',
  'dist',
  'node_modules',
  'release-evidence',
])

function toRepositoryPath(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll(path.sep, '/')
}

function isControlledTestFixture(repositoryPath) {
  return /(?:^|\/)(?:__tests__\/|[^/]+\.(?:spec|test)\.)/.test(repositoryPath)
}

function discoverSourceFiles(directory) {
  const files = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue

    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...discoverSourceFiles(entryPath))
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath)
    }
  }

  return files
}

function rawPackageName(expression) {
  if (!ts.isStringLiteralLike(expression)) return null
  return RAW_PACKAGES.has(expression.text) ? expression.text : null
}

function locationOf(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return `${toRepositoryPath(sourceFile.fileName)}:${line + 1}:${character + 1}`
}

function inspectFile(filePath) {
  const repositoryPath = toRepositoryPath(filePath)
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const constructorBindings = new Map()
  const namespaceBindings = new Set()
  const rawImports = []
  const constructorCalls = []
  const rawImportAllowed =
    GUARDED_ADAPTER_ALLOWLIST.has(repositoryPath) || isControlledTestFixture(repositoryPath)

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      rawPackageName(statement.moduleSpecifier) &&
      !statement.isTypeOnly &&
      !rawImportAllowed
    ) {
      if (!statement.exportClause) {
        rawImports.push(`${locationOf(sourceFile, statement)} raw package re-export`)
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue
          const exportedName = element.propertyName?.text ?? element.name.text
          if (RAW_CONSTRUCTORS.has(exportedName)) {
            rawImports.push(`${locationOf(sourceFile, element)} ${exportedName} re-export`)
          }
        }
      } else {
        rawImports.push(`${locationOf(sourceFile, statement)} raw namespace re-export`)
      }
    }

    if (
      ts.isImportEqualsDeclaration(statement) &&
      !statement.isTypeOnly &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      rawPackageName(statement.moduleReference.expression)
    ) {
      namespaceBindings.add(statement.name.text)
      if (!rawImportAllowed) {
        rawImports.push(`${locationOf(sourceFile, statement)} raw import-equals declaration`)
      }
    }

    if (!ts.isImportDeclaration(statement) || !rawPackageName(statement.moduleSpecifier)) continue

    const importClause = statement.importClause
    if (!importClause || importClause.isTypeOnly) continue

    if (importClause.name) {
      if (!rawImportAllowed) rawImports.push(`${locationOf(sourceFile, importClause.name)} default import`)
    }

    if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
      namespaceBindings.add(importClause.namedBindings.name.text)
      if (!rawImportAllowed) {
        rawImports.push(`${locationOf(sourceFile, importClause.namedBindings)} namespace import`)
      }
    }

    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        if (element.isTypeOnly) continue
        const importedName = element.propertyName?.text ?? element.name.text
        if (!RAW_CONSTRUCTORS.has(importedName)) continue

        constructorBindings.set(element.name.text, importedName)
        if (!rawImportAllowed) {
          rawImports.push(`${locationOf(sourceFile, element)} ${importedName} import`)
        }
      }
    }
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      let constructorName = null

      if (ts.isIdentifier(expression)) {
        constructorName = constructorBindings.get(expression.text) ?? null
      } else if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        namespaceBindings.has(expression.expression.text) &&
        RAW_CONSTRUCTORS.has(expression.name.text)
      ) {
        constructorName = expression.name.text
      } else if (
        ts.isElementAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        namespaceBindings.has(expression.expression.text) &&
        expression.argumentExpression &&
        ts.isStringLiteralLike(expression.argumentExpression) &&
        RAW_CONSTRUCTORS.has(expression.argumentExpression.text)
      ) {
        constructorName = expression.argumentExpression.text
      }

      if (constructorName && !rawImportAllowed) {
        constructorCalls.push(`${locationOf(sourceFile, node)} ${constructorName} call`)
      }

      const isRequire = ts.isIdentifier(expression) && expression.text === 'require'
      const isDynamicImport = expression.kind === ts.SyntaxKind.ImportKeyword
      if (
        (isRequire || isDynamicImport) &&
        node.arguments.length === 1 &&
        rawPackageName(node.arguments[0]) &&
        !rawImportAllowed
      ) {
        rawImports.push(`${locationOf(sourceFile, node)} dynamic raw package import`)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { constructorCalls, rawImports }
}

test('all runtime Supabase constructors are confined to guarded adapters', () => {
  const files = [
    ...discoverSourceFiles(path.join(process.cwd(), 'src')),
    ...discoverSourceFiles(path.join(process.cwd(), 'scripts')),
  ]
  const findings = files.map(inspectFile)
  const constructorCalls = findings.flatMap((finding) => finding.constructorCalls)
  const rawImports = findings.flatMap((finding) => finding.rawImports)
  const violations = [...rawImports, ...constructorCalls]

  assert.deepEqual(
    violations,
    [],
    `Found ${constructorCalls.length} direct constructor calls and ${rawImports.length} forbidden raw imports:\n${violations.join('\n')}`,
  )
})
