/**
 * Persist configuration for the cart. Hydration is deliberately explicit in
 * CartSync so a browser's localStorage cannot change the first client render.
 */
export const CART_PERSIST_OPTIONS = {
  skipHydration: true,
} as const

export function migrateCartState(persistedState: unknown): Record<string, unknown> {
  const state = persistedState && typeof persistedState === 'object'
    ? persistedState as Record<string, unknown>
    : {}

  return {
    ...state,
    items: Array.isArray(state.items) ? state.items : [],
    savedItems: Array.isArray(state.savedItems) ? state.savedItems : [],
    discount: state.discount && typeof state.discount === 'object' ? state.discount : null,
  }
}
