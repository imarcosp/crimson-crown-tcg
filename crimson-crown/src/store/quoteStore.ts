import { create } from 'zustand'

export type QuoteItem = {
  id: string
  name: string
  price: number
  image?: string
  setName?: string
  collectorNumber?: string
  quantity: number
  isFoil?: boolean 
  foilLocked?: boolean 
  foilLabel?: string   
}

type QuoteStore = {
  items: QuoteItem[]
  addItem: (item: QuoteItem) => void
  removeItem: (id: string) => void
  updateQuantity: (id: string, quantity: number) => void
  updateFoil: (id: string, isFoil: boolean) => void 
  setItems: (items: QuoteItem[]) => void // <--- AGREDEGAMOS ESTA FUNCIÓN FALTANTE
  clearQuote: () => void 
  generateMessage: () => string
}

export const useQuoteStore = create<QuoteStore>((set, get) => ({
  items: [],
  
  addItem: (item) => set((state) => {
    // Evitar duplicados exactos
    const exists = state.items.find((i) => i.id === item.id)
    if (exists) return state 
    return { items: [...state.items, item] }
  }),

  removeItem: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

  updateQuantity: (id, q) => set((state) => ({
    items: state.items.map((i) => i.id === id ? { ...i, quantity: q } : i)
  })),

  updateFoil: (id, isFoil) => set((state) => ({
    items: state.items.map((i) => i.id === id ? { ...i, isFoil } : i)
  })),

  // IMPLEMENTACIÓN DE setItems
  setItems: (items) => set({ items }),

  clearQuote: () => set({ items: [] }), 

  generateMessage: () => {
    const items = get().items
    if (!items.length) return ''
    return items.map(i => {
        const foilText = i.isFoil ? ' (FOIL)' : ''
        return `- ${i.quantity}x ${i.name}${foilText} (${i.setName} #${i.collectorNumber || '?'})`
    }).join('\n')
  }
}))