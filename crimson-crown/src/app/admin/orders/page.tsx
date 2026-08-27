'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Save, Eye, Trash2, PackageCheck, Package, Search, Filter, ArrowLeft, ArrowRight, X, FileText, Check } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { cancelOrder } from '@/app/actions/admin-order-fulfillment'

// ... (Resto de imports y constantes igual) ...
const ITEMS_PER_PAGE = 20

interface Order {
  id: string
  created_at: string
  total_amount: number
  status: string
  tracking_number: string | null
  delivery_notes: string | null
  user_id: string
  credits_used?: number
  is_packed: boolean
  payment_proof_url?: string
  contact_name?: string
  contact_lastname?: string
  profiles?: { email: string, first_name?: string, last_name?: string }
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [proofImage, setProofImage] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [hideCompleted, setHideCompleted] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const abortControllerRef = useRef<AbortController | null>(null)
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({})
  
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  // ... (Efectos y lógica de fetch igual) ...
  useEffect(() => {
    const spStatus = searchParams?.get('status') || ''
    const spHide = searchParams?.get('hide')
    const spPage = Number(searchParams?.get('page') || '1')
    const spSearch = searchParams?.get('search') || ''
    if (spStatus) setStatusFilter(spStatus)
    if (spHide != null) setHideCompleted(spHide === '1')
    if (spPage && spPage > 0) setPage(spPage)
    if (spSearch) setSearchTerm(spSearch)
    
    if (!spStatus) {
      try {
        const raw = localStorage.getItem('admin_orders_filters')
        if (raw) {
          const j = JSON.parse(raw)
          if (j.status) setStatusFilter(j.status)
          if (j.hideCompleted != null) setHideCompleted(!!j.hideCompleted)
          if (j.search) setSearchTerm(String(j.search))
        }
      } catch {}
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('admin_orders_filters', JSON.stringify({ status: statusFilter, hideCompleted, search: searchTerm }))
    } catch {}
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    params.set('hide', hideCompleted ? '1' : '0')
    if (searchTerm) params.set('search', searchTerm)
    params.set('page', String(page))
    router.replace(`${pathname}?${params.toString()}`)
  }, [statusFilter, hideCompleted, searchTerm, page, router, pathname])

