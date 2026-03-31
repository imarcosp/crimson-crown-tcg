import { create } from 'zustand'
import { EXCHANGE_RATE } from '@/lib/constants'

export type Currency = 'USD' | 'ARS'

export type Filters = {
  tcg: string[]
  rarity: string[]
  condition: string[]
  isFoil: boolean | null
}

export type SortOption = 'priceAsc' | 'priceDesc' | 'relevance'

type State = {
  currency: Currency
  usdToArsRate: number
  filters: Filters
  sort: SortOption
  searchQuery: string
}

type Actions = {
  toggleCurrency: () => void
  setCurrency: (c: Currency) => void
  setRate: (r: number) => void
  updateFilters: (partial: Partial<Filters>) => void
  clearFilters: () => void
  setSort: (s: SortOption) => void
  setSearchQuery: (q: string) => void
}

export const useStore = create<State & Actions>((set) => ({
  currency: 'USD',
  usdToArsRate: EXCHANGE_RATE,
  filters: { tcg: [], rarity: [], condition: [], isFoil: null },
  sort: 'relevance',
  searchQuery: '',
  toggleCurrency: () => set((s) => ({ currency: s.currency === 'USD' ? 'ARS' : 'USD' })),
  setCurrency: (c) => set({ currency: c }),
  setRate: (r) => set({ usdToArsRate: r }),
  updateFilters: (partial) => set((s) => ({ filters: { ...s.filters, ...partial } })),
  clearFilters: () => set({ filters: { tcg: [], rarity: [], condition: [], isFoil: null } }),
  setSort: (s) => set({ sort: s }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}))
