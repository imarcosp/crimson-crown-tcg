import { CheckCircle2, Archive, PauseCircle } from 'lucide-react'

export default function InventoryStatusBadge({
  active,
  archived = false,
}: {
  active: boolean
  archived?: boolean
}) {
  if (archived) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
        <Archive size={13} /> Archivado
      </span>
    )
  }

  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
      <CheckCircle2 size={13} /> Activo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
      <PauseCircle size={13} /> Inactivo
    </span>
  )
}
