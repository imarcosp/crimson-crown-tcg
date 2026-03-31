import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { createClient } from '@/lib/supabase/client'

interface CartItem {
  id: string
  name: string
  price: number
  quantity: number
  image: string
  maxStock?: number
  // Campos opcionales para visualización
  isFoil?: boolean
  setName?: string
  condition?: string
}

interface CartStore {
  items: CartItem[]
  savedItems: CartItem[] // Nueva lista
  discount: { code: string, type: 'percentage' | 'fixed', value: number } | null
  
  addItem: (product: any) => void
  removeItem: (id: string) => void
  clearCart: () => void
  
  // Acciones Guardar para Después
  saveForLater: (id: string) => void
  moveToCart: (id: string) => void
  removeSaved: (id: string) => void
  setSavedItems: (items: CartItem[]) => void // Para cargar desde DB al iniciar
  
  total: () => number
  applyDiscount: (payload: { code: string, amount: number }) => void
  clearDiscount: () => void
  applyCoupon: (coupon: { code: string, type: 'percentage' | 'fixed', value: number }) => void
  removeCoupon: () => void
  getSubtotal: () => number
  getDiscountAmount: () => number
  getTotal: () => number
}

// Helper para sincronizar con DB
const syncSavedToDB = async (item: CartItem, action: 'add' | 'remove') => {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return // Si no hay usuario, solo persiste en local

  if (action === 'add') {
    await supabase.from('saved_items').upsert({ user_id: user.id, product_id: item.id }, { onConflict: 'user_id, product_id' })
  } else {
    await supabase.from('saved_items').delete().match({ user_id: user.id, product_id: item.id })
  }
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      savedItems: [],
      discount: null,

      addItem: (product) => set((state) => {
        const existing = state.items.find((i) => i.id === product.id)
        if (existing) {
          const limit = existing.maxStock ?? product.stock ?? Infinity
          if (existing.quantity >= limit) return { items: state.items }
          return {
            items: state.items.map((i) => (i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)),
          }
        }
        return {
          items: [
            ...state.items,
            {
              id: product.id,
              name: product.name,
              price: product.priceUsd || product.price,
              quantity: 1,
              image: product.imageUrl ?? product.image ?? '',
              maxStock: product.stock,
              isFoil: product.isFoil,
              setName: product.setName,
              condition: product.condition
            },
          ],
        }
      }),

      removeItem: (id) => set((state) => {
        const existing = state.items.find((i) => i.id === id)
        if (!existing) return { items: state.items, discount: state.discount }
        if (existing.quantity <= 1) {
          const newItems = state.items.filter((i) => i.id !== id)
          return { items: newItems, discount: newItems.length === 0 ? null : state.discount }
        }
        const newItems = state.items.map((i) => (i.id === id ? { ...i, quantity: i.quantity - 1 } : i))
        return { items: newItems, discount: newItems.length === 0 ? null : state.discount }
      }),

      clearCart: () => set({ items: [], discount: null }),

      // LÓGICA GUARDAR PARA DESPUÉS
      saveForLater: (id) => {
        const state = get()
        const itemToSave = state.items.find((i) => i.id === id)
        if (!itemToSave) return

        // 1. Quitar del carrito
        const newCart = state.items.filter((i) => i.id !== id)
        
        // 2. Agregar a guardados (evitar duplicados)
        const alreadySaved = state.savedItems.find((i) => i.id === id)
        const newSaved = alreadySaved ? state.savedItems : [...state.savedItems, itemToSave]

        set({ items: newCart, savedItems: newSaved })
        
        // 3. Sync DB
        syncSavedToDB(itemToSave, 'add')
      },

      moveToCart: (id) => {
        const state = get()
        const itemToMove = state.savedItems.find((i) => i.id === id)
        if (!itemToMove) return

        // 1. Quitar de guardados
        const newSaved = state.savedItems.filter((i) => i.id !== id)

        // 2. Agregar a carrito
        const existingInCart = state.items.find((i) => i.id === id)
        let newCart
        if (existingInCart) {
            newCart = state.items.map(i => i.id === id ? { ...i, quantity: i.quantity + 1 } : i)
        } else {
            newCart = [...state.items, itemToMove]
        }

        set({ savedItems: newSaved, items: newCart })
        syncSavedToDB(itemToMove, 'remove') // Ya no está "guardado", está en carrito
      },

      removeSaved: (id) => {
        const state = get()
        const item = state.savedItems.find(i => i.id === id)
        set({ savedItems: state.savedItems.filter((i) => i.id !== id) })
        if (item) syncSavedToDB(item, 'remove')
      },

      setSavedItems: (items) => set({ savedItems: items }),

      // Cálculos
      total: () => get().items.reduce((acc, item) => acc + item.price * item.quantity, 0),
      applyDiscount: (payload) => set({ discount: { code: payload.code, type: 'fixed', value: payload.amount } }),
      clearDiscount: () => set({ discount: null }),
      applyCoupon: (coupon) => set({ discount: coupon }),
      removeCoupon: () => set({ discount: null }),
      getSubtotal: () => get().items.reduce((acc, item) => acc + item.price * item.quantity, 0),
      getDiscountAmount: () => {
        const d = get().discount
        if (!d) return 0
        const subtotal = get().getSubtotal()
        if (d.type === 'fixed') return Math.min(d.value, subtotal)
        if (d.type === 'percentage') return Math.round((subtotal * (d.value / 100)) * 100) / 100
        return 0
      },
      getTotal: () => {
        const sub = get().getSubtotal()
        const disc = get().getDiscountAmount()
        return Math.max(0, sub - disc)
      },
    }),
    {
      name: 'cart-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)