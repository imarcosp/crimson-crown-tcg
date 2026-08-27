import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ProductDetailView from '@/components/catalog/ProductDetailView'
import ProductCard from '@/components/catalog/ProductCard'
import type { Metadata } from 'next'
import { Layers } from 'lucide-react'
import { siteConfig } from '@/config/site'
import { buildHybridCatalogProducts } from '@/lib/inventory/catalog'

export const revalidate = 60

async function findLocalProductByRouteId(supabase: any, id: string) {
  const byId = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (byId.data) return byId.data

  const byScryfall = await supabase
    .from('products')
    .select('*')
    .eq('scryfall_id', id)
    .order('stock', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return byScryfall.data || null
}

function shouldUseSpecialFoilLabel(currentFinish: string | undefined, foilVariant: string | undefined) {
  if (!foilVariant) return false
  const current = String(currentFinish || '').toLowerCase().trim()
  return !current || current === 'foil' || current === 'etched' || current === 'etched foil'
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  
  let name = ''
  let image = ''
  let description = `Compra esta carta en ${siteConfig.name}`

  let product = await findLocalProductByRouteId(supabase, id)

  if (product) {
    name = product.name
    image = product.image_url || ''
    description = `Carta ${product.name} de la expansión ${product.set_name}. Disponible en stock o para importar.`
  } else {
    try {
      const res = await fetch(`https://api.scryfall.com/cards/${id}`)
      if (res.ok) {
        const data = await res.json()
        name = data.name
        image = data.image_uris?.normal || ''
        description = `${data.name} (${data.set_name}) - Magic: The Gathering`
      }
    } catch {}
  }

  return {
    title: name,
    description,
    openGraph: {
      images: image ? [image] : [],
      title: name,
      description
    }
  }
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // 1. Obtener Producto Principal
  let product = await findLocalProductByRouteId(supabase, id)

  let isImport = false
  
  // 2. Fallback Scryfall
  if (!product) {
    try {
      const res = await fetch(`https://api.scryfall.com/cards/${id}`)
      if (!res.ok) return notFound()
      const scryfallData = await res.json()
      isImport = true
      
      product = {
        id: scryfallData.id,
        name: scryfallData.name,
        set_name: scryfallData.set_name,
        tcg: 'Magic',
        stock: 0,
        condition: 'NM',
        finish: 'Non-Foil',
        rarity: scryfallData.rarity ? scryfallData.rarity.charAt(0).toUpperCase() + scryfallData.rarity.slice(1) : '',
        image_url: scryfallData.image_uris?.normal || scryfallData.card_faces?.[0]?.image_uris?.normal,
        collector_number: scryfallData.collector_number,
        scryfall_id: scryfallData.id,
        price_usd: Number(scryfallData.prices?.usd || 0),
        price_usd_foil: Number(scryfallData.prices?.usd_foil || 0)
      }
    } catch (e) {
      return notFound()
    }
  }

  const { data: activeInventories } = await supabase
    .from('inventories')
    .select('id, kind')
    .eq('is_active', true)
    .is('archived_at', null)
  let activeInventoryIds = new Set<string>((activeInventories || []).map((inventory: any) => String(inventory.id)))
  if (!isImport) {
    const requestedInventoryIsActive = activeInventoryIds.has(String(product.inventory_id || ''))
    const inventoryKinds = new Map((activeInventories || []).map((inventory: any) => [String(inventory.id), inventory.kind]))

    if (product.variant_key && activeInventoryIds.size > 0) {
      const { data: matchingRows } = await supabase
        .from('products')
        .select('*')
        .eq('variant_key', product.variant_key)
        .in('inventory_id', [...activeInventoryIds])
      const rows = (matchingRows || []).map((row: any) => ({
        ...row,
        inventory_kind: inventoryKinds.get(String(row.inventory_id)) || 'secondary',
      }))
      const scryfallIds = [...new Set(rows.map((row: any) => String(row.scryfall_id || '')).filter(Boolean))]
      const { data: externalRows } = scryfallIds.length > 0
        ? await supabase
            .from('external_prices')
            .select('scryfall_id, cardkingdom_retail_normal, cardkingdom_retail_foil, cardkingdom_retail_etched, tcgplayer_market_normal, tcgplayer_market_foil')
            .in('scryfall_id', scryfallIds)
        : { data: [] }
      const externalMap = new Map((externalRows || []).map((row: any) => [String(row.scryfall_id), row]))
      const hybridRows = buildHybridCatalogProducts(rows, externalMap, { activeInventoryIds, includeOutOfStock: true })
      const selectedListing = hybridRows.find((row: any) => String(row.id) === String(product.id)) || hybridRows[0]
      if (selectedListing) {
        product = {
          ...product,
          id: requestedInventoryIsActive ? product.id : selectedListing.id,
          stock: selectedListing.stock,
          price_usd: selectedListing.price_usd,
          inventory_count: selectedListing.inventory_count,
          pricing_source: selectedListing.pricing_source,
        }
      } else if (!requestedInventoryIsActive) {
        return notFound()
      }
    } else if (!requestedInventoryIsActive) {
      return notFound()
    }
  }

  // 3. Precios y Normalización (Principal)
  let finalPrice = Number(product.price_usd || 0)
  let finalPriceFoil = Number(product.price_usd_foil || 0)
  let productExternal: any = null

  if (product.scryfall_id) {
    const { data: ext } = await supabase
      .from('external_prices')
      .select('active_price_normal, active_price_foil, foil_variant')
      .eq('scryfall_id', product.scryfall_id)
      .maybeSingle()
    productExternal = ext
  }

  if (isImport && productExternal) {
    if (Number(productExternal.active_price_normal || 0) > 0) finalPrice = Number(productExternal.active_price_normal)
    if (Number(productExternal.active_price_foil || 0) > 0) finalPriceFoil = Number(productExternal.active_price_foil)
  }
  if (shouldUseSpecialFoilLabel(product.finish, productExternal?.foil_variant)) {
    product.finish = productExternal.foil_variant
  }

  const finish = (product.finish || '').toLowerCase()
  const isFoil = (finish.includes('foil') && !finish.includes('non')) || finish.includes('etched') || finish.includes('holo')

  const normalizedProduct = {
    id: product.id,
    name: product.name,
    tcg: product.tcg || 'Magic',
    priceUsd: finalPrice,
    priceUsdFoil: finalPriceFoil,
    stock: product.stock,
    condition: product.condition || 'NM',
    isFoil: isFoil,
    finish: product.finish,
    rarity: product.rarity || '',
    image: product.image_url,
    setName: product.set_name,
    collectorNumber: product.collector_number,
    isImport: isImport,
    availability: product.stock > 0 ? 'stock' : 'backorder',
    language: product.language || (isImport ? 'English' : undefined),
    metadata: product.metadata,
    inventoryCount: Number(product.inventory_count || 0),
    pricingSource: product.pricing_source || 'unknown'
  }

  // 4. Obtener Historial
  let priceHistory: any[] = []
  if (!isImport) {
    const { data: hist } = await supabase
        .from('price_history')
        .select('price, created_at')
        .eq('product_id', product.id)
        .order('created_at', { ascending: true })
    priceHistory = hist || []
  }

  // 5. NUEVO: Obtener Alternativas (INCLUYENDO IMPORTS)
  let alternatives: any[] = []
  if (product.name) {
      const { data: alts } = await supabase
        .from('products')
        .select('*')
        .eq('name', product.name)
        .neq('id', product.id) // Excluir la actual
        .in('inventory_id', [...activeInventoryIds])
        // .gt('stock', 0)  <-- ELIMINADO PARA MOSTRAR TODO
        .order('stock', { ascending: false }) // Prioridad: Primero lo que tiene stock
        .limit(10) // Aumentamos el límite para ver variedad
      
      if (alts && alts.length > 0) alternatives = alts

      try {
        const qName = encodeURIComponent(product.name)
        const scryRes = await fetch(`https://api.scryfall.com/cards/search?q=!"${qName}" game:paper unique:prints&order=released`)
        const scryJson = await scryRes.json()
        const list = Array.isArray(scryJson?.data) ? scryJson.data : []

        const existingKeys = new Set(
          (alternatives || []).map((a: any) => `${a.set_name}-${a.collector_number}`)
        )

        const imports = list
          .filter((c: any) => c && c.id && (c.collector_number !== product.collector_number || c.set_name !== product.set_name))
          .slice(0, 24)
          .map((c: any) => ({
            id: c.id,
            name: c.name,
            tcg: 'Magic',
            set_name: c.set_name,
            collector_number: c.collector_number,
            image_url: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal,
            price_usd: Number(c?.prices?.usd || 0),
            price_usd_foil: Number(c?.prices?.usd_foil || 0),
            stock: 0,
            condition: 'NM',
            finish: (Array.isArray(c.finishes) && c.finishes.includes('etched')) ? 'Etched Foil' : (Array.isArray(c.finishes) && c.finishes.includes('foil')) ? 'Foil' : 'Non-Foil',
            rarity: c.rarity,
            language: 'English',
            isImport: true,
          }))
          .filter((imp: any) => !existingKeys.has(`${imp.set_name}-${imp.collector_number}`))

        // Enriquecer con precios CK si existen
        const scryIds = imports.map((i: any) => i.id)
        if (scryIds.length > 0) {
          const { data: extPrices } = await supabase
            .from('external_prices')
            .select('scryfall_id, active_price_normal, active_price_foil, cardkingdom_retail_normal, cardkingdom_retail_foil, foil_variant')
            .in('scryfall_id', scryIds)
          const pm = new Map<string, any>()
          ;(extPrices || []).forEach((row: any) => pm.set(String(row.scryfall_id), row))
          imports.forEach((v: any) => {
            const row = pm.get(String(v.id))
            if (row) {
              const ckN = Number(row.active_price_normal || row.cardkingdom_retail_normal || 0)
              const ckF = Number(row.active_price_foil || row.cardkingdom_retail_foil || 0)
              if (ckN > 0) v.price_usd = ckN
              if (ckF > 0) v.price_usd_foil = ckF
              if (shouldUseSpecialFoilLabel(v.finish, row.foil_variant)) v.finish = row.foil_variant
            }
          })
        }

        alternatives = alternatives.concat(imports)
      } catch {}
  }

  const altScryIds = alternatives
    .map((alt: any) => alt.scryfall_id || alt.id)
    .filter(Boolean)

  if (altScryIds.length > 0) {
    const { data: altExternal } = await supabase
      .from('external_prices')
      .select('scryfall_id, foil_variant')
      .in('scryfall_id', altScryIds)
    const altMap = new Map<string, any>()
    ;(altExternal || []).forEach((row: any) => altMap.set(String(row.scryfall_id), row))
    alternatives = alternatives.map((alt: any) => {
      const row = altMap.get(String(alt.scryfall_id || alt.id))
      if (row && shouldUseSpecialFoilLabel(alt.finish, row.foil_variant)) {
        return { ...alt, finish: row.foil_variant }
      }
      return alt
    })
  }

  return (
    <div className="pb-12">
        <ProductDetailView product={normalizedProduct} priceHistory={priceHistory} />
        
        {/* SECCIÓN ALTERNATIVAS */}
        {alternatives.length > 0 && (
            <div className="container mx-auto px-4 mt-12 pt-8 border-t border-slate-100">
                <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <Layers className="text-slate-400"/> Otras versiones
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {alternatives.map((alt) => {
                        // Mapeo rápido para ProductCard
                        const f = String(alt.finish || '').toLowerCase()
                        const isF = (f.includes('foil') && !f.includes('non')) || f.includes('etched')
                        
                        // Determinamos disponibilidad
                        const hasStock = Number(alt.stock || 0) > 0

                        return (
                            <ProductCard 
                                key={alt.id}
                                id={alt.id}
                                name={alt.name}
                                tcg={alt.tcg || 'Magic'}
                                priceUsd={Number(alt.price_usd || 0)}
                                priceUsdFoil={Number(alt.price_usd_foil || 0)}
                                stock={alt.stock}
                                condition={alt.condition || 'NM'}
                                isFoil={isF}
                                finish={alt.finish}
                                rarity={alt.rarity}
                                image={alt.image_url}
                                setName={alt.set_name}
                                collectorNumber={alt.collector_number}
                                language={alt.language}
                                availability={hasStock ? 'stock' : 'backorder'} // Mostramos Backorder si stock es 0
                                isImport={alt.isImport === true}
                            />
                        )
                    })}
                </div>
            </div>
        )}
    </div>
  )
}
