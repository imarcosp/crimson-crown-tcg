"use client"
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { Loader2, Save, ExternalLink, Search, CheckCircle, AlertTriangle, Eye, Ban, HelpCircle } from 'lucide-react'

type Orphan = {
    scryfall_id: string
    name: string
    set_name: string
    finish: string
    finishes_raw: string[]
    image_url: string
    collector_number: string
    stock: number
}

export default function FixPricesPage() {
    const [orphans, setOrphans] = useState<Orphan[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState<string | null>(null)
    const [ignoring, setIgnoring] = useState<string | null>(null)
    const [inputs, setInputs] = useState<Record<string, string>>({})
    const [zoomedImage, setZoomedImage] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const supabase = createClient()

    useEffect(() => {
        fetchOrphans()
    }, [])

    const fetchOrphans = async () => {
        setLoading(true)
        
        let ids: string[] = []

        if (searchQuery.trim().length > 2) {
            // MODO BÚSQUEDA GLOBAL: Buscar en Scryfall API directamente
            try {
                const searchRes = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(searchQuery)}&unique=prints`)
                const searchResult = await searchRes.json()
                
                if (searchResult.data) {
                    // Tomamos los resultados de Scryfall directamente
                    const validCards = searchResult.data.slice(0, 50) // Límite para no saturar
                    ids = validCards.map((c: any) => c.id)
                    
                    // No necesitamos llamar a /collection de nuevo porque ya tenemos los datos
                    // Pero necesitamos cruzar con external_prices para ver los IDs actuales
                    
                    const { data: currentExternal } = await supabase
                        .from('external_prices')
                        .select('scryfall_id, cardkingdom_id_normal, cardkingdom_id_foil')
                        .in('scryfall_id', ids)
                    
                    const ckMap = new Map()
                    currentExternal?.forEach((e: { scryfall_id: string; cardkingdom_id_normal: string | null; cardkingdom_id_foil: string | null }) => ckMap.set(e.scryfall_id, e))

                    const mappedResults = validCards.map((card: any) => {
                        const ext = ckMap.get(card.id)
                        const isFoil = card.finishes.includes('foil') || card.finishes.includes('etched')
                        const currentId = isFoil ? ext?.cardkingdom_id_foil : ext?.cardkingdom_id_normal
                        
                        if (currentId) {
                            setInputs(prev => ({ ...prev, [card.id]: currentId }))
                        }

                        return {
                            scryfall_id: card.id,
                            name: card.name,
                            set_name: card.set_name,
                            finish: getDetailedFinish(card),
                            finishes_raw: card.finishes,
                            image_url: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '',
                            collector_number: card.collector_number,
                            stock: 0
                        }
                    })
                    
                    setOrphans(mappedResults)
                    setLoading(false)
                    return // Salir aquí, ya tenemos todo
                }
            } catch (e) {
                console.error("Error buscando en Scryfall:", e)
            }
        } else {
            // MODO HUÉRFANOS (Default)
            const { data: missingIds } = await supabase
                .from('external_prices')
                .select('scryfall_id')
                .is('cardkingdom_id_normal', null)
                .is('cardkingdom_id_foil', null)
                .neq('ignore_ck', true)
                .limit(20)
            
            if (missingIds) ids = missingIds.map((x: { scryfall_id: string }) => x.scryfall_id)
        }

        if (ids.length === 0) {
            setOrphans([])
            setLoading(false)
            return
        }

        // Obtener datos actuales de external_prices (para pre-llenar IDs si ya existen)
        const { data: currentExternal } = await supabase
            .from('external_prices')
            .select('scryfall_id, cardkingdom_id_normal, cardkingdom_id_foil')
            .in('scryfall_id', ids)
        
        const ckMap = new Map()
        currentExternal?.forEach((e: { scryfall_id: string; cardkingdom_id_normal: string | null; cardkingdom_id_foil: string | null }) => ckMap.set(e.scryfall_id, e))

        try {
            const res = await fetch('https://api.scryfall.com/cards/collection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifiers: ids.map(id => ({ id })) })
            })
            
            const result = await res.json()
            if (result.data) {
                // FILTRO DE BASURA DIGITAL (Solo en modo huérfanos, en búsqueda mostramos todo lo que el usuario pida)
                const IGNORED_KEYWORDS = ['alchemy', 'arena', 'magic online', 'mtgo', 'digital', 'art series', 'unknown event', 'token', 'memorabilia', 'oversized']
                
                const validCards = result.data.filter((c: any) => {
                    if (searchQuery) return true // En búsqueda mostramos todo
                    if (c.digital) return false
                    const set = (c.set_name || '').toLowerCase()
                    const type = (c.type_line || '').toLowerCase()
                    if (IGNORED_KEYWORDS.some(k => set.includes(k) || type.includes(k))) return false
                    return true
                })

                const mappedOrphans: Orphan[] = []
                
                validCards.forEach((card: any) => {
                    const ext = ckMap.get(card.id)
                    const finishes = card.finishes || []
                    
                    // Generar una entrada por cada acabado relevante
                    const variants = []
                    if (finishes.includes('nonfoil')) variants.push({ type: 'Non-Foil', isFoil: false })
                    if (finishes.includes('foil')) variants.push({ type: 'Foil', isFoil: true })
                    if (finishes.includes('etched')) variants.push({ type: 'Etched', isFoil: true })
                    
                    // Si no tiene finishes standard (raro), fallback
                    if (variants.length === 0) variants.push({ type: 'Normal', isFoil: false })

                    variants.forEach(variant => {
                        // Determinar si ya tiene ID asignado para esta variante
                        const currentId = variant.isFoil ? ext?.cardkingdom_id_foil : ext?.cardkingdom_id_normal
                        
                        // Si estamos en modo "Huérfanos" (no búsqueda) y YA tiene ID, no lo mostramos
                        // A MENOS que estemos buscando específicamente
                        if (!searchQuery && currentId) return

                        // Key única para el input (ID + Variante) para no mezclar
                        const inputKey = `${card.id}-${variant.type}`
                        
                        if (currentId) {
                            setInputs(prev => ({ ...prev, [inputKey]: currentId }))
                        }

                        mappedOrphans.push({
                            scryfall_id: card.id,
                            name: card.name,
                            set_name: card.set_name,
                            finish: variant.type === 'Foil' ? getDetailedFinish(card) : variant.type, // Solo detallar foil si es foil
                            finishes_raw: card.finishes,
                            image_url: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '',
                            collector_number: card.collector_number,
                            stock: 0,
                            // Campos extra para manejo interno
                            _variantType: variant.type,
                            _isFoil: variant.isFoil,
                            _inputKey: inputKey
                        } as any)
                    })
                })
                setOrphans(mappedOrphans)
            }
        } catch (error) {
            console.error('Error fetching Scryfall:', error)
        }
        setLoading(false)
    }

    const getDetailedFinish = (card: any) => {
        const finishes = card.finishes || []
        const isFoil = finishes.includes('foil')
        const isEtched = finishes.includes('etched')
        const isGlossy = finishes.includes('glossy')
        
        // Intentar detectar variantes especiales desde promo_types o frame_effects
        const promos = card.promo_types || []
        const frames = card.frame_effects || []
        
        let details = []
        if (promos.includes('surgefoil')) details.push('Surge')
        if (promos.includes('confettifoil')) details.push('Confetti')
        if (promos.includes('galaxyfoil')) details.push('Galaxy')
        if (promos.includes('stepandcompleat')) details.push('Compleat')
        if (promos.includes('oilfoil')) details.push('Oil')
        if (promos.includes('halo')) details.push('Halo')
        if (promos.includes('textured')) details.push('Textured')
        
        if (isEtched) return `Etched ${details.join(' ')}`
        if (isFoil) return `${details.join(' ')} Foil`.trim()
        return 'Non-Foil'
    }

    const handleSave = async (orphan: any) => {
        const ckId = inputs[orphan._inputKey]
        if (!ckId) return alert('Ingresa un ID')

        setSaving(orphan._inputKey)
        
        const isFoil = orphan._isFoil
        
        const payload: any = { updated_at: new Date().toISOString() }
        if (isFoil) payload.cardkingdom_id_foil = ckId
        else payload.cardkingdom_id_normal = ckId

        const { error } = await supabase.from('external_prices').update(payload).eq('scryfall_id', orphan.scryfall_id)

        if (error) alert('Error: ' + error.message)
        else removeOrphan(orphan._inputKey)
        
        setSaving(null)
    }

    const removeOrphan = (key: string) => {
        setOrphans(prev => prev.filter(p => (p as any)._inputKey !== key))
        setInputs(prev => {
            const next = { ...prev }
            delete next[key]
            return next
        })
    }

    const handleIgnore = async (id: string, key: string) => {
        if (!confirm('¿Ignorar esta carta para siempre en CK?')) return
        setIgnoring(key)
        const { error } = await supabase.from('external_prices').update({ ignore_ck: true }).eq('scryfall_id', id)
        if (error) alert('Error: ' + error.message)
        // Remover TODAS las variantes de esta carta, ya que ignore_ck aplica al registro completo
        else setOrphans(prev => prev.filter(p => p.scryfall_id !== id))
        setIgnoring(null)
    }

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="max-w-6xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                            <AlertTriangle className="text-orange-500" size={32}/>
                            Reparación de IDs CardKingdom
                        </h1>
                        <p className="text-slate-500 text-sm mt-1">Asocia manualmente las cartas que el script no pudo encontrar.</p>
                    </div>
                    <div className="flex gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/>
                            <input 
                                type="text" 
                                placeholder="Buscar carta..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && fetchOrphans()}
                                className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 w-64"
                            />
                        </div>
                        <button onClick={fetchOrphans} className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors cursor-pointer">
                            {searchQuery ? 'Buscar' : 'Recargar Lista'}
                        </button>
                    </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-sm text-blue-800 flex gap-3">
                    <HelpCircle className="shrink-0 text-blue-500" size={20}/>
                    <div>
                        <p className="font-bold mb-1">¿Cómo encontrar el ID en CardKingdom?</p>
                        <ol className="list-decimal pl-4 space-y-1">
                            <li>Busca la carta en CardKingdom (usa el enlace directo).</li>
                            <li>En la página del producto, haz <strong>click derecho</strong> en el botón "Add to Cart" y elige <strong>Inspeccionar</strong>.</li>
                            <li>Busca el número en <code>value="12345"</code> o <code>data-id="12345"</code> dentro del input oculto cercano.</li>
                            <li>Copia ese número y pégalo aquí.</li>
                        </ol>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-20"><Loader2 className="animate-spin text-slate-400" size={48}/></div>
                ) : orphans.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-slate-200">
                        <CheckCircle className="mx-auto text-emerald-500 mb-4" size={48}/>
                        <h2 className="text-xl font-bold text-slate-700">¡Todo limpio!</h2>
                        <p className="text-slate-500">No hay cartas pendientes en este lote.</p>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {orphans.map((orphan: any) => (
                            <div key={orphan._inputKey} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center gap-6 group">
                                <div className="relative w-16 h-24 shrink-0 rounded overflow-hidden border border-slate-100 bg-slate-100 cursor-zoom-in" onClick={() => setZoomedImage(orphan.image_url)}>
                                    {orphan.image_url && <Image src={orphan.image_url} alt={orphan.name} fill className="object-cover"/>}
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                        <Eye className="text-white drop-shadow-md" size={20}/>
                                    </div>
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="font-bold text-lg text-slate-800 truncate">{orphan.name}</h3>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${orphan.finish.toLowerCase().includes('foil') || orphan.finish.toLowerCase().includes('etched') ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                            {orphan.finish}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-500 flex items-center gap-2">
                                        <span className="font-medium text-slate-700">{orphan.set_name}</span>
                                        <span className="text-slate-300">•</span>
                                        <span>#{orphan.collector_number}</span>
                                    </p>
                                    <p className="text-[10px] text-slate-400 mt-0.5 font-mono select-all cursor-text" title="Click para seleccionar">
                                        ID: {orphan.scryfall_id}
                                    </p>
                                    <div className="mt-2 flex gap-3 text-xs">
                                        <a 
                                            href={`https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(orphan.name)}`} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-sky-600 hover:underline flex items-center gap-1"
                                        >
                                            <Search size={12}/> Buscar en CK
                                        </a>
                                        <a 
                                            href={`https://scryfall.com/card/${orphan.set_name.toLowerCase().replace(/[^a-z0-9]/g, '')}/${orphan.collector_number}`} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-indigo-600 hover:underline flex items-center gap-1"
                                        >
                                            <ExternalLink size={12}/> Ver en Scryfall
                                        </a>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    <div className="w-40">
                                        <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1 tracking-wider">
                                            ID CK ({orphan._variantType})
                                        </label>
                                        <input 
                                            type="text" 
                                            placeholder="Ej: 220451"
                                            value={inputs[orphan._inputKey] || ''}
                                            onChange={(e) => setInputs(prev => ({ ...prev, [orphan._inputKey]: e.target.value }))}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition-shadow"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1 mt-5">
                                        <button 
                                            onClick={() => handleSave(orphan)}
                                            disabled={saving === orphan._inputKey || !inputs[orphan._inputKey]}
                                            className="h-9 w-9 flex items-center justify-center bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:bg-slate-300 transition-colors shadow-sm cursor-pointer"
                                            title="Guardar ID"
                                        >
                                            {saving === orphan._inputKey ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>}
                                        </button>
                                        <button 
                                            onClick={() => handleIgnore(orphan.scryfall_id, orphan._inputKey)}
                                            disabled={ignoring === orphan._inputKey}
                                            className="h-9 w-9 flex items-center justify-center bg-white border border-slate-200 text-slate-400 rounded-lg hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors cursor-pointer"
                                            title="Ignorar esta carta (No existe en CK)"
                                        >
                                            {ignoring === orphan._inputKey ? <Loader2 className="animate-spin" size={16}/> : <Ban size={16}/>}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* ZOOM MODAL */}
                {zoomedImage && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setZoomedImage(null)}>
                        <div className="relative w-full max-w-sm aspect-[2.5/3.5] animate-in zoom-in-95 duration-200">
                            <Image src={zoomedImage} alt="Zoom" fill className="object-contain rounded-xl shadow-2xl"/>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
