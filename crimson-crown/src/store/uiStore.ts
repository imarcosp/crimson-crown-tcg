import { create } from 'zustand'

type UIState = {
  isCartOpen: boolean
  isHangModalOpen: boolean
}

type UIActions = {
  toggleCart: () => void
  toggleHangModal: () => void
  closeAll: () => void
  openCart: () => void
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  isCartOpen: false,
  isHangModalOpen: false,
  toggleCart: () => set((s) => ({ isCartOpen: !s.isCartOpen })),
  toggleHangModal: () => set((s) => ({ isHangModalOpen: !s.isHangModalOpen })),
  closeAll: () => set({ isCartOpen: false, isHangModalOpen: false }),
  openCart: () => set({ isCartOpen: true }),
}))
