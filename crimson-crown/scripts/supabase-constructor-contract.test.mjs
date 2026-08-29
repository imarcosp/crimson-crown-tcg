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

function isFunctionLikeScope(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  )
}

function createLexicalModel(sourceFile) {
  const nodeScopes = new WeakMap()
  const rootScope = {
    bindings: new Map(),
    kind: 'source',
    node: sourceFile,
    parent: null,
  }

  function childScope(parent, node, kind) {
    return { bindings: new Map(), kind, node, parent }
  }

  function addBinding(scope, name, binding) {
    const bindings = scope.bindings.get(name) ?? []
    bindings.push({ ...binding, scope })
    scope.bindings.set(name, bindings)
  }

  function addBindingPattern(scope, name, binding) {
    if (ts.isIdentifier(name)) {
      addBinding(scope, name.text, binding)
      return
    }

    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue
      addBindingPattern(scope, element.name, {
        ...binding,
        initializer: null,
      })
    }
  }

  function nearestFunctionOrSourceScope(scope) {
    let current = scope
    while (current.kind !== 'function' && current.kind !== 'source') {
      current = current.parent
    }
    return current
  }

  function registerImport(statement, scope) {
    const importClause = statement.importClause
    if (
      !importClause ||
      importClause.isTypeOnly ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) return

    const isNodeModule =
      statement.moduleSpecifier.text === 'node:module' ||
      statement.moduleSpecifier.text === 'module'
    if (importClause.name) {
      addBinding(scope, importClause.name.text, {
        declaration: statement,
        initializer: null,
        kind: isNodeModule ? 'module-namespace' : 'other',
      })
    }

    if (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
      addBinding(scope, importClause.namedBindings.name.text, {
        declaration: statement,
        initializer: null,
        kind: isNodeModule ? 'module-namespace' : 'other',
      })
    }

    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      for (const element of importClause.namedBindings.elements) {
        if (element.isTypeOnly) continue
        const importedName = element.propertyName?.text ?? element.name.text
        addBinding(scope, element.name.text, {
          declaration: element,
          initializer: null,
          kind: isNodeModule && importedName === 'createRequire'
            ? 'create-require-factory'
            : 'other',
        })
      }
    }
  }

  function visit(node, scope) {
    nodeScopes.set(node, scope)

    if (ts.isFunctionDeclaration(node) && node.name) {
      addBinding(scope, node.name.text, {
        declaration: node,
        initializer: null,
        kind: 'other',
      })
    }

    if (ts.isClassDeclaration(node) && node.name) {
      addBinding(scope, node.name.text, {
        declaration: node,
        initializer: null,
        kind: 'other',
      })
    }

    if (isFunctionLikeScope(node)) {
      const functionScope = childScope(scope, node, 'function')
      if (ts.isFunctionExpression(node) && node.name) {
        addBinding(functionScope, node.name.text, {
          declaration: node,
          initializer: null,
          kind: 'other',
        })
      }
      for (const parameter of node.parameters) {
        addBindingPattern(functionScope, parameter.name, {
          declaration: parameter,
          initializer: null,
          kind: 'other',
        })
        visit(parameter, functionScope)
      }
      if (node.body) visit(node.body, functionScope)
      return
    }

    if (ts.isBlock(node) || ts.isCaseBlock(node) || ts.isModuleBlock(node)) {
      const blockScope = childScope(scope, node, 'block')
      nodeScopes.set(node, blockScope)
      ts.forEachChild(node, (child) => visit(child, blockScope))
      return
    }

    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      const loopScope = childScope(scope, node, 'block')
      nodeScopes.set(node, loopScope)
      ts.forEachChild(node, (child) => visit(child, loopScope))
      return
    }

    if (ts.isCatchClause(node)) {
      const catchScope = childScope(scope, node, 'block')
      nodeScopes.set(node, catchScope)
      if (node.variableDeclaration) {
        addBindingPattern(catchScope, node.variableDeclaration.name, {
          declaration: node.variableDeclaration,
          initializer: null,
          kind: 'other',
        })
      }
      ts.forEachChild(node, (child) => visit(child, catchScope))
      return
    }

    if (ts.isImportDeclaration(node)) registerImport(node, scope)

    if (
      ts.isVariableDeclaration(node) &&
      ts.isVariableDeclarationList(node.parent)
    ) {
      const flags = node.parent.flags
      const kind = (flags & ts.NodeFlags.Const) !== 0 ? 'const' : 'other'
      const bindingScope = (flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) !== 0
        ? scope
        : nearestFunctionOrSourceScope(scope)
      addBindingPattern(bindingScope, node.name, {
        declaration: node,
        initializer: ts.isIdentifier(node.name) ? node.initializer ?? null : null,
        kind,
      })
    }

    ts.forEachChild(node, (child) => visit(child, scope))
  }

  nodeScopes.set(sourceFile, rootScope)
  ts.forEachChild(sourceFile, (node) => visit(node, rootScope))
  return { nodeScopes, rootScope, sourceFile }
}

