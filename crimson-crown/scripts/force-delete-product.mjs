import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function forceDelete(productId) {
    if (!productId) {
        console.error('❌ No Product ID provided.')
        return
    }

    console.log(`🗑️ Force deleting product: ${productId}`)

    // 1. Borrar de Carritos
    // Tabla: cart_items (según esquema común, si se llama diferente ajustaremos)
    const { error: cartError } = await supabase.from('cart_items').delete().eq('product_id', productId)
    if (cartError) console.log('⚠️ Error/Warning clearing cart_items:', cartError.message)
    else console.log('✅ Cleared from cart_items.')

    // 2. Borrar de Wishlists
    // A veces es 'wishlist_items', a veces 'wishlists' tiene el array.
    // Asumiremos una tabla relacional 'wishlist_items' o 'wishlists' con product_id
    const { error: wishError } = await supabase.from('wishlists').delete().eq('product_id', productId)
    if (wishError) {
        // Si falló, intentamos con wishlist_items
        const { error: wishItemError } = await supabase.from('wishlist_items').delete().eq('product_id', productId)
        if (wishItemError) console.log('⚠️ Error/Warning clearing wishlists/items:', wishItemError.message)
        else console.log('✅ Cleared from wishlist_items.')
    } else {
        console.log('✅ Cleared from wishlists.')
    }

    // 3. Borrar de Mazos (Decks) si aplica
    const { error: deckError } = await supabase.from('deck_cards').delete().eq('product_id', productId)
    if (deckError) console.log('⚠️ Warning deck_cards:', deckError.message) // No bloqueante si no existe tabla

    // 4. Borrar de Inventario (si existe tabla aparte)
    const { error: invError } = await supabase.from('inventory').delete().eq('product_id', productId)
    if (invError) console.log('⚠️ Warning inventory:', invError.message) // No bloqueante

    // 5. [CRÍTICO] Borrar de Historial de Ventas (order_items)
    // ADVERTENCIA: Esto borrará el registro de que este producto fue vendido en órdenes pasadas.
    // Si la orden ya fue completada, esto altera la integridad histórica, pero es necesario para borrar el producto.
    const { error: orderError } = await supabase.from('order_items').delete().eq('product_id', productId)
    if (orderError) {
        console.log('❌ Error clearing order_items:', orderError.message)
        // Si falla aquí, no podremos borrar el producto
        return
    } else {
        console.log('✅ Cleared from order_items (Sales History).')
    }

    // 6. Finalmente borrar producto
    const { error } = await supabase.from('products').delete().eq('id', productId)
    
    if (error) {
        console.error('❌ Failed to delete product:', error.message)
        if (error.code === '23503') {
            console.error('   (Foreign Key Constraint Violation - Still used somewhere else!)')
        }
    } else {
        console.log('✅ Product deleted successfully.')
    }
}

// Leer ID desde argumentos CLI
const targetId = process.argv[2]

if (!targetId) {
    console.error('❌ Uso: node scripts/force-delete-product.mjs <PRODUCT_ID>')
    process.exit(1)
}

forceDelete(targetId)
