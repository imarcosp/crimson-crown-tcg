import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

import {
  guardBrowserSupabaseConstructor,
  guardRuntimeSupabaseConstructor,
} from '../supabase/guarded-constructors.ts'
import {
  assertLegacyRpcMigrationOptIn,
  guardOperationalSupabaseConstructor,
} from '../../../scripts/lib/guarded-supabase-client.mjs'

const productionUrl = 'https://djfqozfaqkqdoqeoqbzt.supabase.co'
const stagingRef = 'crimsonstage12345678'
const stagingUrl = `https://${stagingRef}.supabase.co`
const localUrl = 'http://127.0.0.1:54621'
const normalizedProductionUrl = `${productionUrl}/`
const normalizedStagingUrl = `${stagingUrl}/`
const normalizedLocalUrl = `${localUrl}/`

function recordingConstructor(calls: string[]) {
  return (url: string) => {
    calls.push(url)
    return { url }
  }
}

function restoreEnvironmentValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

test('browser default metadata remains statically analyzable for Next public env inlining', () => {
  const singletonSourceFile = ts.createSourceFile(
    'client.ts',
    readFileSync(new URL('../supabase/client.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const guardedSingletonImport = singletonSourceFile.statements.find(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '@/lib/supabase/guarded-constructors',
  )
  assert.ok(
    guardedSingletonImport?.importClause?.namedBindings &&
      ts.isNamedImports(guardedSingletonImport.importClause.namedBindings) &&
      guardedSingletonImport.importClause.namedBindings.elements.some(
        (element) =>
          element.propertyName?.text === 'createGuardedBrowserClient' &&
          element.name.text === 'createBrowserClient',
      ),
    'the main browser singleton must delegate through the guarded browser adapter',
  )

  const sourceFile = ts.createSourceFile(
    'guarded-constructors.ts',
    readFileSync(new URL('../supabase/guarded-constructors.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const browserGuard = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'guardBrowserSupabaseConstructor',
  )
  assert.ok(browserGuard?.body)

  let activeEnvironmentInitializer: ts.Expression | undefined
  function findActiveEnvironment(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'activeEnvironment'
    ) {
      activeEnvironmentInitializer = node.initializer
    }
    ts.forEachChild(node, findActiveEnvironment)
  }
  findActiveEnvironment(browserGuard.body)
  assert.ok(activeEnvironmentInitializer)

  const directReads = new Set<string>()
  const bareProcessEnvironmentReferences: string[] = []
  function inspectInitializer(node: ts.Node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'process' &&
      node.expression.name.text === 'env'
    ) {
      directReads.add(node.name.text)
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env' &&
      !(
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node
      )
    ) {
      bareProcessEnvironmentReferences.push(node.getText(sourceFile))
    }

    ts.forEachChild(node, inspectInitializer)
  }
  inspectInitializer(activeEnvironmentInitializer)

  assert.deepEqual(
    [...directReads].sort(),
    [
      'NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET',
      'NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF',
    ],
  )
  assert.deepEqual(bareProcessEnvironmentReferences, [])
})

test('browser default metadata selects every Crimson deployment target and rejects unknown values', () => {
  const targetName = 'NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET'
  const stagingName = 'NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF'
  const originalTarget = process.env[targetName]
  const originalStagingRef = process.env[stagingName]
  const calls: string[] = []
  const constructor = guardBrowserSupabaseConstructor(recordingConstructor(calls))

  try {
    delete process.env[targetName]
    delete process.env[stagingName]
    assert.deepEqual(constructor(localUrl), { url: normalizedLocalUrl })

    process.env[targetName] = 'staging'
    process.env[stagingName] = stagingRef
    assert.deepEqual(constructor(stagingUrl), { url: normalizedStagingUrl })

    process.env[targetName] = 'production'
    delete process.env[stagingName]
    assert.deepEqual(constructor(productionUrl), { url: normalizedProductionUrl })

    process.env[targetName] = 'unexpected'
    assert.throws(() => constructor(productionUrl))
    assert.deepEqual(calls, [normalizedLocalUrl, normalizedStagingUrl, normalizedProductionUrl])
  } finally {
    restoreEnvironmentValue(targetName, originalTarget)
    restoreEnvironmentValue(stagingName, originalStagingRef)
  }
})

test('runtime and browser adapters validate the target before delegating', () => {
  const runtimeCalls: string[] = []
  const runtimeConstructor = guardRuntimeSupabaseConstructor(
    recordingConstructor(runtimeCalls),
    { VERCEL_ENV: 'production' },
  )

  assert.throws(() => runtimeConstructor(stagingUrl))
  assert.deepEqual(runtimeCalls, [])
  assert.deepEqual(runtimeConstructor(productionUrl), { url: normalizedProductionUrl })
  assert.deepEqual(runtimeCalls, [normalizedProductionUrl])

  const browserCalls: string[] = []
  const browserConstructor = guardBrowserSupabaseConstructor(
    recordingConstructor(browserCalls),
    {
      NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET: 'staging',
      NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF: stagingRef,
    },
  )

  assert.throws(() => browserConstructor(productionUrl))
  assert.deepEqual(browserCalls, [])
  assert.deepEqual(browserConstructor(stagingUrl), { url: normalizedStagingUrl })
  assert.deepEqual(browserCalls, [normalizedStagingUrl])
})

test('operational adapters default to pinned local and require an explicit hosted target', () => {
  assert.throws(() => assertLegacyRpcMigrationOptIn({}))
  assert.doesNotThrow(() =>
    assertLegacyRpcMigrationOptIn({ CRIMSON_ENABLE_LEGACY_RPC_MIGRATION: 'true' }),
  )

  const implicitCalls: string[] = []
  const implicitConstructor = guardOperationalSupabaseConstructor(
    recordingConstructor(implicitCalls),
    { SUPABASE_SERVICE_ROLE_KEY: 'credential-must-not-select-a-target' },
  )

  assert.throws(() => implicitConstructor(productionUrl))
  assert.throws(() => implicitConstructor('http://127.0.0.1:54321'))
  assert.deepEqual(implicitCalls, [])
  assert.deepEqual(implicitConstructor(localUrl), { url: normalizedLocalUrl })
  assert.deepEqual(implicitCalls, [normalizedLocalUrl])

  const productionCalls: string[] = []
  const productionConstructor = guardOperationalSupabaseConstructor(
    recordingConstructor(productionCalls),
    { CRIMSON_OPERATION_TARGET: 'production' },
  )
  assert.deepEqual(productionConstructor(productionUrl), { url: normalizedProductionUrl })
  assert.deepEqual(productionCalls, [normalizedProductionUrl])

  const stagingCalls: string[] = []
  const stagingConstructor = guardOperationalSupabaseConstructor(
    recordingConstructor(stagingCalls),
    {
      CRIMSON_OPERATION_TARGET: 'staging',
      CRIMSON_STAGING_SUPABASE_PROJECT_REF: stagingRef,
    },
  )
  assert.deepEqual(stagingConstructor(stagingUrl), { url: normalizedStagingUrl })
  assert.deepEqual(stagingCalls, [normalizedStagingUrl])
})
