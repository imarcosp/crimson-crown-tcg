import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function inspectForeignKeys() {
    console.log('Inspecting dependencies for Product deletion...')
    
    // Lista de tablas sospechosas que suelen linkear a productos
    const tables = ['cart_items', 'wishlists', 'deck_cards', 'inventory', 'price_history']
    
    // ID de prueba (uno que el usuario mencionó o uno cualquiera)
    const TEST_ID = '2efa7d14-bfbe-4413-a817-127bbcd815db'

    for (const table of tables) {
        // Intentar ver si la tabla existe y si tiene referencias
        const { data, error } = await supabase
            .from(table)
            .select('id') // Asumimos que tiene id
            .eq('product_id', TEST_ID) // Asumimos columna product_id
            .limit(1)
            
        if (error) {
            // console.log(`Table ${table} check skipped/error: ${error.message}`)
        } else if (data && data.length > 0) {
            console.log(`⚠️ FOUND REFERENCE in table '${table}': Product ${TEST_ID} is used there.`)
        } else {
            // console.log(`✅ No references in ${table}`)
        }
    }
}

inspectForeignKeys()
