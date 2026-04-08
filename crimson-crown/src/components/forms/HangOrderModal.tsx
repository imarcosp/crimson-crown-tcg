"use client"
import { useState, useEffect, useMemo } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useQuoteStore } from '@/store/quoteStore'
import { useConfig } from '@/context/ConfigContext'
import { Trash, Search, Plus, Loader2, X, Sparkles, ZoomIn, AlertTriangle, Calculator, Calendar, ArrowRight, CheckCircle, ExternalLink, Package, Link as LinkIcon, Image as ImageIcon, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { notifyAdminOrderUpdated } from '@/app/actions/email'
import { siteConfig } from '@/config/site'

const getImageUrl = (item: any) => {
    if (!item) return ''
    if (item.image_url) return item.image_url
    if (item.image) return item.image
    if (item.images?.small) return item.images.small
    if (item.images?.normal) return item.images.normal
    return ''
}

const getCollectorNumber = (item: any) => {
    let val = item.collector_number || item.collectorNumber || item.formattedNumber || ''
    val = String(val).trim()
    if (val === '?' || val === '#?' || val === 'undefined' || val === 'null') return ''
    return val
}

export default function HangOrderModal() {
  const isOpen = useUIStore((s) => s.isHangModalOpen)
  const closeAll = useUIStore((s) => s.closeAll)
  const { importWarningText } = useConfig()
  
  const [step, setStep] = useState<'form' | 'stock-warning' | 'success'>('form')
  const [message, setMessage] = useState('')
  const [zoomedImage, setZoomedImage] = useState<string | null>(null)
  const [checkingStock, setCheckingStock] = useState(false) 
  const [isProcessing, setIsProcessing] = useState(false)
  const [addingItem, setAddingItem] = useState(false)
  
  const [stockFoundList, setStockFoundList] = useState<any[]>([])
  const [waLink, setWaLink] = useState('')
  const [newOrderId, setNewOrderId] = useState<string | null>(null)

  const quoteItems = useQuoteStore((s) => s.items)
  const removeItem = useQuoteStore((s) => s.removeItem)
  const updateQuantity = useQuoteStore((s) => s.updateQuantity)
  const updateFoil = useQuoteStore((s) => s.updateFoil)
  const addItem = useQuoteStore((s) => s.addItem)
  const clearQuote = useQuoteStore((s) => s.clearQuote)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [customProductMode, setCustomProductMode] = useState(false)
  const [customProduct, setCustomProduct] = useState({ name: '', url: '', image_url: '' })
  const [customFile, setCustomFile] = useState<File | null>(null)
  const [uploadingCustom, setUploadingCustom] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  const [existingOrderId, setExistingOrderId] = useState<string | null>(null)

  useEffect(() => {
      if (isOpen) {
          setStep('form')
          setStockFoundList([])
          setWaLink('')
          setIsProcessing(false)
          
          // Check for existing initiated order
          const checkExistingOrder = async () => {
              const { data: { session } } = await supabase.auth.getSession()
              if (!session) return
              
              const { data } = await supabase
                  .from('import_orders')
                  .select('id')
                  .eq('user_id', session.user.id)
                  .eq('status', 'Iniciada')
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .single()
                  
              if (data) {
                  setExistingOrderId(data.id)
              } else {
                  setExistingOrderId(null)
              }
          }
          checkExistingOrder()
      }
  }, [isOpen, supabase])

  const totals = useMemo(() => {
      return quoteItems.reduce((acc, item) => {
          const qty = item.quantity || 1
          const i = item as any
          const base = i.isFoil ? (i.rawFoil || 0) : (i.rawNormal || 0)
          const estUnit = base > 0 ? (base * 1.10) + 0.5 : 0
          return acc + (estUnit * qty)
      }, 0)
  }, [quoteItems])

  useEffect(() => {
    if (query.length < 3) { setResults([]); return }
    const timer = setTimeout(async () => {
        setSearching(true)
        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
            const data = await res.json()
            // Filtro de seguridad adicional en el frontend
            const safeData = Array.isArray(data) ? data.filter((item: any) => !item.name?.includes('(ARCHIVADO)')) : []
            setResults(safeData)
        } catch { setResults([]) }
        finally { setSearching(false) }
    }, 500)
    return () => clearTimeout(timer)
  }, [query])

  const checkStockAndProceed = async () => {
    if (quoteItems.length === 0) { alert('Agrega cartas a la lista.'); return }
    setCheckingStock(true)
    const stockFound: any[] = []

    for (const item of quoteItems) {
        const { data: stocks } = await supabase
            .from('products')
            .select('id, name, set_name, collector_number, price_usd, finish, image_url')
            .ilike('name', item.name)
            .eq('set_name', item.setName)
            .eq('collector_number', item.collectorNumber)
            .gt('stock', 0)
        
        if (stocks && stocks.length > 0) {
            const match = stocks.find(p => {
                const finish = (p.finish || '').toLowerCase()
                if (item.isFoil) return finish.includes('foil') && !finish.includes('non')
                else return !finish.includes('foil') || finish.includes('non')
            })
            if (match) stockFound.push({ ...match, req_foil: item.isFoil })
        }
    }
    setCheckingStock(false)

    if (stockFound.length > 0) {
        setStockFoundList(stockFound)
        setStep('stock-warning')
    } else {
        createOrder()
    }
  }

  useEffect(() => {
    if (!customProduct.url) return
    const url = customProduct.url.toLowerCase()
    if (url.match(/\.(jpeg|jpg|gif|png|webp|avif)(\?.*)?$/) || url.includes('images.')) {
        setCustomProduct(prev => ({ ...prev, image_url: customProduct.url }))
    }
  }, [customProduct.url])

  const handleCustomFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files?.length) return
      const file = e.target.files[0]
      if (file.size > 5 * 1024 * 1024) {
          alert('El archivo es muy pesado (Máx 5MB).')
          return
      }
      setCustomFile(file)
      setCustomProduct(prev => ({ ...prev, image_url: URL.createObjectURL(file) }))
  }

  const handleAddCustomProduct = async () => {
    if (!customProduct.name.trim()) {
        alert('Por favor ingresa una descripción para el producto.')
        return
    }

    setAddingItem(true)
    let finalImageUrl = customProduct.image_url

    // Si el usuario subió una imagen local, la subimos a Supabase
    if (customFile) {
        setUploadingCustom(true)
        try {
            const ext = customFile.name.split('.').pop()
            const fileName = `imports/custom_${Date.now()}.${ext}`
            const { error: uploadError } = await supabase.storage.from('products').upload(fileName, customFile)
            if (uploadError) throw uploadError
            const { data } = supabase.storage.from('products').getPublicUrl(fileName)
            finalImageUrl = data.publicUrl
        } catch (error: any) {
            alert('Error al subir imagen: ' + error.message)
            setUploadingCustom(false)
            setAddingItem(false)
            return
        }
        setUploadingCustom(false)
    }
    
    addItem({
        id: `custom_${Date.now()}`,
        name: customProduct.name.trim(),
        setName: customProduct.url.trim() ? customProduct.url.trim() : 'Otro Producto',
        collectorNumber: '',
        image: finalImageUrl,
        quantity: 1,
        isFoil: false,
        foilLocked: true, 
        foilLabel: 'Normal',
        rawNormal: 0,
        rawFoil: 0,
        price: 0,
        isCustom: true
    } as any)
    
    setCustomProduct({ name: '', url: '', image_url: '' })
    setCustomFile(null)
    setCustomProductMode(false)
    setAddingItem(false)
  }

  const handleAddItem = async (card: any) => {
    setAddingItem(true)
    const img = getImageUrl(card)
    const cNumber = getCollectorNumber(card)
    const scryId = card.scryfall_id || card.id 

    // FIX BUG 5: Usar SIEMPRE los precios enriquecidos que devuelve /api/search.
    // Esto evita hacer fetch a external_prices desde el front, saltándose el error de usuarios Anónimos (RLS).
    const finalNormalPrice = Number(card.price_usd ?? card.priceUsd ?? 0)
    
    // Contemplamos si el precio foil vino etiquetado como "etched"
    const finalFoilPrice = Math.max(
        Number(card.price_usd_foil ?? card.priceUsdFoil ?? 0),
        Number(card.price_usd_etched ?? card.priceUsdEtched ?? 0)
    )

    let existsNormal = finalNormalPrice > 0
    let existsFoil = finalFoilPrice > 0

    // Si todo es 0 y es un ID de Scryfall (no un DB item genérico sin precio), 
    // verificamos con Scryfall API pura si la carta existe en foil o no, para que el UI no se rompa.
    if (!existsNormal && !existsFoil && scryId) {
        try {
            const res = await fetch(`https://api.scryfall.com/cards/${scryId}`)
            if (res.ok) {
                const d = await res.json()
                const finishes = d.finishes || []
                if (finishes.includes('nonfoil')) existsNormal = true
                if (finishes.includes('foil') || finishes.includes('etched')) existsFoil = true
            }
        } catch {}
    }

    let isFoilState = false
    let isLocked = false
    
    if (existsFoil && !existsNormal) { isFoilState = true; isLocked = true; } 
    else if (!existsFoil && existsNormal) { isFoilState = false; isLocked = true; }
    else { isFoilState = false; isLocked = false; }

    addItem({
        id: card.id,
        name: card.name,
        setName: card.set_name || card.setName,
        collectorNumber: cNumber,
        image: img,
        quantity: 1,
        isFoil: isFoilState,
        foilLocked: isLocked, 
        foilLabel: isLocked && isFoilState ? 'Solo Foil' : (isLocked ? 'Solo Normal' : 'Foil'),
        rawNormal: finalNormalPrice,
        rawFoil: finalFoilPrice,
        price: 0 
    } as any)

    setQuery('')
    setResults([])
    setAddingItem(false)
  }

  const createOrder = async () => {
    setIsProcessing(true)
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
        localStorage.setItem('pending_quote', JSON.stringify({ items: quoteItems, note: message, timestamp: Date.now() }))
        closeAll()
        router.push('/login?return_to=hang')
        setIsProcessing(false)
        return
    }

    try {
        // 1. Validar Teléfono y obtener datos de usuario
        const { data: profile } = await supabase
            .from('profiles')
            .select('phone, first_name, last_name')
            .eq('id', session.user.id)
            .single()

        if (!profile?.phone) {
            alert('⚠️ Requisito: Por favor agrega un número de teléfono en tu perfil para que podamos contactarte.')
            closeAll()
            router.push('/profile?tab=settings')
            return
        }

        const customerName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Cliente'

        // 2. Buscar Orden Existente en estado Iniciada (Merge)
        // Eliminamos la restricción de "hoy" para permitir armar el carrito por varios días
        
        const { data: existingOrder } = await supabase
            .from('import_orders')
            .select('id, order_number')
            .eq('user_id', session.user.id)
            .eq('status', 'Iniciada')
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

        let targetOrderId = ''
        let targetOrderNumber = ''
        let isMerge = false

        if (existingOrder) {
            // MERGE: Usamos orden existente
            targetOrderId = existingOrder.id
            targetOrderNumber = existingOrder.order_number
            isMerge = true
            
            // Si hay un nuevo mensaje/nota, lo agregamos a user_notes
            if (message.trim()) {
                const newNote = message.trim()
                const currentNotes = existingOrder.user_notes || ''
                const updatedNotes = currentNotes ? `${currentNotes}\n---\n[Agregado]: ${newNote}` : newNote
                
                await supabase.from('import_orders').update({ user_notes: updatedNotes }).eq('id', targetOrderId)
            }
        } else {
            // NUEVA ORDEN
            const { data: newOrder, error: orderError } = await supabase.from('import_orders').insert({
                user_id: session.user.id, 
                status: 'Iniciada',
                user_notes: message.trim() || null
            }).select().single()

            if (orderError) throw orderError
            targetOrderId = newOrder.id
            targetOrderNumber = newOrder.order_number
        }

        const dbItems = quoteItems.map(item => {
            // Recalcular estimado unitario para guardarlo
            const i = item as any
            const base = i.isFoil ? (i.rawFoil || 0) : (i.rawNormal || 0)
            const estUnit = base > 0 ? (base * 1.10) + 0.5 : 0

            return {
                order_id: targetOrderId,
                product_name: item.isFoil ? `${item.name} (Foil)` : item.name,
                set_name: item.setName, // Si es custom, aquí va la URL temporalmente o 'Otro Producto'
                product_url: i.isCustom ? item.setName : null, // Usamos setName para guardar la url en caso de producto custom
                collector_number: item.collectorNumber,
                image_url: item.image,
                quantity: item.quantity,
                platform: 'Manapool',
                unit_price: 0, 
                tax_percent: 0,
                shipping_cost: 0.5,
                suggested_price: estUnit, // Guardamos el precio que vio el cliente
                is_available: false, is_delivered: false
            }
        })
        
        const { error: itemsError } = await supabase.from('import_items').insert(dbItems)
        if (itemsError) throw itemsError

        // Notificar al Admin si fue Merge
        if (isMerge) {
            await notifyAdminOrderUpdated({
                orderNumber: targetOrderNumber || targetOrderId,
                customerName: customerName,
                itemsCount: quoteItems.length,
                link: `${window.location.origin}/admin/imports/${targetOrderId}`
            })
        }

        clearQuote()
        setMessage('')
        
        if (isMerge) {
            // Si es un merge, no mostramos el paso de success (whatsapp), 
            // cerramos el modal y recargamos/navegamos a la orden.
            closeAll()
            
            // Si ya estamos en la página de la orden, forzamos un reload completo
            // para que el useEffect vuelva a fetchear los datos nuevos.
            if (window.location.pathname.includes(`/profile/imports/${targetOrderId}`)) {
                window.location.reload()
            } else {
                router.push(`/profile/imports/${targetOrderId}`)
            }
        } else {
            // Generar Link WhatsApp solo para nueva orden
            const displayId = targetOrderNumber || targetOrderId
            const phoneNumber = siteConfig.socialLinks.whatsapp
            let finalMessage = `Hola ${siteConfig.shortName}! Acabo de cargar el Pedido #${displayId} de importación.\n`
            
            if (quoteItems.length > 0) {
                quoteItems.forEach(item => {
                    const i = item as any
                    finalMessage += `\n- ${item.quantity}x ${item.name}${item.isFoil ? ' (Foil)' : ''} [${item.setName}]`
                })
            }
            
            if (totals > 0) finalMessage += `\n\nTotal Estimado: US$ ${totals.toFixed(2)}`
            else finalMessage += `\n\nTotal Estimado: A confirmar (sin precio de referencia)`
            if (message.trim()) finalMessage += `\n\n*Nota:* ${message.trim()}`
            finalMessage += `\n\nQuedo a la espera de la confirmación, gracias!`
            
            setWaLink(`https://wa.me/${phoneNumber}?text=${encodeURIComponent(finalMessage)}`)
            setNewOrderId(targetOrderId)
            setStep('success')
        }

    } catch (e: any) { 
        alert('Error creando la orden: ' + e.message) 
    } finally { 
        setIsProcessing(false) 
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeAll} />
      
      {zoomedImage && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/90" onClick={() => setZoomedImage(null)}>
             <button className="absolute top-4 right-4 text-white p-2 cursor-pointer"><X size={32} /></button>
             <img src={zoomedImage} alt="Zoom" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
        </div>
      )}

      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95">
        
        {/* HEADER */}
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div>
                <h3 className="text-xl font-bold text-slate-800">
                    {step === 'form' && 'Pedido a Japón'}
                    {step === 'stock-warning' && '⚠️ Revisión de Stock'}
                    {step === 'success' && '✅ Pedido Creado'}
                </h3>
                <p className="text-sm text-slate-500">
                    {step === 'form' && 'Cotización automática e importación.'}
                    {step === 'stock-warning' && 'Algunas cartas ya las tenemos disponibles.'}
                    {step === 'success' && 'Tu orden fue registrada correctamente.'}
                </p>
            </div>
            <button onClick={closeAll} className="p-2 hover:bg-slate-200 rounded-full cursor-pointer"><X size={20}/></button>
        </div>

        {/* --- PASO 1: FORMULARIO DE CARGA --- */}
        {step === 'form' && (
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            <div className="flex-1 flex flex-col border-r border-slate-100 min-h-0">
                <div className="p-4 border-b border-slate-100 z-20">
                    <div className="flex gap-2 mb-3">
                        <button onClick={() => setCustomProductMode(false)} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${!customProductMode ? 'bg-[#9D1B1B] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Cartas (Magic)</button>
                        <button onClick={() => setCustomProductMode(true)} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${customProductMode ? 'bg-[#9D1B1B] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Otro Producto</button>
                    </div>

                    {!customProductMode ? (
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar carta..." className="w-full pl-10 pr-10 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#9D1B1B] outline-none" autoFocus/>
                            {(searching || addingItem) && <Loader2 className="absolute right-3 top-2.5 animate-spin text-[#9D1B1B]" size={18}/>}
                            {results.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-200 max-h-60 overflow-y-auto z-30">
                                    {results.map((r) => (
                                        <button key={r.id} onClick={() => handleAddItem(r)} className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b last:border-0 flex items-center gap-3 cursor-pointer">
                                            <div className="w-8 h-11 bg-slate-200 rounded overflow-hidden shrink-0">{getImageUrl(r) && <img src={getImageUrl(r)} className="w-full h-full object-cover" />}</div>
                                            <div><div className="font-bold text-sm text-slate-800">{r.name}</div><div className="text-xs text-slate-500">{r.set_name} #{r.collector_number}</div></div>
                                            <Plus size={16} className="ml-auto text-emerald-600"/>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">¿Qué quieres traer de Japón?</label>
                                <input value={customProduct.name} onChange={(e) => setCustomProduct({...customProduct, name: e.target.value})} placeholder="Ej: Playmat de One Piece, Caja Sellada..." className="w-full py-2 px-3 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-[#9D1B1B] outline-none"/>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">Link del producto (Opcional)</label>
                                <input value={customProduct.url} onChange={(e) => setCustomProduct({...customProduct, url: e.target.value})} placeholder="Ej: https://amazon.co.jp/..." className="w-full py-2 px-3 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-[#9D1B1B] outline-none"/>
                                <p className="text-[10px] text-slate-400 mt-1">Si el link es una imagen, se detectará automáticamente.</p>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">O sube una imagen (Opcional)</label>
                                <div className="flex gap-2 items-start">
                                    <div className="w-12 h-12 bg-white rounded border border-slate-200 shrink-0 flex items-center justify-center overflow-hidden">
                                        {customProduct.image_url ? (
                                            <img src={customProduct.image_url} alt="Preview" className="w-full h-full object-cover"/>
                                        ) : (
                                            <ImageIcon size={16} className="text-slate-300"/>
                                        )}
                                    </div>
                                    <label className="flex-1 cursor-pointer w-full py-2 px-3 border border-dashed border-slate-300 rounded-md text-xs text-slate-500 hover:bg-white transition-colors flex items-center justify-center gap-2">
                                        <Upload size={14}/> {customFile ? "Cambiar Imagen" : "Elegir archivo"}
                                        <input type="file" accept="image/*" onChange={handleCustomFileUpload} className="hidden" />
                                    </label>
                                </div>
                            </div>
                            <button onClick={handleAddCustomProduct} disabled={addingItem || uploadingCustom} className="w-full bg-slate-800 hover:bg-black text-white text-xs font-bold py-2 rounded-md transition-colors flex items-center justify-center gap-2 disabled:opacity-70 mt-2">
                                {(addingItem || uploadingCustom) ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>} Agregar a la lista
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30">
                    {quoteItems.length === 0 ? (
                        <div className="text-center py-12 flex flex-col items-center text-slate-400"><Search size={48} className="mb-4 opacity-20"/><p className="text-sm">Agrega cartas para ver el estimado.</p></div>
                    ) : (
                        quoteItems.map((item: any) => {
                            const basePrice = item.isFoil ? (item.rawFoil || 0) : (item.rawNormal || 0)
                            const tax = basePrice * 0.10
                            const shipping = 0.50
                            const totalEst = basePrice > 0 ? (basePrice + tax + shipping) : 0

                            return (
                            <div key={item.id} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex gap-3 items-start group hover:border-[#9D1B1B]/30">
                                <div className="w-12 h-16 bg-slate-100 rounded-lg overflow-hidden shrink-0 relative cursor-zoom-in cursor-pointer" onClick={() => item.image && setZoomedImage(item.image)}>
                                    {item.image ? <img src={item.image} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[8px]">Sin img</div>}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm text-slate-800 truncate">{item.name}</div>
                                    <div className="text-xs text-slate-500 mb-2">{item.setName} <span className="font-mono bg-slate-100 px-1 rounded border">#{item.collectorNumber}</span></div>
                                    
                                    <div className="flex flex-col gap-2">
                                        <label className={`flex items-center gap-2 select-none w-fit ${item.foilLocked ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}>
                                            <input type="checkbox" checked={item.isFoil || false} disabled={item.foilLocked} onChange={(e) => !item.foilLocked && updateFoil(item.id, e.target.checked)} className="w-3 h-3 accent-purple-600 cursor-pointer"/>
                                            <span className={`text-xs font-bold ${item.isFoil ? 'text-purple-600' : 'text-slate-500'}`}><Sparkles size={10} className="inline mr-0.5"/> {item.foilLabel || 'Foil'}</span>
                                        </label>
                                        <div className="bg-slate-50 p-2 rounded text-[10px] font-mono text-slate-500 border border-slate-100">
                                            {item.isCustom ? (
                                                <span className="text-slate-400 italic">Se cotizará manualmente</span>
                                            ) : basePrice > 0 ? (
                                                <>
                                                    <div className="flex justify-between"><span>Base:</span><span>${basePrice.toFixed(2)}</span></div>
                                                    <div className="flex justify-between text-slate-400"><span>+ Tax (10%):</span><span>${tax.toFixed(2)}</span></div>
                                                    <div className="flex justify-between text-slate-400 border-b border-slate-200 pb-1 mb-1"><span>+ Envío:</span><span>${shipping.toFixed(2)}</span></div>
                                                    <div className="flex justify-between font-bold text-slate-800"><span>Total:</span><span>${totalEst.toFixed(2)}</span></div>
                                                </>
                                            ) : <span className="text-slate-400 italic">Consultar precio</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                    <label className="text-[9px] text-slate-400 font-bold uppercase">Cant.</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-xs text-slate-500">x</span>
                                        <input type="number" min="1" value={item.quantity} onChange={(e) => updateQuantity(item.id, Number(e.target.value))} className="w-12 text-center border border-slate-300 rounded py-1 text-sm font-bold focus:ring-1 focus:ring-[#9D1B1B] outline-none"/>
                                    </div>
                                    <button onClick={() => removeItem(item.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg mt-auto cursor-pointer"><Trash size={16}/></button>
                                </div>
                            </div>
                        )})
                    )}
                </div>
            </div>
            
            <div className="w-full md:w-80 bg-slate-50 flex flex-col border-l border-slate-100 overflow-y-auto">
                <div className="p-6 flex-1 space-y-6">
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-blue-800 text-xs space-y-2 whitespace-pre-wrap">
                        {importWarningText}
                    </div>
                    {!existingOrderId && (
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-slate-500 uppercase block">Notas Adicionales</label>
                            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ej: Busco cartas en japonés..." className="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-[#9D1B1B] outline-none resize-none h-24 bg-white text-slate-900"/>
                        </div>
                    )}
                </div>
                <div className="p-6 border-t border-slate-200 bg-white">
                    <div className="flex justify-between items-end mb-4">
                        <span className="text-sm font-bold text-slate-500 uppercase">Total Estimado</span>
                        <div className="text-right">
                            <span className="block text-2xl font-extrabold text-[#9D1B1B] flex items-center gap-2"><Calculator size={20} className="text-slate-300"/> US$ {totals.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-400 font-bold">Incluye Tax (10%) + Envío ($0.5/u)</span>
                        </div>
                    </div>
                    <button onClick={checkStockAndProceed} disabled={checkingStock || isProcessing || quoteItems.length === 0} className="w-full py-4 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer">
                        {isProcessing || checkingStock ? <Loader2 className="animate-spin" size={20}/> : <span className="text-lg">{existingOrderId ? 'Añadir a la orden' : 'Enviar Pedido'}</span>}
                    </button>
                </div>
            </div>
        </div>
        )}

        {/* --- PASO 2: ALERTA DE STOCK --- */}
        {step === 'stock-warning' && (
            <div className="flex-1 p-8 overflow-y-auto bg-slate-50 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-6 shadow-sm">
                    <AlertTriangle size={32}/>
                </div>
                <h3 className="text-2xl font-bold text-slate-800 mb-2">¡Encontramos cartas en Stock!</h3>
                <p className="text-slate-600 mb-8 max-w-lg">
                    Algunas de las cartas que pides ya las tenemos en la tienda (entrega inmediata). 
                    ¿Prefieres verlas o pedir de todas formas?
                </p>

                <div className="w-full max-w-lg space-y-3 mb-8">
                    {stockFoundList.map((item, i) => (
                        <div key={i} className="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-left">
                            <div className="w-12 h-16 bg-slate-200 rounded overflow-hidden shrink-0">
                                {item.image_url && <img src={item.image_url} className="w-full h-full object-cover"/>}
                            </div>
                            <div className="flex-1">
                                <p className="font-bold text-slate-800">{item.name}</p>
                                <p className="text-xs text-slate-500">{item.set_name} • #{item.collector_number}</p>
                                <p className="text-xs font-bold text-emerald-600 mt-1">
                                    En Stock: US$ {item.price_usd} 
                                    {item.req_foil && <span className="ml-2 text-purple-600">✨ Foil</span>}
                                </p>
                            </div>
                            <Link href={`/catalog?q=${encodeURIComponent(item.name)}`} target="_blank" className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-2">
                                Ver Producto <ExternalLink size={14}/>
                            </Link>
                        </div>
                    ))}
                </div>

                <div className="flex gap-4">
                    <button onClick={() => setStep('form')} className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-200 rounded-xl transition-colors">
                        Volver
                    </button>
                    <button onClick={createOrder} className="px-8 py-3 bg-[#9D1B1B] hover:bg-[#7E1515] text-white font-bold rounded-xl shadow-lg transition-colors flex items-center gap-2">
                        {isProcessing ? <Loader2 className="animate-spin"/> : 'Importar de Todas Formas'}
                    </button>
                </div>
            </div>
        )}

        {/* --- PASO 3: ÉXITO (WHATSAPP O REDIRECT) --- */}
        {step === 'success' && (
            <div className="flex-1 p-8 overflow-y-auto bg-slate-50 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in">
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6 shadow-sm animate-bounce">
                    <CheckCircle size={40}/>
                </div>
                <h3 className="text-3xl font-bold text-slate-800 mb-2">¡Pedido Iniciado!</h3>
                <p className="text-slate-600 mb-8 max-w-lg">
                    Tu orden de importación ha sido registrada. Ahora puedes ver tu orden y esperar a que la coticemos. Si quieres, puedes enviarnos un mensaje a WhatsApp para avisarnos.
                </p>

                <a href={waLink} target="_blank" rel="noopener noreferrer" className="w-full max-w-sm py-4 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-xl font-bold shadow-xl flex items-center justify-center gap-3 text-lg transition-transform hover:scale-105 mb-4">
                    <span>Avisar por WhatsApp</span> <ArrowRight size={24}/>
                </a>
                
                <button onClick={() => {
                    closeAll()
                    if (newOrderId) {
                        router.push(`/profile/imports/${newOrderId}`)
                    } else {
                        router.push('/profile?tab=imports')
                    }
                }} className="text-sm text-slate-500 hover:text-slate-700 underline font-bold cursor-pointer">
                    Ver mi orden
                </button>
            </div>
        )}

      </div>
    </div>
  )
}
