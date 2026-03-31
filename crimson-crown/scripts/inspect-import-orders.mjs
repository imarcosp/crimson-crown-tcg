import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function inspectTable() {
    console.log('Inspecting import_orders...')
    
    // Obtener una orden reciente para ver sus campos
    const { data, error } = await supabase
        .from('import_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
    
    if (error) {
        console.error('Error:', error)
    } else {
        console.log('Columns found:', Object.keys(data))
        console.log('Sample Data:', data)
    }
}

inspectTable()
