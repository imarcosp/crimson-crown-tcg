"use client"
import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, TrendingUp, Clock, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function SearchAnalyticsPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetchLogs = async () => {
      // Traemos las últimas 2000 búsquedas para analizar tendencias recientes
      const { data } = await supabase
        .from('search_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2000)
      
      if (data) setLogs(data)
      setLoading(false)
    }
    fetchLogs()
  }, [])

  // Procesar datos para "Top Búsquedas"
  const topSearches = useMemo(() => {
    const counts: Record<string, number> = {}
    logs.forEach(log => {
        // Normalizamos: minúsculas y quitamos espacios extra
        const term = (log.query || '').toLowerCase().trim()
        if (term.length < 3) return // Ignorar búsquedas muy cortas
        counts[term] = (counts[term] || 0) + 1
    })

    return Object.entries(counts)
        .sort(([, a], [, b]) => b - a) // Ordenar por cantidad
        .slice(0, 20) // Top 20
        .map(([term, count]) => ({ term, count }))
  }, [logs])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin" className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
            <ArrowLeft size={24}/>
        </Link>
        <div>
            <h1 className="text-2xl font-bold text-[#0F172A]">Reporte de Búsquedas</h1>
            <p className="text-sm text-slate-500">Descubre qué cartas están buscando tus clientes.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* TOP BÚSQUEDAS */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px]">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                <TrendingUp className="text-[#E91E63]" size={20}/>
                <h3 className="font-bold text-slate-800">Lo Más Buscado (Top 20)</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-0">
                {loading ? (
                    <div className="p-8 text-center text-slate-400">Analizando datos...</div>
                ) : topSearches.length === 0 ? (
                    <div className="p-8 text-center text-slate-400">No hay suficientes datos aún.</div>
                ) : (
                    <table className="w-full text-sm text-left">
                        <thead className="bg-white sticky top-0 z-10 text-xs font-bold text-slate-500 uppercase border-b border-slate-100">
                            <tr>
                                <th className="px-6 py-3">Término</th>
                                <th className="px-6 py-3 text-right">Intentos</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {topSearches.map((item, idx) => (
                                <tr key={item.term} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-3 font-medium text-slate-700 flex items-center gap-3">
                                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${idx < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                            #{idx + 1}
                                        </span>
                                        {item.term}
                                    </td>
                                    <td className="px-6 py-3 text-right font-bold text-[#E91E63]">
                                        {item.count}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>

        {/* HISTORIAL RECIENTE */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px]">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                <Clock className="text-blue-600" size={20}/>
                <h3 className="font-bold text-slate-800">Historial en Tiempo Real</h3>
            </div>
            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="p-8 text-center text-slate-400">Cargando...</div>
                ) : (
                    <table className="w-full text-sm text-left">
                        <thead className="bg-white sticky top-0 z-10 text-xs font-bold text-slate-500 uppercase border-b border-slate-100">
                            <tr>
                                <th className="px-6 py-3">Búsqueda</th>
                                <th className="px-6 py-3 text-right">Fecha</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {logs.slice(0, 50).map((log) => (
                                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-3 text-slate-600 truncate max-w-[200px]">
                                        {log.query}
                                    </td>
                                    <td className="px-6 py-3 text-right text-xs text-slate-400 font-mono">
                                        {new Date(log.created_at).toLocaleString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>

      </div>
    </div>
  )
}