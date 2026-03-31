'use client'
import { useEffect, useState, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateOrderStatus } from '@/app/actions/admin-orders'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, X, ZoomIn } from 'lucide-react'

export default function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const sp = useSearchParams()
  const supabase = createClient()
  const [order, setOrder] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  
  // Estados UI
  const [status, setStatus] = useState('')
  const [tracking, setTracking] = useState('')
  const [deliveryNotes, setDeliveryNotes] = useState('')
  const [showRefundPanel, setShowRefundPanel] = useState(false)
  const [showCancelPanel, setShowCancelPanel] = useState(false)
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  
  // Opciones
  const [refundMode, setRefundMode] = useState<'full_credits' | 'split' | 'manual'>('full_credits')
  const [restockOnRefund, setRestockOnRefund] = useState(true)
  const [restockOnCancel, setRestockOnCancel] = useState(true)
  const [refundCreditsOnCancel, setRefundCreditsOnCancel] = useState(true)

  useEffect(() => {
    const fetchOrder = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          profiles (email, first_name, last_name, phone),
          order_items (
            id,
            quantity,
            price_at_purchase,
            product_id,
            products (
              name,
              set_name,
              image_url,
              rarity,
              tcg,
              finish,
              language,
              condition,
              collector_number
            )
          )
        `)
        .eq('id', id)
        .single()

      if (error) {
        console.error("Error fetching order:", error)
        setErrorMsg(error.message)
      } else if (data) {
        setOrder(data)
        setStatus(data.status || '')
        setTracking(data.tracking_number || '')
        setDeliveryNotes(data.delivery_notes || '')
      }
      setLoading(false)
    }
    fetchOrder()
  }, [id, supabase])

  // CÁLCULOS
  const subtotal = (order?.order_items || []).reduce((sum: number, it: any) => {
    const unit = Number(it.price_at_purchase || 0)
    return sum + unit * Number(it.quantity || 0)
  }, 0)
  
  const discountAmount = Number(order?.discount_amount || 0)
  const creditsUsed = Number(order?.credits_used || 0)
  const totalReal = Math.max(0, subtotal - discountAmount)
  
  const cashPaid = Number(order?.total_amount) > 0 
      ? Number(order.total_amount) 
      : Math.max(0.0, totalReal - creditsUsed)
  
  const pendingLabel = (order?.status === 'completed' || order?.status === 'paid' || order?.status === 'shipped') ? 'Total Pagado' : 'Total a Pagar'

  // Datos Cliente
  const clientName = order?.profiles?.first_name 
      ? `${order.profiles.first_name} ${order.profiles.last_name || ''}`
      : `${order?.contact_name || ''} ${order?.contact_lastname || ''}`
  const clientEmail = order?.profiles?.email || 'Email no disponible'
  const clientPhone = order?.contact_phone || order?.profiles?.phone || ''

  // Acciones
  const saveStatus = async () => {
    if (order?.status === 'cancelled') return alert('Orden ya cancelada.')
    if (status === 'refunded') { setShowRefundPanel(true); return }
    if (status === 'cancelled') { setShowCancelPanel(true); return }
    
    setLoading(true)
    const res = await updateOrderStatus(id, status)
    setLoading(false)
    if (res?.success) { alert('Estado actualizado.'); setOrder({ ...order, status }) } 
    else alert('Error: ' + res?.error)
  }

  const handleConfirmCancellation = async () => {
    setLoading(true)
    try {
        if (creditsUsed > 0 && refundCreditsOnCancel) {
             const { error: err } = await supabase.rpc('manage_credits', {
                target_user_id: order.user_id,
                amount_change: creditsUsed,
                transaction_type: 'refund',
                transaction_desc: `Cancelación #${String(order.id).slice(0,8)}`,
                ref_id: order.id,
              })
              if (err) throw err
        }
        if (restockOnCancel) {
            const { error: err } = await supabase.rpc('restore_stock', { order_id_input: order.id })
            if (err) throw err
        }
        const { error: err } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
        if (err) throw err
        
        setOrder({ ...order, status: 'cancelled' })
        setShowCancelPanel(false)
        alert('Orden cancelada exitosamente.')
    } catch (e: any) { alert(e.message) } 
    finally { setLoading(false) }
  }

  const handleSaveRefund = async () => {
    try {
      if (restockOnRefund) {
        const { error: err } = await supabase.rpc('restore_stock', { order_id_input: order.id })
        if (err) throw err
      }
      if (refundMode === 'full_credits' || (refundMode === 'split' && creditsUsed > 0)) {
        let creditRefundAmount = 0
        if (refundMode === 'full_credits') creditRefundAmount = totalReal
        if (refundMode === 'split') creditRefundAmount = creditsUsed

        if (creditRefundAmount > 0) {
            const { error: err } = await supabase.rpc('manage_credits', {
              target_user_id: order.user_id,
              amount_change: creditRefundAmount,
              transaction_type: 'refund',
              transaction_desc: `Reembolso #${String(order.id).slice(0,8)}`,
              ref_id: order.id,
            })
            if (err) throw err
        }
      }
      const { error: err } = await supabase.from('orders').update({ status: 'refunded' }).eq('id', order.id)
      if (err) throw err
      setOrder({ ...order, status: 'refunded' })
      setShowRefundPanel(false)
      alert('Reembolso procesado.')
    } catch (e: any) { alert(e.message) }
  }

  const saveTracking = async () => {
    const { error } = await supabase.from('orders').update({ tracking_number: tracking }).eq('id', id)
    if (!error) setOrder({ ...order, tracking_number: tracking }); else alert('Error guardando tracking')
  }
  const saveDeliveryNotes = async () => {
    const { error } = await supabase.from('orders').update({ delivery_notes: deliveryNotes }).eq('id', id)
    if (!error) setOrder({ ...order, delivery_notes: deliveryNotes }); else alert('Error guardando notas')
  }

  const renderFinishBadge = (finish: string) => {
    const f = (finish || '').toLowerCase()
    if (f === 'foil') return <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200">FOIL</span>
    if (f === 'etched') return <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">ETCHED</span>
    return null
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Cargando...</div>
  if (errorMsg) return <div className="p-8 text-center"><div className="text-red-600 font-bold text-xl mb-2">Error cargando orden</div><div className="bg-red-50 p-4 rounded text-red-800 font-mono text-sm inline-block">{errorMsg}</div></div>
  if (!order) return <div className="p-8 text-center text-slate-500">Orden no encontrada</div>

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      
      {/* ZOOM MODAL */}
      {zoomedImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
             <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer z-50"><X size={32} /></button>
             <div className="relative w-full max-w-lg aspect-[3/4]">
                <img src={zoomedImage} alt="Zoom" className="w-full h-full object-contain rounded-lg" />
             </div>
        </div>
      )}

      {/* HEADER */}
      <div className="mb-6">
        <Link href={{ pathname: '/admin/orders', query: { status: sp.get('status') || undefined, hide: sp.get('hide') || undefined, page: sp.get('page') || undefined, search: sp.get('search') || undefined } }} className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-4">
            <ArrowLeft size={16}/> Volver al listado
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                Orden #{String(order.id).slice(0,8)}
                <span className={`text-xs px-2 py-1 rounded uppercase border ${order.status === 'paid' || order.status === 'completed' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : order.status === 'cancelled' ? 'bg-red-100 text-red-800 border-red-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>{order.status}</span>
            </h1>
            <p className="text-slate-600 text-sm">{new Date(order.created_at).toLocaleString()}</p>
            </div>
            <div className="flex items-center gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={order.status === 'cancelled' || order.status === 'refunded'} className="p-2 rounded-lg border text-sm font-bold bg-white focus:ring-2 focus:ring-slate-900 outline-none">
                {['pending_payment','paid','shipped','completed','cancelled','refunded'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={saveStatus} disabled={(order.status === 'cancelled' || order.status === 'refunded') || showRefundPanel || showCancelPanel} className="px-3 py-2 rounded bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-colors cursor-pointer">Actualizar Estado</button>
            </div>
        </div>
      </div>

      {/* PANELES DE ACCIÓN (Cancel/Refund) */}
      {showCancelPanel && (
        <div className="bg-red-50 border border-red-200 p-4 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2">
            <h3 className="font-bold text-red-900 text-lg">⚠️ Cancelar Orden</h3>
            <div className="flex flex-col gap-2 bg-white p-3 rounded border border-red-100">
                <label className="flex gap-3 cursor-pointer"><input type="checkbox" checked={restockOnCancel} onChange={e=>setRestockOnCancel(e.target.checked)} className="w-4 h-4 accent-red-600"/> <span className="text-sm font-medium">Devolver items al stock</span></label>
                {creditsUsed > 0 && <label className="flex gap-3 cursor-pointer"><input type="checkbox" checked={refundCreditsOnCancel} onChange={e=>setRefundCreditsOnCancel(e.target.checked)} className="w-4 h-4 accent-emerald-600"/> <span className="text-sm font-medium">Devolver Créditos (${creditsUsed})</span></label>}
            </div>
            <div className="flex gap-2">
                <button onClick={handleConfirmCancellation} className="px-4 py-2 bg-red-600 text-white rounded font-bold text-sm hover:bg-red-700 cursor-pointer">Confirmar Cancelación</button>
                <button onClick={()=>setShowCancelPanel(false)} className="px-4 py-2 bg-white border border-slate-300 rounded text-sm hover:bg-slate-50 cursor-pointer">Atrás</button>
            </div>
        </div>
      )}
      
      {showRefundPanel && (
        <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2">
            <h3 className="font-bold text-orange-900 text-lg">💸 Reembolsar Orden</h3>
            <div className="flex flex-col gap-2 bg-white p-3 rounded border border-orange-100">
                <div className="text-sm font-bold text-slate-700 mb-2">Método de Reembolso:</div>
                <label className="flex gap-2 cursor-pointer"><input type="radio" checked={refundMode==='full_credits'} onChange={()=>setRefundMode('full_credits')}/> <span className="text-sm">Todo a Créditos (US$ {totalReal.toFixed(2)})</span></label>
                {creditsUsed > 0 && <label className="flex gap-2 cursor-pointer"><input type="radio" checked={refundMode==='split'} onChange={()=>setRefundMode('split')}/> <span className="text-sm">Solo Créditos usados (US$ {creditsUsed.toFixed(2)}) + Manual el resto</span></label>}
                <label className="flex gap-2 cursor-pointer"><input type="radio" checked={refundMode==='manual'} onChange={()=>setRefundMode('manual')}/> <span className="text-sm">Reembolso Manual (Fuera del sistema)</span></label>
                
                <div className="border-t mt-2 pt-2">
                    <label className="flex gap-3 cursor-pointer"><input type="checkbox" checked={restockOnRefund} onChange={e=>setRestockOnRefund(e.target.checked)} className="w-4 h-4 accent-orange-600"/> <span className="text-sm font-medium">Devolver items al stock</span></label>
                </div>
            </div>
            <div className="flex gap-2">
                <button onClick={handleSaveRefund} className="px-4 py-2 bg-orange-600 text-white rounded font-bold text-sm hover:bg-orange-700 cursor-pointer">Procesar Reembolso</button>
                <button onClick={()=>setShowRefundPanel(false)} className="px-4 py-2 bg-white border border-slate-300 rounded text-sm hover:bg-slate-50 cursor-pointer">Cancelar</button>
            </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ITEMS */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase flex justify-between">
                <span>Productos</span>
                <span>Total</span>
            </div>
            {(order.order_items || []).map((it: any, idx: number) => {
               const unitP = Number(it.price_at_purchase || 0)
               const totalP = unitP * Number(it.quantity || 0)
               const prod = it.products || {}
               return (
                <div key={idx} className="flex gap-4 p-4 border-b last:border-0 items-center hover:bg-slate-50 transition-colors">
                    {/* IMAGEN CON ZOOM */}
                    <div 
                        className="w-12 h-16 bg-slate-100 relative shrink-0 rounded overflow-hidden border group cursor-zoom-in"
                        onClick={() => prod.image_url && setZoomedImage(prod.image_url)}
                    >
                        {prod.image_url && <img src={prod.image_url} alt="" className="w-full h-full object-cover"/>}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                            <ZoomIn className="text-white opacity-0 group-hover:opacity-100 drop-shadow-md" size={16}/>
                        </div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                            <span className="font-bold text-slate-800 text-sm truncate">{prod.name || 'Producto eliminado'}</span>
                            {renderFinishBadge(prod.finish)}
                        </div>
                        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-1">
                            {prod.set_name && <span>{prod.set_name}</span>}
                            {prod.collector_number && <span className="font-mono bg-slate-100 px-1.5 rounded text-slate-600">#{prod.collector_number}</span>}
                            {prod.language && <span className="bg-blue-50 text-blue-700 px-1.5 rounded uppercase font-bold border border-blue-100">{prod.language.substring(0,3)}</span>}
                            {prod.condition && <span className={`px-1.5 rounded font-bold border ${prod.condition === 'NM' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{prod.condition}</span>}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 font-mono">{it.quantity} x US$ {unitP.toFixed(2)}</div>
                    </div>
                    <div className="text-right font-bold text-slate-900">
                    US$ {totalP.toFixed(2)}
                    </div>
                </div>
               )
            })}
          </div>
        </div>

        {/* SIDEBAR (Cliente, Envío, Totales) */}
        <div className="space-y-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-3 text-sm uppercase tracking-wide">Datos del Cliente</h3>
                <div className="space-y-1">
                    <div className="text-lg font-bold text-slate-900">{clientName}</div>
                    <div className="text-sm text-slate-600 break-all">{clientEmail}</div>
                    {clientPhone && <div className="text-sm text-slate-500 mt-1">📞 {clientPhone}</div>}
                    <div className="text-xs text-slate-400 mt-2 pt-2 border-t">User ID: {order.user_id}</div>
                </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-3 text-sm uppercase tracking-wide">Envío / Entrega</h3>
                <div className="text-sm text-slate-700 mb-3">
                    <span className="font-bold">Método:</span> {order.delivery_method || 'No especificado'}
                </div>
                {order.shipping_address && (
                     <div className="text-sm text-slate-600 bg-slate-50 p-2 rounded mb-3 border">
                        {order.shipping_address.street} <br/>
                        {order.shipping_address.city}, {order.shipping_address.province} <br/>
                        CP: {order.shipping_address.zip}
                     </div>
                )}
                
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Tracking Number</label>
                        <div className="flex gap-2 mt-1">
                            <input value={tracking} onChange={e=>setTracking(e.target.value)} placeholder="Ej: AA123456789" className="border p-2 rounded flex-1 text-sm outline-none focus:ring-1 focus:ring-slate-900"/>
                            <button onClick={saveTracking} className="bg-slate-900 text-white px-3 rounded text-xs font-bold cursor-pointer">OK</button>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Notas Internas</label>
                        <textarea value={deliveryNotes} onChange={e=>setDeliveryNotes(e.target.value)} placeholder="Notas de entrega..." className="border p-2 rounded w-full text-sm h-20 mt-1 resize-none outline-none focus:ring-1 focus:ring-slate-900"/>
                        <div className="text-right mt-1"><button onClick={saveDeliveryNotes} className="text-xs text-blue-600 font-bold hover:underline cursor-pointer">Guardar Notas</button></div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-2 text-sm">
                <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
                {discountAmount > 0 && (
                    <div className="flex justify-between text-red-600 bg-red-50 p-1 rounded">
                        <span>Descuento ({order.coupon_code})</span>
                        <span>-${discountAmount.toFixed(2)}</span>
                    </div>
                )}
                <div className="flex justify-between font-bold text-slate-800 pt-1">
                    <span>Total Compra</span>
                    <span>${totalReal.toFixed(2)}</span>
                </div>
                {creditsUsed > 0 && (
                    <div className="flex justify-between text-emerald-600 pt-1">
                        <span>Pagado con Créditos</span>
                        <span>-${creditsUsed.toFixed(2)}</span>
                    </div>
                )}
                <div className="border-t border-dashed my-2"></div>
                <div className="flex justify-between items-end">
                    <span className="font-bold text-slate-600">{pendingLabel}</span>
                    <span className="font-extrabold text-2xl text-slate-900">${cashPaid.toFixed(2)}</span>
                </div>
                <div className="text-xs text-center text-slate-400 mt-2">Método Pago: {order.payment_method || 'No definido'}</div>
            </div>
        </div>
      </div>
    </div>
  )
}
