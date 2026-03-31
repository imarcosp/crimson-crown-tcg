"use client"
import { useCartStore } from '@/store/cartStore'

type Props = {
  productId: string
  maxStock: number
}

export default function QuantitySelector({ productId, maxStock }: Props) {
  const items = useCartStore((s) => s.items)
  const setItems = useCartStore.setState
  const item = items.find((i) => i.id === productId)
  const qty = item?.quantity ?? 0

  const dec = () => {
    if (!item) return
    if (qty <= 1) {
      setItems((state) => ({ items: state.items.filter((i) => i.id !== productId) }))
    } else {
      setItems((state) => ({ items: state.items.map((i) => (i.id === productId ? { ...i, quantity: i.quantity - 1 } : i)) }))
    }
  }
  const inc = () => {
    if (!item) return
    if (qty >= maxStock) return
    setItems((state) => ({ items: state.items.map((i) => (i.id === productId ? { ...i, quantity: i.quantity + 1 } : i)) }))
  }

  return (
    <div className="flex items-center justify-center gap-2 w-full max-[400px]:gap-1">
      <button onClick={dec} className="w-7 h-7 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 cursor-pointer text-base max-[400px]:w-6 max-[400px]:h-6 max-[400px]:text-xs">-</button>
      <span className="min-w-[20px] text-center font-bold text-sm max-[400px]:min-w-[16px] max-[400px]:text-xs">{qty}</span>
      <button onClick={inc} disabled={qty >= maxStock} className="w-7 h-7 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-50 cursor-pointer text-base max-[400px]:w-6 max-[400px]:h-6 max-[400px]:text-xs">+</button>
    </div>
  )
}
