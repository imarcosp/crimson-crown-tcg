"use client"
import { useState, useEffect, useRef, Suspense } from 'react'
import { ArrowRight, Search, ShoppingCart, Loader2, CheckCircle, Plane, Copy, Sparkles, Plus, X, ZoomIn, RefreshCw, ChevronDown, Image as ImageIcon, AlertTriangle, ExternalLink } from 'lucide-react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { useQuoteStore } from '@/store/quoteStore'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useConfig } from '@/context/ConfigContext'

// --- CONTENIDO DEL COMPONENTE (Lógica Principal) ---
function MoxfieldToolContent() {
  const [input, setInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [results, setResults] = useState<any>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [fallbackGuide, setFallbackGuide] = useState<{ title: string; steps: string[]; requestId?: string | null } | null>(null)
  
  // Estados UI
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  const [editingCard, setEditingCard] = useState<any>(null)
  const [versions, setVersions] = useState<any[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [lastAddedIndex, setLastAddedIndex] = useState<number | null>(null)
  const [lastRemovedIndex, setLastRemovedIndex] = useState<number | null>(null)

  const addItemToCart = useCartStore((s) => s.addItem)
  const removeItemFromCart = useCartStore((s) => s.removeItem)
  const cartItems = useCartStore((s) => s.items)
  const toggleCart = useUIStore((s) => s.toggleCart)
  const toggleHangModal = useUIStore((s) => s.toggleHangModal)
  const addQuoteItem = useQuoteStore((s) => s.addItem)
  const quoteItems = useQuoteStore((s) => s.items)
  const updateQuoteQuantity = useQuoteStore((s) => s.updateQuantity)
  const supabase = createClient()
  const { enableImports } = useConfig()

  // Hooks para Auto-Detección desde Buscador
  const searchParams = useSearchParams()
  const hasAutoAnalyzed = useRef(false)

  const handleAnalyze = async (manualInput?: string) => {
      const textToProcess = typeof manualInput === 'string' ? manualInput : input
      
      if (!textToProcess.trim()) return
      setAnalyzing(true)
      setResults(null)
      setInlineError(null)
      setFallbackGuide(null)
      
      try {
          let payload: any = {}
          const isMoxfieldUrl = textToProcess.includes('moxfield.com/decks/')

          // Detectamos si es URL o Texto
          if (isMoxfieldUrl) {
              payload = { moxfieldUrl: textToProcess }
          } else {
              payload = { deckList: textToProcess }
          }

          const res = await fetch('/api/deck-parser', {
              method: 'POST',
              body: JSON.stringify(payload)
          })
          const data = await res.json()
          
          if (data.error) {
            const lowerError = String(data.error || '').toLowerCase()
            const shouldShowFallback =
              isMoxfieldUrl &&
              (lowerError.includes('moxfield') ||
                lowerError.includes('mazo') ||
                lowerError.includes('público') ||
                lowerError.includes('publico'))

            if (shouldShowFallback) {
              setInlineError('Parece que en este momento no podemos conectarnos con Moxfield para importar el mazo automáticamente.')
              setFallbackGuide({
                title: 'Puedes continuar igualmente pegando la lista en texto plano.',
                requestId: data.requestId || null,
                steps: [
                  'Ingresa a tu mazo en Moxfield.',
                  'Haz clic en "More" o en el menú de más opciones.',
                  'Selecciona "Export".',
                  'Elige "Copy plain text" o la opción de copiar la lista en texto plano.',
                  'Pega ese texto en el cuadro de abajo y haz clic en "Analizar".',
                ],
              })
            } else {
              setInlineError(data.error)
            }
          } else setResults(data)

      } catch (e) {
          setInlineError('Error de conexión con el servidor.')
      } finally {
          setAnalyzing(false)
      }
  }

  // EFECTO: Auto-Analizar si viene "?deck=" en la URL
  useEffect(() => {
      const deckParam = searchParams.get('deck')
      if (deckParam && !hasAutoAnalyzed.current) {
          hasAutoAnalyzed.current = true
          setInput(deckParam)
          handleAnalyze(deckParam)
      }
  }, [searchParams])

  // ... (Resto de funciones de Stock, Importación, Modales, etc. idénticas a tu archivo original) ...
  // [SE MANTIENE EL CÓDIGO ORIGINAL DE UI AQUÍ ABAJO SIN CAMBIOS]
  
  // --- FUNCIONES DE STOCK ---
  const handleAddStockItem = (card: any) => {
      addItemToCart({
          id: card.id, name: card.name, set_name: card.set_name, price: card.price_usd,
          image: card.image_url, finish: card.finish, quantity: 1, stock: card.stock
      })
  }

  const handleAddAllStock = () => {
      if (!results?.inStock) return
      results.inStock.forEach((card: any) => handleAddStockItem(card))
      toggleCart()
  }

  const handleAddStockItemAt = (idx: number, card: any) => {
      handleAddStockItem(card)
      setLastAddedIndex(idx)
      setTimeout(() => setLastAddedIndex(null), 1200)
  }

  const handleRemoveStockItemAt = (idx: number, card: any) => {
      removeItemFromCart(card.id)
      setLastRemovedIndex(idx)
      setTimeout(() => setLastRemovedIndex(null), 1200)
  }

  // --- FUNCIONES DE IMPORTACIÓN ---
  const calculateImportPrice = (basePrice: number) => {
      if (!basePrice || basePrice <= 0) return 0
      return (basePrice * 1.08) + 0.5
  }

  const handleAddMissingItem = (card: any) => {
      const isFoil = card.finish === 'foil' || card.finish === 'etched'
      const match = (quoteItems || []).find((q: any) => (
        String(q.name).toLowerCase() === String(card.name).toLowerCase() &&
        Boolean(q.isFoil) === Boolean(isFoil) &&
        String(q.collectorNumber || '').toLowerCase() === String(card.cn || '').toLowerCase() &&
        String((q as any).scryfall_id || '').toLowerCase() === String(card.scryfall_id || '').toLowerCase()
      ))
      if (match) {
        updateQuoteQuantity(match.id, Number(match.quantity || 1) + Number(card.quantity || 1))
      } else {
        addQuoteItem({
            id: `missing-${card.name}-${Date.now()}`,
            name: card.name,
            setName: card.set_name || card.set || 'Cualquiera',
            collectorNumber: card.cn || '',
            image: card.image_url || '', 
            quantity: card.quantity,
            isFoil: isFoil,
            foilLocked: false, 
            foilLabel: isFoil ? 'Foil' : 'Normal',
            rawNormal: card.price_usd || 0,
            rawFoil: card.price_usd_foil || 0,
            price: 0,
            scryfall_id: card.scryfall_id || undefined
        } as any)
      }
      toggleHangModal()
  }

  const handleToggleFoil = (index: number) => {
      const newMissing = [...results.missing]
      const card = newMissing[index]
      if (card.finish === 'foil') card.finish = 'nonfoil'
      else card.finish = 'foil'
      setResults({ ...results, missing: newMissing })
  }

  // --- CAMBIAR VERSIÓN (SCRYFALL) ---
  const openVersionModal = async (cardIndex: number) => {
      const card = results.missing[cardIndex]
      setEditingCard({ ...card, index: cardIndex })
      setLoadingVersions(true)
      try {
          const res = await fetch(`https://api.scryfall.com/cards/search?q=!"${card.name}" game:paper unique:prints&order=released`)
          const json = await res.json()
          const rawVersions = (json.data || []).filter((v: any) => Array.isArray(v.games) && v.games.includes('paper') && !v.digital)
          const ids = rawVersions.map((v: any) => v.id).filter(Boolean)
          let priceMap = new Map<string, any>()
          if (ids.length) {
            const { data: ext } = await supabase
              .from('external_prices')
              .select('*')
              .in('scryfall_id', ids)
            ext?.forEach((p: any) => priceMap.set(p.scryfall_id, p))
          }
const enriched = rawVersions.map((v: any) => {
            const p = priceMap.get(v.id)
            let ext_normal = 0
            let ext_foil = 0
            if (p) {
              const ckN = Number(p.cardkingdom_retail_normal || 0)
              const tcgN = Number(p.tcgplayer_market_normal || 0)
              const ckF = Number(p.cardkingdom_retail_foil || 0)
              const ckE = Number(p.cardkingdom_retail_etched || 0)
              const tcgF = Number(p.tcgplayer_market_foil || 0)
              
              // FIX BUG 1: Prioridad estricta CardKingdom
              ext_normal = ckN > 0 ? ckN : tcgN
              ext_foil = ckF > 0 ? ckF : (ckE > 0 ? ckE : tcgF)
            }
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
      const idx = editingCard.index
      const selected = {
        quantity: results.missing[idx].quantity,
        name: v.name,
        set_name: v.set_name,
        set: v.set,
        cn: v.collector_number,
        finish: results.missing[idx].finish,
        image_url: v.image_uris?.normal || v.card_faces?.[0]?.image_uris?.normal || '',
        price_usd: 0,
        price_usd_foil: 0,
        scryfall_id: v.id
      }
      try {
        const res = await fetch('/api/deck-parser', { method: 'POST', body: JSON.stringify({ cards: [selected] }) })
        const data = await res.json()
        const priced = (data?.missing?.[0]) || selected
        const newMissing = [...results.missing]
        newMissing[idx] = {
          ...newMissing[idx],
          set: priced.set || v.set,
          set_name: priced.set_name || v.set_name,
          cn: priced.cn || v.collector_number,
          image_url: priced.image_url || selected.image_url,
          price_usd: priced.price_usd || 0,
          price_usd_foil: priced.price_usd_foil || 0,
          scryfall_id: priced.scryfall_id || v.id
        }
        setResults({ ...results, missing: newMissing })
      } catch {
        const newMissing = [...results.missing]
        newMissing[idx] = {
          ...newMissing[idx],
          set: v.set,
          set_name: v.set_name,
          cn: v.collector_number,
          image_url: selected.image_url,
          price_usd: 0,
          price_usd_foil: 0,
          scryfall_id: v.id
        }
        setResults({ ...results, missing: newMissing })
      } finally {
        setEditingCard(null)
      }
  }

  const handleQuoteAllMissing = () => {
      if (!results?.missing) return
      results.missing.forEach((card: any) => {
          const isFoil = card.finish === 'foil' || card.finish === 'etched'
          const match = (quoteItems || []).find((q: any) => (
            String(q.name).toLowerCase() === String(card.name).toLowerCase() &&
            Boolean(q.isFoil) === Boolean(isFoil) &&
            String(q.collectorNumber || '').toLowerCase() === String(card.cn || '').toLowerCase() &&
            String((q as any).scryfall_id || '').toLowerCase() === String(card.scryfall_id || '').toLowerCase()
          ))
          if (match) {
            updateQuoteQuantity(match.id, Number(match.quantity || 1) + Number(card.quantity || 1))
          } else {
            addQuoteItem({
                id: `missing-${card.name}-${Math.random()}`,
                name: card.name,
                setName: card.set_name || card.set || 'Cualquiera',
                collectorNumber: card.cn || '',
                image: card.image_url,
                quantity: card.quantity,
                isFoil: isFoil,
                foilLocked: false,
                foilLabel: isFoil ? 'Foil' : 'Normal',
                rawNormal: card.price_usd || 0,
                rawFoil: card.price_usd_foil || 0,
                price: 0,
                scryfall_id: card.scryfall_id || undefined
            } as any)
          }
      })
      toggleHangModal()
  }

  // Completar imagen por scryfall_id para items "Para Importar"
  useEffect(() => {
    if (!results || !Array.isArray(results.missing) || results.missing.length === 0) return
    const need = results.missing.filter((c: any) => (!c.image_url || c.image_url === ''))
    if (need.length === 0) return
    let cancelled = false
    ;(async () => {
      const updated = [...results.missing]
      for (let i = 0; i < updated.length; i++) {
        const c = updated[i]
        if (!c.image_url || c.image_url === '') {
          try {
            let img = ''
            if (c.scryfall_id) {
              const r = await fetch(`https://api.scryfall.com/cards/${c.scryfall_id}`)
              if (r.ok) {
                const j = await r.json()
                img = j.image_uris?.normal || j.card_faces?.[0]?.image_uris?.normal || ''
              }
            }
            if (!img) {
              const q = encodeURIComponent(c.name)
              const r2 = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${q}`)
              if (r2.ok) {
                const j2 = await r2.json()
                img = j2.image_uris?.normal || j2.card_faces?.[0]?.image_uris?.normal || ''
              }
            }
            if (img) updated[i] = { ...c, image_url: img }
          } catch {}
        }
      }
      if (!cancelled) setResults({ ...results, missing: updated })
    })()
    return () => { cancelled = true }
  }, [results])

  // Enriquecer precios base en "Para Importar" usando la misma lógica del modal (CK → TCG) y Scryfall para deducir id
  useEffect(() => {
    if (!results || !Array.isArray(results.missing) || results.missing.length === 0) return
    const need = results.missing
      .map((c: any, i: number) => ({ c, i }))
      .filter(({ c }: { c: any; i: number }) => !(Number(c.price_usd) > 0 || Number(c.price_usd_foil) > 0))
    if (need.length === 0) return
    let cancelled = false
    ;(async () => {
      const updated = [...results.missing]
      const idToIdxs = new Map<string, number[]>()
      const uuidRe = /^[0-9a-fA-F-]{36}$/
      // Deducir scryfall_id por item cuando sea necesario
      for (const { c, i } of need) {
        let id: string | null = typeof c.scryfall_id === 'string' && uuidRe.test(c.scryfall_id) ? c.scryfall_id : null
        if (!id) {
          try {
            const nameQ = encodeURIComponent(c.name)
            const setQ = c.set ? ` set:${encodeURIComponent(c.set)}` : ''
            const cnQ = c.cn ? ` cn:${encodeURIComponent(c.cn)}` : ''
            const r = await fetch(`https://api.scryfall.com/cards/search?q=!"${nameQ}"${setQ}${cnQ} game:paper unique:prints&order=released`)
            if (r.ok) {
              const j = await r.json()
              const list = Array.isArray(j?.data) ? j.data : []
              const cnClean = String(c.cn || '').toLowerCase().replace(/[^a-z0-9]/g, '')
              let cand = null as any
              if (c.cn) cand = list.find((v: any) => String(v.collector_number).toLowerCase().replace(/[^a-z0-9]/g,'') === cnClean) || null
              if (!cand && c.set) cand = list.find((v: any) => String(v.set).toLowerCase() === String(c.set).toLowerCase()) || null
              if (!cand) cand = list.find((v: any) => Array.isArray(v.games) && v.games.includes('paper')) || null
              if (cand) id = cand.id
            }
          } catch {}
        }
        if (id) {
          updated[i] = { ...updated[i], scryfall_id: updated[i].scryfall_id || id }
          const arr = idToIdxs.get(id) || []
          arr.push(i)
          idToIdxs.set(id, arr)
        }
      }
      const ids = Array.from(idToIdxs.keys())
      if (ids.length === 0) {
        if (!cancelled) setResults({ ...results, missing: updated })
        return
      }
      try {
        const { data: prices } = await supabase
          .from('external_prices')
          .select('*')
          .in('scryfall_id', ids)
        const priceMap = new Map<string, any>()
        ;(prices || []).forEach((p: any) => { if (p?.scryfall_id) priceMap.set(String(p.scryfall_id), p) })
        for (const id of ids) {
          const idxs = idToIdxs.get(id) || []
          const p = priceMap.get(id)
          let ckN = 0, ckF = 0, ckE = 0, tcgN = 0, tcgF = 0
          if (p) {
            ckN = Number(p.cardkingdom_retail_normal || 0)
            ckF = Number(p.cardkingdom_retail_foil || 0)
            ckE = Number(p.cardkingdom_retail_etched || 0)
            tcgN = Number(p.tcgplayer_market_normal || 0)
            tcgF = Number(p.tcgplayer_market_foil || 0)
          }
          const bestNormal = ckN > 0 ? ckN : tcgN
          const bestFoil = (ckF > 0 || ckE > 0) ? Math.max(ckF, ckE) : Math.max(tcgF, 0)
          for (const i of idxs) {
            const item = updated[i]
            if (bestNormal > 0) updated[i] = { ...item, price_usd: bestNormal }
            if (bestFoil > 0) updated[i] = { ...updated[i], price_usd_foil: bestFoil }
          }
        }
      } catch {}
      if (!cancelled) setResults({ ...results, missing: updated })
    })()
    return () => { cancelled = true }
  }, [results])

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl relative pb-20">
        
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
            <h1 className="text-4xl font-extrabold text-slate-900 mb-2 flex items-center justify-center gap-3">
                <Sparkles className="text-purple-600" size={32}/> Importar Mazo
            </h1>
            <p className="text-slate-500 max-w-2xl mx-auto text-sm">
                Pega tu lista o enlace de <strong>Moxfield</strong>. Detectaremos automáticamente las versiones exactas.
            </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-4 space-y-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm h-full flex flex-col">
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Lista / Enlace</label>
                        <button
                          onClick={() => {
                            setInput('')
                            setInlineError(null)
                            setFallbackGuide(null)
                            setResults(null)
                          }}
                          className="text-xs text-red-500 hover:text-red-700 font-bold cursor-pointer"
                        >
                          Limpiar
                        </button>
                    </div>
                    {inlineError && (
                      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:p-4 text-left">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 shrink-0 rounded-full bg-amber-100 p-2 text-amber-700">
                            <AlertTriangle size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-amber-900">{inlineError}</p>
                            {fallbackGuide?.title && (
                              <p className="mt-1 text-xs sm:text-sm text-amber-800">{fallbackGuide.title}</p>
                            )}
                            {fallbackGuide?.requestId && (
                              <p className="mt-1 text-[11px] text-amber-700/90 break-all">
                                ID de referencia: {fallbackGuide.requestId}
                              </p>
                            )}
                          </div>
                        </div>
                        {fallbackGuide && (
                          <div className="mt-3 rounded-lg border border-amber-200 bg-white/70 p-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Pasos a seguir</p>
                            <ol className="mt-2 space-y-2 text-sm text-slate-700">
                              {fallbackGuide.steps.map((step, index) => (
                                <li key={index} className="flex items-start gap-2">
                                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-800">
                                    {index + 1}
                                  </span>
                                  <span>{step}</span>
                                </li>
                              ))}
                            </ol>
                            <a
                              href={input && input.includes('moxfield.com/decks/') ? input : 'https://www.moxfield.com/'}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900 transition-colors hover:bg-amber-200 cursor-pointer"
                            >
                              Abrir Moxfield
                              <ExternalLink size={14} />
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                    <textarea 
                        className="flex-1 w-full min-h-[300px] bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                        placeholder={`https://moxfield.com/decks/...\n\nSi no funciona el enlace, pega aquí el texto exportado desde Moxfield.\n\nEjemplo:\n4 Mental Misstep\n1 Sol Ring`}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                    />
                    <div className="mt-4">
                        <button 
                            onClick={() => handleAnalyze()}
                            disabled={analyzing || !input.trim()}
                            className="w-full py-3 bg-[#0F172A] hover:bg-slate-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg cursor-pointer"
                        >
                            {analyzing ? <Loader2 className="animate-spin" /> : <Search size={20}/>}
                            Analizar
                        </button>
                    </div>
                </div>
            </div>

            <div className="lg:col-span-8 space-y-6">
                {!results && !analyzing && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl p-12 bg-slate-50/30">
                        <Copy size={48} className="mb-4 opacity-50"/>
                        <p className="text-sm font-medium">Los resultados aparecerán aquí.</p>
                    </div>
                )}

                {results && (
                    <div className="space-y-8 animate-in slide-in-from-bottom-4">
                        
                        {/* EN STOCK */}
                        <div className="bg-white rounded-xl border border-emerald-200 shadow-sm overflow-hidden">
                            <div className="p-4 bg-emerald-50 border-b border-emerald-100 flex justify-between items-center">
                                <h3 className="font-bold text-emerald-800 flex items-center gap-2"><CheckCircle size={18}/> Disponibles ({results.inStock.length})</h3>
                                {results.inStock.length > 0 && (
                                    <button onClick={handleAddAllStock} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-2 transition-colors shadow-sm cursor-pointer">
                                        <ShoppingCart size={14}/> Agregar Todo
                                    </button>
                                )}
                            </div>
                            <div className="max-h-[400px] overflow-y-auto p-2 space-y-2">
                                {results.inStock.length === 0 ? (
                                    <p className="text-center py-8 text-slate-400 text-sm">No encontramos coincidencias en stock.</p>
                                ) : (
                                    results.inStock.map((card: any, i: number) => {
                                        const finishLower = String(card.finish || '').toLowerCase()
                                        const isFoil = finishLower.includes('foil') && !finishLower.includes('non')
                                        const isEtched = finishLower.includes('etched')
                                        const inCart = Array.isArray(cartItems) && cartItems.some((ci: any) => ci.id === card.id)
                                        return (
                                        <div key={i} className="relative flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg group bg-white border border-slate-100">
                                            <div className="w-12 h-16 bg-slate-200 rounded shrink-0 overflow-hidden relative border border-slate-200 cursor-zoom-in" onClick={() => card.image_url && setZoomedImage(card.image_url)}>
                                                {card.image_url && <Image src={card.image_url} alt="" fill className="object-cover" unoptimized/>}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-slate-800 text-sm truncate">{card.name}</p>
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    <span className="text-[10px] bg-slate-100 px-1.5 rounded text-slate-600 border border-slate-200">{card.set_name}</span>
                                                    {isFoil && <span className="text-[10px] bg-purple-100 px-1.5 rounded text-purple-700 border border-purple-200 font-bold">Foil</span>}
                                                    {isEtched && <span className="text-[10px] bg-amber-100 px-1.5 rounded text-amber-800 border border-amber-200 font-bold">Etched</span>}
                                                    {!isFoil && !isEtched && <span className="text-[10px] bg-slate-50 px-1.5 rounded text-slate-500 border border-slate-200">Normal</span>}
                                                    {card.condition && <span className={`text-[10px] px-1.5 rounded border font-bold ${card.condition === 'NM' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}>{card.condition}</span>}
                                                    {card.language && <span className="text-[10px] bg-blue-50 px-1.5 rounded text-blue-700 border border-blue-200">{card.language.substring(0,3).toUpperCase()}</span>}
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col items-end gap-1">
                                                <div className="text-right">
                                                    <p className="font-bold text-emerald-600 text-sm">US$ {Number(card.price_usd || 0).toFixed(2)}</p>
                                                    <span className="text-[10px] text-slate-400">Stock: {card.stock}</span>
                                                </div>
                                                {inCart ? (
                                                  <button onClick={() => handleRemoveStockItemAt(i, card)} className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors cursor-pointer flex items-center gap-1" title="Quitar del carrito" aria-label="Quitar del carrito">
                                                    <X size={14}/> Quitar
                                                  </button>
                                                ) : (
                                                  <button onClick={() => handleAddStockItemAt(i, card)} className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors cursor-pointer flex items-center gap-1" title="Agregar al carrito" aria-label="Agregar al carrito">
                                                    <ShoppingCart size={14}/> Agregar
                                                  </button>
                                                )}
                                            </div>
                                            {lastAddedIndex === i && (
                                              <div className="absolute right-2 top-2 bg-emerald-600 text-white text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 animate-in fade-in zoom-in">
                                                <CheckCircle size={12}/> Agregado
                                              </div>
                                            )}
                                            {lastRemovedIndex === i && (
                                              <div className="absolute right-2 top-2 bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 animate-in fade-in zoom-in">
                                                <X size={12}/> Quitado
                                              </div>
                                            )}
                                        </div>
                                    )})
                                )}
                            </div>
                        </div>

                        {enableImports && (
                            <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
                                <div className="p-4 bg-amber-50 border-b border-amber-100 flex justify-between items-center">
                                    <h3 className="font-bold text-amber-800 flex items-center gap-2"><Plane size={18}/> Para Importar ({results.missing.length})</h3>
                                    {results.missing.length > 0 && <button onClick={handleQuoteAllMissing} className="px-3 py-1.5 bg-[#9D1B1B] hover:bg-[#d81557] text-white text-xs font-bold rounded-lg flex items-center gap-2 transition-colors shadow-sm cursor-pointer"><ArrowRight size={14}/> Cotizar Todo</button>}
                                </div>
                                <div className="max-h-[500px] overflow-y-auto p-2 space-y-2">
                                    {results.missing.length === 0 ? <p className="text-center py-8 text-slate-400 text-sm">¡Tienes todo disponible!</p> : (
                                        results.missing.map((card: any, i: number) => {
                                            const isFoil = card.finish === 'foil' || card.finish === 'etched'
                                            const basePrice = isFoil ? (card.price_usd_foil || 0) : (card.price_usd || 0)
                                            const importPrice = calculateImportPrice(basePrice)
                                            return (
                                            <div key={i} className="flex flex-col sm:flex-row gap-4 p-3 hover:bg-amber-50/20 rounded-xl bg-white border border-slate-100 transition-colors">
                                                <div className="w-20 h-28 bg-slate-200 rounded-lg shrink-0 overflow-hidden relative border border-slate-200 cursor-zoom-in self-start" onClick={() => card.image_url && setZoomedImage(card.image_url)}>
                                                    {card.image_url ? <Image src={card.image_url} alt="" fill className="object-cover" unoptimized/> : <div className="w-full h-full flex flex-col items-center justify-center text-xs text-slate-400 p-2 text-center bg-slate-100"><ImageIcon size={24} className="mb-1 opacity-50"/>Sin Foto</div>}
                                                </div>
                                                <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                                                    <div>
                                                        <div className="flex justify-between items-start gap-2">
                                                            <p className="font-bold text-slate-800 text-base">{card.name}</p>
                                                            <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded whitespace-nowrap">x{card.quantity}</span>
                                                        </div>
                                                        
                                                        <div className="flex flex-wrap gap-2 mt-2 items-center">
                                                            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-1 rounded border border-blue-100 truncate max-w-[180px]" title={card.set_name || card.set}>
                                                                {card.set_name || (card.set ? card.set.toUpperCase() : 'Base')} {card.cn ? `#${card.cn}` : ''}
                                                            </span>

                                                            <button onClick={() => openVersionModal(i)} className="flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200 hover:bg-slate-200 transition-colors cursor-pointer" title="Cambiar Edición">
                                                                Cambiar Versión <RefreshCw size={10}/>
                                                            </button>
                                                            
                                                            <label className="flex items-center gap-1 cursor-pointer select-none text-[10px] font-bold text-slate-600 bg-slate-50 px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 transition-colors">
                                                                <input type="checkbox" checked={isFoil} onChange={() => handleToggleFoil(i)} className="accent-purple-600 w-3 h-3 cursor-pointer"/> Foil
                                                            </label>
                                                        </div>
                                                    </div>
                                                    <div className="mt-3 text-xs text-slate-500 flex items-center gap-1.5 bg-slate-50 w-fit px-2 py-1 rounded">📦 Disponible para importación (15 días)</div>
                                                </div>
                                                <div className="text-right flex flex-row sm:flex-col justify-between sm:justify-center items-center sm:items-end gap-2 border-t sm:border-t-0 border-slate-100 pt-3 sm:pt-0 mt-2 sm:mt-0 min-w-[90px]">
                                                    <div>
                                                        <p className="text-[9px] text-slate-400 uppercase font-bold">Estimado</p>
                                                        {basePrice > 0 ? <p className="font-bold text-[#9D1B1B] text-lg">US$ {importPrice.toFixed(2)}</p> : <p className="font-bold text-slate-400 text-xs italic">Cotizar</p>}
                                                    </div>
                                                    <button onClick={() => handleAddMissingItem(card)} className="px-4 py-2 bg-slate-900 hover:bg-slate-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer w-full sm:w-auto shadow-sm">Cotizar</button>
                                                </div>
                                            </div>
                                        )})
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    </div>
  )
}

// --- EXPORT DEFAULT CON SUSPENSE (FIX BUILD) ---
export default function MoxfieldToolPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><Loader2 className="animate-spin text-[#9D1B1B]" size={40}/></div>}>
      <MoxfieldToolContent />
    </Suspense>
  )
}
