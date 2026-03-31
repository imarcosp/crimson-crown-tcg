"use client"
import { useState } from 'react'
import { ArrowRight, Search, Loader2, CheckCircle, Copy, Sparkles, AlertCircle, X, RefreshCw, Image as ImageIcon, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useBuylistStore } from '@/store/buylistStore'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function SellImportPage() {
  const [input, setInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [results, setResults] = useState<any[] | null>(null)
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  const [editingCard, setEditingCard] = useState<any>(null)
  const [versions, setVersions] = useState<any[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  
  // Store de Buylist
  const addItemsToSell = useBuylistStore((s) => s.addItemToSell)

  const handleAnalyze = async () => {
      if (!input.trim()) return
      setAnalyzing(true)
      setResults(null)
      
      try {
          let payload: any = {}

          // Si es un link de Moxfield, enviamos la URL al backend para que la procese allí
          // Esto evita el error de CORS y proxies en Vercel
          if (input.includes('moxfield.com/decks/')) {
              payload = { moxfieldUrl: input }
          } 
          // Si es texto plano, enviamos la lista
          else {
              payload = { deckList: input }
          }

          const res = await fetch('/api/buylist-parser', {
              method: 'POST',
              body: JSON.stringify(payload)
          })
          const data = await res.json()
          
          if (data.error) alert(data.error)
          else setResults(data)

      } catch (e) {
          alert('Error de conexión con el servidor.')
      } finally {
          setAnalyzing(false)
      }
  }

  const handleAddToBuylist = () => {
      if (!results || results.length === 0) return
      // Limpiar lista previa para evitar acumulados de sesiones anteriores
      useBuylistStore.getState().clearBuylist()
      
      results.forEach(item => {
          const isFoil = item.finish === 'foil' || item.finish === 'etched'
          const hasPrice = isFoil ? (item.priceUsdFoil > 0) : (item.priceUsd > 0)
          
          if (hasPrice) {
              useBuylistStore.getState().addItemToSell({
                  id: item.id,
                  name: item.name,
                  image_url: item.image_url,
                  set_name: item.set_name || item.set,
                  collector_number: item.collector_number,
                  tcg: item.tcg || 'Magic',
                  isFoil: isFoil,
                  finish: isFoil ? 'Foil' : 'Non-Foil',
                  foilLabel: item.finish === 'etched' ? 'Etched' : (isFoil ? 'Foil' : 'Normal'),
                  condition: 'NM', 
                  quantity: item.quantity,
                  priceUsd: item.priceUsd,
                  priceUsdFoil: item.priceUsdFoil,
                  scryfall_id: item.scryfall_id,
                  source: 'moxfield'
              })
          }
      })
      router.push('/buylist')
  }

  const handleRemoveFromResults = (index: number) => {
    setResults(prev => {
      if (!prev) return prev
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleToggleFoil = (index: number, isLocked: boolean) => {
      if (!results || isLocked) return // Prevenir cambio si está bloqueado
      const updated = [...results]
      const card = updated[index]
      if (card.finish === 'foil') card.finish = 'nonfoil'
      else card.finish = 'foil'
      setResults(updated)
  }

  const openVersionModal = async (index: number) => {
      if (!results) return
      const card = results[index]
      setEditingCard({ ...card, index })
      setLoadingVersions(true)
      try {
          const res = await fetch(`https://api.scryfall.com/cards/search?q=!"${card.name}" game:paper unique:prints&order=released`)
          const json = await res.json()
          const raw = (json.data || []).filter((v: any) => Array.isArray(v.games) && v.games.includes('paper') && !v.digital)
          const ids = raw.map((v: any) => v.id)
          let priceMap = new Map<string, any>()
          if (ids.length) {
            const { data: ext } = await supabase
              .from('external_prices')
              .select('scryfall_id, cardkingdom_retail_normal, cardkingdom_retail_foil, cardkingdom_retail_etched')
              .in('scryfall_id', ids)
            ext?.forEach((p: any) => priceMap.set(p.scryfall_id, p))
          }
          const enriched = raw.map((v: any) => {
            const p = priceMap.get(v.id)
            const ext_normal = Number(p?.cardkingdom_retail_normal || 0)
            const ext_foil = Math.max(Number(p?.cardkingdom_retail_foil || 0), Number(p?.cardkingdom_retail_etched || 0))
            return { ...v, ext_normal, ext_foil }
          })
          setVersions(enriched)
      } catch (e) {
          alert('Error buscando versiones.')
      } finally {
          setLoadingVersions(false)
      }
  }

  const selectVersion = async (v: any) => {
      if (!results || editingCard == null) return
      const idx = editingCard.index
      const selected = {
        quantity: results[idx].quantity,
        name: v.name,
        set_name: v.set_name,
        set: v.set,
        cn: v.collector_number,
        finish: results[idx].finish,
        image_url: v.image_uris?.normal || v.card_faces?.[0]?.image_uris?.normal || '',
        price_usd: 0,
        price_usd_foil: 0,
        scryfall_id: v.id
      }
      try {
        const res = await fetch('/api/buylist-parser', { method: 'POST', body: JSON.stringify({ cards: [selected] }) })
        const data = await res.json()
        const priced = (data?.[0]) || selected
        
        const newResults = [...results]
        newResults[idx] = {
          ...newResults[idx],
          name: priced.name,
          set_name: priced.set_name || v.set_name,
          collector_number: priced.collector_number || v.collector_number,
          image_url: priced.image_url || selected.image_url,
          priceUsd: priced.priceUsd || 0,
          priceUsdFoil: priced.priceUsdFoil || 0,
          scryfall_id: priced.scryfall_id || v.id
        }
        setResults(newResults)
      } catch {
        const newResults = [...results]
        newResults[idx] = {
          ...newResults[idx],
          set_name: v.set_name,
          collector_number: v.collector_number,
          image_url: selected.image_url,
          scryfall_id: v.id
        }
        setResults(newResults)
      } finally {
        setEditingCard(null)
      }
  }

  const totalOffer = results?.reduce((acc, item) => {
      const isFoil = item.finish === 'foil' || item.finish === 'etched'
      const base = isFoil ? item.priceUsdFoil : item.priceUsd
      return acc + (base * 0.75 * item.quantity)
  }, 0) || 0

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl relative pb-20">
        
        {/* MODAL ZOOM */}
        {zoomedImage && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
                <button className="absolute top-4 right-4 text-white/70 hover:text-white p-2 cursor-pointer z-50"><X size={32} /></button>
                <div className="relative w-full max-w-lg aspect-[3/4]">
                    <Image src={zoomedImage} alt="Zoom" fill className="object-contain rounded-lg" unoptimized />
                </div>
            </div>
        )}

        {/* MODAL CAMBIAR VERSIÓN */}
        {editingCard && (
            <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                <div className="bg-white rounded-xl w-full max-w-4xl max-h-[80vh] flex flex-col shadow-2xl">
                    <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
                        <h3 className="font-bold text-slate-800">Seleccionar Edición: {editingCard.name}</h3>
                        <button onClick={() => setEditingCard(null)} className="p-2 hover:bg-slate-200 rounded-full cursor-pointer"><X size={20}/></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 bg-slate-100">
                        {loadingVersions ? (
                            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-purple-600" size={32}/></div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                {versions.map((v) => (
                                    <button key={v.id} onClick={() => selectVersion(v)} className="relative group cursor-pointer text-left bg-white rounded-lg shadow-sm hover:shadow-md transition-all p-2 border border-transparent hover:border-purple-300">
                                        <div className="aspect-[3/4] relative rounded overflow-hidden border border-slate-200">
                                            <Image src={v.image_uris?.normal || v.card_faces?.[0]?.image_uris?.normal || ''} alt="" fill className="object-cover" unoptimized/>
                                        </div>
                                        <div className="mt-2 text-center">
                                            <div className="text-[10px] font-bold text-slate-700 uppercase truncate px-1">{v.set_name}</div>
                                            <div className="text-[10px] text-slate-500">#{v.collector_number}</div>
                                            <div className="mt-1 flex justify-center gap-2 text-[10px] font-mono">
                                                {v.ext_normal > 0 && <span className="text-emerald-600 font-bold">${v.ext_normal.toFixed(2)}</span>}
                                                {v.ext_foil > 0 && <span className="text-purple-600 font-bold bg-purple-50 px-1 rounded">F:${v.ext_foil.toFixed(2)}</span>}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        <div className="text-center mb-10">
            <h1 className="text-3xl font-extrabold text-slate-900 mb-2 flex items-center justify-center gap-3">
                <Sparkles className="text-purple-600" size={32}/> Importar Venta Masiva
            </h1>
            <p className="text-slate-500 max-w-xl mx-auto">
                Cotización automática al <strong>75% del valor de mercado</strong> (Referencia CardKingdom/TCGPlayer).
            </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm h-full flex flex-col">
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Enlace Moxfield / Lista</label>
                        <button onClick={() => setInput('')} className="text-xs text-red-500 hover:text-red-700 font-bold cursor-pointer">Limpiar</button>
                    </div>
                    <textarea 
                        className="flex-1 w-full min-h-[400px] bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                        placeholder={`https://moxfield.com/decks/...\nO:\n4 Mental Misstep\n1 Sol Ring\n...`}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                    />
                    <div className="mt-4">
                        <button onClick={handleAnalyze} disabled={analyzing || !input.trim()} className="w-full py-3 bg-[#0F172A] hover:bg-slate-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg cursor-pointer">
                            {analyzing ? <Loader2 className="animate-spin" /> : <Search size={20}/>} Analizar Lista
                        </button>
                    </div>
                </div>
            </div>

            <div className="space-y-6">
                {!results && !analyzing && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl p-12 bg-slate-50/50">
                        <Copy size={48} className="mb-4 opacity-50"/>
                        <p className="text-sm font-medium">Los resultados aparecerán aquí.</p>
                    </div>
                )}

                {results && (
                    <div className="space-y-4 animate-in slide-in-from-bottom-4">
                        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex justify-between items-center sticky top-20 z-10 shadow-sm">
                            <div>
                                <p className="text-emerald-800 font-bold text-lg">Oferta Total: US$ {totalOffer.toFixed(2)}</p>
                                <p className="text-emerald-600 text-xs">{results.length} cartas • {results.reduce((a,b) => a + b.quantity, 0)} unidades</p>
                            </div>
                            <button onClick={handleAddToBuylist} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-md transition-colors cursor-pointer flex items-center gap-2 text-sm">
                                Procesar Venta <ArrowRight size={16}/>
                            </button>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden max-h-[600px] overflow-y-auto">
                            {results.map((card: any, i: number) => {
                                const isFoil = card.finish === 'foil' || card.finish === 'etched'
                                const basePrice = isFoil ? (card.priceUsdFoil || 0) : (card.priceUsd || 0)
                                const offer = basePrice * 0.75
                                
                                const hasNormal = (card.priceUsd || 0) > 0
                                const hasFoilPrice = (card.priceUsdFoil || 0) > 0
                                const isLocked = !(hasNormal && hasFoilPrice) 
                                const lockLabel = (!hasNormal && hasFoilPrice) ? 'Solo Foil' : (hasNormal && !hasFoilPrice) ? 'Solo Normal' : ''

                                return (
                                <div key={i} className="flex flex-col sm:flex-row gap-3 p-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                                    <div className="w-16 h-24 bg-slate-200 rounded shrink-0 overflow-hidden relative border border-slate-200 cursor-zoom-in self-start sm:self-center" onClick={() => card.image_url && setZoomedImage(card.image_url)}>
                                        {card.image_url ? <Image src={card.image_url} alt="" fill className="object-cover" unoptimized/> : <div className="w-full h-full flex flex-col items-center justify-center text-[10px] text-slate-400 p-1 text-center"><ImageIcon size={16} className="mb-1 opacity-50"/>Sin Foto</div>}
                                    </div>
                                    <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                                        <div className="flex justify-between items-start gap-2">
                                            <p className="font-bold text-slate-800 text-sm truncate">{card.name}</p>
                                            <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded whitespace-nowrap">x{card.quantity}</span>
                                        </div>
                                        
                                        <div className="flex flex-wrap gap-2 mt-2 items-center">
                                            <div className="flex items-center rounded border border-blue-100 overflow-hidden bg-blue-50">
                                                <span className="text-[10px] font-bold text-blue-700 px-2 py-1 border-r border-blue-100 truncate max-w-[120px]" title={card.set_name}>
                                                    {card.set_name || card.set} #{card.collector_number}
                                                </span>
                                                <button onClick={() => openVersionModal(i)} className="flex items-center gap-1 text-[10px] font-bold text-blue-600 px-2 py-1 hover:bg-blue-100 transition-colors cursor-pointer" title="Cambiar Edición">
                                                    <RefreshCw size={10}/>
                                                </button>
                                            </div>
                                            
                                            <label className={`flex items-center gap-1 cursor-pointer select-none text-[10px] font-bold px-2 py-1 rounded border transition-colors ${isLocked ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed' : 'text-slate-600 bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={isFoil} 
                                                    onChange={() => handleToggleFoil(i, isLocked)} 
                                                    className={`accent-purple-600 w-3 h-3 rounded-sm ${isLocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                                    disabled={isLocked}
                                                /> 
                                                {isLocked ? lockLabel : 'Foil'}
                                            </label>
                                        </div>
                                    </div>
                                    
                                    <div className="text-right flex flex-row sm:flex-col justify-between sm:justify-center items-center sm:items-end gap-4 sm:gap-1 border-t sm:border-t-0 border-slate-100 pt-2 sm:pt-0 mt-2 sm:mt-0 min-w-[100px]">
                                        <div>
                                            <div className="flex justify-between sm:justify-end gap-2 text-[10px] text-slate-400">
                                                <span>Mercado:</span> <span>${basePrice.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between sm:justify-end gap-2">
                                                <span className="text-xs font-bold text-emerald-700">Oferta:</span>
                                                <span className="text-sm font-bold text-emerald-600">${offer.toFixed(2)}</span>
                                            </div>
                                        </div>
                                        <button onClick={() => handleRemoveFromResults(i)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer" title="Eliminar"><Trash2 size={16}/></button>
                                    </div>
                                </div>
                            )})}
                        </div>
                        
                        <div className="flex items-start gap-2 bg-amber-50 p-3 rounded-lg text-amber-800 text-xs border border-amber-100">
                            <AlertCircle size={16} className="shrink-0 mt-0.5"/>
                            <p>Importante: Al hacer clic en "Procesar Venta", estas cartas se agregarán a tu lista de venta manual donde podrás ajustar el estado (NM/EX/VG) antes de confirmar.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    </div>
  )
}