function unwrapTransparentExpression(expression) {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isPartiallyEmittedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function lookupBinding(identifier, model) {
  let scope = model.nodeScopes.get(identifier) ?? model.rootScope
  const usePosition = identifier.getStart(model.sourceFile)

  while (scope) {
    const candidates = scope.bindings.get(identifier.text)
    if (candidates?.length) {
      const preceding = candidates
        .filter((binding) => binding.declaration.getStart(model.sourceFile) <= usePosition)
        .sort(
          (left, right) =>
            right.declaration.getStart(model.sourceFile) -
            left.declaration.getStart(model.sourceFile),
        )
      return preceding[0] ?? candidates[0]
    }
    scope = scope.parent
  }

  return null
}

function constBindingIsReadable(binding, identifier, model) {
  if (binding.kind !== 'const' || !binding.initializer) return false
  if (binding.declaration.getEnd() <= identifier.getStart(model.sourceFile)) return true

  let scope = model.nodeScopes.get(identifier)
  while (scope && scope !== binding.scope) {
    if (scope.kind === 'function') return true
    scope = scope.parent
  }
  return false
}

function resolveStaticString(expression, model, resolving = new Set()) {
  const current = unwrapTransparentExpression(expression)
  if (ts.isStringLiteralLike(current)) return current.text

  if (ts.isTemplateExpression(current)) {
    let value = current.head.text
    for (const span of current.templateSpans) {
      const substitution = resolveStaticString(span.expression, model, resolving)
      if (substitution === null) return null
      value += substitution + span.literal.text
    }
    return value
  }

  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveStaticString(current.left, model, resolving)
    const right = resolveStaticString(current.right, model, resolving)
    return left === null || right === null ? null : left + right
  }

  if (ts.isIdentifier(current)) {
    const binding = lookupBinding(current, model)
    if (!binding || resolving.has(binding) || !constBindingIsReadable(binding, current, model)) {
      return null
    }

    const nextResolving = new Set(resolving)
    nextResolving.add(binding)
    return resolveStaticString(binding.initializer, model, nextResolving)
  }

  return null
}

function rawPackageSpecifier(expression, model) {
  const specifier = resolveStaticString(expression, model)
  return specifier !== null && isRawPackageSpecifier(specifier) ? specifier : null
}

function isUnshadowedGlobal(expression, name, model) {
  const current = unwrapTransparentExpression(expression)
  return ts.isIdentifier(current) && current.text === name && !lookupBinding(current, model)
}

function propertyAccessParts(expression, model) {
  const current = unwrapTransparentExpression(expression)
  if (ts.isPropertyAccessExpression(current)) {
    return { base: current.expression, name: current.name.text }
  }
  if (ts.isElementAccessExpression(current) && current.argumentExpression) {
    const name = resolveStaticString(current.argumentExpression, model)
    return name === null ? null : { base: current.expression, name }
  }
  return null
}

function isModuleNamespaceExpression(expression, model, resolving = new Set()) {
  const current = unwrapTransparentExpression(expression)
  if (!ts.isIdentifier(current)) return false

  const binding = lookupBinding(current, model)
  if (!binding || resolving.has(binding)) return false
  if (binding.kind === 'module-namespace') return true
  if (!constBindingIsReadable(binding, current, model)) return false

  const nextResolving = new Set(resolving)
  nextResolving.add(binding)
  return isModuleNamespaceExpression(binding.initializer, model, nextResolving)
}

function isCreateRequireFactory(expression, model, resolving = new Set()) {
  const current = unwrapTransparentExpression(expression)
  if (ts.isIdentifier(current)) {
    const binding = lookupBinding(current, model)
    if (!binding || resolving.has(binding)) return false
    if (binding.kind === 'create-require-factory') return true
    if (!constBindingIsReadable(binding, current, model)) return false

    const nextResolving = new Set(resolving)
    nextResolving.add(binding)
    return isCreateRequireFactory(binding.initializer, model, nextResolving)
  }

  const access = propertyAccessParts(current, model)
  return Boolean(
    access &&
    access.name === 'createRequire' &&
    isModuleNamespaceExpression(access.base, model),
  )
}

