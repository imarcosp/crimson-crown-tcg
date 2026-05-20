"use client"
import { useState, useEffect, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X, Search, Loader2, Image as ImageIcon, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { processWishlistNotifications } from '@/app/actions/wishlist'

type Props = {
  initial?: any | null
  onClose: () => void
  onSaved: (product: any) => void
}

function finishKeyToValue(key: string) {
  const k = String(key || '').toLowerCase()
  if (k === 'nonfoil') return 'Non-Foil'
  if (k === 'foil') return 'Foil'
  if (k === 'etched') return 'Etched'
  const label = k.replace(/[^a-z0-9]+/g, ' ').trim()
  const titled = label.split(' ').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  if (!titled) return 'Foil'
  if (titled.toLowerCase().includes('foil')) return titled
  return `${titled} Foil`
}

function finishKeyToLabel(key: string) {
  const k = String(key || '').toLowerCase()
  if (k === 'nonfoil') return 'Normal / Non-Foil'
  if (k === 'foil') return 'Foil'
  if (k === 'etched') return 'Etched Foil'
  return finishKeyToValue(k)
}

function finishValueToKey(value: string) {
  const v = String(value || '').toLowerCase()
  if (v.includes('etched')) return 'etched'
  if (v.includes('non') && v.includes('foil')) return 'nonfoil'
  if (v.includes('foil') || v.includes('holo') || v.includes('surge') || v.includes('raised') || v.includes('gilded') || v.includes('glossy')) return 'foil'
  return 'nonfoil'
}

export default function ProductForm({ initial, onClose, onSaved }: Props) {
  const [mode, setMode] = useState<'Magic' | 'Other'>('Magic')
  const [isRiftbound, setIsRiftbound] = useState(false)
  const [availableFinishes, setAvailableFinishes] = useState<string[] | null>(null)
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [subcategoryOptions, setSubcategoryOptions] = useState<Record<string, string[]>>({})
  const supabase = createClient()

  const [formData, setFormData] = useState({
    name: '',
    set_name: '',
    tcg: 'Magic',
    price_usd: 0,
    stock: 0,
    condition: 'NM',
    finish: 'Non-Foil',
    rarity: '',
    language: 'English',
    image_url: '',
    collector_number: '',
    scryfall_id: '',
    is_manual_price: false,
    metadata: {
      might: null as number | null,
      energy: null as number | null,
      power: null as number | null,
      type: '',
      gallery: [] as string[],
      subcategory: '',
      manual_category_mode: false,
    },
  })

  // ... (Resto del estado y useEffects igual) ...
  const [media, setMedia] = useState<{ url: string, file?: File }[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fetchingPrice, setFetchingPrice] = useState(false)
  const finishOptions = useMemo(() => {
    if (mode !== 'Magic') return null
    const keys = Array.isArray(availableFinishes) ? availableFinishes.map((f) => String(f || '').toLowerCase()).filter(Boolean) : null
    const unique = keys ? Array.from(new Set(keys)) : null
    if (!unique || unique.length === 0) return null
    const ordered = unique.slice().sort((a, b) => {
      const pr = (k: string) => (k === 'nonfoil' ? 0 : (k === 'foil' ? 1 : (k === 'etched' ? 2 : 3)))
      return pr(a) - pr(b)
    })
    return ordered.map((k) => ({ key: k, value: finishKeyToValue(k), label: finishKeyToLabel(k) }))
  }, [availableFinishes, mode])

  useEffect(() => {
    let mounted = true

    const loadCategoryOptions = async () => {
      try {
        let from = 0
        const PAGE_SIZE = 1000
        let keepLoading = true
        const categories = new Set<string>()
        const subcategoriesByCategory = new Map<string, Set<string>>()

        while (keepLoading) {
          const { data, error } = await supabase
            .from('products')
            .select('tcg, metadata')
            .range(from, from + PAGE_SIZE - 1)

          if (error) throw error

          const rows = Array.isArray(data) ? data : []
          rows.forEach((row: any) => {
            const category = String(row?.tcg || '').trim()
            if (!category) return
            categories.add(category)

            const subcategory = String(row?.metadata?.subcategory || '').trim()
            if (!subcategory) return

            if (!subcategoriesByCategory.has(category)) {
              subcategoriesByCategory.set(category, new Set<string>())
            }
            subcategoriesByCategory.get(category)?.add(subcategory)
          })

          if (rows.length < PAGE_SIZE) keepLoading = false
          else from += PAGE_SIZE
        }

        if (!mounted) return

        setCategoryOptions(Array.from(categories).sort((a, b) => a.localeCompare(b)))
        setSubcategoryOptions(
          Array.from(subcategoriesByCategory.entries()).reduce((acc, [category, values]) => {
            acc[category] = Array.from(values).sort((a, b) => a.localeCompare(b))
            return acc
          }, {} as Record<string, string[]>)
        )
      } catch (error) {
        console.error('Error cargando categorías manuales:', error)
      }
    }

    loadCategoryOptions()

    return () => {
      mounted = false
    }
  }, [supabase])

  useEffect(() => {
    if (initial) {
      const rb = initial.tcg === 'Riftbound'
      const meta = initial.metadata || {}
      const isManualCategoryMode = meta.manual_category_mode === true
      const shouldOpenAsMagicAuto = initial.tcg === 'Magic' && !!initial.scryfall_id && !isManualCategoryMode
      setIsRiftbound(rb)
      setMode(shouldOpenAsMagicAuto ? 'Magic' : 'Other')
      setAvailableFinishes(null)
      setFormData({
        name: initial.name || '',
        set_name: initial.set_name || '',
        tcg: initial.tcg || 'Magic',
        price_usd: initial.price_usd || 0,
        stock: initial.stock || 0,
        condition: initial.condition || 'NM',
        finish: initial.finish || 'Non-Foil',
        rarity: initial.rarity || '',
        language: initial.language || 'English',
        image_url: initial.image_url || '',
        collector_number: initial.collector_number || '',
        scryfall_id: rb ? '' : (initial.scryfall_id || ''),
        is_manual_price: initial.is_manual_price || false,
        metadata: {
          might: null,
          energy: null,
          power: null,
          type: '',
          gallery: [],
          subcategory: '',
          manual_category_mode: false,
          ...meta,
          gallery: meta.gallery || [],
          subcategory: meta.subcategory || '',
          manual_category_mode: isManualCategoryMode,
        },
      })
      const existingMedia = []
      if (initial.image_url) existingMedia.push({ url: initial.image_url })
      if (Array.isArray(meta.gallery)) {
          meta.gallery.forEach((url: string) => existingMedia.push({ url }))
      }
      setMedia(existingMedia)
    }
  }, [initial])

  // ... (Efectos de búsqueda y selección de carta IGUAL) ...
  useEffect(() => {
    if (query.length < 3) { setResults([]); return }
    const timer = setTimeout(() => {
      setLoadingSearch(true)
      if (mode === 'Magic' && !isRiftbound) {
        let finalQuery = query
        // Solo separamos el número si el usuario usa el prefijo '#' explícitamente.
        const numberMatch = query.match(/^(.*?)\s*#(\d+[a-zA-Z]?)$/i)
        if (numberMatch) {
          const name = numberMatch[1].trim()
          const number = numberMatch[2]
          finalQuery = `!"${name}" cn:${number} unique:prints`
        }
        fetch(`/api/search?q=${encodeURIComponent(finalQuery)}`).then((r) => r.json()).then((data) => setResults(data || [])).finally(() => setLoadingSearch(false))
      } else {
        fetch(`/api/search?q=${encodeURIComponent(query)}`).then((r) => r.json()).then((data) => setResults((data || []).filter((d: any) => d.tcg === 'Riftbound'))).finally(() => setLoadingSearch(false))
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [query, mode, isRiftbound])

  const handleSelectCard = async (card: any) => {
    // ... (Lógica de selección igual) ...
    if (card.tcg === 'Riftbound') {
      setIsRiftbound(true)
      setMode('Other')
      setAvailableFinishes(null)
      setFormData((prev) => ({
        ...prev,
        name: card.name,
        set_name: card.set_name,
        image_url: card.image_url || '',
        collector_number: card.collector_number || '',
        scryfall_id: '',
        rarity: card.rarity || prev.rarity,
        tcg: 'Riftbound',
        finish: 'Non-Foil',
        price_usd: Number(card.priceUsd || card.price_usd || 0),
        is_manual_price: false,
        metadata: {
          ...prev.metadata,
          ...(card.metadata || {}),
          subcategory: '',
          manual_category_mode: false,
        },
      }))
      if (card.image_url) setMedia([{ url: card.image_url }])
    } else {
      const pNormal = Number(card.priceUsd || card.price_usd || 0)
      const pFoil = Number(card.priceUsdFoil || card.price_usd_foil || 0)
      
      const finishesRaw = Array.isArray(card.finishes) ? card.finishes.map((f: any) => String(f || '').toLowerCase()).filter(Boolean) : []
      const hasNonFoil = pNormal > 0 || finishesRaw.includes('nonfoil')
      const hasFoil = pFoil > 0 || finishesRaw.includes('foil')
      const hasEtched = finishesRaw.includes('etched') || Number(card.price_usd_etched || card.priceUsdEtched || 0) > 0
      const otherFoils = finishesRaw.filter((k) => !['nonfoil', 'foil', 'etched'].includes(k))
      const nextFinishes: string[] = []
      if (hasNonFoil) nextFinishes.push('nonfoil')
      if (hasFoil) nextFinishes.push('foil')
      if (hasEtched) nextFinishes.push('etched')
      otherFoils.forEach((k) => nextFinishes.push(k))
      const uniqueNext = Array.from(new Set(nextFinishes))

      let initialFinish = 'Non-Foil'
      if (!hasNonFoil && uniqueNext.length === 1) initialFinish = finishKeyToValue(uniqueNext[0])
      else if (!hasNonFoil && otherFoils.length > 0) initialFinish = finishKeyToValue(otherFoils[0])
      else if (!hasNonFoil && hasEtched) initialFinish = 'Etched'
      else if (!hasNonFoil && hasFoil) initialFinish = 'Foil'

      let initialPrice = pNormal
      const initialKey = finishValueToKey(initialFinish)
      if (initialKey === 'etched') initialPrice = Number(card.price_usd_etched || card.priceUsdEtched || pFoil || pNormal || 0)
      else if (initialKey === 'foil') initialPrice = pFoil || pNormal
      
      if (!hasNonFoil && hasFoil) {
        initialFinish = 'Foil'
        initialPrice = pFoil
      }
      if (initialPrice > 0 && initialPrice < 0.5) initialPrice = 0.5
      
      const realScryfallId = card.scryfall_id || card.id || ''
      setFormData((prev) => ({
        ...prev,
        name: card.name,
        set_name: card.set_name,
        image_url: card.image_url || '',
        collector_number: card.collector_number || '',
        scryfall_id: realScryfallId,
        rarity: card.rarity ? card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1) : prev.rarity,
        tcg: 'Magic',
        finish: initialFinish,
        price_usd: initialPrice,
        is_manual_price: false,
        metadata: { ...prev.metadata, subcategory: '', manual_category_mode: false },
      }))
      setAvailableFinishes(uniqueNext.length ? uniqueNext : null)
      if (card.image_url) setMedia([{ url: card.image_url }])

    }
    setResults([])
    setQuery('')
  }

  const handleFinishChange = async (newFinish: string) => {
    const selected = finishOptions?.find((o) => o.value === newFinish) || null
    const wantKey = selected?.key || finishValueToKey(newFinish)
    if (finishOptions && !selected) {
      alert('Esa variante no existe para esta impresión. Elige otra edición o acabado.')
      return
    }
    setFormData(prev => ({ ...prev, finish: newFinish }))
    if (formData.is_manual_price || !formData.scryfall_id) return
    setFetchingPrice(true)
    const { data: prices } = await supabase.from('external_prices').select('cardkingdom_retail_normal, cardkingdom_retail_foil, cardkingdom_retail_etched, tcgplayer_market_normal, tcgplayer_market_foil').eq('scryfall_id', formData.scryfall_id).maybeSingle() 
    let finalPrice = 0
    if (prices) {
       const isEtched = wantKey === 'etched'
       const isFoil = !isEtched && wantKey !== 'nonfoil'
       const ckN = Number(prices.cardkingdom_retail_normal || 0)
       const ckF = Number(prices.cardkingdom_retail_foil || 0)
       const ckE = Number(prices.cardkingdom_retail_etched || ckF || 0) // Fallback a Foil si no hay Etched explícito
       const tcgN = Number(prices.tcgplayer_market_normal || 0)
       const tcgF = Number(prices.tcgplayer_market_foil || 0)
       const tcgE = tcgF // TCG Market suele unificar o usar el precio Foil para Etched si no hay columna
       
       // PRIORIDAD CK > TCG (Alineado con el backend)
       if (isEtched) finalPrice = ckE > 0 ? ckE : tcgE
       else if (isFoil) finalPrice = ckF > 0 ? ckF : tcgF
       else finalPrice = ckN > 0 ? ckN : tcgN
    }
    setFetchingPrice(false)
    if (finalPrice > 0) {
        if (finalPrice < 0.35) finalPrice = 0.35
        setFormData(prev => ({ ...prev, price_usd: finalPrice }))
    } else {
        alert('No se encontró precio para esta variante. Se mantiene el precio actual.')
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files) return
      const newMedia = Array.from(files).map(file => ({ url: URL.createObjectURL(file), file }))
      setMedia(prev => [...prev, ...newMedia])
  }

  const removeMedia = (index: number) => { setMedia(prev => prev.filter((_, i) => i !== index)) }

  const save = async () => {
    // ... (Lógica de guardado igual) ...
    if (!formData.name) return
    setSaving(true)
    const finalUrls: string[] = []
    for (const item of media) {
        if (item.file) {
            const ext = item.file.name.split('.').pop() || 'jpg'
            const fileName = `${Math.random().toString(36).slice(2)}.${ext}`
            const { error } = await supabase.storage.from('products').upload(fileName, item.file)
            if (!error) {
                const { data } = supabase.storage.from('products').getPublicUrl(fileName)
                finalUrls.push(data.publicUrl)
            }
        } else {
            finalUrls.push(item.url)
        }
    }
    const mainImage = finalUrls[0] || ''
    const gallery = finalUrls.slice(1)
    const normalize = (s: any) => String(s || '').trim().replace(/\s+/g, ' ')
    const normalizedCategory = normalize(formData.tcg)
    const normalizedSubcategory = normalize(formData.metadata?.subcategory)
    const nextMetadata: any = {
      ...formData.metadata,
      gallery,
      manual_category_mode: mode === 'Other' && normalizedCategory === 'Magic',
    }
    if (normalizedSubcategory) nextMetadata.subcategory = normalizedSubcategory
    else delete nextMetadata.subcategory
    const payload: any = { 
        ...formData, 
        name: normalize(formData.name),
        set_name: normalize(formData.set_name),
        tcg: normalizedCategory,
        language: normalize(formData.language),
        condition: normalize(formData.condition),
        finish: normalize(formData.finish),
        scryfall_id: formData.scryfall_id || null,
        image_url: mainImage,
        metadata: nextMetadata,
    }
    if (mode === 'Other') {
      payload.scryfall_id = undefined
      payload.collector_number = undefined
    }
    let shouldNotify = false
    let productId = ''
    const isVariantChange = initial && (formData.finish !== initial.finish || formData.condition !== initial.condition || formData.language !== initial.language)
    if (initial?.id && !isVariantChange) {
      const oldStock = Number(initial.stock || 0)
      const newStock = Number(formData.stock || 0)
      if (oldStock === 0 && newStock > 0) payload.restocked_at = new Date().toISOString()
      const { data, error } = await supabase.from('products').update(payload).eq('id', initial.id).select().single()
      if (!error) {
        onSaved(data)
        if (oldStock === 0 && newStock > 0) { shouldNotify = true; productId = initial.id }
      } else alert('Error: ' + error.message)
    } else {
      let query = supabase.from('products').select('id, stock').eq('finish', payload.finish).eq('condition', payload.condition).eq('language', payload.language).eq('tcg', payload.tcg)
      if (payload.scryfall_id) query = query.eq('scryfall_id', payload.scryfall_id)
      else {
        query = query.ilike('name', payload.name).ilike('set_name', payload.set_name)
        if (payload.collector_number) query = query.eq('collector_number', payload.collector_number)
      }
      const { data: existingArr } = await query.order('created_at', { ascending: false }).limit(1)
      const existing = Array.isArray(existingArr) ? existingArr[0] : null
      if (existing) {
        const oldStock = Number(existing.stock || 0)
        const newStock = oldStock + Number(payload.stock || 0)
        const updateData: any = { stock: newStock, image_url: payload.image_url, metadata: payload.metadata }
        if (oldStock === 0 && newStock > 0) updateData.restocked_at = new Date().toISOString()
        const { data, error } = await supabase.from('products').update(updateData).eq('id', existing.id).select().single()
        if (!error) {
          alert(`Variante existente. Stock actualizado a ${newStock}.`)
          onSaved(data)
          if (oldStock === 0 && Number(payload.stock) > 0) { shouldNotify = true; productId = existing.id }
        } else alert('Error fusionando: ' + error.message)
      } else {
        payload.restocked_at = new Date().toISOString()
        const rpcPayload = {
          p_name: payload.name, p_set_name: payload.set_name, p_collector_number: payload.collector_number || null, p_scryfall_id: payload.scryfall_id || null, p_tcg: payload.tcg, p_finish: payload.finish, p_condition: payload.condition, p_language: payload.language, p_price_usd: Number(payload.price_usd || 0), p_image_url: payload.image_url || null, p_metadata: payload.metadata || null, p_stock: Number(payload.stock || 0),
        }
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('upsert_product_variant', rpcPayload)
        if (!rpcErr && rpcRes) {
          const newId = String(rpcRes)
          const { data } = await supabase.from('products').select('*').eq('id', newId).single()
          if (data) { onSaved(data); if (Number(payload.stock) > 0) { shouldNotify = true; productId = newId } }
        } else {
          const { data, error } = await supabase.from('products').insert([payload]).select().single()
          if (!error) { onSaved(data); if (Number(payload.stock) > 0) { shouldNotify = true; productId = data.id } } else alert('Error creando: ' + error.message)
        }
      }
    }
    if (shouldNotify && productId) processWishlistNotifications([{ id: productId, name: formData.name }])
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b bg-slate-50">
          <h3 className="text-xl font-bold text-[#0F172A]">{initial ? 'Editar Producto' : 'Cargar Producto'}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full cursor-pointer"><X size={20} /></button>
        </div>
        <div className="flex border-b">
          <button onClick={() => { setMode('Magic'); setFormData((p) => ({ ...p, tcg: 'Magic', metadata: { ...p.metadata, subcategory: '', manual_category_mode: false } })) }} className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors cursor-pointer ${mode === 'Magic' ? 'border-purple-600 text-purple-700 bg-purple-50/50' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>✨ Magic (Auto)</button>
          <button onClick={() => { setMode('Other'); setFormData((p) => ({ ...p, tcg: p.tcg || 'Magic', metadata: { ...p.metadata, manual_category_mode: p.tcg === 'Magic' } })) }} className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors cursor-pointer ${mode === 'Other' ? 'border-blue-600 text-blue-700 bg-blue-50/50' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>📦 Otros TCG / Accesorios (Manual)</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {mode === 'Magic' && (
            <div className="relative">
              <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Buscar en Scryfall</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ej: Sheoldred, The Apocalypse..." className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent" autoFocus={!initial} />
                {loadingSearch && <Loader2 className="absolute right-3 top-2.5 animate-spin text-purple-600" size={18} />}
              </div>
              {results.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  {results.map((r: any) => (
                    <button key={r.id} onClick={() => handleSelectCard(r)} className="w-full text-left p-2 hover:bg-slate-50 border-b last:border-0 flex items-center gap-3 transition-colors cursor-pointer">
                      <div className="w-10 h-14 bg-slate-200 rounded overflow-hidden shrink-0">{r.image_url && <img src={r.image_url} className="w-full h-full object-cover" />}</div>
                      <div>
                        <div className="font-bold text-sm text-slate-800">{r.name}</div>
                        <div className="text-xs text-slate-500">{r.set_name} #{r.collector_number}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="label-form">Nombre</label>
              <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="input-form" readOnly={mode === 'Magic'} />
            </div>
            <div>
              <label className="label-form">Set / Expansión</label>
              <input value={formData.set_name} onChange={(e) => setFormData({ ...formData, set_name: e.target.value })} className="input-form" readOnly={mode === 'Magic'} />
            </div>
            <div>
              <label className="label-form">Categoría</label>
              {mode === 'Magic' ? (
                <input value="Magic" className="input-form bg-slate-50" readOnly />
              ) : (
                <>
                  <input
                    list="manual-category-options"
                    value={formData.tcg}
                    onChange={(e) => setFormData((prev) => ({ ...prev, tcg: e.target.value }))}
                    className="input-form"
                    placeholder="Ej: Magic, Pokémon, Accesorios..."
                  />
                  <datalist id="manual-category-options">
                    {categoryOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                  <p className="text-[10px] text-slate-500 mt-1">Puedes elegir una categoría existente o escribir una nueva.</p>
                </>
              )}
            </div>
            {mode === 'Other' && (
              <div>
                <label className="label-form">Subcategoría (Opcional)</label>
                <input
                  list="manual-subcategory-options"
                  value={String(formData.metadata?.subcategory || '')}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      metadata: { ...prev.metadata, subcategory: e.target.value },
                    }))
                  }
                  className="input-form"
                  placeholder="Ej: Precons, Sellado, Deck Boxes..."
                />
                <datalist id="manual-subcategory-options">
                  {(subcategoryOptions[formData.tcg] || []).map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
                <p className="text-[10px] text-slate-500 mt-1">Se mostrará en el menú sólo si hay stock.</p>
              </div>
            )}
            <div>
              <div className="flex justify-between">
                <label className="label-form">Precio (USD)</label>
                {formData.is_manual_price && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1 rounded">MANUAL</span>}
                {fetchingPrice && <span className="text-[10px] font-bold text-purple-600 animate-pulse">BUSCANDO PRECIO...</span>}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2 text-slate-400">$</span>
                <input type="number" step="0.01" value={formData.price_usd} onChange={(e) => setFormData({ ...formData, price_usd: Number(e.target.value), is_manual_price: true })} className={`input-form pl-6 ${formData.is_manual_price ? 'border-amber-400 focus:ring-amber-400' : ''}`} />
              </div>
              {formData.price_usd === 0 && !fetchingPrice && !formData.is_manual_price && formData.name && (
                  <div className="text-[10px] text-red-500 font-bold mt-1 flex items-center gap-1"><AlertTriangle size={10}/> PRECIO NO ENCONTRADO</div>
              )}
            </div>
            <div>
              <label className="label-form">Stock</label>
              <input type="number" value={formData.stock} onChange={(e) => setFormData({ ...formData, stock: Number(e.target.value) })} className="input-form" />
            </div>
            <div>
              <label className="label-form">Acabado</label>
              <select value={formData.finish} onChange={(e) => (mode === 'Magic' ? handleFinishChange(e.target.value) : setFormData({ ...formData, finish: e.target.value }))} className="input-form cursor-pointer" disabled={mode === 'Magic' && !!finishOptions && finishOptions.length === 1}>
                {mode === 'Magic' && finishOptions ? (
                  finishOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
                ) : (
                  <>
                    <option value="Non-Foil">Normal / Non-Foil</option>
                    <option value="Foil">Foil</option>
                    <option value="Etched">Etched Foil</option>
                  </>
                )}
              </select>
            </div>
            <div>
              <label className="label-form">Condición</label>
              <select value={formData.condition} onChange={(e) => setFormData({ ...formData, condition: e.target.value })} className="input-form cursor-pointer">
                <option value="NM">Near Mint (NM)</option>
                <option value="PL">Played (PL)</option>
                <option value="HP">Heavy Played (HP)</option>
              </select>
            </div>
            <div>
              <label className="label-form">Idioma</label>
              <select value={formData.language} onChange={(e) => setFormData({ ...formData, language: e.target.value })} className="input-form cursor-pointer">
                <option value="English">Inglés (English)</option>
                <option value="Spanish">Español (Spanish)</option>
                <option value="Japanese">Japonés (Japanese)</option>
                <option value="Portuguese">Portugués (Portuguese)</option>
                <option value="Italian">Italiano (Italian)</option>
                <option value="Chinese">Chino (Chinese)</option>
                <option value="Russian">Ruso (Russian)</option>
                <option value="German">Alemán (German)</option>
                <option value="French">Francés (French)</option>
              </select>
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
            <label className="label-form mb-2">Imágenes del Producto</label>
            <div className="flex flex-wrap gap-3 mb-3">
                {media.map((item, idx) => (
                    <div key={idx} className="w-20 h-28 bg-white border rounded relative group overflow-hidden shadow-sm">
                        <img src={item.url} className="w-full h-full object-cover" alt="" />
                        <button onClick={() => removeMedia(idx)} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                            <X size={12}/>
                        </button>
                        {idx === 0 && <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] font-bold text-center py-0.5">Portada</span>}
                    </div>
                ))}
                {mode === 'Other' && (
                    <label className="w-20 h-28 border-2 border-dashed border-slate-300 rounded flex flex-col items-center justify-center cursor-pointer hover:border-[#0F172A] hover:bg-slate-100 transition-colors bg-white">
                        <Plus size={24} className="text-slate-400"/>
                        <span className="text-[10px] text-slate-500 font-bold mt-1">Agregar</span>
                        <input type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden"/>
                    </label>
                )}
            </div>
            {mode === 'Magic' && <p className="text-xs text-slate-400 italic">La imagen principal se asigna automáticamente desde Scryfall.</p>}
          </div>

        </div>
        <div className="p-4 border-t bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-slate-600 font-bold hover:bg-slate-200 transition-colors cursor-pointer">Cancelar</button>
          <button onClick={save} disabled={saving || !formData.name} className="px-6 py-2 rounded-lg bg-[#0F172A] text-white font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 transition-all shadow-lg shadow-slate-900/20 cursor-pointer">{saving && <Loader2 className="animate-spin" size={16} />}Guardar Producto</button>
        </div>
      </div>
      <style jsx>{`
        .label-form { @apply block text-xs font-bold text-slate-500 mb-1 uppercase; }
        .input-form { @apply w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all; }
      `}</style>
    </div>
  )
}
