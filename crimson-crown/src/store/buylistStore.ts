import { create } from 'zustand'

interface SellItem {
  id: string
  name: string
  quantity: number
  marketPrice: number
  offerPrice: number
  baseOffer: number
  basePrice: number
  image?: string
  setName?: string
  collector_number?: string
  isFoil?: boolean
  condition?: 'NM' | 'EX' | 'VG' | 'G'
  availableFinishes?: string[]
  tcg?: string
  prices?: { NM: number; EX: number; VG: number; G: number }
  priceUsd?: number
  priceUsdFoil?: number
  foilLabel?: string
  promo_types?: string[]
  scryfall_id?: string
  source?: 'moxfield' | 'manual'
}

interface BuylistStore {
  sellItems: SellItem[]
  addItemToSell: (item: { id: string; name: string; price_usd: number; image_url?: string; set_name?: string; collector_number?: string; finish?: string; condition?: 'NM' | 'EX' | 'VG' | 'G'; finishes?: string[]; tcg?: string; prices?: { NM: number; EX: number; VG: number; G: number }; priceUsd?: number; priceUsdFoil?: number; foilLabel?: string; promo_types?: string[]; scryfall_id?: string; source?: 'moxfield' | 'manual' }) => void
  removeItem: (id: string) => void
  updateQuantity: (id: string, qty: number) => void
  toggleFoil: (id: string) => void
  updateCondition: (id: string, condition: 'NM' | 'EX' | 'VG' | 'G') => void
  clearBuylist: () => void
  getTotalOffer: () => number
}

export const useBuylistStore = create<BuylistStore>((set, get) => ({
  sellItems: [],
  addItemToSell: (item) => set((state) => {
    const existing = state.sellItems.find((i) => i.id === String(item.id))
    const refNonFoil = Number(item.priceUsd ?? item.price_usd ?? 0)
    const refFoil = Number(item.priceUsdFoil ?? 0)
    const isFoilInitial = item.finish === 'Foil' || item.finish === 'Holo'
    const refBase = isFoilInitial ? (refFoil > 0 ? refFoil : (refNonFoil > 0 ? refNonFoil * 2 : Number(item.price_usd || 0))) : refNonFoil
    const buildPrices = (b: number) => ({ NM: round(b * 1.0), EX: round(b * 0.85), VG: round(b * 0.75), G: round(b * 0.6) })
    const defaultPrices = item.prices || buildPrices(refBase)
    const initialCondition: 'NM' | 'EX' | 'VG' | 'G' = item.condition || 'NM'
    const base = Number(defaultPrices[initialCondition] || 0)
    const market = base
    const offer = round(market * 0.75)
    const setName = item.set_name || undefined
    const isFoil = isFoilInitial
    const condition = initialCondition
    const availableFinishes = Array.isArray(item.finishes) && item.finishes.length ? item.finishes : (isFoil ? ['foil'] : ['nonfoil'])
    if (existing) {
      return { sellItems: state.sellItems.map((i) => (i.id === String(item.id) ? { ...i, quantity: i.quantity + 1 } : i)) }
    }
    return {
      sellItems: [
        ...state.sellItems,
        { id: String(item.id), name: item.name, quantity: 1, marketPrice: market, offerPrice: offer, baseOffer: offer, basePrice: market, image: item.image_url, setName, collector_number: item.collector_number, isFoil, condition, availableFinishes, tcg: item.tcg, prices: defaultPrices, priceUsd: refNonFoil, priceUsdFoil: refFoil, foilLabel: item.foilLabel, promo_types: item.promo_types, scryfall_id: item.scryfall_id, source: item.source },
      ],
    }
  }),
  removeItem: (id) => set((state) => ({ sellItems: state.sellItems.filter((i) => i.id !== id) })),
  updateQuantity: (id, qty) => set((state) => ({ sellItems: state.sellItems.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, qty) } : i)) })),
  toggleFoil: (id) => set((state) => ({
    sellItems: state.sellItems.map((i) => {
      if (i.id !== id) return i
      const nextFoil = !Boolean(i.isFoil)
      const refNonFoil = Number(i.priceUsd || 0)
      const refFoil = Number(i.priceUsdFoil || 0)
      const refBase = nextFoil ? (refFoil > 0 ? refFoil : (refNonFoil > 0 ? refNonFoil * 2 : i.basePrice * 2)) : (refNonFoil > 0 ? refNonFoil : (refFoil > 0 ? refFoil / 2 : i.basePrice))
      const newPrices = { NM: round(refBase * 1.0), EX: round(refBase * 0.85), VG: round(refBase * 0.75), G: round(refBase * 0.6) }
      const base = Number(newPrices[i.condition || 'NM'] || 0)
      const nextMarket = base
      const nextOffer = round(nextMarket * 0.75)
      return { ...i, isFoil: nextFoil, prices: newPrices, basePrice: base, marketPrice: nextMarket, offerPrice: nextOffer, baseOffer: round(base * 0.75) }
    })
  })),
  updateCondition: (id, condition) => set((state) => ({
    sellItems: state.sellItems.map((i) => {
      if (i.id !== id) return i
      const refNonFoil = Number(i.priceUsd || 0)
      const refFoil = Number(i.priceUsdFoil || 0)
      const refBase = i.isFoil ? (refFoil > 0 ? refFoil : (refNonFoil > 0 ? refNonFoil * 2 : i.basePrice)) : (refNonFoil > 0 ? refNonFoil : (refFoil > 0 ? refFoil / 2 : i.basePrice))
      const newPrices = { NM: round(refBase * 1.0), EX: round(refBase * 0.85), VG: round(refBase * 0.75), G: round(refBase * 0.6) }
      const base = Number(newPrices[condition] || 0)
      const nextMarket = base
      const nextOffer = round(nextMarket * 0.75)
      return { ...i, condition, prices: newPrices, basePrice: base, marketPrice: nextMarket, offerPrice: nextOffer, baseOffer: round(base * 0.75) }
    })
  })),
  clearBuylist: () => set({ sellItems: [] }),
  getTotalOffer: () => get().sellItems.reduce((acc, i) => acc + (i.offerPrice || 0) * i.quantity, 0),
}))

function round(n: number) { return Math.round(n * 100) / 100 }
