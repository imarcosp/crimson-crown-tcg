"use client"
import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Bell, ArrowLeft, Users, Filter, X } from 'lucide-react'
import Link from 'next/link'

export default function AdminWishlistPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sortOrder, setSortOrder] = useState<'count' | 'newest' | 'oldest'>('count')
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  
  const supabase = createClient()

  useEffect(() => {
    const fetchWishlists = async () => {
      // Traemos productos también para saber detalles como finish, set, etc.
      const { data, error } = await supabase
        .from('wishlists')
        .select(`
            *,
            profiles (email, first_name, last_name),
            products (finish, set_name, collector_number)
        `)
        .order('created_at', { ascending: false })
      
      if (!error) setItems(data || [])
      setLoading(false)
    }
    fetchWishlists()
  }, [])

  const groupedItems = useMemo(() => {
    const groups: Record<string, any> = {}
    
    items.forEach(item => {
        // Agrupamos por ID de producto (específico) o por nombre (genérico)
        const key = item.is_specific ? `${item.product_id}` : `ANY:${item.card_name}`
        
        if (!groups[key]) {
            groups[key] = {
                name: item.card_name,
                image: item.image_url,
                is_specific: item.is_specific,
                set_name: item.set_name || item.products?.set_name,
                collector_number: item.products?.collector_number,
                finish: item.products?.finish,
                total_waiters: 0,
                users: [],
                last_request: item.created_at // Guardamos la fecha más reciente para ordenar
            }
        }
        
        // Actualizamos fecha si encontramos una más reciente en el grupo
        if (new Date(item.created_at) > new Date(groups[key].last_request)) {
            groups[key].last_request = item.created_at
        }

        groups[key].total_waiters++
        
        const userEmail = item.profiles?.email || 'Usuario desconocido'
        if (!groups[key].users.includes(userEmail)) {
            groups[key].users.push(userEmail)
        }
    })

    return Object.values(groups).sort((a: any, b: any) => {
        if (sortOrder === 'newest') return new Date(b.last_request).getTime() - new Date(a.last_request).getTime()
        if (sortOrder === 'oldest') return new Date(a.last_request).getTime() - new Date(b.last_request).getTime()
        return b.total_waiters - a.total_waiters // Default: count
    })
  }, [items, sortOrder])

  return (
    <div className="space-y-6 p-6">
      
      {/* ZOOM MODAL */}
      {zoomedImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
             <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer z-50"><X size={32} /></button>
             <div className="relative w-full max-w-lg aspect-[3/4]">
                <img src={zoomedImage} alt="Zoom" className="w-full h-full object-contain rounded-lg" />
             </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4 w-full sm:w-auto">
            <Link href="/admin" className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
                <ArrowLeft size={24}/>
            </Link>
            <div>
                <h1 className="text-2xl font-bold text-[#0F172A] flex items-center gap-2">
                    <Bell className="text-yellow-600"/> Alertas de Stock
                </h1>
                <p className="text-sm text-slate-500">Usuarios esperando productos.</p>
            </div>
        </div>

        {/* FILTRO DE ORDENAMIENTO */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 p-1 rounded-lg shadow-sm">
            <div className="px-2 text-slate-400"><Filter size={16}/></div>
            <select 
                value={sortOrder} 
                onChange={(e) => setSortOrder(e.target.value as any)}
                className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer py-1 pr-2"
            >
                <option value="count">Más Interesados</option>
                <option value="newest">Más Recientes</option>
                <option value="oldest">Más Antiguos</option>
            </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
            <div className="p-12 text-center text-slate-400">Cargando alertas...</div>
        ) : groupedItems.length === 0 ? (
            <div className="p-12 text-center text-slate-400">Nadie ha creado alertas todavía.</div>
        ) : (
            <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                    <tr>
                        <th className="px-6 py-3">Producto / Versión</th>
                        <th className="px-6 py-3 text-center">Interesados</th>
                        <th className="px-6 py-3">Usuarios</th>
                        <th className="px-6 py-3 text-right">Último Pedido</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {groupedItems.map((group: any, idx: number) => {
                        const isFoil = String(group.finish || '').toLowerCase().includes('foil') && !String(group.finish || '').toLowerCase().includes('non')
                        return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 flex items-center gap-4">
                                <div 
                                    className="w-10 h-14 bg-slate-200 rounded overflow-hidden shrink-0 border border-slate-200 relative cursor-zoom-in hover:opacity-90 transition-opacity"
                                    onClick={() => group.image && setZoomedImage(group.image)}
                                >
                                    {group.image && <img src={group.image} className="w-full h-full object-cover"/>}
                                </div>
                                <div>
                                    <span className="font-bold text-slate-800 text-base block">{group.name}</span>
                                    {group.is_specific ? (
                                        <div className="text-xs text-slate-500 flex flex-col gap-0.5 mt-1">
                                            <span>{group.set_name} #{group.collector_number}</span>
                                            {isFoil && <span className="text-purple-600 font-bold bg-purple-50 px-1.5 rounded w-fit">✨ Foil</span>}
                                        </div>
                                    ) : (
                                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold mt-1 inline-block">Cualquier Versión</span>
                                    )}
                                </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full font-bold">
                                    <Users size={16}/> {group.total_waiters}
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                <div className="flex flex-wrap gap-1">
                                    {group.users.map((u: string, i: number) => (
                                        <span key={i} className="text-xs bg-slate-100 px-2 py-1 rounded text-slate-600 border border-slate-200">
                                            {u}
                                        </span>
                                    ))}
                                </div>
                            </td>
                            <td className="px-6 py-4 text-right text-xs text-slate-400 font-mono">
                                {new Date(group.last_request).toLocaleDateString()}
                            </td>
                        </tr>
                    )})}
                </tbody>
            </table>
        )}
      </div>
    </div>
  )
}