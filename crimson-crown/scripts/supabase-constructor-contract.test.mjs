import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const RAW_PACKAGE_ROOTS = ['@supabase/supabase-js', '@supabase/ssr']
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

function isRawPackageSpecifier(specifier) {
  return RAW_PACKAGE_ROOTS.some(
    (packageRoot) => specifier === packageRoot || specifier.startsWith(`${packageRoot}/`),
  )
}

function collectStaticStringBindings(sourceFile) {
  const bindings = new Map()

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      bindings.set(node.name.text, node.initializer)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return bindings
}

function resolveStaticString(expression, bindings, resolving = new Set()) {
  if (ts.isStringLiteralLike(expression)) return expression.text

  if (ts.isParenthesizedExpression(expression)) {
    return resolveStaticString(expression.expression, bindings, resolving)
  }

  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text
    for (const span of expression.templateSpans) {
      const substitution = resolveStaticString(span.expression, bindings, resolving)
      if (substitution === null) return null
      value += substitution + span.literal.text
    }
    return value
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveStaticString(expression.left, bindings, resolving)
    const right = resolveStaticString(expression.right, bindings, resolving)
    return left === null || right === null ? null : left + right
  }

  if (ts.isIdentifier(expression)) {
    if (resolving.has(expression.text)) return null
    const initializer = bindings.get(expression.text)
    if (!initializer) return null

    const nextResolving = new Set(resolving)
    nextResolving.add(expression.text)
    return resolveStaticString(initializer, bindings, nextResolving)
  }

  return null
}

function rawPackageSpecifier(expression, bindings) {
  const specifier = resolveStaticString(expression, bindings)
  return specifier !== null && isRawPackageSpecifier(specifier) ? specifier : null
}

function importHasRuntimeReference(statement) {
  const importClause = statement.importClause
  if (!importClause) return true
  if (importClause.isTypeOnly) return false
  if (importClause.name) return true
  if (!importClause.namedBindings) return true
  if (ts.isNamespaceImport(importClause.namedBindings)) return true
  return importClause.namedBindings.elements.some((element) => !element.isTypeOnly)
}

function exportHasRuntimeReference(statement) {
  if (statement.isTypeOnly) return false
  if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return true
  return (
    statement.exportClause.elements.length === 0 ||
    statement.exportClause.elements.some((element) => !element.isTypeOnly)
  )
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
  const staticStringBindings = collectStaticStringBindings(sourceFile)
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
      rawPackageSpecifier(statement.moduleSpecifier, staticStringBindings) &&
      exportHasRuntimeReference(statement) &&
      !rawImportAllowed
    ) {
      rawImports.push(`${locationOf(sourceFile, statement)} raw package re-export`)
    }

    if (
      ts.isImportEqualsDeclaration(statement) &&
      !statement.isTypeOnly &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      rawPackageSpecifier(statement.moduleReference.expression, staticStringBindings)
    ) {
      namespaceBindings.add(statement.name.text)
      if (!rawImportAllowed) {
        rawImports.push(`${locationOf(sourceFile, statement)} raw import-equals declaration`)
      }
    }

    if (
      !ts.isImportDeclaration(statement) ||
      !rawPackageSpecifier(statement.moduleSpecifier, staticStringBindings)
    ) continue

    const importClause = statement.importClause
    if (!importHasRuntimeReference(statement)) continue

    if (!rawImportAllowed) {
      rawImports.push(`${locationOf(sourceFile, statement)} raw package import`)
    }

    if (!importClause) continue

    if (importClause.name) {
      namespaceBindings.add(importClause.name.text)
    }

    if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
      namespaceBindings.add(importClause.namedBindings.name.text)
    }

    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        if (element.isTypeOnly) continue
        const importedName = element.propertyName?.text ?? element.name.text
        if (!RAW_CONSTRUCTORS.has(importedName)) continue

        constructorBindings.set(element.name.text, importedName)
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

      if (!rawImportAllowed) {
        for (const argument of node.arguments) {
          const specifier = rawPackageSpecifier(argument, staticStringBindings)
          if (specifier) {
            rawImports.push(`${locationOf(sourceFile, argument)} raw package loader reference`)
          }
        }
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

test('raw Supabase subpaths and loader aliases cannot bypass the runtime contract', () => {
  const fixtures = [
    {
      name: 'supabase-js subpath import',
      source: "import { createClient } from '@supabase/supabase-js/dist/main/index.js'",
    },
    {
      name: 'ssr subpath import',
      source: "import { createServerClient } from '@supabase/ssr/dist/module/index.js'",
    },
    {
      name: 'module.require',
      source: "module.require('@supabase/supabase-js/runtime')",
    },
    {
      name: 'computed module.require',
      source: "module['require']('@supabase/ssr/server')",
    },
    {
      name: 'aliased require',
      source: "const load = require; load('@supabase/' + 'supabase-js')",
    },
    {
      name: 'createRequire import alias and generated loader',
      source: "import { createRequire as makeLoader } from 'node:module'; const load = makeLoader(import.meta.url); load(`@supabase/${'ssr'}/server`)",
    },
    {
      name: 'createRequire namespace and generated loader alias',
      source: "import * as moduleTools from 'node:module'; const generated = moduleTools.createRequire(import.meta.url); const load = generated; load('@supabase/supabase-js')",
    },
    {
      name: 'dynamic import from a resolved constant',
      source: "const scope = '@supabase/'; const dependency = scope + 'ssr'; import(dependency)",
    },
    {
      name: 'import-equals subpath',
      extension: '.ts',
      source: "import supabase = require('@supabase/supabase-js/dist/main')",
    },
    {
      name: 'named raw re-export subpath',
      source: "export { createClient } from '@supabase/supabase-js/dist/main/index.js'",
    },
    {
      name: 'star raw re-export subpath',
      source: "export * from '@supabase/ssr/server'",
    },
  ]
  const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'crimson-supabase-contract-'))

  try {
    const missed = []
    fixtures.forEach((fixture, index) => {
      const filePath = path.join(fixtureDirectory, `fixture-${index}${fixture.extension ?? '.mjs'}`)
      writeFileSync(filePath, fixture.source, 'utf8')
      const findings = inspectFile(filePath)
      if (findings.rawImports.length === 0 && findings.constructorCalls.length === 0) {
        missed.push(fixture.name)
      }
    })

    assert.deepEqual(missed, [])
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true })
  }
})
