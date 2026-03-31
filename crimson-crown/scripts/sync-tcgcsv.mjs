import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

// --- CONFIGURACIÓN ---
const CATEGORY_ID = 89 // Riftbound
const API_BASE = 'https://tcgcsv.com'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY // Necesario para inserts/updates

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Error: Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// --- REGLAS DE PRECIOS MÍNIMOS (Regla 3) ---
const MIN_PRICES = {
    common: { normal: 0.35, foil: 0.99 },
    uncommon: { normal: 0.49, foil: 1.99 },
    rare: { normal: 0.49, foil: 0.49 }, // Asumimos igual para foil si no se especifica distinto, ajustado al base
    mythic: { normal: 0.99, foil: 0.99 }
}
const DEFAULT_MIN_PRICE = 0.35

// --- ESTADO GLOBAL PARA REPORTES ---
const stats = {
    processedGroups: 0,
    totalRemoteProducts: 0,
    inserted: 0,
    updated: 0,
    skippedManual: 0,
    errors: 0,
    valuationBefore: 0,
    valuationAfter: 0,
    orphans: [],
    zeroPrices: [],
    updatesLog: []
}

// --- UTILIDADES ---

    // Fetch usando Playwright para evitar bloqueos 403
const fetchJson = async (page, url) => {
    try {
        // console.log(`🌐 Fetching: ${url}`)
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        
        // Manejo específico de Cloudflare (403 o "Just a moment...")
        if (response && response.status() === 403) {
             console.log('🛡️ Cloudflare Challenge detectado (403). Esperando 10 segundos...')
             await page.waitForTimeout(10000)
             // Reintentar parseo
             const title = await page.title()
             if (title.includes('Just a moment')) {
                 console.log('⚠️ Aún en challenge...')
                 await page.waitForTimeout(5000)
             }
        }

        return await page.evaluate(() => {
            try {
                // Intentar parsear JSON directamente del body
                const text = document.body.innerText
                return JSON.parse(text)
            } catch {
                return null
            }
        })
    } catch (e) {
        console.error(`⚠️ Error fetching ${url}: ${e.message}`)
        return null
    }
}

