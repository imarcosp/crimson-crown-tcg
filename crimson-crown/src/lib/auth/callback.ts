export const AUTH_CALLBACK_PATHS = ['/', '/auth/update-password'] as const

export type AuthCallbackPath = (typeof AUTH_CALLBACK_PATHS)[number]

export function resolveAuthCallbackPath(
  candidate: string | null | undefined,
): AuthCallbackPath {
  return AUTH_CALLBACK_PATHS.find((path) => path === candidate) ?? '/'
}
