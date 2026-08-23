import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import dotenv from 'dotenv'

import {
  assertSafeTestEnvironment,
  UnsafeEnvironmentError,
} from './production-guards.ts'

const PRODUCTION_ENV_FILES = ['.env', '.env.local', '.env.staging'] as const

type Environment = Record<string, string | undefined>

function parseEnvironmentFile(filePath: string): Record<string, string> {
  return dotenv.parse(readFileSync(filePath))
}

export function loadSafeTestEnvironment(
  rootDirectory: string,
  inheritedEnvironment: Environment = process.env,
): Environment {
  const resolvedRoot = resolve(rootDirectory)
  const testEnvironmentPath = resolve(resolvedRoot, '.env.test.local')

  if (!existsSync(testEnvironmentPath)) {
    throw new UnsafeEnvironmentError(
      'Entorno inseguro: falta .env.test.local; las pruebas no pueden usar los .env productivos.',
    )
  }

  const testEnvironment = parseEnvironmentFile(testEnvironmentPath)
  const mergedEnvironment = {
    ...inheritedEnvironment,
    ...testEnvironment,
  }
  const forbiddenSecretValues = new Set<string>()

  for (const fileName of PRODUCTION_ENV_FILES) {
    const productionEnvironmentPath = resolve(resolvedRoot, fileName)
    if (!existsSync(productionEnvironmentPath)) continue

    const productionEnvironment = parseEnvironmentFile(productionEnvironmentPath)
    const productionServiceRole =
      productionEnvironment.SUPABASE_SERVICE_ROLE_KEY?.trim()
    if (productionServiceRole) {
      forbiddenSecretValues.add(productionServiceRole)
    }
  }

  assertSafeTestEnvironment(mergedEnvironment, forbiddenSecretValues)
  return mergedEnvironment
}
