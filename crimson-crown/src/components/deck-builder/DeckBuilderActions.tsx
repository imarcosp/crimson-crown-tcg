'use client'

import { useState, useSyncExternalStore } from 'react'
import { Check, Plane, ShoppingCart } from 'lucide-react'

import { useCartStore } from '@/store/cartStore'
import { useQuoteStore } from '@/store/quoteStore'
import { useUIStore } from '@/store/uiStore'
import type { EnrichedDeckBuilderCard } from '@/lib/deck-builder/catalog'

type ActionCard = EnrichedDeckBuilderCard

function addLocalCopies(card: ActionCard, addItem: ReturnType<typeof useCartStore.getState>['addItem']) {
  if (!card.localProduct) return 0
  const quantity = Math.min(card.quantity, card.availableLocalQuantity)
  const product = {
    id: card.localProduct.id,
    name: card.localProduct.name,
    price: Number(card.localProduct.price_usd || 0),
    image: card.localProduct.image_url || '',
    stock: Number(card.localProduct.stock || quantity),
    setName: card.localProduct.set_name || '',
    condition: card.localProduct.condition || '',
  }
  for (let index = 0; index < quantity; index += 1) addItem(product)
  return quantity
}

function addMissingCopies(
  card: ActionCard,
  addQuoteItem: ReturnType<typeof useQuoteStore.getState>['addItem'],
  updateQuoteQuantity: ReturnType<typeof useQuoteStore.getState>['updateQuantity'],
  currentItems: ReturnType<typeof useQuoteStore.getState>['items'],
) {
  const missingQuantity = Math.max(0, card.quantity - card.availableLocalQuantity)
  if (!card.importSuggestion || missingQuantity === 0) return 0
  const suggestion = card.importSuggestion
  const id = `deck-builder:${suggestion.scryfall_id || card.name.toLocaleLowerCase('en-US')}`
  const existing = currentItems.find((item) => item.id === id)
  if (existing) {
    updateQuoteQuantity(id, existing.quantity + missingQuantity)
  } else {
    addQuoteItem({
      id,
      name: card.name,
      price: Number(suggestion.price || suggestion.priceUsd || suggestion.price_usd || 0),
      image: suggestion.image_url || '',
      setName: suggestion.set_name || '',
      collectorNumber: suggestion.collector_number || '',
      quantity: missingQuantity,
      isFoil: false,
      foilLocked: false,
    })
  }
  return missingQuantity
}

export function DeckBuilderCardActions({ card }: { card: ActionCard }) {
  const addItem = useCartStore((state) => state.addItem)
  const addQuoteItem = useQuoteStore((state) => state.addItem)
  const updateQuoteQuantity = useQuoteStore((state) => state.updateQuantity)
  const quoteItems = useQuoteStore((state) => state.items)
  const toggleCart = useUIStore((state) => state.toggleCart)
  const toggleHangModal = useUIStore((state) => state.toggleHangModal)
  const [feedback, setFeedback] = useState<string | null>(null)
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false)
  const localQuantity = Math.min(card.quantity, card.availableLocalQuantity)
  const missingQuantity = Math.max(0, card.quantity - card.availableLocalQuantity)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {localQuantity > 0 && card.localProduct && (
        <button
          type="button"
          disabled={!hydrated}
          onClick={() => {
            const added = addLocalCopies(card, addItem)
            setFeedback(`${added} ${added === 1 ? 'copia agregada' : 'copias agregadas'}`)
            toggleCart()
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#9D1B1B] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#7f1515] disabled:cursor-wait disabled:opacity-60"
        >
          <ShoppingCart size={14} /> Agregar {localQuantity}
        </button>
      )}
      {missingQuantity > 0 && card.importSuggestion && (
        <button
          type="button"
          disabled={!hydrated}
          onClick={() => {
            const added = addMissingCopies(card, addQuoteItem, updateQuoteQuantity, quoteItems)
            setFeedback(`${added} ${added === 1 ? 'copia enviada' : 'copias enviadas'} a cotización`)
            toggleHangModal()
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-[#9D1B1B] hover:text-[#9D1B1B] disabled:cursor-wait disabled:opacity-60"
        >
          <Plane size={14} /> Cotizar {missingQuantity}
        </button>
      )}
      {feedback && <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check size={13} />{feedback}</span>}
    </div>
  )
}

export function DeckBuilderBulkActions({ cards }: { cards: ActionCard[] }) {
  const addItem = useCartStore((state) => state.addItem)
  const addQuoteItem = useQuoteStore((state) => state.addItem)
  const updateQuoteQuantity = useQuoteStore((state) => state.updateQuantity)
  const quoteItems = useQuoteStore((state) => state.items)
  const toggleCart = useUIStore((state) => state.toggleCart)
  const toggleHangModal = useUIStore((state) => state.toggleHangModal)
  const [feedback, setFeedback] = useState<string | null>(null)
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false)
  const localCopies = cards.reduce((total, card) => total + Math.min(card.quantity, card.availableLocalQuantity), 0)
  const quotableCopies = cards.reduce((total, card) => total + (card.importSuggestion ? Math.max(0, card.quantity - card.availableLocalQuantity) : 0), 0)

  return (
    <div className="flex flex-wrap items-center gap-3">
      {localCopies > 0 && (
        <button
          type="button"
          disabled={!hydrated}
          onClick={() => {
            const added = cards.reduce((total, card) => total + addLocalCopies(card, addItem), 0)
            setFeedback(`${added} copias locales agregadas`)
            toggleCart()
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-[#9D1B1B] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#7f1515] disabled:cursor-wait disabled:opacity-60"
        >
          <ShoppingCart size={17} /> Agregar disponibles ({localCopies})
        </button>
      )}
      {quotableCopies > 0 && (
        <button
          type="button"
          disabled={!hydrated}
          onClick={() => {
            let added = 0
            let currentItems = quoteItems
            for (const card of cards) {
              added += addMissingCopies(card, addQuoteItem, updateQuoteQuantity, currentItems)
              currentItems = useQuoteStore.getState().items
            }
            setFeedback(`${added} copias enviadas a cotización`)
            toggleHangModal()
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-[#9D1B1B] hover:text-[#9D1B1B] disabled:cursor-wait disabled:opacity-60"
        >
          <Plane size={17} /> Cotizar faltantes ({quotableCopies})
        </button>
      )}
      {feedback && <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700"><Check size={15} />{feedback}</span>}
    </div>
  )
}
