"use client"
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function OrderRow({ order, customer, onUpdated }: { order: any, customer: string, onUpdated: () => void }) {
  const supabase = createClient()
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState(order.status || 'pending_payment')
  const [tracking, setTracking] = useState(order.tracking_number || '')
  const [saving, setSaving] = useState(false)

  const saveStatus = async (newStatus: string) => {
    if (newStatus === 'shipped' && !tracking) { alert('Agrega tracking antes de marcar como enviado'); return }
    setSaving(true)
    const { error } = await supabase.from('orders').update({ status: newStatus }).eq('id', order.id)
    setSaving(false)
    if (!error) { setStatus(newStatus); alert('Estado actualizado'); onUpdated() } else { alert(error.message) }
  }

  const saveTracking = async () => {
    setSaving(true)
    const { error } = await supabase.from('orders').update({ tracking_number: tracking }).eq('id', order.id)
    setSaving(false)
    if (!error) { alert('Tracking guardado'); onUpdated() } else { alert(error.message) }
  }

  return (
    <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-slate-200 text-sm items-center">
      <div className="col-span-2 font-mono">{String(order.id).slice(0, 8)}</div>
      <div className="col-span-2">{new Date(order.created_at).toLocaleString()}</div>
      <div className="col-span-2">
        <div className="truncate" title={customer}>{customer || '—'}</div>
      </div>
      <div className="col-span-1 font-bold text-[#9D1B1B]">US$ {(order.total_amount || 0).toFixed(2)}</div>
      <div className="col-span-2">
        <select value={status} onChange={(e) => saveStatus(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
          <option value="pending_payment">pending_payment</option>
          <option value="paid">paid</option>
          <option value="shipped">shipped</option>
          <option value="completed">completed</option>
          <option value="cancelled">cancelled</option>
        </select>
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Código" className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm" />
        <button onClick={saveTracking} disabled={saving} className="rounded bg-slate-800 text-white px-3 py-1 text-xs font-bold disabled:opacity-50">Guardar</button>
      </div>
      <div className="col-span-1">
        <button onClick={() => setExpanded((v) => !v)} className="rounded bg-slate-100 px-2 py-1 text-xs font-bold">Ver Detalle</button>
      </div>
      {expanded && (
        <div className="col-span-12 mt-3">
          <div className="bg-slate-50 rounded p-3 grid gap-2">
            {(order.order_items || []).map((it: any, idx: number) => (
              <div key={idx} className="flex items-center gap-3">
                <div className="h-12 w-9 rounded bg-slate-200 overflow-hidden relative">
                  {it.products?.image_url && (<img src={it.products.image_url} alt="" className="h-full w-full object-cover" />)}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-900">{it.products?.name || 'Producto'}</div>
                  <div className="text-xs text-slate-600">x{it.quantity}</div>
                </div>
                <div className="text-sm font-bold text-[#9D1B1B]">US$ {(it.price_at_purchase || 0).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