const normalizeString = (str) => {
    return String(str || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

const getMinPrice = (rarityRaw, isFoil) => {
    const rarity = normalizeString(rarityRaw)
    const type = isFoil ? 'foil' : 'normal'

    if (rarity.includes('common') && !rarity.includes('uncommon')) return MIN_PRICES.common[type]
    if (rarity.includes('uncommon')) return MIN_PRICES.uncommon[type]
    if (rarity.includes('rare') && !rarity.includes('mythic')) return MIN_PRICES.rare[type]
    if (rarity.includes('mythic')) return MIN_PRICES.mythic[type]

    return DEFAULT_MIN_PRICE
}

const getAttribute = (extendedData, name) => {
    if (!Array.isArray(extendedData)) return null
    const item = extendedData.find(x => x.name.toLowerCase() === name.toLowerCase())
    return item ? item.value : null
}

// --- LÓGICA PRINCIPAL ---

async function main() {
    console.log('🚀 Iniciando Sincronización Riftbound desde TCGCSV (v2 Playwright)...')
    
    // INICIAR BROWSER
    const browser = await chromium.launch({ headless: false }) // Headless false ayuda con Cloudflare
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            'Upgrade-Insecure-Requests': '1'
        }
    })
    const page = await context.newPage()

    // 1. OBTENER DATOS LOCALES (SNAPSHOT INICIAL CON PAGINACIÓN)
    console.log('📥 Descargando inventario local de Supabase...')
    let localProducts = []
    let pageIdx = 0
    const PAGE_SIZE = 1000
    let hasMore = true

    while (hasMore) {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('tcg', 'Riftbound')
            .range(pageIdx * PAGE_SIZE, (pageIdx + 1) * PAGE_SIZE - 1)
        
        if (error) {
            console.error('❌ Error fatal leyendo Supabase:', error)
            await browser.close()
            process.exit(1)
        }

        if (data.length > 0) {
            localProducts = localProducts.concat(data)
            pageIdx++
        }
        
        if (data.length < PAGE_SIZE) hasMore = false
    }

    // Calcular Valuación Inicial
    stats.valuationBefore = localProducts.reduce((sum, p) => sum + (Number(p.price_usd || 0) * (p.stock || 0)), 0)
    console.log(`📊 Inventario Local: ${localProducts.length} cartas. Valuación: $${stats.valuationBefore.toFixed(2)}`)

    // Mapa para búsqueda rápida local: Clave = "Set|Nombre|CN|Finish"
    // Normalizamos para evitar errores de espacios o mayúsculas
    const localMap = new Map()
    localProducts.forEach(p => {
        const finish = normalizeString(p.finish) === 'foil' ? 'foil' : 'normal' // Simplificación 'etched' -> normal o foil según lógica negocio, aquí asumimos binario foil/normal para match base
        // Nota: Si usas 'Etched' u otros, ajusta aquí. TCGCSV suele dar "Foil" y "Reverse Foil".
        const key = `${normalizeString(p.set_name)}|${normalizeString(p.name)}|${normalizeString(p.collector_number)}|${finish}`
        localMap.set(key, p)
    })

    const matchedLocalIds = new Set()

    // 2. OBTENER GRUPOS (SETS) REMOTOS
    console.log('🌐 Obteniendo Grupos (Sets) de TCGCSV...')
    // Endpoint corregido según documentación: /tcgplayer/{categoryId}/groups
    const groupsResponse = await fetchJson(page, `${API_BASE}/tcgplayer/${CATEGORY_ID}/groups`)
    if (!groupsResponse || !groupsResponse.results) {
        console.error('❌ No se pudieron obtener los grupos.')
        await browser.close()
        process.exit(1)
    }

    const groups = groupsResponse.results
    console.log(`📚 Procesando ${groups.length} sets...`)

    // 3. PROCESAR CADA SET
    for (const group of groups) {
        const groupId = group.groupId
        const groupName = group.name

        // A. Obtener Productos del Grupo
        const productsRes = await fetchJson(page, `${API_BASE}/tcgplayer/${CATEGORY_ID}/${groupId}/products`)
        const pricesRes = await fetchJson(page, `${API_BASE}/tcgplayer/${CATEGORY_ID}/${groupId}/prices`)

        if (!productsRes?.results || !pricesRes?.results) {
            console.warn(`⚠️ Datos incompletos para set ${groupName}, saltando...`)
            continue
        }

        // B. Crear Mapa de Precios: ProductID -> { foil: price, normal: price }
        const priceMap = new Map()
        pricesRes.results.forEach(priceItem => {
            if (!priceMap.has(priceItem.productId)) {
                priceMap.set(priceItem.productId, {})
            }
            const entry = priceMap.get(priceItem.productId)
            // TCGCSV subTypeName suele ser "Normal", "Foil", "Unlimited", "1st Edition"
            const type = normalizeString(priceItem.subTypeName)
            // Priorizamos Listed Median (midPrice) según requerimiento de negocio.
            // Si no existe, usamos marketPrice o lowPrice como fallback.
            entry[type] = priceItem.midPrice || priceItem.marketPrice || priceItem.lowPrice || 0
        })

        // C. Procesar Productos
        for (const remoteProd of productsRes.results) {
            // REGLA 1: Ignorar Sellados
            // Estrategia: Si no tiene "Rarity" en extendedData, probablemente es sellado o accesorio
            // O si el nombre contiene palabras clave.
            const rarity = getAttribute(remoteProd.extendedData, 'Rarity')
            const cn = getAttribute(remoteProd.extendedData, 'Number')
            
            // Filtro Anti-Sellado Básico
            const nameLower = remoteProd.name.toLowerCase()
            if (!rarity && (nameLower.includes('booster') || nameLower.includes('deck') || nameLower.includes('box'))) {
                continue 
            }

            // Un producto en TCGCSV puede tener variantes de precio (Foil/Normal)
            // Iteramos las variantes posibles que nos interesan
            const variantsToCheck = ['normal', 'foil']
            
            const prices = priceMap.get(remoteProd.productId) || {}

            for (const variant of variantsToCheck) {
                // Verificar si existe precio para esta variante en TCGCSV (si no existe, quizás no existe la carta en esa versión)
                // Ojo: A veces existe la carta pero precio es 0. 
                // Asumimos que si está en la lista de precios (aunque sea 0) o si es 'normal' (casi siempre existe), la procesamos.
                // Para simplificar: Solo procesamos si tenemos un "entry" en prices o es Normal (base).
                
                // Si es foil y no hay data de foil, saltar
                if (variant === 'foil' && prices['foil'] === undefined) continue

                // MEJORA: Validar si la variante NORMAL existe realmente.
                // Muchas cartas de Riftbound son Foil-Only. Si TCGCSV no reporta precio 'normal'
                // y el precio raw es 0, es muy probable que NO exista la versión normal.
                if (variant === 'normal' && prices['normal'] === undefined) {
                    // Si no hay precio normal reportado, asumimos que no existe esa variante
                    // A MENOS que ya la tengamos en base de datos (para no borrar stock por error)
                    const keyCheck = `${normalizeString(groupName)}|${normalizeString(remoteProd.name)}|${normalizeString(cn)}|normal`
                    if (!localMap.has(keyCheck)) {
                        continue 
                    }
                }
                
                const isFoil = variant === 'foil'
                const rawPrice = prices[variant] || 0
                
                // REGLA 3: Calcular Precio Mínimo
                let finalPrice = Math.max(rawPrice, getMinPrice(rarity, isFoil))
                
                // Identificación
                const keyFinish = isFoil ? 'foil' : 'normal'
                const matchKey = `${normalizeString(groupName)}|${normalizeString(remoteProd.name)}|${normalizeString(cn)}|${keyFinish}`
                
                const localMatch = localMap.get(matchKey)

                // --- ESCENARIO: ACTUALIZACIÓN (MATCH) ---
                if (localMatch) {
                    matchedLocalIds.add(localMatch.id)

                    // REGLA 2: No tocar manuales
                    if (localMatch.is_manual_price) {
                        stats.skippedManual++
                        continue
                    }

                    const updates = {}
                    const changesLog = []

                    // Chequear cambio de precio
                    // Usamos una tolerancia pequeña para floats
                    if (Math.abs((localMatch.price_usd || 0) - finalPrice) > 0.01) {
                        updates.price_usd = finalPrice
                        changesLog.push(`Precio: $${localMatch.price_usd} -> $${finalPrice}`)
                    }

                    // Actualizar Metadata con ID de TCGPlayer (Regla 4)
                    const currentMeta = localMatch.metadata || {}
                    if (currentMeta.tcgplayer_id !== remoteProd.productId) {
                        updates.metadata = { ...currentMeta, tcgplayer_id: remoteProd.productId }
                        changesLog.push(`Metadata ID: ${remoteProd.productId}`)
                    }

                    // Si la imagen local falta o es placeholder, podríamos actualizarla (opcional, pero recomendado)
                    if (!localMatch.image_url || localMatch.image_url.includes('placeholder')) {
                        updates.image_url = remoteProd.imageUrl
                        changesLog.push(`Imagen actualizada`)
                    }

                    if (Object.keys(updates).length > 0) {
                        const { error } = await supabase
                            .from('products')
                            .update(updates)
                            .eq('id', localMatch.id)
                        
                        if (error) {
                            console.error(`❌ Error actualizando ${localMatch.name}:`, error.message)
                            stats.errors++
                        } else {
                            stats.updated++
                            stats.updatesLog.push(`${localMatch.name} (${variant}): ${changesLog.join(', ')}`)
                        }
                    }

                } 
                // --- ESCENARIO: INSERCIÓN (NUEVO) ---
                else {
                    // Preparar objeto para insert
                    // Mapeo de campos DB
                    const newProduct = {
                        name: remoteProd.name,
                        set_name: groupName,
                        tcg: 'Riftbound',
                        price_usd: finalPrice,
                        stock: 0, // Regla 4: Stock 0 por defecto
                        finish: isFoil ? 'Foil' : 'Normal', // Capitalizado para UI
                        image_url: remoteProd.imageUrl,
                        collector_number: cn || 'N/A',
                        rarity: rarity || 'Unknown',
                        is_manual_price: false,
                        // is_active: true, // Eliminado por error de schema
                        metadata: {
                            tcgplayer_id: remoteProd.productId,
                            clean_name: remoteProd.cleanName
                        }
                        // scryfall_id: null // No aplica aquí, usamos metadata.tcgplayer_id
                    }

                    const { error } = await supabase
                        .from('products')
                        .insert(newProduct)
                    
                    if (error) {
                        console.error(`❌ Error insertando ${remoteProd.name}:`, error.message)
                        stats.errors++
                    } else {
                        stats.inserted++
                        // console.log(`✨ Insertado: ${remoteProd.name} [${groupName}] (${variant})`)
                    }
                }

                // Auditoría de precio cero (aunque el mínimo debería evitarlo, es bueno loguear si la fuente vino en 0)
                if (rawPrice <= 0) {
                    stats.zeroPrices.push({
                        name: remoteProd.name,
                        set: groupName,
                        finish: variant,
                        reason: 'Source price was 0 or null'
                    })
                }
            }
        }
        stats.processedGroups++
    }

    // Cerrar browser al terminar loops
    await browser.close()

    // 4. POST-PROCESAMIENTO Y REPORTES

    // Detectar Huérfanos y Eliminar si Stock es 0
    const orphansToDelete = []
    
    for (const p of localProducts) {
        if (!matchedLocalIds.has(p.id)) {
            // Es huérfana
            stats.orphans.push(`${p.name} [${p.set_name}] #${p.collector_number} (Stock: ${p.stock})`)
            
            // Si tiene stock 0, la marcamos para eliminar
            if (p.stock === 0) {
                orphansToDelete.push(p.id)
            }
        }
    }

    // Ejecutar Eliminación Masiva
    let deletedCount = 0
    const deletedNames = [] // Para el log
    
    if (orphansToDelete.length > 0) {
        console.log(`\n🧹 Eliminando ${orphansToDelete.length} cartas huérfanas sin stock...`)
        
        // Mapeamos ID -> Nombre para el reporte
        const idToName = new Map()
        localProducts.forEach(p => idToName.set(p.id, `${p.name} [${p.set_name}] (${p.finish})`))

        // Eliminamos en lotes de 100 para no saturar
        const chunkSize = 100
        for (let i = 0; i < orphansToDelete.length; i += chunkSize) {
            const chunk = orphansToDelete.slice(i, i + chunkSize)
            const { error } = await supabase
                .from('products')
                .delete()
                .in('id', chunk)
            
            if (error) {
                console.error('❌ Error eliminando huérfanos:', error.message)
            } else {
                deletedCount += chunk.length
                chunk.forEach(id => deletedNames.push(idToName.get(id)))
            }
        }
        console.log(`✅ ${deletedCount} cartas eliminadas correctamente.`)
    }

    // Calcular Valuación Final (Estimada: Anterior + Cambios + Nuevos)
    // Para ser exactos, hacemos una query rápida de suma o la calculamos
    // Dado que el stock de los nuevos es 0, solo los updates de precio afectan la valuación.
    // Haremos una re-fetch ligera de precios para exactitud o cálculo en memoria si es viable.
    // Por simplicidad y performance, haremos fetch de solo id, price, stock nuevamente.
    
    // PAGINACIÓN PARA LA VALUACIÓN FINAL TAMBIÉN
    let finalStockData = []
    let pIdx = 0
    let more = true
    while (more) {
        const { data, error } = await supabase.from('products').select('price_usd, stock').eq('tcg', 'Riftbound').range(pIdx * PAGE_SIZE, (pIdx + 1) * PAGE_SIZE - 1)
        if (!error && data.length > 0) {
            finalStockData = finalStockData.concat(data)
            pIdx++
        }
        if (!data || data.length < PAGE_SIZE) more = false
    }

    if (finalStockData.length > 0) {
        stats.valuationAfter = finalStockData.reduce((sum, p) => sum + (Number(p.price_usd || 0) * (p.stock || 0)), 0)
    }

    // --- REPORTE FINAL ---
    console.log('\n=============================================================')
    console.log('📝 REPORTE FINAL DE SINCRONIZACIÓN RIFTBOUND (TCGCSV)')
    console.log('=============================================================')
    
    console.log(`\n🔢 ESTADÍSTICAS GENERALES:`)
    console.log(`   Sets Procesados:      ${stats.processedGroups}`)
    console.log(`   Cartas Insertadas:    ${stats.inserted}`)
    console.log(`   Cartas Actualizadas:  ${stats.updated}`)
    console.log(`   Cartas Eliminadas:    ${deletedCount}`)
    console.log(`   Manuales Omitidos:    ${stats.skippedManual}`)
    console.log(`   Errores:              ${stats.errors}`)

    console.log(`\n💰 VALUACIÓN DEL INVENTARIO:`)
    console.log(`   Antes:   $${stats.valuationBefore.toFixed(2)}`)
    console.log(`   Después: $${stats.valuationAfter.toFixed(2)}`)
    const diff = stats.valuationAfter - stats.valuationBefore
    console.log(`   Diferencia: ${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}`)

    if (deletedNames.length > 0) {
        console.log(`\n🗑️ DETALLE DE CARTAS ELIMINADAS (Muestra últimas 20):`)
        deletedNames.slice(-20).forEach(x => console.log(`   - ${x}`))
        if (deletedNames.length > 20) console.log(`   ... y ${deletedNames.length - 20} más.`)
    }

    if (stats.zeroPrices.length > 0) {
        console.log(`\n⚠️ ALERTA DE PRECIOS ORIGEN CERO (${stats.zeroPrices.length}):`)
        console.log(`   (Se aplicó precio mínimo, pero revisar en origen)`)
        stats.zeroPrices.slice(0, 10).forEach(x => console.log(`   - ${x.name} (${x.finish}) [${x.set}]`))
        if (stats.zeroPrices.length > 10) console.log(`   ... y ${stats.zeroPrices.length - 10} más.`)
    }

    if (stats.orphans.length > 0) {
        console.log(`\n👻 CARTAS HUÉRFANAS LOCALES (${stats.orphans.length}):`)
        console.log(`   (Existen en BD pero no en TCGCSV - Posible error de nombre o set)`)
        stats.orphans.slice(0, 10).forEach(x => console.log(`   - ${x}`))
        if (stats.orphans.length > 10) console.log(`   ... y ${stats.orphans.length - 10} más.`)
    }

    if (stats.updatesLog.length > 0) {
        console.log(`\n🔄 DETALLE DE ACTUALIZACIONES (Muestra últimos 10):`)
        stats.updatesLog.slice(-10).forEach(x => console.log(`   - ${x}`))
    }

    console.log('\n✅ Sincronización completada.')
}

main().catch(e => {
    console.error('💥 Error no controlado en script:', e)
})
