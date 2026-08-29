import {
  createBrowserClient as rawCreateBrowserClient,
  createServerClient as rawCreateServerClient,
} from '@supabase/ssr'
import { createClient as rawCreateSupabaseClient } from '@supabase/supabase-js'

import {
  assertSafeClientSupabaseUrl,
  assertSafeRuntimeSupabaseUrl,
  UnsafeEnvironmentError,
} from '../environment/production-guards.ts'

type Environment = Record<string, string | undefined>
type SupabaseTarget = 'local' | 'staging' | 'production'

function browserTarget(environment: Environment): SupabaseTarget {
  const target = environment.NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET?.trim() || 'local'

  if (target === 'local' || target === 'staging' || target === 'production') {
    return target
  }

  throw new UnsafeEnvironmentError('Target público Supabase no autorizado.')
}

export function guardRuntimeSupabaseConstructor<TConstructor extends CallableFunction>(
  constructor: TConstructor,
  environment?: Environment,
): TConstructor {
  const guardedConstructor = (rawUrl: string, ...args: unknown[]) => {
    const safeUrl = assertSafeRuntimeSupabaseUrl(rawUrl, environment ?? process.env)
    const delegate = constructor as unknown as (
      url: string,
      ...constructorArgs: unknown[]
    ) => unknown
    return delegate(safeUrl.toString(), ...args)
  }

  return guardedConstructor as unknown as TConstructor
}

export function guardBrowserSupabaseConstructor<TConstructor extends CallableFunction>(
  constructor: TConstructor,
  environment?: Environment,
): TConstructor {
  const guardedConstructor = (rawUrl: string, ...args: unknown[]) => {
    const activeEnvironment = environment ?? process.env
    const safeUrl = assertSafeClientSupabaseUrl(
      rawUrl,
      browserTarget(activeEnvironment),
      activeEnvironment.NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF ?? '',
    )
    const delegate = constructor as unknown as (
      url: string,
      ...constructorArgs: unknown[]
    ) => unknown
    return delegate(safeUrl.toString(), ...args)
  }

  return guardedConstructor as unknown as TConstructor
}

export const createGuardedSupabaseClient: typeof rawCreateSupabaseClient = guardRuntimeSupabaseConstructor(
  rawCreateSupabaseClient,
)

export const createGuardedBrowserClient: typeof rawCreateBrowserClient = guardBrowserSupabaseConstructor(
  rawCreateBrowserClient,
)

export const createGuardedServerClient: typeof rawCreateServerClient = guardRuntimeSupabaseConstructor(
  rawCreateServerClient,
)
