"use client"
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TrendingUp, Trash2, RefreshCw, ShoppingCart, ExternalLink, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import Image from 'next/image'

const PAGE_SIZE = 25

export default function AdminOpportunitiesPage() {
  const supabase = createClient()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const loadData = async (targetPage = 1) => {
    setLoading(true)
    const from = (targetPage - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    const { data, count } = await supabase
      .from('price_opportunities')
      .select('*', { count: 'exact' })
      .order('diff_percentage', { ascending: false })
      .range(from, to)

    setItems(data || [])
    setTotal(count || 0)
    setPage(targetPage)
    setLoading(false)
  }

  useEffect(() => { loadData(1) }, [])

  const dismiss = async (id: number) => {
    if (!confirm('¿Eliminar de la lista?')) return
    await supabase.from('price_opportunities').delete().eq('id', id)
    loadData(page)
  }

  const openLink = (cardName: string, isFoil: boolean) => {
    const query = `${cardName} ${isFoil ? '(Foil)' : ''}`
    const url = `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(query)}`
    window.open(url, '_blank')
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <TrendingUp className="text-emerald-600"/> Radar de Arbitraje (Compras)
            </h1>
            <p className="text-slate-500 text-sm">Margen superior al 40% (CK vs TCGPlayer). Total: {total}</p>
        </div>
        <button onClick={() => loadData(1)} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-bold flex items-center gap-2 hover:bg-slate-800 transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> Actualizar
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[500px]">
        {loading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400">Cargando oportunidades...</div>
        ) : items.length === 0 ? (
            <div className="p-12 text-center text-slate-500 flex-1 flex flex-col justify-center">
                <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-slate-300"/>
                <h3 className="text-lg font-bold text-slate-800">Sin oportunidades</h3>
                <p>No se encontraron cartas con margen superior al 40%.</p>
            </div>
        ) : (
            <>
            <div className="overflow-x-auto flex-1">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase sticky top-0 z-10">
                        <tr>
                            <th className="px-4 py-3">Carta / Acabado</th>
                            <th className="px-4 py-3 text-right">Venta (CK)</th>
                            <th className="px-4 py-3 text-right">Costo (TCG)</th>
                            <th className="px-4 py-3 text-center">Margen</th>
                            <th className="px-4 py-3 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {items.map((item) => {
                            const profit = Number(item.local_price) - Number(item.tcg_low)
                            return (
                                <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-14 bg-slate-200 rounded shrink-0 relative overflow-hidden border border-slate-200 shadow-sm">
                                                {item.image_url && <Image src={item.image_url} alt="" fill className="object-cover" />}
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-800 flex items-center gap-2">
                                                    {item.card_name}
                                                    {item.is_foil ? (
                                                        <span className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded border border-purple-200 flex items-center gap-1">
                                                            <Sparkles size={10}/> FOIL
                                                        </span>
                                                    ) : (
                                                        <span className="bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded border border-slate-200">
                                                            NORMAL
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-500">{item.set_name}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-600">
                                        US$ {Number(item.local_price).toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">
                                        US$ {Number(item.tcg_low).toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex flex-col items-center">
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-xs border border-emerald-200">
                                                +{Number(item.diff_percentage).toFixed(0)}%
                                            </span>
                                            <span className="text-[10px] text-slate-400 mt-1 font-mono">
                                                (+${profit.toFixed(2)})
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button 
                                                onClick={() => openLink(item.card_name, item.is_foil)}
                                                className="px-3 py-1.5 bg-[#0F172A] text-white rounded text-xs font-bold hover:bg-slate-800 flex items-center gap-1"
                                            >
                                                Comprar <ExternalLink size={12}/>
                                            </button>
                                            <button 
                                                onClick={() => dismiss(item.id)}
                                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                            >
                                                <Trash2 size={16}/>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>

            {/* PAGINACIÓN */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                <button 
                    onClick={() => loadData(page - 1)} 
                    disabled={page === 1}
                    className="flex items-center gap-1 px-3 py-2 rounded border border-slate-300 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={16}/> Anterior
                </button>
                <span className="text-sm text-slate-600 font-medium">
                    Página {page} de {totalPages || 1}
                </span>
                <button 
                    onClick={() => loadData(page + 1)} 
                    disabled={page >= totalPages}
                    className="flex items-center gap-1 px-3 py-2 rounded border border-slate-300 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Siguiente <ChevronRight size={16}/>
                </button>
            </div>
            </>
        )}
      </div>
    </div>
  )
}
