// @ts-nocheck
"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Eye, CheckCircle, XCircle, Clock, Trash2, PlusCircle } from 'lucide-react'
import { getAdminBuylistList } from '@/app/actions/admin-buylists'

export default function AdminBuylists() {
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const result = await getAdminBuylistList()
        if (!result?.success) throw new Error(result?.error || 'No se pudieron cargar las solicitudes.')
        setOrders(result.orders || [])
      } catch (e) {
        alert('Error cargando solicitudes: ' + (e as any).message)
      } finally {
        setLoading(false)
      }
    }
    fetchOrders()
  }, [])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft': return <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded text-xs font-bold flex items-center gap-1"><Clock size={12}/> Borrador</span>
      case 'pending_review': return <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs font-bold flex items-center gap-1"><Clock size={12}/> Revisión</span>
      case 'waiting_user_approval': return <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-bold flex items-center gap-1"><Clock size={12}/> Esperando Usuario</span>
      case 'completed': return <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold flex items-center gap-1"><CheckCircle size={12}/> Completada</span>
      case 'cancelled': return <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-bold flex items-center gap-1"><XCircle size={12}/> Rechazada</span>
      default: return <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs font-bold">{status}</span>
    }
  }

  const getUserInfo = (profileData: any) => {
    const p = Array.isArray(profileData) ? profileData[0] : profileData
    if (!p) return { name: 'Desconocido', email: 'Sin email' }
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ')
    return {
      name: fullName || 'Sin nombre',
      email: p.email || 'Sin email'
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de que deseas eliminar esta solicitud permanentemente? Esta acción no se puede deshacer.')) return
    
    try {
      // Supabase suele tener cascade delete configurado, pero si no, elimina la cabecera
      const { error } = await supabase.from('buylist_orders').delete().eq('id', id)
      if (error) throw error
      
      // Actualizamos el estado local quitando la orden borrada
      setOrders(prev => prev.filter(o => o.id !== id))
    } catch (e: any) {
      alert('Error eliminando la solicitud: ' + e.message)
    }
  }

  const filteredOrders = orders.filter(o => 
    showAll ? true : (o.status !== 'completed' && o.status !== 'rejected' && o.status !== 'cancelled')
  )

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredOrders.map(o => o.id))
    } else {
      setSelectedIds([])
    }
  }

  const handleSelectOne = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return
    if (!confirm(`¿Estás seguro de que deseas eliminar ${selectedIds.length} solicitudes permanentemente?`)) return
    
    try {
      // Borrado masivo usando IN
      const { error } = await supabase.from('buylist_orders').delete().in('id', selectedIds)
      if (error) throw error
      
      // Limpiamos la UI
      setOrders(prev => prev.filter(o => !selectedIds.includes(o.id)))
      setSelectedIds([])
    } catch (e: any) {
      alert('Error eliminando las solicitudes: ' + e.message)
    }
  }

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-purple-600" /></div>

  return (
    <div className="p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Solicitudes de Venta (Buylist)</h1>
        
        <div className="flex items-center gap-4">
          <Link
            href="/admin/buylists/new"
            className="bg-[#0F172A] hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors shadow-sm cursor-pointer"
          >
            <PlusCircle size={16} /> Nueva cotización manual
          </Link>
          {selectedIds.length > 0 && (
            <button 
              onClick={handleBulkDelete}
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors shadow-sm"
            >
              <Trash2 size={16} /> Eliminar Seleccionadas ({selectedIds.length})
            </button>
          )}

          <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors">
            <input 
              type="checkbox" 
              checked={showAll} 
              onChange={(e) => setShowAll(e.target.checked)} 
              className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer" 
            />
            Mostrar historial
          </label>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-bold uppercase">
            <tr>
              <th className="p-4 w-12">
                <input 
                  type="checkbox" 
                  className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                  checked={filteredOrders.length > 0 && selectedIds.length === filteredOrders.length}
                  onChange={handleSelectAll}
                />
              </th>
              <th className="p-4">ID</th>
              <th className="p-4">Usuario</th>
              <th className="p-4">Origen</th>
              <th className="p-4">Fecha</th>
              <th className="p-4">Items</th>
              <th className="p-4">Total Ofertado</th>
              <th className="p-4">Estado</th>
              <th className="p-4">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOrders.map((o) => {
              const user = getUserInfo(o.profile)
              const isSelected = selectedIds.includes(o.id)
              return (
              <tr key={o.id} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-purple-50/50' : ''}`}>
                <td className="p-4">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                    checked={isSelected}
                    onChange={() => handleSelectOne(o.id)}
                  />
                </td>
                <td className="p-4 font-mono text-slate-600">#{o.id}</td>
                <td className="p-4">
                  <div className="text-slate-900 font-bold">{user.name}</div>
                  <div className="text-slate-500 text-xs">{user.email}</div>
                </td>
                <td className="p-4">
                  {o.created_by_admin_id ? (
                    <div className="flex flex-col gap-1">
                      <span className="inline-flex w-fit items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-bold text-purple-700">Cotización manual</span>
                      {o.sent_at ? (
                        <span className="text-[11px] text-slate-500">Enviada: {new Date(o.sent_at).toLocaleDateString()}</span>
                      ) : (
                        <span className="text-[11px] text-slate-500">Aún no enviada</span>
                      )}
                    </div>
                  ) : (
                    <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600">Solicitud usuario</span>
                  )}
                </td>
                <td className="p-4 text-slate-500">{new Date(o.created_at).toLocaleDateString()}</td>
                <td className="p-4 text-slate-600">{o.buylist_items?.length || 0} cartas</td>
                <td className="p-4 font-bold text-emerald-600">${o.total_offered}</td>
                <td className="p-4">{getStatusBadge(o.status)}</td>
                <td className="p-4 flex items-center gap-3">
                  <Link href={`/admin/buylists/${o.id}`} className="text-blue-600 hover:text-blue-900 font-bold flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-md transition-colors">
                    <Eye size={16} /> Ver
                  </Link>
                  <button onClick={() => handleDelete(o.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-md transition-colors" title="Eliminar orden">
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        {filteredOrders.length === 0 && <div className="p-8 text-center text-slate-500">No hay solicitudes para mostrar con los filtros actuales.</div>}
      </div>
    </div>
  )
}
