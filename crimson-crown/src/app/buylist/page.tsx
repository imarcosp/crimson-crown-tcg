"use client"
import { useEffect, useMemo, useState } from 'react'
import { useBuylistStore } from '@/store/buylistStore'
import { submitBuylist } from '@/app/actions/buylist'

export default function BuylistPage() {
  const { sellItems, addItemToSell, removeItem, updateQuantity, toggleFoil, updateCondition, clearBuylist, getTotalOffer } = useBuylistStore()
  
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const total = useMemo(() => Math.round(getTotalOffer() * 100) / 100, [sellItems, getTotalOffer])

  useEffect(() => {
    const term = q.trim()
    if (term.length < 3) { setResults([]); return }
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((arr) => setResults(arr || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [q])

  const handleSubmit = async () => {
    if (!sellItems.length) return
    const confirmed = window.confirm("⚠️ IMPORTANTE:\n\nLos precios mostrados son estimados para cartas Near Mint (NM).\nEl valor final dependerá de la revisión física del estado de las cartas en la tienda.\n\n¿Deseas enviar tu solicitud para revisión?")
    if (!confirmed) return
    const res = await submitBuylist(sellItems, total)
    if (res?.success) { clearBuylist(); alert('¡Solicitud enviada! Podes ver el estado en "Mi Cuenta".'); } else { alert(res?.error || 'No se pudo enviar la solicitud') }
  }

  // --- HELPER DE ETIQUETAS Y VARIANTES ---
  const getVariantInfo = (r: any) => {
    const promos = Array.isArray(r?.promo_types) ? r.promo_types : []
    const finishes = Array.isArray(r?.finishes) ? r.finishes : []
    // Si viene de DB local, el finish es un string único
    const dbFinish = String(r.finish || '').toLowerCase()
    
    let label = 'Foil'
    let isSpecial = false

    // 1. Detectar Variantes Promocionales
    if (promos.includes('confetti')) { label = 'Confetti Foil'; isSpecial = true }
    else if (promos.includes('galaxy')) { label = 'Galaxy Foil'; isSpecial = true }
    else if (promos.includes('surge')) { label = 'Surge Foil'; isSpecial = true }
    else if (promos.includes('textured')) { label = 'Textured Foil'; isSpecial = true }
    else if (promos.includes('serialized')) { label = 'Serialized'; isSpecial = true }
    else if (promos.includes('step-and-compleat')) { label = 'Compleat Foil'; isSpecial = true }
    else if (promos.includes('halo')) { label = 'Halo Foil'; isSpecial = true }
    // 2. Detectar Acabados Técnicos (DB Local o API)
    else if (finishes.includes('etched') || dbFinish.includes('etched')) { label = 'Etched Foil'; isSpecial = true }
    else if (finishes.includes('glossy')) { label = 'Glossy'; isSpecial = true }
    // 3. Foil Estándar
    else if (finishes.includes('foil') || (dbFinish.includes('foil') && !dbFinish.includes('non'))) { label = 'Foil'; isSpecial = false }
    
    return { label, isSpecial }
  }

  const handleSelectCard = (r: any) => {
    // Datos crudos de precios
    let rawPrice = Number(r.price_usd ?? r.priceUsd ?? 0)
    let rawPriceFoil = Number(r.price_usd_foil ?? r.priceUsdFoil ?? 0)
    let rawPriceEtched = Number(r.price_usd_etched ?? r.priceUsdEtched ?? 0)

    // Detectar si la carta ES brillante inherentemente (Riftbound o Etched Magic)
    const finishLower = String(r.finish || '').toLowerCase()
    const isInherentlyFoil = (finishLower.includes('foil') && !finishLower.includes('non')) || 
                             finishLower.includes('etched') || 
                             finishLower.includes('holo')

    // --- CORRECCIÓN CRÍTICA DE PRECIOS ---
    // Si la carta es Foil/Etched pero el precio vino en la columna "Normal" (común en imports únicos),
    // movemos ese precio a la columna correcta y vaciamos la normal.
    if (isInherentlyFoil && rawPrice > 0 && rawPriceFoil === 0 && rawPriceEtched === 0) {
        if (finishLower.includes('etched')) {
            rawPriceEtched = rawPrice
        } else {
            rawPriceFoil = rawPrice
        }
        rawPrice = 0 // Ya no tiene precio normal
    }

    const pNormal = rawPrice
    // Precio "Brillante" unificado (Foil o Etched)
    const pShiny = rawPriceFoil > 0 ? rawPriceFoil : rawPriceEtched

    // --- DETECCIÓN DE ETIQUETA ---
    const { label: variantLabel } = getVariantInfo(r)

    // --- LÓGICA DE EXISTENCIA ---
    // Solo asumimos que existe si tiene precio > 0.
    // (Ignoramos metadata 'finishes' porque puede ser engañosa en cartas singulares de DB)
    const hasNonFoil = pNormal > 0
    const hasFoilVariant = pShiny > 0

    // --- ESTADO INICIAL ---
    let isFoilState = false
    let forcedFinish: string | undefined = undefined

    // CASO 1: Solo existe Foil/Etched (Ej: Riftbound Foil, Judge Promo)
    if (hasFoilVariant && !hasNonFoil) {
        isFoilState = true
        forcedFinish = variantLabel // Bloqueamos el check visualmente
    }
    // CASO 2: Solo existe Normal
    else if (!hasFoilVariant && hasNonFoil) {
        isFoilState = false
        forcedFinish = 'Non-Foil' // Bloqueamos el check
    }
    // CASO 3: Existen ambos (Híbrido)
    else {
        // Por defecto seleccionamos el más barato (Normal) a menos que solo haya Foil
        isFoilState = false
    }

    // SI NO HAY PRECIOS (Raro, pero posible si stock=0 y precio=0)
    // Asumimos según el finish de la DB para no romper la UI
    if (!hasNonFoil && !hasFoilVariant) {
        if (isInherentlyFoil) {
            isFoilState = true
            forcedFinish = variantLabel
        } else {
            isFoilState = false
            forcedFinish = 'Non-Foil'
        }
    }

    addItemToSell({
      id: r.id,
      name: r.name,
      image_url: r.image_url,
      set_name: r.set_name,
      collector_number: r.collector_number,
      tcg: r.tcg || 'Magic',
      scryfall_id: r.scryfall_id,
      source: 'manual',
      
      // Estado Visual
      isFoil: isFoilState,
      foilLabel: variantLabel,
      finish: forcedFinish, // Esto controla que el check se deshabilite
      condition: 'NM',
      
      // Precios Calculados
      priceUsd: pNormal,
      priceUsdFoil: pShiny,
      finishes: Array.isArray(r.finishes) ? r.finishes : []
    })
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <h1 className="text-2xl font-bold text-[#0F172A]">Vender Cartas a la Tienda</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* BUSCADOR */}
        <div className="md:col-span-1 bg-white rounded-lg border border-slate-200 p-4 shadow-sm h-[600px] flex flex-col">
            <div className="font-bold mb-2">Buscar Carta</div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej: Rhystic Study" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#E91E63] outline-none" />
            
            <div className="mt-3 flex-1 overflow-y-auto space-y-1 pr-1">
              {loading && <div className="text-sm text-slate-500 p-2 text-center">Buscando...</div>}
              
              {results.map((r) => {
                const { label, isSpecial } = getVariantInfo(r)
                return (
                  <button key={`${r.id}`} onClick={() => handleSelectCard(r)} className="w-full text-left rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50 flex items-center gap-3 group transition-all cursor-pointer"> 
                    <div className="w-10 h-14 bg-slate-200 shrink-0 relative overflow-hidden rounded shadow-sm"> 
                      {r.image_url && (<img src={r.image_url} className="object-cover w-full h-full" alt={r.name} />)} 
                    </div> 
                    <div className="flex-1 min-w-0"> 
                      <div className="text-sm font-bold truncate text-slate-800 group-hover:text-[#E91E63] transition-colors">{r.name}</div> 
                      <div className="text-xs text-slate-500 flex flex-wrap gap-x-2 gap-y-1 mt-0.5"> 
                        <span>{r.set_name}</span> 
                        <span className="font-mono text-slate-400 bg-slate-100 px-1 rounded">#{r.collector_number}</span> 
                      </div> 
                      {isSpecial && ( 
                        <div className="mt-1"> 
                           <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold border border-purple-200 inline-block"> 
                             ✨ {label} 
                           </span> 
                        </div> 
                      )} 
                    </div> 
                  </button>
                )
              })}
              
              {!loading && q.length > 2 && results.length === 0 && (
                 <div className="text-center text-sm text-slate-400 mt-4">No se encontraron resultados físicos.</div>
              )}
            </div>
        </div>

        {/* LISTA DE VENTA */}
        <div className="md:col-span-2"> 
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm"> 
            <div className="font-bold mb-2">Tu Lista de Venta</div> 
            <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 p-3 text-sm mb-3"> 
              Nota: Oferta estimada al 75% del valor de mercado. Revisión final en tienda. 
            </div> 
            
            <div className="w-full space-y-2"> 
              {/* Encabezados Desktop */} 
              <div className="hidden sm:grid grid-cols-[3fr_1fr_1.5fr_1.5fr_1fr_0.5fr] gap-4 px-2 py-2 text-xs text-slate-500 font-bold uppercase tracking-wider border-b"> 
                <div>Carta</div> 
                <div className="text-center">Variante</div> 
                <div className="text-right">Mercado</div> 
                <div className="text-right">Oferta</div> 
                <div className="text-center">Cant.</div> 
                <div></div> 
              </div> 

              {sellItems.length === 0 ? ( 
                <div className="py-12 text-center text-slate-400 border-2 border-dashed border-slate-100 rounded-lg"> 
                   Busca y agrega cartas para comenzar 
                </div> 
              ) : ( 
                sellItems.map((i) => { 
                  // Lógica de visualización del checkbox
                  const hasNonFoil = i.priceUsd > 0
                  const hasFoil = i.priceUsdFoil > 0
                  
                  // Solo permitimos elegir si AMBOS precios existen
                  const canChoose = hasNonFoil && hasFoil 
                  
                  // Si no se puede elegir, detectamos cuál es para mostrar la etiqueta fija
                  const isOnlyFoil = !canChoose && hasFoil
                  const isOnlyNonFoil = !canChoose && hasNonFoil
                  
                  const label = i.foilLabel || 'Foil' 

                  const basePrice = i.isFoil ? (i.priceUsdFoil || 0) : (i.priceUsd || 0) 
                  
                  // Factor de Condición
                  const factor = i.condition === 'NM' ? 1 : i.condition === 'EX' ? 0.85 : i.condition === 'VG' ? 0.75 : 0.60 
                  
                  const offerVal = basePrice * factor * 0.75 

                  return ( 
                  <div key={i.id} className="grid grid-cols-1 sm:grid-cols-[3fr_1fr_1.5fr_1.5fr_1fr_0.5fr] gap-4 items-center border p-3 sm:border-0 sm:border-b last:border-0 rounded-lg sm:rounded-none bg-slate-50 sm:bg-white relative"> 
                    
                    {/* INFO CARTA */} 
                    <div className="flex items-center gap-3"> 
                      {i.image && (<img src={i.image} alt={i.name} className="w-10 h-14 object-cover rounded shadow-sm border border-slate-200" />)} 
                      <div className="min-w-0"> 
                        <div className={`font-bold text-sm truncate ${i.isFoil ? 'text-purple-900' : 'text-slate-900'}`}> 
                            {i.name} 
                        </div> 
                        <div className="text-xs text-slate-500 flex gap-2"> 
                            <span>{i.set_name}</span> 
                            <span className="font-mono opacity-60">#{i.collector_number}</span> 
                        </div> 
                      </div> 
                    </div> 

                    {/* CONTROL FOIL / CONDICIÓN */} 
                    <div className="flex flex-row sm:flex-col items-center sm:items-stretch gap-2"> 
                       <select 
                         value={i.condition || 'NM'} 
                         onChange={(e) => updateCondition(i.id, e.target.value as any)} 
                         className="border border-slate-300 rounded px-1 py-1 text-xs bg-white w-full focus:ring-1 focus:ring-[#E91E63] outline-none" 
                       > 
                          <option value="NM">NM (Impecable)</option> 
                          <option value="EX">EX (Excelente)</option> 
                          <option value="VG">VG (Muy Buena)</option> 
                          <option value="G">G (Buena)</option> 
                       </select> 

                       {/* Checkbox Dinámico */} 
                       {canChoose && ( 
                         <label className="flex items-center justify-center gap-1.5 cursor-pointer select-none border rounded px-1 py-1 bg-white hover:border-purple-300 transition-colors w-full"> 
                           <input type="checkbox" checked={Boolean(i.isFoil)} onChange={() => toggleFoil(i.id)} className="rounded text-purple-600 focus:ring-purple-500 w-3 h-3"/> 
                           <span className="text-[10px] font-bold text-slate-700">{label}</span> 
                         </label> 
                       )} 
                       {isOnlyFoil && ( 
                         <div className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1 py-1 rounded border border-purple-100 text-center w-full truncate cursor-not-allowed" title={`Solo existe en ${label}`}> 
                           ✨ {label} 
                         </div> 
                       )} 
                       {isOnlyNonFoil && ( 
                         <div className="text-[10px] text-slate-500 text-center w-full bg-slate-100 py-1 rounded cursor-not-allowed border border-slate-200">Normal</div> 
                       )} 
                    </div> 

                    {/* PRECIOS */} 
                    <div className="flex justify-between sm:block text-right"> 
                        <span className="sm:hidden text-xs text-slate-400">Mercado:</span> 
                        <div className="text-xs text-slate-400 font-mono"> 
                            {basePrice > 0 ? `US$ ${basePrice.toFixed(2)}` : '---'} 
                        </div> 
                    </div> 

                    <div className="flex justify-between sm:block text-right"> 
                        <span className="sm:hidden text-xs font-bold">Oferta:</span> 
                        <div className="text-sm font-bold text-emerald-600 font-mono"> 
                            {offerVal > 0 ? `US$ ${offerVal.toFixed(2)}` : '---'} 
                        </div> 
                    </div> 

                    {/* CANTIDAD */} 
                    <div className="flex justify-end"> 
                      <input 
                        type="number" min={1} 
                        value={i.quantity} 
                        onChange={(e) => updateQuantity(i.id, Number(e.target.value))} 
                        className="w-16 rounded border border-slate-300 px-2 py-1 text-center text-sm font-bold focus:ring-1 focus:ring-[#E91E63] outline-none" 
                      /> 
                    </div> 

                    {/* ELIMINAR */} 
                    <div className="text-right"> 
                        <button onClick={() => removeItem(i.id)} className="text-slate-300 hover:text-red-500 transition-colors p-2 cursor-pointer"> 
                            ✕ 
                        </button> 
                    </div> 
                  </div> 
                )}) 
              )} 
            </div> 
            
            {/* FOOTER TOTAL */} 
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-between border-t pt-6 gap-4"> 
              <div className="text-slate-800 text-lg"> 
                Total Estimado: <span className="font-bold text-[#0F172A] text-2xl ml-2">US$ {total.toFixed(2)}</span> 
              </div> 
              <button 
                onClick={handleSubmit} 
                disabled={sellItems.length === 0} 
                className="w-full sm:w-auto bg-[#0F172A] hover:bg-slate-800 text-white px-8 py-3 rounded-lg font-bold shadow-lg transition-all disabled:opacity-50 disabled:shadow-none cursor-pointer" 
              > 
                Enviar Solicitud 
              </button> 
            </div> 
          </div> 
        </div> 
      </div> 
    </div> 
  ) 
}
