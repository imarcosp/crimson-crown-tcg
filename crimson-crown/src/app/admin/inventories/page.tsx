'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Archive, BarChart3, Boxes, MapPin, Package, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import {
  archiveAdminInventory,
  createAdminInventory,
  deleteAdminInventory,
  getAdminInventories,
  setAdminInventoryActive,
  type Inventory,
} from '@/app/actions/admin-inventories'
import { createClient } from '@/lib/supabase/client'
import InventoryStatusBadge from '@/components/admin/InventoryStatusBadge'

type InventorySummary = Inventory & {
  units: number
  variants: number
  valuation: number
  reservedUnits: number
  soldUnits: number
  sales: number
  cancelledUnits: number
}

const EMPTY_FORM = { name: '', description: '', locationLabel: '' }

export default function AdminInventoriesPage() {
  const supabase = createClient()
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [summaries, setSummaries] = useState<InventorySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMessage('')
    const result = await getAdminInventories()
    if (!result.success) {
      setErrorMessage(result.error)
      setLoading(false)
      return
    }

    setInventories(result.data)
    const ids = result.data.map((inventory) => inventory.id)
    if (ids.length === 0) {
      setSummaries([])
      setLoading(false)
      return
    }

    const { data: metrics, error: metricsError } = await supabase.rpc('get_inventory_metrics', { inventory_id_input: null })

    if (metricsError) {
      setErrorMessage(metricsError.message || 'No se pudieron cargar los indicadores.')
      setLoading(false)
      return
    }

    const nextSummaries = result.data.map((inventory) => {
      const metric = (metrics || []).find((row: any) => String(row.inventory_id) === inventory.id)
      return {
        ...inventory,
        units: Number(metric?.available_units || 0),
        variants: Number(metric?.variant_count || 0),
        valuation: Number(metric?.stock_value || 0),
        reservedUnits: Number(metric?.reserved_units || 0),
        soldUnits: Number(metric?.sold_units || 0),
        sales: Number(metric?.sold_revenue || 0),
        cancelledUnits: Number(metric?.cancelled_units || 0),
      }
    })
    setSummaries(nextSummaries)
    setLoading(false)
  }, [supabase])

  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => summaries.reduce((acc, item) => ({
    units: acc.units + item.units,
    variants: acc.variants + item.variants,
    valuation: acc.valuation + item.valuation,
    sales: acc.sales + item.sales,
  }), { units: 0, variants: 0, valuation: 0, sales: 0 }), [summaries])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    const result = await createAdminInventory(form)
    setSaving(false)
    if (!result.success) {
      setErrorMessage(result.error)
      return
    }
    setForm(EMPTY_FORM)
    setShowCreate(false)
    await load()
  }

  const toggleActive = async (inventory: Inventory) => {
    if (inventory.kind === 'primary') return
    const nextState = !inventory.is_active
    const message = nextState
      ? `¿Reactivar ${inventory.name} para nuevas ventas?`
      : `¿Desactivar ${inventory.name}? Dejará de participar en nuevas ventas.`
    if (!window.confirm(message)) return
    setBusyId(inventory.id)
    const result = await setAdminInventoryActive(inventory.id, nextState)
    setBusyId(null)
    if (!result.success) setErrorMessage(result.error)
    else await load()
  }

  const archive = async (inventory: Inventory) => {
    if (inventory.kind === 'primary' || !window.confirm(`¿Archivar ${inventory.name}? Se conservarán sus métricas e historial.`)) return
    setBusyId(inventory.id)
    const result = await archiveAdminInventory(inventory.id)
    setBusyId(null)
    if (!result.success) setErrorMessage(result.error)
    else await load()
  }

  const remove = async (inventory: Inventory) => {
    if (inventory.kind === 'primary' || !window.confirm(`¿Eliminar definitivamente ${inventory.name}? Solo se permite si no tiene historial ni referencias.`)) return
    setBusyId(inventory.id)
    const result = await deleteAdminInventory(inventory.id)
    setBusyId(null)
    if (!result.success) setErrorMessage(result.error)
    else await load()
  }

  return (
    <div className="space-y-8 px-4 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#9D1B1B]"><Boxes size={15} /> Operación de stock</div>
          <h1 className="text-3xl font-black tracking-tight text-slate-950">Inventarios</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Administra fuentes de stock independientes. El catálogo puede unificarlas para el cliente, pero cada unidad conserva su origen.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-slate-950/10 transition hover:bg-slate-800">
          <Plus size={17} /> Nuevo inventario
        </button>
      </div>

      {errorMessage && <div className="flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{errorMessage}</span><button onClick={() => setErrorMessage('')} aria-label="Cerrar mensaje"><X size={16} /></button></div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Unidades disponibles', value: totals.units.toLocaleString(), Icon: Package },
          { label: 'Variantes', value: totals.variants.toLocaleString(), Icon: Boxes },
          { label: 'Valuación de stock', value: `US$ ${totals.valuation.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, Icon: BarChart3 },
          { label: 'Ventas registradas', value: `US$ ${totals.sales.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, Icon: ShieldCheck },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span><Icon size={17} className="text-slate-400" /></div>
            <div className="text-xl font-black text-slate-950">{loading ? '—' : value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold text-slate-900">Fuentes de inventario</h2><p className="mt-1 text-xs text-slate-500">El principal está protegido; los secundarios pueden pausarse o archivarse.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">{summaries.length} inventarios</span></div>
        <div className="divide-y divide-slate-100">
          {loading ? <div className="p-10 text-center text-sm text-slate-500">Cargando inventarios…</div> : summaries.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No hay inventarios disponibles.</div> : summaries.map((inventory) => (
            <div key={inventory.id} data-inventory-name={inventory.name} className="flex flex-col gap-5 px-5 py-5 transition hover:bg-slate-50/70 xl:flex-row xl:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${inventory.kind === 'primary' ? 'bg-slate-950 text-amber-300' : 'bg-blue-50 text-blue-700'}`}><Boxes size={22} /></div>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-bold text-slate-900">{inventory.name}</h3>{inventory.kind === 'primary' && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">Principal</span>}<InventoryStatusBadge active={inventory.is_active} archived={Boolean(inventory.archived_at)} /></div><p className="mt-1 max-w-md truncate text-sm text-slate-500">{inventory.description || 'Sin descripción operativa.'}</p>{inventory.location_label && <p className="mt-2 flex items-center gap-1 text-xs font-bold text-slate-400"><MapPin size={13} /> {inventory.location_label}</p>}</div>
              </div>
              <div className="grid grid-cols-3 gap-5 text-left sm:grid-cols-5 xl:w-[480px]">
                <div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Stock</div><div className="mt-1 font-black text-slate-900">{inventory.units.toLocaleString()}</div></div>
                <div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Variantes</div><div className="mt-1 font-black text-slate-900">{inventory.variants.toLocaleString()}</div></div>
                <div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Reservadas</div><div className="mt-1 font-black text-amber-700">{inventory.reservedUnits.toLocaleString()}</div></div>
                <div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vendidas</div><div className="mt-1 font-black text-slate-900">{inventory.soldUnits.toLocaleString()}</div></div>
                <div className="hidden sm:block"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Valuación</div><div className="mt-1 font-black text-slate-900">US$ {inventory.valuation.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div></div>
              </div>
              <div className="flex flex-wrap items-center gap-2 xl:justify-end"><Link href={`/admin/inventory?inventory=${inventory.id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100">Ver inventario</Link>{inventory.kind !== 'primary' && !inventory.archived_at && <button onClick={() => void toggleActive(inventory)} disabled={busyId === inventory.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50">{inventory.is_active ? 'Desactivar' : 'Activar'}</button>}{inventory.kind !== 'primary' && !inventory.archived_at && <button aria-label={`Archivar ${inventory.name}`} title={`Archivar ${inventory.name}`} onClick={() => void archive(inventory)} disabled={busyId === inventory.id} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-50 disabled:opacity-50"><Archive size={14} /></button>}{inventory.kind !== 'primary' && <button aria-label={`Eliminar ${inventory.name}`} title={`Eliminar ${inventory.name}`} onClick={() => void remove(inventory)} disabled={busyId === inventory.id} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} /></button>}</div>
            </div>
          ))}
        </div>
      </div>

      {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"><form role="dialog" aria-modal="true" aria-labelledby="new-inventory-title" onSubmit={create} className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6"><div className="mb-6 flex items-start justify-between gap-4"><div><h2 id="new-inventory-title" className="text-xl font-black text-slate-950">Nuevo inventario</h2><p className="mt-1 text-sm text-slate-500">La fuente se creará activa y empezará sin productos.</p></div><button type="button" aria-label="Cerrar nuevo inventario" onClick={() => setShowCreate(false)} className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 active:scale-[0.97]"><X size={18} /></button></div><div className="space-y-4"><label className="block text-sm font-bold text-slate-700">Nombre<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" placeholder="Ej. Inventario Japón" /></label><label className="block text-sm font-bold text-slate-700">Descripción<span className="font-normal text-slate-400"> (opcional)</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 h-20 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" placeholder="Origen o propósito del inventario" /></label><label className="block text-sm font-bold text-slate-700">Ubicación física<span className="font-normal text-slate-400"> (opcional)</span><input value={form.locationLabel} onChange={(event) => setForm({ ...form, locationLabel: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" placeholder="Ej. Estante B2" /></label></div><div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 active:scale-[0.98]">Cancelar</button><button disabled={saving} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 active:scale-[0.98]">{saving ? 'Creando…' : 'Crear inventario'}</button></div></form></div>}
    </div>
  )
}