  const fetchOrders = useCallback(async () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setLoading(true)
    
    try {
      let query = supabase
        .from('orders')
        .select(`
            *,
            profiles (email, first_name, last_name)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })

      if (statusFilter) query = query.eq('status', statusFilter)
      if (hideCompleted) query = query.not('status', 'in', '("completed","refunded","cancelled")')

      const term = searchTerm.trim()
      if (term.length >= 2) {
         // Lógica de búsqueda mejorada (sin RPC por ahora, usando múltiples queries)
         const cleanTerm = term.replace(/['"]/g, "") // Sanitizar un poco
         
         // 1. Buscar IDs de usuarios que coincidan con nombre/apellido/email
         const { data: userMatches } = await supabase
            .from('profiles')
            .select('id')
            .or(`email.ilike.%${cleanTerm}%,first_name.ilike.%${cleanTerm}%,last_name.ilike.%${cleanTerm}%`)
            .limit(50)
         
          const userIds = userMatches?.map((u: { id: string }) => u.id) || []

         // 2. Buscar IDs de productos que coincidan con el nombre
         const { data: prodMatches } = await supabase
            .from('products')
            .select('id')
            .ilike('name', `%${cleanTerm}%`)
            .limit(50)
         
          const prodIds = prodMatches?.map((p: { id: string }) => p.id) || []
         let orderIdsFromProducts: string[] = []

         if (prodIds.length > 0) {
             const { data: itemMatches } = await supabase
                .from('order_items')
                .select('order_id')
                .in('product_id', prodIds)
                .limit(200) // Limite de seguridad
             orderIdsFromProducts = itemMatches?.map((i: { order_id: string }) => i.order_id) || []
         }

         // 3. Buscar IDs de órdenes (Exacto o Parcial)
         const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanTerm)
         
         // Construir el filtro OR gigante
         const orConditions = []
         
         // Tracking y Contact Name directo en orders
         orConditions.push(`tracking_number.ilike.%${cleanTerm}%`)
         orConditions.push(`contact_name.ilike.%${cleanTerm}%`)
         orConditions.push(`contact_lastname.ilike.%${cleanTerm}%`)
         
         // Búsqueda por ID (parcial o exacta)
         if (isUUID) {
             orConditions.push(`id.eq.${cleanTerm}`)
         }
         
         if (userIds.length > 0) {
             orConditions.push(`user_id.in.(${userIds.join(',')})`)
         }
         
         if (orderIdsFromProducts.length > 0) {
             // Supabase limita el tamaño de la URL, si son muchos IDs esto puede fallar.
             // Tomamos los primeros 100 por seguridad.
             const safeOrderIds = Array.from(new Set(orderIdsFromProducts)).slice(0, 100)
             orConditions.push(`id.in.(${safeOrderIds.join(',')})`)
         }

         // Aplicar OR
         if (orConditions.length > 0) {
            query = query.or(orConditions.join(','))
         }
      }

      const from = (page - 1) * ITEMS_PER_PAGE
      const to = from + ITEMS_PER_PAGE - 1
      query = query.range(from, to)

      const { data, count, error } = await query.abortSignal(controller.signal)

      if (error) throw error

      setOrders(data || [])
      setHasMore((count || 0) > to + 1)
      
      const trackings: Record<string, string> = {}
      data?.forEach((o: any) => { if (o.tracking_number) trackings[o.id] = o.tracking_number })
      setTrackingInputs(prev => ({ ...prev, ...trackings }))

    } catch (error: any) {
      const isAbort = error.name === 'AbortError' || error.code === 20 || error.message?.includes('aborted') || (!error.message && typeof error === 'object');
      if (isAbort) return;
      console.error('Error fetching orders:', error)
      alert('Error cargando órdenes: ' + (error.message || 'Error desconocido'))
    } finally {
      if (abortControllerRef.current === controller) {
          setLoading(false)
      }
    }
  }, [page, searchTerm, hideCompleted, statusFilter, supabase])

  useEffect(() => {
    fetchOrders()
    return () => abortControllerRef.current?.abort()
  }, [fetchOrders])

  const handleSaveTracking = async (orderId: string) => {
    const value = trackingInputs[orderId] || ''
    setUpdating(orderId)
    const { error } = await supabase.from('orders').update({ tracking_number: value }).eq('id', orderId)
    if (error) alert('Error guardando tracking')
    else {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, tracking_number: value } : o))
      alert('Tracking guardado')
    }
    setUpdating(null)
  }

  const togglePacked = async (order: Order) => {
    const newValue = !order.is_packed
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, is_packed: newValue } : o))
    
    const { error } = await supabase.from('orders').update({ is_packed: newValue }).eq('id', order.id)
    if (error) {
        alert('Error al actualizar: ' + error.message)
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, is_packed: !newValue } : o))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('⚠️ ¿ELIMINAR orden permanentemente? Esta acción es irreversible.')) return
    setUpdating(id)
    try {
        const { error, count } = await supabase.from('orders').delete({ count: 'exact' }).eq('id', id)
        if (error) throw error
        if (count === 0) throw new Error('No se pudo borrar.')
        setOrders(prev => prev.filter(o => o.id !== id))
        if (selectedIds.has(id)) {
            const newSet = new Set(selectedIds)
            newSet.delete(id)
            setSelectedIds(newSet)
        }
        alert('Orden eliminada correctamente.')
    } catch (e: any) {
        alert('❌ Error al eliminar: ' + e.message)
    } finally {
        setUpdating(null)
    }
  }

  const toggleSelectAll = () => {
      if (selectedIds.size === orders.length && orders.length > 0) setSelectedIds(new Set())
      else setSelectedIds(new Set(orders.map(o => o.id)))
  }

  const toggleSelect = (id: string) => {
      const newSet = new Set(selectedIds)
      if (newSet.has(id)) newSet.delete(id)
      else newSet.add(id)
      setSelectedIds(newSet)
  }

  const handleBulkStatus = async (newStatus: string) => {
      if (selectedIds.size === 0) return
      const eligibleIds = orders.filter(o => selectedIds.has(o.id) && (statusTransitions[o.status] || []).includes(newStatus)).map(o => o.id)
      if (eligibleIds.length === 0) { alert('No hay órdenes válidas para cambiar a este estado.'); return }
      const msg = eligibleIds.length === selectedIds.size ? `¿Cambiar estado a "${newStatus}" para ${eligibleIds.length} órdenes?` : `¿Cambiar estado a "${newStatus}" para ${eligibleIds.length} de ${selectedIds.size} órdenes seleccionadas?`
      if (!confirm(msg)) return
      setLoading(true)
      if (newStatus === 'cancelled') {
        const results = await Promise.all(eligibleIds.map((orderId) => cancelOrder(orderId, true, true)))
        const failed = results.find((result) => !result.success)
        if (failed && !failed.success) alert('Error cancelando: ' + failed.error)
        else { setSelectedIds(new Set()); fetchOrders() }
      } else {
        const { error } = await supabase.from('orders').update({ status: newStatus }).in('id', eligibleIds)
        if (error) { alert('Error actualizando: ' + error.message) } else { setSelectedIds(new Set()); fetchOrders() }
      }
      setLoading(false)
  }

  const handleBulkDelete = async () => {
      if (selectedIds.size === 0) return
      if (!confirm(`⚠️ ¿ELIMINAR PERMANENTEMENTE ${selectedIds.size} órdenes?`)) return
      setLoading(true)
      const { error } = await supabase.from('orders').delete().in('id', Array.from(selectedIds))
      if (error) { alert('Error eliminando: ' + error.message) } else { setSelectedIds(new Set()); fetchOrders() }
      setLoading(false)
  }

  const getClientName = (o: Order) => {
      const contactName = `${o.contact_name || ''} ${o.contact_lastname || ''}`.trim()
      if (contactName) return contactName
      
      const profileName = `${o.profiles?.first_name || ''} ${o.profiles?.last_name || ''}`.trim()
      if (profileName) return profileName
      
      return o.profiles?.email || 'Usuario Desconocido'
  }

  const selectedOrders = useMemo(() => orders.filter(o => selectedIds.has(o.id)), [orders, selectedIds])
  const selectedSum = useMemo(() => selectedOrders.reduce((acc, o) => acc + Number(o.total_amount || 0) + Number(o.credits_used || 0), 0), [selectedOrders])
  const statusTransitions: Record<string, string[]> = {
    pending_payment: ['paid', 'cancelled'],
    verifying_payment: ['paid', 'cancelled'],
    paid: ['processing', 'shipped', 'completed', 'refunded', 'cancelled'],
    processing: ['shipped', 'completed', 'cancelled'],
    shipped: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
    refunded: []
  }
  const bulkStatusOptions = useMemo(() => {
    if (selectedOrders.length === 0) return []
    const set = new Set<string>()
    for (const o of selectedOrders) {
      const nexts = statusTransitions[o.status] || []
      nexts.forEach(s => set.add(s))
    }
    return Array.from(set)
  }, [selectedOrders])

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 relative">
      
      {/* MODAL ZOOM COMPROBANTE */}
      {proofImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setProofImage(null)}>
             <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer z-50"><X size={32} /></button>
             <div className="relative w-full max-w-2xl h-[80vh]">
                <Image src={proofImage} alt="Comprobante" fill className="object-contain rounded-lg" unoptimized />
             </div>
        </div>
      )}

      <h1 className="text-2xl font-bold text-slate-800">Gestión de Pedidos</h1>

      {/* FILTROS */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
         <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
            <input 
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(1) }} 
                placeholder="Buscar por Cliente, Carta, Tracking, Email, ID de Orden..."
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-sm"
            />
         </div>
         <div className="flex items-center gap-2">
           <label className="flex items-center gap-2 text-sm text-slate-600 font-bold cursor-pointer select-none border px-3 py-2 rounded-lg hover:bg-slate-50 whitespace-nowrap bg-slate-50/50">
              <input type="checkbox" checked={hideCompleted} onChange={() => { setHideCompleted(!hideCompleted); setPage(1) }} className="w-4 h-4 accent-sky-600 cursor-pointer"/>
              <Filter size={16}/> Ocultar Finalizadas
           </label>
           <select 
             value={statusFilter}
             onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
             className="px-3 py-2 rounded-lg border text-sm font-bold bg-white focus:ring-2 focus:ring-sky-500 outline-none"
           >
             <option value="">Todos los estados</option>
             {['pending_payment','verifying_payment','paid','processing','shipped','completed','cancelled','refunded'].map(s => (
               <option key={s} value={s}>{s}</option>
             ))}
           </select>
         </div>
      </div>
      
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto w-full">
            <table className="w-full text-sm text-left min-w-[1000px]">
            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 whitespace-nowrap">
                <tr>
                    <th className="p-4 w-10 text-center">
                        <input 
                            type="checkbox" 
                            checked={orders.length > 0 && selectedIds.size === orders.length} 
                            onChange={toggleSelectAll} 
                            className="w-4 h-4 accent-[#0F172A] cursor-pointer"
                        />
                    </th>
                    <th className="p-4">Orden / Fecha</th>
                    <th className="p-4 text-center">Armado</th>
                    <th className="p-4">Cliente</th>
                    <th className="p-4">Total</th>
                    <th className="p-4">Estado</th>
                    <th className="p-4">Tracking</th>
                    <th className="p-4">Notas Entrega</th>
                    <th className="p-4 text-right">Acciones</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {loading ? (
                    <tr><td colSpan={9} className="p-12 text-center text-slate-400"><Loader2 className="animate-spin mx-auto mb-2"/>Cargando...</td></tr>
                ) : orders.length === 0 ? (
                    <tr><td colSpan={9} className="p-12 text-center text-slate-500">No se encontraron órdenes.</td></tr>
                ) : orders.map((order) => (
                <tr key={order.id} className={`hover:bg-slate-50 transition-colors ${selectedIds.has(order.id) ? 'bg-sky-50/30' : ''} ${order.is_packed ? 'bg-emerald-50/30' : ''}`}>
                    <td className="p-4 text-center">
                        <input 
                            type="checkbox" 
                            checked={selectedIds.has(order.id)} 
                            onChange={() => toggleSelect(order.id)} 
                            className="w-4 h-4 accent-[#0F172A] cursor-pointer"
                        />
                    </td>
                    <td className="p-4">
                        <div className="font-mono font-bold text-slate-700">{order.id.slice(0, 8)}</div>
                        <div className="text-xs text-slate-400">{new Date(order.created_at).toLocaleDateString()}</div>
                    </td>
                    
                    <td className="p-4 text-center">
                        <button 
                            onClick={() => togglePacked(order)}
                            className={`p-2 rounded-full transition-all cursor-pointer ${order.is_packed ? 'bg-emerald-100 text-emerald-600 shadow-sm' : 'bg-slate-100 text-slate-300 hover:bg-slate-200'}`}
                            title={order.is_packed ? "Pedido Armado" : "Marcar como Armado"}
                        >
                            {order.is_packed ? <PackageCheck size={20} strokeWidth={2.5}/> : <Package size={20}/>}
                        </button>
                    </td>

                    <td className="p-4">
                         <div className="truncate max-w-[150px]" title={order.profiles?.email}>
                            <div className="font-bold text-slate-700">{getClientName(order)}</div>
                            <div className="text-xs text-slate-500">{order.profiles?.email}</div>
                         </div>
                    </td>
                    <td className="p-4 font-bold text-slate-700 whitespace-nowrap">
                        US$ {(Number(order.total_amount || 0) + Number(order.credits_used || 0)).toFixed(2)}
                    </td>
                    <td className="p-4">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide whitespace-nowrap
                        ${order.status === 'paid' ? 'bg-blue-100 text-blue-800' :
                        order.status === 'verifying_payment' ? 'bg-yellow-100 text-yellow-800 animate-pulse' :
                        order.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                        order.status === 'shipped' ? 'bg-purple-100 text-purple-800' :
                        order.status === 'cancelled' ? 'bg-red-100 text-red-800' : 
                        'bg-slate-100 text-slate-800'}`}>
                        {order.status === 'pending_payment' ? 'Pendiente' :
                        order.status === 'verifying_payment' ? 'Verificando' :
                        order.status === 'paid' ? 'Pagado' :
                        order.status === 'processing' ? 'Procesando' :
                        order.status === 'shipped' ? 'Enviado' :
                        order.status === 'completed' ? 'Completado' : order.status}
                    </span>
                    </td>
                    <td className="p-4">
                    <div className="flex items-center gap-1">
                        <input
                        className="border border-slate-300 rounded px-2 py-1 w-24 text-xs"
                        placeholder="Tracking..."
                        value={trackingInputs[order.id] || ''}
                        onChange={(e) => setTrackingInputs(prev => ({ ...prev, [order.id]: e.target.value }))}
                        />
                        <button onClick={() => handleSaveTracking(order.id)} className="text-slate-400 hover:text-slate-800 p-1 cursor-pointer">
                             <Save size={14} />
                        </button>
                    </div>
                    </td>
                    <td className="p-4 max-w-[150px]">
                        <div className="truncate text-xs text-slate-500">{order.delivery_notes || '-'}</div>
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex justify-end items-center gap-2">
                            {/* CAMBIO: Mostrar SIEMPRE si hay url, sin importar el estado */}
                            {order.payment_proof_url && (
                                <button 
                                     onClick={() => setProofImage(order.payment_proof_url ?? null)}
                                    className="p-2 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 transition-colors cursor-pointer"
                                    title="Ver Comprobante"
                                >
                                    <FileText size={16}/>
                                </button>
                            )}
                            
                            {order.status === 'verifying_payment' && (
                                <button 
                                    onClick={async () => {
                                        if(!confirm('¿Aprobar pago y marcar como PAGADO?')) return
                                        await supabase.from('orders').update({ status: 'paid' }).eq('id', order.id)
                                        fetchOrders()
                                    }}
                                    className="p-2 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 transition-colors cursor-pointer"
                                    title="Aprobar Pago"
                                >
                                    <Check size={16}/>
                                </button>
                            )}
                            
                            <Link href={{ pathname: `/admin/orders/${order.id}`, query: { status: statusFilter || undefined, hide: hideCompleted ? '1' : '0', page, search: searchTerm || undefined } }} className="p-2 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 hover:text-slate-900 transition-colors cursor-pointer" title="Ver Detalle">
                                <Eye size={16} />
                            </Link>
                            <button 
                                onClick={() => handleDelete(order.id)}
                                disabled={updating === order.id}
                                className="p-2 bg-red-50 text-red-400 rounded hover:bg-red-100 hover:text-red-600 transition-colors cursor-pointer"
                                title="Eliminar Orden"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </td>
                </tr>
                ))}
            </tbody>
            </table>
        </div>

        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
             <button 
                disabled={page === 1 || loading}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white text-slate-600 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
             >
                <ArrowLeft size={16}/> Anterior
             </button>
             <span className="text-xs font-bold text-slate-400">Página {page}</span>
             <button 
                disabled={!hasMore || loading}
                onClick={() => setPage(p => p + 1)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white text-slate-600 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
             >
                Siguiente <ArrowRight size={16}/>
             </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#0F172A] text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-6 z-50 animate-in slide-in-from-bottom-4">
              <div className="flex flex-col text-xs">
                  <span className="font-bold text-sky-400">{selectedIds.size} Seleccionadas</span>
                  <span className="opacity-80">Total: US$ {selectedSum.toFixed(2)}</span>
              </div>
              <div className="h-8 w-px bg-slate-700"></div>
              <div className="flex items-center gap-2">
                  <select onChange={(e) => handleBulkStatus(e.target.value)} className="bg-slate-800 border-none text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer hover:bg-slate-700 transition-colors" value="">
                      <option value="" disabled>Cambiar Estado...</option>
                      {bulkStatusOptions.length > 0 ? (
                        bulkStatusOptions.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))
                      ) : (
                        <option value="" disabled>Sin cambios válidos</option>
                      )}
                  </select>
                  <button onClick={handleBulkDelete} className="p-2 bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white rounded-full transition-all cursor-pointer" title="Eliminar seleccionadas">
                      <Trash2 size={16}/>
                  </button>
                  <button onClick={() => setSelectedIds(new Set())} className="ml-2 opacity-50 hover:opacity-100 cursor-pointer"><X size={16}/></button>
              </div>
          </div>
      )}

    </div>
  )
}
