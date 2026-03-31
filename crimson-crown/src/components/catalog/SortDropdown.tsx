"use client"
import { useStore } from '@/store/useStore'

export default function SortDropdown() {
  const sort = useStore((s) => s.sort)
  const setSort = useStore((s) => s.setSort)
  return (
    <select
      value={sort}
      onChange={(e) => setSort(e.target.value as any)}
      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
      aria-label="Ordenar"
    >
      <option value="priceAsc">Menor Precio</option>
      <option value="priceDesc">Mayor Precio</option>
      <option value="relevance">Relevancia</option>
    </select>
  )
}
