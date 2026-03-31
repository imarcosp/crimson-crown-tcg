'use client'
import { useEffect, useState, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Trash2, X, ZoomIn } from 'lucide-react'

export default function AdminBuylistDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const supabase = createClient()
  const router = useRouter()
  const [order, setOrder] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<any[]>([])
  const [loadingAction, setLoadingAction] = useState(false)
  
  // Estado Zoom
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)

  useEffect(() => {
    const fetchOrder = async () => {
      const { data, error } = await supabase
        .from('buylist_orders')
        .select(`
          *,
          profiles (email, first_name, last_name, phone),
          buylist_items (
            id, product_id, quantity, offered_price_unit, condition, is_foil,
            notes, card_name, set_name, image_url, collector_number
          )
        `)
        .eq('id', id)
        .single()
      
      if (error) {
        alert('Error cargando orden: ' + error.message)
      } else {
        setOrder(data)
        setItems((data?.buylist_items || []).map((i: any) => ({ ...i })))
      }
      setLoading(false)
    }
    fetchOrder()
  }, [id, supabase])

  const total = items.reduce((acc: number, i: any) => acc + Number(i.offered_price_unit || 0) * Number(i.quantity || 0), 0)

  const updateItem = (idx: number, patch: Partial<any>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  // 8.2 ELIMINAR ITEM
  const deleteItem = async (itemId: number, idx: number) => {
      if(!confirm('¿Eliminar esta carta de la solicitud?')) return
      
      // Eliminamos de la base de datos
      const { error } = await supabase.from('buylist_items').delete().eq('id', itemId)
      
      if (error) {
          alert('Error al eliminar: ' + error.message)
      } else {
          // Actualizamos estado local para que desaparezca y recalcule total
          setItems(prev => prev.filter((_, i) => i !== idx))
      }
  }

  const handleSendCounterOffer = async () => {
    setLoadingAction(true)
    try {
      // 1. Guardar cambios en items (precios, condición)
      await Promise.all(items.map((item) => supabase
        .from('buylist_items')
        .update({
          offered_price_unit: Number(item.offered_price_unit || 0),
          condition: item.condition || 'NM',
          is_foil: Boolean(item.is_foil || false),
        })
        .eq('id', item.id)
      ))
      
      // 2. Actualizar Cabecera
      const newTotal = items.reduce((sum, i) => sum + (Number(i.offered_price_unit || 0) * Number(i.quantity || 0)), 0)
      const { error: hdrErr } = await supabase
        .from('buylist_orders')
        .update({ total_offered: newTotal, status: 'waiting_user_approval' })
        .eq('id', id)
      
      if (hdrErr) throw hdrErr

      // 3. Notificación (TODO: Conectar con Email)
      alert('✅ Contraoferta enviada. El usuario ha sido notificado (Simulado).')
      router.refresh()
    } catch (e: any) {
      alert('Error enviando oferta: ' + e.message)
    } finally {
      setLoadingAction(false)
    }
  }

  const approve = async () => {
    if (!order) return
    if (!window.confirm('¿Aprobar y acreditar créditos al usuario?')) return
    const { error } = await supabase.rpc('approve_buylist_transaction', { buylist_id_input: id, amount_to_credit: total })
    if (error) {
      alert('Error al aprobar: ' + error.message)
    } else {
      alert('✅ Transacción aprobada y créditos acreditados.')
      setOrder({ ...order, status: 'completed' })
      router.refresh()
    }
  }

  const reject = async () => {
    if (!order) return
    if (!window.confirm('¿Rechazar esta solicitud?')) return
    const { error } = await supabase.from('buylist_orders').update({ status: 'rejected' }).eq('id', id)
    if (error) {
      alert('Error al rechazar: ' + error.message)
    } else {
      alert('Solicitud rechazada.')
      setOrder({ ...order, status: 'rejected' })
      router.refresh()
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Cargando detalles...</div>
  if (!order) return <div className="p-8 text-center text-red-500">Orden no encontrada</div>

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      
      {/* MODAL ZOOM */}
      {zoomedImage && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
             <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer"><X size={32} /></button>
             <img src={zoomedImage} alt="Zoom" className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" />
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-800 flex flex-wrap items-center gap-2 mb-4">
            Solicitud <span className="font-mono text-slate-500">#{String(order.id || '').slice(0,8)}</span>
          </h1>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
                <span className="text-slate-500 w-16">Usuario:</span>
                <span className="font-bold text-slate-900">
                    {[order.profiles?.first_name, order.profiles?.last_name].filter(Boolean).join(' ') || 'Sin nombre registrado'}
                </span>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-slate-500 w-16">Email:</span>
                <span className="text-slate-700">{order.profiles?.email || order.user_id}</span>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-slate-500 w-16">Teléfono:</span>
                <span className="text-slate-700">{order.profiles?.phone || 'No especificado'}</span>
            </div>
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
                <span className="text-slate-500 w-16">Fecha:</span>
                <span className="text-slate-700">{new Date(order.created_at).toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="self-end md:self-start mt-4 md:mt-0">
          <span className={`px-4 py-2 rounded-full text-sm font-bold border ${
            order.status === 'completed' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
            order.status === 'rejected' ? 'bg-red-100 text-red-800 border-red-200' :
            'bg-amber-100 text-amber-800 border-amber-200'
          }`}>
            {order.status === 'pending_review' ? 'En Revisión' : 
             order.status === 'waiting_user_approval' ? 'Esperando Usuario' :
             order.status === 'completed' ? 'Completada' : 
             order.status === 'rejected' ? 'Rechazada' : order.status}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="overflow-x-auto w-full">
            <table className="w-full text-sm text-left whitespace-nowrap min-w-[600px]">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-xs">
                <tr>
                <th className="px-4 py-3">Img</th>
                <th className="px-4 py-3">Carta</th>
                <th className="px-4 py-3">Foil</th>
                <th className="px-4 py-3">Condición</th>
                <th className="px-4 py-3 text-right">Precio Oferta</th>
                <th className="px-4 py-3 text-center">Cant.</th>
                <th className="px-4 py-3 text-center">Acción</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {items.map((i: any, idx: number) => (
                <tr key={`${i.product_id}-${idx}`} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                        {/* 8.1 ZOOM IMAGEN */}
                        <div 
                            className="w-10 h-14 bg-slate-200 rounded overflow-hidden relative border border-slate-200 cursor-zoom-in group/img"
                            onClick={() => i.image_url && setZoomedImage(i.image_url)}
                        >
                            {i.image_url ? (
                                <>
                                    <img src={i.image_url} alt="" className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                                        <ZoomIn className="text-white drop-shadow-md" size={16} />
                                    </div>
                                </>
                            ) : <div className="w-full h-full flex items-center justify-center text-[8px] text-slate-400">Sin img</div>}
                        </div>
                    </td>
                    <td className="px-4 py-3">
                        <div className="text-slate-800 font-bold text-sm" title={i.card_name}>
                            {i.card_name || i.notes || 'Carta desconocida'}
                        </div>
                        <div className="text-xs text-slate-500">
                            {i.set_name} {i.collector_number ? `#${i.collector_number}` : ''}
                        </div>
                    </td>
                    <td className="px-4 py-3">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                            <input type="checkbox" checked={Boolean(i.is_foil)} onChange={() => updateItem(idx, { is_foil: !Boolean(i.is_foil) })} className="rounded text-purple-600 focus:ring-purple-500" /> 
                            <span className={i.is_foil ? "text-purple-700 font-bold" : "text-slate-500"}>{i.is_foil ? 'Sí' : 'No'}</span>
                        </label>
                    </td>
                    <td className="px-4 py-3">
                        <select value={i.condition || 'NM'} onChange={(e) => updateItem(idx, { condition: e.target.value })} className="border border-slate-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-slate-900 outline-none bg-white cursor-pointer">
                            <option value="NM">NM</option>
                            <option value="EX">EX</option>
                            <option value="VG">VG</option>
                            <option value="G">G</option>
                            <option value="HP">HP</option>
                            <option value="DMG">DMG</option>
                        </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                        <input 
                            type="number" step="0.01" 
                            value={Number(i.offered_price_unit || 0)} 
                            onChange={(e) => updateItem(idx, { offered_price_unit: Number(e.target.value || 0) })} 
                            className="border border-slate-300 rounded px-2 py-1 w-24 text-right text-xs font-mono font-bold focus:ring-1 focus:ring-emerald-500 outline-none text-emerald-700" 
                        />
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-900">
                        {i.quantity}
                    </td>
                    <td className="px-4 py-3 text-center">
                        <button 
                            onClick={() => deleteItem(i.id, idx)}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            title="Eliminar ítem"
                        >
                            <Trash2 size={18}/>
                        </button>
                    </td>
                </tr>
                ))}
            </tbody>
            </table>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-200">
        <div className="text-slate-700 text-lg">
           Total a Pagar: <span className="font-extrabold text-slate-900 text-2xl ml-2">US$ {Number(total || 0).toFixed(2)}</span>
        </div>
        <div className="flex flex-wrap justify-center gap-2 w-full sm:w-auto">
          {order.status !== 'completed' && order.status !== 'rejected' && (
            <>
                <button onClick={handleSendCounterOffer} disabled={loadingAction} className="px-4 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-sm font-bold hover:bg-slate-50 shadow-sm flex-1 sm:flex-none cursor-pointer">
                  {loadingAction ? 'Enviando...' : '📝 Enviar Contraoferta'}
                </button>
                <button onClick={reject} className="px-4 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm font-bold hover:bg-red-100 flex-1 sm:flex-none cursor-pointer">
                  Rechazar
                </button>
                <button onClick={approve} className="px-6 py-2 rounded-lg bg-[#0F172A] text-white text-sm font-bold hover:bg-slate-900 shadow-md w-full sm:w-auto cursor-pointer">
                  ✅ Aprobar y Pagar
                </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}