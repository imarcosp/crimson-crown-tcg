'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Search, Plane, User, Loader2, X, Check, ArrowLeft, ArrowRight, Filter, Calendar, Trash2, Edit, DollarSign, Eye } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

const ITEMS_PER_PAGE = 20

// Helper para calcular total de una orden
const calculateOrderTotal = (items: any[]) => {
    if (!items || items.length === 0) return 0
    return items.reduce((acc, item) => {
        const price = Number(item.unit_price || 0)
        const tax = Number(item.tax_percent || 0)
        const shipping = Number(item.shipping_cost || 0)
        const qty = Number(item.quantity || 1)
        const subtotal = price * (1 + tax / 100)
        return acc + (subtotal + shipping) * qty
    }, 0)
}

export default function AdminImportsPage() {
  const supabase = createClient()
  const router = useRouter()
  
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // Estado para Zoom de Comprobante
  const [proofImage, setProofImage] = useState<string | null>(null)

  // Paginación y Filtros
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  
  const [hideFinished, setHideFinished] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Selección Múltiple
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Modal Creación
  const [showModal, setShowModal] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [creating, setCreating] = useState(false)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
        let query = supabase
            .from('import_orders')
            .select('*, profiles(first_name, last_name, email), import_items(unit_price, tax_percent, shipping_cost, quantity)', { count: 'exact' })
            .order('created_at', { ascending: false })

        if (hideFinished) {
            query = query.not('status', 'in', '("Disponible","Completada","Solo Cotización")')
        }

        if (searchTerm.length >= 2) {
            const cleaned = searchTerm.trim()
            
            // 1. Buscar en Items (Productos Importados)
            const { data: itemMatches } = await supabase
              .from('import_items')
              .select('order_id')
              .ilike('product_name', `%${cleaned}%`)
              .limit(100)
            
            const itemOrderIds = itemMatches?.map((i: { order_id: string }) => i.order_id) || []

            // 2. Buscar en Usuarios (Nombre/Apellido/Email)
            const { data: userMatches } = await supabase
                .from('profiles')
                .select('id')
                .or(`email.ilike.%${cleaned}%,first_name.ilike.%${cleaned}%,last_name.ilike.%${cleaned}%`)
                .limit(50)
            const userIds = userMatches?.map((u: { id: string }) => u.id) || []

            // 3. Construir OR
            const orConditions: string[] = []
            
            // Order Number
            orConditions.push(`order_number.ilike.%${cleaned}%`)
            
            if (userIds.length > 0) {
                orConditions.push(`user_id.in.(${userIds.join(',')})`)
            }

            if (itemOrderIds.length > 0) {
                 const uniqueItemOrderIds = Array.from(new Set(itemOrderIds)).slice(0, 100)
                 orConditions.push(`id.in.(${uniqueItemOrderIds.join(',')})`)
            }

            if (orConditions.length > 0) {
                query = query.or(orConditions.join(','))
            }
        }

        if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00`)
        if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59`)

        const from = (page - 1) * ITEMS_PER_PAGE
        const to = from + ITEMS_PER_PAGE - 1
        query = query.range(from, to)

        const { data, count, error } = await query
        if (error) throw error
        
        setOrders(data || [])
        setHasMore((count || 0) > to + 1)

    } catch (e) {
        console.error(e)
    } finally {
        setLoading(false)
    }
  }, [page, searchTerm, dateFrom, dateTo, hideFinished, supabase])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const toggleSelectAll = () => {
      if (selectedIds.size === orders.length) setSelectedIds(new Set())
      else setSelectedIds(new Set(orders.map(o => o.id)))
  }

  const toggleSelect = (id: string) => {
      const newSet = new Set(selectedIds)
      if (newSet.has(id)) newSet.delete(id)
      else newSet.add(id)
      setSelectedIds(newSet)
  }

  const selectionStats = () => {
      const selectedOrders = orders.filter(o => selectedIds.has(o.id))
      const totalCards = selectedOrders.reduce((acc, o) => acc + (o.import_items?.reduce((s: number, i: any) => s + (i.quantity || 1), 0) || 0), 0)
      const totalMoney = selectedOrders.reduce((acc, o) => acc + calculateOrderTotal(o.import_items), 0)
      return { count: selectedOrders.length, cards: totalCards, money: totalMoney }
  }

  const handleBulkStatus = async (newStatus: string) => {
      if (!confirm(`¿Cambiar estado a "${newStatus}" para ${selectedIds.size} órdenes?`)) return
      await supabase.from('import_orders').update({ status: newStatus }).in('id', Array.from(selectedIds))
      setSelectedIds(new Set())
      fetchOrders()
  }

  const handleBulkDelete = async () => {
      if (!confirm(`¿ELIMINAR PERMANENTEMENTE ${selectedIds.size} órdenes?`)) return
      await supabase.from('import_orders').delete().in('id', Array.from(selectedIds))
      setSelectedIds(new Set())
      fetchOrders()
  }

  const cyclePaymentStatus = async (order: any) => {
      let nextStatus = 'pending'
      if (order.payment_status === 'pending') nextStatus = 'paid'
      else if (order.payment_status === 'verifying') nextStatus = 'paid'
      else if (order.payment_status === 'paid') nextStatus = 'pending'

      const { error } = await supabase.from('import_orders').update({ payment_status: nextStatus }).eq('id', order.id)
      if (!error) {
          setOrders(prev => prev.map(o => o.id === order.id ? { ...o, payment_status: nextStatus } : o))
      }
  }

  // Search User Logic
  useEffect(() => {
    if (userSearch.length < 2) { setUserResults([]); return }
    const selectedName = selectedUser ? `${selectedUser.first_name} ${selectedUser.last_name}`.trim() : ''
    if (selectedUser && (userSearch === selectedUser.email || userSearch === selectedName)) return
    const timer = setTimeout(async () => {
      setIsSearching(true)
      let query = supabase.from('profiles').select('id, first_name, last_name, email').limit(5)
      if (userSearch.includes('@')) query = query.ilike('email', `%${userSearch}%`)
      else query = query.or(`first_name.ilike.%${userSearch}%,last_name.ilike.%${userSearch}%,email.ilike.%${userSearch}%`)
      const { data } = await query
      setUserResults(data || [])
      setIsSearching(false)
    }, 400)
    return () => clearTimeout(timer)
  }, [userSearch])

  const handleSelectUser = (u: any) => { setSelectedUser(u); setUserSearch(`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email); setUserResults([]) }
  const clearSelection = () => { setSelectedUser(null); setUserSearch(''); setUserResults([]) }
  
  const handleCreate = async () => {
    if (!selectedUser) return
    setCreating(true)
    try {
        const { data, error } = await supabase.from('import_orders').insert({ user_id: selectedUser.id, status: 'Iniciada' }).select().single()
        if (error) throw error
        setShowModal(false)
        router.push(`/admin/imports/${data.id}`)
    } catch (e: any) { alert('Error: ' + e.message); setCreating(false) }
  }

  const getStatusColor = (s: string) => {
      switch(s) {
          case 'Iniciada': return 'bg-slate-100 text-slate-700'
          case 'Procesada': return 'bg-blue-100 text-blue-700'
          case 'Enviada': return 'bg-purple-100 text-purple-700'
          case 'Disponible': return 'bg-emerald-100 text-emerald-700'
          case 'Completada': return 'bg-green-100 text-green-800 border-green-200'
          case 'Solo Cotización': return 'bg-slate-100 text-slate-700'
          default: return 'bg-slate-100'
      }
  }

  const stats = selectionStats()

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 pb-24 relative">
      
      {/* MODAL ZOOM COMPROBANTE */}
      {proofImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setProofImage(null)}>
             <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer z-50"><X size={32} /></button>
             <div className="relative w-full max-w-2xl h-[80vh]">
                <Image src={proofImage} alt="Comprobante" fill className="object-contain rounded-lg" unoptimized />
             </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Plane className="text-sky-600"/> Importaciones</h1>
            <p className="text-slate-500 text-sm">Gestión de pedidos al exterior</p>
        </div>
        <button onClick={() => { setShowModal(true); clearSelection() }} className="px-4 py-2 bg-[#0F172A] text-white rounded-lg font-bold flex items-center gap-2 hover:bg-slate-800 transition-colors shadow-md cursor-pointer">
            <Plus size={18}/> Nueva Orden
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
         <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
            <input value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setPage(1) }} placeholder="Buscar por Cliente, Nro Orden o CARTA..." className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none text-sm"/>
         </div>
         
         <label className="flex items-center gap-2 text-sm text-slate-600 font-bold cursor-pointer select-none border px-3 py-2 rounded-lg hover:bg-slate-50 whitespace-nowrap bg-slate-50/50">
            <input type="checkbox" checked={hideFinished} onChange={() => { setHideFinished(!hideFinished); setPage(1) }} className="w-4 h-4 accent-[#0F172A] cursor-pointer"/>
            <Filter size={16}/> Ocultar Finalizadas
         </label>

         <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
            <Calendar size={16} className="ml-2 text-slate-400"/>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="bg-transparent outline-none text-slate-700 cursor-pointer"/>
            <span>-</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="bg-transparent outline-none text-slate-700 cursor-pointer"/>
            {(dateFrom || dateTo) && <button onClick={() => {setDateFrom(''); setDateTo('')}} className="p-1 hover:bg-slate-200 rounded-full cursor-pointer"><X size={14}/></button>}
         </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs border-b border-slate-200">
                    <tr>
                        <th className="px-4 py-3 w-10 text-center">
                            <input type="checkbox" checked={selectedIds.size === orders.length && orders.length > 0} onChange={toggleSelectAll} className="w-4 h-4 accent-[#0F172A] cursor-pointer"/>
                        </th>
                        <th className="px-6 py-3 whitespace-nowrap">Orden #</th>
                        <th className="px-6 py-3 whitespace-nowrap">Cliente</th>
                        <th className="px-6 py-3 whitespace-nowrap text-right">Monto Total</th>
                        <th className="px-6 py-3 whitespace-nowrap">Estado</th>
                        <th className="px-6 py-3 whitespace-nowrap">Fecha</th>
                        <th className="px-6 py-3 text-right">Acción</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {loading ? (
                        <tr><td colSpan={7} className="p-12 text-center text-slate-400"><Loader2 className="animate-spin mx-auto mb-2"/>Cargando...</td></tr>
                    ) : orders.length === 0 ? (
                        <tr><td colSpan={7} className="p-12 text-center text-slate-500">No se encontraron resultados.</td></tr>
                    ) : (
                        orders.map((order) => {
                            const fullName = `${order.profiles?.first_name || ''} ${order.profiles?.last_name || ''}`.trim() || 'Desconocido'
                            const total = calculateOrderTotal(order.import_items)
                            return (
                                <tr key={order.id} className={`hover:bg-slate-50 transition-colors ${selectedIds.has(order.id) ? 'bg-sky-50/50' : ''}`}>
                                    <td className="px-4 py-4 text-center">
                                        <input type="checkbox" checked={selectedIds.has(order.id)} onChange={() => toggleSelect(order.id)} className="w-4 h-4 accent-[#0F172A] cursor-pointer"/>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <span className="font-bold text-slate-900 font-mono">{order.order_number}</span>
                                            {/* SEMÁFORO DE PAGO */}
                                            <div className="flex items-center gap-1">
                                                <button 
                                                    onClick={() => cyclePaymentStatus(order)}
                                                    className={`p-2 rounded-full transition-all cursor-pointer shadow-sm border 
                                                        ${order.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 
                                                          order.payment_status === 'verifying' ? 'bg-yellow-100 text-yellow-600 border-yellow-200 animate-pulse' : 
                                                          'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'}`}
                                                    title={`Estado: ${order.payment_status}. Click para cambiar.`}
                                                >
                                                    <DollarSign size={18} />
                                                </button>
                                                
                                                {/* OJO PARA VER COMPROBANTE CON ZOOM */}
                                                {order.payment_proof_url && (
                                                    <button 
                                                        onClick={() => setProofImage(order.payment_proof_url)}
                                                        className="p-2 bg-slate-100 text-blue-600 rounded-full hover:bg-blue-50 cursor-pointer"
                                                        title="Ver Comprobante"
                                                    >
                                                        <Eye size={16}/>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-700">{fullName}</div>
                                        <div className="text-xs text-slate-500">{order.profiles?.email}</div>
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono font-bold text-slate-700">
                                        {total > 0 ? `$${total.toFixed(2)}` : '-'}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded text-[10px] uppercase font-bold tracking-wide ${getStatusColor(order.status)}`}>{order.status}</span>
                                    </td>
                                    <td className="px-6 py-4 text-slate-500">{new Date(order.created_at).toLocaleDateString()}</td>
                                    <td className="px-6 py-4 text-right">
                                        <Link href={`/admin/imports/${order.id}`} className="inline-flex items-center px-3 py-1.5 bg-slate-100 text-slate-600 rounded-md font-bold text-xs hover:bg-slate-200 transition-colors border border-slate-200 cursor-pointer">
                                            Gestionar
                                        </Link>
                                    </td>
                                </tr>
                            )
                        })
                    )}
                </tbody>
            </table>
        </div>
        
        {/* Paginación */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
             <button disabled={page === 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white text-slate-600 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 cursor-pointer"><ArrowLeft size={16}/> Anterior</button>
             <span className="text-xs font-bold text-slate-400">Página {page}</span>
             <button disabled={!hasMore || loading} onClick={() => setPage(p => p + 1)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white text-slate-600 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 cursor-pointer">Siguiente <ArrowRight size={16}/></button>
        </div>
      </div>

      {selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#0F172A] text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-6 z-50 animate-in slide-in-from-bottom-4">
              <div className="flex flex-col text-xs">
                  <span className="font-bold text-sky-400">{stats.count} Órdenes</span>
                  <span className="opacity-80">{stats.cards} cartas • ${stats.money.toFixed(2)}</span>
              </div>
              <div className="h-8 w-px bg-slate-700"></div>
              <div className="flex items-center gap-2">
                  <select onChange={(e) => handleBulkStatus(e.target.value)} className="bg-slate-800 border-none text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer hover:bg-slate-700 transition-colors" value="">
                      <option value="" disabled>Cambiar Estado...</option>
                      <option value="Procesada">Procesada</option>
                      <option value="Enviada">Enviada</option>
                      <option value="Disponible">Disponible</option>
                      <option value="Completada">Completada</option>
                      <option value="Solo Cotización">Solo Cotización</option>
                  </select>
                  <button onClick={handleBulkDelete} className="p-2 bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white rounded-full transition-all cursor-pointer" title="Eliminar seleccionadas">
                      <Trash2 size={16}/>
                  </button>
                  <button onClick={() => setSelectedIds(new Set())} className="ml-2 opacity-50 hover:opacity-100 cursor-pointer"><X size={16}/></button>
              </div>
          </div>
      )}

      {/* Modal Creación */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-5 animate-in zoom-in-95 duration-200 relative">
                <button onClick={() => setShowModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"><X size={20}/></button>
                <div><h3 className="text-xl font-bold text-slate-800">Nueva Orden</h3><p className="text-sm text-slate-500">Selecciona el cliente.</p></div>
                <div className="space-y-2">
                    <div className="relative">
                        <Search className={`absolute left-3 top-2.5 ${selectedUser ? 'text-emerald-500' : 'text-slate-400'}`} size={16}/>
                        <input autoFocus={!selectedUser} className={`w-full pl-9 pr-9 py-2 border rounded-lg outline-none ${selectedUser ? 'border-emerald-500 bg-emerald-50 font-bold text-emerald-900' : 'focus:ring-2 focus:ring-sky-500 border-slate-300'}`} placeholder="Buscar cliente..." value={userSearch} onChange={e => { setUserSearch(e.target.value); setSelectedUser(null) }}/>
                        {isSearching && <Loader2 className="absolute right-3 top-2.5 animate-spin text-sky-500" size={16}/>}
                        {selectedUser && !isSearching && <button onClick={clearSelection} className="absolute right-3 top-2.5 text-emerald-600 cursor-pointer"><X size={16}/></button>}
                        {!selectedUser && userResults.length > 0 && (
                            <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-20 max-h-48 overflow-y-auto">
                                {userResults.map(u => (
                                    <button key={u.id} onClick={() => handleSelectUser(u)} className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b last:border-0 cursor-pointer">
                                        <div className="font-bold text-sm text-slate-800">{u.first_name} {u.last_name}</div>
                                        <div className="text-xs text-slate-500">{u.email}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex justify-end gap-3 pt-4 border-t">
                    <button onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg cursor-pointer">Cancelar</button>
                    <button onClick={handleCreate} disabled={!selectedUser || creating} className="px-6 py-2 bg-[#0F172A] text-white font-bold rounded-lg hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 cursor-pointer">
                        {creating ? <Loader2 className="animate-spin" size={18}/> : <Check size={18}/>} Crear
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  )
}
