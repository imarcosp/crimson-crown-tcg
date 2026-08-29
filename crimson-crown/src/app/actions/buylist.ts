"use server"

import { createGuardedServerClient as createServerClient } from '@/lib/supabase/guarded-constructors'
import { cookies } from 'next/headers'

export async function submitBuylist(items: any[], totalEstimate: number) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value },
        set(name: string, value: string, options: any) { try { cookieStore.set({ name, value, ...options }) } catch (error) {} },
        remove(name: string, options: any) { try { cookieStore.set({ name, value: '', ...options }) } catch (error) {} },
      },
    }
  )

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Debes iniciar sesión para vender cartas.')
    
    // 1. VALIDACIÓN ESTRICTA DE ENTRADA
    if (!items || !Array.isArray(items) || items.length === 0) throw new Error('La lista de venta está vacía.')
    
    // FIX BUG 4: Validar que el ID exista sin importar si es texto o número entero.
    const validItems = items.filter((i: any) => i.id != null && String(i.id).trim() !== '')
    
    if (validItems.length === 0) throw new Error('No se encontraron items válidos para procesar.')

    // 2. CÁLCULO SEGURO DEL TOTAL OFERTADO DESDE EL SERVIDOR (Evita manipulaciones)
    let calculatedTotalOffered = 0
    const itemsWithOffer = validItems.map(item => {
        const basePrice = item.isFoil ? (Number(item.priceUsdFoil) || 0) : (Number(item.priceUsd) || 0)
        let factor = 1
        if (item.condition === 'EX') factor = 0.85
        else if (item.condition === 'VG') factor = 0.75
        else if (item.condition === 'G') factor = 0.60
        
        const offer = basePrice * factor * 0.75
        calculatedTotalOffered += offer * Number(item.quantity || 1)
        
        return { ...item, calculatedOffer: offer }
    })

    if (calculatedTotalOffered <= 0) throw new Error('El valor total calculado es 0. Asegúrate de cotizar cartas válidas.')

    // 3. CREAR ORDEN CABECERA
    const { data: order, error: orderError } = await supabase 
      .from('buylist_orders') 
      .insert({ 
        user_id: user.id, 
        status: 'pending_review', 
        total_offered: calculatedTotalOffered 
      }) 
      .select() 
      .single() 
    
    if (orderError) throw new Error(`Error creando orden: ${orderError.message}`)

    // 4. GUARDAR ITEMS DETALLADOS
    const uuidRe = /^[0-9a-fA-F-]{36}$/
    // Resolver product_id cuando item.id no es uuid: buscamos en products por name/set_name/collector_number
    const resolved: Array<{ item: any; product_id: string | null }> = []
    for (const item of itemsWithOffer) {
      let pid: string | null = null
      if (typeof item.id === 'string' && uuidRe.test(item.id)) {
        pid = item.id
      } else {
        // Intento de resolución por scryfall_id si viene en el item
        try {
          if (item.scryfall_id && uuidRe.test(String(item.scryfall_id))) {
            const { data: prodByScry } = await supabase.from('products').select('id').eq('scryfall_id', String(item.scryfall_id)).limit(1).maybeSingle()
            if (prodByScry?.id) pid = String(prodByScry.id)
          }
        } catch {}
        if (!pid) {
          // Resolución por nombre + set_name + collector_number (catálogo local)
          try {
            let q = supabase.from('products').select('id').limit(1)
            // Usar patrones para evitar dependencias de mayúsculas/acentos
            q = q.ilike('name', `%${String(item.name || '').replace(/%/g,'')}%`)
            if (item.set_name || item.setName) q = q.ilike('set_name', `%${String(item.set_name || item.setName)}%`)
            if (item.collector_number || item.collectorNumber) q = q.eq('collector_number', String(item.collector_number || item.collectorNumber))
            const { data: prodByMeta } = await q.maybeSingle()
            if (prodByMeta?.id) pid = String(prodByMeta.id)
          } catch {}
        }
        if (!pid) {
          // Fallback robusto: deducir scryfall_id con Scryfall y mapear por scryfall_id
          try {
            const nameQ = encodeURIComponent(String(item.name || ''))
            const setQ = (item.set_name || item.setName) ? ` set:${encodeURIComponent(String(item.set_name || item.setName))}` : ''
            const cnQ = (item.collector_number || item.collectorNumber) ? ` cn:${encodeURIComponent(String(item.collector_number || item.collectorNumber))}` : ''
            const r = await fetch(`https://api.scryfall.com/cards/search?q=!"${nameQ}"${setQ}${cnQ} game:paper unique:prints&order=released`)
            if (r.ok) {
              const j = await r.json()
              const list = Array.isArray(j?.data) ? j.data : []
              const cnClean = String(item.collector_number || item.collectorNumber || '').toLowerCase().replace(/[^a-z0-9]/g,'')
              let cand: any = null
              if (cnClean) cand = list.find((v: any) => String(v.collector_number || '').toLowerCase().replace(/[^a-z0-9]/g,'') === cnClean) || null
              if (!cand && (item.set_name || item.setName)) {
                const setNameClean = String(item.set_name || item.setName || '').toLowerCase()
                cand = list.find((v: any) => String(v.set_name || '').toLowerCase() === setNameClean) || null
              }
              if (!cand) cand = list.find((v: any) => Array.isArray(v.games) && v.games.includes('paper')) || null
              if (cand && cand.id && uuidRe.test(String(cand.id))) {
                const { data: byScry } = await supabase.from('products').select('id').eq('scryfall_id', String(cand.id)).limit(1).maybeSingle()
                if (byScry?.id) pid = String(byScry.id)
              }
            }
          } catch {}
        }
      }
      resolved.push({ item, product_id: pid })
    }
    // Si alguna carta no pudo resolverse a product_id, abortamos con un mensaje claro
    const unresolved = resolved.filter(r => !r.product_id)
    if (unresolved.length > 0) {
      const genUuid = () => {
        const s: any[] = []
        const hex = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
        for (let i = 0; i < hex.length; i++) {
          const c = hex[i]
          if (c === 'x') s.push(((Math.random() * 16) | 0).toString(16))
          else if (c === 'y') s.push((((Math.random() * 16) | 0) & 0x3 | 0x8).toString(16))
          else s.push(c)
        }
        return s.join('')
      }
      const stillUnresolved = []
      for (const r of unresolved) {
        if (r.item?.source === 'moxfield') {
          r.product_id = genUuid()
        } else {
          stillUnresolved.push(r.item.name)
        }
      }
      if (stillUnresolved.length > 0) {
        throw new Error(`No se pudo vincular estas cartas con el catálogo: ${stillUnresolved.slice(0,3).join(', ')}${stillUnresolved.length > 3 ? '…' : ''}. Verifica set y #.`)
      }
    }
    const itemsPayload = resolved.map(({ item, product_id }) => ({
      buylist_id: order.id,
      product_id, // UUID válido de products
      quantity: item.quantity,
      offered_price_unit: item.calculatedOffer,
      condition: item.condition || 'NM',
      is_foil: Boolean(item.isFoil),
      card_name: item.name,
      set_name: item.set_name || item.setName,
      image_url: item.image_url || item.image,
      collector_number: item.collector_number || item.collectorNumber
    }))

    const { error: itemsError } = await supabase.from('buylist_items').insert(itemsPayload)
    if (itemsError) throw new Error(`Error guardando items: ${itemsError.message}`)

    return { success: true, orderId: order.id }

  } catch (error: any) {
    console.error('Submit Buylist Error:', error)
    return { success: false, error: error.message }
  }
}
