import { createClient as rawCreateClient } from '@supabase/supabase-js'

import {
  UnsafeEnvironmentError,
  assertSafeClientSupabaseUrl,
} from '../../src/lib/environment/supabase-target-policy.mjs'

/** @typedef {'local' | 'staging' | 'production'} OperationalTarget */
/** @typedef {Record<string, string | undefined>} Environment */

/**
 * @param {Environment} environment
 * @returns {OperationalTarget}
 */
function operationalTarget(environment) {
  const target = environment.CRIMSON_OPERATION_TARGET?.trim() || 'local'

  if (target === 'local' || target === 'staging' || target === 'production') {
    return target
  }

  throw new UnsafeEnvironmentError('Target operativo Supabase no autorizado.')
}

/**
 * @param {Environment} [environment]
 */
export function assertLegacyRpcMigrationOptIn(environment = process.env) {
  if (environment.CRIMSON_ENABLE_LEGACY_RPC_MIGRATION?.trim() !== 'true') {
    throw new UnsafeEnvironmentError('La migración RPC heredada está deshabilitada.')
  }
}

/**
 * @template {unknown[]} TArgs
 * @template TResult
 * @param {(url: string, ...args: TArgs) => TResult} constructor
 * @param {Environment} [environment]
 * @returns {(url: string, ...args: TArgs) => TResult}
 */
export function guardOperationalSupabaseConstructor(constructor, environment) {
  return (rawUrl, ...args) => {
    const activeEnvironment = environment ?? process.env
    const target = operationalTarget(activeEnvironment)
    const stagingRef = target === 'staging'
      ? activeEnvironment.CRIMSON_STAGING_SUPABASE_PROJECT_REF ?? ''
      : ''
    const safeUrl = assertSafeClientSupabaseUrl(rawUrl, target, stagingRef)

    return constructor(safeUrl.toString(), ...args)
  }
}

export const createOperationalSupabaseClient = guardOperationalSupabaseConstructor(
  rawCreateClient,
)
