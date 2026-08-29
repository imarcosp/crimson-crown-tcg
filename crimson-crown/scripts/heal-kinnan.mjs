import 'dotenv/config'
import { createOperationalSupabaseClient as createClient } from './lib/guarded-supabase-client.mjs'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
    console.log('🩺 CURANDO A KINNAN')

    // 1. Obtener el Kinnan malo de la BD
    const { data: kinnans } = await supabase
        .from('products')
        .select('*')
        .ilike('name', 'Kinnan, Bonder Prodigy')
        .eq('collector_number', '192')
        .eq('set_name', 'Ikoria: Lair of Behemoths')
        
    if (!kinnans || kinnans.length === 0) {
        console.log('No se encontró Kinnan #192 en local.')
        return
    }

    for (const k of kinnans) {
        console.log(`\nLocal Encontrado: ID=${k.id} | ScryID=${k.scryfall_id}`)
        
        // 2. Buscar en Scryfall la verdadera #192
        const res = await fetch(`https://api.scryfall.com/cards/search?q=!"Kinnan, Bonder Prodigy" set:iko cn:192`)
        const json = await res.json()
        
        if (json.data && json.data.length > 0) {
            const realScryfall = json.data[0]
            console.log(`Scryfall Verdadera: ID=${realScryfall.id} | Set=${realScryfall.set_name} | CN=${realScryfall.collector_number}`)
            
            if (k.scryfall_id !== realScryfall.id) {
                console.log(`⚠️ DISCREPANCIA DETECTADA! Actualizando a ${realScryfall.id}...`)
                const { error } = await supabase.from('products').update({ scryfall_id: realScryfall.id }).eq('id', k.id)
                if (error) console.error('Error:', error)
                else console.log('✅ Curado exitosamente.')
            } else {
                console.log('✅ El ID ya es correcto.')
            }
        }
    }
}

main()
