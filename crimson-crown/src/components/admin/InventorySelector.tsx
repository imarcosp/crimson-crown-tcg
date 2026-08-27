import { ChevronDown, Crown } from 'lucide-react'
import type { Inventory } from '@/app/actions/admin-inventories'

export default function InventorySelector({
  inventories,
  selectedId,
  onChange,
}: {
  inventories: Inventory[]
  selectedId: string
  onChange: (id: string) => void
}) {
  return (
    <label className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-amber-300">
        <Crown size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Inventario activo</span>
        <span className="relative block">
          <select
            value={selectedId}
            onChange={(event) => onChange(event.target.value)}
            className="w-full appearance-none bg-transparent pr-7 text-sm font-bold text-slate-800 outline-none"
          >
            {inventories.map((inventory) => (
              <option key={inventory.id} value={inventory.id} disabled={Boolean(inventory.archived_at)}>
                {inventory.name}{inventory.kind === 'primary' ? ' · Principal' : ''}
              </option>
            ))}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-0 top-0.5 text-slate-400" />
        </span>
      </span>
    </label>
  )
}
