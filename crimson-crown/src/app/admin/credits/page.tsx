'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, History, ArrowRightLeft, ShieldCheck, FileText } from 'lucide-react'

export default function AdminCreditsPage() {
  const supabase = createClient()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [selected, setSelected] = useState<any | null>(null)
  const [transactions, setTransactions] = useState<any[]>([]) // Estado para el historial
  const [loading, setLoading] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  
  // Estados formulario ajuste
  const [amount, setAmount] = useState<string>('')
  const [mode, setMode] = useState<'add' | 'sub'>('add')
  const [reason, setReason] = useState('')
  const [applying, setApplying] = useState(false)

  // Buscar usuarios
  const search = async () => {
    setLoading(true)
    setSelected(null)
    setTransactions([])
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,credits,first_name,last_name')
      .or(`email.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
      .limit(5)
    if (!error) setResults(data || [])
    setLoading(false)
  }

  // Cargar historial de un usuario
  const fetchHistory = async (userId: string) => {
    setLoadingHistory(true)
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50) // Traemos los últimos 50 movimientos
    
    if (!error) setTransactions(data || [])
    setLoadingHistory(false)
  }

  // Al seleccionar usuario
  const handleSelectUser = (u: any) => {
    setSelected(u)
    setResults([]) // Limpiar búsqueda para limpiar pantalla
    setQuery('')   // Opcional: limpiar input
    fetchHistory(u.id)
  }

  // Refrescar datos del usuario seleccionado
  const refreshSelected = async () => {
    if (!selected?.id) return
    const { data } = await supabase.from('profiles').select('id,email,credits,first_name,last_name').eq('id', selected.id).single()
    if (data) setSelected(data)
    fetchHistory(selected.id) // Refrescar historial también
  }

  // Aplicar ajuste manual
  const applyAdjust = async () => {
    if (!selected?.id) return
    if (!reason.trim()) { alert('Motivo requerido'); return }
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) { alert('Monto inválido'); return }
    
    setApplying(true)
    const change = mode === 'add' ? amt : -amt
    
    // Usamos el RPC manage_credits que ya maneja logs, pero aseguramos compatibilidad
    // Si tu RPC manage_credits usa "transaction_type", está bien.
    // Ajustaremos para que coincida con la estructura que definimos.
    const { error } = await supabase.rpc('manage_credits', {
      target_user_id: selected.id,
      amount_change: change,
      transaction_type: 'manual_adjustment',
      transaction_desc: reason,
      ref_id: null,
    })

    if (error) {
      alert('Error aplicando ajuste: ' + error.message)
    } else {
      alert('Ajuste aplicado correctamente')
      await refreshSelected()
      setAmount('')
      setReason('')
    }
    setApplying(false)
  }

  // Helpers visuales
  const getTypeLabel = (type: string) => {
    const map: Record<string, string> = {
        'manual_adjustment': 'Ajuste Manual',
        'transfer_sent': 'Transferencia Enviada',
        'transfer_received': 'Transferencia Recibida',
        'purchase': 'Compra',
        'refund': 'Reembolso',
        'buylist_credit': 'Venta (Buylist)'
    }
    return map[type] || type || 'General'
  }

  const getTypeColor = (type: string) => {
      if (type.includes('received') || type.includes('buylist') || type === 'refund') return 'text-emerald-600 bg-emerald-50 border-emerald-100'
      if (type.includes('sent') || type === 'purchase') return 'text-slate-600 bg-slate-50 border-slate-100'
      if (type === 'manual_adjustment') return 'text-purple-600 bg-purple-50 border-purple-100'
      return 'text-slate-600 bg-slate-50 border-slate-100'
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <ShieldCheck className="text-emerald-600"/> Gestión de Créditos
        </h1>
      </div>

      {/* BARRA DE BÚSQUEDA */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <label className="block text-sm font-bold text-slate-700 mb-2">Buscar Usuario</label>
        <div className="flex gap-2">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
                <input 
                    value={query} 
                    onChange={(e) => setQuery(e.target.value)} 
                    onKeyDown={(e) => e.key === 'Enter' && search()}
                    placeholder="Nombre, apellido o email..." 
                    className="w-full border border-slate-300 rounded-lg pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-900" 
                />
            </div>
            <button onClick={search} disabled={loading} className="px-6 py-2 rounded-lg bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors">
                {loading ? '...' : 'Buscar'}
            </button>
        </div>

        {/* RESULTADOS BÚSQUEDA */}
        {results.length > 0 && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 animate-in fade-in slide-in-from-top-2">
            {results.map((u) => (
              <button 
                key={u.id} 
                onClick={() => handleSelectUser(u)} 
                className="text-left p-3 rounded-lg border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 transition-all group"
              >
                <div className="font-bold text-slate-800 group-hover:text-emerald-700">{u.email}</div>
                <div className="text-xs text-slate-500">{u.first_name} {u.last_name}</div>
                <div className="mt-2 text-sm font-mono font-bold text-slate-600">Saldo: ${Number(u.credits || 0).toFixed(2)}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in zoom-in duration-300">
            
            {/* COLUMNA IZQUIERDA: CONTROL MANUAL */}
            <div className="lg:col-span-1 space-y-6">
                <div className="bg-slate-900 text-white rounded-xl p-6 shadow-lg">
                    <div className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-1">Usuario Seleccionado</div>
                    <div className="text-xl font-bold truncate" title={selected.email}>{selected.email}</div>
                    <div className="text-sm opacity-80 mb-6">{selected.first_name} {selected.last_name}</div>
                    
                    <div className="bg-white/10 rounded-lg p-4 border border-white/10 backdrop-blur-sm">
                        <div className="text-xs text-slate-300 uppercase mb-1">Saldo Actual</div>
                        <div className="text-3xl font-mono font-bold text-emerald-400">${Number(selected.credits || 0).toFixed(2)}</div>
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <ArrowRightLeft size={18}/> Ajuste Manual
                    </h3>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Acción</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => setMode('add')} className={`py-2 rounded text-sm font-bold border transition-colors ${mode === 'add' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>Sumar (+)</button>
                                <button onClick={() => setMode('sub')} className={`py-2 rounded text-sm font-bold border transition-colors ${mode === 'sub' ? 'bg-red-100 text-red-700 border-red-300' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>Restar (-)</button>
                            </div>
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Monto (USD)</label>
                            <input 
                                type="number" 
                                value={amount} 
                                onChange={(e) => setAmount(e.target.value)} 
                                placeholder="0.00"
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 font-mono font-bold text-slate-800 focus:ring-2 focus:ring-slate-900 outline-none"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Motivo / Nota Interna</label>
                            <textarea 
                                rows={2}
                                value={reason} 
                                onChange={(e) => setReason(e.target.value)} 
                                placeholder="Ej: Error en carga, bonus manual..."
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-900 outline-none resize-none"
                            />
                        </div>

                        <button 
                            onClick={applyAdjust} 
                            disabled={applying}
                            className={`w-full py-3 rounded-lg font-bold text-white shadow-md transition-transform active:scale-95 disabled:opacity-50 ${mode === 'add' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
                        >
                            {applying ? 'Procesando...' : mode === 'add' ? 'Confirmar Acreditación' : 'Confirmar Débito'}
                        </button>
                    </div>
                </div>
            </div>

            {/* COLUMNA DERECHA: HISTORIAL */}
            <div className="lg:col-span-2">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-full overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <History size={18}/> Historial de Movimientos
                        </h3>
                        <span className="text-xs font-bold text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">Últimos 50</span>
                    </div>
                    
                    <div className="flex-1 overflow-auto p-0">
                        {loadingHistory ? (
                            <div className="p-8 text-center text-slate-400">Cargando historial...</div>
                        ) : transactions.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 flex flex-col items-center">
                                <FileText size={32} className="mb-2 opacity-20"/>
                                Sin movimientos registrados
                            </div>
                        ) : (
                            <table className="w-full text-sm text-left">
                                <thead className="bg-white text-slate-500 font-bold text-xs uppercase sticky top-0 shadow-sm z-10">
                                    <tr>
                                        <th className="px-4 py-3">Fecha</th>
                                        <th className="px-4 py-3">Tipo</th>
                                        <th className="px-4 py-3">Descripción / Rastreo</th>
                                        <th className="px-4 py-3 text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {transactions.map((tx) => {
                                        const type = tx.type || tx.transaction_type || 'unknown'
                                        const desc = tx.transaction_desc || tx.description || 'Sin descripción'
                                        const amt = Number(tx.amount || tx.amount_change || 0)
                                        
                                        return (
                                            <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                                                    {new Date(tx.created_at).toLocaleDateString()}
                                                    <div className="text-[10px] opacity-70">{new Date(tx.created_at).toLocaleTimeString()}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-block px-2 py-1 rounded text-[10px] font-bold border uppercase tracking-wide ${getTypeColor(type)}`}>
                                                        {getTypeLabel(type)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 max-w-xs">
                                                    <div className="text-slate-800 font-medium truncate" title={desc}>{desc}</div>
                                                    {tx.ref_id && (
                                                        <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                                                            ID: {String(tx.ref_id).slice(0, 18)}...
                                                        </div>
                                                    )}
                                                </td>
                                                <td className={`px-4 py-3 text-right font-mono font-bold ${amt >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                    {amt > 0 ? '+' : ''}{amt.toFixed(2)}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  )
}