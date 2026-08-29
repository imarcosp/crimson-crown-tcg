export type SupabaseTargetKind = 'local' | 'staging' | 'production'

export interface SupabaseTarget {
  kind: SupabaseTargetKind
  projectRef: string | null
  url: URL
}

export type SupabaseEnvironment = Record<string, string | undefined>

export declare const CRIMSON_PRODUCTION_PROJECT_REF: 'djfqozfaqkqdoqeoqbzt'
export declare const CRIMSON_LOCAL_SUPABASE_API_PORT: '54621'
export declare const FORBIDDEN_PROJECT_REFS: readonly string[]

export declare class UnsafeEnvironmentError extends Error {}

export declare function classifySupabaseTarget(
  rawUrl: string,
  stagingRef?: string,
): SupabaseTarget

export declare function assertSafeRuntimeSupabaseUrl(
  rawUrl: string,
  env?: SupabaseEnvironment,
): URL

export declare function assertSafeClientSupabaseUrl(
  rawUrl: string,
  expectedTarget: SupabaseTargetKind,
  stagingRef?: string,
): URL