function isLoaderExpression(expression, model, resolving = new Set()) {
  const current = unwrapTransparentExpression(expression)
  if (ts.isIdentifier(current)) {
    const binding = lookupBinding(current, model)
    if (!binding) return current.text === 'require'
    if (resolving.has(binding) || !constBindingIsReadable(binding, current, model)) return false

    const nextResolving = new Set(resolving)
    nextResolving.add(binding)
    return isLoaderExpression(binding.initializer, model, nextResolving)
  }

  const access = propertyAccessParts(current, model)
  if (
    access &&
    access.name === 'require' &&
    isUnshadowedGlobal(access.base, 'module', model)
  ) {
    return true
  }

  return ts.isCallExpression(current) && isCreateRequireFactory(current.expression, model)
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
  const lexicalModel = createLexicalModel(sourceFile)
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
      rawPackageSpecifier(statement.moduleSpecifier, lexicalModel) &&
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
      rawPackageSpecifier(statement.moduleReference.expression, lexicalModel)
    ) {
      namespaceBindings.add(statement.name.text)
      if (!rawImportAllowed) {
        rawImports.push(`${locationOf(sourceFile, statement)} raw import-equals declaration`)
      }
    }

    if (
      !ts.isImportDeclaration(statement) ||
      !rawPackageSpecifier(statement.moduleSpecifier, lexicalModel)
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

      const isDynamicImport = expression.kind === ts.SyntaxKind.ImportKeyword
      if (
        !rawImportAllowed &&
        node.arguments.length > 0 &&
        (isDynamicImport || isLoaderExpression(expression, lexicalModel))
      ) {
        const specifier = rawPackageSpecifier(node.arguments[0], lexicalModel)
        if (specifier) {
          rawImports.push(`${locationOf(sourceFile, node.arguments[0])} raw package loader reference`)
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
    {
      name: 'earlier raw binding survives a later function shadow',
      source: "const dependency = '@supabase/ssr'; require(dependency); function later() { const dependency = 'ordinary-package'; return dependency }",
    },
    {
      name: 'outer raw binding survives a nested block shadow',
      source: "const dependency = '@supabase/supabase-js'; { const dependency = 'ordinary-package'; void dependency } require(dependency)",
    },
    {
      name: 'function-local raw binding survives a later outer declaration',
      source: "function loadRaw() { const dependency = '@supabase/ssr/server'; module.require(dependency) } const dependency = 'ordinary-package'",
    },
    {
      name: 'same-name declarations resolve independently in sibling blocks',
      source: "{ const dependency = '@supabase/supabase-js/runtime'; require(dependency) } { const dependency = 'ordinary-package'; console.log(dependency) }",
    },
    {
      name: 'TypeScript transparent assertions preserve raw strings and loader aliases',
      extension: '.ts',
      source: "const dependency = ((('@supabase/' as const) + ('ssr' as string)) satisfies string)!; const load = (require as typeof require)!; (load as typeof require)(dependency as string)",
    },
    {
      name: 'TypeScript angle assertion preserves module.require',
      extension: '.ts',
      source: "const dependency = <string>('@supabase/' + 'supabase-js'); (module.require as typeof module.require)(dependency!)",
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

test('ordinary calls, shadowed loaders, and non-module text are not loader boundaries', () => {
  const fixtures = [
    {
      name: 'comment and unrelated string',
      source: "// require('@supabase/ssr')\nconst documentation = '@supabase/supabase-js'",
    },
    {
      name: 'console.log argument',
      source: "console.log('@supabase/ssr/server')",
    },
    {
      name: 'ordinary helper argument',
      source: "function helper(value) { return value }; helper('@supabase/supabase-js/runtime')",
    },
    {
      name: 'parameter shadows global require',
      source: "function inspect(require) { require('@supabase/ssr') }",
    },
    {
      name: 'parameter shadows global module',
      source: "function inspect(module) { module.require('@supabase/supabase-js') }",
    },
    {
      name: 'block helper shadows outer loader alias',
      source: "const load = require; { const load = helper; load('@supabase/ssr') }",
    },
    {
      name: 'function parameter shadows outer loader alias',
      source: "const load = require; function inspect(load) { load('@supabase/supabase-js') }",
    },
    {
      name: 'same-scope TDZ prevents a later raw constant from becoming an earlier argument',
      source: "require(dependency); const dependency = '@supabase/ssr'",
    },
  ]
  const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'crimson-supabase-negative-contract-'))

  try {
    const falsePositives = []
    fixtures.forEach((fixture, index) => {
      const filePath = path.join(fixtureDirectory, `fixture-${index}.mjs`)
      writeFileSync(filePath, fixture.source, 'utf8')
      const findings = inspectFile(filePath)
      if (findings.rawImports.length > 0 || findings.constructorCalls.length > 0) {
        falsePositives.push(fixture.name)
      }
    })

    assert.deepEqual(falsePositives, [])
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true })
  }
})
