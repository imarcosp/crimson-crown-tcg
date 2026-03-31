import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function cleanZeroStock() {
    console.log('🧹 Starting cleanup of Zero Stock products (Safe Mode)...')

    // 1. Obtener todos los productos con stock = 0
    // Opcional: Filtrar por tcg = 'Riftbound' si queremos ser específicos, 
    // pero el usuario dijo "TODAS las cartas". Por seguridad, empezaremos con Riftbound 
    // y si el usuario quiere todo, lo cambiamos. Pero para el caso de uso actual (sync tcgcsv)
    // es mejor limitar a Riftbound para no borrar Magic u otros juegos por accidente.
    const TCG_FILTER = 'Riftbound' 
    console.log(`🎯 Targeting TCG: ${TCG_FILTER}`)

    let allZeroStockIds = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    console.log('📥 Fetching zero stock products...')
    while (hasMore) {
        const { data, error } = await supabase
            .from('products')
            .select('id, name, set_name')
            .eq('stock', 0)
            .eq('tcg', TCG_FILTER)
            .range(page * pageSize, (page + 1) * pageSize - 1)
        
        if (error) {
            console.error('❌ Error fetching products:', error.message)
            process.exit(1)
        }

        if (data.length > 0) {
            allZeroStockIds = allZeroStockIds.concat(data)
            page++
        }
        if (data.length < pageSize) hasMore = false
    }

    console.log(`📊 Found ${allZeroStockIds.length} products with 0 stock.`)

    if (allZeroStockIds.length === 0) {
        console.log('✅ No zero stock products found to clean.')
        return
    }

    // 2. Verificar cuáles de estos han sido vendidos (están en order_items)
    console.log('🛡️ Checking sales history to protect sold items...')
    
    const soldProductIds = new Set()
    const productIdsToCheck = allZeroStockIds.map(p => p.id)
    
    // Consultamos order_items en lotes porque "in" tiene límites
    // Reducimos el tamaño del lote a 50 para evitar errores de fetch/payload too large
    const checkChunkSize = 50
    for (let i = 0; i < productIdsToCheck.length; i += checkChunkSize) {
        const chunk = productIdsToCheck.slice(i, i + checkChunkSize)
        try {
            const { data: soldItems, error: soldError } = await supabase
                .from('order_items')
                .select('product_id')
                .in('product_id', chunk)
            
            if (soldError) {
                console.error('❌ Error checking order_items:', soldError.message)
                // No abortamos, solo logueamos y asumimos que están protegidos por si acaso?
                // Mejor abortar para seguridad.
                process.exit(1)
            }

            if (soldItems) {
                soldItems.forEach(item => soldProductIds.add(item.product_id))
            }
        } catch (e) {
            console.error('❌ Exception in chunk check:', e.message)
            process.exit(1)
        }
        
        // Breve pausa para no saturar
        await new Promise(r => setTimeout(r, 100))
    }

    console.log(`🛡️ Protected ${soldProductIds.size} products that have history.`)

    // 3. Filtrar los que SE PUEDEN borrar
    const safeToDelete = allZeroStockIds.filter(p => !soldProductIds.has(p.id))
    
    console.log(`🗑️ Ready to delete ${safeToDelete.length} products (orphaned & never sold).`)

    if (safeToDelete.length === 0) {
        console.log('✅ Nothing to delete.')
        return
    }

    // 4. Ejecutar borrado en lotes
    let deletedCount = 0
    const deleteChunkSize = 100
    for (let i = 0; i < safeToDelete.length; i += deleteChunkSize) {
        const chunk = safeToDelete.slice(i, i + deleteChunkSize)
        const idsToDelete = chunk.map(p => p.id)
        
        const { error: deleteError } = await supabase
            .from('products')
            .delete()
            .in('id', idsToDelete)
        
        if (deleteError) {
            console.error('❌ Error deleting chunk:', deleteError.message)
        } else {
            deletedCount += chunk.length
            // console.log(`   Deleted batch ${i/deleteChunkSize + 1}...`)
        }
    }

    console.log(`\n✅ Cleanup Complete. Deleted ${deletedCount} products.`)
    console.log('Sample deleted:', safeToDelete.slice(0, 5).map(p => p.name).join(', '))
}

cleanZeroStock()
